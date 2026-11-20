-- What the demo's enemies share: they wander, come for the runner when near, show their "tell" frame (creature_make
-- draws one for every city archetype: the outline and lights flash) before they lunge, and flash white when hit.
-- A character sheet (the Scrapper) walks and swings by direction instead.
return function(spec)
  local Enemy = nova.entity {
    sprite = spec.sprite, anim = spec.anim or "idle",
    tags = { "enemy" },
    pivot = spec.pivot or { 0.5, 0.875 },
    hitbox = spec.hitbox or { -12, -16, 24, 16 },
    sx = 1.5, sy = 1.5, -- the detailed style: twice the pixels, the same size on the screen
    velocity = false, -- this file moves it
    speed = spec.speed or 60,
    hp = spec.hp or 3,
  }

  function Enemy:create()
    self.turn, self.flash, self.wait = 0, 0, 0
    self.dx, self.dy = 0, 0
    self.facing = "down"
  end

  -- the animation for a state, by direction for a character sheet
  function Enemy:show(state)
    if spec.person then
      local name = ({ idle = "idle_", move = "walk_", tell = "attack_", hit = "hurt_" })[state] .. self.facing
      self:play(name)
    elseif state == "move" and spec.still then
      self:play("idle")
    else
      self:play(state)
    end
  end

  function Enemy:update(dt)
    self.depth = -self.y
    if self.flash > 0 then
      self.flash = self.flash - dt
      if self.flash <= 0 then self:show("idle") end
      return
    end
    local runner = nova.first("hero")
    if self.wait > 0 then -- the tell: it stands and flashes, then lunges
      self.wait = self.wait - dt
      if self.wait <= 0 then
        self:show(spec.after_tell or "move")
        if not spec.still then self.dx, self.dy = self.dx * 4, self.dy * 4 end
        self.turn = 0.25
      end
      return
    end
    self.turn = self.turn - dt
    if self.turn <= 0 then
      self.turn = 0.8 + math.random() * 0.8
      local angle = math.random() * math.pi * 2
      local near = runner and self:distance_to(runner) < (spec.sees or 240)
      if near then angle = math.atan(runner.y - self.y, runner.x - self.x) end
      self.dx, self.dy = math.cos(angle), math.sin(angle)
      if math.abs(self.dx) > math.abs(self.dy) then self.facing = self.dx < 0 and "left" or "right" else self.facing = self.dy < 0 and "up" or "down" end
      if near and self:distance_to(runner) < (spec.reach or 110) then
        self.wait = 0.4
        self:show("tell")
        return
      end
      self:show("move")
    end
    if not spec.still then self:slide(self.dx * self.speed * dt, self.dy * self.speed * dt) end
    if not spec.person then self.flip_x = self.dx < 0 end
  end

  function Enemy:take_hit(wx, wy)
    self.hp = self.hp - 1
    self.flash = 0.15
    self:show("hit")
    if not spec.still then self:slide(wx * 30, wy * 30) end
    nova.log(spec.sprite .. " hit, hp " .. self.hp)
    if self.hp <= 0 then self:destroy() end
  end

  return Enemy
end
