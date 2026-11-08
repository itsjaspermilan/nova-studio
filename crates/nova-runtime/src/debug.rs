//! The debugger connection: the game listens on a TCP port on 127.0.0.1 (`nova run --debug PORT`, 0 picks a free one)
//! and the studio connects. Messages are JSON objects, one per line, both ways (see `docs/debugger.md`):
//!
//! - the studio sends requests `{"id": 7, "cmd": "stack", ...}` and gets `{"reply": 7, "ok": true, "result": ...}` or
//!   `{"reply": 7, "ok": false, "error": "..."}`;
//! - the game sends events `{"event": "paused", ...}`, `{"event": "resumed"}`, `{"event": "reloaded", ...}`.
//!
//! The game listens rather than connects so that a game on a handheld can be reached through `adb forward tcp:P tcp:P`.
//! Without `--debug` none of this exists. With it and nothing attached, a frame costs one non-blocking accept; line hooks
//! are only switched on while there are breakpoints or a step is under way (see `game/debug_api.rs`).

use std::collections::{BTreeSet, HashMap, HashSet, VecDeque};
use std::io::{ErrorKind, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::time::{Duration, Instant};

use serde_json::{Value, json};

/// The protocol's version, sent in the reply to `hello`. Bump it when a message changes shape.
pub const PROTOCOL: u32 = 1;

/// Where the next pause should happen, besides breakpoints.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Step {
    /// Only at breakpoints (and errors).
    None,
    /// At the next line of the person's code, wherever it is (also what "pause" does).
    Into,
    /// At the next line in the same coroutine whose stack is no deeper than `depth`.
    Over { thread: usize, depth: usize },
    /// At the next line in the same coroutine whose stack is shallower than `depth`.
    Out { thread: usize, depth: usize },
}

struct Conn {
    stream: TcpStream,
    buf: Vec<u8>,
}

pub struct Debugger {
    listener: TcpListener,
    conn: Option<Conn>,
    pub port: u16,
    breakpoints: HashMap<String, BTreeSet<u32>>,
    /// Every line that has a breakpoint in some file: a cheap first test in the line hook.
    lines: HashSet<u32>,
    pub step: Step,
    pub pause_on_errors: bool,
    /// While stopped: the depth (frames from the bottom) of the paused frame.
    pub paused: Option<usize>,
    pending: VecDeque<Value>,
    /// Set when a client has connected since the last look.
    pub fresh: bool,
    /// The game's name, for the reply to `hello`.
    pub game_name: String,
    /// `--debug-wait`: before the first script runs, wait this long for a studio to connect and say `ready`.
    pub wait_at_start: Option<Duration>,
}

pub type DebugHandle = std::rc::Rc<std::cell::RefCell<Debugger>>;

impl Debugger {
    /// Listens on 127.0.0.1:`port` (0 = any free port; `self.port` says which).
    pub fn listen(port: u16) -> std::io::Result<Debugger> {
        let listener = TcpListener::bind(("127.0.0.1", port))?;
        listener.set_nonblocking(true)?;
        let port = listener.local_addr()?.port();
        Ok(Debugger {
            listener,
            conn: None,
            port,
            breakpoints: HashMap::new(),
            lines: HashSet::new(),
            step: Step::None,
            pause_on_errors: true,
            paused: None,
            pending: VecDeque::new(),
            fresh: false,
            game_name: String::new(),
            wait_at_start: None,
        })
    }

    pub fn connected(&self) -> bool {
        self.conn.is_some()
    }

    /// Takes a new connection if one is waiting (it replaces the old one) and reads what has arrived.
    pub fn poll(&mut self) {
        match self.listener.accept() {
            Ok((stream, _)) => {
                if stream.set_nonblocking(true).is_ok() {
                    let _ = stream.set_nodelay(true);
                    if self.conn.is_some() {
                        log::info!(
                            "debugger: a new studio connected; the old connection is closed"
                        );
                    }
                    self.conn = Some(Conn {
                        stream,
                        buf: Vec::new(),
                    });
                    self.fresh = true;
                    log::info!("debugger: studio connected");
                }
            }
            Err(e) if e.kind() == ErrorKind::WouldBlock => {}
            Err(e) => log::warn!("debugger: accept failed: {e}"),
        }
        let Some(conn) = self.conn.as_mut() else {
            return;
        };
        let mut chunk = [0u8; 8192];
        let mut closed = false;
        loop {
            match conn.stream.read(&mut chunk) {
                Ok(0) => {
                    closed = true;
                    break;
                }
                Ok(n) => conn.buf.extend_from_slice(&chunk[..n]),
                Err(e) if e.kind() == ErrorKind::WouldBlock => break,
                Err(e) if e.kind() == ErrorKind::Interrupted => {}
                Err(_) => {
                    closed = true;
                    break;
                }
            }
        }
        while let Some(end) = conn.buf.iter().position(|&b| b == b'\n') {
            let line: Vec<u8> = conn.buf.drain(..=end).collect();
            let text = String::from_utf8_lossy(&line);
            let text = text.trim();
            if text.is_empty() {
                continue;
            }
            match serde_json::from_str::<Value>(text) {
                Ok(v) if v.is_object() => self.pending.push_back(v),
                _ => {
                    let reply = json!({"event": "protocol_error", "error": format!("not a JSON object: {}", truncate(text, 200))});
                    let _ = write_line(&mut conn.stream, &reply);
                }
            }
        }
        if closed {
            self.disconnected();
        }
    }

    fn disconnected(&mut self) {
        self.conn = None;
        // nobody is looking any more: the game should not stop for anything
        self.breakpoints.clear();
        self.lines.clear();
        self.step = Step::None;
        log::info!("debugger: studio disconnected");
    }

    /// The next message that has arrived, if any (does not wait).
    pub fn next_message(&mut self) -> Option<Value> {
        if self.pending.is_empty() {
            self.poll();
        }
        self.pending.pop_front()
    }

    /// Waits for the next message (polling every few milliseconds), up to `timeout` (None: as long as a studio is
    /// connected). Returns None when the time is up or the studio went away.
    pub fn wait(&mut self, timeout: Option<Duration>) -> Option<Value> {
        let until = timeout.map(|t| Instant::now() + t);
        loop {
            if let Some(m) = self.next_message() {
                return Some(m);
            }
            if timeout.is_none() && self.conn.is_none() {
                return None;
            }
            if until.is_some_and(|u| Instant::now() >= u) {
                return None;
            }
            std::thread::sleep(Duration::from_millis(4));
        }
    }

    /// Sends one message; a broken connection is dropped.
    pub fn send(&mut self, message: &Value) {
        let Some(conn) = self.conn.as_mut() else {
            return;
        };
        if write_line(&mut conn.stream, message).is_err() {
            self.disconnected();
        }
    }

    pub fn reply(&mut self, id: &Value, result: Result<Value, String>) {
        let message = match result {
            Ok(result) => json!({"reply": id, "ok": true, "result": result}),
            Err(error) => json!({"reply": id, "ok": false, "error": error}),
        };
        self.send(&message);
    }

    pub fn event(&mut self, name: &str, mut fields: Value) {
        if let Some(map) = fields.as_object_mut() {
            map.insert("event".into(), Value::String(name.into()));
        } else {
            fields = json!({ "event": name });
        }
        self.send(&fields);
    }

    /// Replaces the breakpoints of one file (a project path such as `entities/player.lua`).
    pub fn set_breakpoints(
        &mut self,
        file: &str,
        lines: impl IntoIterator<Item = u32>,
    ) -> Vec<u32> {
        let set: BTreeSet<u32> = lines.into_iter().filter(|&l| l > 0).collect();
        let out = set.iter().copied().collect();
        if set.is_empty() {
            self.breakpoints.remove(file);
        } else {
            self.breakpoints.insert(file.to_string(), set);
        }
        self.lines = self.breakpoints.values().flatten().copied().collect();
        out
    }

    /// A first, cheap test for the line hook: does any file have a breakpoint on this line?
    pub fn any_breakpoint_on(&self, line: u32) -> bool {
        self.lines.contains(&line)
    }

    pub fn has_breakpoint(&self, file: &str, line: u32) -> bool {
        self.breakpoints
            .get(file)
            .is_some_and(|s| s.contains(&line))
    }

    /// Do line hooks need to be on?
    pub fn wants_lines(&self) -> bool {
        self.conn.is_some() && (!self.lines.is_empty() || self.step != Step::None)
    }
}

fn write_line(stream: &mut TcpStream, message: &Value) -> std::io::Result<()> {
    let mut text = serde_json::to_string(message).unwrap_or_else(|_| "{}".into());
    text.push('\n');
    // the stream reads without blocking; a write must go out whole
    stream.set_nonblocking(false)?;
    let result = stream
        .write_all(text.as_bytes())
        .and_then(|_| stream.flush());
    stream.set_nonblocking(true)?;
    result
}

fn truncate(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        s.to_string()
    } else {
        s.chars().take(n).collect::<String>() + "…"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader};

    fn client(port: u16) -> (TcpStream, BufReader<TcpStream>) {
        let s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        let r = BufReader::new(s.try_clone().unwrap());
        (s, r)
    }

    #[test]
    fn requests_arrive_as_json_and_replies_go_back_as_lines() {
        let mut d = Debugger::listen(0).unwrap();
        assert!(d.port > 0);
        assert!(
            d.next_message().is_none(),
            "nothing connected, nothing waiting"
        );
        let (mut s, mut r) = client(d.port);
        s.write_all(b"{\"id\":1,\"cmd\":\"hello\"}\n{\"id\":2,")
            .unwrap();
        let m = d.wait(Some(Duration::from_secs(2))).expect("a request");
        assert_eq!(m["cmd"], "hello");
        assert!(d.fresh);
        assert!(d.next_message().is_none(), "half a line waits for the rest");
        s.write_all(b"\"cmd\":\"stack\"}\nnot json\n").unwrap();
        let m = d
            .wait(Some(Duration::from_secs(2)))
            .expect("the second request");
        assert_eq!(m["id"], 2);
        d.reply(&json!(1), Ok(json!({"x": 1})));
        let mut line = String::new();
        r.read_line(&mut line).unwrap();
        let v: Value = serde_json::from_str(&line).unwrap();
        assert_eq!(
            v["event"], "protocol_error",
            "the bad line is answered first: {line}"
        );
        line.clear();
        r.read_line(&mut line).unwrap();
        let v: Value = serde_json::from_str(&line).unwrap();
        assert_eq!(
            (v["reply"].as_i64(), v["ok"].as_bool()),
            (Some(1), Some(true))
        );
        assert_eq!(v["result"]["x"], 1);
    }

    #[test]
    fn breakpoints_are_per_file_and_go_when_the_studio_leaves() {
        let mut d = Debugger::listen(0).unwrap();
        let (s, r) = client(d.port);
        d.wait(Some(Duration::from_millis(200)));
        let start = Instant::now();
        while !d.connected() && start.elapsed() < Duration::from_secs(2) {
            d.poll();
        }
        assert!(d.connected());
        assert_eq!(d.set_breakpoints("main.lua", [5, 3, 0, 5]), vec![3, 5]);
        d.set_breakpoints("lib/a.lua", [9]);
        assert!(d.has_breakpoint("main.lua", 3) && !d.has_breakpoint("lib/a.lua", 3));
        assert!(d.any_breakpoint_on(9) && !d.any_breakpoint_on(4));
        assert!(d.wants_lines());
        d.set_breakpoints("main.lua", []);
        assert!(!d.any_breakpoint_on(3));
        drop((s, r)); // (the reader is a second handle on the same socket)
        let start = Instant::now();
        while d.connected() && start.elapsed() < Duration::from_secs(2) {
            d.poll();
        }
        assert!(!d.connected());
        assert!(!d.wants_lines() && !d.any_breakpoint_on(9));
    }
}
