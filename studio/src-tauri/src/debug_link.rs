//! The studio's end of the debugger connection (see `crates/nova-runtime/src/debug.rs` and `docs/debugger.md`). The game
//! is started with `--debug 0 --debug-wait`, prints `nova debug: listening on 127.0.0.1:PORT`, and this connects to that
//! port. Each JSON line from the game is handed to `on_message`; the front end writes requests with `send`.
//! For a game on a handheld the same works through `adb forward tcp:PORT tcp:PORT` (not wired up yet).

use std::io::{BufRead, BufReader, Write};
use std::net::TcpStream;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{Value, json};

/// The line the runtime prints when it listens, and the port in it.
pub fn port_in(line: &str) -> Option<u16> {
    let rest = line.split("nova debug: listening on ").nth(1)?;
    let addr = rest.split_whitespace().next()?;
    let (host, port) = addr.rsplit_once(':')?;
    if host != "127.0.0.1" && host != "localhost" {
        return None;
    }
    port.parse().ok()
}

#[derive(Default, Clone)]
pub struct DebugLink {
    stream: Arc<Mutex<Option<TcpStream>>>,
}

impl DebugLink {
    /// Connects to the game on `port` and reads its messages in a thread until it goes away. `on_message` also gets
    /// `{"event": "connected"}` and `{"event": "disconnected"}`.
    pub fn connect(
        &self,
        port: u16,
        on_message: impl Fn(Value) + Send + 'static,
    ) -> Result<(), String> {
        let stream =
            TcpStream::connect_timeout(&([127, 0, 0, 1], port).into(), Duration::from_secs(3))
                .map_err(|e| format!("cannot reach the game's debugger on port {port}: {e}"))?;
        let _ = stream.set_nodelay(true);
        let reader = stream.try_clone().map_err(|e| e.to_string())?;
        *self.stream.lock().expect("debug link lock") = Some(stream);
        on_message(json!({ "event": "connected", "port": port }));
        let slot = self.stream.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(reader).lines().map_while(Result::ok) {
                match serde_json::from_str::<Value>(&line) {
                    Ok(v) => on_message(v),
                    Err(_) => continue,
                }
            }
            *slot.lock().expect("debug link lock") = None;
            on_message(json!({ "event": "disconnected" }));
        });
        Ok(())
    }

    /// Writes one request to the game. An error when no game is connected.
    pub fn send(&self, message: &Value) -> Result<(), String> {
        let mut guard = self.stream.lock().expect("debug link lock");
        let stream = guard
            .as_mut()
            .ok_or("the game's debugger is not connected")?;
        let mut text = serde_json::to_string(message).map_err(|e| e.to_string())?;
        text.push('\n');
        stream
            .write_all(text.as_bytes())
            .map_err(|e| format!("cannot reach the game: {e}"))
    }

    pub fn close(&self) {
        if let Some(s) = self.stream.lock().expect("debug link lock").take() {
            let _ = s.shutdown(std::net::Shutdown::Both);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::sync::mpsc::channel;

    #[test]
    fn the_port_is_read_from_the_runtime_line() {
        assert_eq!(
            port_in("nova debug: listening on 127.0.0.1:50123"),
            Some(50123)
        );
        assert_eq!(
            port_in("[INFO] nova debug: listening on 127.0.0.1:7 more"),
            Some(7)
        );
        assert_eq!(
            port_in("nova debug: listening on 10.0.0.2:7"),
            None,
            "only this computer"
        );
        assert_eq!(port_in("tick 3"), None);
    }

    #[test]
    fn messages_go_both_ways() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let (tx, rx) = channel();
        let link = DebugLink::default();
        assert!(
            link.send(&json!({"cmd": "hello"})).is_err(),
            "nothing connected yet"
        );
        link.connect(port, move |m| tx.send(m).unwrap()).unwrap();
        let (game, _) = listener.accept().unwrap();
        assert_eq!(
            rx.recv_timeout(Duration::from_secs(2)).unwrap()["event"],
            "connected"
        );
        link.send(&json!({"id": 1, "cmd": "hello"})).unwrap();
        let mut line = String::new();
        BufReader::new(game.try_clone().unwrap())
            .read_line(&mut line)
            .unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&line).unwrap()["cmd"],
            "hello"
        );
        (&game)
            .write_all(b"{\"event\":\"paused\",\"line\":3}\n")
            .unwrap();
        assert_eq!(rx.recv_timeout(Duration::from_secs(2)).unwrap()["line"], 3);
        drop(game);
        assert_eq!(
            rx.recv_timeout(Duration::from_secs(2)).unwrap()["event"],
            "disconnected"
        );
        assert!(link.send(&json!({})).is_err());
    }
}
