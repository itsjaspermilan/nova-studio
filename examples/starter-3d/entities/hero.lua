-- The hero: models/hero.glb (character3d_make). The stick moves it as the camera sees it: half way walks, all the way
-- runs; A (pad south, Space) jumps. One animator blends idle, walk and run by the speed, so the feet keep step, and
-- tells us each time a foot lands.
local WALK, RUN = 1.163, 3.968      -- metres a second at which the walk and the run clips do not slide (the maker's answer)
local JUMP, GRAVITY = 6.2, 18
local RADIUS, HEIGHT = 0.3, 1.6     -- the body nova.solid.move moves (the maker's answer)

local Hero = nova.entity { model = "hero", tags = { "hero" }, velocity = false }

function Hero:create()
  self.face = math.pi               -- which way the model looks (ry); pi is towards -z, into the garden
  self.speed, self.vy, self.air = 0, 0, 0
  self.on_ground = true
  self.steps = 0
  self.anim = nova.animator("hero", {
    start = "move", fade = 0.15,
    states = {
      move = { blend = "speed", points = { { 0, "idle" }, { WALK, "walk" }, { RUN, "run" } } },
      jump = { clip = "jump", loop = false, fade = 0.06 },
    },
    -- the walk and run clips carry a "step" event where each foot lands
    on_event = function(event)
      if event == "step" and self.on_ground then
        self.steps = self.steps + 1
        nova.sound.play("step", { volume = 0.35 + 0.1 * (self.speed / RUN) })
      end
    end,
  })
end

function Hero:update(dt)
  -- the stick, as the camera sees it (move_y is negative when pushed away)
  local mx, my = nova.input.axis("move_x"), nova.input.axis("move_y")
  local fx, fz = nova.cam3.forward()
  local rx, rz = nova.cam3.right()
  local dx, dz = rx * mx - fx * my, rz * mx - fz * my
  local len = math.sqrt(dx * dx + dz * dz)
  if len > 1 then dx, dz, len = dx / len, dz / len, 1 end
  local moving = len > 0.15

  -- speed eases in and out; the model turns to face the way it goes
  local want = moving and RUN * len or 0
  self.speed = self.speed + (want - self.speed) * math.min(1, dt * 10)
  if moving then
    local turn = (math.atan(dx, dz) - self.face + math.pi) % (2 * math.pi) - math.pi
    self.face = self.face + turn * math.min(1, dt * 12)
    self.dir_x, self.dir_z = dx / len, dz / len
  end

  if self.on_ground and nova.input.pressed("a") then
    self.vy, self.on_ground = JUMP, false
    self.anim:play("jump", { restart = true })
    nova.sound.play("jump", { volume = 0.4 })
  end

  -- One move against everything solid: the ground and every entity with solid = true (their own triangles), and the
  -- trunks of the trees (the scenery's circles). It climbs what is lower than a step (0.35) and slides along the rest.
  self.vy = self.vy - GRAVITY * dt
  local m = nova.solid.move(self.x, self.y, self.z, RADIUS, HEIGHT,
    (self.dir_x or 0) * self.speed * dt, self.vy * dt, (self.dir_z or 0) * self.speed * dt)
  self.x, self.y, self.z = m.x, m.y, m.z
  if m.ground then
    self.on_ground, self.air, self.vy = true, 0, 0
  else
    self.air = self.air + dt
    if self.air > 0.12 then self.on_ground = false end   -- a short grace: going down a step is not a fall
    if m.ceiling and self.vy > 0 then self.vy = 0 end
  end

  if self.on_ground and self.anim:state() == "jump" then self.anim:play("move") end
  self.anim:set("speed", self.speed)
  self.anim:update(dt)
end

function Hero:draw()
  if self.visible == false then return end   -- (the camera hides the hero when it is squeezed against a wall)
  self.anim:draw(self.x, self.y, self.z, { ry = self.face })
end

return Hero
