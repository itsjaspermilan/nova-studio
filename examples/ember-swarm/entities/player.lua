local state = require("lib.state")

local Player = nova.entity { model = "hero", tags = { "player" }, hitbox = { r = 0.7 } }

function Player:create()
  self.heading = 0
  self.cool = 0
  self.hurt_cool = 0
  self.autopilot = false
  self.turret = { ry = 0 }
  self.draw_parts = { turret = self.turret }
end

-- Third person and first person are the engine's two cameras (nova.cam3); the mouse is locked in first person so that it can
-- turn the view without end.
local function set_view(view)
  state.view = view
  nova.input.grab_mouse(view == "first")
end

function Player:update(dt)
  if nova.input.pressed("autoplay") then self.autopilot = not self.autopilot end
  if nova.input.pressed("view") then set_view(state.view == "third" and "first" or "third") end
  -- looking: the right stick, and the mouse (pushes while it is locked)
  local pointer = nova.input.pointer()
  nova.cam3.look(-nova.input.axis("look_x") * 2.4 * dt, -nova.input.axis("look_y") * 1.4 * dt)
  if state.view == "first" then nova.cam3.look(-pointer.dx * 0.0025, -pointer.dy * 0.0025) end

  local vx, vz
  if self.autopilot then
    -- runs in a wide circle round the arena, whatever is chasing it
    local a = nova.time() * 0.35
    vx, vz = math.cos(a) * 16 - self.x, math.sin(a) * 16 - self.z
    local l = math.sqrt(vx * vx + vz * vz)
    vx, vz = vx / l, vz / l
  else
    -- the stick is relative to the camera: forward is where it looks
    local mx, mz = nova.input.axis("move_x"), nova.input.axis("move_y")
    local fx, fz = nova.cam3.forward()
    local rx, rz = nova.cam3.right()
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

  self.cool = self.cool - dt
  self.hurt_cool = self.hurt_cool - dt
  if state.view == "first" then
    self:hitscan()
  else
    self:shoot_bullets(pointer)
  end
  self.ry = self.heading
  if state.view == "first" then
    nova.cam3.first_person(self, { height = 1.5 })
  else
    nova.cam3.follow(self, { distance = 9, height = 8.5, smooth = 6, dt = dt })
  end
end

-- Third person: shoots at the nearest enemy by itself, or at the ground under the mouse (or a finger) while it is held.
function Player:shoot_bullets(pointer)
  local target = nova.nearest(self.x, self.z, "enemy", 22)
  local aim = self.heading
  if target then aim = math.atan(target.x - self.x, target.z - self.z) end
  local manual
  if pointer.present and pointer.down then
    local gx, gz = nova.cam3.ground_point(pointer.x, pointer.y, 1)
    if gx then aim, manual = math.atan(gx - self.x, gz - self.z), true end
  end
  self.turret.ry = aim - self.heading
  if self.cool <= 0 and (target or manual) then
    self.cool = 1 / state.fire_rate
    local n = state.shots
    for i = 1, n do
      local spread = (i - (n + 1) / 2) * 0.12
      nova.spawn("bullet", self.x + math.sin(aim) * 0.9, 1.1, { z = self.z + math.cos(aim) * 0.9, dir = aim + spread })
    end
    nova.sound.play("shoot", { volume = 0.5, pitch = 0.9 + math.random() * 0.2, limit = 4 })
  end
end

-- First person: a hit scan along the view. The ray leaves at eye height and rises or falls with the pitch, so a shot over a
-- short enemy misses it. As in most shooters there is a little vertical aim assist: an enemy near the middle of the view is
-- aimed at at the height of its middle, so that the crosshair does not have to be lowered onto every short one.
function Player:hitscan()
  self.turret.ry = 0
  if self.cool > 0 then return end
  local fx, fz = nova.cam3.forward()
  local slope = math.tan(nova.cam3.pitch)
  local best, best_d = nil, 40
  nova.each("enemy", function(e)
    local dx, dz = e.x - self.x, e.z - self.z
    local d = math.sqrt(dx * dx + dz * dz)
    if d > 0.5 and d < best_d and (dx * fx + dz * fz) / d > 0.995 then best, best_d = e, d end
  end)
  if best then slope = (0.5 - 1.45) / best_d end
  local hit, distance, hx, hz = nova.raycast(self.x, self.z, fx, fz, 40, "enemy", { height = 1.45, slope = slope })
  if not hit then return end
  self.cool = 1 / state.fire_rate
  hit:hurt(state.damage)
  nova.burst(hx, 1.2, hz, { model = "bullet", count = 3, life = { 0.15, 0.3 }, speed = { 1, 3 }, size = { 0.4, 0.8 }, size_end = 0, spread = 3, color = { 255, 220, 140, 255 }, color_end = { 255, 120, 40, 0 } })
  nova.sound.play("shoot", { volume = 0.5, pitch = 1.2, limit = 4 })
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
