//! Players: which controller is player 1, 2, 3 or 4, the actions as each player feels them, the names of the buttons for
//! prompts, and the player's own controls kept between runs.
//!
//! **Seats.** Each connected pad is given a seat (a player number) the first time it is seen and keeps it while it stays
//! connected. A pad that goes away leaves its seat empty but reserved: when the same pad comes back (the same device, or
//! one with the same name) it sits down again. A new pad takes the lowest empty seat, and only when every seat is taken
//! does it take over a reserved one. Seat 1 is always this device's own player: it has the keyboard, the mouse and
//! touch, and a pad that is not one particular controller (`adb shell input`). Players on another device (local co-op over
//! wifi, `net.rs`) are seated the same way, from seat 2 up.
//!
//! **Actions.** `nova.input.down("jump")` reads every source (any pad, every key: what a one-player game wants);
//! `nova.input.down("jump", 2)` reads the same binding as player 2 feels it: `pad:south` means player 2's pad, and keys
//! only count for player 1, unless the game bound the action for player 2 alone (`nova.input.bind("jump", {...}, 2)`).

use std::collections::{BTreeMap, HashMap};

use serde_json::{Value, json};

use crate::actions::{ActionStates, Binding, Bindings, Sources, parse_binding};
use crate::input::PadState;

/// How many players a game can tell apart.
pub const MAX_PLAYERS: u8 = 4;

/// Who sits in a seat.
#[derive(Clone, Debug, PartialEq)]
pub enum Owner {
    /// A pad on this device, by its key (`PadState::key`).
    Pad(String),
    /// A player on another device, by the id that device chose when it joined.
    Remote(u64),
}

#[derive(Clone, Debug, PartialEq)]
pub struct Seat {
    pub owner: Owner,
    pub name: String,
    pub connected: bool,
    /// It can shake (a pad with a motor, or a remote player whose device has one).
    pub rumble: bool,
}

/// Something that happened to a seat, for `nova.input.player_events()`.
#[derive(Clone, Debug, PartialEq)]
pub struct SeatEvent {
    pub player: u8,
    /// "joined" (a new pad or player sat down), "left" (it went away; the seat is kept) or "back" (it came back).
    pub kind: &'static str,
    pub name: String,
}

#[derive(Default, Debug)]
pub struct Seats {
    seats: [Option<Seat>; MAX_PLAYERS as usize],
    events: Vec<SeatEvent>,
}

impl Seats {
    pub fn get(&self, player: u8) -> Option<&Seat> {
        self.seats
            .get(usize::from(player).wrapping_sub(1))
            .and_then(Option::as_ref)
    }

    /// The seat of an owner, connected or not.
    pub fn seat_of(&self, owner: &Owner) -> Option<u8> {
        self.seats
            .iter()
            .position(|s| s.as_ref().is_some_and(|s| &s.owner == owner))
            .map(|i| i as u8 + 1)
    }

    /// The seated players, lowest first.
    pub fn all(&self) -> impl Iterator<Item = (u8, &Seat)> {
        self.seats
            .iter()
            .enumerate()
            .filter_map(|(i, s)| s.as_ref().map(|s| (i as u8 + 1, s)))
    }

    pub fn take_events(&mut self) -> Vec<SeatEvent> {
        std::mem::take(&mut self.events)
    }

    /// Seats an owner who arrived (or is still here): the seat it had, then a reserved seat of a pad with the same name,
    /// then the lowest empty seat from `lowest`, then the lowest reserved seat. None when every seat is in use.
    fn sit(&mut self, owner: Owner, name: &str, rumble: bool, lowest: u8) -> Option<u8> {
        let from = usize::from(lowest.max(1)) - 1;
        let free = |s: &Option<Seat>| s.as_ref().is_none_or(|s| !s.connected);
        let index = self
            .seats
            .iter()
            .position(|s| s.as_ref().is_some_and(|s| s.owner == owner))
            .or_else(|| {
                matches!(owner, Owner::Pad(_))
                    .then(|| {
                        self.seats.iter().enumerate().skip(from).position(|(_, s)| {
                            s.as_ref().is_some_and(|s| {
                                !s.connected && s.name == name && matches!(s.owner, Owner::Pad(_))
                            })
                        })
                    })
                    .flatten()
                    .map(|i| i + from)
            })
            .or_else(|| (from..self.seats.len()).find(|i| self.seats[*i].is_none()))
            .or_else(|| (from..self.seats.len()).find(|i| free(&self.seats[*i])))?;
        let player = index as u8 + 1;
        let kind = match &self.seats[index] {
            Some(s) if s.connected && s.owner == owner => None,
            Some(s) if s.owner == owner || (s.name == name && !s.connected) => Some("back"),
            _ => Some("joined"),
        };
        if let Some(kind) = kind {
            self.events.push(SeatEvent {
                player,
                kind,
                name: name.to_string(),
            });
        }
        self.seats[index] = Some(Seat {
            owner,
            name: name.to_string(),
            connected: true,
            rumble,
        });
        Some(player)
    }

    fn leave(&mut self, index: usize) {
        if let Some(s) = self.seats[index].as_mut()
            && s.connected
        {
            s.connected = false;
            self.events.push(SeatEvent {
                player: index as u8 + 1,
                kind: "left",
                name: s.name.clone(),
            });
        }
    }

    /// Seats this frame's pads; pads that are gone leave their seats (reserved). Returns each pad's player (None for a pad
    /// with no seat: a fifth pad). A pad with an empty key is player 1's and takes no seat.
    pub fn seat_pads(&mut self, pads: &[PadState]) -> Vec<Option<u8>> {
        for i in 0..self.seats.len() {
            if let Some(Seat {
                owner: Owner::Pad(key),
                connected: true,
                ..
            }) = &self.seats[i]
                && !pads.iter().any(|p| &p.key == key)
            {
                self.leave(i);
            }
        }
        pads.iter()
            .map(|p| {
                if p.key.is_empty() {
                    return Some(1);
                }
                self.sit(Owner::Pad(p.key.clone()), &p.name, p.rumble, 1)
            })
            .collect()
    }

    /// Seats a player from another device (from seat 2: seat 1 is this device's). None when the game is full.
    pub fn seat_remote(&mut self, id: u64, name: &str, rumble: bool) -> Option<u8> {
        self.sit(Owner::Remote(id), name, rumble, 2)
    }

    /// A player on another device went away (its seat is kept for it).
    pub fn unseat_remote(&mut self, id: u64) {
        if let Some(p) = self.seat_of(&Owner::Remote(id)) {
            self.leave(usize::from(p) - 1);
        }
    }

    /// Lets go of every remote player's seat entirely (the game stopped hosting).
    pub fn forget_remotes(&mut self) {
        for i in 0..self.seats.len() {
            if matches!(
                self.seats[i].as_ref().map(|s| &s.owner),
                Some(Owner::Remote(_))
            ) {
                self.leave(i);
                self.seats[i] = None;
            }
        }
    }
}

/// The actions for anyone (index 0) and for each player (1 to `MAX_PLAYERS`).
#[derive(Default)]
pub struct PlayerStates {
    states: [ActionStates; MAX_PLAYERS as usize + 1],
}

impl PlayerStates {
    /// A player's actions (0 is anyone).
    pub fn player(&self, player: u8) -> &ActionStates {
        &self.states[usize::from(player.min(MAX_PLAYERS))]
    }

    pub fn player_mut(&mut self, player: u8) -> &mut ActionStates {
        &mut self.states[usize::from(player.min(MAX_PLAYERS))]
    }

    /// Re-evaluates every player's actions from this frame's sources. `remote` holds the players whose input comes
    /// from another device (their states are set by the network, see `ActionStates::update_remote`, and are left alone
    /// here); their actions count for "anyone" too.
    pub fn update(
        &mut self,
        bindings: &Bindings,
        own: &[BTreeMap<String, Binding>],
        sources: &Sources,
        overrides: &[(String, f32)],
        remote: &[u8],
    ) {
        self.states[0].update(bindings, sources, overrides);
        let empty = BTreeMap::new();
        for p in 1..=MAX_PLAYERS {
            if remote.contains(&p) {
                continue;
            }
            let own = own.get(usize::from(p)).unwrap_or(&empty);
            self.states[usize::from(p)].update_player(bindings, own, sources, p, p == 1);
        }
        for p in remote {
            let (any, rest) = self.states.split_at_mut(1);
            any[0].absorb(&rest[usize::from(*p) - 1], bindings);
        }
    }

    /// Call at the start of each game step (see `ActionStates::begin_step`).
    pub fn begin_step(&mut self) {
        for s in &mut self.states {
            s.begin_step();
        }
    }

    // The any-player actions, as `ActionStates` has them.
    pub fn value(&self, name: &str) -> f32 {
        self.states[0].value(name)
    }
    pub fn is_down(&self, name: &str) -> bool {
        self.states[0].is_down(name)
    }
    pub fn was_pressed(&self, name: &str) -> bool {
        self.states[0].was_pressed(name)
    }
    pub fn was_released(&self, name: &str) -> bool {
        self.states[0].was_released(name)
    }
}

/// A button's name as a Nintendo-style pad prints it, and a short icon name for a prompt picture. The names follow the letters
/// engraved on the pad, which is what Android reports (`pad:south` is the button marked A, `east` B, `west` X, `north` Y: **read
/// off a Retroid Pocket 6 with the Input Test app, 2026-11-12**; a Nintendo pad has the same letters in other places, which does not
/// matter for a prompt). The icon names
/// match Kenney's Input Prompts (Nintendo Switch set) without their `switch_` prefix, so `"switch_" .. icon` finds the
/// picture. Keys are named as on the keyboard.
pub fn glyph(source: &str) -> Option<(String, String)> {
    let (kind, name) = source.split_once(':')?;
    let kind = kind.trim_end_matches(|c: char| c.is_ascii_digit());
    let pair = |label: &str, icon: &str| Some((label.to_string(), icon.to_string()));
    match kind {
        "pad" => match name {
            "south" => pair("A", "button_a"),
            "east" => pair("B", "button_b"),
            "west" => pair("X", "button_x"),
            "north" => pair("Y", "button_y"),
            "l1" => pair("L", "button_l"),
            "r1" => pair("R", "button_r"),
            "l2" => pair("ZL", "button_zl"),
            "r2" => pair("ZR", "button_zr"),
            "start" => pair("+", "button_plus"),
            "select" => pair("−", "button_minus"),
            "thumb_l" => pair("L stick (press)", "stick_l_press"),
            "thumb_r" => pair("R stick (press)", "stick_r_press"),
            "dpad_up" => pair("Up", "dpad_up"),
            "dpad_down" => pair("Down", "dpad_down"),
            "dpad_left" => pair("Left", "dpad_left"),
            "dpad_right" => pair("Right", "dpad_right"),
            _ => None,
        },
        "axis" => {
            let base = name.trim_end_matches(['+', '-']);
            let dir = &name[base.len()..];
            match (base, dir) {
                ("left_x", "-") => pair("L stick left", "stick_l_left"),
                ("left_x", "+") => pair("L stick right", "stick_l_right"),
                ("left_y", "-") => pair("L stick up", "stick_l_up"),
                ("left_y", "+") => pair("L stick down", "stick_l_down"),
                ("left_x" | "left_y", _) => pair("L stick", "stick_l"),
                ("right_x", "-") => pair("R stick left", "stick_r_left"),
                ("right_x", "+") => pair("R stick right", "stick_r_right"),
                ("right_y", "-") => pair("R stick up", "stick_r_up"),
                ("right_y", "+") => pair("R stick down", "stick_r_down"),
                ("right_x" | "right_y", _) => pair("R stick", "stick_r"),
                ("l2", _) => pair("ZL", "button_zl"),
                ("r2", _) => pair("ZR", "button_zr"),
                _ => None,
            }
        }
        "key" => {
            let label = name
                .strip_prefix("Key")
                .or_else(|| name.strip_prefix("Digit"))
                .map(str::to_string)
                .unwrap_or_else(|| match name {
                    "ArrowUp" => "Up".into(),
                    "ArrowDown" => "Down".into(),
                    "ArrowLeft" => "Left".into(),
                    "ArrowRight" => "Right".into(),
                    "Escape" => "Esc".into(),
                    "ShiftLeft" | "ShiftRight" => "Shift".into(),
                    "ControlLeft" | "ControlRight" => "Ctrl".into(),
                    "AltLeft" | "AltRight" => "Alt".into(),
                    other => other.to_string(),
                });
            Some((label, format!("key_{}", name.to_ascii_lowercase())))
        }
        "mouse" => Some((format!("Mouse {name}"), format!("mouse_{name}"))),
        _ => None,
    }
}

/// The source a prompt for an action should show: its first gamepad source (a button before a stick), else its first
/// source. For an axis, the positive side's.
pub fn prompt_source(binding: &Binding, pad: bool) -> Option<String> {
    let ids = match binding {
        Binding::Button(_) => binding.source_ids(),
        Binding::Axis { positive, .. } => positive.iter().map(crate::actions::Source::id).collect(),
    };
    let is_pad = |id: &&String| id.starts_with("pad") || id.starts_with("axis");
    let first = |pred: &dyn Fn(&&String) -> bool| ids.iter().find(|i| pred(i)).cloned();
    if pad {
        first(&|i| i.starts_with("pad"))
            .or_else(|| first(&is_pad))
            .or_else(|| ids.first().cloned())
    } else {
        first(&|i| !is_pad(i)).or_else(|| ids.first().cloned())
    }
}

/// The controls a player chose, as the save keeps them (`controls` beside `save.json`): only the actions that differ from
/// the game's own bindings, for everyone and for each player.
pub fn controls_to_json(
    base: &Bindings,
    shared: &Bindings,
    own: &[BTreeMap<String, Binding>],
) -> Value {
    let mut all = serde_json::Map::new();
    for (name, binding) in shared.iter() {
        if base.get(name) != Some(binding) {
            all.insert(name.to_string(), binding.to_json());
        }
    }
    let mut players = serde_json::Map::new();
    for (p, map) in own.iter().enumerate().skip(1) {
        if map.is_empty() {
            continue;
        }
        let m: serde_json::Map<String, Value> =
            map.iter().map(|(k, b)| (k.clone(), b.to_json())).collect();
        players.insert(p.to_string(), Value::Object(m));
    }
    json!({ "format": 1, "all": all, "players": players })
}

/// Reads saved controls back onto the game's bindings. An action the game no longer has, or a binding that no longer
/// reads, is skipped (and named in the returned warnings) rather than stopping the game.
pub fn controls_from_json(
    value: &Value,
    shared: &mut Bindings,
    own: &mut [BTreeMap<String, Binding>],
) -> Vec<String> {
    fn apply(
        map: &serde_json::Map<String, Value>,
        player: Option<usize>,
        shared: &mut Bindings,
        own: &mut [BTreeMap<String, Binding>],
        warnings: &mut Vec<String>,
    ) {
        for (name, v) in map {
            if shared.get(name).is_none() {
                warnings.push(format!(
                    "saved controls: the game has no action '{name}' now"
                ));
                continue;
            }
            match parse_binding(v, &format!("saved controls.{name}")) {
                Ok(b) => match player {
                    None => {
                        let _ = shared.set(name, b);
                    }
                    Some(p) => {
                        if let Some(m) = own.get_mut(p) {
                            m.insert(name.clone(), b);
                        }
                    }
                },
                Err(e) => warnings.push(e),
            }
        }
    }
    let mut warnings = Vec::new();
    if let Some(all) = value.get("all").and_then(Value::as_object) {
        apply(all, None, shared, own, &mut warnings);
    }
    if let Some(players) = value.get("players").and_then(Value::as_object) {
        for (p, map) in players {
            match (p.parse::<usize>(), map.as_object()) {
                (Ok(p), Some(map)) if (1..=usize::from(MAX_PLAYERS)).contains(&p) => {
                    apply(map, Some(p), shared, own, &mut warnings)
                }
                _ => warnings.push(format!("saved controls: '{p}' is not a player")),
            }
        }
    }
    warnings
}

/// The numbered sources for every seated pad (`pad2:south`), added to this frame's sources.
pub fn add_seated_sources(pads: &[PadState], seats: &[Option<u8>], sources: &mut Sources) {
    for (pad, seat) in pads.iter().zip(seats) {
        if let Some(p) = seat {
            crate::input::seated_pad_sources(*p, &pad.snap, sources);
        }
    }
}

/// Which player pressed a pad's source, from the pad's key (None for a key or a pad without a seat).
pub fn player_of_pad(pads: &[PadState], seats: &[Option<u8>], key: &str) -> Option<u8> {
    pads.iter()
        .zip(seats)
        .find(|(p, _)| p.key == key)
        .and_then(|(_, s)| *s)
}

/// Values of remote players' actions as they arrive over the network.
pub type RemoteValues = HashMap<String, f32>;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::actions::Source;
    use crate::input::PadSnapshot;

    fn pad(key: &str, name: &str, buttons: Vec<&'static str>) -> PadState {
        PadState {
            key: key.into(),
            name: name.into(),
            rumble: true,
            snap: PadSnapshot {
                buttons,
                axes: vec![],
            },
        }
    }

    #[test]
    fn pads_keep_their_seats_and_get_them_back() {
        let mut seats = Seats::default();
        let a = pad("a", "Retroid Pocket Controller", vec![]);
        let b = pad("b", "8BitDo", vec![]);
        assert_eq!(seats.seat_pads(&[a.clone(), b.clone()]), [Some(1), Some(2)]);
        let ev = seats.take_events();
        assert_eq!(ev.len(), 2);
        assert_eq!((ev[1].player, ev[1].kind), (2, "joined"));
        // the first pad goes away: the second stays player 2, seat 1 is kept for the first
        assert_eq!(seats.seat_pads(std::slice::from_ref(&b)), [Some(2)]);
        assert_eq!(seats.take_events()[0].kind, "left");
        assert!(!seats.get(1).unwrap().connected);
        // it comes back (plugged in after the second, so it is listed second): player 1 again
        assert_eq!(seats.seat_pads(&[b.clone(), a.clone()]), [Some(2), Some(1)]);
        assert_eq!(seats.take_events()[0].kind, "back");
        // nothing happened: no events
        seats.seat_pads(&[b.clone(), a.clone()]);
        assert!(seats.take_events().is_empty());
    }

    #[test]
    fn a_pad_back_with_a_new_id_finds_its_seat_by_name_and_new_pads_fill_empty_seats_first() {
        let mut seats = Seats::default();
        let a = pad("gilrs:0", "Pad A", vec![]);
        let b = pad("gilrs:1", "Pad B", vec![]);
        seats.seat_pads(&[a.clone(), b.clone()]);
        seats.seat_pads(std::slice::from_ref(&a)); // B leaves
        // B comes back under another id: the reserved seat 2 by its name
        let b2 = pad("gilrs:7", "Pad B", vec![]);
        assert_eq!(
            seats.seat_pads(&[a.clone(), b2.clone()]),
            [Some(1), Some(2)]
        );
        // a third, new pad takes seat 3 (empty), not a reserved one
        seats.seat_pads(std::slice::from_ref(&a)); // B leaves again: seat 2 reserved
        let c = pad("gilrs:9", "Pad C", vec![]);
        assert_eq!(seats.seat_pads(&[a.clone(), c.clone()]), [Some(1), Some(3)]);
        // when every seat is taken or reserved, a new pad takes over the lowest reserved seat
        let d = pad("gilrs:10", "Pad D", vec![]);
        let e = pad("gilrs:11", "Pad E", vec![]);
        assert_eq!(
            seats.seat_pads(&[a.clone(), c.clone(), d.clone(), e.clone()]),
            [Some(1), Some(3), Some(4), Some(2)]
        );
        // a fifth connected pad has no seat
        let f = pad("gilrs:12", "Pad F", vec![]);
        assert_eq!(seats.seat_pads(&[a, c, d, e, f])[4], None);
    }

    #[test]
    fn remote_players_sit_from_seat_two_and_keep_it_across_a_drop() {
        let mut seats = Seats::default();
        // no pad on this device yet: seat 1 is still this device's
        assert_eq!(seats.seat_remote(77, "Arya's Retroid", true), Some(2));
        let a = pad("a", "Pad", vec![]);
        assert_eq!(seats.seat_pads(std::slice::from_ref(&a)), [Some(1)]);
        let b = pad("b", "Pad 2", vec![]);
        assert_eq!(seats.seat_pads(&[a.clone(), b.clone()]), [Some(1), Some(3)]);
        seats.unseat_remote(77);
        let ev = seats.take_events();
        assert!(ev.iter().any(|e| e.player == 2 && e.kind == "left"));
        assert_eq!(seats.seat_remote(77, "Arya's Retroid", true), Some(2));
        assert_eq!(seats.take_events()[0].kind, "back");
        seats.forget_remotes();
        assert!(seats.get(2).is_none());
    }

    fn held(list: &[(&str, f32)]) -> Sources {
        list.iter().map(|(k, v)| (k.to_string(), *v)).collect()
    }

    #[test]
    fn each_player_reads_their_own_pad_and_keys_are_player_ones() {
        let bindings = Bindings::defaults();
        let mut st = PlayerStates::default();
        let own = vec![BTreeMap::new(); 5];
        // player 2's pad holds south (and the any-pad source says so too); the keyboard holds D
        let s = held(&[("pad:south", 1.0), ("pad2:south", 1.0), ("key:KeyD", 1.0)]);
        st.update(&bindings, &own, &s, &[], &[]);
        assert!(st.is_down("a"), "anyone: the any-pad source");
        assert!(st.player(2).is_down("a"), "player 2's own pad");
        assert!(!st.player(1).is_down("a"), "not player 1's");
        assert!(st.player(1).is_down("right"), "keys are player 1's");
        assert!(!st.player(2).is_down("right"));
        assert_eq!(st.player(1).value("move_x"), 1.0);
        // a stick: player 1's stick moves player 1 only
        let s = held(&[("axis:left_x", -1.0), ("axis1:left_x", -1.0)]);
        st.update(&bindings, &own, &s, &[], &[]);
        assert!(st.player(1).value("move_x") < -0.99);
        assert_eq!(st.player(2).value("move_x"), 0.0);
        assert!(st.value("move_x") < -0.99);
    }

    #[test]
    fn an_action_bound_for_one_player_reads_their_keys_and_their_pad() {
        let bindings = Bindings::defaults();
        let mut own = vec![BTreeMap::new(); 5];
        own[2].insert(
            "a".to_string(),
            Binding::Button(vec![
                Source::parse("key:KeyK").unwrap(),
                Source::parse("pad:east").unwrap(),
            ]),
        );
        let mut st = PlayerStates::default();
        st.update(&bindings, &own, &held(&[("key:KeyK", 1.0)]), &[], &[]);
        assert!(st.player(2).is_down("a"), "player 2's own key");
        assert!(!st.player(1).is_down("a"));
        st.update(
            &bindings,
            &own,
            &held(&[("pad:east", 1.0), ("pad2:east", 1.0)]),
            &[],
            &[],
        );
        assert!(st.player(2).is_down("a"), "east on player 2's pad");
        st.update(
            &bindings,
            &own,
            &held(&[("pad:south", 1.0), ("pad2:south", 1.0)]),
            &[],
            &[],
        );
        assert!(
            !st.player(2).is_down("a"),
            "south no longer jumps for player 2"
        );
        assert!(st.is_down("a"), "but anyone's binding is unchanged");
    }

    #[test]
    fn a_remote_players_values_and_counted_taps_arrive_as_their_actions_and_anyones() {
        let bindings = Bindings::defaults();
        let own = vec![BTreeMap::new(); 5];
        let mut st = PlayerStates::default();
        let mut values = RemoteValues::new();
        values.insert("move_x".into(), 0.5);
        let mut presses = HashMap::new();
        presses.insert("a".to_string(), 1u32);
        st.player_mut(2)
            .update_remote(&bindings, &values, &presses, &HashMap::new());
        st.update(&bindings, &own, &held(&[]), &[], &[2]);
        st.begin_step();
        assert_eq!(st.player(2).value("move_x"), 0.5);
        // the tap's packet with "a" held was lost, but the count went up: it is a press
        assert!(st.player(2).was_pressed("a"));
        assert!(st.was_pressed("a"), "anyone sees a remote player's press");
        assert_eq!(st.value("move_x"), 0.5);
        // the same count again is not another press
        st.player_mut(2)
            .update_remote(&bindings, &values, &presses, &HashMap::new());
        st.update(&bindings, &own, &held(&[]), &[], &[2]);
        st.begin_step();
        assert!(!st.player(2).was_pressed("a"));
    }

    #[test]
    fn glyphs_use_nintendo_labels_by_position() {
        assert_eq!(glyph("pad:south").unwrap().0, "A");
        assert_eq!(glyph("pad2:east").unwrap(), ("B".into(), "button_b".into()));
        assert_eq!(glyph("pad:west").unwrap().0, "X");
        assert_eq!(glyph("pad:north").unwrap().0, "Y");
        assert_eq!(glyph("pad:r2").unwrap().0, "ZR");
        assert_eq!(glyph("axis:left_x-").unwrap().0, "L stick left");
        assert_eq!(glyph("axis3:r2").unwrap().1, "button_zr");
        assert_eq!(glyph("key:KeyZ").unwrap().0, "Z");
        assert_eq!(glyph("key:ArrowLeft").unwrap().0, "Left");
        assert_eq!(glyph("nonsense"), None);
        let b = Bindings::defaults();
        assert_eq!(
            prompt_source(b.get("a").unwrap(), true).as_deref(),
            Some("pad:south")
        );
        assert_eq!(
            prompt_source(b.get("a").unwrap(), false).as_deref(),
            Some("key:KeyZ")
        );
        assert_eq!(
            prompt_source(b.get("move_x").unwrap(), true).as_deref(),
            Some("pad:dpad_right")
        );
    }

    #[test]
    fn chosen_controls_save_only_what_changed_and_read_back() {
        let base = Bindings::defaults();
        let mut shared = base.clone();
        shared
            .set(
                "a",
                Binding::Button(vec![Source::parse("pad:east").unwrap()]),
            )
            .unwrap();
        let mut own = vec![BTreeMap::new(); 5];
        own[2].insert(
            "b".into(),
            Binding::Button(vec![Source::parse("key:KeyL").unwrap()]),
        );
        let saved = controls_to_json(&base, &shared, &own);
        assert_eq!(
            saved["all"].as_object().unwrap().len(),
            1,
            "only `a` changed"
        );
        assert_eq!(saved["all"]["a"], json!(["pad:east"]));
        assert_eq!(saved["players"]["2"]["b"], json!(["key:KeyL"]));
        // read back onto fresh bindings
        let mut again = base.clone();
        let mut own2 = vec![BTreeMap::new(); 5];
        let text = serde_json::to_string(&saved).unwrap();
        let warnings =
            controls_from_json(&serde_json::from_str(&text).unwrap(), &mut again, &mut own2);
        assert!(warnings.is_empty(), "{warnings:?}");
        assert_eq!(again.get("a"), shared.get("a"));
        assert_eq!(own2[2], own[2]);
        // an action the game dropped, a bad source and a bad player are skipped with a warning
        let odd =
            json!({ "all": { "gone": ["key:KeyA"], "b": ["key:Nope"] }, "players": { "9": {} } });
        let w = controls_from_json(&odd, &mut again, &mut own2);
        assert_eq!(w.len(), 3, "{w:?}");
        assert_eq!(again.get("b"), base.get("b"));
    }
}
