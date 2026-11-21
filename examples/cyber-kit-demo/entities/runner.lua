-- The runner: a long coat, a lit visor, a baton, in the makers' detailed style (64x64 frames drawn at 1.5). The sheet is character_make's (every call is in tools/make.json), so every animation is
-- tagged by name and direction ("walk_left", "attack_up") and this file only says which to play.
-- a faint cool light that goes with the runner (the visor's), so that it reads on the darkest street
local VISOR = { radius = 70, radius_y = 48, color = { 150, 230, 255 }, intensity = 0.7, y = -6 }

local Runner = nova.entity {
  sprite = "runner", anim = "idle_down",
  tags = { "hero" },
  pivot = { 0.5, 0.953 },
  hitbox = { -7, -8, 14, 8 },
  sx = 1.5, sy = 1.5,
  speed = 190,
  shadow = true, -- a soft shadow under the feet

  light = VISOR,
}

local WAY = { down = { 0, 1 }, up = { 0, -1 }, left = { -1, 0 }, right = { 1, 0 } }

-- the baton's arc: a bright cyan light and a glow that adds light, where the swing is
local BATON = { radius = 130, radius_y = 90, color = { 53, 230, 255 }, intensity = 2.4 }
local ARC = { 53, 230, 255, 200 }
local ARC_OPTS = { blend = "add", soft = true }

function Runner:create()
  self.facing = "down"
  self.swinging = false
  self.arc = 0
end

function Runner:swing()
  self.swinging = true
  self.arc = 0.22
  self:play("attack_" .. self.facing, { restart = true })
  local w = WAY[self.facing]
  local cx, cy = self.x + w[1] * 42, self.y - 30 + w[2] * 42
  for _, e in ipairs(nova.all("enemy")) do
    if math.abs(e.x - cx) < 48 and math.abs(e.y - 18 - cy) < 48 then e:take_hit(w[1], w[2]) end
  end
end

function Runner:on_animation_end(tag)
  if tag:sub(1, 6) == "attack" then self.swinging = false end
end

function Runner:update(dt)
  self.depth = -self.y
  self.arc = math.max(0, self.arc - dt)
  if self.arc > 0 then
    local w = WAY[self.facing]
    BATON.x, BATON.y = w[1] * 40, -24 + w[2] * 34
    self.light = BATON
  else
    self.light = VISOR
  end
  if self.swinging then return end
  if nova.input.pressed("attack") then return self:swing() end
  local dx, dy = nova.input.axis("move_x"), nova.input.axis("move_y")
  if nova.input.down("left") then dx = -1 elseif nova.input.down("right") then dx = 1 end
  if nova.input.down("up") then dy = -1 elseif nova.input.down("down") then dy = 1 end
  local length = math.sqrt(dx * dx + dy * dy)
  if length > 1 then dx, dy = dx / length, dy / length end
  self:slide(dx * self.speed * dt, dy * self.speed * dt)
  local moving = length > 0.2
  if moving then
    if math.abs(dx) > math.abs(dy) then self.facing = dx < 0 and "left" or "right" else self.facing = dy < 0 and "up" or "down" end
  end
  self:play((moving and "walk_" or "idle_") .. self.facing)
end

function Runner:draw()
  nova.Entity.draw(self)
  if self.arc > 0 then
    -- the neon arc adds light over whatever it crosses, fading as the swing ends
    local w = WAY[self.facing]
    local x, y = nova.cam.to_screen(self.x + w[1] * 40, self.y - 24 + w[2] * 34)
    ARC[4] = math.floor(220 * self.arc / 0.22)
    nova.circle(x, y, 34, ARC, ARC_OPTS)
  end
end

return Runner
