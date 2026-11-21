-- A lobbed bottle: flies in an arc from the thrower's hand to a spot on the ground, which is marked while it flies (a ring the
-- size of the fire it will leave). On landing it smashes and leaves fire (entities/fire.lua). Props: sx0, sy0, tx, ty, time, height.
local E = require("data.enemies").bottle_thrower
local P = require("data.player")
local J = require("lib.juice")
local D = require("lib.draw")
local Run = require("lib.run")
local Cards = require("data.cards")

local Bottle = nova.entity { sprite = "bottle", anim = "spin", tags = { "bottle" }, velocity = false, sx = 3, sy = 3, pivot = { 0.5, 0.5 }, t = 0 }

function Bottle:create() self.depth = -self.ty - 300 end

function Bottle:land()
  nova.sound.play("bottle_smash", { volume = P.sfx.bottle_smash })
  nova.spawn("fx", self.tx, self.ty - 8, { sprite = "fx_burst", anim = "burst", scale = 2.5 })
  if Run.mods.friendly > 0 then
    -- Friendly Fire: the smash itself hurts the enemies in the fire's ring
    for _, e in ipairs(nova.all("enemy")) do
      if e.state ~= "dead" and math.sqrt((e.x - self.tx) ^ 2 + (e.y - self.ty) ^ 2) <= E.fire.radius then
        e:take_hit(Cards.num.friendly.bottle, 0, 0, 0)
        nova.log("friendly fire: a bottle smashes " .. (e.kind_name or "an enemy"))
      end
    end
  end
  nova.spawn("fire", self.tx, self.ty, { life = E.fire.time })
  nova.log(string.format("bottle lands at %.0f,%.0f", self.tx, self.ty))
  self:destroy()
end

function Bottle:update(dt)
  if J.frozen(self) then return end
  self.t = self.t + dt
  local s = math.min(1, self.t / self.time)
  self.x = self.sx0 + (self.tx - self.sx0) * s
  self.y = self.sy0 + (self.ty - self.sy0) * s - math.sin(math.pi * s) * self.height
  if s >= 1 then self:land() end
end

-- The marked landing spot: a ring the size of the fire, brightening as the bottle comes down.
function Bottle:draw()
  local s = math.min(1, self.t / self.time)
  local a = 90 + 140 * s
  D.disc(self.tx, self.ty, E.fire.radius, { 255, 138, 43, 30 + 50 * s })
  D.ring(self.tx, self.ty, E.fire.radius, { 255, 138, 43, a }, 5, 32)
  D.ring(self.tx, self.ty, E.fire.radius * (1 - s), { 255, 228, 94, a }, 4, 20)
  nova.Entity.draw(self)
end

return Bottle
