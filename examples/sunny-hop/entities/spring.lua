-- A spring: land on it to be thrown high (higher still with the jump button held). Place it by its foot.
local world = require("lib.world")
local fx = require("lib.fx")
local audio = require("lib.audio")
local Spring = nova.entity { sprite = "items/spring", sx = 0.5, sy = 0.5, pivot = { 0.5, 1 }, depth = 20, out = 0, squash = 1 }
function Spring:create()
  world.springs[#world.springs + 1] = { x0 = self.x - 22, y0 = self.y - 26, x1 = self.x + 22, y1 = self.y - 6, owner = self }
end
function Spring:update(dt)
  self.out = math.max(0, self.out - dt)
  self.squash = self.squash + (1 - self.squash) * math.min(1, dt * 14)
end
function Spring:draw()
  fx.draw(self.out > 0 and "items/spring_out" or "items/spring", self.x, self.y - 24, { sy = 0.5 * self.squash })
end
function Spring:boing()
  self.out, self.squash = 0.35, 1.25
  audio.sfx("spring")
  fx.dust(self.x, self.y - 4, 6)
end
return Spring
