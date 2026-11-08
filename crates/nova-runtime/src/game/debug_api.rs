//! The game's side of the debugger (see `crate::debug` for the connection and `docs/debugger.md` for the messages):
//! pausing at breakpoints, steps and errors, answering questions about the paused stack and the running scene's
//! entities, and the hidden `devtools.lua` helpers that read locals with Lua's `debug` library.

use std::cell::Cell;
use std::collections::HashMap;
use std::rc::Rc;
use std::time::{Instant, SystemTime};

use mlua::{Function, Lua, Table, Value as LuaValue};
use serde_json::{Map, Value, json};

use super::{FRAME_BUDGET, Game, Reload};
use crate::debug::{DebugHandle, PROTOCOL, Step};

const DEVTOOLS: &str = include_str!("../../lua/devtools.lua");

/// The devtools helpers (`lua/devtools.lua`), loaded the first time they are needed with Lua's `debug` library, which
/// only they can reach (games never get a `debug` global).
pub(super) fn devtools(lua: &Lua) -> mlua::Result<Table> {
    if let Ok(t) = lua.named_registry_value::<Table>("nova.devtools") {
        return Ok(t);
    }
    // SAFETY: luaL_requiref runs luaopen_debug in protected mode and leaves the library's table on the stack, which
    // exec_raw returns. The table goes only to the devtools chunk below, never to a script.
    let debug: Table = unsafe {
        lua.exec_raw((), |state| {
            mlua::ffi::luaL_requiref(state, c"debug".as_ptr(), mlua::ffi::luaopen_debug, 0);
        })
    }?;
    let loaded: Table = lua.named_registry_value("nova.loaded")?;
    let d: Table = lua
        .load(DEVTOOLS)
        .set_name("=nova.devtools")
        .call((debug, loaded))?;
    lua.set_named_registry_value("nova.devtools", &d)?;
    Ok(d)
}

fn call(d: &Table, name: &str, args: impl mlua::IntoLuaMulti) -> Result<Value, String> {
    let f: Function = d.get(name).map_err(|e| e.to_string())?;
    let v: LuaValue = f.call(args).map_err(|e| first_line(&e.to_string()))?;
    Ok(to_json(&v, 0))
}

fn first_line(s: &str) -> String {
    s.lines().next().unwrap_or("").to_string()
}

/// A Lua value as JSON: tables with keys 1..n (and empty ones) are arrays, other tables objects.
pub(super) fn to_json(v: &LuaValue, depth: usize) -> Value {
    match v {
        LuaValue::Nil => Value::Null,
        LuaValue::Boolean(b) => Value::Bool(*b),
        LuaValue::Integer(i) => json!(*i),
        LuaValue::Number(n) => serde_json::Number::from_f64(*n).map_or(Value::Null, Value::Number),
        LuaValue::String(s) => Value::String(s.to_string_lossy()),
        LuaValue::Table(t) if depth < 12 => {
            let n = t.raw_len();
            let mut count = 0;
            let mut map = Map::new();
            for (k, v) in t.pairs::<LuaValue, LuaValue>().flatten() {
                count += 1;
                let key = match &k {
                    LuaValue::String(s) => s.to_string_lossy(),
                    LuaValue::Integer(i) => i.to_string(),
                    other => format!("{other:?}"),
                };
                map.insert(key, to_json(&v, depth + 1));
            }
            if count == n {
                let mut out = Vec::with_capacity(n);
                for i in 1..=n {
                    out.push(map.remove(&i.to_string()).unwrap_or(Value::Null));
                }
                Value::Array(out)
            } else {
                Value::Object(map)
            }
        }
        _ => Value::Null,
    }
}

fn to_lua(lua: &Lua, v: &Value) -> mlua::Result<LuaValue> {
    Ok(match v {
        Value::Null => LuaValue::Nil,
        Value::Bool(b) => LuaValue::Boolean(*b),
        Value::Number(n) => match n.as_i64() {
            Some(i) => LuaValue::Integer(i),
            None => LuaValue::Number(n.as_f64().unwrap_or(0.0)),
        },
        Value::String(s) => LuaValue::String(lua.create_string(s)?),
        _ => LuaValue::Nil,
    })
}

/// A number for the coroutine that is running now (to tell "the same coroutine" when stepping).
pub(super) fn thread_id(lua: &Lua) -> usize {
    lua.current_thread().to_pointer() as usize
}

/// How many frames the running coroutine has.
pub(super) fn stack_depth(lua: &Lua) -> usize {
    let mut n = 0;
    while lua.inspect_stack(n, |_| ()).is_some() {
        n += 1;
    }
    n
}

pub(super) enum Flow {
    Stay,
    Resume,
}

/// Answers one request. `paused` is the paused frame's depth while stopped, `thread` the paused coroutine.
pub(super) fn handle(
    lua: &Lua,
    d: &Table,
    dbg: &DebugHandle,
    msg: Value,
    paused: Option<usize>,
    thread: usize,
) -> Flow {
    let id = msg.get("id").cloned().unwrap_or(Value::Null);
    let cmd = msg.get("cmd").and_then(Value::as_str).unwrap_or("");
    let not_paused = || Err("the game is not paused".to_string());
    let mut flow = Flow::Stay;
    let result: Result<Value, String> = match cmd {
        "hello" | "ready" => {
            let g = dbg.borrow();
            Ok(json!({
                "protocol": PROTOCOL,
                "name": g.game_name,
                "paused": paused.is_some(),
                "pause_on_errors": g.pause_on_errors,
            }))
        }
        "set_breakpoints" => {
            let file = msg.get("file").and_then(Value::as_str).unwrap_or("");
            if file.is_empty() {
                Err("set_breakpoints needs a file".into())
            } else {
                let lines: Vec<u32> = msg
                    .get("lines")
                    .and_then(Value::as_array)
                    .map(|a| {
                        a.iter()
                            .filter_map(Value::as_u64)
                            .map(|l| l as u32)
                            .collect()
                    })
                    .unwrap_or_default();
                let set = dbg.borrow_mut().set_breakpoints(file, lines);
                Ok(json!({ "file": file, "lines": set }))
            }
        }
        "pause_on_errors" => {
            let on = msg.get("on").and_then(Value::as_bool).unwrap_or(true);
            dbg.borrow_mut().pause_on_errors = on;
            Ok(json!({ "on": on }))
        }
        "pause" => {
            if paused.is_none() {
                dbg.borrow_mut().step = Step::Into;
            }
            Ok(json!({}))
        }
        "continue" | "step_into" | "step_over" | "step_out" => match paused {
            None => not_paused(),
            Some(depth) => {
                let step = match cmd {
                    "step_into" => Step::Into,
                    "step_over" => Step::Over { thread, depth },
                    "step_out" => Step::Out { thread, depth },
                    _ => Step::None,
                };
                dbg.borrow_mut().step = step;
                flow = Flow::Resume;
                Ok(json!({}))
            }
        },
        "stack" => match paused {
            None => not_paused(),
            Some(depth) => call(d, "stack", depth),
        },
        "scope" => match paused {
            None => not_paused(),
            Some(top) => {
                let depth = msg
                    .get("depth")
                    .and_then(Value::as_u64)
                    .unwrap_or(top as u64) as usize;
                let which = msg.get("which").and_then(Value::as_str).unwrap_or("locals");
                if depth == 0 || depth > top {
                    Err(format!("there is no frame at depth {depth}"))
                } else if !matches!(which, "locals" | "upvalues" | "globals") {
                    Err(format!("'{which}' is not locals, upvalues or globals"))
                } else {
                    call(d, "scope", (depth, which.to_string()))
                }
            }
        },
        "children" => {
            let r = msg.get("ref").and_then(Value::as_i64).unwrap_or(0);
            call(d, "children", r).and_then(|v| {
                if v.is_null() {
                    Err("that value is no longer open (the game moved on); look again".into())
                } else {
                    Ok(v)
                }
            })
        }
        "entities" => call(d, "entities", ()),
        "entity" => {
            if paused.is_none() {
                let _ = call(d, "clear_refs", ());
            }
            let target = msg.get("target").and_then(Value::as_i64).unwrap_or(-1);
            call(d, "entity", target).and_then(|v| {
                if v.is_null() {
                    Err(format!("there is no entity #{target} now"))
                } else {
                    Ok(v)
                }
            })
        }
        "set" => {
            let key = msg.get("key").cloned().unwrap_or(Value::Null);
            let value = msg.get("value").cloned().unwrap_or(Value::Null);
            (|| -> Result<Value, String> {
                let target: LuaValue = if let Some(r) = msg.get("ref").and_then(Value::as_i64) {
                    let t = lua.create_table().map_err(|e| e.to_string())?;
                    t.set("ref", r).map_err(|e| e.to_string())?;
                    LuaValue::Table(t)
                } else {
                    LuaValue::Integer(msg.get("target").and_then(Value::as_i64).unwrap_or(-1))
                };
                let key = to_lua(lua, &key).map_err(|e| e.to_string())?;
                let value = to_lua(lua, &value).map_err(|e| e.to_string())?;
                let f: Function = d.get("set").map_err(|e| e.to_string())?;
                let (out, err): (LuaValue, Option<String>) = f
                    .call((target, key, value))
                    .map_err(|e| first_line(&e.to_string()))?;
                match err {
                    Some(e) => Err(e),
                    None => Ok(to_json(&out, 0)),
                }
            })()
        }
        "highlight" => {
            let target = msg.get("target").and_then(Value::as_i64);
            call(d, "set_highlight", target).map(|_| json!({ "target": target }))
        }
        "" => Err("a request needs a 'cmd'".into()),
        other => Err(format!("unknown request '{other}'")),
    };
    dbg.borrow_mut().reply(&id, result);
    flow
}

/// Stops the game here and answers the studio until it says to go on. `depth` is the paused frame's depth from the
/// bottom of the running coroutine's stack. Returns at once if no studio is connected.
pub(super) fn pause(
    lua: &Lua,
    dbg: &DebugHandle,
    reason: &str,
    depth: usize,
    message: Option<String>,
) -> mlua::Result<()> {
    if !dbg.borrow().connected() {
        return Ok(());
    }
    let d = devtools(lua)?;
    let _ = call(&d, "clear_refs", ());
    let stack = call(&d, "stack", depth).unwrap_or(Value::Array(Vec::new()));
    let top = stack.get(0).cloned().unwrap_or(Value::Null);
    {
        let mut g = dbg.borrow_mut();
        g.paused = Some(depth);
        g.step = Step::None;
        g.event(
            "paused",
            json!({
                "reason": reason,
                "message": message,
                "file": top.get("file"),
                "line": top.get("line"),
                "stack": stack,
            }),
        );
    }
    log::info!(
        "debugger: paused ({reason}) at {}:{}",
        top.get("file").and_then(Value::as_str).unwrap_or("?"),
        top.get("line").and_then(Value::as_i64).unwrap_or(0)
    );
    let thread = thread_id(lua);
    loop {
        let msg = dbg.borrow_mut().wait(None);
        let Some(msg) = msg else {
            break; // the studio went away: carry on
        };
        if let Flow::Resume = handle(lua, &d, dbg, msg, Some(depth), thread) {
            break;
        }
    }
    let mut g = dbg.borrow_mut();
    g.paused = None;
    g.event("resumed", json!({}));
    Ok(())
}

/// The line hook: stops at a breakpoint or where a step ends. Only lines of project files (`@path` chunks) count, so
/// stepping goes through the framework without stopping in it.
pub(super) fn on_line(
    lua: &Lua,
    debug: &mlua::debug::Debug,
    dbg: &DebugHandle,
    deadline: &Rc<Cell<Option<Instant>>>,
) -> mlua::Result<()> {
    let Some(line) = debug.current_line() else {
        return Ok(());
    };
    let line = line as u32;
    let (step, maybe) = {
        let g = dbg.borrow();
        if g.paused.is_some() {
            return Ok(());
        }
        (g.step, g.any_breakpoint_on(line))
    };
    if step == Step::None && !maybe {
        return Ok(());
    }
    let source = debug.source();
    let Some(file) = source.source.as_deref().and_then(|s| s.strip_prefix('@')) else {
        return Ok(());
    };
    let hit = maybe && dbg.borrow().has_breakpoint(file, line);
    let stop = hit
        || match step {
            Step::None => false,
            Step::Into => true,
            Step::Over { thread, depth } => thread_id(lua) == thread && stack_depth(lua) <= depth,
            Step::Out { thread, depth } => thread_id(lua) == thread && stack_depth(lua) < depth,
        };
    if !stop {
        return Ok(());
    }
    let depth = stack_depth(lua);
    let reason = if hit { "breakpoint" } else { "step" };
    pause(lua, dbg, reason, depth, None)?;
    // the time stopped does not count against the frame's limit
    if deadline.get().is_some() {
        deadline.set(Some(Instant::now() + FRAME_BUDGET));
    }
    Ok(())
}

/// The Lua function the error handler calls: pause at the failing frame (if the studio wants that).
pub(super) fn error_pauser(
    lua: &Lua,
    dbg: DebugHandle,
    deadline: Rc<Cell<Option<Instant>>>,
) -> mlua::Result<Function> {
    lua.create_function(move |lua, (message, depth): (String, usize)| {
        let wanted = {
            let g = dbg.borrow();
            g.pause_on_errors && g.connected() && g.paused.is_none()
        };
        if wanted {
            let limit = deadline.replace(None);
            pause(lua, &dbg, "error", depth, Some(message))?;
            deadline.set(limit.map(|_| Instant::now() + FRAME_BUDGET));
        }
        Ok(())
    })
}

/// Calls `f(args)` through the devtools error guard when there is one (so an error pauses where it happened), plainly
/// otherwise.
pub(super) fn call_guarded(
    lua: &Lua,
    guard: Option<&Function>,
    f: &Function,
    args: impl mlua::IntoLuaMulti,
) -> mlua::Result<()> {
    match guard {
        None => f.call::<()>(args),
        Some(g) => {
            let mut all = mlua::MultiValue::new();
            all.push_back(LuaValue::Function(f.clone()));
            for v in args.into_lua_multi(lua)? {
                all.push_back(v);
            }
            let (ok, err): (bool, LuaValue) = g.call(all)?;
            if ok {
                Ok(())
            } else {
                let text = match &err {
                    LuaValue::String(s) => s.to_string_lossy(),
                    other => format!("{other:?}"),
                };
                Err(mlua::Error::runtime(text))
            }
        }
    }
}

/// Each project file's modification time (empty for sources that cannot tell, such as packed games).
pub(super) fn file_times(vfs: &dyn crate::vfs::Vfs) -> HashMap<String, Option<SystemTime>> {
    if vfs.stamp().is_none() {
        return HashMap::new();
    }
    vfs.list()
        .map(|list| {
            list.into_iter()
                .map(|e| {
                    let t = vfs.modified(&e.path);
                    (e.path, t)
                })
                .collect()
        })
        .unwrap_or_default()
}

impl Game {
    /// The debugger connection this game was loaded with, if any.
    pub fn debugger(&self) -> Option<DebugHandle> {
        self.debugger.clone()
    }

    /// Answers what the studio asked since the last frame and switches line hooks on or off as needed.
    pub(super) fn debug_frame(&mut self) {
        let Some(dbg) = self.debugger.clone() else {
            return;
        };
        let d = match devtools(&self.lua) {
            Ok(d) => d,
            Err(e) => {
                log::warn!("debugger: devtools: {e}");
                return;
            }
        };
        loop {
            let msg = dbg.borrow_mut().next_message();
            let Some(msg) = msg else {
                break;
            };
            handle(&self.lua, &d, &dbg, msg, None, 0);
        }
        self.sync_line_hooks();
    }

    /// `--debug-wait`: before the entry script runs, give the studio time to connect and send its breakpoints.
    pub(super) fn wait_for_studio(&mut self) {
        let Some(dbg) = self.debugger.clone() else {
            return;
        };
        let wait = {
            let mut g = dbg.borrow_mut();
            g.game_name = self.project.manifest.name.clone();
            g.wait_at_start.take()
        };
        if let Some(limit) = wait
            && let Ok(d) = devtools(&self.lua)
        {
            log::info!(
                "debugger: waiting up to {:.0} s for the studio before starting",
                limit.as_secs_f32()
            );
            let until = Instant::now() + limit;
            loop {
                let left = until.saturating_duration_since(Instant::now());
                if left.is_zero() {
                    log::info!("debugger: no studio said it was ready; starting");
                    break;
                }
                let msg = dbg.borrow_mut().wait(Some(left));
                let Some(msg) = msg else {
                    continue;
                };
                let ready = msg.get("cmd").and_then(Value::as_str) == Some("ready");
                handle(&self.lua, &d, &dbg, msg, None, 0);
                if ready {
                    break;
                }
            }
        }
        self.sync_line_hooks();
    }

    pub(super) fn sync_line_hooks(&mut self) {
        let want = self
            .debugger
            .as_ref()
            .is_some_and(|d| d.borrow().wants_lines());
        if want != self.lines_on {
            self.reinstall_hook(want);
        }
    }

    /// Puts the hook back with or without line events, on the main thread and on every coroutine the game has.
    pub(super) fn reinstall_hook(&mut self, lines: bool) {
        let threads: Vec<mlua::Thread> = if self.debugger.is_some() {
            devtools(&self.lua)
                .and_then(|d| d.get::<Function>("threads")?.call(()))
                .unwrap_or_default()
        } else {
            Vec::new()
        };
        let (deadline, profile) = {
            let sh = self.shared.borrow();
            (sh.deadline.clone(), sh.profile.clone())
        };
        if let Err(e) = super::install_hook_with(
            &self.lua,
            deadline,
            profile,
            self.profiling,
            self.debugger.clone(),
            lines,
            &threads,
        ) {
            log::warn!("debugger: cannot change the script hook: {e}");
        }
        self.lines_on = lines;
    }

    /// The entity the studio picked, outlined over the game.
    pub(super) fn draw_highlight(&mut self) {
        let result =
            devtools(&self.lua).and_then(|d| d.get::<Function>("draw_highlight")?.call::<()>(()));
        if let Err(e) = result {
            log::warn!("debugger: highlight: {}", first_line(&e.to_string()));
        }
    }

    /// Tells the studio something happened (no-op without a debugger).
    pub fn debug_event(&self, name: &str, fields: Value) {
        if let Some(dbg) = &self.debugger {
            dbg.borrow_mut().event(name, fields);
        }
    }

    /// Call when `changed_on_disk` says files changed. When only the code of modules (files loaded with `require`)
    /// changed, their new functions are swapped into the running game and its state (entities, the scene, timers,
    /// module-level tables) carries on; anything else gives `Reload::Restart` and the host starts the game again.
    pub fn hot_reload(&mut self) -> Reload {
        let now = file_times(self.vfs.as_ref());
        if now.is_empty() {
            return Reload::Restart {
                reason: "this project cannot tell which file changed".into(),
            };
        }
        let mut changed: Vec<String> = now
            .iter()
            .filter(|(path, t)| self.files.get(*path) != Some(*t))
            .map(|(path, _)| path.clone())
            .collect();
        changed.extend(self.files.keys().filter(|p| !now.contains_key(*p)).cloned());
        changed.sort();
        changed.dedup();
        if changed.is_empty() {
            return Reload::Nothing;
        }
        let restart = |reason: String| Reload::Restart { reason };
        if self.error_at_load {
            return restart("the game had stopped while starting".into());
        }
        if let Some(other) = changed.iter().find(|p| !p.ends_with(".lua")) {
            return restart(format!(
                "{other} changed (only Lua code can go into a running game)"
            ));
        }
        let entry = self.project.manifest.entry.clone();
        if changed.contains(&entry) {
            return restart(format!(
                "{entry} changed, and it runs once when the game starts"
            ));
        }
        let lua = self.lua.clone();
        let (loaded, paths) = match (
            lua.named_registry_value::<Table>("nova.loaded"),
            lua.named_registry_value::<Table>("nova.module_paths"),
        ) {
            (Ok(l), Ok(p)) => (l, p),
            _ => return restart("the game's modules are not known".into()),
        };
        let mut modules: Vec<(String, String)> = paths
            .pairs::<String, String>()
            .flatten()
            .filter(|(_, path)| changed.contains(path))
            .collect();
        modules.sort();
        if let Some((_, gone)) = modules.iter().find(|(_, p)| !now.contains_key(p)) {
            return restart(format!("{gone} was removed"));
        }
        if modules.is_empty() {
            // Lua files the game has not loaded: they are read fresh when first required
            self.files = now;
            return Reload::Nothing;
        }
        self.deadline.set(Some(Instant::now() + super::LOAD_BUDGET));
        let result = self.swap_modules(&lua, &loaded, &modules);
        self.deadline.set(None);
        match result {
            Ok(()) => {
                self.files = now;
                if self.error.take().is_some() {
                    self.error_detail = None;
                    log::info!("the error is gone with the new code: the game carries on");
                }
                Reload::Kept {
                    files: modules.into_iter().map(|(_, p)| p).collect(),
                }
            }
            Err(SwapError::Failed { file, error }) => {
                self.files = now; // (tried once per change; the next save tries again)
                Reload::Failed { file, error }
            }
            Err(SwapError::Restart(reason)) => restart(reason),
        }
    }

    fn swap_modules(
        &mut self,
        lua: &Lua,
        loaded: &Table,
        modules: &[(String, String)],
    ) -> Result<(), SwapError> {
        let lua_error = |file: &str, e: mlua::Error| SwapError::Failed {
            file: file.to_string(),
            error: first_line(&e.to_string()),
        };
        // run every new version first: nothing is changed unless all of them load
        let mut news = Vec::new();
        for (name, path) in modules {
            let source = self
                .vfs
                .read(path)
                .and_then(|b| {
                    String::from_utf8(b).map_err(|_| format!("{path} is not valid UTF-8"))
                })
                .map_err(|error| SwapError::Failed {
                    file: path.clone(),
                    error,
                })?;
            let value: LuaValue = lua
                .load(&source)
                .set_name(format!("@{path}"))
                .call(())
                .map_err(|e| lua_error(path, e))?;
            let value = if value.is_nil() {
                LuaValue::Boolean(true)
            } else {
                value
            };
            let old: LuaValue = loaded.get(name.as_str()).map_err(|e| lua_error(path, e))?;
            if old.type_name() != value.type_name() {
                return Err(SwapError::Restart(format!(
                    "{path} now gives a {} instead of a {}",
                    value.type_name(),
                    old.type_name()
                )));
            }
            if !matches!(old, LuaValue::Table(_))
                && old != value
                && !matches!(old, LuaValue::Boolean(true))
            {
                return Err(SwapError::Restart(format!(
                    "{path} gives a {}, which other code may hold on to",
                    old.type_name()
                )));
            }
            news.push((path.clone(), old, value));
        }
        let d = devtools(lua).map_err(|e| SwapError::Restart(e.to_string()))?;
        let swap: Function = d
            .get("swap")
            .map_err(|e| SwapError::Restart(e.to_string()))?;
        let retarget: Function = d
            .get("retarget")
            .map_err(|e| SwapError::Restart(e.to_string()))?;
        let replaced = lua
            .create_table()
            .map_err(|e| SwapError::Restart(e.to_string()))?;
        let changed = lua
            .create_table()
            .map_err(|e| SwapError::Restart(e.to_string()))?;
        for (path, old, new) in &news {
            if !matches!(old, LuaValue::Table(_)) {
                continue; // a module that gives `true`: running it again was all there was to do
            }
            let (ok, why): (bool, Option<String>) = swap
                .call((old.clone(), new.clone(), &replaced))
                .map_err(|e| {
                    SwapError::Restart(format!("{path}: {}", first_line(&e.to_string())))
                })?;
            if !ok {
                return Err(SwapError::Restart(format!(
                    "{path}: {}",
                    why.unwrap_or_default()
                )));
            }
            let _ = changed.set(old.clone(), true);
        }
        let problems: Vec<String> = retarget
            .call((&replaced, &changed))
            .map_err(|e| SwapError::Restart(first_line(&e.to_string())))?;
        if let Some(p) = problems.into_iter().next() {
            return Err(SwapError::Failed {
                file: news[0].0.clone(),
                error: p,
            });
        }
        Ok(())
    }
}

enum SwapError {
    Failed { file: String, error: String },
    Restart(String),
}
