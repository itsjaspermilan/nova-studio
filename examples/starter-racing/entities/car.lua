-- The car: models/car.glb (car_make), driven round the track the scene lays out. Up (W, R2, A) is the throttle, down (S, L2, B)
-- the brake, left and right (the stick) steer. Off the road it slows. A six-speed box changes gear by itself, and the engine is
-- heard through the runtime's library: require("nova.engine_sound") plays engines/car.lua's loops (engine_make) by the revs.
local engine_sound = require("nova.engine_sound")

local WHEEL_R = 0.32                         -- the wheel radius (car_make's answer), for the wheels' spin
local TOP = 52                               -- metres a second flat out on the road (187 km/h)
local GEARS = { 11, 19, 27, 35, 44, 54 }     -- the speed at the top of each gear
local ENGINE = require("engines.car")        -- idle, max, the bands... (engine_make)

local Car = nova.entity { model = "car", tags = { "car" }, velocity = false }

function Car:create()
  self.ry = self.ry or math.pi / 2           -- (the scene sets it: the nose along the start straight)
  self.speed, self.steer, self.spin, self.gear = 0, 0, 0, 1
  self.engine = engine_sound.new(ENGINE)
  self.parts = { wheel_fl = { rx = 0, ry = 0 }, wheel_fr = { rx = 0, ry = 0 }, wheel_rl = { rx = 0 }, wheel_rr = { rx = 0 } }
end

--- How hard the driver (or the autopilot, which follows the track: the play test turns it on) asks for each thing.
function Car:controls(dt)
  if self.autopilot then
    local race = nova.scene_now()
    local tx, tz = race:ahead(self.x, self.z, 10 + self.speed * 0.45)
    local want = math.atan(tx - self.x, tz - self.z)
    local turn = (want - self.ry + math.pi) % (2 * math.pi) - math.pi
    return self.speed > 30 and math.abs(turn) > 0.35 and 0 or 1, 0, math.max(-1, math.min(1, turn * 2.2))
  end
  local up = nova.input.axis("throttle")
  local down = nova.input.axis("brake")
  return up, down, nova.input.axis("move_x")
end

function Car:update(dt)
  local throttle, brake, steer = self:controls(dt)
  local race = nova.scene_now()
  local on_road = race:on_road(self.x, self.z)
  -- driving: the throttle pulls less the faster the car goes; the brake and the air slow it; grass slows it more
  local top = on_road and TOP or 20
  local pull = throttle * 11 * math.max(0, 1 - self.speed / top)
  local slow = brake * 16 + 0.002 * self.speed * self.speed + (on_road and 0.3 or 3.5)
  self.speed = math.max(0, self.speed + (pull - slow) * dt)
  -- steering: the wheels turn as far as the speed allows, and the car turns with them
  self.steer = self.steer + (steer - self.steer) * math.min(1, dt * 8)
  local grip = 1 / (1 + self.speed / 30)
  self.ry = self.ry + self.steer * math.min(1, self.speed / 6) * 1.8 * grip * dt
  self.x = self.x + math.sin(self.ry) * self.speed * dt
  self.z = self.z + math.cos(self.ry) * self.speed * dt
  self.spin = self.spin + self.speed * dt / WHEEL_R
  -- the gearbox: up near the top of a gear, down when the speed falls into the one below; the revs from the speed in the gear
  local hi = GEARS[self.gear]
  local lo = self.gear > 1 and GEARS[self.gear - 1] or 0
  if self.speed > hi * 0.97 and self.gear < #GEARS then self.gear = self.gear + 1; self.engine:shift("up")
  elseif self.gear > 1 and self.speed < lo * 0.7 then self.gear = self.gear - 1; self.engine:shift("down") end
  local in_gear = math.max(0, math.min(1.02, (self.speed - (self.gear > 1 and GEARS[self.gear - 1] * 0.55 or 0)) / (GEARS[self.gear] - (self.gear > 1 and GEARS[self.gear - 1] * 0.55 or 0))))
  self.rpm = ENGINE.idle + in_gear * (ENGINE.max - ENGINE.idle)
  self.engine:update(dt, { rpm = self.rpm, throttle = throttle, speed = self.speed, slip = math.abs(self.steer) * math.max(0, self.speed - 25) / 25, surface = on_road and "road" or "rough" })
  -- the wheels
  local p = self.parts
  p.wheel_fl.rx, p.wheel_fr.rx, p.wheel_rl.rx, p.wheel_rr.rx = self.spin, self.spin, self.spin, self.spin
  p.wheel_fl.ry, p.wheel_fr.ry = self.steer * 0.45, self.steer * 0.45
end

function Car:draw()
  nova.model("car", self.x, 0, self.z, { ry = self.ry, parts = self.parts })
end

return Car
