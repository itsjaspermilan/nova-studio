//! Lua gameplay host. Lua owns game rules; the engine owns drawing and heavy loops.
//! The surface here is deliberately tiny: it is the M1 spike API, not the final one.

use std::cell::RefCell;
use std::path::PathBuf;
use std::rc::Rc;
use std::time::{Duration, Instant, SystemTime};

use mlua::{Function, Lua};

use crate::input::Actions;

#[derive(Clone, Debug)]
pub struct ScriptState {
    pub actions: Actions,
    pub action_pressed: bool,
    pub car: [f32; 3], // x, z, heading
    pub camera: [f32; 6],
    pub sprite_count: usize,
    pub car_count: usize,
    pub log: Vec<String>,
}

impl Default for ScriptState {
    fn default() -> Self {
        Self {
            actions: Actions::default(),
            action_pressed: false,
            car: [0.0, 0.0, 0.0],
            camera: [0.0, 6.0, -10.0, 0.0, 1.0, 0.0],
            sprite_count: 0,
            car_count: 0,
            log: Vec::new(),
        }
    }
}

pub struct ScriptHost {
    lua: Lua,
    state: Rc<RefCell<ScriptState>>,
    source: String,
    chunk: String,
    watch: Option<(PathBuf, Option<SystemTime>, Instant)>,
    pub error: Option<String>,
    pub last_update: Duration,
}

/// Lua with only the pure libraries. No io/os/package/debug, and the base functions
/// that read files are removed. This is a stability boundary for hand-written game
/// scripts, not a hostile-code sandbox (limits on time and memory arrive in M2).
fn new_lua() -> Lua {
    let libs = mlua::StdLib::MATH
        | mlua::StdLib::STRING
        | mlua::StdLib::TABLE
        | mlua::StdLib::UTF8
        | mlua::StdLib::COROUTINE;
    let lua = Lua::new_with(libs, mlua::LuaOptions::new()).expect("lua with pure libraries");
    for name in ["dofile", "loadfile", "require", "collectgarbage"] {
        lua.globals()
            .set(name, mlua::Value::Nil)
            .expect("remove base function");
    }
    lua
}

fn register(lua: &Lua, state: &Rc<RefCell<ScriptState>>) -> mlua::Result<()> {
    let nova = lua.create_table()?;

    let input = lua.create_table()?;
    let s = state.clone();
    input.set(
        "axis",
        lua.create_function(move |_, name: String| {
            let a = s.borrow().actions;
            match name.as_str() {
                "steer" => Ok(a.steer as f64),
                "throttle" => Ok(a.throttle as f64),
                "brake" => Ok(a.brake as f64),
                "action" => Ok(if a.action { 1.0 } else { 0.0 }),
                other => Err(mlua::Error::runtime(format!(
                    "unknown input action '{other}' (steer, throttle, brake, action)"
                ))),
            }
        })?,
    )?;
    let s = state.clone();
    input.set(
        "down",
        lua.create_function(move |_, name: String| {
            let a = s.borrow().actions;
            match name.as_str() {
                "steer" => Ok(a.steer != 0.0),
                "throttle" => Ok(a.throttle > 0.0),
                "brake" => Ok(a.brake > 0.0),
                "action" => Ok(a.action),
                other => Err(mlua::Error::runtime(format!(
                    "unknown input action '{other}'"
                ))),
            }
        })?,
    )?;
    let s = state.clone();
    input.set(
        "pressed",
        lua.create_function(move |_, name: String| match name.as_str() {
            "action" => Ok(s.borrow().action_pressed),
            other => Err(mlua::Error::runtime(format!(
                "'{other}' has no pressed edge yet (only 'action')"
            ))),
        })?,
    )?;
    nova.set("input", input)?;

    let car = lua.create_table()?;
    let s = state.clone();
    car.set(
        "set",
        lua.create_function(move |_, (x, z, heading): (f64, f64, f64)| {
            s.borrow_mut().car = [x as f32, z as f32, heading as f32];
            Ok(())
        })?,
    )?;
    nova.set("car", car)?;

    let camera = lua.create_table()?;
    let s = state.clone();
    camera.set(
        "set",
        lua.create_function(move |_, v: (f64, f64, f64, f64, f64, f64)| {
            s.borrow_mut().camera = [
                v.0 as f32, v.1 as f32, v.2 as f32, v.3 as f32, v.4 as f32, v.5 as f32,
            ];
            Ok(())
        })?,
    )?;
    nova.set("camera", camera)?;

    let spike = lua.create_table()?;
    let s = state.clone();
    spike.set(
        "set_sprites",
        lua.create_function(move |_, n: usize| {
            s.borrow_mut().sprite_count = n.min(200_000);
            Ok(())
        })?,
    )?;
    let s = state.clone();
    spike.set(
        "set_cars",
        lua.create_function(move |_, n: usize| {
            s.borrow_mut().car_count = n.min(5_000);
            Ok(())
        })?,
    )?;
    nova.set("spike", spike)?;

    let s = state.clone();
    nova.set(
        "log",
        lua.create_function(move |_, message: String| {
            log::info!("lua: {message}");
            s.borrow_mut().log.push(message);
            Ok(())
        })?,
    )?;
    lua.globals().set("nova", nova)?;
    Ok(())
}

impl ScriptHost {
    pub fn new(source: String, chunk: String, watch: Option<PathBuf>) -> Self {
        let mtime = watch
            .as_ref()
            .and_then(|p| std::fs::metadata(p).and_then(|m| m.modified()).ok());
        let mut host = Self {
            lua: new_lua(),
            state: Rc::new(RefCell::new(ScriptState::default())),
            source,
            chunk,
            watch: watch.map(|p| (p, mtime, Instant::now())),
            error: None,
            last_update: Duration::ZERO,
        };
        host.load();
        host
    }

    pub fn state(&self) -> ScriptState {
        self.state.borrow().clone()
    }

    pub fn take_log(&self) -> Vec<String> {
        std::mem::take(&mut self.state.borrow_mut().log)
    }

    /// Restarts the Lua state from `self.source`. Engine-side state (sprites, cars) is
    /// re-declared by `init`. On error the previous pose is kept and the error is shown.
    fn load(&mut self) {
        let lua = new_lua();
        let state = Rc::new(RefCell::new(ScriptState::default()));
        let result = (|| -> mlua::Result<()> {
            register(&lua, &state)?;
            lua.load(&self.source).set_name(&self.chunk).exec()?;
            if let Ok(init) = lua.globals().get::<Function>("init") {
                init.call::<()>(())?;
            }
            Ok(())
        })();
        match result {
            Ok(()) => {
                self.error = None;
                self.lua = lua;
                self.state = state;
            }
            Err(e) => {
                log::error!("script error: {e}");
                self.error = Some(first_line(&e.to_string()));
            }
        }
    }

    fn check_reload(&mut self) {
        let Some((path, mtime, checked)) = self.watch.as_mut() else {
            return;
        };
        if checked.elapsed() < Duration::from_millis(400) {
            return;
        }
        *checked = Instant::now();
        let modified = std::fs::metadata(&*path).and_then(|m| m.modified()).ok();
        if modified.is_some() && modified != *mtime {
            *mtime = modified;
            match std::fs::read_to_string(&*path) {
                Ok(source) => {
                    log::info!("reloading {}", path.display());
                    self.source = source;
                    self.load();
                }
                Err(e) => self.error = Some(format!("cannot read script: {e}")),
            }
        }
    }

    pub fn update(&mut self, dt: f32, actions: Actions, action_pressed: bool) {
        self.check_reload();
        {
            let mut s = self.state.borrow_mut();
            s.actions = actions;
            s.action_pressed = action_pressed;
        }
        if self.error.is_some() {
            return;
        }
        let started = Instant::now();
        let result = match self.lua.globals().get::<Function>("update") {
            Ok(update) => update.call::<()>(dt),
            Err(_) => Ok(()),
        };
        self.last_update = started.elapsed();
        if let Err(e) = result {
            log::error!("script error: {e}");
            self.error = Some(first_line(&e.to_string()));
        }
    }
}

fn first_line(text: &str) -> String {
    text.lines().next().unwrap_or("script error").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn host(source: &str) -> ScriptHost {
        ScriptHost::new(source.to_string(), "test.lua".into(), None)
    }

    #[test]
    fn update_moves_the_car_from_input() {
        let mut h =
            host("function update(dt) nova.car.set(nova.input.axis('throttle') * dt, 0, 0) end");
        h.update(
            0.5,
            Actions {
                throttle: 1.0,
                ..Default::default()
            },
            false,
        );
        assert!((h.state().car[0] - 0.5).abs() < 1e-6);
        assert!(h.error.is_none());
    }

    #[test]
    fn init_declares_engine_side_counts() {
        let h = host("function init() nova.spike.set_sprites(1234) nova.spike.set_cars(7) end");
        let s = h.state();
        assert_eq!((s.sprite_count, s.car_count), (1234, 7));
    }

    #[test]
    fn runtime_errors_are_reported_and_stop_updates() {
        let mut h = host("function update(dt) nova.input.axis('nope') end");
        h.update(0.016, Actions::default(), false);
        let error = h.error.clone().expect("error recorded");
        assert!(error.contains("unknown input action 'nope'"), "{error}");
    }

    #[test]
    fn syntax_errors_keep_the_previous_state() {
        let mut h = host("function update(dt) nova.car.set(1, 2, 3) end");
        h.update(0.016, Actions::default(), false);
        h.source = "this is not lua".into();
        h.load();
        assert!(h.error.is_some());
        assert_eq!(h.state().car, [1.0, 2.0, 3.0]);
    }

    #[test]
    fn edited_scripts_hot_reload_and_bad_edits_report_errors() {
        let path = std::env::temp_dir().join(format!("nova-reload-{}.lua", std::process::id()));
        std::fs::write(&path, "function update(dt) nova.car.set(1, 0, 0) end").unwrap();
        let mut h = ScriptHost::new(
            std::fs::read_to_string(&path).unwrap(),
            "reload.lua".into(),
            Some(path.clone()),
        );
        h.update(0.016, Actions::default(), false);
        assert_eq!(h.state().car[0], 1.0);

        std::thread::sleep(Duration::from_millis(450));
        std::fs::write(&path, "function update(dt) nova.car.set(2, 0, 0) end").unwrap();
        // File timestamps can have coarse resolution; make the change visible regardless.
        let later = SystemTime::now() + Duration::from_secs(5);
        std::fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_modified(later)
            .unwrap();
        h.update(0.016, Actions::default(), false);
        assert_eq!(
            h.state().car[0],
            2.0,
            "reloaded script runs in the same update"
        );

        std::thread::sleep(Duration::from_millis(450));
        std::fs::write(&path, "function update(dt) +++").unwrap();
        let later = SystemTime::now() + Duration::from_secs(10);
        std::fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_modified(later)
            .unwrap();
        h.update(0.016, Actions::default(), false);
        assert!(h.error.is_some(), "a syntax error is reported");
        assert_eq!(h.state().car[0], 2.0, "the last good state stays");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn lua_has_no_filesystem_process_or_loader_access() {
        let mut h = host(
            "function update(dt) \
               for _, name in ipairs({'io','os','package','debug','dofile','loadfile','require'}) do \
                 if _G[name] ~= nil then error(name .. ' is exposed') end \
               end \
               nova.car.set(1, 0, 0) \
             end",
        );
        h.update(0.016, Actions::default(), false);
        assert!(h.error.is_none(), "{:?}", h.error);
        assert_eq!(h.state().car[0], 1.0);
    }
}
