-- A can spat by a Mimic Vendor: flies straight, hurts the runner on contact, stops at walls and solid things.
local E = require("data.enemies").mimic_vendor.cans
local P = require("data.player")
local J = require("lib.juice")
local Run = require("lib.run")
local Cards = require("data.cards")
local V = require("lib.vfx")
local LK = require("lib.look")

local Can = nova.entity { sprite = "can", anim = "spin", tags = { "can" }, velocity = false, hitbox = { r = 6 }, sx = 1.5, sy = 1.5, light = { radius = 60, color = { 255, 63, 164 }, intensity = 1.2 }, travelled = 0 }

function Can:create()
  self.depth = -self.y - 5
  self.trail = {}
  V.pop(self.x, self.y, 0.5, true)                -- (the muzzle: a flash and a few sparks where it leaves the machine)
end

-- A can in flight: a magenta glow round it and a fading trail of light behind it.
function Can:draw()
  local n = #self.trail
  for i, p in ipairs(self.trail) do
    local k = i / (n + 1)
    local sx, sy = nova.cam.to_screen(p[1], p[2])
    nova.sprite("fx_dot", sx, sy, { w = 22 * k, h = 22 * k, color = { 255, 63, 164, 170 * k }, blend = "add", lit = false })
  end
  if V.glow() then LK.halo(self.x, self.y, 30, { 255, 63, 164 }, 110) end
  nova.Entity.draw(self)
end

function Can:pop()
  nova.spawn("fx", self.x, self.y, { sprite = "fx_eimpact", anim = "burst", scale = 3 })
  V.sparks(self.x, self.y, 7, { z = 6, speed = 240, up = 140, life = 0.45, colors = { "spark_white", "spark_red" } })
  V.debris(self.x, self.y, 2, { kind = "grey", speed = 160, size = 12 })
  self:destroy()
end

function Can:update(dt)
  if J.frozen(self) then return end
  local step = E.speed * dt
  self.trail[#self.trail + 1] = { self.x, self.y }
  if #self.trail > 6 then table.remove(self.trail, 1) end
  local bx, by = self:slide(self.dx * step, self.dy * step)
  self.travelled = self.travelled + step
  self.depth = -self.y - 5
  if bx or by or self.travelled > E.range then return self:pop() end
  local p = nova.first("player")
  if p and p.state ~= "dead" and self:overlaps(p) then
    if p:take_damage(E.damage) then nova.log("can hits runner") end
    return self:pop()
  end
  if Run.mods.friendly > 0 then
    -- Friendly Fire: a can hurts the first other enemy it meets
    for _, e in ipairs(nova.all("hurtable")) do
      if e ~= self.owner and not e.prop and e.state ~= "dead" and self:overlaps(e) then
        e:take_hit(Cards.num.friendly.can, self.dx, self.dy, 0)
        nova.log("friendly fire: a can hurts " .. (e.kind_name or "an enemy"))
        return self:pop()
      end
    end
  end
  local s = self:touching("solid")      -- (not the machine it came out of)
  if s and s ~= self.owner then return self:pop() end
end

return Can
