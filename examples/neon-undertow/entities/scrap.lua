-- A bit of scrap: pops out of a dead enemy, slides to a stop, and is counted when the runner walks over it.
local P = require("data.player")
local J = require("lib.juice")
local Run = require("lib.run")
local E = require("data.enemies").scrap
local Hits = require("lib.hits")

local Scrap = nova.entity {
  sprite = "ui", frame = 5, tags = { "scrap" }, pivot = { 0.5, 0.5 }, hitbox = { -12, -12, 24, 24 }, sx = 1.5, sy = 1.5,
  light = { radius = 46, color = { 255, 220, 120 }, intensity = 1.0 },
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
    local got = Run.add_scrap(1)       -- (through the run's multiplier: Deep Pockets)
    Hits.after_scrap(got)               -- (the Leak set heals 1 point for every 20)
    nova.sound.play("scrap", { volume = P.sfx.scrap, pitch = 1 + 0.06 * (J.scrap % 5) })
    nova.log("scrap " .. J.scrap)
    nova.spawn("fx", self.x, self.y, { sprite = "fx_spark", anim = "spark", scale = 2 })
    self:destroy()
  end
end

return Scrap
