//! Local co-op over wifi: one device hosts the game, others on the same network find it and join. Local play only: no
//! internet servers, no accounts; everything is UDP between devices on one network (see `docs/local-coop.md`).
//!
//! **The model.** The host runs the game. A joined device sends its player's actions every frame (the values and how many
//! times each went down, so a tap whose packet was lost still arrives) and draws what the host sends back: a small state
//! table the host's script sets every frame (`nova.net.state(t)`), newest wins. On the host, a joined player's actions are
//! another player's (`nova.input.down("jump", 2)`), seated like a pad (`players.rs`). Messages the game sends on purpose
//! (`nova.net.send`) are reliable and arrive in order. A device that has not been heard from for [`DROP_AFTER`] is gone.
//!
//! **Finding a game.** A device looking for games sends a "find" packet to the network's broadcast address (and to this
//! computer, for two copies of a game on one machine) on [`PORT`]; a host of the same game answers with its name. Android
//! drops broadcast packets unless the app holds a multicast lock, which the host takes (`android_input::multicast_lock`).
//!
//! Every packet is `NOVN`, a version byte and a JSON body: small and easy to read in a packet capture, and the game's
//! tables are JSON already.

use std::collections::{BTreeMap, HashMap};
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4, UdpSocket};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::actions::ActionStates;
use crate::players::Seats;

/// The UDP port a host listens on (and answers "find" packets on).
pub const PORT: u16 = 47809;
const MAGIC: &[u8; 4] = b"NOVN";
const VERSION: u8 = 1;
/// A device that has not been heard from for this long has gone.
pub const DROP_AFTER: Duration = Duration::from_secs(3);
/// How long a join may take before it gives up.
const JOIN_TIMEOUT: Duration = Duration::from_secs(5);
/// How often a looking device asks again, and how long a game it found stays listed without an answer.
const FIND_EVERY: Duration = Duration::from_millis(500);
const FOUND_FOR: Duration = Duration::from_millis(2500);
const PING_EVERY: Duration = Duration::from_millis(500);
const RESEND_AFTER: Duration = Duration::from_millis(150);
/// The biggest packet sent: the state table and a message must fit in it.
pub const MAX_PACKET: usize = 32 * 1024;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum Packet {
    Find {
        game: String,
    },
    Here {
        game: String,
        /// The host's own id: a host that answers from two addresses (this computer's and its wifi's) is one game.
        id: u64,
        name: String,
        players: u8,
        max: u8,
    },
    Hello {
        game: String,
        id: u64,
        name: String,
        rumble: bool,
    },
    Welcome {
        player: u8,
        host: String,
    },
    Refused {
        reason: String,
    },
    Input {
        seq: u32,
        values: HashMap<String, f32>,
        presses: HashMap<String, u32>,
        releases: HashMap<String, u32>,
    },
    State {
        seq: u32,
        data: Value,
    },
    Reliable {
        n: u32,
        msg: Msg,
    },
    Ack {
        n: u32,
    },
    Ping {
        t: f64,
    },
    Pong {
        t: f64,
    },
    Bye,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "k", rename_all = "snake_case")]
enum Msg {
    /// A message from the game (`nova.net.send`): to the host from a joined player, or from the host to players.
    Game { name: String, data: Value, from: u8 },
    /// Who is in the game, sent by the host when it changes.
    Roster { players: Vec<RosterEntry> },
    /// Shake the joined player's controller.
    Rumble {
        strong: f32,
        weak: f32,
        seconds: f32,
    },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct RosterEntry {
    pub player: u8,
    pub name: String,
}

fn encode(p: &Packet) -> Vec<u8> {
    let mut out = MAGIC.to_vec();
    out.push(VERSION);
    out.extend(serde_json::to_vec(p).unwrap_or_default());
    out
}

fn decode(bytes: &[u8]) -> Option<Packet> {
    let body = bytes.strip_prefix(MAGIC.as_slice())?;
    let (version, body) = body.split_first()?;
    if *version != VERSION {
        return None;
    }
    serde_json::from_slice(body).ok()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    Off,
    Hosting,
    Finding,
    Joining,
    Joined,
    /// The connection to the host was lost (or the host stopped); `status()` says why.
    Lost,
}

impl Role {
    pub fn word(self) -> &'static str {
        match self {
            Role::Off => "off",
            Role::Hosting => "hosting",
            Role::Finding => "finding",
            Role::Joining => "joining",
            Role::Joined => "joined",
            Role::Lost => "lost",
        }
    }
}

/// A game found on the network.
#[derive(Clone, Debug, PartialEq)]
pub struct Found {
    pub addr: SocketAddr,
    host: u64,
    pub name: String,
    pub players: u8,
    pub max: u8,
    seen: Instant,
}

impl Found {
    /// The id `nova.net.join` takes: the host's address.
    pub fn id(&self) -> String {
        self.addr.to_string()
    }
}

/// Something that happened to the connection, for `nova.net.events()`.
#[derive(Clone, Debug, PartialEq)]
pub struct NetEvent {
    /// "joined" and "left" (a player, on the host; also seen by joined devices through the roster), "connected" (this
    /// device joined), "lost" (this device lost the host).
    pub kind: &'static str,
    pub player: u8,
    pub name: String,
}

/// A message the game sent.
#[derive(Clone, Debug, PartialEq)]
pub struct Incoming {
    pub from: u8,
    pub name: String,
    pub data: Value,
}

struct Peer {
    addr: SocketAddr,
    id: u64,
    name: String,
    player: u8,
    heard: Instant,
    pinged: Instant,
    rtt_ms: f32,
    /// Reliable messages not yet acknowledged: number, message, when last sent.
    unacked: Vec<(u32, Msg, Option<Instant>)>,
    next_out: u32,
    next_in: u32,
    early: BTreeMap<u32, Msg>,
    /// The newest input the peer sent (on the host).
    input_seq: u32,
    values: HashMap<String, f32>,
    presses: HashMap<String, u32>,
    releases: HashMap<String, u32>,
}

impl Peer {
    fn new(addr: SocketAddr, id: u64, name: String, player: u8) -> Self {
        let now = Instant::now();
        Self {
            addr,
            id,
            name,
            player,
            heard: now,
            pinged: now,
            rtt_ms: 0.0,
            unacked: Vec::new(),
            next_out: 1,
            next_in: 1,
            early: BTreeMap::new(),
            input_seq: 0,
            values: HashMap::new(),
            presses: HashMap::new(),
            releases: HashMap::new(),
        }
    }

    fn queue(&mut self, msg: Msg) {
        self.unacked.push((self.next_out, msg, None));
        self.next_out += 1;
    }

    /// A reliable message arrived: the ones now in order, oldest first.
    fn receive(&mut self, n: u32, msg: Msg) -> Vec<Msg> {
        if n >= self.next_in {
            self.early.insert(n, msg);
        }
        let mut ready = Vec::new();
        while let Some(m) = self.early.remove(&self.next_in) {
            ready.push(m);
            self.next_in += 1;
        }
        ready
    }
}

/// A player in the game as this device knows it.
#[derive(Clone, Debug, PartialEq)]
pub struct NetPlayer {
    pub player: u8,
    pub name: String,
    pub me: bool,
    pub host: bool,
    /// The time a packet takes there and back, in milliseconds (0 for this device).
    pub ping_ms: f32,
}

pub struct Net {
    socket: Option<UdpSocket>,
    role: Role,
    status: String,
    /// The game's id: only devices playing the same game see each other.
    game: String,
    name: String,
    port: u16,
    id: u64,
    max_players: u8,
    started: Instant,
    // looking for games
    found: Vec<Found>,
    asked: Option<Instant>,
    // joining and joined: the host is the one peer
    host: Option<Peer>,
    join_started: Instant,
    me: u8,
    roster: Vec<RosterEntry>,
    // hosting
    peers: Vec<Peer>,
    /// Ids that joined this game and dropped, with their player, so that they can come back to the same seat.
    state_out: Option<Value>,
    state_seq: u32,
    state_in: Option<(Value, Instant)>,
    state_in_seq: u32,
    input_seq: u32,
    inbox: Vec<Incoming>,
    events: Vec<NetEvent>,
    rumble_in: Vec<(f32, f32, f32)>,
}

/// A number no other device is likely to pick: the clock and this process, mixed.
fn random_id() -> u64 {
    // The clock alone is not enough: macOS gives it in microseconds, and two connections made in one microsecond (two
    // games in one test) would share an id, so that a host took the second for the first asking again. A count of the
    // ids this process has made keeps them apart; the clock and the process keep different devices apart.
    static MADE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let n = MADE.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let t = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos() as u64);
    let mut x = t
        ^ (u64::from(std::process::id()) << 32)
        ^ n.wrapping_mul(0xd6e8_feb8_6659_fd93)
        ^ 0x9e37_79b9_7f4a_7c15;
    // splitmix64
    x = (x ^ (x >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    x = (x ^ (x >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    x ^ (x >> 31)
}

impl Net {
    /// A connection that is off, for the game `game` (its id), calling this device `name`.
    pub fn new(game: &str, name: &str) -> Self {
        Self {
            socket: None,
            role: Role::Off,
            status: String::new(),
            game: game.to_string(),
            name: name.to_string(),
            port: PORT,
            id: random_id(),
            max_players: 2,
            started: Instant::now(),
            found: Vec::new(),
            asked: None,
            host: None,
            join_started: Instant::now(),
            me: 1,
            roster: Vec::new(),
            peers: Vec::new(),
            state_out: None,
            state_seq: 0,
            state_in: None,
            state_in_seq: 0,
            input_seq: 0,
            inbox: Vec::new(),
            events: Vec::new(),
            rumble_in: Vec::new(),
        }
    }

    pub fn role(&self) -> Role {
        self.role
    }
    pub fn status(&self) -> &str {
        &self.status
    }
    pub fn name(&self) -> &str {
        &self.name
    }
    pub fn set_name(&mut self, name: &str) {
        self.name = name.to_string();
    }
    pub fn set_port(&mut self, port: u16) {
        self.port = port;
    }
    pub fn is_host(&self) -> bool {
        self.role == Role::Hosting
    }
    /// This device's player number in the game (1 when not joined).
    pub fn me(&self) -> u8 {
        if matches!(self.role, Role::Joined | Role::Lost) {
            self.me
        } else {
            1
        }
    }

    fn now_s(&self) -> f64 {
        self.started.elapsed().as_secs_f64()
    }

    fn send_to(&self, addr: SocketAddr, p: &Packet) {
        if let Some(s) = &self.socket {
            let bytes = encode(p);
            if let Err(e) = s.send_to(&bytes, addr) {
                log::debug!("net: cannot send to {addr}: {e}");
            }
        }
    }

    fn say_goodbye(&self) {
        for p in &self.peers {
            self.send_to(p.addr, &Packet::Bye);
        }
        if let Some(h) = self.host.as_ref().filter(|_| self.role == Role::Joined) {
            self.send_to(h.addr, &Packet::Bye);
        }
    }

    /// Stops whatever it was doing (saying goodbye first: see the `Drop` below, which runs as the old value is replaced).
    pub fn leave(&mut self, seats: &mut Seats) {
        if self.role == Role::Hosting {
            seats.forget_remotes();
        }
        #[cfg(target_os = "android")]
        crate::android_input::multicast_lock(false);
        let mut fresh = Self::new(&self.game, &self.name);
        fresh.port = self.port;
        fresh.id = self.id;
        drop(std::mem::replace(self, fresh));
    }

    /// Starts hosting: other devices can find this game and join, up to `max_players` players in all.
    pub fn host(&mut self, max_players: u8, seats: &mut Seats) -> Result<(), String> {
        self.leave(seats);
        let socket = UdpSocket::bind(SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, self.port))
            .map_err(|e| {
                format!(
                    "cannot host: port {} is in use ({e}); is another copy of the game hosting on this device?",
                    self.port
                )
            })?;
        socket.set_nonblocking(true).map_err(|e| e.to_string())?;
        let _ = socket.set_broadcast(true);
        #[cfg(target_os = "android")]
        crate::android_input::multicast_lock(true);
        self.socket = Some(socket);
        self.max_players = max_players.clamp(2, crate::players::MAX_PLAYERS);
        self.role = Role::Hosting;
        self.status = "Waiting for players".into();
        Ok(())
    }

    /// Looks for games on the network (call every frame while the list is shown; see [`Net::found`]).
    pub fn find(&mut self, seats: &mut Seats) -> Result<(), String> {
        if self.role != Role::Finding {
            self.leave(seats);
            self.open_client_socket()?;
            #[cfg(target_os = "android")]
            crate::android_input::multicast_lock(true);
            self.role = Role::Finding;
            self.status = "Looking for games on this network".into();
        }
        Ok(())
    }

    fn open_client_socket(&mut self) -> Result<(), String> {
        let socket = UdpSocket::bind(SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, 0))
            .map_err(|e| format!("cannot use the network: {e}"))?;
        socket.set_nonblocking(true).map_err(|e| e.to_string())?;
        let _ = socket.set_broadcast(true);
        self.socket = Some(socket);
        Ok(())
    }

    /// The games found so far (each answered in the last few seconds), by name.
    pub fn found(&self) -> Vec<Found> {
        let mut list = self.found.clone();
        list.sort_by(|a, b| a.name.cmp(&b.name).then(a.addr.cmp(&b.addr)));
        list
    }

    /// Joins the game at `id` (a found game's id, or an address such as "192.168.1.20" typed by hand).
    pub fn join(&mut self, id: &str, seats: &mut Seats) -> Result<(), String> {
        let addr: SocketAddr = match id.parse::<SocketAddr>() {
            Ok(a) => a,
            Err(_) => match id.parse::<Ipv4Addr>() {
                Ok(ip) => SocketAddr::V4(SocketAddrV4::new(ip, self.port)),
                Err(_) => {
                    return Err(format!(
                        "'{id}' is not a game to join: use an id from nova.net.find() or an address like 192.168.1.20"
                    ));
                }
            },
        };
        let name = self
            .found
            .iter()
            .find(|f| f.addr == addr)
            .map_or_else(|| addr.ip().to_string(), |f| f.name.clone());
        let socket = if self.role == Role::Finding {
            self.socket.take()
        } else {
            None
        };
        self.leave(seats);
        match socket {
            Some(s) => self.socket = Some(s),
            None => self.open_client_socket()?,
        }
        self.host = Some(Peer::new(addr, 0, name.clone(), 1));
        self.role = Role::Joining;
        self.join_started = Instant::now();
        self.status = format!("Joining {name}");
        self.say_hello();
        Ok(())
    }

    fn say_hello(&self) {
        if let Some(h) = &self.host {
            self.send_to(
                h.addr,
                &Packet::Hello {
                    game: self.game.clone(),
                    id: self.id,
                    name: self.name.clone(),
                    rumble: true,
                },
            );
        }
    }

    fn lose(&mut self, why: String) {
        self.role = Role::Lost;
        self.status = why;
        let name = self
            .host
            .as_ref()
            .map(|h| h.name.clone())
            .unwrap_or_default();
        self.events.push(NetEvent {
            kind: "lost",
            player: 1,
            name,
        });
    }

    /// Reads what arrived and keeps the connection alive: call once a frame before the game's step. On the host, joined
    /// players are seated in `seats` and their actions written into `states` (indexed by player).
    pub fn poll(
        &mut self,
        seats: &mut Seats,
        states: &mut crate::players::PlayerStates,
        bindings: &crate::actions::Bindings,
    ) {
        if self.role == Role::Off {
            return;
        }
        let mut buf = vec![0u8; MAX_PACKET + 64];
        let mut packets = Vec::new();
        if let Some(socket) = &self.socket {
            loop {
                match socket.recv_from(&mut buf) {
                    Ok((n, from)) => {
                        if let Some(p) = decode(&buf[..n]) {
                            packets.push((p, from));
                        }
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => break,
                    // a "port unreachable" from an earlier send (Windows and Linux report it here): carry on
                    Err(e) if e.kind() == std::io::ErrorKind::ConnectionReset => continue,
                    Err(e) => {
                        log::debug!("net: receive: {e}");
                        break;
                    }
                }
            }
        }
        for (p, from) in packets {
            self.handle(p, from, seats);
        }
        let now = Instant::now();
        match self.role {
            Role::Finding => {
                self.found.retain(|f| now - f.seen < FOUND_FOR);
                if self.asked.is_none_or(|t| now - t >= FIND_EVERY) {
                    self.asked = Some(now);
                    let find = Packet::Find {
                        game: self.game.clone(),
                    };
                    for ip in [Ipv4Addr::BROADCAST, Ipv4Addr::LOCALHOST] {
                        self.send_to(SocketAddr::V4(SocketAddrV4::new(ip, self.port)), &find);
                    }
                    if let Some(ip) = subnet_broadcast() {
                        self.send_to(SocketAddr::V4(SocketAddrV4::new(ip, self.port)), &find);
                    }
                }
            }
            Role::Joining => {
                if now - self.join_started > JOIN_TIMEOUT {
                    let name = self
                        .host
                        .as_ref()
                        .map(|h| h.name.clone())
                        .unwrap_or_default();
                    self.lose(format!("{name} did not answer"));
                } else if self
                    .asked
                    .is_none_or(|t| now - t >= Duration::from_millis(250))
                {
                    self.asked = Some(now);
                    self.say_hello();
                }
            }
            Role::Joined => {
                if self
                    .host
                    .as_ref()
                    .is_some_and(|h| now - h.heard > DROP_AFTER)
                {
                    let name = self
                        .host
                        .as_ref()
                        .map(|h| h.name.clone())
                        .unwrap_or_default();
                    self.lose(format!("Lost the connection to {name}"));
                }
            }
            Role::Hosting => {
                let mut gone = Vec::new();
                self.peers.retain(|p| {
                    let alive = now - p.heard <= DROP_AFTER;
                    if !alive {
                        gone.push((p.id, p.player, p.name.clone()));
                    }
                    alive
                });
                for (id, player, name) in gone {
                    seats.unseat_remote(id);
                    self.events.push(NetEvent {
                        kind: "left",
                        player,
                        name,
                    });
                    self.send_roster();
                    // let go of everything the player held
                    states.player_mut(player).update_remote(
                        bindings,
                        &HashMap::new(),
                        &HashMap::new(),
                        &HashMap::new(),
                    );
                }
                for p in &self.peers {
                    states.player_mut(p.player).update_remote(
                        bindings,
                        &p.values,
                        &p.presses,
                        &p.releases,
                    );
                }
                self.update_host_status();
            }
            Role::Off | Role::Lost => {}
        }
    }

    fn update_host_status(&mut self) {
        let n = self.peers.len();
        self.status = match n {
            0 => "Waiting for players".into(),
            1 => format!("{} joined", self.peers[0].name),
            _ => format!("{n} players joined"),
        };
    }

    /// The players whose input comes over the network (on the host).
    pub fn remote_players(&self) -> Vec<u8> {
        self.peers.iter().map(|p| p.player).collect()
    }

    fn handle(&mut self, p: Packet, from: SocketAddr, seats: &mut Seats) {
        match (self.role, p) {
            (Role::Hosting, Packet::Find { game }) if game == self.game => {
                let here = Packet::Here {
                    game: self.game.clone(),
                    id: self.id,
                    name: self.name.clone(),
                    players: 1 + self.peers.len() as u8,
                    max: self.max_players,
                };
                self.send_to(from, &here);
            }
            (
                Role::Finding,
                Packet::Here {
                    game,
                    id,
                    name,
                    players,
                    max,
                },
            ) if game == self.game => {
                let now = Instant::now();
                match self.found.iter_mut().find(|f| f.host == id) {
                    Some(f) => {
                        f.seen = now;
                        f.name = name;
                        f.players = players;
                        f.max = max;
                    }
                    None => self.found.push(Found {
                        addr: from,
                        host: id,
                        name,
                        players,
                        max,
                        seen: now,
                    }),
                }
            }
            (
                Role::Hosting,
                Packet::Hello {
                    game,
                    id,
                    name,
                    rumble,
                },
            ) => {
                if game != self.game {
                    self.send_to(
                        from,
                        &Packet::Refused {
                            reason: "That is a different game".into(),
                        },
                    );
                    return;
                }
                if let Some(peer) = self.peers.iter_mut().find(|p| p.id == id) {
                    // it did not hear the welcome: say it again
                    peer.addr = from;
                    peer.heard = Instant::now();
                    let welcome = Packet::Welcome {
                        player: peer.player,
                        host: self.name.clone(),
                    };
                    self.send_to(from, &welcome);
                    return;
                }
                let full = 1 + self.peers.len() >= usize::from(self.max_players);
                let seat = if full {
                    None
                } else {
                    seats.seat_remote(id, &name, rumble)
                };
                let Some(player) = seat else {
                    self.send_to(
                        from,
                        &Packet::Refused {
                            reason: format!("{}'s game is full", self.name),
                        },
                    );
                    return;
                };
                log::info!("net: {name} joined from {from} as player {player}");
                self.peers.push(Peer::new(from, id, name.clone(), player));
                self.send_to(
                    from,
                    &Packet::Welcome {
                        player,
                        host: self.name.clone(),
                    },
                );
                self.events.push(NetEvent {
                    kind: "joined",
                    player,
                    name,
                });
                self.send_roster();
                self.update_host_status();
            }
            (Role::Joining, Packet::Welcome { player, host }) => {
                if let Some(h) = self.host.as_mut() {
                    h.heard = Instant::now();
                    h.name = host.clone();
                }
                self.me = player;
                self.role = Role::Joined;
                self.status = format!("Playing on {host}");
                self.events.push(NetEvent {
                    kind: "connected",
                    player,
                    name: host,
                });
            }
            (Role::Joining, Packet::Refused { reason }) => self.lose(reason),
            (Role::Joined | Role::Joining, Packet::Bye) => {
                if self.host.as_ref().is_some_and(|h| h.addr == from) {
                    let name = self
                        .host
                        .as_ref()
                        .map(|h| h.name.clone())
                        .unwrap_or_default();
                    self.lose(format!("{name} stopped the game"));
                }
            }
            (Role::Hosting, Packet::Bye) => {
                if let Some(i) = self.peers.iter().position(|p| p.addr == from) {
                    let p = self.peers.remove(i);
                    seats.unseat_remote(p.id);
                    self.events.push(NetEvent {
                        kind: "left",
                        player: p.player,
                        name: p.name,
                    });
                    self.send_roster();
                    self.update_host_status();
                }
            }
            (Role::Joined, Packet::State { seq, data }) => {
                if let Some(h) = self.host.as_mut() {
                    h.heard = Instant::now();
                }
                // newest wins (a packet that arrives after a newer one is dropped)
                if seq > self.state_in_seq {
                    self.state_in_seq = seq;
                    self.state_in = Some((data, Instant::now()));
                }
            }
            (
                Role::Hosting,
                Packet::Input {
                    seq,
                    values,
                    presses,
                    releases,
                },
            ) => {
                if let Some(p) = self.peers.iter_mut().find(|p| p.addr == from) {
                    p.heard = Instant::now();
                    if seq > p.input_seq {
                        p.input_seq = seq;
                        p.values = values;
                        p.presses = presses;
                        p.releases = releases;
                    }
                }
            }
            (_, Packet::Reliable { n, msg }) => {
                self.send_to(from, &Packet::Ack { n });
                let me = self.me;
                let ready = match self.peer_at(from) {
                    Some(peer) => {
                        peer.heard = Instant::now();
                        let player = peer.player;
                        peer.receive(n, msg)
                            .into_iter()
                            .map(|m| (player, m))
                            .collect::<Vec<_>>()
                    }
                    None => return,
                };
                for (player, m) in ready {
                    self.deliver(player, m, me);
                }
            }
            (_, Packet::Ack { n }) => {
                if let Some(peer) = self.peer_at(from) {
                    peer.heard = Instant::now();
                    peer.unacked.retain(|(m, _, _)| *m != n);
                }
            }
            (_, Packet::Ping { t }) => {
                if let Some(peer) = self.peer_at(from) {
                    peer.heard = Instant::now();
                }
                self.send_to(from, &Packet::Pong { t });
            }
            (_, Packet::Pong { t }) => {
                let now = self.now_s();
                if let Some(peer) = self.peer_at(from) {
                    peer.heard = Instant::now();
                    peer.rtt_ms = ((now - t) * 1000.0) as f32;
                }
            }
            _ => {}
        }
    }

    fn peer_at(&mut self, addr: SocketAddr) -> Option<&mut Peer> {
        match self.role {
            Role::Hosting => self.peers.iter_mut().find(|p| p.addr == addr),
            Role::Joined => self.host.as_mut().filter(|h| h.addr == addr),
            _ => None,
        }
    }

    fn deliver(&mut self, from_player: u8, msg: Msg, _me: u8) {
        match msg {
            Msg::Game { name, data, from } => {
                // the host knows who sent it; a joined device trusts the host's word
                let from = if self.role == Role::Hosting {
                    from_player
                } else {
                    from
                };
                self.inbox.push(Incoming { from, name, data });
            }
            Msg::Roster { players } => {
                let before: Vec<u8> = self.roster.iter().map(|r| r.player).collect();
                for r in &players {
                    if !before.contains(&r.player) && r.player != self.me && r.player != 1 {
                        self.events.push(NetEvent {
                            kind: "joined",
                            player: r.player,
                            name: r.name.clone(),
                        });
                    }
                }
                for r in &self.roster {
                    if !players.iter().any(|p| p.player == r.player) {
                        self.events.push(NetEvent {
                            kind: "left",
                            player: r.player,
                            name: r.name.clone(),
                        });
                    }
                }
                self.roster = players;
            }
            Msg::Rumble {
                strong,
                weak,
                seconds,
            } => self.rumble_in.push((strong, weak, seconds)),
        }
    }

    fn send_roster(&mut self) {
        let mut players = vec![RosterEntry {
            player: 1,
            name: self.name.clone(),
        }];
        players.extend(self.peers.iter().map(|p| RosterEntry {
            player: p.player,
            name: p.name.clone(),
        }));
        for p in &mut self.peers {
            p.queue(Msg::Roster {
                players: players.clone(),
            });
        }
    }

    /// Sends a message the game wants to arrive (reliable, in order). On the host, `to` is a player (or None for every
    /// joined player); a joined device sends to the host.
    pub fn send(&mut self, name: &str, data: Value, to: Option<u8>) -> Result<(), String> {
        let size = serde_json::to_vec(&data).map_or(0, |v| v.len());
        if size > MAX_PACKET - 256 {
            return Err(format!(
                "nova.net.send('{name}'): the message is {size} bytes; keep it under {} (send what changed, not everything)",
                MAX_PACKET - 256
            ));
        }
        let msg = Msg::Game {
            name: name.to_string(),
            data,
            from: self.me(),
        };
        match self.role {
            Role::Hosting => {
                for p in &mut self.peers {
                    if to.is_none_or(|t| t == p.player) {
                        p.queue(msg.clone());
                    }
                }
                Ok(())
            }
            Role::Joined => {
                if let Some(h) = self.host.as_mut() {
                    h.queue(msg);
                }
                Ok(())
            }
            _ => Err("nova.net.send: not connected (host a game or join one first)".into()),
        }
    }

    /// Shakes a joined player's controller (on the host).
    pub fn rumble(&mut self, player: u8, strong: f32, weak: f32, seconds: f32) {
        for p in &mut self.peers {
            if p.player == player {
                p.queue(Msg::Rumble {
                    strong,
                    weak,
                    seconds,
                });
            }
        }
    }

    /// Rumbles the host asked this joined device for.
    pub fn take_rumble(&mut self) -> Vec<(f32, f32, f32)> {
        std::mem::take(&mut self.rumble_in)
    }

    pub fn take_inbox(&mut self) -> Vec<Incoming> {
        std::mem::take(&mut self.inbox)
    }

    pub fn take_events(&mut self) -> Vec<NetEvent> {
        std::mem::take(&mut self.events)
    }

    /// The state the host sends every frame (set on the host).
    pub fn set_state(&mut self, data: Value) -> Result<(), String> {
        let size = serde_json::to_vec(&data).map_or(0, |v| v.len());
        if size > MAX_PACKET - 64 {
            return Err(format!(
                "nova.net.state: the state is {size} bytes; keep it under {} (round numbers, send only what is drawn)",
                MAX_PACKET - 64
            ));
        }
        self.state_out = Some(data);
        Ok(())
    }

    /// The newest state from the host, and how many seconds ago it arrived (on a joined device).
    pub fn state(&self) -> Option<(&Value, f32)> {
        self.state_in
            .as_ref()
            .map(|(v, t)| (v, t.elapsed().as_secs_f32()))
    }

    /// Everyone in the game.
    pub fn players(&self) -> Vec<NetPlayer> {
        match self.role {
            Role::Hosting => {
                let mut list = vec![NetPlayer {
                    player: 1,
                    name: self.name.clone(),
                    me: true,
                    host: true,
                    ping_ms: 0.0,
                }];
                list.extend(self.peers.iter().map(|p| NetPlayer {
                    player: p.player,
                    name: p.name.clone(),
                    me: false,
                    host: false,
                    ping_ms: p.rtt_ms,
                }));
                list
            }
            Role::Joined => {
                let ping = self.host.as_ref().map_or(0.0, |h| h.rtt_ms);
                self.roster
                    .iter()
                    .map(|r| NetPlayer {
                        player: r.player,
                        name: r.name.clone(),
                        me: r.player == self.me,
                        host: r.player == 1,
                        ping_ms: if r.player == 1 { ping } else { 0.0 },
                    })
                    .collect()
            }
            _ => Vec::new(),
        }
    }

    /// Sends what this frame has for the others: call once a frame after the game's step. A joined device sends its
    /// player's actions (`mine`: this device's any-player actions); the host sends the state.
    pub fn flush(&mut self, mine: &ActionStates) {
        let now = Instant::now();
        let t = self.now_s();
        match self.role {
            Role::Joined => {
                let (values, presses, releases) = mine.counts();
                self.input_seq += 1;
                let input = Packet::Input {
                    seq: self.input_seq,
                    values,
                    presses: presses.clone(),
                    releases: releases.clone(),
                };
                if let Some(addr) = self.host.as_ref().map(|h| h.addr) {
                    self.send_to(addr, &input);
                }
            }
            Role::Hosting => {
                if let Some(data) = &self.state_out {
                    self.state_seq += 1;
                    let p = Packet::State {
                        seq: self.state_seq,
                        data: data.clone(),
                    };
                    let bytes = encode(&p);
                    if let Some(s) = &self.socket {
                        for peer in &self.peers {
                            let _ = s.send_to(&bytes, peer.addr);
                        }
                    }
                }
            }
            _ => return,
        }
        // pings and reliable messages, for the host (to each player) or the joined device (to the host)
        let mut out: Vec<(SocketAddr, Packet)> = Vec::new();
        let peers: Vec<&mut Peer> = match self.role {
            Role::Hosting => self.peers.iter_mut().collect(),
            _ => self.host.iter_mut().collect(),
        };
        for peer in peers {
            if now - peer.pinged >= PING_EVERY {
                peer.pinged = now;
                out.push((peer.addr, Packet::Ping { t }));
            }
            for (n, msg, sent) in &mut peer.unacked {
                if sent.is_none_or(|s| now - s >= RESEND_AFTER) {
                    *sent = Some(now);
                    out.push((
                        peer.addr,
                        Packet::Reliable {
                            n: *n,
                            msg: msg.clone(),
                        },
                    ));
                }
            }
        }
        for (addr, p) in out {
            self.send_to(addr, &p);
        }
    }
}

/// A game that closes says goodbye, so that the others know at once rather than after [`DROP_AFTER`].
impl Drop for Net {
    fn drop(&mut self) {
        self.say_goodbye();
    }
}

/// This device's address on the local network, as others would reach it (None without a network). Asks the system
/// which address it would send from; nothing is sent.
pub fn local_address() -> Option<Ipv4Addr> {
    let s = UdpSocket::bind(SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, 0)).ok()?;
    // a private address that is never used: only the route to it is looked up
    s.connect(SocketAddrV4::new(Ipv4Addr::new(10, 254, 254, 254), 9))
        .ok()?;
    match s.local_addr().ok()? {
        SocketAddr::V4(a) if !a.ip().is_unspecified() && !a.ip().is_loopback() => Some(*a.ip()),
        _ => None,
    }
}

/// The broadcast address of this device's network, guessed as the /24 around its address (home wifi almost always is);
/// the all-ones broadcast is sent too, so a bigger network still works where routers pass it on.
fn subnet_broadcast() -> Option<Ipv4Addr> {
    local_address().map(|ip| {
        let [a, b, c, _] = ip.octets();
        Ipv4Addr::new(a, b, c, 255)
    })
}

/// A name for this device that a person recognises ("Jasper's MacBook Air", "Retroid Pocket 6").
pub fn device_name() -> String {
    #[cfg(target_os = "android")]
    {
        if let Some(n) = crate::android_input::device_name() {
            return n;
        }
    }
    #[cfg(target_os = "macos")]
    if let Ok(out) = std::process::Command::new("scutil")
        .args(["--get", "ComputerName"])
        .output()
        && out.status.success()
    {
        let n = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !n.is_empty() {
            return n;
        }
    }
    for var in ["COMPUTERNAME", "HOSTNAME"] {
        if let Ok(n) = std::env::var(var)
            && !n.is_empty()
        {
            return n;
        }
    }
    "This device".into()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::actions::Bindings;
    use crate::players::PlayerStates;
    use std::sync::atomic::{AtomicU16, Ordering};

    static NEXT_PORT: AtomicU16 = AtomicU16::new(47900);

    struct Device {
        net: Net,
        seats: Seats,
        states: PlayerStates,
    }

    fn device(name: &str, port: u16) -> Device {
        let mut net = Net::new("test-game", name);
        net.set_port(port);
        Device {
            net,
            seats: Seats::default(),
            states: PlayerStates::default(),
        }
    }

    fn tick(devices: &mut [&mut Device], bindings: &Bindings) {
        for d in devices.iter_mut() {
            d.net.poll(&mut d.seats, &mut d.states, bindings);
        }
        for d in devices.iter_mut() {
            let mine = std::mem::take(d.states.player_mut(0));
            d.net.flush(&mine);
            *d.states.player_mut(0) = mine;
        }
        std::thread::sleep(Duration::from_millis(5));
    }

    #[track_caller]
    fn run_until(
        devices: &mut [&mut Device],
        bindings: &Bindings,
        mut done: impl FnMut(&mut [&mut Device]) -> bool,
    ) {
        let started = Instant::now();
        while started.elapsed() < Duration::from_secs(10) {
            tick(devices, bindings);
            if done(devices) {
                return;
            }
        }
        let roles: Vec<_> = devices
            .iter()
            .map(|d| (d.net.role(), d.net.status().to_string()))
            .collect();
        panic!("timed out at {}: {roles:?}", std::panic::Location::caller());
    }

    #[test]
    fn connections_made_at_the_same_moment_have_different_ids() {
        // two devices made in the same microsecond (as a test makes them) must not look like one device to a host
        let ids: std::collections::HashSet<u64> = (0..10_000).map(|_| random_id()).collect();
        assert_eq!(ids.len(), 10_000);
    }

    #[test]
    fn packets_round_trip_and_strangers_are_ignored() {
        let p = Packet::Hello {
            game: "g".into(),
            id: 7,
            name: "Arya's Retroid".into(),
            rumble: true,
        };
        assert_eq!(decode(&encode(&p)), Some(p));
        assert_eq!(decode(b"HTTP/1.1 200 OK"), None);
        let mut wrong = encode(&Packet::Bye);
        wrong[4] = 99;
        assert_eq!(decode(&wrong), None, "another version is ignored");
    }

    #[test]
    fn a_device_finds_a_host_joins_plays_and_notices_it_stop() {
        let port = NEXT_PORT.fetch_add(1, Ordering::Relaxed);
        let bindings = Bindings::defaults();
        let mut host = device("Jasper's Retroid", port);
        let mut guest = device("Arya's Retroid", port);
        host.net.host(2, &mut host.seats).unwrap();
        guest.net.find(&mut guest.seats).unwrap();
        run_until(&mut [&mut host, &mut guest], &bindings, |d| {
            !d[1].net.found().is_empty()
        });
        let found = guest.net.found();
        assert_eq!(found[0].name, "Jasper's Retroid");
        assert_eq!((found[0].players, found[0].max), (1, 2));
        guest.net.join(&found[0].id(), &mut guest.seats).unwrap();
        assert_eq!(guest.net.role(), Role::Joining);
        run_until(&mut [&mut host, &mut guest], &bindings, |d| {
            d[1].net.role() == Role::Joined
        });
        assert_eq!(guest.net.me(), 2);
        assert_eq!(guest.net.status(), "Playing on Jasper's Retroid");
        let ev = host.net.take_events();
        assert_eq!((ev[0].kind, ev[0].player), ("joined", 2));
        assert_eq!(host.seats.get(2).unwrap().name, "Arya's Retroid");

        // the guest's actions arrive as player 2's on the host, a tap included
        let mut held = crate::actions::Sources::new();
        held.insert("key:KeyZ".into(), 1.0);
        held.insert("key:KeyD".into(), 1.0);
        guest.states.player_mut(0).update(&bindings, &held, &[]);
        run_until(&mut [&mut host, &mut guest], &bindings, |d| {
            d[0].states.player(2).is_down("a")
        });
        host.states.begin_step();
        assert!(host.states.player(2).was_pressed("a"));
        assert_eq!(host.states.player(2).value("move_x"), 1.0);
        assert!(!host.states.player(1).is_down("a"));

        // the host's state arrives; a message each way arrives once, in order
        host.net
            .set_state(serde_json::json!({ "x": 12.5, "who": [1, 2] }))
            .unwrap();
        host.net
            .send("hello", serde_json::json!("first"), None)
            .unwrap();
        host.net
            .send("hello", serde_json::json!("second"), Some(2))
            .unwrap();
        guest
            .net
            .send("ready", serde_json::json!({ "hat": 3 }), None)
            .unwrap();
        let mut got = Vec::new();
        let mut host_got = Vec::new();
        run_until(&mut [&mut host, &mut guest], &bindings, |d| {
            got.extend(d[1].net.take_inbox());
            host_got.extend(d[0].net.take_inbox());
            got.len() >= 2 && !host_got.is_empty() && d[1].net.state().is_some()
        });
        assert_eq!(guest.net.state().unwrap().0["x"], 12.5);
        assert_eq!(got[0].data, "first");
        assert_eq!(got[1].data, "second");
        assert_eq!(got[0].from, 1);
        assert_eq!(host_got[0].from, 2, "the host knows who sent it");
        assert_eq!(host_got[0].data["hat"], 3);
        // both see both players
        run_until(&mut [&mut host, &mut guest], &bindings, |d| {
            d[1].net.players().len() == 2
        });
        let names: Vec<_> = guest
            .net
            .players()
            .into_iter()
            .map(|p| (p.player, p.name, p.me))
            .collect();
        assert_eq!(
            names,
            [
                (1, "Jasper's Retroid".to_string(), false),
                (2, "Arya's Retroid".to_string(), true)
            ]
        );
        // the host stops: the guest is told why
        host.net.leave(&mut host.seats);
        run_until(&mut [&mut guest], &bindings, |d| {
            d[0].net.role() == Role::Lost
        });
        assert_eq!(guest.net.status(), "Jasper's Retroid stopped the game");
        assert!(host.seats.get(2).is_none());
    }

    #[test]
    fn a_full_game_says_so_and_a_silent_player_is_dropped_and_can_come_back() {
        let port = NEXT_PORT.fetch_add(1, Ordering::Relaxed);
        let bindings = Bindings::defaults();
        let mut host = device("Host", port);
        let mut a = device("A", port);
        let mut b = device("B", port);
        host.net.host(2, &mut host.seats).unwrap();
        a.net
            .join(&format!("127.0.0.1:{port}"), &mut a.seats)
            .unwrap();
        run_until(&mut [&mut host, &mut a], &bindings, |d| {
            d[1].net.role() == Role::Joined
        });
        b.net
            .join(&format!("127.0.0.1:{port}"), &mut b.seats)
            .unwrap();
        run_until(&mut [&mut host, &mut a, &mut b], &bindings, |d| {
            d[2].net.role() == Role::Lost
        });
        assert_eq!(b.net.status(), "Host's game is full");

        // A goes quiet (its wifi dropped): after a few seconds the host lets player 2 go, and keeps the seat
        let started = Instant::now();
        host.net.take_events();
        run_until(&mut [&mut host], &bindings, |d| {
            d[0].net.remote_players().is_empty()
        });
        assert!(started.elapsed() >= DROP_AFTER);
        assert_eq!(host.net.take_events()[0].kind, "left");
        assert!(!host.seats.get(2).unwrap().connected);
        // A comes back: the same seat
        a.net
            .join(&format!("127.0.0.1:{port}"), &mut a.seats)
            .unwrap();
        run_until(&mut [&mut host, &mut a], &bindings, |d| {
            d[1].net.role() == Role::Joined
        });
        assert_eq!(a.net.me(), 2);
    }

    #[test]
    fn a_game_that_closes_says_goodbye_at_once() {
        let port = NEXT_PORT.fetch_add(1, Ordering::Relaxed);
        let bindings = Bindings::defaults();
        let mut host = device("Host", port);
        let mut a = device("A", port);
        host.net.host(2, &mut host.seats).unwrap();
        a.net
            .join(&format!("127.0.0.1:{port}"), &mut a.seats)
            .unwrap();
        run_until(&mut [&mut host, &mut a], &bindings, |d| {
            d[1].net.role() == Role::Joined
        });
        host.net.take_events();
        drop(a);
        let started = Instant::now();
        run_until(&mut [&mut host], &bindings, |d| {
            d[0].net.remote_players().is_empty()
        });
        assert!(
            started.elapsed() < Duration::from_secs(1),
            "not after the time-out"
        );
        assert_eq!(host.net.take_events()[0].kind, "left");
    }

    #[test]
    fn a_join_with_no_host_gives_up_in_plain_words() {
        let port = NEXT_PORT.fetch_add(1, Ordering::Relaxed);
        let bindings = Bindings::defaults();
        let mut a = device("A", port);
        a.net
            .join(&format!("127.0.0.1:{port}"), &mut a.seats)
            .unwrap();
        a.net.join_started -= JOIN_TIMEOUT; // as if five seconds had passed
        tick(&mut [&mut a], &bindings);
        assert_eq!(a.net.role(), Role::Lost);
        assert_eq!(a.net.status(), "127.0.0.1 did not answer");
        assert!(
            Net::new("g", "n")
                .join("not an address", &mut a.seats)
                .is_err()
        );
    }
}
