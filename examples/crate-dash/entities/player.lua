local state = require("lib.state")

local Player = nova.entity {
  sprite = "player",
  tags = { "player" },
  speed = 220,
  jump = 520,
  gravity = 1500,
  floor = 440,
  hitbox = { -10, -14, 20, 30 }, -- offsets from the position: x, y, width, height
  hurt_until = 0,
}

function Player:update(dt)
  local w = nova.view()
  self.x = math.max(16, math.min(w - 16, self.x + nova.input.axis("steer") * self.speed * dt))

  local on_ground = self.y >= self.floor
  if on_ground and (nova.input.down("throttle") or nova.input.down("action")) then
    self.vy = -self.jump
  end
  if self.y < self.floor or self.vy < 0 then
    self.vy = self.vy + self.gravity * dt
  end
  if self.y >= self.floor and self.vy > 0 then
    self.y, self.vy = self.floor, 0
  end
  self.alpha = (nova.time() < self.hurt_until) and 0.5 or 1
end

function Player:on_collide_star(star)
  state.score = state.score + 1
  star:destroy()
end

function Player:on_collide_crate(crate)
  if nova.time() < self.hurt_until then return end
  crate:destroy()
  state.lives = state.lives - 1
  self.hurt_until = nova.time() + 1.2
  if state.lives <= 0 then
    nova.goto_scene("over")
  end
end

return Player
