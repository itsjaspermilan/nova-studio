-- nova.anim: plays keyframe animations from animations/<name>.anim.json (format: docs/project-format.md, checked by anim.rs).
--
--   local door = nova.play_anim("door_open", { target = self, on_finish = function() self.open = true end })
--   door:pause()  door:resume()  door:seek(0.5)  door.speed = -1  door:stop()
--
-- A player moves fields of things through the file's keys every game step (60 a second, so a headless run is repeatable),
-- calls functions at event keys and plays sounds at sound keys. Several play at once; the last one to write a field wins.
local M = {}

local ease = require("nova.timers").ease
local list = {}  -- every live player, in the order they started
local cache = {} -- name -> the checked file
local ctx        -- what the framework gives: world, cam, camera3, apply_camera3
-- Times this close count as the same moment: steps of 1/60 s add up with rounding, and 30 of them should reach a key at 0.5 s.
local EPS = 1e-7

function M.bind(c) ctx = c end

local function data_of(name)
  local d = cache[name]
  if d == nil then
    d = nova.raw.anim_data(name)
    if d == nil then error("no animation '" .. name .. "' (looked for animations/" .. name:gsub("%.", "/") .. ".anim.json)", 0) end
    cache[name] = d
  end
  return d
end
M.data = data_of

-- ------------------------------------------------------------------ curves
local function bezier(c, x)
  -- a CSS-style cubic-bezier(x1, y1, x2, y2): find s with X(s) = x (Newton, then halving if it wanders), give Y(s)
  local x1, y1, x2, y2 = c[1], c[2], c[3], c[4]
  local function X(s) return ((1 - 3 * x2 + 3 * x1) * s + (3 * x2 - 6 * x1)) * s * s + 3 * x1 * s end
  local function Y(s) return ((1 - 3 * y2 + 3 * y1) * s + (3 * y2 - 6 * y1)) * s * s + 3 * y1 * s end
  local s = x
  for _ = 1, 8 do
    local d = 3 * (1 - 3 * x2 + 3 * x1) * s * s + 2 * (3 * x2 - 6 * x1) * s + 3 * x1
    if math.abs(d) < 1e-6 then break end
    local next_s = s - (X(s) - x) / d
    if next_s < 0 or next_s > 1 then break end
    s = next_s
  end
  if math.abs(X(s) - x) > 1e-4 then
    local lo, hi = 0, 1
    s = x
    for _ = 1, 30 do
      if X(s) < x then lo = s else hi = s end
      s = (lo + hi) / 2
    end
  end
  return Y(s)
end

local function eased(e, k)
  if type(e) == "table" then return bezier(e, k) end
  if e == "step" then return 0 end
  return ease[e](k)
end
M.eased = eased

-- The track's value at time t: before the first key the first key's value, after the last the last's.
-- `out` is the track's own table for list values (refilled, never a new table per step).
local function sample(track, t, out)
  local keys = track.keys
  local n = #keys
  if n == 0 then return nil end
  local i = track._i or 1 -- (the segment found last time: playback moves a little each step)
  if i > n then i = n end
  while i > 1 and keys[i].time > t do i = i - 1 end
  while i < n and keys[i + 1].time <= t + EPS do i = i + 1 end
  track._i = i
  local a = keys[i]
  local b = keys[i + 1]
  local k = 0
  if b and t > a.time and b.time > a.time then k = eased(a.ease, (t - a.time) / (b.time - a.time)) end
  if t < a.time then k = 0 end
  local av = a.value
  if type(av) == "number" then
    if not b or k == 0 then return av end
    return av + (b.value - av) * k
  end
  for j = 1, #av do
    local v = av[j]
    out[j] = (b and k ~= 0) and v + (b.value[j] - v) * k or v
  end
  return out
end
M.sample = sample

-- ------------------------------------------------------------------ targets
local camera = {} -- the camera as a thing with fields: x, y (the 2D camera's centre), eye_x .. target_z, fov (the 3D camera)
local CAM2 = { x = true, y = true }

local function resolve(player, name)
  if name == "self" then return player.target end
  local given = player.targets and player.targets[name]
  if given ~= nil then return given end
  local W = ctx.world
  if name == "scene" then return W.scene end
  if name == "camera" then return camera end
  local scene = W.scene
  local v = scene and rawget(scene, name)
  if type(v) == "table" then return v end
  local tagged = W.tags[name]
  if tagged then
    for i = 1, #tagged do
      if not tagged[i]._dead then return tagged[i] end
    end
  end
  return nil
end

-- Where a field path ("x", "hud.alpha") ends: the table that holds the last name, and that name.
local function holder(obj, track)
  local path = track._path
  if not path then
    path = {}
    for part in track.field:gmatch("[^.]+") do path[#path + 1] = part end
    track._path = path
  end
  for i = 1, #path - 1 do
    local nxt = obj[path[i]]
    if type(nxt) ~= "table" then
      nxt = {}
      obj[path[i]] = nxt
    end
    obj = nxt
  end
  return obj, path[#path]
end

local function read(obj, track)
  if obj == camera then
    local f = track.field
    if CAM2[f] then return ctx.cam[f] end
    return ctx.camera3[f]
  end
  local h, key = holder(obj, track)
  return h[key]
end

local function write(player, obj, track, v)
  if obj == camera then
    local f = track.field
    if CAM2[f] then
      local cam = ctx.cam
      cam[f], cam.set, cam.follow = v, true, nil
    elseif ctx.camera3[f] ~= nil then
      ctx.camera3[f] = v
      player._cam3 = true
    end
    return
  end
  local h, key = holder(obj, track)
  h[key] = v -- (a list value is the player's own table for this track, refilled each step)
end

-- ------------------------------------------------------------------ players
local Player = {}
Player.__index = Player

local function check_target(player, track, at)
  local obj = resolve(player, track.target)
  if obj == nil then
    error(("animation '%s', track %d: nothing called '%s' to animate (give it as target, in targets, name a scene object or tag it)")
      :format(player.name, at, track.target), 0)
  end
  return obj
end

local function apply(player)
  local t = player.time
  for i, track in ipairs(player.data.tracks) do
    if track.type == "value" then
      local obj = player._objs[i]
      if obj and not obj._dead then
        local v = sample(track, t, player._bufs[i])
        if v ~= nil then
          local base = player._base[i]
          if base ~= nil then
            if type(v) == "number" then v = base + v
            else
              local sum = player._sums[i]
              for j = 1, #v do sum[j] = (base[j] or 0) + v[j] end
              v = sum
            end
          end
          write(player, obj, track, v)
        end
      end
    end
  end
  if player._cam3 then
    player._cam3 = false
    ctx.apply_camera3()
  end
end

-- Event and sound keys whose time is in (a, b] (going forward) or [b, a) (going backward); `closed` includes a itself.
local function fire(player, a, b, closed)
  local forward = b >= a
  for i, track in ipairs(player.data.tracks) do
    if track.type ~= "value" then
      local keys = track.keys
      local first, last, step = 1, #keys, 1
      if not forward then first, last, step = #keys, 1, -1 end
      for j = first, last, step do
        local k = keys[j]
        local hit
        local t = k.time
        if forward then hit = (t > a + EPS or (closed and t >= a - EPS)) and t <= b + EPS
        else hit = (t < a - EPS or (closed and t <= a + EPS)) and t >= b - EPS end
        if hit then
          if track.type == "sound" then
            nova.sound.play(k.sound, { volume = k.volume, pitch = k.pitch, pan = k.pan })
          else
            local obj = player._objs[i] or resolve(player, track.target)
            if obj and not obj._dead then
              local fn = obj[k.call]
              if type(fn) ~= "function" then
                error(("animation '%s': '%s' has no function '%s' to call at %.3f s"):format(player.name, track.target, k.call, k.time), 0)
              end
              fn(obj, table.unpack(k.args))
            end
          end
          if player.dead then return end
        end
      end
    end
  end
end

function Player:pause() self.paused = true return self end
function Player:resume() self.paused = false return self end
function Player:stop() self.dead = true end
function Player:playing() return not self.dead and not self.paused end
function Player:finished() return self.done == true end
function Player:length() return self.data.length end
-- Jump to a time (seconds, kept within the animation): fields take their values there at once; no event or sound keys fire.
function Player:seek(t)
  local len = self.data.length
  if type(t) ~= "number" then error("seek(seconds): give a time in seconds", 2) end
  self.time = math.max(0, math.min(len, t))
  if self.dead and self.done then self.dead, self.done = false, false; list[#list + 1] = self end
  apply(self)
  return self
end

local function finish(self)
  self.dead, self.done = true, true
  local cb = self.on_finish
  if cb then cb(self.target, self) end
end

function Player:step(dt)
  if self.dead or self.paused then return end
  local owner = self.target
  if type(owner) == "table" and owner._dead then self.dead = true return end
  if self.pausable and ctx.world.paused then return end
  local len, speed = self.data.length, self.speed or 1
  if speed == 0 then return end
  local a = self.time
  local b = a + dt * speed
  if self.loop then
    local wraps = 0
    while (b > len + EPS or b < -EPS) and wraps < 1000 do
      wraps = wraps + 1
      if b > len then
        fire(self, a, len, false)
        a, b = 0, b - len
        fire(self, -1, 0, false) -- (a key at 0 plays again each time round)
      else
        fire(self, a, 0, false)
        a, b = len, b + len
        fire(self, len + 1, len, false)
      end
      if self.dead then return end
    end
    if math.abs(b) < EPS then b = 0 elseif math.abs(b - len) < EPS then b = len end
    self.time = b
    apply(self) -- (values first, so a function called by an event key sees them where they are now)
    fire(self, a, b, false)
    return
  end
  local ends = (speed > 0 and b >= len - EPS) or (speed < 0 and b <= EPS)
  if ends then b = speed > 0 and len or 0 end
  self.time = b
  apply(self)
  fire(self, a, b, false)
  if self.dead then return end
  if ends then finish(self) end
end

--- Plays animations/<name>.anim.json. opts: target (what "self" in the file means: usually the entity or scene that plays it),
--- targets (a table of name = thing, for other names in the file), speed (1; below 0 plays backwards from the end), loop (the
--- file's own by default), from (a start time in seconds), on_finish(target, player), pausable (whether nova.pause holds it:
--- true when the target is an entity, false for a scene, so a pause menu can slide in while the game is paused).
--- Playing the same animation again on the same target replaces the one already playing.
function M.play(name, opts)
  if type(name) ~= "string" then error("play_anim(name, opts): the animation's name must be a string", 3) end
  opts = opts or {}
  if type(opts) ~= "table" then error("play_anim(name, opts): opts must be a table", 3) end
  local data = data_of((name:gsub("^animations[./]", ""):gsub("%.anim%.json$", "")))
  local target = opts.target
  if target == nil then target = ctx.world.scene end
  for _, p in ipairs(list) do
    if p.name == name and p.target == target and not p.dead then p.dead = true end
  end
  local speed = opts.speed or 1
  local p = setmetatable({
    name = name, data = data, target = target, targets = opts.targets, speed = speed,
    loop = opts.loop, on_finish = opts.on_finish, paused = false, dead = false, done = false,
    _objs = {}, _bufs = {}, _base = {}, _sums = {},
  }, Player)
  if p.loop == nil then p.loop = data.loop end
  if opts.pausable ~= nil then p.pausable = opts.pausable
  else p.pausable = type(target) == "table" and target ~= ctx.world.scene and rawget(target, "id") ~= nil end
  for i, track in ipairs(data.tracks) do
    if track.type ~= "sound" then
      local obj = check_target(p, track, i)
      p._objs[i] = obj
      if track.type == "value" then
        p._bufs[i] = {}
        if track.relative then
          local now = read(obj, track)
          if type(now) == "table" then
            local copy = {}
            for j = 1, #now do copy[j] = now[j] end
            p._base[i] = copy
            p._sums[i] = {}
          else
            p._base[i] = now or 0
          end
        end
      end
    end
  end
  local len = data.length
  p.time = math.max(0, math.min(len, opts.from or (speed < 0 and len or 0)))
  list[#list + 1] = p
  apply(p)
  fire(p, p.time, p.time, true) -- (keys at the start time happen now)
  return p
end

function M.update(dt, scale)
  local n = #list
  for i = 1, n do
    local p = list[i]
    if not p.dead then
      local d = scale and dt * scale(p.target) or dt
      if d > 0 then p:step(d) end
    end
  end
  local j = 0
  for i = 1, #list do
    local p = list[i]
    if not p.dead then
      j = j + 1
      list[j] = p
    end
  end
  for i = #list, j + 1, -1 do list[i] = nil end
end

--- Stops every animation playing on `target` (or every one, given nothing).
function M.stop_all(target)
  for _, p in ipairs(list) do
    if target == nil or p.target == target then p.dead = true end
  end
end

function M.clear()
  for i = #list, 1, -1 do list[i] = nil end
end
function M.count()
  local n = 0
  for _, p in ipairs(list) do if not p.dead then n = n + 1 end end
  return n
end

return M
