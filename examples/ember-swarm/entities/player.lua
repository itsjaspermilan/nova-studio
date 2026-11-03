local state = require("lib.state")
local camera = require("lib.camera")

local Player = nova.entity { model = "hero", tags = { "player" }, hitbox = { r = 0.7 } }

function Player:create()
  self.heading = 0
  self.cool = 0
  self.hurt_cool = 0
  self.autopilot = false
  self.turret = { ry = 0 }
  self.draw_parts = { turret = self.turret }
end

-- The nearest enemy to a point on the ground (x, z), or nil: the engine's own query.
local function nearest_enemy(x, z, within) return nova.nearest(x, z, "enemy", within) end
Player.nearest_enemy = nearest_enemy

function Player:update(dt)
  if nova.input.pressed("autoplay") then self.autopilot = not self.autopilot end
  if nova.input.pressed("view") then state.view = state.view == "third" and "first" or "third" end
  local vx, vz
  if self.autopilot then
    -- runs in a wide circle round the arena, whatever is chasing it
    local a = nova.time() * 0.35
    vx, vz = math.cos(a) * 16 - self.x, math.sin(a) * 16 - self.z
    local l = math.sqrt(vx * vx + vz * vz)
    vx, vz = vx / l, vz / l
  else
    -- the stick is relative to the camera: forward is away from it
    local mx, mz = nova.input.axis("move_x"), nova.input.axis("move_y")
    local fx, fz = camera.forward()
    local rx, rz = -fz, fx
    vx, vz = rx * mx - fx * mz, rz * mx - fz * mz
  end
  local len = math.sqrt(vx * vx + vz * vz)
  if len > 1 then vx, vz = vx / len, vz / len end
  self.x, self.z = self.x + vx * state.speed * dt, self.z + vz * state.speed * dt
  -- keep inside the arena and out of the pillars
  local r = math.sqrt(self.x * self.x + self.z * self.z)
  if r > 37 then self.x, self.z = self.x * 37 / r, self.z * 37 / r end
  local px, pz = nova.scenery.push(self.x, self.z, 0.7)
  if px then self.x, self.z = self.x + px, self.z + pz end
  if len > 0.1 then self.heading = math.atan(vx, vz) end

  -- aim: the nearest enemy, else the way the player faces (first person: the way the camera looks)
  local target = nearest_enemy(self.x, self.z, 22)
  local aim = self.heading
  if state.view == "first" then aim = camera.yaw + math.pi end
  if target then aim = math.atan(target.x - self.x, target.z - self.z) end
  self.turret.ry = aim - self.heading
  self.ry = self.heading
  self.aim = aim

  self.cool = self.cool - dt
  self.hurt_cool = self.hurt_cool - dt
  if self.cool <= 0 and target then
    self.cool = 1 / state.fire_rate
    local n = state.shots
    for i = 1, n do
      local spread = (i - (n + 1) / 2) * 0.12
      nova.spawn("bullet", self.x + math.sin(aim) * 0.9, 1.1, { z = self.z + math.cos(aim) * 0.9, dir = aim + spread })
    end
    nova.sound.play("shoot", { volume = 0.5, pitch = 0.9 + math.random() * 0.2, limit = 4 })
  end
  camera.update(dt, self)
end

function Player:hurt(damage)
  if state.god or self.hurt_cool > 0 then return end
  self.hurt_cool = 0.35
  state.hp = state.hp - damage
  nova.sound.play("hurt", { volume = 0.5 })
  if state.hp <= 0 then nova.goto_scene("arena") end -- (a probe: dying just starts over)
end

-- The hero is drawn with his turret turned (a part, see nova.model_parts).
function Player:draw()
  if state.view == "first" then return end -- (no body in your own eyes)
  nova.model("hero", self.x, 0, self.z, { ry = self.ry or 0, parts = self.draw_parts })
end

return Player
