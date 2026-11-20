-- A bit of scrap: pops out of a dead enemy, slides to a stop, and is counted when the runner walks over it.
local P = require("data.player")
local J = require("lib.juice")
local E = require("data.enemies").scrap

local Scrap = nova.entity {
  sprite = "scrap", anim = "spin", tags = { "scrap" }, pivot = { 0.5, 0.5 }, hitbox = { -6, -6, 12, 12 }, sx = 3, sy = 3,
  velocity = false, t = 0, pvx = 0, pvy = 0,
}

function Scrap:create() self.depth = -self.y end

function Scrap:update(dt)
  self.t = self.t + dt
  if math.abs(self.pvx) + math.abs(self.pvy) > 2 then
    self:slide(self.pvx * dt, self.pvy * dt)
    local k = math.max(0, 1 - E.friction * dt)
    self.pvx, self.pvy = self.pvx * k, self.pvy * k
  end
  self.depth = -self.y
  local p = nova.first("player")
  if p and self.t >= E.pickup_delay and self:overlaps(p) then
    J.scrap = J.scrap + 1
    nova.sound.play("scrap", { volume = P.sfx.scrap, pitch = 1 + 0.06 * (J.scrap % 5) })
    nova.log("scrap " .. J.scrap)
    nova.spawn("fx", self.x, self.y, { sprite = "fx_spark", anim = "spark", scale = 2 })
    self:destroy()
  end
end

return Scrap
