-- An entity: one kind of thing in your game. Fields given here are defaults for every player.
local Player = nova.entity {
  sprite = "player",
  tags = { "player" },
  speed = 220,
  jump_speed = 520,
  gravity = 1500,
  floor = 400,
}

function Player:update(dt)
  local move = nova.input.axis("move_x")
  self.x = self.x + move * self.speed * dt
  if move < -0.1 then self.sx = -1 elseif move > 0.1 then self.sx = 1 end
  -- The sprite sheet (sprites/player.sprite.json) has the animation tags idle, run and jump.
  if self.y < self.floor then self:play("jump")
  elseif math.abs(move) > 0.1 then self:play("run")
  else self:play("idle") end
  if self.y >= self.floor and nova.input.pressed("jump") then
    self.vy = -self.jump_speed
  end
  if self.y < self.floor or self.vy < 0 then
    self.vy = self.vy + self.gravity * dt
  end
  if self.y >= self.floor and self.vy > 0 then
    self.y, self.vy = self.floor, 0
  end
end

return Player
