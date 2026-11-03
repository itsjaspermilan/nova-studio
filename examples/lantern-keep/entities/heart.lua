local state = require("lib.state")

-- A heart dropped by a slain enemy: it gives one back (up to five) and fades if nobody takes it.
local Heart = nova.entity { sprite = "heart", tags = { "pickup" }, hitbox = { -10, -10, 20, 20 }, depth = 30 }

function Heart:create()
  self:after(9, function() self:destroy() end)
end

function Heart:update(dt) self.sy = 1 + math.sin(nova.time() * 6) * 0.08 end

function Heart:on_collide_hero(hero)
  if state.hearts >= state.max_hearts then return end
  state.hearts = state.hearts + 1
  nova.sound.play("heart")
  self:destroy()
end

return Heart
