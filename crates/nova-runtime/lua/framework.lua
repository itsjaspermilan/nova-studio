-- Nova framework v1: entities, scenes, timers, collisions and a 2D camera, written in Lua
-- over the immediate-mode API. It is loaded for every project and takes over the frame only
-- when main.lua calls nova.start("scene_name"). Specification: docs/project-format.md.
--
--   -- entities/player.lua
--   local Player = nova.entity { sprite = "player", tags = { "player" }, speed = 120 }
--   function Player:update(dt) self.x = self.x + nova.input.axis("steer") * self.speed * dt end
--   function Player:on_collide_enemy(enemy) enemy:destroy() end
--   return Player
--
--   -- scenes/play.lua
--   local Play = nova.scene {}
--   function Play:enter() self.hero = nova.spawn("player", 100, 100) end
--   return Play
local raw = nova.raw
local timers = require("nova.timers")

local STEP = 1 / 60 -- the game always advances in 60 Hz steps
local MAX_STEPS = 5 -- after a long hitch it catches up at most this far, then lets go
local CELL = 64
-- Which two fields are "the ground" for collisions, distances and neighbour queries: x, y (a flat game, the default) or
-- x, z (a 3D game, where y is height). `nova.collision { plane = "xz", cell = 4 }` changes it; `cell` is the size of the
-- squares the broad phase sorts entities into, about the size of the things that collide (in metres for a 3D game).
local XZ, grid_cell = false, CELL
local grids = {} -- the broad phase of each tag, by step (see grid_for)
local function cell_key(cx, cy) return (cx + 32768) * 65536 + (cy + 32768) end

local sqrt, abs, atan, cos, sin, floor = math.sqrt, math.abs, math.atan, math.cos, math.sin, math.floor

local W = {
  list = {}, -- every living entity, in the order they were made
  tags = {}, -- tag -> list of entities
  counts = {}, -- tag -> number of living entities
  next_id = 1,
  step_id = 0,
  time = 0,
  acc = 0,
  scene = nil,
  scene_name = nil,
  pending = nil,
  paused = false,
  dirty = false,
  background = nil,
  started = false,
  cam = { x = 480, y = 270, follow = nil, lerp = 1, limit = nil, set = false },
}
nova.world = W

-- ------------------------------------------------------------------ names and files
local function image_id(name, what)
  if raw.has_image(name) then return name end
  local guess = "sprites/" .. name .. ".png"
  if raw.has_image(guess) then return guess end
  error((what or "sprite") .. " '" .. tostring(name) .. "' not found (looked for '" .. name .. "' and '" .. guess .. "')", 3)
end

local model_ids = {}
local function model_id(name)
  local id = model_ids[name]
  if id then return id end
  if raw.has_model(name) then id = name
  else
    local guess = "models/" .. name .. ".glb"
    if raw.has_model(guess) then id = guess
    else error("model '" .. tostring(name) .. "' not found (looked for '" .. name .. "' and '" .. guess .. "')", 3) end
  end
  model_ids[name] = id
  return id
end

local sprite_ids = {}
local function sprite_id(name)
  local id = sprite_ids[name]
  if id then return id end
  id = image_id(name, "sprite")
  sprite_ids[name] = id
  return id
end

local function copy_value(v, depth)
  if type(v) ~= "table" or (depth or 0) > 8 then return v end
  local out = {}
  for k, x in pairs(v) do out[k] = copy_value(x, (depth or 0) + 1) end
  return out
end

-- ------------------------------------------------------------------ classes
local Entity = { __kind = "entity", __flat = true, __defaults = {}, __tags = {}, __collide = {}, __depth = 0 }
Entity.__index = Entity
local Scene = { __kind = "scene", __flat = true, __defaults = {}, __tags = {}, __collide = {}, __depth = 0 }
Scene.__index = Scene
local bases = { entity = Entity, scene = Scene }

local RESERVED = { static = true, lod = true, lod_distance = true, tags = true, sprite = true, model = true, depth = true, hitbox = true, screen = true, pivot = true }

local function define(kind, a, b)
  local parent, spec
  if b ~= nil then parent, spec = a, b
  elseif type(a) == "table" and rawget(a, "__kind") then parent, spec = a, {}
  else spec = a or {} end
  if parent ~= nil and not (type(parent) == "table" and rawget(parent, "__kind") == kind) then
    error("nova." .. kind .. "(parent, spec): the first argument must be another " .. kind
      .. " (did its file forget to 'return' it?)", 3)
  end
  local cls = { __kind = kind, __parent = parent or bases[kind], __spec = spec, __flat = false }
  cls.__index = cls
  return cls
end

-- Copy inherited methods into the class and work out defaults, tags, hitbox and collision
-- handlers. Done once, the first time the class is used, so a method call is one lookup.
local function finalize(cls)
  if cls.__flat then return cls end
  local parent = cls.__parent
  finalize(parent)
  for k, v in pairs(parent) do
    if type(k) == "string" and k:sub(1, 2) ~= "__" and rawget(cls, k) == nil then cls[k] = v end
  end
  local defaults, tags = {}, {}
  for k, v in pairs(parent.__defaults) do defaults[k] = v end
  for t in pairs(parent.__tags) do tags[t] = true end
  local spec = cls.__spec
  for k, v in pairs(spec) do
    if k == "tags" then
      for _, t in ipairs(v) do tags[t] = true end
    elseif not RESERVED[k] then
      defaults[k] = v
    end
  end
  -- A field with the same name as one of the class's own methods would hide the method on every instance
  -- (`place = { ... }` next to `function Car:place()`): that is always a mistake, and a confusing one, so say so now.
  -- (The built-in methods are left alone: a field called `speed` is common and hiding `entity:speed()` is harmless.)
  for k in pairs(spec) do
    local method = rawget(cls, k)
    if defaults[k] ~= nil and type(method) == "function" and bases[cls.__kind][k] ~= method then
      error(("this %s has a field and a method both called '%s': the field hides the method. Rename one of them."):format(cls.__kind, k), 0)
    end
  end
  cls.__defaults, cls.__tags = defaults, tags
  cls.__static = spec.static or parent.__static
  cls.__lod = spec.lod or parent.__lod
  cls.__lod_distance = spec.lod_distance or parent.__lod_distance
  cls.__sprite = spec.sprite or parent.__sprite
  cls.__model = spec.model or parent.__model
  cls.__depth = spec.depth or parent.__depth or 0
  cls.__hitbox = spec.hitbox or parent.__hitbox
  cls.__pivot = spec.pivot or parent.__pivot
  if spec.screen ~= nil then cls.__screen = spec.screen else cls.__screen = parent.__screen end
  local handlers = {}
  for k, v in pairs(cls) do
    if type(k) == "string" and type(v) == "function" then
      local tag = k:match("^on_collide_(.+)$")
      if tag then handlers[#handlers + 1] = { tag = tag, name = k } end
    end
  end
  table.sort(handlers, function(x, y) return x.tag < y.tag end)
  cls.__collide = handlers
  cls.__flat = true
  return cls
end

function nova.entity(a, b) return define("entity", a, b) end
function nova.scene(a, b) return define("scene", a, b) end

-- "player" -> entities/player.lua, "enemies.grub" -> entities/enemies/grub.lua; a class is used as given.
local function resolve(what, kind)
  if type(what) == "table" then return what end
  if type(what) ~= "string" then error("expected a " .. kind .. " name or class, got " .. type(what), 3) end
  local prefix = kind == "scene" and "scenes." or "entities."
  local module = what:find("^" .. prefix:gsub("%.", "%%.")) and what or (prefix .. what)
  local cls = require(module)
  if type(cls) ~= "table" or rawget(cls, "__kind") ~= kind then
    error(module:gsub("%.", "/") .. ".lua must end with 'return <the " .. kind .. " class>' (it returned " .. tostring(cls) .. ")", 3)
  end
  return cls
end

-- ------------------------------------------------------------------ geometry
-- Hitboxes are offsets from the entity's position. { x, y, w, h } is a box; { r = 8 } a circle
-- (with optional x, y offsets). Without a hitbox the sprite's size, centred, is used.
local function bounds(e)
  local cls = getmetatable(e)
  local spec = rawget(e, "hitbox") or cls.__hitbox
  local sx = abs(e.sx)
  -- in the ground plane x, z a thing has one size (sx), as a model does, and its second coordinate is z
  local sy, gy, esy = abs(e.sy), e.y, e.sy
  if XZ then sy, gy, esy = sx, e.z, e.sx end
  if spec then
    if spec.r then
      local r = spec.r * math.max(sx, sy)
      local cx, cy = e.x + (spec.x or 0) * e.sx, gy + (spec.y or 0) * esy
      return cx - r, cy - r, cx + r, cy + r, r
    end
    local x0 = e.x + (spec[1] or spec.x or 0) * e.sx
    local y0 = gy + (spec[2] or spec.y or 0) * esy
    local w, h = (spec[3] or spec.w or 0) * sx, (spec[4] or spec.h or 0) * sy
    return x0, y0, x0 + w, y0 + h
  end
  local sprite = rawget(e, "sprite") or cls.__sprite
  if sprite then
    local w, h = raw.image_size(sprite_id(sprite))
    w, h = w * sx, h * sy
    local pivot = rawget(e, "pivot") or cls.__pivot
    local px, py = pivot and pivot[1] or 0.5, pivot and pivot[2] or 0.5
    return e.x - w * px, e.y - h * py, e.x + w * (1 - px), e.y + h * (1 - py)
  end
  return nil
end

-- How high a thing stands, in the ground plane x, z (where y is height): { bottom, top } from the hitbox's `base` and `height`,
-- or nil when it has none (it then reaches any height).
local function vrange(e)
  local spec = rawget(e, "hitbox") or getmetatable(e).__hitbox
  local h = spec and spec.height
  if not h then return nil end
  local s = abs(e.sx)
  local y0 = e.y + (spec.base or 0) * s
  return y0, y0 + h * s
end

local function overlap(a, b)
  local ax0, ay0, ax1, ay1, ar = bounds(a)
  local bx0, by0, bx1, by1, br = bounds(b)
  if not ax0 or not bx0 then return false end
  if XZ then
    -- a bullet flying over a short wall, a player standing on a crate: heights that do not meet do not collide
    local a0, a1 = vrange(a)
    if a0 then
      local b0, b1 = vrange(b)
      if b0 and (a1 < b0 or b1 < a0) then return false end
    end
  end
  if ar and br then
    local dx, dy = (ax0 + ar) - (bx0 + br), (ay0 + ar) - (by0 + br)
    local r = ar + br
    return dx * dx + dy * dy <= r * r
  end
  return ax0 < bx1 and bx0 < ax1 and ay0 < by1 and by0 < ay1
end

-- ------------------------------------------------------------------ what every entity can do
Entity.x, Entity.y, Entity.z = 0, 0, 0
Entity.vx, Entity.vy, Entity.vz = 0, 0, 0
Entity.sx, Entity.sy = 1, 1
Entity.angle = 0
Entity.frame = 0 -- the frame of a sprite sheet to show (play() animates it)
Entity.alpha = 1
Entity.visible = true

function Entity:bounds() return bounds(self) end
function Entity:overlaps(other) return overlap(self, other) end
function Entity:is_alive() return not self._dead end

function Entity:destroy()
  if self._dead then return end
  self._dead = true
  W.dirty = true
  for tag in pairs(getmetatable(self).__tags) do W.counts[tag] = (W.counts[tag] or 1) - 1 end
  if self.on_destroy then self:on_destroy() end
end

local function target_xy(a, b)
  if type(a) == "table" then return a.x, XZ and a.z or a.y end
  return a, b
end

function Entity:distance_to(a, b)
  local x, y = target_xy(a, b)
  local dx, dy = x - self.x, y - (XZ and self.z or self.y)
  return sqrt(dx * dx + dy * dy)
end

function Entity:angle_to(a, b)
  local x, y = target_xy(a, b)
  return atan(y - (XZ and self.z or self.y), x - self.x)
end

-- Step toward a point (or entity); returns true when it arrived this call.
function Entity:move_toward(a, b, c)
  local x, y, step
  if type(a) == "table" then x, y, step = a.x, XZ and a.z or a.y, b else x, y, step = a, b, c end
  local field = XZ and "z" or "y"
  local dx, dy = x - self.x, y - self[field]
  local d = sqrt(dx * dx + dy * dy)
  if d <= step or d == 0 then
    self.x, self[field] = x, y
    return true
  end
  self.x, self[field] = self.x + dx / d * step, self[field] + dy / d * step
  return false
end

function Entity:set_velocity(angle, speed)
  self.vx, self.vy = cos(angle) * speed, sin(angle) * speed
end

function Entity:speed() return sqrt(self.vx * self.vx + self.vy * self.vy) end
function Entity:after(seconds, fn) return timers.after(self, seconds, fn) end
function Entity:every(seconds, fn) return timers.every(self, seconds, fn) end
function Entity:go(fn) return timers.go(self, fn) end
function Entity:tween(props, seconds, easing, on_done) return timers.tween(self, self, props, seconds, easing, on_done) end

-- The first living entity with this tag that overlaps this one, or nil.
function Entity:touching(tag)
  local list = W.tags[tag]
  if not list then return nil end
  for i = 1, #list do
    local o = list[i]
    if o ~= self and not o._dead and overlap(self, o) then return o end
  end
  return nil
end

-- ---- animation: sprite sheets (sprites/<name>.sprite.json) have frames and tags
local sheet_cache = {}
local function sheet_info(name)
  local info = sheet_cache[name]
  if info == nil then
    info = raw.sprite_info(name) or false
    sheet_cache[name] = info
  end
  return info
end

-- Play a tag of this entity's sprite sheet. Calling it again with the same tag keeps going
-- (pass { restart = true } to start over); on_animation_end(tag) runs when a non-looping tag finishes.
function Entity:play(tag, opts)
  local name = rawget(self, "sprite") or getmetatable(self).__sprite
  local info = name and sheet_info(name)
  if not info then
    error("play(): '" .. tostring(name) .. "' is not a sprite sheet (a sprites/<name>.sprite.json file)", 2)
  end
  local t = info.tags[tag]
  if not t then error("play(): the sprite sheet '" .. name .. "' has no tag '" .. tostring(tag) .. "'", 2) end
  local a = self._anim
  if a and a.tag == tag and not a.done and not (opts and opts.restart) then return end
  self._anim = { tag = tag, seq = t.sequence, loop = t.loop, i = 1, t = 0, done = false }
  self.frame = t.sequence[1]
end

function Entity:stop_animation() self._anim = nil end
function Entity:set_frame(frame)
  self._anim = nil
  self.frame = frame
end

local function animate(e, dt)
  local a = e._anim
  if a.done then return end
  local info = sheet_info(rawget(e, "sprite") or getmetatable(e).__sprite)
  if not info then
    e._anim = nil
    return
  end
  a.t = a.t + dt * 1000 * (e.anim_speed or 1)
  local dur = info.durations[e.frame + 1] or 100
  while a.t >= dur do
    a.t = a.t - dur
    if a.i < #a.seq then
      a.i = a.i + 1
    elseif a.loop then
      a.i = 1
    else
      a.done = true
      if e.on_animation_end then e:on_animation_end(a.tag) end
      break
    end
    e.frame = a.seq[a.i]
    dur = info.durations[e.frame + 1] or 100
  end
end

-- Play an animation clip of this entity's 3D model (the clips are made in the model editor or come with the
-- .glb). Calling it again with the same clip keeps going ({ restart = true } starts over); `speed` scales time;
-- on_clip_end(name) runs when a non-looping clip finishes.
function Entity:play_clip(name, opts)
  local model = rawget(self, "model") or getmetatable(self).__model
  if not model then error("play_clip(): this entity has no model", 2) end
  local found
  local list = nova.model_clips(model_id(model))
  for i = 1, #list do
    if list[i].name == name then found = list[i] end
  end
  if not found then
    local names = {}
    for i = 1, #list do names[i] = list[i].name end
    error("play_clip(): the model '" .. tostring(model) .. "' has no clip '" .. tostring(name) .. "' (its clips: " .. (#names > 0 and table.concat(names, ", ") or "none") .. ")", 2)
  end
  local c = self._clip
  if c and c.name == name and not c.done and not (opts and opts.restart) then return end
  local loop = not (opts and opts.loop == false)
  self._clip = { name = name, duration = found.duration, loop = loop, done = false }
  self.clip, self.clip_time, self.clip_loop = name, 0, loop
end

function Entity:stop_clip()
  self._clip = nil
  self.clip, self.clip_time = nil, nil
end

local function advance_clip(e, dt)
  local c = e._clip
  if c.done then return end
  local t = (e.clip_time or 0) + dt * (e.clip_speed or 1)
  if c.loop then
    if c.duration > 0 then t = t % c.duration end
  elseif t >= c.duration then
    t = c.duration
    c.done = true
    e.clip_time = t
    if e.on_clip_end then e:on_clip_end(c.name) end
    return
  end
  e.clip_time = t
end

-- Where a sprite is drawn so that its pivot (fractions of its size, default centre) sits on the
-- entity's position. Rotation turns the picture about the pivot.
local function pivot_shift(pivot, w, h, sx, sy, angle)
  local ox, oy = (0.5 - pivot[1]) * w * sx, (0.5 - pivot[2]) * h * sy
  local c, s = cos(angle), sin(angle)
  return ox * c - oy * s, ox * s + oy * c
end

local draw_opts = { sx = 1, sy = 1, rotation = 0, frame = 0, color = { 255, 255, 255, 255 } }
local model_opts = { ry = 0, scale = 1, tint = { 255, 255, 255, 255 } }

function Entity:draw()
  if not self.visible then return end
  local cls = getmetatable(self)
  local model = rawget(self, "model") or cls.__model
  if model then
    model_opts.ry = self.ry or self.angle
    model_opts.rx = self.rx
    model_opts.rz = self.rz
    model_opts.parts = self.parts -- pieces turned on their own, e.g. { wheel = { rx = t } }
    model_opts.clip, model_opts.time, model_opts.loop = self.clip, self.clip_time, self.clip_loop
    model_opts.scale = self.sx
    local tint = self.tint
    model_opts.tint[1], model_opts.tint[2], model_opts.tint[3] = tint and tint[1] or 255, tint and tint[2] or 255, tint and tint[3] or 255
    model_opts.tint[4] = floor(255 * self.alpha)
    nova.model(model_id(model), self.x, self.y, self.z, model_opts)
  end
  local sprite = rawget(self, "sprite") or cls.__sprite
  if sprite then
    local screen = self.screen
    if screen == nil then screen = cls.__screen end
    draw_opts.sx, draw_opts.sy, draw_opts.rotation, draw_opts.frame = self.sx, self.sy, self.angle, self.frame
    local c, tint = draw_opts.color, self.tint
    c[1], c[2], c[3] = tint and tint[1] or 255, tint and tint[2] or 255, tint and tint[3] or 255
    c[4] = floor(255 * self.alpha)
    local id = sprite_id(sprite)
    local x, y = self.x, self.y
    local pivot = rawget(self, "pivot") or cls.__pivot
    if pivot then
      local iw, ih = raw.image_size(id)
      local dx, dy = pivot_shift(pivot, iw, ih, self.sx, self.sy, self.angle)
      x, y = x + dx, y + dy
    end
    if screen then
      nova.ui.sprite(id, x, y, draw_opts)
    else
      local w, h = nova.view()
      nova.sprite(id, x - (W.cam.x - w * 0.5), y - (W.cam.y - h * 0.5), draw_opts)
    end
  end
end

-- ------------------------------------------------------------------ built-in kinds used by scene files
local Picture = nova.entity { screen = false }
function Picture:draw()
  if not self.visible then return end
  local id = sprite_id(self.image)
  draw_opts.sx, draw_opts.sy, draw_opts.rotation, draw_opts.frame = self.sx, self.sy, self.angle, self.frame
  local c, tint = draw_opts.color, self.tint
  c[1], c[2], c[3] = tint and tint[1] or 255, tint and tint[2] or 255, tint and tint[3] or 255
  c[4] = floor(255 * self.alpha)
  if self.screen then
    nova.ui.sprite(id, self.x, self.y, draw_opts)
  else
    local w, h = nova.view()
    nova.sprite(id, self.x - (W.cam.x - w * 0.5), self.y - (W.cam.y - h * 0.5), draw_opts)
  end
end

local text_color = { 255, 255, 255, 255 }
local text_opts = { size = 16, color = text_color }
local Text = nova.entity { screen = true, text = "" }
function Text:draw()
  if not self.visible then return end
  local c, col = text_color, self.color
  c[1], c[2], c[3] = col and col[1] or 255, col and col[2] or 255, col and col[3] or 255
  c[4] = col and col[4] or 255
  text_opts.size = (self.size or 2) * 8 -- scene files give "scale" steps of 8 units; use `size` in code
  text_opts.font = self.font
  text_opts.width = self.width
  text_opts.align = self.align
  text_opts.shadow = self.shadow
  nova.ui.text(self.x, self.y, tostring(self.text), text_opts)
end
nova.Entity, nova.Picture, nova.Text = Entity, Picture, Text

-- ------------------------------------------------------------------ the animator
-- A small state machine for a character's animation. States name a clip (or a blend of clips by a number such as speed);
-- `play` moves to another state and the two crossfade, so a character does not snap from walking to jumping. Drawing
-- mixes the clips by weight (`nova.model`'s `layers`).
local Animator = {}
Animator.__index = Animator

local function sorted_points(state, name)
  local points = {}
  for i, p in ipairs(state.points or {}) do points[i] = { at = p[1], clip = p[2] } end
  table.sort(points, function(a, b) return a.at < b.at end)
  if #points < 2 then error(("animator state '%s' needs points = { { 0, \"idle\" }, { 3, \"walk\" } } (at least two)"):format(name), 3) end
  return points
end

--- `nova.animator(model, { start = "idle", fade = 0.2, states = { ... } })`. A state is `{ clip = "walk" }` (with `loop = false`
--- to play once, `next = "idle"` for where it goes when it ends, `speed = 1.5` to play faster, `fade` for how long to
--- crossfade into it), or `{ blend = "speed", points = { { 0, "idle" }, { 3, "walk" }, { 7, "sprint" } } }`: the clips are
--- mixed by the number set with `anim:set("speed", v)`, and their cycles stay in step.
function nova.animator(model, spec)
  if type(spec) ~= "table" or type(spec.states) ~= "table" then
    error("nova.animator(model, { start = \"idle\", states = { idle = { clip = \"idle\" } } })", 2)
  end
  local durations = {}
  for _, c in ipairs(nova.model_clips(model)) do durations[c.name] = c.duration end
  local a = setmetatable({ model = model, spec = spec, durations = durations, fade = spec.fade or 0.2, params = {}, speed = 1, entries = {} }, Animator)
  for name, state in pairs(spec.states) do
    if state.clip then
      if not durations[state.clip] then error(("animator state '%s': model '%s' has no clip '%s'"):format(name, model, state.clip), 2) end
    elseif state.blend then
      state._sorted = sorted_points(state, name)
      for _, p in ipairs(state._sorted) do
        if not durations[p.clip] then error(("animator state '%s': model '%s' has no clip '%s'"):format(name, model, p.clip), 2) end
      end
    else
      error(("animator state '%s' needs a clip = \"...\" or a blend = \"parameter\" with points"):format(name), 2)
    end
  end
  local first = spec.start or "idle"
  if not spec.states[first] then error(("animator has no state '%s' to start in (set start = ...)"):format(first), 2) end
  a:play(first)
  return a
end

--- Moves to another state, crossfading from the current one (nothing happens if it is already in it, unless `restart`).
function Animator:play(name, opts)
  local state = self.spec.states[name]
  if not state then error(("animator has no state '%s' (its states: %s)"):format(name, table.concat((function() local t = {} for k in pairs(self.spec.states) do t[#t + 1] = k end table.sort(t) return t end)(), ", ")), 2) end
  local current = self.entries[#self.entries]
  if current and current.name == name and not (opts and opts.restart) then return end
  local fade = (opts and opts.fade) or state.fade or self.fade
  self.entries[#self.entries + 1] = { name = name, state = state, t = 0, phase = 0, w = (current and fade > 0) and 0 or 1, fade = fade }
  if not current or fade <= 0 then
    for i = #self.entries - 1, 1, -1 do table.remove(self.entries, i) end
  end
end

--- A number a blend state reads (`anim:set("speed", 3.2)`).
function Animator:set(param, value) self.params[param] = value end

--- The name of the state it is moving to, or in.
function Animator:state() return self.entries[#self.entries].name end

--- Whether a state that plays once (`loop = false`) has reached its end.
function Animator:finished()
  local e = self.entries[#self.entries]
  return e.done == true
end

local function blend_pair(state, value)
  local pts = state._sorted
  if value <= pts[1].at then return pts[1], pts[1], 0 end
  if value >= pts[#pts].at then return pts[#pts], pts[#pts], 0 end
  for i = 2, #pts do
    if value <= pts[i].at then
      local a, b = pts[i - 1], pts[i]
      return a, b, (value - a.at) / (b.at - a.at)
    end
  end
end

--- Moves time on by `dt`: call it once a frame.
function Animator:update(dt)
  for _, e in ipairs(self.entries) do
    local state, rate = e.state, (e.state.speed or 1) * self.speed
    if state.clip then
      e.t = e.t + dt * rate
      local length = self.durations[state.clip]
      if state.loop == false and e.t >= length then e.t = length; e.done = true end
    else
      local a, b, f = blend_pair(state, self.params[state.blend] or 0)
      local length = self.durations[a.clip] * (1 - f) + self.durations[b.clip] * f
      e.phase = (e.phase + dt * rate / math.max(length, 1e-3)) % 1
    end
  end
  -- the newest state fades in; what it replaces fades out in the same time, together always adding up to one
  local newest = self.entries[#self.entries]
  if newest.w < 1 then newest.w = math.min(1, newest.w + dt / math.max(newest.fade, 1e-3)) end
  local others = 0
  for i = 1, #self.entries - 1 do others = others + self.entries[i].w end
  local remain = 1 - newest.w
  for i = #self.entries - 1, 1, -1 do
    local e = self.entries[i]
    e.w = others > 0 and e.w * remain / others or 0
    if e.w < 0.002 then table.remove(self.entries, i) end
  end
  -- a state that plays once and says where to go next goes there when it ends
  if newest.done and newest.state.next then self:play(newest.state.next) end
end

--- The clips and weights to hand to `nova.model` as `layers`.
function Animator:layers()
  local layers = {}
  for _, e in ipairs(self.entries) do
    local state = e.state
    if state.clip then
      layers[#layers + 1] = { clip = state.clip, time = e.t, weight = e.w, loop = state.loop ~= false }
    else
      local a, b, f = blend_pair(state, self.params[state.blend] or 0)
      if f < 1 then layers[#layers + 1] = { clip = a.clip, time = e.phase * self.durations[a.clip], weight = e.w * (1 - f) } end
      if f > 0 then layers[#layers + 1] = { clip = b.clip, time = e.phase * self.durations[b.clip], weight = e.w * f } end
    end
  end
  return layers
end

--- Draws the model in its current pose: `anim:draw(x, y, z, { scale = 1.8, ry = 0 })` (the options of `nova.model`).
function Animator:draw(x, y, z, opts)
  local o = {}
  for k, v in pairs(opts or {}) do o[k] = v end
  o.layers = self:layers()
  nova.model(self.model, x, y, z, o)
end

-- ------------------------------------------------------------------ the static scenery
-- Scenery that never moves (trees, road pieces, barriers) comes by the thousand, so it is not kept as live entities:
-- each piece is a row in a grid of squares, drawn only when it is near the camera. The `colliders` circles of its model
-- (made in the model editor, read with nova.model_colliders) stop whatever calls `nova.scenery.push`. An entity class
-- with `static = true` and a `model` puts itself here when it is spawned (a scene file's trees and road pieces do).
local scenery = {} -- `range` (metres) is unset: Rust draws out to where the fog has covered everything, or 300 m without fog
nova.scenery = scenery
local SCENERY_CELL = 40
local solid_bins, piece_count = {}, 0
local circles_of = {}
local eye_x, eye_z = 0, 0

local set_camera = nova.camera
function nova.camera(ex, ey, ez, tx, ty, tz, fov)
  eye_x, eye_z = ex, ez
  return set_camera(ex, ey, ez, tx, ty, tz, fov)
end

local function key(cx, cz) return (cx + 2048) * 4096 + (cz + 2048) end
local function cell(v) return floor(v / SCENERY_CELL) end

--- Forgets every piece (a scene does this by itself when it ends).
function scenery.clear() solid_bins, piece_count = {}, 0; raw.clear_retained() end
--- How many pieces there are.
function scenery.count() return piece_count end

--- Puts a model into the scenery at (x, y, z); `opts` are the model options (`ry`, `scale`, `tint`, `shadow`...).
function scenery.add(model, x, y, z, opts)
  opts = opts or {}
  raw.retain(model, x, y, z, opts)
  piece_count = piece_count + 1
  local circles = circles_of[model]
  if circles == nil then circles = nova.model_colliders(model); circles_of[model] = circles end
  if #circles > 0 then
    local ry, scale = opts.ry or 0, opts.scale or 1
    local s, c = sin(ry), cos(ry)
    for _, circle in ipairs(circles) do
      local ox, oz = circle.x * scale, circle.z * scale
      -- the model's +x is (cos, -sin) and its +z is (sin, cos) on the ground
      local wx, wz = x + ox * c + oz * s, z - ox * s + oz * c
      local sk = key(cell(wx), cell(wz))
      local sl = solid_bins[sk]
      if not sl then sl = {}; solid_bins[sk] = sl end
      sl[#sl + 1] = { wx, wz, circle.r * scale }
    end
  end
end

--- Draws the pieces within `radius` metres of (cx, cz). The framework does this by itself around the camera every frame
--- (out to `nova.scenery.range`, if set, else to where the fog ends or 300 m; 0 turns it off). The last 12% of the range fades out.
function scenery.draw(cx, cz, radius)
  raw.draw_retained(cx, cz, radius)
end

--- A circle of radius `r` at (x, z): the push that gets it out of whatever it overlaps (dx, dz), or nil.
function scenery.push(x, z, r)
  local px, pz, hit = 0, 0, false
  for gx = cell(x - 4), cell(x + 4) do
    for gz = cell(z - 4), cell(z + 4) do
      local list = solid_bins[key(gx, gz)]
      if list then
        for i = 1, #list do
          local s = list[i]
          local dx, dz = x - s[1], z - s[2]
          local d2, reach = dx * dx + dz * dz, r + s[3]
          if d2 < reach * reach then
            local d = sqrt(d2)
            if d < 0.001 then dx, dz, d = 1, 0, 1 end
            px, pz, hit = px + dx / d * (reach - d), pz + dz / d * (reach - d), true
          end
        end
      end
    end
  end
  if hit then return px, pz end
end

--- Looks along a line from (x, z) in the direction (dx, dz) for `length` metres, as wide as a circle of `radius`: the nearest
--- solid circle in the way. Returns how far away it is (0 if already touching), and the circle's x, z and radius; or nothing.
--- It is how a car or a character sees what is coming, to steer round it.
function scenery.ahead(x, z, dx, dz, length, radius)
  local len = sqrt(dx * dx + dz * dz)
  if len < 1e-9 or length <= 0 then return nil end
  dx, dz = dx / len, dz / len
  radius = radius or 0
  local best, bx, bz, br = nil, nil, nil, nil
  local seen = {}
  local t = 0
  while true do
    local px, pz = x + dx * t, z + dz * t
    for gx = cell(px) - 1, cell(px) + 1 do
      for gz = cell(pz) - 1, cell(pz) + 1 do
        local k = key(gx, gz)
        if not seen[k] then
          seen[k] = true
          local list = solid_bins[k]
          if list then
            for i = 1, #list do
              local c = list[i]
              local rx, rz = c[1] - x, c[2] - z
              local along = rx * dx + rz * dz
              local reach = c[3] + radius
              if along > -reach and along < length + reach then
                local across = rx * -dz + rz * dx
                if across * across < reach * reach then
                  local d = math.max(0, along - sqrt(reach * reach - across * across))
                  if d <= length and (not best or d < best) then best, bx, bz, br = d, c[1], c[2], c[3] end
                end
              end
            end
          end
        end
      end
    end
    if t >= length then break end
    t = math.min(length, t + SCENERY_CELL * 0.5)
  end
  if best then return best, bx, bz, br end
end

--- A ray along the ground from (x, z) in the direction (dx, dz): the first solid circle it meets, as `distance, hit_x, hit_z,
--- circle_x, circle_z, circle_radius`, or nothing (`length` metres at most).
function scenery.raycast(x, z, dx, dz, length)
  local d, cx, cz, cr = scenery.ahead(x, z, dx, dz, length, 0)
  if not d then return nil end
  local len = sqrt(dx * dx + dz * dz)
  return d, x + dx / len * d, z + dz / len * d, cx, cz, cr
end

--- Is the straight line from (x1, z1) to (x2, z2) free of solid scenery? (`radius` makes the line that wide.)
function scenery.line_clear(x1, z1, x2, z2, radius)
  local dx, dz = x2 - x1, z2 - z1
  local len = sqrt(dx * dx + dz * dz)
  if len < 1e-9 then return true end
  return scenery.ahead(x1, z1, dx, dz, len, radius or 0) == nil
end

-- ------------------------------------------------------------------ the 3D camera
-- Two ready-made cameras and the way from a point on the screen into the world. `yaw` turns the camera about the vertical
-- (0 looks towards -z, as a game on the ground starts out; positive turns it to the left), `pitch` tilts it (positive looks up).
local cam3 = { yaw = 0, pitch = 0, fov = 60, eye = { x = 0, y = 6, z = 10 }, target = { x = 0, y = 0, z = 0 } }
nova.cam3 = cam3

local function point_of(t)
  if t == nil then return 0, 0, 0 end
  return t.x or 0, t.y or 0, t.z or 0
end

--- Turns by (dyaw, dpitch) radians, a look stick or a mouse moved (pitch stays short of straight up and down).
function cam3.look(dyaw, dpitch)
  cam3.yaw = cam3.yaw + dyaw
  cam3.pitch = math.max(-1.45, math.min(1.45, cam3.pitch + (dpitch or 0)))
end

--- The ground direction the camera looks along, and the one to its right: for moving "forward" and "right" on screen.
function cam3.forward() return -sin(cam3.yaw) + 0, -cos(cam3.yaw) + 0 end -- (+ 0 turns a negative zero into 0)
function cam3.right()
  local fx, fz = cam3.forward()
  return -fz, fx
end

local function aim(eye, target, fov)
  cam3.eye, cam3.target, cam3.fov = eye, target, fov
  nova.camera(eye.x, eye.y, eye.z, target.x, target.y, target.z, fov)
end

--- A camera behind and above `target` (an entity or { x, y, z }), looking at it, easing after it as it moves.
--- opts: distance (9), height (8: how far above the ground the camera is), look_height (1: what it looks at above the target),
--- smooth (6: bigger follows more tightly; 0 stays rigidly behind), fov (60), dt (1/60). Turn it with cam3.yaw or cam3.look.
function cam3.follow(target, opts)
  opts = opts or {}
  local tx, ty, tz = point_of(target)
  local dist, height = opts.distance or 9, opts.height or 8
  local wx, wy, wz = tx + sin(cam3.yaw) * dist, ty + height, tz + cos(cam3.yaw) * dist
  local k = (opts.smooth or 6) <= 0 and 1 or math.min(1, (opts.dt or 1 / 60) * (opts.smooth or 6))
  local e = cam3.eye
  aim({ x = e.x + (wx - e.x) * k, y = e.y + (wy - e.y) * k, z = e.z + (wz - e.z) * k },
      { x = tx, y = ty + (opts.look_height or 1), z = tz }, opts.fov or 60)
end

--- A camera at `target`'s head looking where cam3.yaw and cam3.pitch say.
--- opts: height (1.6), fov (75).
function cam3.first_person(target, opts)
  opts = opts or {}
  local tx, ty, tz = point_of(target)
  local ey = ty + (opts.height or 1.6)
  local cp = cos(cam3.pitch)
  aim({ x = tx, y = ey, z = tz },
      { x = tx - sin(cam3.yaw) * cp * 10, y = ey + sin(cam3.pitch) * 10, z = tz - cos(cam3.yaw) * cp * 10 }, opts.fov or 75)
end

--- The camera's own directions, whatever camera was set last: forward, right and up as { x, y, z } tables of length 1.
function cam3.basis()
  local e, t = cam3.eye, cam3.target
  local fx, fy, fz = t.x - e.x, t.y - e.y, t.z - e.z
  local fl = sqrt(fx * fx + fy * fy + fz * fz)
  if fl < 1e-9 then fx, fy, fz, fl = 0, 0, -1, 1 end
  fx, fy, fz = fx / fl, fy / fl, fz / fl
  local rx, rz = -fz, fx -- forward x up(0, 1, 0)
  local rl = sqrt(rx * rx + rz * rz)
  if rl < 1e-9 then rx, rz, rl = 1, 0, 1 end
  rx, rz = rx / rl, rz / rl
  local ux, uy, uz = -rz * fy, rz * fx - rx * fz, rx * fy -- right x forward
  return { x = fx, y = fy, z = fz }, { x = rx, y = 0, z = rz }, { x = ux, y = uy, z = uz }
end

--- A place given in the camera's own terms (lx to its right, ly up, lz forward) as a place in the world: for something held in
--- front of the eye (a weapon, a hand), or a mark a little ahead. Returns x, y, z. The camera's turn is cam3.yaw and cam3.pitch.
function cam3.to_world(lx, ly, lz)
  local f, r, u = cam3.basis()
  local e = cam3.eye
  return e.x + r.x * lx + u.x * ly + f.x * lz, e.y + r.y * lx + u.y * ly + f.y * lz, e.z + r.z * lx + u.z * ly + f.z * lz
end

--- The ray from the camera through a point of the screen (x, y in the game's own units, as nova.view() measures them):
--- `origin_x, origin_y, origin_z, dir_x, dir_y, dir_z` (the direction is of length 1). The middle of the screen is straight ahead.
function cam3.ray(sx, sy)
  local w, h = nova.view()
  local e, t = cam3.eye, cam3.target
  local fx, fy, fz = t.x - e.x, t.y - e.y, t.z - e.z
  local fl = sqrt(fx * fx + fy * fy + fz * fz)
  if fl < 1e-9 then return e.x, e.y, e.z, 0, 0, -1 end
  fx, fy, fz = fx / fl, fy / fl, fz / fl
  -- right = forward x up(0, 1, 0), and up = right x forward
  local rx, rz = -fz, fx
  local rl = sqrt(rx * rx + rz * rz)
  if rl < 1e-9 then rx, rz, rl = 1, 0, 1 end
  rx, rz = rx / rl, rz / rl
  local ux, uy, uz = -rz * fy, rz * fx - rx * fz, rx * fy
  local half = math.tan(math.rad(cam3.fov) / 2)
  local nx, ny = (sx / w * 2 - 1) * half * (w / h), (1 - sy / h * 2) * half
  local dx, dy, dz = fx + rx * nx + ux * ny, fy + uy * ny, fz + rz * nx + uz * ny
  local dl = sqrt(dx * dx + dy * dy + dz * dz)
  return e.x, e.y, e.z, dx / dl, dy / dl, dz / dl
end

--- Where the ray through a screen point meets the horizontal plane at `height` (default 0): `x, z`, or nothing when it looks
--- away from it. How to aim at the ground under a mouse or a finger.
function cam3.ground_point(sx, sy, height)
  local ox, oy, oz, dx, dy, dz = cam3.ray(sx, sy)
  local t = ((height or 0) - oy) / (dy ~= 0 and dy or 1e-12)
  if t < 0 or dy == 0 then return nil end
  return ox + dx * t, oz + dz * t
end

-- ------------------------------------------------------------------ interface layout and hit areas
-- Rectangles are { x, y, w, h } in the game's units (the ones nova.view() measures). The pointer is the mouse or the first
-- finger, as the current step sees it.
local ui = nova.ui

local function rect_of(a, b, c, d)
  if type(a) == "table" then return a.x, a.y, a.w, a.h end
  return a, b, c, d
end

--- `count` rectangles of size w x h in a row, `gap` apart, centred across the view (or across `width`, or starting at `x`).
--- `y` is the top (centred vertically when left out). Returns the list.
function ui.row(o)
  local vw, vh = nova.view()
  local n, w, h, gap = o.count, o.w, o.h, o.gap or 0
  local total = n * w + (n - 1) * gap
  local x0 = o.x or (((o.width or vw) - total) / 2)
  local y = o.y or (vh - h) / 2
  local out = {}
  for i = 1, n do out[i] = { x = x0 + (i - 1) * (w + gap), y = y, w = w, h = h } end
  return out
end

--- `count` rectangles of size w x h in a column, `gap` apart, centred down the view (or from `y`), across at `x` (centred when left out).
function ui.column(o)
  local vw, vh = nova.view()
  local n, w, h, gap = o.count, o.w, o.h, o.gap or 0
  local total = n * h + (n - 1) * gap
  local y0 = o.y or ((vh - total) / 2)
  local x = o.x or (vw - w) / 2
  local out = {}
  for i = 1, n do out[i] = { x = x, y = y0 + (i - 1) * (h + gap), w = w, h = h } end
  return out
end

--- Is the pointer over the rectangle (a table, or x, y, w, h)?
function ui.hit(a, b, c, d)
  local p = nova.input.pointer()
  if not p.present then return false end
  local x, y, w, h = rect_of(a, b, c, d)
  return p.x >= x and p.x < x + w and p.y >= y and p.y < y + h
end

--- Did the pointer go down on the rectangle in this step (a click or a tap)?
function ui.clicked(a, b, c, d)
  return nova.input.pointer().pressed and ui.hit(a, b, c, d)
end

--- A choice among rectangles (cards, menu rows), by the d-pad or arrow keys, or the pointer. `o.rects` is the list, `o.current`
--- the one chosen now, `o.vertical` for a column (up and down move it instead of left and right). Moving the pointer over one
--- chooses it; a click on it, or A or start, accepts. Returns `chosen, accepted, moved` (moved: the choice changed).
function ui.choose(o)
  local rects, n = o.rects, #o.rects
  local i = o.current or 1
  local back, forward = "left", "right"
  if o.vertical then back, forward = "up", "down" end
  if nova.input.pressed(back) then i = (i - 2) % n + 1 end
  if nova.input.pressed(forward) then i = i % n + 1 end
  local accepted = nova.input.pressed("a") or nova.input.pressed("start")
  local p = nova.input.pointer()
  if p.present and (p.dx ~= 0 or p.dy ~= 0 or p.pressed) then
    for k = 1, n do
      local r = rects[k]
      if p.x >= r.x and p.x < r.x + r.w and p.y >= r.y and p.y < r.y + r.h then
        i = k
        if p.pressed then accepted = true end
      end
    end
  end
  return i, accepted, i ~= (o.current or 1)
end

--- A scrolling list or grid, with the choosing done: up and down (and left and right in a grid) by the d-pad or arrow keys, the
--- pointer (a mouse, a finger or the pad cursor: hovering chooses, a click accepts) and the wheel, A or start to accept.
--- o: x, y (top left), w (width of a cell, 300), h (height, 32), gap (4), count (items), visible (how many ROWS show, all by
--- default), columns (1), current (the chosen item, 1), top (the first row shown, 1: pass back what the last call gave).
--- Gives { current, top, accepted, moved, rows, more_above, more_below, hover }: `rows` is one rectangle { x, y, w, h, index }
--- for each cell that shows, in order, to draw the items into; `hover` is the item under the pointer, if any.
function ui.list(o)
  local n = o.count or 0
  local cols = math.max(1, o.columns or 1)
  local nrows = math.max(1, math.ceil(n / cols))
  local vis = math.max(1, math.min(o.visible or nrows, nrows))
  local w, h, gap = o.w or 300, o.h or 32, o.gap or 4
  local start = math.max(1, math.min(o.current or 1, math.max(n, 1)))
  local cur = start
  local p = nova.input.pointer()
  local accepted = nova.input.pressed("a") or nova.input.pressed("start")
  if n > 0 then
    local step_y = cols
    if cols > 1 then
      if nova.input.pressed("left") then cur = cur - 1 end
      if nova.input.pressed("right") then cur = cur + 1 end
    end
    if nova.input.pressed("up") then cur = cur - step_y end
    if nova.input.pressed("down") then cur = cur + step_y end
    if p.wheel ~= 0 then cur = cur - (p.wheel > 0 and 1 or -1) * step_y end
    cur = math.max(1, math.min(cur, n))
  end
  -- keep the chosen row in view
  local row_of = math.ceil(cur / cols)
  local top = math.max(1, math.min(o.top or 1, nrows - vis + 1))
  if row_of < top then top = row_of end
  if row_of > top + vis - 1 then top = row_of - vis + 1 end
  local rows = {}
  for r = top, math.min(top + vis - 1, nrows) do
    for c = 1, cols do
      local i = (r - 1) * cols + c
      if i <= n then rows[#rows + 1] = { x = o.x + (c - 1) * (w + gap), y = o.y + (r - top) * (h + gap), w = w, h = h, index = i } end
    end
  end
  local hover
  if p.present then
    for _, r in ipairs(rows) do
      if p.x >= r.x and p.x < r.x + r.w and p.y >= r.y and p.y < r.y + r.h then
        hover = r.index
        if p.dx ~= 0 or p.dy ~= 0 or p.pressed then cur = r.index end
        if p.pressed then accepted = true end
      end
    end
  end
  return { current = cur, top = top, accepted = accepted and n > 0, moved = cur ~= start, rows = rows,
           more_above = top > 1, more_below = top + vis - 1 < nrows, hover = hover }
end

--- Text typed into a field. o: text (what is there now), max (how many characters, 24), filter (a Lua pattern that each
--- character must match, such as "[%w _%-]"), typed (the characters to apply: what nova.input.typed() gives by default, or
--- what ui.keyboard gives). Returns the new text and whether enter was pressed. Backspace is "\b" and enter is "\n" in typed.
function ui.text_field(o)
  local text, max = o.text or "", o.max or 24
  local typed = o.typed
  if typed == nil then typed = nova.input.typed() end
  local done = false
  for ch in typed:gmatch(utf8.charpattern) do
    if ch == "\b" then
      local cut = utf8.offset(text, -1)
      if cut then text = text:sub(1, cut - 1) end
    elseif ch == "\n" then
      done = true
    elseif ch:byte() >= 32 and (utf8.len(text) or #text) < max and (not o.filter or ch:match(o.filter)) then
      text = text .. ch
    end
  end
  return text, done
end

local KEYBOARD_ROWS = { "1234567890", "qwertyuiop", "asdfghjkl'", "zxcvbnm,.-" }

--- An on-screen keyboard, for a gamepad, a finger or a mouse: the choosing is ui.list over a grid of keys, so it works with
--- the d-pad, arrows, the pointer and the pad cursor. o: x, y (top left), w (a key's width, 44), h (42), gap (4), current (the
--- chosen key, 1), upper (capitals). Gives { typed, current, upper, keys }: `typed` is the character of the key just taken (or
--- "\b" for del, "\n" for ok; B also deletes), "" when none; `keys` is one { x, y, w, h, label, selected } per key to draw.
--- Feed `typed` to ui.text_field.
function ui.keyboard(o)
  local keys = {}
  for _, row in ipairs(KEYBOARD_ROWS) do
    for ch in row:gmatch(".") do keys[#keys + 1] = { ch = ch } end
  end
  keys[#keys + 1] = { label = "Aa", action = "shift" }
  keys[#keys + 1] = { label = "space", ch = " " }
  keys[#keys + 1] = { label = "del", ch = "\b" }
  keys[#keys + 1] = { label = "ok", ch = "\n" }
  local upper = o.upper or false
  local r = ui.list { x = o.x, y = o.y, w = o.w or 44, h = o.h or 42, gap = o.gap or 4, count = #keys, columns = 10, current = o.current or 1 }
  local typed = ""
  if r.accepted then
    local k = keys[r.current]
    if k.action == "shift" then upper = not upper
    elseif k.ch then typed = (upper and #k.ch == 1) and k.ch:upper() or k.ch end
  end
  if nova.input.pressed("b") then typed = "\b" end
  local out = {}
  for _, cell in ipairs(r.rows) do
    local k = keys[cell.index]
    local label = k.label or (upper and k.ch:upper() or k.ch)
    out[#out + 1] = { x = cell.x, y = cell.y, w = cell.w, h = cell.h, label = label, selected = cell.index == r.current }
  end
  return { typed = typed, current = r.current, upper = upper, keys = out }
end

local function spawn(what, x, y, props)
  local cls = finalize(resolve(what, "entity"))
  local e = setmetatable({}, cls)
  for k, v in pairs(cls.__defaults) do e[k] = copy_value(v) end
  e.x, e.y = x or 0, y or 0
  if props then
    for k, v in pairs(props) do e[k] = v end
  end
  if cls.__static then
    -- a piece of scenery: it goes into the static scenery, not into the list of live entities
    if not cls.__model then error("a static entity needs a model (nova.entity { model = \"pine\", static = true })", 2) end
    local scale = rawget(e, "sx") or 1
    scenery.add(cls.__model, e.x, e.y, rawget(e, "z") or 0, { ry = rawget(e, "ry") or 0, scale = scale, lod = cls.__lod, lod_distance = cls.__lod_distance })
    return e
  end
  if rawget(e, "depth") == nil then e.depth = cls.__depth end
  e.id = W.next_id
  W.next_id = W.next_id + 1
  W.list[#W.list + 1] = e
  for tag in pairs(cls.__tags) do
    local list = W.tags[tag]
    if not list then
      list = {}
      W.tags[tag] = list
      W.counts[tag] = 0
    end
    list[#list + 1] = e
    W.counts[tag] = W.counts[tag] + 1
  end
  if e.anim then e:play(e.anim) end
  if e.create then e:create() end
  return e
end
nova.spawn = spawn

-- ------------------------------------------------------------------ particles
-- An emitter is an entity that owns a pool of small moving pictures. Everything about a particle is
-- picked from the ranges in the spec when it is born, then it moves with gravity and drag, fades
-- from `color` to `color_end` and shrinks or grows by `size_end`.
local function range(v, default)
  if v == nil then v = default end
  if type(v) == "table" then return v[1], v[2] or v[1] end
  return v, v
end
local function pick(a, b) if a == b then return a end return a + (b - a) * math.random() end

local Emitter = nova.entity { screen = false }
nova.Emitter = Emitter

function Emitter:create()
  self.spec = self.spec or {}
  self.ps = { n = 0 } -- one small table per particle: plain, and fast enough for the 1000 default cap
  self.carry = 0
  self.emitting = true
end

-- A random direction within a cone about `axis` (a unit vector) whose full width is `width` radians.
local function in_cone(axis, width)
  local ax, ay, az = axis[1], axis[2], axis[3]
  local len = sqrt(ax * ax + ay * ay + az * az)
  if len < 1e-9 then ax, ay, az, len = 0, 1, 0, 1 end
  ax, ay, az = ax / len, ay / len, az / len
  -- two vectors across the axis: u = axis x helper, where the helper is whichever of up or x is further from it
  local hx, hy, hz = 0, 1, 0
  if abs(ay) > 0.9 then hx, hy, hz = 1, 0, 0 end
  local ux, uy, uz = ay * hz - az * hy, az * hx - ax * hz, ax * hy - ay * hx
  local ul = sqrt(ux * ux + uy * uy + uz * uz)
  ux, uy, uz = ux / ul, uy / ul, uz / ul
  local vx, vy, vz = ay * uz - az * uy, az * ux - ax * uz, ax * uy - ay * ux
  -- uniform over the cap
  local cosmax = cos(width * 0.5)
  local c = 1 - math.random() * (1 - cosmax)
  local s = sqrt(1 - c * c)
  local phi = math.random() * math.pi * 2
  local px, py = s * cos(phi), s * sin(phi)
  return ax * c + ux * px + vx * py, ay * c + uy * px + vy * py, az * c + uz * px + vz * py
end

local function emit_one(e)
  local ps, spec = e.ps, e.spec
  if ps.n >= (spec.max or 1000) then return end
  if spec.model then
    -- 3D: y is up; the direction is a vector (default straight up) and `spread` the cone's full width
    local life_a, life_b = range(spec.life, { 0.4, 0.9 })
    local speed_a, speed_b = range(spec.speed, { 1, 4 })
    local size_a, size_b = range(spec.size, 1)
    local spin_a, spin_b = range(spec.spin, 0)
    local dx, dy, dz = in_cone(spec.dir or { 0, 1, 0 }, spec.spread or math.pi / 2)
    local speed = pick(speed_a, speed_b)
    local ox, oy, oz = 0, 0, 0
    if spec.area then
      ox, oy, oz = (math.random() - 0.5) * (spec.area[1] or 0), (math.random() - 0.5) * (spec.area[2] or 0), (math.random() - 0.5) * (spec.area[3] or 0)
    end
    ps.n = ps.n + 1
    ps[ps.n] = {
      x = e.x + ox, y = e.y + oy, z = e.z + oz, vx = dx * speed, vy = dy * speed, vz = dz * speed,
      age = 0, life = pick(life_a, life_b), size = pick(size_a, size_b), angle = 0, spin = pick(spin_a, spin_b),
    }
    return
  end
  local life_a, life_b = range(spec.life, { 0.4, 0.9 })
  local speed_a, speed_b = range(spec.speed, { 40, 120 })
  local size_a, size_b = range(spec.size, 4)
  local spin_a, spin_b = range(spec.spin, 0)
  local direction = spec.angle or -math.pi / 2
  local spread = spec.spread or math.pi * 2
  local a = direction + (math.random() - 0.5) * spread
  local speed = pick(speed_a, speed_b)
  local ox, oy = 0, 0
  if spec.area then
    ox, oy = (math.random() - 0.5) * (spec.area[1] or 0), (math.random() - 0.5) * (spec.area[2] or 0)
  end
  local life = pick(life_a, life_b)
  ps.n = ps.n + 1
  ps[ps.n] = {
    x = e.x + ox, y = e.y + oy, vx = cos(a) * speed, vy = sin(a) * speed,
    age = 0, life = life, size = pick(size_a, size_b), angle = 0, spin = pick(spin_a, spin_b),
  }
end

--- Emits `n` particles at once.
function Emitter:burst(n)
  for _ = 1, n or 10 do emit_one(self) end
end

--- Stops making new particles; the emitter removes itself once the last one has faded (if `auto_destroy`).
function Emitter:stop() self.emitting = false end

function Emitter:update(dt)
  local spec = self.spec
  local rate = spec.rate or 0
  if self.emitting and rate > 0 then
    self.carry = self.carry + rate * dt
    local n = floor(self.carry)
    self.carry = self.carry - n
    for _ = 1, n do emit_one(self) end
  end
  local ps = self.ps
  local gravity, drag = spec.gravity or 0, spec.drag or 0
  local damp = drag > 0 and math.max(0, 1 - drag * dt) or 1
  local i = 1
  while i <= ps.n do
    local p = ps[i]
    p.age = p.age + dt
    if p.age >= p.life then
      ps[i] = ps[ps.n]
      ps[ps.n] = nil
      ps.n = ps.n - 1
    else
      p.vy = p.vy + gravity * dt
      p.vx, p.vy = p.vx * damp, p.vy * damp
      p.x, p.y = p.x + p.vx * dt, p.y + p.vy * dt
      if p.z then
        p.vz = p.vz * damp
        p.z = p.z + p.vz * dt
      end
      p.angle = p.angle + p.spin * dt
      i = i + 1
    end
  end
  if self.auto_destroy and ps.n == 0 and (rate == 0 or not self.emitting) then self:destroy() end
end

local particle_opts = { sx = 1, sy = 1, rotation = 0, color = { 255, 255, 255, 255 } }
local particle_color = { 255, 255, 255, 255 }

local model_opts = { scale = 1, ry = 0, tint = { 255, 255, 255, 255 } }

function Emitter:draw()
  if not self.visible then return end
  local ps = self.ps
  local spec = self.spec
  if spec.model then
    local c0 = spec.color or { 255, 255, 255, 255 }
    local c1 = spec.color_end or c0
    local grow = spec.size_end or 1
    local tint = model_opts.tint
    for i = 1, ps.n do
      local p = ps[i]
      local t = p.age / p.life
      tint[1] = c0[1] + ((c1[1] or c0[1]) - c0[1]) * t
      tint[2] = c0[2] + ((c1[2] or c0[2]) - c0[2]) * t
      tint[3] = c0[3] + ((c1[3] or c0[3]) - c0[3]) * t
      tint[4] = ((c0[4] or 255) + ((c1[4] or c0[4] or 255) - (c0[4] or 255)) * t) * self.alpha
      model_opts.scale = p.size * (1 + (grow - 1) * t)
      model_opts.ry = p.angle
      nova.model(spec.model, p.x, p.y, p.z, model_opts)
    end
    return
  end
  local c0 = spec.color or { 255, 255, 255, 255 }
  local c1 = spec.color_end or c0
  local grow = spec.size_end or 1
  local sprite = spec.image and sprite_id(spec.image)
  local w, h = nova.view()
  local camx, camy = W.cam.x - w * 0.5, W.cam.y - h * 0.5
  local iw, ih
  if sprite then iw, ih = raw.image_size(sprite) end
  local col = sprite and particle_opts.color or particle_color
  for i = 1, ps.n do
    local p = ps[i]
    local t = p.age / p.life
    col[1] = c0[1] + ((c1[1] or c0[1]) - c0[1]) * t
    col[2] = c0[2] + ((c1[2] or c0[2]) - c0[2]) * t
    col[3] = c0[3] + ((c1[3] or c0[3]) - c0[3]) * t
    col[4] = ((c0[4] or 255) + ((c1[4] or c0[4] or 255) - (c0[4] or 255)) * t) * self.alpha
    local size = p.size * (1 + (grow - 1) * t)
    local x, y = p.x, p.y
    if not self.screen then x, y = x - camx, y - camy end
    if sprite then
      local s = size / math.max(iw, ih)
      particle_opts.sx, particle_opts.sy, particle_opts.rotation = s, s, p.angle
      if self.screen then nova.ui.sprite(sprite, x, y, particle_opts) else nova.sprite(sprite, x, y, particle_opts) end
    elseif self.screen then
      nova.ui.rect(x - size * 0.5, y - size * 0.5, size, size, col)
    else
      nova.rect(x - size * 0.5, y - size * 0.5, size, size, col)
    end
  end
end

--- `nova.particles(x, y, spec)`: a continuous emitter (`spec.rate` per second) you keep and move; call
--- `:burst(n)` for a puff and `:stop()` to let it fade out.
function nova.particles(x, y, z, spec)
  -- (x, y, spec) for a flat game, (x, y, z, spec) in 3D with `spec.model`
  if type(z) == "table" or z == nil then spec, z = z, 0 end
  spec = spec or {}
  return spawn(Emitter, x, y, { spec = copy_value(spec), screen = spec.screen, depth = spec.depth, z = z })
end

--- `nova.burst(x, y, spec)`: one puff of `spec.count` (default 12) particles that cleans itself up.
function nova.burst(x, y, z, spec)
  if type(z) == "table" or z == nil then spec, z = z, 0 end
  spec = copy_value(spec or {})
  spec.rate = 0
  local e = spawn(Emitter, x, y, { spec = spec, screen = spec.screen, depth = spec.depth, auto_destroy = true, z = z })
  e:burst(spec.count or 12)
  return e
end

-- ------------------------------------------------------------------ tilemaps
-- A grid of tiles from a tileset PNG. The data lives in native code; tile numbers count across the
-- tileset row by row from 0, and -1 is empty. Solid tiles stop entities that slide().
local Tilemap = nova.entity { tags = { "nova_tilemap" }, screen = false }
Tilemap.map = -1
Tilemap.solid = {}

function Tilemap:get(col, row) return raw.tilemap_get(self.map, col, row) end
function Tilemap:set(col, row, tile) raw.tilemap_set(self.map, col, row, tile) end
function Tilemap:size() return raw.tilemap_size(self.map) end -- columns, rows, tile width, tile height
-- The cell (column, row) that contains a world point.
function Tilemap:cell_at(x, y)
  local _, _, tw, th = raw.tilemap_size(self.map)
  return floor((x - self.x) / tw), floor((y - self.y) / th)
end
-- The tile number under a world point (-1 when empty or outside the map).
function Tilemap:tile_at(x, y)
  local col, row = self:cell_at(x, y)
  return raw.tilemap_get(self.map, col, row)
end
function Tilemap:is_solid_at(x, y)
  local t = self:tile_at(x, y)
  return t >= 0 and self.solid[t] == true
end
function Tilemap:draw()
  if not self.visible then return end
  if self.screen then
    raw.tilemap_draw(self.map, self.x, self.y, "ui")
  else
    local w, h = nova.view()
    raw.tilemap_draw(self.map, self.x - (W.cam.x - w * 0.5), self.y - (W.cam.y - h * 0.5), "world")
  end
end

-- nova.tilemap { image = "tiles", tile_width = 16, tile_height = 16, tiles = { {0, 1}, {-1, 2} },
--                solid = { 1, 2 }, x = 0, y = 0, depth = 100 }
function nova.tilemap(spec)
  local solid = {}
  for _, t in ipairs(spec.solid or {}) do solid[t] = true end
  local map = raw.tilemap_create(spec)
  return spawn(Tilemap, spec.x or 0, spec.y or 0, { map = map, solid = solid, depth = spec.depth or 100 })
end

-- Does a world rectangle overlap a solid tile? Returns the tilemap cell edges that block it.
local function solid_overlap(x0, y0, x1, y1)
  local list = W.tags.nova_tilemap
  if not list then return nil end
  for i = 1, #list do
    local tm = list[i]
    if not tm._dead and next(tm.solid) then
      local cols, rows, tw, th = raw.tilemap_size(tm.map)
      local c0 = math.max(0, floor((x0 - tm.x) / tw))
      local c1 = math.min(cols - 1, floor((x1 - 0.0001 - tm.x) / tw))
      local r0 = math.max(0, floor((y0 - tm.y) / th))
      local r1 = math.min(rows - 1, floor((y1 - 0.0001 - tm.y) / th))
      for r = r0, r1 do
        for c = c0, c1 do
          local t = raw.tilemap_get(tm.map, c, r)
          if t >= 0 and tm.solid[t] then
            return tm.x + c * tw, tm.y + r * th, tm.x + (c + 1) * tw, tm.y + (r + 1) * th
          end
        end
      end
    end
  end
  return nil
end

-- True when a world point is inside a solid tile of any tilemap.
function nova.solid_at(x, y)
  return solid_overlap(x, y, x + 0.001, y + 0.001) ~= nil
end

-- The biggest safe sub-step: half the smallest solid tile, so a fast move cannot jump a wall.
local function solid_step()
  local best = 8
  local list = W.tags.nova_tilemap
  if list then
    for i = 1, #list do
      local tm = list[i]
      if not tm._dead and next(tm.solid) then
        local _, _, tw, th = raw.tilemap_size(tm.map)
        best = math.min(best, tw / 2, th / 2)
      end
    end
  end
  return math.max(best, 1)
end

local function slide_axis(e, delta, horizontal, limit)
  local blocked = false
  local steps = math.max(1, math.ceil(abs(delta) / limit))
  local each = delta / steps
  for _ = 1, steps do
    if horizontal then e.x = e.x + each else e.y = e.y + each end
    for _ = 1, 4 do
      local x0, y0, x1, y1 = bounds(e)
      if not x0 then return blocked end
      local sx0, sy0, sx1, sy1 = solid_overlap(x0, y0, x1, y1)
      if not sx0 then break end
      blocked = true
      if horizontal then
        if each > 0 then e.x = e.x - (x1 - sx0) else e.x = e.x + (sx1 - x0) end
      else
        if each > 0 then e.y = e.y - (y1 - sy0) else e.y = e.y + (sy1 - y0) end
      end
    end
    if blocked then break end
  end
  return blocked
end

-- Move by dx, dy and stop against solid tiles, one axis at a time so entities slide along walls.
-- Large moves are taken in small steps, so nothing tunnels through a thin wall.
-- Returns whether it was blocked horizontally and vertically.
function Entity:slide(dx, dy)
  local limit = solid_step()
  local blocked_x = dx ~= 0 and slide_axis(self, dx, true, limit) or false
  local blocked_y = dy ~= 0 and slide_axis(self, dy, false, limit) or false
  return blocked_x, blocked_y
end

function nova.each(tag, fn)
  local list = W.tags[tag]
  if not list then return end
  for i = 1, #list do
    local e = list[i]
    if not e._dead then fn(e) end
  end
end

function nova.all(tag)
  local out = {}
  local list = W.tags[tag]
  if list then
    for i = 1, #list do
      local e = list[i]
      if not e._dead then out[#out + 1] = e end
    end
  end
  return out
end

function nova.first(tag)
  local list = W.tags[tag]
  if list then
    for i = 1, #list do
      if not list[i]._dead then return list[i] end
    end
  end
  return nil
end

function nova.count(tag) return W.counts[tag] or 0 end

-- A grid of the entities with a tag, by where they are (a point each), built the first time it is asked for in a step. It is
-- what makes "who is near here?" cheap when there are hundreds of entities; a few entities are just looked through.
local pgrids = {}
local POINT_GRID_FROM = 40
local function point_grid(tag, list)
  local g = pgrids[tag]
  if g and g.step == W.step_id then return g end
  g = { step = W.step_id, cells = {} }
  local cells = g.cells
  for i = 1, #list do
    local e = list[i]
    if not e._dead then
      local key = cell_key(floor(e.x / grid_cell), floor((XZ and e.z or e.y) / grid_cell))
      local cell = cells[key]
      if not cell then cell = {}; cells[key] = cell end
      cell[#cell + 1] = e
    end
  end
  pgrids[tag] = g
  return g
end

--- The entities with `tag` within `radius` of the point (x, y) (x, z in a ground-plane game), into `out` if given.
function nova.in_radius(x, y, radius, tag, out)
  out = out or {}
  local n = 0
  local list = W.tags[tag]
  if list then
    local r2 = radius * radius
    if #list < POINT_GRID_FROM then
      for i = 1, #list do
        local e = list[i]
        if not e._dead then
          local dx, dy = e.x - x, (XZ and e.z or e.y) - y
          if dx * dx + dy * dy <= r2 then
            n = n + 1
            out[n] = e
          end
        end
      end
    else
      local cells = point_grid(tag, list).cells
      -- (one square more each way: entities move a little after the grid was made)
      for cx = floor((x - radius) / grid_cell) - 1, floor((x + radius) / grid_cell) + 1 do
        for cy = floor((y - radius) / grid_cell) - 1, floor((y + radius) / grid_cell) + 1 do
          local cell = cells[cell_key(cx, cy)]
          if cell then
            for i = 1, #cell do
              local e = cell[i]
              if not e._dead then
                local dx, dy = e.x - x, (XZ and e.z or e.y) - y
                if dx * dx + dy * dy <= r2 then
                  n = n + 1
                  out[n] = e
                end
              end
            end
          end
        end
      end
    end
  end
  for i = #out, n + 1, -1 do out[i] = nil end
  return out
end

local near_scratch = {}
--- The nearest entity with `tag` to (x, y) ((x, z) in a ground-plane game), within `max_distance` if given.
function nova.nearest(x, y, tag, max_distance)
  local list = W.tags[tag]
  if not list then return nil end
  if max_distance and #list >= POINT_GRID_FROM then
    local found = nova.in_radius(x, y, max_distance, tag, near_scratch)
    local best, best_d = nil, max_distance * max_distance
    for i = 1, #found do
      local e = found[i]
      local dx, dy = e.x - x, (XZ and e.z or e.y) - y
      local d = dx * dx + dy * dy
      if d <= best_d then best, best_d = e, d end
    end
    return best
  end
  local best, best_d = nil, (max_distance or math.huge) ^ 2
  for i = 1, #list do
    local e = list[i]
    if not e._dead then
      local dx, dy = e.x - x, (XZ and e.z or e.y) - y
      local d = dx * dx + dy * dy
      if d <= best_d then best, best_d = e, d end
    end
  end
  return best
end

--- How the last frame went: fps, lua_ms, render_ms, draws, triangles, sprites, memory_kb (the scripts' memory), and what the
--- framework knows: entities (live), scenery (static pieces).
local host_stats = nova.stats
function nova.stats()
  local t = host_stats()
  t.entities = #W.list
  t.scenery = scenery.count()
  return t
end

--- `nova.collision { plane = "xz", cell = 4 }`: which fields are the ground for collisions and distances, and how big the
--- broad phase's squares are. Call it once, early (main.lua).
function nova.collision(opts)
  opts = opts or {}
  if opts.plane ~= nil then
    if opts.plane ~= "xy" and opts.plane ~= "xz" then error("nova.collision: plane is \"xy\" (a flat game) or \"xz\" (a 3D game on the ground), not " .. tostring(opts.plane), 2) end
    XZ = opts.plane == "xz"
  end
  if opts.cell ~= nil then
    if type(opts.cell) ~= "number" or opts.cell <= 0 then error("nova.collision: cell must be a number above 0 (the size of a square of the broad phase)", 2) end
    grid_cell = opts.cell
  end
  grids, pgrids = {}, {}
end

-- nova.send(entity_or_tag, "message", ...) calls that method on one entity or on every entity with the tag.
function nova.send(target, message, ...)
  if type(target) == "string" then
    local list = W.tags[target]
    if list then
      for i = 1, #list do
        local e = list[i]
        if not e._dead and e[message] then e[message](e, ...) end
      end
    end
  elseif target and not target._dead and target[message] then
    return target[message](target, ...)
  end
end

function nova.pause(on) W.paused = on ~= false end
function nova.count_alive() return #W.list end
nova.wait, nova.wait_until, nova.ease = timers.wait, timers.wait_until, timers.ease

-- ------------------------------------------------------------------ camera (2D)
local cam = W.cam
nova.cam = {}
-- Put the camera's centre at a world point.
function nova.cam.set(x, y)
  cam.x, cam.y, cam.set, cam.follow = x, y, true, nil
end
-- Follow an entity; lerp 1 locks on, smaller values trail behind (0.1 is smooth).
function nova.cam.follow(entity, lerp)
  cam.follow, cam.lerp = entity, lerp or 1
  if entity and not cam.set then cam.x, cam.y, cam.set = entity.x, entity.y, true end
end
-- Keep the view inside this world rectangle.
function nova.cam.limit(x0, y0, x1, y1) cam.limit = { x0, y0, x1, y1 } end
function nova.cam.position() return cam.x, cam.y end

local function clamp_camera()
  local l = cam.limit
  if not l then return end
  local vw, vh = nova.view()
  local lo_x, hi_x = l[1] + vw * 0.5, l[3] - vw * 0.5
  local lo_y, hi_y = l[2] + vh * 0.5, l[4] - vh * 0.5
  cam.x = lo_x > hi_x and (l[1] + l[3]) * 0.5 or math.max(lo_x, math.min(hi_x, cam.x))
  cam.y = lo_y > hi_y and (l[2] + l[4]) * 0.5 or math.max(lo_y, math.min(hi_y, cam.y))
end

local function update_camera()
  local f = cam.follow
  if f then
    if f._dead then
      cam.follow = nil
    else
      local k = cam.lerp or 1
      cam.x, cam.y = cam.x + (f.x - cam.x) * k, cam.y + (f.y - cam.y) * k
    end
  end
  clamp_camera()
end

-- ------------------------------------------------------------------ collisions
local function grid_for(tag)
  local g = grids[tag]
  if g and g.step == W.step_id then return g end
  g = { step = W.step_id, cells = {} }
  local list = W.tags[tag]
  if list then
    for i = 1, #list do
      local e = list[i]
      if not e._dead then
        local x0, y0, x1, y1 = bounds(e)
        if x0 then
          for cx = floor(x0 / grid_cell), floor(x1 / grid_cell) do
            for cy = floor(y0 / grid_cell), floor(y1 / grid_cell) do
              local key = cell_key(cx, cy)
              local cell = g.cells[key]
              if not cell then
                cell = {}
                g.cells[key] = cell
              end
              cell[#cell + 1] = e
            end
          end
        end
      end
    end
  end
  grids[tag] = g
  return g
end

--- A ray along the ground (x, y in a flat game, x, z in a ground-plane game) from (x, y) in the direction (dx, dy), at most
--- `length` long, against the entities with `tag` that have a hitbox. Returns the nearest `entity, distance, hit_x, hit_y`, or
--- nothing. `opts`: `ignore` (an entity to skip, such as the shooter), and for a ground-plane game `height` (where the ray starts,
--- up) and `slope` (how much it rises per metre; negative falls), so that a shot can pass over a short thing or under a tall one.
function nova.raycast(x, y, dx, dy, length, tag, opts)
  local len = sqrt(dx * dx + dy * dy)
  if len < 1e-9 or length <= 0 then return nil end
  dx, dy = dx / len, dy / len
  local ignore = opts and opts.ignore
  local h0, slope = opts and opts.height, opts and opts.slope or 0
  local cells = grid_for(tag).cells
  local best, best_e = length, nil
  local seen_here = {}
  local t = 0
  while true do
    local px, py = x + dx * t, y + dy * t
    for gx = floor(px / grid_cell) - 1, floor(px / grid_cell) + 1 do
      for gy = floor(py / grid_cell) - 1, floor(py / grid_cell) + 1 do
        local cell = cells[cell_key(gx, gy)]
        if cell then
          for i = 1, #cell do
            local e = cell[i]
            if e ~= ignore and not e._dead and not seen_here[e] then
              seen_here[e] = true
              local x0, y0, x1, y1, r = bounds(e)
              local hit
              if r then
                -- a circle: how far along the ray does it first reach it?
                local rx, ry = (x0 + x1) / 2 - x, (y0 + y1) / 2 - y
                local along = rx * dx + ry * dy
                local across = rx * -dy + ry * dx
                if across * across < r * r then
                  local d = along - sqrt(r * r - across * across)
                  if d < 0 and along + sqrt(r * r - across * across) >= 0 then d = 0 end
                  if d >= 0 then hit = d end
                end
              else
                -- a box: the slab test
                local tmin, tmax = 0, math.huge
                for axis = 1, 2 do
                  local o, v, lo, hi
                  if axis == 1 then o, v, lo, hi = x, dx, x0, x1 else o, v, lo, hi = y, dy, y0, y1 end
                  if abs(v) < 1e-12 then
                    if o < lo or o > hi then tmin, tmax = 1, 0 end
                  else
                    local a, b = (lo - o) / v, (hi - o) / v
                    if a > b then a, b = b, a end
                    tmin, tmax = math.max(tmin, a), math.min(tmax, b)
                  end
                end
                if tmin <= tmax then hit = tmin end
              end
              if hit and hit < best then
                -- over or under it? (only when the ray has a height and the thing has one)
                local ok = true
                if XZ and h0 then
                  local b0, b1 = vrange(e)
                  if b0 then
                    local at = h0 + slope * hit
                    ok = at >= b0 and at <= b1
                  end
                end
                if ok then best, best_e = hit, e end
              end
            end
          end
        end
      end
    end
    if t >= best or t >= length then break end
    t = math.min(length, t + grid_cell * 0.5)
  end
  if best_e then return best_e, best, x + dx * best, y + dy * best end
end

local seen = {}
local hits = {}
local seen_mark = 0

local function collide_pass()
  local list = W.list
  for i = 1, #list do
    local a = list[i]
    local handlers = not a._dead and getmetatable(a).__collide
    if handlers and #handlers > 0 then
      local x0, y0, x1, y1 = bounds(a)
      if x0 then
        for h = 1, #handlers do
          local handler = handlers[h]
          local grid = grid_for(handler.tag)
          seen_mark = seen_mark + 1
          local n = 0
          for cx = floor(x0 / grid_cell), floor(x1 / grid_cell) do
            for cy = floor(y0 / grid_cell), floor(y1 / grid_cell) do
              local cell = grid.cells[cell_key(cx, cy)]
              if cell then
                for j = 1, #cell do
                  local b = cell[j]
                  if b ~= a and seen[b] ~= seen_mark and not b._dead then
                    seen[b] = seen_mark
                    if overlap(a, b) then
                      n = n + 1
                      hits[n] = b
                    end
                  end
                end
              end
            end
          end
          for k = 1, n do
            local b = hits[k]
            hits[k] = nil
            if not a._dead and not b._dead then a[handler.name](a, b) end
          end
        end
      end
    end
  end
end

-- ------------------------------------------------------------------ scenes
local RESERVED_SCENE_NAMES = { enter = true, leave = true, update = true, draw = true, draw_ui = true, after = true, every = true, go = true, tween = true }

function Scene:after(seconds, fn) return timers.after(self, seconds, fn) end
function Scene:every(seconds, fn) return timers.every(self, seconds, fn) end
function Scene:go(fn) return timers.go(self, fn) end
function Scene:tween(props, seconds, easing, on_done) return timers.tween(self, self, props, seconds, easing, on_done) end

local function build_scene(scene, data, file)
  if data.background then W.background = data.background end
  if data.width and data.height then nova.cam.limit(0, 0, data.width, data.height) end
  local cam = data.camera
  if cam then nova.camera(cam.eye[1], cam.eye[2], cam.eye[3], cam.target[1], cam.target[2], cam.target[3], cam.fov) end
  local sky = data.sky
  if sky then nova.sky { top = sky.top, horizon = sky.horizon } end
  local fog = data.fog
  if fog then nova.fog { color = fog.color, near = fog.near, far = fog.far } end
  local function named(item, e)
    local name = item.name
    if not name then return end
    if RESERVED_SCENE_NAMES[name] or type(scene[name]) == "function" then
      error(file .. ": '" .. name .. "' is the name of something every scene already has; give it another name", 0)
    end
    scene[name] = e
  end
  for _, o in ipairs(data.objects) do
    local props = o.props or {}
    if o.z ~= 0 and props.z == nil then props.z = o.z end
    named(o, spawn(o.kind, o.x, o.y, props))
  end
  for _, im in ipairs(data.images) do
    named(im, spawn(Picture, im.x, im.y, {
      image = im.image, sx = im.scale, sy = im.scale, depth = im.depth, screen = im.layer == "ui", tint = im.color,
      alpha = im.color and im.color[4] and im.color[4] / 255 or 1,
    }))
  end
  for _, tm in ipairs(data.tilemaps or {}) do
    local solid = {}
    for _, t in ipairs(tm.solid) do solid[t] = true end
    local ts = tm.tileset
    local map = raw.tilemap_create({ image = ts.image, tile_width = ts.tile_width, tile_height = ts.tile_height, tiles = tm.tiles })
    named(tm, spawn(Tilemap, tm.x, tm.y, { map = map, solid = solid, depth = tm.depth }))
  end
  for _, t in ipairs(data.texts) do
    named(t, spawn(Text, t.x, t.y, { text = t.text, size = t.scale, color = t.color, depth = t.depth }))
  end
end

local function leave_scene()
  local scene = W.scene
  if scene and scene.leave then scene:leave() end
  if scene then scene._dead = true end
  for i = 1, #W.list do W.list[i]._dead = true end
  W.list, W.tags, W.counts = {}, {}, {}
  scenery.clear()
  W.dirty, W.background, W.paused = false, nil, false
  grids, pgrids = {}, {}
  timers.clear()
  cam.follow, cam.limit, cam.set = nil, nil, false
  W.scene, W.scene_name = nil, nil
end

local function enter_scene(name, args)
  leave_scene()
  local cls = finalize(resolve(name, "scene"))
  local scene = setmetatable({}, cls)
  for k, v in pairs(cls.__defaults) do scene[k] = copy_value(v) end
  W.scene, W.scene_name, W.time, W.acc = scene, name, 0, 0
  local vw, vh = nova.view()
  cam.x, cam.y = vw * 0.5, vh * 0.5
  local short = name:gsub("^scenes%.", "")
  local data = raw.scene_data(short)
  if data then build_scene(scene, data, "scenes/" .. short:gsub("%.", "/") .. ".scene.json") end
  if scene.enter then scene:enter(table.unpack(args, 1, args.n or #args)) end
end

function nova.goto_scene(name, ...)
  if type(name) ~= "string" then error("goto_scene(name, ...): the scene name must be a string", 2) end
  W.pending = { name = name, args = table.pack(...) }
end

function nova.restart_scene()
  if not W.scene_name then error("restart_scene(): no scene is running", 2) end
  W.pending = { name = W.scene_name, args = { n = 0 } }
end

function nova.current_scene() return W.scene_name and (W.scene_name:gsub("^scenes%.", "")) end

local function switch_if_pending()
  local p = W.pending
  if p then
    W.pending = nil
    enter_scene(p.name, p.args)
  end
end

-- ------------------------------------------------------------------ the frame
local function compact()
  if not W.dirty then return end
  W.dirty = false
  local function sweep(list)
    local j = 0
    for i = 1, #list do
      local e = list[i]
      if not e._dead then
        j = j + 1
        list[j] = e
      end
    end
    for i = #list, j + 1, -1 do list[i] = nil end
  end
  sweep(W.list)
  for _, list in pairs(W.tags) do sweep(list) end
end

local function step(dt)
  raw.input_step() -- presses and releases since the last step become visible to this one
  W.step_id = W.step_id + 1
  W.time = W.time + dt
  timers.update(dt)
  if not W.paused then
    local list = W.list
    for i = 1, #list do
      local e = list[i]
      if not e._dead then
        local update = e.update
        if update then update(e, dt) end
        if not e._dead then
          if e._anim then animate(e, dt) end
          if e._clip then advance_clip(e, dt) end
          -- (a class that moves itself, with nova.walls.move say, sets `velocity = false`, so that its own vx and vz are its own)
          if e.velocity ~= false then
            local vx, vy, vz = e.vx, e.vy, e.vz
            if vx ~= 0 then e.x = e.x + vx * dt end
            if vy ~= 0 then e.y = e.y + vy * dt end
            if vz ~= 0 then e.z = e.z + vz * dt end
          end
        end
      end
    end
    collide_pass()
  end
  local scene = W.scene
  if scene and scene.update then scene:update(dt) end
  update_camera()
  compact()
end

local function frame_update(dt)
  switch_if_pending()
  W.acc = W.acc + dt
  local steps = 0
  while W.acc >= STEP and steps < MAX_STEPS do
    W.acc = W.acc - STEP
    step(STEP)
    steps = steps + 1
    switch_if_pending()
  end
  if steps == MAX_STEPS then W.acc = 0 end
end

local order = {}
local function by_depth(a, b)
  if a.depth ~= b.depth then return a.depth > b.depth end
  return a.id < b.id
end

local function frame_draw()
  local bg = W.background
  if bg then nova.clear(bg[1], bg[2], bg[3]) end
  local list = W.list
  local n = 0
  for i = 1, #list do
    local e = list[i]
    if not e._dead and e.visible then
      n = n + 1
      order[n] = e
    end
  end
  for i = #order, n + 1, -1 do order[i] = nil end
  table.sort(order, by_depth)
  for i = 1, n do
    local e = order[i]
    if not e._dead then e:draw() end
  end
  local scene = W.scene
  if scene then
    if scene.draw then scene:draw() end
    if piece_count > 0 and (scenery.range or 1) > 0 then scenery.draw(eye_x, eye_z, scenery.range) end
    if scene.draw_ui then scene:draw_ui() end
  end
end

-- Hand the frame to the framework: the first scene is loaded, then update/draw run it.
function nova.start(first)
  if W.started then error("nova.start was already called", 2) end
  if type(first) ~= "string" then error("nova.start(scene_name): give the name of the first scene", 2) end
  W.started = true
  raw.use_fixed_steps()
  W.pending = { name = first, args = { n = 0 } }
  _G.update, _G.draw = frame_update, frame_draw
end
