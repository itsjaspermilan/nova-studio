//! The debugger protocol against a real `Game`: a scripted "studio" in another thread talks to the game over TCP while
//! this thread runs frames (the game stops inside a frame while it is paused). Also the keep-state reload.

use std::cell::RefCell;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpStream;
use std::rc::Rc;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant, SystemTime};

use nova_runtime::debug::Debugger;
use nova_runtime::game::{Game, Reload, Uploader};
use nova_runtime::input::Actions;
use nova_runtime::model::{Image, MeshData};
use nova_runtime::vfs::{DirVfs, MemVfs, Vfs};
use serde_json::{Value, json};

struct FakeGpu;
impl Uploader for FakeGpu {
    fn set_atlas(&mut self, _: &Image) {}
    fn add_mesh(&mut self, _: &MeshData) -> usize {
        0
    }
}

struct Client {
    w: TcpStream,
    r: BufReader<TcpStream>,
    next: i64,
    events: Vec<Value>,
}

impl Client {
    fn connect(port: u16) -> Client {
        let start = Instant::now();
        loop {
            match TcpStream::connect(("127.0.0.1", port)) {
                Ok(s) => {
                    s.set_read_timeout(Some(Duration::from_secs(20))).unwrap();
                    let r = BufReader::new(s.try_clone().unwrap());
                    return Client {
                        w: s,
                        r,
                        next: 1,
                        events: Vec::new(),
                    };
                }
                Err(e) if start.elapsed() < Duration::from_secs(5) => {
                    let _ = e;
                    std::thread::sleep(Duration::from_millis(20));
                }
                Err(e) => panic!("cannot connect: {e}"),
            }
        }
    }

    fn read(&mut self) -> Value {
        let mut line = String::new();
        let n = self
            .r
            .read_line(&mut line)
            .expect("a message from the game");
        assert!(n > 0, "the game closed the connection");
        serde_json::from_str(&line).unwrap_or_else(|e| panic!("bad JSON {line}: {e}"))
    }

    /// Sends a request and returns its reply (events that arrive first are kept).
    fn ask(&mut self, cmd: &str, extra: Value) -> Value {
        let id = self.next;
        self.next += 1;
        let mut m = extra.as_object().cloned().unwrap_or_default();
        m.insert("id".into(), json!(id));
        m.insert("cmd".into(), json!(cmd));
        let mut text = serde_json::to_string(&Value::Object(m)).unwrap();
        text.push('\n');
        self.w.write_all(text.as_bytes()).unwrap();
        loop {
            let v = self.read();
            if v.get("reply") == Some(&json!(id)) {
                return v;
            }
            self.events.push(v);
        }
    }

    fn ok(&mut self, cmd: &str, extra: Value) -> Value {
        let v = self.ask(cmd, extra);
        assert_eq!(v["ok"], true, "{cmd}: {v}");
        v["result"].clone()
    }

    fn event(&mut self, name: &str) -> Value {
        if let Some(i) = self.events.iter().position(|e| e["event"] == name) {
            return self.events.remove(i);
        }
        loop {
            let v = self.read();
            if v["event"] == name {
                return v;
            }
            self.events.push(v);
        }
    }
}

fn value_of<'a>(entries: &'a Value, name: &str) -> &'a Value {
    entries
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["name"] == name)
        .unwrap_or_else(|| panic!("no '{name}' in {entries}"))
}

fn files(main: &str, more: &[(&str, &str)]) -> Rc<dyn Vfs> {
    let mut all: Vec<(&str, Vec<u8>)> = vec![
        ("nova.json", br#"{"format":1,"name":"Debug test"}"#.to_vec()),
        ("main.lua", main.as_bytes().to_vec()),
    ];
    for (p, s) in more {
        all.push((p, s.as_bytes().to_vec()));
    }
    Rc::new(MemVfs::new(all))
}

/// Loads the game with a debugger that waits for the studio, runs `studio` in a thread, and runs frames until the studio
/// is done. Returns the game.
fn with_studio(vfs: Rc<dyn Vfs>, studio: impl FnOnce(&mut Client) + Send + 'static) -> Game {
    let mut d = Debugger::listen(0).expect("a port");
    d.wait_at_start = Some(Duration::from_secs(10));
    let port = d.port;
    let done = Arc::new(AtomicBool::new(false));
    let flag = done.clone();
    let thread = std::thread::spawn(move || {
        let mut c = Client::connect(port);
        studio(&mut c);
        flag.store(true, Ordering::SeqCst);
        // keep the connection until the game has seen we are done
        std::thread::sleep(Duration::from_millis(50));
    });
    let mut game = Game::load_debug(vfs, &|_| None, Some(Rc::new(RefCell::new(d)))).expect("loads");
    game.upload(&mut FakeGpu);
    let start = Instant::now();
    let mut frame = 0;
    while !done.load(Ordering::SeqCst) {
        assert!(
            start.elapsed() < Duration::from_secs(30),
            "the studio script did not finish"
        );
        game.update(
            1.0 / 60.0,
            frame as f64 / 60.0,
            [960.0, 540.0],
            Actions::default(),
            false,
        );
        frame += 1;
        std::thread::sleep(Duration::from_millis(2));
    }
    if let Err(e) = thread.join() {
        std::panic::resume_unwind(e);
    }
    game
}

#[test]
fn breakpoints_stop_the_game_and_steps_walk_through_the_code() {
    let main = "local counter = 0\n\
                local helper = require('lib.helper')\n\
                function update(dt)\n\
                  local a = 5\n\
                  local b = helper.double(a)\n\
                  counter = counter + b\n\
                  nova.log('counter ' .. counter)\n\
                end\n";
    let helper = "local M = {}\n\
                  function M.double(x)\n\
                    local y = x * 2\n\
                    return y\n\
                  end\n\
                  return M\n";
    let game = with_studio(files(main, &[("lib/helper.lua", helper)]), |c| {
        let hello = c.ok("hello", json!({}));
        assert_eq!(hello["protocol"], 1);
        assert_eq!(hello["name"], "Debug test");
        let set = c.ok("set_breakpoints", json!({"file": "main.lua", "lines": [5]}));
        assert_eq!(set["lines"], json!([5]));
        c.ok("ready", json!({}));

        let p = c.event("paused");
        assert_eq!(
            (p["reason"].as_str(), p["file"].as_str(), p["line"].as_i64()),
            (Some("breakpoint"), Some("main.lua"), Some(5)),
            "{p}"
        );
        let stack = p["stack"].as_array().unwrap();
        assert_eq!(stack[0]["func"], "update");
        let depth = stack[0]["depth"].clone();
        let locals = c.ok("scope", json!({"depth": depth, "which": "locals"}));
        assert_eq!(value_of(&locals, "a")["value"], "5");
        assert_eq!(value_of(&locals, "dt")["type"], "number");
        let ups = c.ok("scope", json!({"depth": depth, "which": "upvalues"}));
        assert_eq!(value_of(&ups, "counter")["value"], "0");
        let helper_table = value_of(&ups, "helper");
        assert_eq!(helper_table["type"], "table");
        let fields = c.ok("children", json!({"ref": helper_table["ref"]}));
        assert!(
            value_of(&fields, "double")["value"]
                .as_str()
                .unwrap()
                .starts_with("function (lib/helper.lua:2"),
            "{fields}"
        );
        let globals = c.ok("scope", json!({"depth": depth, "which": "globals"}));
        assert_eq!(value_of(&globals, "update")["type"], "function");
        // (the engine's own globals are left out)
        assert!(
            globals
                .as_array()
                .unwrap()
                .iter()
                .all(|g| g["name"] != "nova" && g["name"] != "math")
        );

        c.ok("step_into", json!({}));
        let p = c.event("paused");
        assert_eq!(
            (p["reason"].as_str(), p["file"].as_str(), p["line"].as_i64()),
            (Some("step"), Some("lib/helper.lua"), Some(3)),
            "{p}"
        );
        let stack = p["stack"].as_array().unwrap();
        assert_eq!(stack[0]["func"], "double");
        assert_eq!(
            (stack[1]["func"].as_str(), stack[1]["line"].as_i64()),
            (Some("update"), Some(5))
        );
        let locals = c.ok(
            "scope",
            json!({"depth": stack[0]["depth"], "which": "locals"}),
        );
        assert_eq!(value_of(&locals, "x")["value"], "5");
        // the caller's frame can be looked at too
        let caller = c.ok(
            "scope",
            json!({"depth": stack[1]["depth"], "which": "locals"}),
        );
        assert_eq!(value_of(&caller, "a")["value"], "5");

        c.ok("step_over", json!({}));
        let p = c.event("paused");
        assert_eq!(
            (p["file"].as_str(), p["line"].as_i64()),
            (Some("lib/helper.lua"), Some(4)),
            "{p}"
        );

        c.ok("step_out", json!({}));
        let p = c.event("paused");
        assert_eq!(
            (p["file"].as_str(), p["line"].as_i64()),
            (Some("main.lua"), Some(6)),
            "{p}"
        );
        let locals = c.ok(
            "scope",
            json!({"depth": p["stack"][0]["depth"], "which": "locals"}),
        );
        assert_eq!(value_of(&locals, "b")["value"], "10");

        // asking for what only exists while paused is refused while running
        c.ok("set_breakpoints", json!({"file": "main.lua", "lines": []}));
        c.ok("continue", json!({}));
        c.event("resumed");
        let refused = c.ask("stack", json!({}));
        assert_eq!(refused["ok"], false);
        assert!(refused["error"].as_str().unwrap().contains("not paused"));
        let unknown = c.ask("fly", json!({}));
        assert!(
            unknown["error"]
                .as_str()
                .unwrap()
                .contains("unknown request")
        );
    });
    assert!(game.error.is_none(), "{:?}", game.error);
    assert!(game.take_log().iter().any(|l| l == "counter 10"));
}

#[test]
fn pause_stops_at_the_next_line_and_breakpoints_work_in_coroutines() {
    // the coroutine is made before any breakpoint exists, so its line hook has to be switched on afterwards
    let main = "nova.start('play')\n";
    let scene = "local Play = nova.scene {}\n\
                 function Play:enter()\n\
                   self.n = 0\n\
                   self:go(function()\n\
                     while true do\n\
                       self.n = self.n + 1\n\
                       nova.wait(0)\n\
                     end\n\
                   end)\n\
                 end\n\
                 return Play\n";
    with_studio(files(main, &[("scenes/play.lua", scene)]), |c| {
        c.ok("ready", json!({}));
        c.ok("pause", json!({}));
        let p = c.event("paused");
        assert_eq!(p["reason"], "step");
        assert_eq!(
            p["file"], "scenes/play.lua",
            "pausing stops in the person's code, not the framework: {p}"
        );
        c.ok("continue", json!({}));
        c.ok(
            "set_breakpoints",
            json!({"file": "scenes/play.lua", "lines": [6]}),
        );
        let p = c.event("paused");
        assert_eq!(
            (p["reason"].as_str(), p["line"].as_i64()),
            (Some("breakpoint"), Some(6)),
            "{p}"
        );
        let ups = c.ok(
            "scope",
            json!({"depth": p["stack"][0]["depth"], "which": "upvalues"}),
        );
        let me = value_of(&ups, "self");
        assert!(me["value"].as_str().unwrap().contains("play scene"), "{me}");
        let fields = c.ok("children", json!({"ref": me["ref"]}));
        let n: i64 = value_of(&fields, "n")["value"]
            .as_str()
            .unwrap()
            .parse()
            .unwrap();
        // (step over stays in the coroutine: the next stop is the line after, not somewhere in the framework)
        c.ok("step_over", json!({}));
        let p = c.event("paused");
        assert_eq!(
            (p["file"].as_str(), p["line"].as_i64()),
            (Some("scenes/play.lua"), Some(7)),
            "{p}"
        );
        c.ok(
            "set_breakpoints",
            json!({"file": "scenes/play.lua", "lines": []}),
        );
        c.ok("continue", json!({}));
        assert!(n >= 0);
    });
}

#[test]
fn errors_pause_where_they_happen() {
    let main = "function update(dt)\n\
                  local t = nil\n\
                  local x = 1 + t.missing\n\
                end\n";
    let game = with_studio(files(main, &[]), |c| {
        c.ok("ready", json!({}));
        let p = c.event("paused");
        assert_eq!(
            (p["reason"].as_str(), p["file"].as_str(), p["line"].as_i64()),
            (Some("error"), Some("main.lua"), Some(3)),
            "{p}"
        );
        assert!(
            p["message"].as_str().unwrap().contains("index a nil value"),
            "{p}"
        );
        let locals = c.ok(
            "scope",
            json!({"depth": p["stack"][0]["depth"], "which": "locals"}),
        );
        assert_eq!(value_of(&locals, "t")["value"], "nil");
        c.ok("continue", json!({}));
        c.event("resumed");
    });
    let error = game
        .error
        .clone()
        .expect("the error stopped the game after the pause");
    assert!(error.contains("main.lua:3"), "{error}");
    assert!(
        game.error_detail
            .clone()
            .unwrap()
            .contains("stack traceback"),
        "the traceback is kept for the Problems panel"
    );
}

#[test]
fn errors_do_not_pause_when_asked_not_to() {
    let main = "function update(dt) error('boom') end\n";
    let game = with_studio(files(main, &[]), |c| {
        c.ok("pause_on_errors", json!({"on": false}));
        c.ok("ready", json!({}));
        // a request answered after the error shows the game carried on without stopping
        std::thread::sleep(Duration::from_millis(100));
        c.ok("hello", json!({}));
        assert!(
            c.events.iter().all(|e| e["event"] != "paused"),
            "{:?}",
            c.events
        );
    });
    assert!(game.error.clone().unwrap().contains("boom"));
}

#[test]
fn the_object_view_lists_entities_and_edits_their_fields_live() {
    let main = "nova.start('play')\n";
    let scene = "local Play = nova.scene {}\n\
                 function Play:enter() self.hero = nova.spawn('hero', 100, 50) nova.spawn('coin', 10, 10) end\n\
                 return Play\n";
    let hero = "local Hero = nova.entity { tags = { 'player' }, speed = 120, name = 'Ada', bag = { gold = 3 } }\n\
                function Hero:update(dt) self.x = self.x + self.speed * dt end\n\
                return Hero\n";
    let coin = "return nova.entity { tags = { 'coin' } }\n";
    let game = with_studio(
        files(
            main,
            &[
                ("scenes/play.lua", scene),
                ("entities/hero.lua", hero),
                ("entities/coin.lua", coin),
            ],
        ),
        |c| {
            c.ok("ready", json!({}));
            std::thread::sleep(Duration::from_millis(50));
            let list = c.ok("entities", json!({}));
            assert_eq!(list["scene"], "play");
            let all = list["entities"].as_array().unwrap();
            assert_eq!(all[0]["kind"], "scene");
            let hero = all
                .iter()
                .find(|e| e["name"] == "hero")
                .expect("the hero is listed");
            assert_eq!(hero["tags"], json!(["player"]));
            assert_eq!(
                hero["label"], "hero",
                "named by the scene field that holds it"
            );
            assert!(all.iter().any(|e| e["name"] == "coin"));
            let id = hero["id"].clone();
            let fields = c.ok("entity", json!({"target": id}));
            assert_eq!(value_of(&fields, "speed")["value"], "120");
            assert_eq!(value_of(&fields, "name")["value"], "\"Ada\"");
            let bag = value_of(&fields, "bag");
            let inside = c.ok("children", json!({"ref": bag["ref"]}));
            assert_eq!(value_of(&inside, "gold")["value"], "3");
            c.ok("set", json!({"ref": bag["ref"], "key": "gold", "value": 7}));

            // live edits: numbers, text, true/false; the kind must stay the same
            let set = c.ok("set", json!({"target": id, "key": "speed", "value": 0}));
            assert_eq!(set["value"], "0");
            c.ok(
                "set",
                json!({"target": id, "key": "name", "value": "Grace"}),
            );
            c.ok(
                "set",
                json!({"target": id, "key": "visible", "value": false}),
            );
            let wrong = c.ask(
                "set",
                json!({"target": id, "key": "speed", "value": "fast"}),
            );
            assert_eq!(wrong["ok"], false);
            assert!(
                wrong["error"].as_str().unwrap().contains("holds number"),
                "{wrong}"
            );
            let gone = c.ask("entity", json!({"target": 999}));
            assert_eq!(gone["ok"], false);

            let x0 = c.ok("entity", json!({"target": id}));
            std::thread::sleep(Duration::from_millis(60));
            let x1 = c.ok("entity", json!({"target": id}));
            assert_eq!(
                value_of(&x0, "x")["value"],
                value_of(&x1, "x")["value"],
                "speed 0 holds the hero still"
            );
            c.ok("highlight", json!({"target": id}));
            std::thread::sleep(Duration::from_millis(30));
            c.ok("highlight", json!({"target": null}));
        },
    );
    assert!(game.error.is_none(), "{:?}", game.error);
}

#[test]
fn games_still_cannot_reach_the_debug_library() {
    let main = "function update(dt) nova.log(type(debug)) end\n";
    let mut game = with_studio(files(main, &[]), |c| {
        c.ok("ready", json!({}));
        std::thread::sleep(Duration::from_millis(30));
    });
    game.update(0.016, 0.0, [960.0, 540.0], Actions::default(), false);
    assert!(game.take_log().iter().all(|l| l == "nil"));
}

// ------------------------------------------------------------------ keep-state reload

struct Folder(std::path::PathBuf);
impl Drop for Folder {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn folder(name: &str, files: &[(&str, &str)]) -> Folder {
    let dir = std::env::temp_dir().join(format!("nova-reload-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    for (path, text) in files {
        let p = dir.join(path);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, text).unwrap();
    }
    Folder(dir)
}

/// Writes a file and moves its time on, so the change shows even where file times are coarse.
fn edit(dir: &Folder, path: &str, text: &str, step: u64) {
    let p = dir.0.join(path);
    std::fs::write(&p, text).unwrap();
    let later = SystemTime::now() + Duration::from_secs(10 * step);
    std::fs::File::options()
        .write(true)
        .open(&p)
        .unwrap()
        .set_modified(later)
        .unwrap();
}

fn frames(game: &mut Game, n: usize) {
    for i in 0..n {
        game.update(
            1.0 / 60.0,
            i as f64 / 60.0,
            [960.0, 540.0],
            Actions::default(),
            false,
        );
    }
}

fn last_log(game: &Game) -> String {
    game.take_log().pop().unwrap_or_default()
}

const HERO_V1: &str = "local seen = {}\n\
local STEP = 1\n\
local Hero = nova.entity { speed = 1 }\n\
function Hero:update(dt)\n\
  seen[#seen + 1] = true\n\
  self.ticks = (self.ticks or 0) + STEP\n\
  nova.log(self.id .. ' ' .. self.ticks .. ' ' .. #seen .. ' ' .. self:label())\n\
end\n\
function Hero:label() return 'old' end\n\
return Hero\n";

#[test]
fn changed_module_code_goes_into_the_running_game_and_keeps_its_state() {
    let dir = folder(
        "keep",
        &[
            ("nova.json", r#"{"format":1,"name":"Reload"}"#),
            ("main.lua", "nova.start('play')\n"),
            (
                "scenes/play.lua",
                "local P = nova.scene {}\nfunction P:enter() nova.spawn('hero', 0, 0) end\nreturn P\n",
            ),
            ("entities/hero.lua", HERO_V1),
        ],
    );
    let vfs: Rc<dyn Vfs> = Rc::new(DirVfs::new(&dir.0).unwrap());
    let mut game = Game::load(vfs).unwrap();
    game.upload(&mut FakeGpu);
    frames(&mut game, 5);
    let before = last_log(&game);
    assert!(before.ends_with(" old"), "{before}");
    let ticks: Vec<i64> = before
        .split(' ')
        .take(3)
        .map(|s| s.parse().unwrap())
        .collect();

    // a constant changed, a method changed, a new method added
    let v2 = HERO_V1
        .replace("local STEP = 1", "local STEP = 10")
        .replace("return 'old'", "return self:extra()")
        .replace(
            "return Hero\n",
            "function Hero:extra() return 'new' end\nreturn Hero\n",
        );
    edit(&dir, "entities/hero.lua", &v2, 1);
    assert_eq!(
        game.hot_reload(),
        Reload::Kept {
            files: vec!["entities/hero.lua".into()]
        }
    );
    frames(&mut game, 1);
    let after = last_log(&game);
    let parts: Vec<&str> = after.split(' ').collect();
    assert_eq!(
        parts[0].parse::<i64>().unwrap(),
        ticks[0],
        "the same entity: {after}"
    );
    assert_eq!(
        parts[1].parse::<i64>().unwrap(),
        ticks[1] + 10,
        "its field kept, the new constant used: {after}"
    );
    assert_eq!(
        parts[2].parse::<i64>().unwrap(),
        ticks[2] + 1,
        "the module's table kept: {after}"
    );
    assert_eq!(parts[3], "new", "the new methods run: {after}");

    // a mistake in the new code: the old code keeps running
    edit(
        &dir,
        "entities/hero.lua",
        "local Hero = nova.entity {\nfunction",
        2,
    );
    match game.hot_reload() {
        Reload::Failed { file, error } => {
            assert_eq!(file, "entities/hero.lua");
            assert!(error.contains("hero.lua"), "{error}");
        }
        other => panic!("{other:?}"),
    }
    frames(&mut game, 1);
    assert!(last_log(&game).ends_with(" new"));
    assert!(game.error.is_none());

    // an error at run time, then fixed: the game carries on from where it was
    edit(
        &dir,
        "entities/hero.lua",
        &v2.replace("return 'new'", "return nil .. 'x'"),
        3,
    );
    assert!(matches!(game.hot_reload(), Reload::Kept { .. }));
    frames(&mut game, 1);
    assert!(game.error.is_some(), "the broken method stops the scripts");
    edit(
        &dir,
        "entities/hero.lua",
        &v2.replace("return 'new'", "return 'fixed'"),
        4,
    );
    assert!(matches!(game.hot_reload(), Reload::Kept { .. }));
    assert!(game.error.is_none(), "fixing it clears the error");
    frames(&mut game, 1);
    let fixed = last_log(&game);
    assert!(fixed.ends_with(" fixed"), "{fixed}");
    assert_eq!(
        fixed.split(' ').next().unwrap(),
        parts[0],
        "still the same entity"
    );

    // what cannot be swapped asks for a restart
    edit(&dir, "main.lua", "nova.start('play') -- changed\n", 5);
    match game.hot_reload() {
        Reload::Restart { reason } => assert!(reason.contains("main.lua"), "{reason}"),
        other => panic!("{other:?}"),
    }
}

#[test]
fn reload_restarts_for_files_that_are_not_code_or_modules_that_change_shape() {
    let dir = folder(
        "restart",
        &[
            ("nova.json", r#"{"format":1,"name":"Reload"}"#),
            (
                "main.lua",
                "local f = require('lib.f')\nfunction update() nova.log(tostring(f())) end\n",
            ),
            ("lib/f.lua", "return function() return 1 end\n"),
            ("scenes/a.scene.json", "{}"),
        ],
    );
    let vfs: Rc<dyn Vfs> = Rc::new(DirVfs::new(&dir.0).unwrap());
    let mut game = Game::load(vfs).unwrap();
    game.upload(&mut FakeGpu);
    frames(&mut game, 1);
    assert_eq!(game.hot_reload(), Reload::Nothing);
    // a Lua file nothing has loaded yet does not need anything
    std::fs::write(dir.0.join("lib/unused.lua"), "return {}").unwrap();
    assert_eq!(game.hot_reload(), Reload::Nothing);
    edit(&dir, "lib/f.lua", "return function() return 2 end\n", 1);
    match game.hot_reload() {
        Reload::Restart { reason } => assert!(
            reason.contains("lib/f.lua"),
            "a module that gives a function: {reason}"
        ),
        other => panic!("{other:?}"),
    }
    // (the host starts a new game after a restart; this one still sees the change above, so start fresh)
    let mut game = Game::load(Rc::new(DirVfs::new(&dir.0).unwrap())).unwrap();
    game.upload(&mut FakeGpu);
    edit(&dir, "scenes/a.scene.json", "{ }", 2);
    match game.hot_reload() {
        Reload::Restart { reason } => assert!(reason.contains("a.scene.json"), "{reason}"),
        other => panic!("{other:?}"),
    }
}

#[test]
fn subclasses_get_their_parents_new_methods() {
    let dir = folder(
        "inherit",
        &[
            ("nova.json", r#"{"format":1,"name":"Reload"}"#),
            ("main.lua", "nova.start('play')\n"),
            (
                "scenes/play.lua",
                "local P = nova.scene {}\nfunction P:enter() nova.spawn('slime', 0, 0) end\nreturn P\n",
            ),
            (
                "entities/enemy.lua",
                "local E = nova.entity {}\nfunction E:cry() return 'grr' end\nfunction E:update() nova.log(self:cry()) end\nreturn E\n",
            ),
            (
                "entities/slime.lua",
                "return nova.entity(require('entities.enemy'), {})\n",
            ),
        ],
    );
    let vfs: Rc<dyn Vfs> = Rc::new(DirVfs::new(&dir.0).unwrap());
    let mut game = Game::load(vfs).unwrap();
    game.upload(&mut FakeGpu);
    frames(&mut game, 2);
    assert_eq!(last_log(&game), "grr");
    edit(
        &dir,
        "entities/enemy.lua",
        "local E = nova.entity {}\nfunction E:cry() return 'blub' end\nfunction E:update() nova.log(self:cry()) end\nreturn E\n",
        1,
    );
    assert!(matches!(game.hot_reload(), Reload::Kept { .. }));
    frames(&mut game, 1);
    assert_eq!(
        last_log(&game),
        "blub",
        "the slime copied its parent's method when it was made; it has the new one now"
    );
}
