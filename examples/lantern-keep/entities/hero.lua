local state = require("lib.state")

local Hero = nova.entity {
  sprite = "hero",
  anim = "idle",
  tags = { "hero" },
  hitbox = { -9, -2, 18, 16 }, -- offsets from the position: x, y, width, height (the body, so walls stop his feet)
  speed = 190,
  depth = 10,
}

function Hero:create()
  self.facing = 1
  self.attack_time = 0     -- how much of the swing is left
  self.invulnerable = 0    -- after a hit, for a moment
  self.kx, self.ky = 0, 0  -- knockback
  self.autopilot = state.autopilot -- (kept from room to room)
  self.unstick = 0
  self.last_x, self.last_y, self.still = self.x, self.y, 0
end

-- What the autopilot (F9) would do: deal with anything close first (walk up to it and swing), then go for the key,
-- then the door.
local function think(self, dt)
  local key = nova.first("key")
  local tx, ty = 29.5 * 32, 8.5 * 32
  if key then tx, ty = key.x, key.y end
  local enemy = nova.nearest(self.x, self.y, "enemy", 150)
  local swing = false
  if enemy then
    tx, ty = enemy.x, enemy.y
    local near = self:distance_to(enemy.x, enemy.y)
    self.facing = enemy.x >= self.x and 1 or -1
    swing = near < 54 and math.abs(enemy.y - self.y) < 32
    if swing then tx, ty = self.x, self.y end -- in reach: stand and fight
  end
  local dx, dy = tx - self.x, ty - self.y
  local len = math.sqrt(dx * dx + dy * dy)
  if len > 1 then dx, dy = dx / len, dy / len else dx, dy = 0, 0 end
  -- going nowhere (behind a pillar)? sidestep for a moment
  local moving = len < 2 or math.abs(self.x - self.last_x) + math.abs(self.y - self.last_y) > 0.4
  self.still = moving and 0 or self.still + dt
  self.last_x, self.last_y = self.x, self.y
  if self.still > 0.25 then self.unstick = 0.7; self.side = (self.side or 1) * -1; self.still = 0 end
  if self.unstick > 0 then
    self.unstick = self.unstick - dt
    dx, dy = -dy * (self.side or 1) + dx * 0.2, dx * (self.side or 1) + dy * 0.2
  end
  return dx, dy, swing
end

function Hero:update(dt)
  if nova.input.pressed("autoplay") then self.autopilot = not self.autopilot; state.autopilot = self.autopilot end
  local dx, dy, swing = nova.input.axis("move_x"), nova.input.axis("move_y"), nova.input.pressed("attack")
  if self.autopilot then dx, dy, swing = think(self, dt) end
  local len = math.sqrt(dx * dx + dy * dy)
  if len > 1 then dx, dy = dx / len, dy / len end

  self.invulnerable = math.max(0, self.invulnerable - dt)
  self.alpha = (self.invulnerable > 0 and math.floor(nova.time() * 16) % 2 == 0) and 0.35 or 1

  if swing and self.attack_time <= 0 then self:swing() end
  local slow = self.attack_time > 0 and 0.45 or 1
  self.attack_time = math.max(0, self.attack_time - dt)

  -- walking, and being knocked about; walls stop him (slide)
  self:slide((dx * self.speed * slow + self.kx) * dt, (dy * self.speed * slow + self.ky) * dt)
  self.kx, self.ky = self.kx * 0.85, self.ky * 0.85
  if dx < -0.1 then self.facing = -1 elseif dx > 0.1 then self.facing = 1 end
  self.sx = self.facing

  if self.attack_time > 0 then self:play("slash")
  elseif len > 0.1 then self:play("walk")
  else self:play("idle") end
end

-- The sword: anything in front of him, close enough, is hit.
function Hero:swing()
  self.attack_time = 0.3
  self:play("slash", { restart = true })
  nova.sound.play("slash", { pitch = 0.9 + math.random() * 0.2 })
  local fx = self.x + self.facing * 22
  nova.each("enemy", function(e)
    if math.abs(e.x - fx) < 32 and math.abs(e.y - self.y) < 34 then e:hurt(1, self.facing) end
  end)
end

-- An enemy touched him.
function Hero:hurt(from_x)
  if self.invulnerable > 0 then return end
  state.hearts = state.hearts - 1
  self.invulnerable = 1.2
  local away = self.x >= from_x and 1 or -1
  self.kx, self.ky = away * 330, (math.random() - 0.5) * 200
  nova.sound.play("hurt")
  nova.burst(self.x, self.y, { count = 10, speed = { 40, 140 }, life = { 0.25, 0.5 }, size = 4, size_end = 0, color = { 255, 80, 90, 255 }, color_end = { 255, 40, 60, 0 } })
  if state.hearts <= 0 then nova.goto_scene("over") end
end

return Hero
