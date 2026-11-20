-- The hero: walks four ways, swings his sword, can be hurt. His sheet was made with character_make, which tags every
-- animation by name and direction ("walk_left", "attack_up"), so this file only says which to play.
-- pivot and hitbox are the ones character_make gave: the feet, and a low box at them.
local game = require("lib.game")

local Hero = nova.entity {
  sprite = "hero", anim = "idle_down",
  tags = { "hero" },
  pivot = { 0.5, 0.875 },
  hitbox = { -4, -5, 8, 5 },
  sx = 3, sy = 3,
  speed = 165,
  step_sound = "step_grass", -- the scene changes it indoors
}

local WAY = { down = { 0, 1 }, up = { 0, -1 }, left = { -1, 0 }, right = { 1, 0 } }

function Hero:create()
  self.facing = "down"
  self.swinging = false
  self.safe = 0       -- seconds left in which he cannot be hurt again
  self.step_timer = 0
end

function Hero:swing()
  self.swinging = true
  self:play("attack_" .. self.facing, { restart = true })
  nova.sound.play("sword_swing", { volume = 0.6, pitch = 0.95 + math.random() * 0.1 })
  -- everything tagged "enemy" within a sword's reach in front of him is hit
  local w = WAY[self.facing]
  local cx, cy = self.x + w[1] * 42, self.y - 18 + w[2] * 42
  for _, e in ipairs(nova.all("enemy")) do
    if math.abs(e.x - cx) < 46 and math.abs(e.y - 12 - cy) < 46 then e:take_hit(w[1], w[2]) end
  end
end

-- The attack tags play once; this runs when one has finished.
function Hero:on_animation_end(tag)
  if tag:sub(1, 6) == "attack" then self.swinging = false end
end

function Hero:take_hit()
  if self.safe > 0 then return end
  game.hearts = game.hearts - 1
  self.safe = 1.2
  nova.sound.play("hurt", { volume = 0.7 })
  nova.log("hero hurt, hearts " .. game.hearts)
  if game.hearts <= 0 then
    game.hearts = 6
    nova.goto_scene("meadow")
  end
end

function Hero:update(dt)
  self.depth = -self.y
  self.safe = math.max(0, self.safe - dt)
  self.alpha = (self.safe > 0 and math.floor(self.safe * 12) % 2 == 0) and 0.4 or 1 -- blink while safe
  if self.swinging then return end
  if nova.input.pressed("attack") then return self:swing() end

  local dx, dy = nova.input.axis("move_x"), nova.input.axis("move_y")
  if nova.input.down("left") then dx = -1 elseif nova.input.down("right") then dx = 1 end
  if nova.input.down("up") then dy = -1 elseif nova.input.down("down") then dy = 1 end
  local length = math.sqrt(dx * dx + dy * dy)
  if length > 1 then dx, dy = dx / length, dy / length end

  -- one axis at a time; solid tiles stop `slide`, solid things (the chest) are stepped back from
  local x, y = self.x, self.y
  self:slide(dx * self.speed * dt, 0)
  if self:touching("solid") then self.x = x end
  self:slide(0, dy * self.speed * dt)
  if self:touching("solid") then self.y = y end

  local moving = length > 0.2
  if moving then
    if math.abs(dx) > math.abs(dy) then self.facing = dx < 0 and "left" or "right" else self.facing = dy < 0 and "up" or "down" end
    self.step_timer = self.step_timer - dt
    if self.step_timer <= 0 then
      self.step_timer = 0.26
      nova.sound.play(self.step_sound, { volume = 0.45, pitch = 0.9 + math.random() * 0.2 })
    end
  else
    self.step_timer = 0
  end
  self:play((moving and "walk_" or "idle_") .. self.facing)
end

return Hero
