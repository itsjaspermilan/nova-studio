local state = require("lib.state")

-- The key to the door: it bobs a little, and the first touch picks it up.
local Key = nova.entity { sprite = "key", tags = { "key" }, hitbox = { -10, -12, 20, 24 }, depth = 30 }

function Key:create() self.home = self.y end

function Key:update(dt) self.y = self.home + math.sin(nova.time() * 3) * 3 end

function Key:on_collide_hero(hero)
  state.has_key = true
  nova.sound.play("key")
  nova.burst(self.x, self.y, { count = 12, speed = { 30, 120 }, life = { 0.3, 0.6 }, size = 4, size_end = 0, color = { 255, 230, 120, 255 }, color_end = { 255, 200, 60, 0 } })
  self:destroy()
end

return Key
