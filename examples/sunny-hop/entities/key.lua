-- A key; it opens every lock of its colour. Prop: color ("blue", "green", "red" or "yellow").
local fx = require("lib.fx")
local audio = require("lib.audio")
local run = require("lib.run")
local Key = nova.entity { sprite = "items/key_yellow", sx = 0.5, sy = 0.5, tags = { "pickup", "key" }, depth = 10, settings = { color = { "yellow", choices = { "blue", "green", "red", "yellow" }, help = "Opens (or is opened by) everything of this colour" } }, r = 24 }
function Key:create() self.t = 0 end
function Key:update(dt) self.t = self.t + dt end
function Key:draw() fx.draw("items/key_" .. self.color, self.x, self.y + math.sin(self.t * 3) * 4, { rotation = math.sin(self.t * 2) * 0.15 }) end
function Key:collect(hero)
  run.take_key(self.color)
  audio.sfx("key")
  fx.sparkle(self.x, self.y, 10)
  fx.float(self.x, self.y - 30, "Key!", { 255, 230, 120 }, 26)
  self:destroy()
end
return Key
