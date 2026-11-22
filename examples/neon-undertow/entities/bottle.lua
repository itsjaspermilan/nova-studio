-- A lobbed bottle: flies in an arc from the thrower's hand to a spot on the ground, which is marked while it flies (a ring the
-- size of the fire it will leave). On landing it smashes and leaves fire (entities/fire.lua). Props: sx0, sy0, tx, ty, time, height.
local E = require("data.enemies").bottle_thrower
local P = require("data.player")
local J = require("lib.juice")
local D = require("lib.draw")
local Run = require("lib.run")
local Cards = require("data.cards")
local V = require("lib.vfx")
local T = require("lib.tell")

local Bottle = nova.entity { sprite = "bottle", anim = "spin", tags = { "bottle" }, velocity = false, sx = 1.5, sy = 1.5, pivot = { 0.5, 0.5 }, t = 0,
  light = { radius = 80, color = { 255, 138, 43 }, intensity = 1.6, flicker = 0.4 } }

function Bottle:create() self.depth = -self.ty - 300 end

function Bottle:land()
  nova.sound.play("bottle_smash", { volume = P.sfx.bottle_smash, vary = 0.06 })
  -- the smash: a flash and a small fireball, the liquid splashed across the ground, glass flying, a scorch under the fire to come
  V.boom(self.tx, self.ty, E.fire.radius * 1.15, { shake = 3, quiet = true })
  V.debris(self.tx, self.ty, 6, { kind = "glass", speed = 220, up = 300, size = 14 })
  local sx, sy = nova.cam.to_screen(self.tx, self.ty)
  nova.spawn("fx", self.tx, self.ty - 6, { sprite = "fx_splash", anim = "splash", scale = 3.4 })
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
  -- the circle the fire will cover, filling as the bottle comes down
  T.disc(self.tx, self.ty, E.fire.radius, s, self.t, T.orange)
  -- its shadow runs along the ground under it, and it drips fire as it flies
  local gx, gy = self.sx0 + (self.tx - self.sx0) * s, self.sy0 + (self.ty - self.sy0) * s
  local hx, hy = nova.cam.to_screen(gx, gy)
  nova.circle(hx, hy, 12 + 6 * math.sin(math.pi * s), { 0, 0, 0, 90 }, { soft = true, lit = false, ry = 7 })
  self.drip = (self.drip or 0) - 1
  if self.drip <= 0 then
    self.drip = 2
    V.embers(self.x, self.y, 1, { radius = 4, up = 40, life = 0.5 })
  end
  nova.Entity.draw(self)
end

return Bottle
