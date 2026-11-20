-- The player of a platformer: runs, jumps, falls, lands on solid tiles and on planks.
--
-- Sizes: the sheet (made with character_make) has a 16x24 body in 32x32 frames, drawn 3 times bigger. `pivot` is the
-- feet (the frame has room below them), so x, y is where he stands. The hitbox is his body from the feet up, in the
-- sprite's pixels. `velocity = false`: this file moves him itself, so the engine must not add vx, vy as well.
local Hero = nova.entity {
  sprite = "hero", anim = "idle_right",
  tags = { "hero" },
  pivot = { 0.5, 0.875 },
  hitbox = { -4, -16, 8, 16 },
  sx = 3, sy = 3,
  velocity = false,
  run = 250,          -- units a second (the screen is 960 wide)
  jump_speed = 640,   -- how fast he leaves the ground
  gravity = 1900,
  coyote = 0.1,       -- seconds after walking off an edge in which a jump still works
  buffer = 0.1,       -- seconds before landing in which a press of jump is remembered
}

function Hero:create()
  self.fall = 0            -- speed downwards (negative is up)
  self.facing = "right"
  self.on_ground = false
  self.since_ground = 1    -- seconds since he last stood on something
  self.since_press = 1     -- seconds since jump was last pressed
  self.start_x, self.start_y = self.x, self.y
  self.depth = -10
end

-- Back to where the scene put him (after a hazard or a fall).
function Hero:hurt()
  nova.sound.play("hurt", { volume = 0.7 })
  nova.log("hurt at " .. math.floor(self.x) .. ", " .. math.floor(self.y))
  self.x, self.y, self.fall = self.start_x, self.start_y, 0
end

function Hero:update(dt)
  local move = nova.input.axis("move_x")
  if nova.input.down("left") then move = -1 elseif nova.input.down("right") then move = 1 end
  if math.abs(move) < 0.25 then move = 0 end
  if move ~= 0 then self.facing = move < 0 and "left" or "right" end

  -- Coyote time and a remembered press: a jump happens when both "pressed lately" and "stood lately" hold.
  self.since_ground = self.on_ground and 0 or self.since_ground + dt
  self.since_press = nova.input.pressed("jump") and 0 or self.since_press + dt
  if self.since_press <= self.buffer and self.since_ground <= self.coyote then
    self.fall = -self.jump_speed
    self.since_ground, self.since_press = 1, 1
    nova.sound.play("jump", { volume = 0.6 })
  end
  -- Letting go of jump early makes a short hop.
  if self.fall < -220 and not nova.input.down("jump") then self.fall = -220 end
  self.fall = math.min(self.fall + self.gravity * dt, 1000)

  -- Move one axis at a time; `slide` stops at solid tiles and says whether it was stopped.
  local feet_before = self.y
  self:slide(move * self.run * dt, 0)
  local _, stopped = self:slide(0, self.fall * dt)
  local landed = stopped and self.fall > 0

  -- Planks are one-way: they hold him only when he comes down onto them from above. Hold down to drop through.
  if self.fall >= 0 and not nova.input.down("down") then
    for _, plank in ipairs(nova.all("plank")) do
      local top = plank.y
      if feet_before <= top + 1 and self.y >= top and math.abs(self.x - plank.x) < plank.half + 10 then
        self.y, landed = top, true
      end
    end
  end

  if stopped or landed then self.fall = 0 end
  if landed and not self.on_ground then nova.sound.play("land", { volume = 0.5 }) end
  self.on_ground = landed

  if self.y > nova.scene_now().floor + 200 then self:hurt() end -- fell out of the level

  if not self.on_ground then
    self:play("walk_" .. self.facing)   -- in the air: legs apart
  else
    self:play((move ~= 0 and "walk_" or "idle_") .. self.facing)
  end
end

return Hero
