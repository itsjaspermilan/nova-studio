-- The player: walks with the stick or the arrows, stops at solid tiles and at solid things, faces the way he walks.
--
-- Sizes: the sprite is 16 pixels drawn 3 times bigger (sx, sy), so he is 48 units tall on a screen 540 units high.
-- `pivot = { 0.5, 1 }` puts his feet on x, y. The hitbox is in the sprite's own pixels, measured from the feet: a low box
-- 8 wide and 5 tall, so his head can overlap the wall behind him. It is scaled by sx, sy like the picture.
local Hero = nova.entity {
  sprite = "hero", anim = "idle",
  tags = { "hero" },
  pivot = { 0.5, 1 },
  hitbox = { -4, -5, 8, 5 },
  sx = 3, sy = 3,
  speed = 150,
  step_timer = 0,
}

function Hero:update(dt)
  local dx, dy = nova.input.axis("move_x"), nova.input.axis("move_y")
  if nova.input.down("left") then dx = -1 elseif nova.input.down("right") then dx = 1 end
  if nova.input.down("up") then dy = -1 elseif nova.input.down("down") then dy = 1 end
  local length = math.sqrt(dx * dx + dy * dy)
  if length > 1 then dx, dy = dx / length, dy / length end -- (a diagonal is no faster)

  -- One axis at a time. `slide` stops at solid tiles; solid things (entities tagged "solid": the rocks) are not tiles, so
  -- after each move we look whether we now touch one and, if so, take the move back.
  local x, y = self.x, self.y
  self:slide(dx * self.speed * dt, 0)
  if self:touching("solid") then self.x = x end
  self:slide(0, dy * self.speed * dt)
  if self:touching("solid") then self.y = y end

  -- Things lower on the screen are drawn over things higher up: bigger depth is further back, so depth = -y.
  self.depth = -self.y

  local moving = length > 0.1
  if dx ~= 0 then self.flip_x = dx < 0 end -- (mirrors the picture only; the hitbox stays put)
  self:play(moving and "walk" or "idle")
  if moving then
    self.step_timer = self.step_timer - dt
    if self.step_timer <= 0 then
      self.step_timer = 0.28
      nova.sound.play("step", { volume = 0.5, pitch = 0.9 + math.random() * 0.2 })
    end
  else
    self.step_timer = 0
  end
end

return Hero
