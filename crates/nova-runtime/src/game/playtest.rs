//! What a scripted headless run (`nova run --headless --play plan.json`, see `crate::playtest`) asks of a game from
//! outside: start in a named scene, run a piece of Lua once, read a value, and say what is on screen.

use mlua::{Function, Table, Value as LuaValue};
use serde_json::Value;

use super::{Game, debug_api};

/// Helpers the run uses, loaded once: `show(expr)` gives the value of a Lua expression as short text, `truth(expr)`
/// whether it holds, `scene(name)` makes the framework start in a scene, `snapshot()` lists what is alive.
const HELPERS: &str = r#"
local loaded = ...
local H = {}

local function class_name(cls)
  local seen = 0
  while type(cls) == "table" and seen < 8 do
    for name, value in pairs(loaded) do
      if value == cls then return (name:gsub("^entities%.", ""):gsub("^scenes%.", "")) end
    end
    cls = rawget(cls, "__parent")
    seen = seen + 1
  end
  return nil
end

local function num(v)
  if v == math.floor(v) and math.abs(v) < 1e15 then return string.format("%d", v) end
  return (string.format("%.3f", v):gsub("0+$", ""):gsub("%.$", ""))
end

-- An entity of a 3D game: it draws a model, or stands somewhere off the z = 0 plane.
local function three_d(e)
  local z = e.z
  return (rawget(e, "model") or (getmetatable(e) or {}).__model) ~= nil or (type(z) == "number" and z ~= 0)
end

local function show(v, depth)
  local t = type(v)
  if t == "number" then return num(v) end
  if t == "string" then return depth > 0 and string.format("%q", v) or v end
  if t ~= "table" then return tostring(v) end
  if rawget(getmetatable(v) or {}, "__kind") == "entity" then
    return "<" .. (class_name(getmetatable(v)) or "entity") .. " at " .. num(v.x or 0) .. ", " .. num(v.y or 0) .. (three_d(v) and (", " .. num(v.z or 0)) or "") .. (rawget(v, "_dead") and " (destroyed)" or "") .. ">"
  end
  if depth >= 2 then return "{...}" end
  local parts, n = {}, 0
  for i = 1, #v do
    n = n + 1
    if n > 12 then parts[#parts + 1] = "..."; break end
    parts[#parts + 1] = show(v[i], depth + 1)
  end
  local keys = {}
  for k in pairs(v) do
    if not (type(k) == "number" and k >= 1 and k <= #v and k == math.floor(k)) and not (type(k) == "string" and k:sub(1, 1) == "_") then keys[#keys + 1] = k end
  end
  table.sort(keys, function(a, b) return tostring(a) < tostring(b) end)
  for _, k in ipairs(keys) do
    n = n + 1
    if n > 16 then parts[#parts + 1] = "..."; break end
    local value = v[k]
    if type(value) ~= "function" then parts[#parts + 1] = tostring(k) .. " = " .. show(value, depth + 1) end
  end
  return "{ " .. table.concat(parts, ", ") .. " }"
end

local function compile(expr)
  local f, err = load("return " .. expr, "=expression")
  if not f then f, err = load(expr, "=expression") end
  if not f then error(err, 0) end
  return f
end

function H.show(expr)
  local results = table.pack(compile(expr)())
  if results.n == 0 then return "nil" end
  local out = {}
  for i = 1, results.n do out[i] = show(results[i], 0) end
  return table.concat(out, ", ")
end

function H.truth(expr)
  return compile(expr)() and true or false
end

function H.scene(name)
  local W = nova.world
  if not (W and W.started) then error("this project does not call nova.start, so it has no scenes to start in", 0) end
  W.pending = { name = name, args = { n = 0 } }
end

function H.snapshot()
  local W = nova.world
  local out = { entities = {} }
  if not (W and W.started) then return out end
  out.scene = W.scene_name and (W.scene_name:gsub("^scenes%.", "")) or nil
  out.camera = { W.cam.x, W.cam.y }
  local vw, vh = nova.view()
  out.view = { vw, vh }
  out.count = #W.list
  local labels = {}
  if W.scene then
    for k, v in pairs(W.scene) do
      if type(k) == "string" and type(v) == "table" and labels[v] == nil then labels[v] = k end
    end
  end
  for _, e in ipairs(W.list) do
    if not rawget(e, "_dead") then
      local cls = getmetatable(e) or {}
      local kind = class_name(cls) or (cls == nova.Picture and "picture") or (cls == nova.Text and "text") or (rawget(e, "map") and "tilemap") or "entity"
      if kind ~= "tilemap" and kind ~= "picture" and kind ~= "text" or labels[e] then
        local item = { kind = kind, name = labels[e], id = rawget(e, "id"), x = e.x, y = e.y }
        if three_d(e) then item.z = e.z or 0 end
        local a = rawget(e, "_anim")
        if a then item.anim = a.tag end
        if type(e.frame) == "number" and e.frame ~= 0 then item.frame = e.frame end
        if e.visible == false then item.hidden = true end
        if type(e.x) == "number" and type(e.y) == "number" then out.entities[#out.entities + 1] = item end
        if #out.entities >= 400 then break end
      end
    end
  end
  return out
end

-- Who a walk_to step steers and where it is: x and the other ground coordinate (y in a flat game, z in a 3D one).
function H.walker(who, plane)
  local W = nova.world
  if not (W and W.started) then error("this project does not call nova.start, so it has no entities to walk", 0) end
  local e
  if who then
    e = nova.named(who) or nova.first(who)
    if not e then error("there is no entity named or tagged '" .. tostring(who) .. "' in this scene (\"who\" is a scene object's name or a tag)", 0) end
  else
    e = nova.named("hero") or nova.named("player") or nova.first("hero") or nova.first("player") or W.cam.follow
    who = e and (rawget(e, "name") or class_name(getmetatable(e)) or "the camera's target")
    if not e then error("say who walks: \"who\" is a scene object's name or a tag (nothing here is named or tagged hero or player, and the 2D camera follows nothing)", 0) end
  end
  if rawget(e, "_dead") then error("'" .. tostring(who) .. "' has been destroyed", 0) end
  plane = plane or (three_d(e) and "xz" or "xy")
  local a, b = e.x, plane == "xz" and e.z or e.y
  if type(a) ~= "number" or type(b) ~= "number" then error("'" .. tostring(who) .. "' has no position", 0) end
  return a, b, plane, tostring(who)
end

return H
"#;

fn first_line(s: &str) -> String {
    let line = s.lines().next().unwrap_or("");
    line.strip_prefix("runtime error: ")
        .unwrap_or(line)
        .to_string()
}

impl Game {
    fn playtest_helpers(&self) -> Result<Table, String> {
        if let Ok(t) = self.lua.named_registry_value::<Table>("nova.playtest") {
            return Ok(t);
        }
        let loaded: Table = self
            .lua
            .named_registry_value("nova.loaded")
            .map_err(|e| e.to_string())?;
        let t: Table = self
            .lua
            .load(HELPERS)
            .set_name("=nova.playtest")
            .call(loaded)
            .map_err(|e| e.to_string())?;
        self.lua
            .set_named_registry_value("nova.playtest", &t)
            .map_err(|e| e.to_string())?;
        Ok(t)
    }

    fn playtest_call<R: mlua::FromLuaMulti>(
        &self,
        name: &str,
        args: impl mlua::IntoLuaMulti,
    ) -> Result<R, String> {
        let f: Function = self
            .playtest_helpers()?
            .get(name)
            .map_err(|e| e.to_string())?;
        f.call(args).map_err(|e| first_line(&e.to_string()))
    }

    /// Makes the framework start in this scene instead of the one `main.lua` named (`nova run --start-scene`). Call it
    /// before the first frame.
    pub fn start_in_scene(&self, name: &str) -> Result<(), String> {
        self.playtest_call("scene", name)
    }

    /// Runs a piece of Lua in the game, as if a script of the project had (`nova run --run-lua`, a plan's `lua`).
    pub fn run_lua(&self, source: &str, name: &str) -> Result<(), String> {
        self.lua
            .load(source)
            .set_name(format!("={name}"))
            .exec()
            .map_err(|e| first_line(&e.to_string()))
    }

    /// The value of a Lua expression as short text (`hero.x`, `nova.count("enemy")`, a table, an entity).
    pub fn lua_text(&self, expression: &str) -> Result<String, String> {
        self.playtest_call("show", expression)
    }

    /// Whether a Lua expression holds (anything but `false` and `nil`).
    pub fn lua_truth(&self, expression: &str) -> Result<bool, String> {
        self.playtest_call("truth", expression)
    }

    /// What is on screen, for a reader with no eyes: the scene's name, the camera, and the living entities with their
    /// kind, the name the scene file gave them and where they are. Empty for a game that does not use the framework.
    pub fn snapshot(&self) -> Value {
        match self.playtest_call::<LuaValue>("snapshot", ()) {
            Ok(v) => debug_api::to_json(&v, 0),
            Err(e) => serde_json::json!({ "error": e, "entities": [] }),
        }
    }

    /// Where the entity a `walk_to` step steers is: its two ground coordinates, the plane they are in (`xy` or `xz`) and
    /// what it is called. `who` is a scene object's name or a tag; left out, the hero or player.
    pub fn walker(
        &self,
        who: Option<&str>,
        plane: Option<&str>,
    ) -> Result<(f64, f64, String, String), String> {
        self.playtest_call("walker", (who, plane))
    }

    /// Every input action the game knows (`nova.input.actions()`).
    pub fn action_names(&self) -> Vec<String> {
        self.shared
            .borrow()
            .bindings
            .names()
            .into_iter()
            .map(str::to_string)
            .collect()
    }

    /// The sounds and music scripts started since the last call, by name (`play hit`, `music town`).
    pub fn take_sound_log(&self) -> Vec<String> {
        std::mem::take(&mut self.shared.borrow_mut().sound_log)
    }
}
