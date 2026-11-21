-- An explosion's picture, in stages (lib/vfx.lua boom adds the sparks, chunks and the scorch): a white flash, the fireball
-- (sprites/fx_boom: it grows and breaks up in hot white, yellow, orange, dark red, then rises as smoke), a shock ring along the ground,
-- and a light that flashes and dies away. Props: radius (the blast's hit radius: the ball is drawn to fit it).
local J = require("lib.juice")
local LK = require("lib.look")
local V = require("lib.vfx")

local Boom = nova.entity { tags = { "boom" }, velocity = false, t = 0 }

-- seconds: the flash, the fireball's 8 frames, the smoke's 3; and the ring
local FLASH, BALL, SMOKE, RING = 0.06, 0.52, 0.66, 0.42

function Boom:create()
  self.depth = -self.y - 40
  self.total = FLASH + BALL + SMOKE
end

function Boom:update(dt)
  if J.frozen() then return end
  self.t = self.t + dt
  if self.t >= self.total then self:destroy() end
end

function Boom:draw()
  local R, t = self.radius, self.t
  local x, y = nova.cam.to_screen(self.x, self.y)
  local k = t / self.total
  local q = V.q()
  -- the picture is 128 px with the ball filling about 90 of them at its largest: w fits that to about one radius all round
  local w = R * 3.1
  local frame
  if t < FLASH then frame = 0
  elseif t < FLASH + BALL then frame = 1 + math.min(7, math.floor((t - FLASH) / BALL * 8))
  else frame = 9 + math.min(2, math.floor((t - FLASH - BALL) / SMOKE * 3)) end
  -- the ring along the ground
  if t < RING and q ~= "off" then
    nova.sprite("fx_ring", x, y, { frame = math.min(5, math.floor(t / RING * 6)), w = R * 2.06, h = R * 2.06, blend = "add", lit = false, alpha = 1 - (t / RING) ^ 3 })
  end
  -- a hot glow under the ball while it burns
  if V.glow() and t < FLASH + BALL then
    local g = 1 - t / (FLASH + BALL)
    nova.circle(x, y - R * 0.25, R * (0.9 + 0.5 * (1 - g)), { 255, 160, 60, 140 * g }, { soft = true, blend = "add", lit = false, ry = R * 0.7 })
  end
  if t < FLASH then
    nova.circle(x, y - R * 0.2, R * 1.6, { 255, 250, 230, 200 }, { soft = true, blend = "add", lit = false, ry = R * 1.2 })
  end
  local lift = R * 0.12 + (frame >= 9 and R * 0.22 * (frame - 8) or 0)
  nova.sprite("fx_boom", x, y - R * 0.3 - lift, { frame = frame, w = w, h = w, lit = false })
  -- the light: a hard flash, then a glow that cools from white to red
  if q ~= "off" then
    local g = math.max(0, 1 - t / (FLASH + BALL))
    if g > 0 then nova.light2d(self.x, self.y - R * 0.2, { radius = R * 3.4, radius_y = R * 2.6, color = { 255, 150 + 90 * g, 70 + 120 * g * g }, intensity = 4.2 * g }) end
  end
end

return Boom
