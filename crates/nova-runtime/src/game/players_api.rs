//! The Lua side of players and local co-op: `nova.input.players()`, `player_events()`, `player(n)`, `glyph`, `prompt`,
//! `save_controls`, and `nova.net.*` (see `players.rs` and `net.rs`). The per-player forms of `nova.input.down` and its
//! siblings live with them in `game.rs`.

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::rc::Rc;

use mlua::{Lua, LuaSerdeExt, Table, Value};

use super::{Rumble, Shared, lua_err, number_option, string_option};
use crate::actions::{Binding, InputFrame};
use crate::input::PadState;
use crate::net::{Net, Role};
use crate::players::{self, MAX_PLAYERS, Owner, Seats};

/// The name controls are saved under, beside `save.json`.
const CONTROLS: &str = "controls";

pub(super) struct PlayersShared {
    /// Actions bound for one player alone (index 1 to `MAX_PLAYERS`; 0 is unused).
    pub own: Vec<BTreeMap<String, Binding>>,
    pub seats: Seats,
    /// This frame's pads and the seat each has.
    pads: Vec<PadState>,
    pad_seats: Vec<Option<u8>>,
    /// The player who pressed the newest source (for `next_source`), and the one a script has not asked about yet.
    pending_player: Option<u8>,
    events: Vec<players::SeatEvent>,
    net: Net,
    /// The game may use the network (`"local_network": true` in nova.json).
    network: bool,
}

impl PlayersShared {
    pub fn new(game_name: &str, network: bool) -> Self {
        Self {
            own: vec![BTreeMap::new(); usize::from(MAX_PLAYERS) + 1],
            seats: Seats::default(),
            pads: Vec::new(),
            pad_seats: Vec::new(),
            pending_player: None,
            events: Vec::new(),
            net: Net::new(&crate::export::game_id(game_name), ""),
            network,
        }
    }
}

impl PlayersShared {
    pub fn set_net_port(&mut self, port: u16) {
        self.net.set_port(port);
    }
}

/// This frame's input as each player feels it: seats the pads, adds their numbered sources, reads what other devices
/// sent, and evaluates every player's actions. Called by `Game::update_input` before the step.
pub(super) fn update(sh: &mut Shared, input: &InputFrame) {
    let p = &mut sh.players;
    p.pad_seats = p.seats.seat_pads(&input.pads);
    p.pads.clone_from(&input.pads);
    let mut sources = input.sources.clone();
    players::add_seated_sources(&p.pads, &p.pad_seats, &mut sources);
    if input.last_source.is_some() {
        p.pending_player = match &input.last_pad {
            Some(key) => players::player_of_pad(&p.pads, &p.pad_seats, key),
            None => Some(1),
        };
    }
    let bindings = sh.bindings.clone();
    p.net.poll(&mut p.seats, &mut sh.states, &bindings);
    let remote = p.net.remote_players();
    // remote players who are seated but gone have their actions let go by the network; keep them out of local reading
    let mut remote_seats: Vec<u8> = p
        .seats
        .all()
        .filter(|(_, s)| matches!(s.owner, Owner::Remote(_)))
        .map(|(n, _)| n)
        .collect();
    remote_seats.extend(remote);
    remote_seats.sort_unstable();
    remote_seats.dedup();
    sh.states
        .update(&bindings, &p.own, &sources, &input.overrides, &remote_seats);
    p.events.extend(p.seats.take_events());
    for (strong, weak, seconds) in p.net.take_rumble() {
        sh.rumble.push(Rumble {
            pad: 1,
            strong,
            weak,
            seconds,
            devices: Vec::new(),
        });
    }
}

/// After the step: what this device sends the others.
pub(super) fn after_frame(sh: &mut Shared) {
    let mine = sh.states.player(0);
    sh.players.net.flush(mine);
}

/// The source the newest press came from, and the player who pressed it (`nova.input.next_source`).
pub(super) fn take_pending_player(sh: &mut Shared) -> Option<u8> {
    sh.players.pending_player.take()
}

/// Turns a script's rumbles into what the host can play: the devices of each player's pad (a player with no pad here
/// keeps an empty list: nothing shakes), and a message to a joined player's device.
pub(super) fn resolve_rumble(sh: &mut Shared, list: Vec<Rumble>) -> Vec<Rumble> {
    let mut out = Vec::new();
    for mut r in list {
        if r.pad == 0 {
            // everyone: every pad here, and every joined player
            for player in sh.players.net.remote_players() {
                sh.players.net.rumble(player, r.strong, r.weak, r.seconds);
            }
            out.push(r);
            continue;
        }
        match sh.players.seats.get(r.pad).map(|s| (&s.owner, s.connected)) {
            Some((Owner::Pad(key), true)) => r.devices = vec![key.clone()],
            Some((Owner::Remote(_), true)) => {
                sh.players.net.rumble(r.pad, r.strong, r.weak, r.seconds);
            }
            // player 1 with no pad of its own: the handheld's own motor (input from no particular controller)
            None if r.pad == 1 => r.devices = vec![String::new()],
            _ => {}
        }
        out.push(r);
    }
    out
}

/// Reads the player's saved controls (called when the save is opened).
pub(super) fn load_controls(sh: &mut Shared) {
    let bytes = match sh.save.read_blob(CONTROLS) {
        Ok(Some(b)) => b,
        Ok(None) => return,
        Err(e) => {
            log::warn!("saved controls: {e}");
            return;
        }
    };
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
        log::warn!("saved controls: the file cannot be read; using the game's own");
        return;
    };
    let mut bindings = sh.bindings.clone();
    for w in players::controls_from_json(&value, &mut bindings, &mut sh.players.own) {
        log::warn!("{w}");
    }
    sh.bindings = bindings;
}

fn check_player(n: Option<f64>, what: &str) -> mlua::Result<u8> {
    match n {
        None => Ok(0),
        Some(v) if v.fract() == 0.0 && (0.0..=f64::from(MAX_PLAYERS)).contains(&v) => Ok(v as u8),
        Some(v) => Err(lua_err(format!(
            "{what}: the player must be a whole number from 1 to {MAX_PLAYERS} (or left out for anyone), not {v}"
        ))),
    }
}

/// The player number a script passed (None or 0: anyone).
pub(super) fn player_arg(n: Option<f64>, what: &str) -> mlua::Result<u8> {
    check_player(n, what)
}

fn need_network(sh: &Shared, what: &str) -> mlua::Result<()> {
    if sh.players.network {
        Ok(())
    } else {
        Err(lua_err(format!(
            "{what}: this game does not use the network; add \"local_network\": true to nova.json (Android builds then ask for wifi access)"
        )))
    }
}

pub(super) fn install(lua: &Lua, shared: &Rc<RefCell<Shared>>, nova: &Table) -> mlua::Result<()> {
    let input: Table = nova.get("input")?;

    // players(): who is playing, by seat: { player, name, connected, remote, rumble }
    let s = shared.clone();
    input.set(
        "players",
        lua.create_function(move |lua, ()| {
            let sh = s.borrow();
            let list = lua.create_table()?;
            let mut has_one = false;
            for (n, seat) in sh.players.seats.all() {
                let t = lua.create_table()?;
                t.set("player", n)?;
                t.set("name", seat.name.clone())?;
                t.set("connected", seat.connected)?;
                t.set("remote", matches!(seat.owner, Owner::Remote(_)))?;
                t.set("rumble", seat.rumble)?;
                has_one |= n == 1;
                list.push(t)?;
            }
            // player 1 is always here: this device's keys, even with no pad
            if !has_one {
                let t = lua.create_table()?;
                t.set("player", 1)?;
                t.set("name", "keys")?;
                t.set("connected", true)?;
                t.set("remote", false)?;
                t.set("rumble", cfg!(target_os = "android"))?;
                list.raw_insert(1, t)?;
            }
            Ok(list)
        })?,
    )?;
    // player_events(): what happened since the last call: { player, kind = "joined" | "left" | "back", name }
    let s = shared.clone();
    input.set(
        "player_events",
        lua.create_function(move |lua, ()| {
            let events = std::mem::take(&mut s.borrow_mut().players.events);
            let list = lua.create_table()?;
            for e in events {
                let t = lua.create_table()?;
                t.set("player", e.player)?;
                t.set("kind", e.kind)?;
                t.set("name", e.name)?;
                list.push(t)?;
            }
            Ok(list)
        })?,
    )?;
    // glyph("pad:south") -> "B", "button_b": what the button says on a Nintendo-style pad, and an icon name
    input.set(
        "glyph",
        lua.create_function(|_, source: String| {
            Ok(players::glyph(&source).map_or((None, None), |(l, i)| (Some(l), Some(i))))
        })?,
    )?;
    // prompt("jump", player) -> "B", "button_b", "pad:south": the button to show for an action
    let s = shared.clone();
    input.set(
        "prompt",
        lua.create_function(
            move |_, (name, player, keys): (String, Option<f64>, Option<bool>)| {
                let player = check_player(player, "nova.input.prompt")?;
                let sh = s.borrow();
                let binding = sh
                    .players
                    .own
                    .get(usize::from(player))
                    .and_then(|m| m.get(&name))
                    .or_else(|| sh.bindings.get(&name))
                    .ok_or_else(|| {
                        lua_err(format!("nova.input.prompt: unknown input action '{name}'"))
                    })?;
                let Some(source) = players::prompt_source(binding, !keys.unwrap_or(false)) else {
                    return Ok((None, None, None));
                };
                let (label, icon) = players::glyph(&source).unzip();
                Ok((label, icon, Some(source)))
            },
        )?,
    )?;
    // save_controls(): keeps the bindings the player chose (nova.input.bind) for the next run
    let s = shared.clone();
    input.set(
        "save_controls",
        lua.create_function(move |_, ()| {
            let mut sh = s.borrow_mut();
            let json = players::controls_to_json(&sh.base_bindings, &sh.bindings, &sh.players.own);
            let bytes = serde_json::to_vec_pretty(&json).map_err(|e| lua_err(e.to_string()))?;
            sh.save
                .write_blob(CONTROLS, bytes)
                .map_err(|e| lua_err(format!("nova.input.save_controls: {e}")))
        })?,
    )?;
    // player(n): the same calls for one player: local p = nova.input.player(2); if p.pressed("jump") then ... end
    let player_fn = lua.create_function(move |lua, n: f64| {
        let n = check_player(Some(n), "nova.input.player")?;
        let input: Table = lua.globals().get::<Table>("nova")?.get("input")?;
        let t = lua.create_table()?;
        for name in ["down", "pressed", "released", "axis", "prompt", "bindings"] {
            let f: mlua::Function = input.get(name)?;
            t.set(
                name,
                lua.create_function(move |_, action: String| {
                    f.call::<mlua::MultiValue>((action, n))
                })?,
            )?;
        }
        let f: mlua::Function = input.get("bind")?;
        t.set(
            "bind",
            lua.create_function(move |_, (action, spec): (String, Value)| {
                f.call::<()>((action, spec, n))
            })?,
        )?;
        let f: mlua::Function = input.get("rumble")?;
        t.set(
            "rumble",
            lua.create_function(move |_, (strength, seconds): (f64, Option<f64>)| {
                f.call::<()>((strength, seconds.unwrap_or(0.2), n))
            })?,
        )?;
        t.set("number", n)?;
        Ok(t)
    })?;
    input.set("player", player_fn)?;

    install_net(lua, shared, nova)
}

fn install_net(lua: &Lua, shared: &Rc<RefCell<Shared>>, nova: &Table) -> mlua::Result<()> {
    let net = lua.create_table()?;
    // host { name = "Jasper's Retroid", players = 2 }: other devices on this network can find this game and join
    let s = shared.clone();
    net.set(
        "host",
        lua.create_function(move |_, opts: Option<Table>| {
            let mut sh = s.borrow_mut();
            need_network(&sh, "nova.net.host")?;
            let max = number_option(&opts, "players")?.unwrap_or(2.0);
            if max.fract() != 0.0 || !(2.0..=f64::from(MAX_PLAYERS)).contains(&max) {
                return Err(lua_err(format!(
                    "nova.net.host: players must be a whole number from 2 to {MAX_PLAYERS}, not {max}"
                )));
            }
            apply_common(&mut sh, &opts)?;
            let p = &mut sh.players;
            Ok(match p.net.host(max as u8, &mut p.seats) {
                Ok(()) => (true, None),
                Err(e) => (false, Some(e)),
            })
        })?,
    )?;
    // find(): the games on this network, looking as long as it is called: { { id, name, players, max, full }, ... }
    let s = shared.clone();
    net.set(
        "find",
        lua.create_function(move |lua, opts: Option<Table>| {
            let mut sh = s.borrow_mut();
            need_network(&sh, "nova.net.find")?;
            apply_common(&mut sh, &opts)?;
            let p = &mut sh.players;
            if let Err(e) = p.net.find(&mut p.seats) {
                return Err(lua_err(format!("nova.net.find: {e}")));
            }
            let list = lua.create_table()?;
            for f in p.net.found() {
                let t = lua.create_table()?;
                t.set("id", f.id())?;
                t.set("name", f.name.clone())?;
                t.set("players", f.players)?;
                t.set("max", f.max)?;
                t.set("full", f.players >= f.max)?;
                list.push(t)?;
            }
            Ok(list)
        })?,
    )?;
    // join(id): joins a game from find() (or an address typed by hand, "192.168.1.20")
    let s = shared.clone();
    net.set(
        "join",
        lua.create_function(move |_, (id, opts): (String, Option<Table>)| {
            let mut sh = s.borrow_mut();
            need_network(&sh, "nova.net.join")?;
            apply_common(&mut sh, &opts)?;
            let p = &mut sh.players;
            Ok(match p.net.join(&id, &mut p.seats) {
                Ok(()) => (true, None),
                Err(e) => (false, Some(e)),
            })
        })?,
    )?;
    let s = shared.clone();
    net.set(
        "leave",
        lua.create_function(move |_, ()| {
            let mut sh = s.borrow_mut();
            let p = &mut sh.players;
            p.net.leave(&mut p.seats);
            Ok(())
        })?,
    )?;
    // status() -> "off" | "hosting" | "finding" | "joining" | "joined" | "lost", and a sentence to show
    let s = shared.clone();
    net.set(
        "status",
        lua.create_function(move |_, ()| {
            let sh = s.borrow();
            Ok((
                sh.players.net.role().word(),
                sh.players.net.status().to_string(),
            ))
        })?,
    )?;
    let s = shared.clone();
    net.set(
        "is_host",
        lua.create_function(move |_, ()| Ok(s.borrow().players.net.is_host()))?,
    )?;
    let s = shared.clone();
    net.set(
        "me",
        lua.create_function(move |_, ()| Ok(s.borrow().players.net.me()))?,
    )?;
    // name(): what this device is called to the others
    let s = shared.clone();
    net.set(
        "name",
        lua.create_function(move |_, ()| {
            let mut sh = s.borrow_mut();
            if sh.players.net.name().is_empty() {
                let n = crate::net::device_name();
                sh.players.net.set_name(&n);
            }
            Ok(sh.players.net.name().to_string())
        })?,
    )?;
    net.set(
        "address",
        lua.create_function(|_, ()| Ok(crate::net::local_address().map(|a| a.to_string())))?,
    )?;
    // players(): everyone in the game: { player, name, me, host, ping }
    let s = shared.clone();
    net.set(
        "players",
        lua.create_function(move |lua, ()| {
            let list = lua.create_table()?;
            for p in s.borrow().players.net.players() {
                let t = lua.create_table()?;
                t.set("player", p.player)?;
                t.set("name", p.name)?;
                t.set("me", p.me)?;
                t.set("host", p.host)?;
                t.set("ping", f64::from(p.ping_ms.round()))?;
                list.push(t)?;
            }
            Ok(list)
        })?,
    )?;
    // events(): { kind = "joined" | "left" | "connected" | "lost", player, name } since the last call
    let s = shared.clone();
    net.set(
        "events",
        lua.create_function(move |lua, ()| {
            let list = lua.create_table()?;
            for e in s.borrow_mut().players.net.take_events() {
                let t = lua.create_table()?;
                t.set("kind", e.kind)?;
                t.set("player", e.player)?;
                t.set("name", e.name)?;
                list.push(t)?;
            }
            Ok(list)
        })?,
    )?;
    // send(name, data, to): a message that arrives (in order); the host sends to a player or everyone, others to the host
    let s = shared.clone();
    net.set(
        "send",
        lua.create_function(move |lua, (name, data, to): (String, Value, Option<f64>)| {
            let to = match to {
                None => None,
                Some(_) => Some(check_player(to, "nova.net.send")?),
            };
            let json: serde_json::Value = lua.from_value(data).map_err(|e| {
                lua_err(format!(
                    "nova.net.send('{name}'): this cannot be sent ({e}); use numbers, strings, booleans and tables of those"
                ))
            })?;
            s.borrow_mut()
                .players
                .net
                .send(&name, json, to)
                .map_err(lua_err)
        })?,
    )?;
    // receive(): the messages that arrived since the last call: { { from, name, data }, ... }
    let s = shared.clone();
    net.set(
        "receive",
        lua.create_function(move |lua, ()| {
            let list = lua.create_table()?;
            for m in s.borrow_mut().players.net.take_inbox() {
                let t = lua.create_table()?;
                t.set("from", m.from)?;
                t.set("name", m.name)?;
                t.set("data", lua.to_value(&m.data)?)?;
                list.push(t)?;
            }
            Ok(list)
        })?,
    )?;
    // state(t) on the host: what the joined devices draw, sent every frame; state() on a joined device: the newest, and
    // how many seconds old it is
    let s = shared.clone();
    net.set(
        "state",
        lua.create_function(move |lua, data: Option<Value>| {
            let mut sh = s.borrow_mut();
            match data {
                Some(v) if !v.is_nil() => {
                    if sh.players.net.role() != Role::Hosting {
                        return Err(lua_err(
                            "nova.net.state(t) is for the host; a joined device reads nova.net.state()",
                        ));
                    }
                    let json: serde_json::Value = lua.from_value(v).map_err(|e| {
                        lua_err(format!(
                            "nova.net.state: this cannot be sent ({e}); use numbers, strings, booleans and tables of those"
                        ))
                    })?;
                    sh.players.net.set_state(json).map_err(lua_err)?;
                    Ok((Value::Nil, Value::Nil))
                }
                _ => match sh.players.net.state() {
                    Some((v, age)) => Ok((lua.to_value(v)?, Value::Number(f64::from(age)))),
                    None => Ok((Value::Nil, Value::Nil)),
                },
            }
        })?,
    )?;
    nova.set("net", net)?;
    Ok(())
}

/// `name` and `port` options shared by host, find and join.
fn apply_common(sh: &mut Shared, opts: &Option<Table>) -> mlua::Result<()> {
    if let Some(n) = string_option(opts, "name")? {
        sh.players.net.set_name(&n);
    }
    if sh.players.net.name().is_empty() {
        let n = crate::net::device_name();
        sh.players.net.set_name(&n);
    }
    if let Some(port) = number_option(opts, "port")? {
        if port.fract() != 0.0 || !(1024.0..=65535.0).contains(&port) {
            return Err(lua_err(format!(
                "port must be a whole number from 1024 to 65535, not {port}"
            )));
        }
        sh.players.net.set_port(port as u16);
    }
    Ok(())
}
