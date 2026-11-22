-- The postmaster: a fox in a blue postal jacket and a peaked cap (models/postmaster.glb, character3d_make). The left stick walks
-- as the camera sees it; carrying a parcel, the arms hold it at the chest (the "carry" clip laid over the arms) and the walk is
-- a little slower. The scene decides what A and B do; this file only walks, animates and is heard.
local world = require("lib.world")
local state = require("lib.state")
local camera = require("lib.camera")

local WALK, RUN = 0.837, 2.857        -- the speeds at which the walk and the run clips do not slide (character3d_make's answer)
local TOP, TOP_CARRY = 2.3, 1.7       -- metres a second at full tilt, empty and carrying
local RADIUS = 0.3

local Postmaster = nova.entity { model = "postmaster", tags = { "postmaster", "player" }, velocity = false }

local PARCELS = { hazel = "parcel_hazel", pip = "parcel_pip" }

function Postmaster:create()
  self.face = self.ry or 0
  self.speed = 0
  self.control = true          -- the stick moves it (false while it talks, reads, or gets into the van)
  self.hidden = false          -- in the van
  self.steps = 0
  self.carry_w = 0
  self.anim = nova.animator("postmaster", {
    start = "move", fade = 0.18,
    states = {
      move = { blend = "speed", points = { { 0, "idle" }, { WALK, "walk" }, { RUN, "run" } } },
      wave = { clip = "wave", loop = false, next = "move", fade = 0.15 },
    },
    on_event = function(event) if event == "step" then self:step() end end,
  })
  self.carry_layer = { { clip = "carry", time = 0, weight = 0, mask = { "arm_l", "arm_r" } } }
  self.parcel_opts = { ry = 0 }
end

function Postmaster:step()
  self.steps = self.steps + 1
  if self.hidden then return end
  local s = self.indoors and "wood" or world.surface(self.x, self.z)
  local name = (s == "road" and "step_road") or ((s == "gravel") and "step_gravel") or ((s == "bridge" or s == "wood") and "step_wood") or "step_grass"
  nova.sound.play(name, { volume = 0.32 + 0.12 * math.min(1, self.speed / TOP), vary = 0.07 })
end

-- Turn to face a point (for a resident, a shelf, the van's door).
function Postmaster:face_to(x, z, dt)
  local want = math.atan(x - self.x, z - self.z)
  local turn = (want - self.face + math.pi) % (2 * math.pi) - math.pi
  self.face = self.face + turn * math.min(1, (dt or 1) * 10)
end

function Postmaster:update(dt)
  local mx, my = 0, 0
  if self.control and not self.hidden then mx, my = nova.input.axis("move_x"), nova.input.axis("move_y") end
  local fx, fz = camera.forward()
  local rx, rz = -fz, fx -- (the camera's right: +x is the left of one facing +z)
  local dx, dz = rx * mx - fx * my, rz * mx - fz * my
  local len = math.sqrt(dx * dx + dz * dz)
  if len > 1 then dx, dz, len = dx / len, dz / len, 1 end
  local top = state.carrying and TOP_CARRY or TOP
  local want = len > 0.15 and top * len or 0
  -- (a few points to walk through in turn: a test leading it round the van)
  if not self.walk_to and self.walk_path and #self.walk_path > 0 then self.walk_to = table.remove(self.walk_path, 1) end
  if self.walk_to then
    -- (the scene leads it a few steps: to the van's door, out of the office's doorway)
    local tx, tz = self.walk_to[1] - self.x, self.walk_to[2] - self.z
    local d = math.sqrt(tx * tx + tz * tz)
    -- (a point it cannot reach, against a post or the van's side, is given up when it has had the time the walk should take)
    if self.walk_for ~= self.walk_to then self.walk_for, self.walk_budget = self.walk_to, d / 1.2 + 1.5 end
    self.walk_budget = self.walk_budget - dt
    if d < 0.12 or self.walk_budget <= 0 then self.walk_to = nil; want = 0 else dx, dz, want = tx / d, tz / d, math.min(top * 0.95, d * 4) end
    len = 1
  end
  self.speed = self.speed + (want - self.speed) * math.min(1, dt * 9)
  if want > 0 and len > 0.15 then
    local turn = (math.atan(dx, dz) - self.face + math.pi) % (2 * math.pi) - math.pi
    self.face = self.face + turn * math.min(1, dt * 11)
    self.dir_x, self.dir_z = dx / math.max(len, 1e-6), dz / math.max(len, 1e-6)
  end
  if self.speed > 0.01 and self.dir_x and not self.hidden then
    local nx, nz = world.move(self.x, self.z, self.dir_x * self.speed * dt, self.dir_z * self.speed * dt, RADIUS)
    self.x, self.z = nx, nz
  end
  if not self.hidden then self:keep_clear() end
  self.y = self.indoors and 0 or world.lift(self.x, self.z)
  self.carry_w = self.carry_w + ((state.carrying and 1 or 0) - self.carry_w) * math.min(1, dt * 8)
  self.anim:set("speed", self.speed)
  self.anim:update(dt)
end

-- Out of the van's body (three circles along it) and out of the residents' way: nobody walks through a van or a badger.
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
    for _, off in ipairs({ -1.25, 0, 1.25 }) do push(v.x + s * off, v.z + c * off, 0.86) end
  end
  for _, r in ipairs(nova.all("resident")) do push(r.x, r.z, 0.75) end
end

-- Where the parcel it carries is: at the chest, in front of it.
function Postmaster:hands()
  local s, c = math.sin(self.face), math.cos(self.face)
  local bob = math.abs(math.sin(self.steps * 0.5 + nova.time() * 0)) * 0
  return self.x + s * 0.34, self.y + 0.72 + bob, self.z + c * 0.34
end

function Postmaster:draw()
  if self.hidden or self.visible == false then return end
  self.carry_layer[1].weight = self.carry_w
  self.anim:draw(self.x, self.y, self.z, { ry = self.face, extra = self.carry_w > 0.01 and self.carry_layer or nil })
  if state.carrying then
    local x, y, z = self:hands()
    self.parcel_opts.ry = self.face + math.pi / 2
    nova.model(PARCELS[state.carrying], x, y - 0.1, z, self.parcel_opts)
  end
end

return Postmaster
