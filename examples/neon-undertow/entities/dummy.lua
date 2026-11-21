-- The training dummy: takes any hit, shows the last hit's damage as a number over its head, and never dies.
local E = require("data.enemies").dummy
local Ty = require("lib.type")
local Status = require("lib.status")

local Dummy = nova.entity {
  sprite = "dummy", anim = "idle", tags = { "hurtable", "dummy", "solid" },
  pivot = { 0.5, 0.9 }, hitbox = { -12, -10, 24, 10 }, sx = 1.5, sy = 1.5, velocity = false,
  light = { radius = 70, radius_y = 50, color = { 255, 63, 164 }, intensity = 0.9, y = -40 },
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
  Status.tick(self, dt)
  self.last_t = self.last_t + dt
  self.flash = math.max(0, self.flash - dt)
  self:play(self.flash > 0 and "hit" or "idle")
  self.angle = self.flash > 0 and 0.12 * self.wobble or 0
end

function Dummy:hud()
  local x, y = nova.cam.to_screen(self.x, self.y - 96)
  Status.hud(self, x, y - 6)
  if self.hits == 0 then return end
  local fade = math.max(0.45, 1 - self.last_t * 0.3)
  local pop = math.max(0, 0.25 - self.last_t) * 40
  Ty.text(x - 40, y - pop - 14, tostring(self.last_damage), "head", { color = { 255, 255, 255, 255 * fade }, align = "center", width = 80 })
end

return Dummy
