-- The training dummy: takes any hit, shows the last hit's damage as a number over its head, and never dies.
local E = require("data.enemies").dummy

local Dummy = nova.entity {
  sprite = "dummy", anim = "idle", tags = { "hurtable", "dummy", "solid" },
  pivot = { 0.5, 0.9 }, hitbox = { -6, -5, 12, 5 }, sx = 3, sy = 3, velocity = false,
  last_damage = 0, last_t = 99, flash = 0, total = 0, hits = 0, wobble = 0,
}

function Dummy:create() self.depth = -self.y end

function Dummy:take_hit(damage, dx, dy)
  self.last_damage, self.last_t, self.flash = damage, 0, E.flash
  self.total, self.hits = self.total + damage, self.hits + 1
  self.wobble = dx ~= 0 and dx or 0
  nova.log("dummy takes " .. damage)
  return true
end

function Dummy:update(dt)
  self.last_t = self.last_t + dt
  self.flash = math.max(0, self.flash - dt)
  self:play(self.flash > 0 and "hit" or "idle")
  self.angle = self.flash > 0 and 0.12 * self.wobble or 0
end

function Dummy:hud()
  if self.hits == 0 then return end
  local x, y = nova.cam.to_screen(self.x, self.y - 96)
  local fade = math.max(0.45, 1 - self.last_t * 0.3)
  local pop = math.max(0, 0.25 - self.last_t) * 40
  nova.ui.text(x - 40, y - pop - 14, tostring(self.last_damage), { font = "pixel", size = 28, color = { 255, 255, 255, 255 * fade }, align = "center", width = 80, shadow = true })
end

return Dummy
