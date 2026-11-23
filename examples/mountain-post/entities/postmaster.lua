-- The postmaster: a fox in a blue postal jacket and a peaked cap (models/postmaster.glb, character3d_make). The left stick moves
-- as the camera sees it, in two gaits by how far it is pushed: a gentle tilt is the waddling walk; a full push is a run with the
-- arms held straight out to the sides like wings (the "run" clip; the walk and run clips are mixed by speed, so the arms ease up
-- and down as it speeds up and slows). Carrying a parcel, the arms hold it at the chest (the "carry" clip laid over the arms) and
-- the full push is a brisk trot instead. In the van they sit at the wheel (the "sit" clip), drawn in the cab and carried by the
-- body as it leans, the hands on the wheel as it turns, the head turning a little into a bend. The scene decides what A and B do;
-- this file only moves, animates and is heard.
local world = require("lib.world")
local state = require("lib.state")
local camera = require("lib.camera")
local face = require("lib.face")

-- the speeds at which the walk, run and trot do not slide: the long, calm strides of tools/strides.mjs (TARGET there; the owner after
-- the second play: "the animation needs to slow down a bit and the player should be able to move faster")
local WALK, RUN, TROT = 1.6, 3.0, 2.2
local STROLL = 1.6                    -- the walk's top: a stick pushed up to TILT walks, up to this
local TILT = 0.7                      -- past this much push the walk turns into the run (or the trot)
local TOP, TOP_CARRY = 3.0, 2.2        -- metres a second at a full push: running, trotting with a parcel
-- (the clips are mixed at these speeds and played at the pace that keeps the feet in step: at their own pace at the top of each gait)
local function pace(speed, laden)
  local top, fast = laden and TOP_CARRY or TOP, laden and TROT or RUN
  if speed <= STROLL then return 1 + (STROLL / WALK - 1) * math.max(0, speed) / STROLL end
  local f = math.min(1, (speed - STROLL) / (top - STROLL))
  return speed / (WALK + (fast - WALK) * f)
end
local RADIUS = 0.26

local Postmaster = nova.entity { model = "postmaster", tags = { "postmaster", "player" }, velocity = false }

local PARCELS = { hazel = "parcel_hazel", pip = "parcel_pip" }

function Postmaster:create()
  self.face = self.ry or 0
  self.speed = 0
  self.control = true          -- the stick moves it (false while it talks, reads, or gets into the van)
  self.seated = false          -- at the wheel of the van (the scene sets it getting in and out)
  self.steps = 0
  self.carry_w = 0
  self.anim = nova.animator("postmaster", {
    start = "move", fade = 0.18,
    states = {
      move = { blend = "speed", points = { { 0, "idle" }, { STROLL, "walk" }, { TOP, "run" } } },
      -- (with a parcel: the walk, then the trot; the carry is laid over the arms of both)
      laden = { blend = "speed", points = { { 0, "idle" }, { STROLL, "walk" }, { TOP_CARRY, "trot" } } },
      wave = { clip = "wave", loop = false, next = "move", fade = 0.15 },
      sit = { clip = "sit", fade = 0.1 },
    },
    on_event = function(event) if event == "step" then self:step() end end,
  })
  self.carry_layer = { { clip = "carry", time = 0, weight = 0, mask = { "arm_l", "arm_r" } } }
  self.parcel_opts = { ry = 0 }
  self.mood = face.new(5)
  self.gait = "still"           -- still, walk, run or trot (what the stick asks for; the tests read it)
  self.dust = {}                 -- little puffs kicked up by the run's steps
  self.draw_opts = { ry = 0 }
end

-- A smile for a moment (a parcel handed over, a letter read).
function Postmaster:smile(seconds) face.set(self.mood, "happy", seconds or 2.5); nova.log("face postmaster happy") end

function Postmaster:step()
  self.steps = self.steps + 1
  if self.seated then return end
  local s = self.indoors and "wood" or world.surface(self.x, self.z)
  local name = (s == "road" and "step_road") or ((s == "gravel") and "step_gravel") or ((s == "bridge" or s == "wood") and "step_wood") or "step_grass"
  if self.gait == "run" or self.gait == "trot" then
    -- (light quick steps, a touch higher and softer; a tiny puff of dust off the ground outdoors)
    nova.sound.play(name, { volume = 0.26, pitch = 1.12, vary = 0.08 })
    if self.gait == "run" and not self.indoors and #self.dust < 8 then
      local s, c = math.sin(self.face), math.cos(self.face)
      self.dust[#self.dust + 1] = { x = self.x - s * 0.2, z = self.z - c * 0.2, age = 0 }
    end
  else
    nova.sound.play(name, { volume = 0.32 + 0.12 * math.min(1, self.speed / STROLL), vary = 0.07 })
  end
end

-- (a walk a test or a picture set going is dropped: getting into the van)
function Postmaster:stop_walking() self.walk_to, self.walk_path = nil, nil end

-- Turn to face a point (for a resident, a shelf, the van's door).
function Postmaster:face_to(x, z, dt)
  local want = math.atan(x - self.x, z - self.z)
  local turn = (want - self.face + math.pi) % (2 * math.pi) - math.pi
  self.face = self.face + turn * math.min(1, (dt or 1) * 10)
end

function Postmaster:update(dt)
  if self.seated then return self:sit(dt) end
  local mx, my = 0, 0
  if self.control then mx, my = nova.input.axis("move_x"), nova.input.axis("move_y") end
  local fx, fz = camera.forward()
  local rx, rz = -fz, fx -- (the camera's right: +x is the left of one facing +z)
  local dx, dz = rx * mx - fx * my, rz * mx - fz * my
  local len = math.sqrt(dx * dx + dz * dz)
  if len > 1 then dx, dz, len = dx / len, dz / len, 1 end
  local top = state.carrying and TOP_CARRY or TOP
  -- (the walk up to TILT, then the run: the speed climbs from the walk's top to the run's over the rest of the push)
  local want = 0
  if len > 0.15 then want = len <= TILT and STROLL * len / TILT or STROLL + (top - STROLL) * math.min(1, (len - TILT) / (0.95 - TILT)) end
  -- (a few points to walk through in turn: a test leading it round the van)
  if not self.walk_to and self.walk_path and #self.walk_path > 0 then self.walk_to = table.remove(self.walk_path, 1) end
  if self.walk_to then
    -- (the scene leads it a few steps: to the van's door, out of the office's doorway)
    local tx, tz = self.walk_to[1] - self.x, self.walk_to[2] - self.z
    local d = math.sqrt(tx * tx + tz * tz)
    -- (a point it cannot reach, against a post or the van's side, is given up when it has had the time the walk should take)
    local pace = math.min(top, self.walk_pace or STROLL)
    if self.walk_for ~= self.walk_to then self.walk_for, self.walk_budget = self.walk_to, d / pace + 1.5 end
    self.walk_budget = self.walk_budget - dt
    if d < 0.12 or self.walk_budget <= 0 then self.walk_to = nil; want = 0 else dx, dz, want = tx / d, tz / d, math.min(pace, d * 4) end
    len = 1
  end
  self.speed = self.speed + (want - self.speed) * math.min(1, dt * 9)
  if want > 0 and len > 0.15 then
    local turn = (math.atan(dx, dz) - self.face + math.pi) % (2 * math.pi) - math.pi
    self.face = self.face + turn * math.min(1, dt * 11)
    self.dir_x, self.dir_z = dx / math.max(len, 1e-6), dz / math.max(len, 1e-6)
  end
  if self.speed > 0.01 and self.dir_x then
    local nx, nz = world.move(self.x, self.z, self.dir_x * self.speed * dt, self.dir_z * self.speed * dt, RADIUS)
    self.x, self.z = nx, nz
  end
  self:keep_clear()
  self.y = self.indoors and 0 or world.lift(self.x, self.z)
  self.carry_w = self.carry_w + ((state.carrying and 1 or 0) - self.carry_w) * math.min(1, dt * 8)
  local laden = state.carrying ~= nil
  self.gait = self.speed < 0.08 and "still" or self.speed <= STROLL + 0.05 and "walk" or laden and "trot" or "run"
  self.anim:play(laden and "laden" or "move", { fade = 0.25 })
  self.anim:set("speed", self.speed)
  self.anim.speed = self.anim:state() == "wave" and 1 or pace(self.speed, laden)
  self.anim:update(dt)
  for i = #self.dust, 1, -1 do
    local p = self.dust[i]
    p.age = p.age + dt
    if p.age > 0.5 then table.remove(self.dust, i) end
  end
  face.update(self.mood, dt)
end

-- Out of the van's body (three circles along it) and out of the residents' way: nobody walks through a van or a bear.
function Postmaster:keep_clear()
  local function push(cx, cz, r)
    local dx, dz = self.x - cx, self.z - cz
    local d = math.sqrt(dx * dx + dz * dz)
    local reach = r + RADIUS
    if d < reach and d > 1e-4 then self.x, self.z = cx + dx / d * reach, cz + dz / d * reach end
  end
  local v = nova.first("van")
  if v then
    local s, c = math.sin(v.heading), math.cos(v.heading)
    local body = v.BODY or { offs = { 0 }, r = 1 }
    for _, off in ipairs(body.offs) do push(v.x + s * off, v.z + c * off, body.r) end
  end
  for _, r in ipairs(nova.all("resident")) do push(r.x, r.z, 0.62) end
end

-- Where the parcel it carries is: at the chest, in front of it.
function Postmaster:hands()
  local s, c = math.sin(self.face), math.cos(self.face)
  local bob = math.abs(math.sin(self.steps * 0.5 + nova.time() * 0)) * 0
  return self.x + s * 0.33, self.y + 0.42 + bob, self.z + c * 0.33
end

local DUST = { color = { 196, 178, 150, 110 } }
-- At the wheel: the place in the cab (the van's own metres, tools/van.mjs SEAT less the seated body's depth under its feet's
-- level), kept with the van as it moves; the clip is the seated one.
Postmaster.SEAT = { 0.3, 0.495, 0.26 }
function Postmaster:sit(dt)
  local v = nova.first("van")
  if v then
    local x, _, z = v:to_world(self.SEAT[1], 0, self.SEAT[3])
    self.x, self.y, self.z = x, 0, z
    self.face = v.heading
  end
  self.speed, self.gait = 0, "still"
  self.anim:play("sit", { fade = 0.1 })
  self.anim.speed = 1
  self.anim:update(dt)
  self.carry_w = 0
  face.update(self.mood, dt)
end

local SEATED = { ry = 0, rx = 0, rz = 0, lift = "origin" }
function Postmaster:draw_seated(v)
  -- in the cab, carried by the body: the van's turn, then the body's pitch and roll, at the seat's place in the leaning body
  local sx, sy, sz = v:to_world(self.SEAT[1], self.SEAT[2], self.SEAT[3])
  -- (drawn lifted by the ground under its own place, like the van by the ground under its middle: take the difference off)
  sy = sy + nova.terrain_height(v.x, v.z) - nova.terrain_height(sx, sz)
  local parts = face.parts(self.mood)
  -- the hands go round with the wheel (one up, one down), the head looks a little into the bend, the tail tucked away behind
  local turn = -(v.steer or 0)
  parts.arm_l = parts.arm_l or {}
  parts.arm_r = parts.arm_r or {}
  parts.head = parts.head or {}
  parts.tail = parts.tail or {}
  parts.arm_l.rx, parts.arm_r.rx = turn * 0.32, -turn * 0.32
  parts.head.ry = turn * 0.32
  parts.tail.visible = false
  SEATED.ry, SEATED.rx, SEATED.rz, SEATED.parts = v.heading, v.pitch or 0, v.roll or 0, parts
  self.anim:draw(sx, sy, sz, SEATED)
end

function Postmaster:draw()
  if self.visible == false then return end
  if self.seated then
    local v = nova.first("van")
    if v then self:draw_seated(v) end
    return
  end
  self.carry_layer[1].weight = self.carry_w
  local o = self.draw_opts
  local parts = face.parts(self.mood)
  -- (the turns the seat gave the arms, the head and the tail are let go)
  if parts.arm_l then parts.arm_l.rx, parts.arm_r.rx, parts.head.ry, parts.tail.visible = 0, 0, 0, true end
  o.ry, o.extra, o.parts = self.face, self.carry_w > 0.01 and self.carry_layer or nil, parts
  self.anim:draw(self.x, self.y, self.z, o)
  for _, p in ipairs(self.dust) do
    local k = p.age / 0.5
    DUST.color[4] = math.floor(110 * (1 - k))
    nova.billboard("puff", p.x, self.y + 0.06 + k * 0.12, p.z, 0.16 + k * 0.3, DUST)
  end
  if state.carrying then
    local x, y, z = self:hands()
    self.parcel_opts.ry = self.face + math.pi / 2
    nova.model(PARCELS[state.carrying], x, y - 0.1, z, self.parcel_opts)
  end
end

return Postmaster
