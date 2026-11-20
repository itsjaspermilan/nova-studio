-- What the slime and the bat share. Their sheets were made with creature_make: "idle", "move", and "hit", a white copy
-- shown for a moment when the sword lands. An enemy wanders, comes for the hero when he is near, takes two hits and
-- leaves a coin.
return function(spec)
  local Enemy = nova.entity {
    sprite = spec.sprite, anim = "move",
    tags = { "enemy" },
    pivot = { 0.5, 0.875 },
    hitbox = { -5, -8, 10, 8 },
    sx = 3, sy = 3,
    velocity = false, -- this file moves it
    speed = spec.speed,
    hp = spec.hp or 2,
  }

  function Enemy:create()
    self.turn = 0                 -- seconds until it next chooses a way to go
    self.dx, self.dy = 0, 0
    self.push_x, self.push_y = 0, 0
    self.flash = 0
  end

  function Enemy:update(dt)
    self.depth = -self.y
    if self.flash > 0 then
      self.flash = self.flash - dt
      if self.flash <= 0 then self:play("move") end
    end
    self.turn = self.turn - dt
    if self.turn <= 0 then
      self.turn = 0.7 + math.random() * 0.9
      local hero = nova.first("hero")
      local angle = math.random() * math.pi * 2
      if hero and self:distance_to(hero) < 230 then angle = math.atan(hero.y - self.y, hero.x - self.x) end
      self.dx, self.dy = math.cos(angle), math.sin(angle)
    end
    self:slide((self.dx * self.speed + self.push_x) * dt, (self.dy * self.speed + self.push_y) * dt)
    self.push_x, self.push_y = self.push_x * 0.85, self.push_y * 0.85
    self.flip_x = self.dx < 0
  end

  function Enemy:on_collide_hero(hero) hero:take_hit() end

  -- Called by the hero's swing with the way he faces.
  function Enemy:take_hit(wx, wy)
    self.hp = self.hp - 1
    self.flash = 0.12
    self:play("hit", { restart = true })
    self.push_x, self.push_y = wx * 420, wy * 420
    nova.sound.play("hit", { volume = 0.7 })
    nova.log(spec.sprite .. " hit, hp " .. self.hp)
    if self.hp <= 0 then
      nova.sound.play("enemy_die", { volume = 0.6 })
      nova.spawn("coin", self.x, self.y - 12)
      self:destroy()
    end
  end

  return Enemy
end
