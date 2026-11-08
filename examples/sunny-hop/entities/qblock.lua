-- A ? block: bump it from below for what is inside. Props: gives ("coin", the default; "coins" for five, one a bump; "heart"; "gem"),
-- n (the gem's number when gives = "gem").
local world = require("lib.world")
local fx = require("lib.fx")
local audio = require("lib.audio")
local run = require("lib.run")
local QBlock = nova.entity { sprite = "items/block_coin", sx = 0.5, sy = 0.5, tags = { "qblock" }, depth = 20, settings = {
  gives = { "coin", choices = { "coin", "coins", "heart", "gem" }, help = "What is inside: a coin, five coins (one a bump), a heart or a gem" },
  n = { 1, min = 1, max = 3, step = 1, help = "The gem's number, when it gives a gem" },
}, left = 1, bounce = 0, used = false }
function QBlock:create()
  if self.gives == "coins" then self.left = 5 end
  self.solid = world.add_box({ x0 = self.x - 24, y0 = self.y - 24, x1 = self.x + 24, y1 = self.y + 24, owner = self })
end
function QBlock:update(dt) self.bounce = math.max(0, self.bounce - dt) end
function QBlock:draw()
  local lift = math.sin(math.min(1, self.bounce / 0.18) * math.pi) * 12
  fx.draw(self.used and "items/block_coin_active" or "items/block_coin", self.x, self.y - lift)
end
function QBlock:bump(hero)
  self.bounce = 0.18
  if self.used then audio.sfx("bump"); return end
  -- whatever stands on it is knocked off
  for _, e in ipairs(nova.all("enemy")) do
    if not e.dead and math.abs(e.x - self.x) < 40 and math.abs(e.y - (self.y - 24)) < 8 then e:knock(self.x) end
  end
  if self.gives == "heart" then
    nova.spawn("heart", self.x, self.y - 60)
    audio.sfx("powerup")
    self.left = 0
  elseif self.gives == "gem" then
    nova.spawn("gem", self.x, self.y - 64, { n = self.n })
    audio.sfx("magic")
    self.left = 0
  else
    nova.spawn("coin", self.x, self.y - 40):pop()
    self.left = self.left - 1
  end
  if self.left <= 0 then self.used = true end
  fx.sparkle(self.x, self.y - 30, 4)
end
function QBlock:on_destroy() world.remove_box(self.solid) end
return QBlock
