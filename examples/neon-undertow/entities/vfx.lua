-- Holds every particle of lib/vfx.lua (sparks, chunks, embers, smoke, dust): updates and draws them all in front of the street.
local J = require("lib.juice")

local Vfx = nova.entity { tags = { "vfx" }, velocity = false }

function Vfx:create()
  self.list = {}
  self.depth = -100000
end

function Vfx:update(dt)
  if J.frozen() then return end
  local list, n = self.list, #self.list
  local keep = 1
  for i = 1, n do
    local p = list[i]
    p.t = p.t + dt
    if p.t < p.life then
      local drag = math.max(0, 1 - (p.drag or 0) * dt)
      p.vx, p.vy = p.vx * drag, p.vy * drag
      p.vz = p.vz - p.g * dt
      p.x, p.y, p.z = p.x + p.vx * dt, p.y + p.vy * dt, p.z + p.vz * dt
      if p.z < 0 then
        p.z = 0
        if p.bounce and p.bounce > 0 and math.abs(p.vz) > 40 then
          p.vz = -p.vz * p.bounce
          p.vx, p.vy = p.vx * 0.6, p.vy * 0.6
          p.spin = (p.spin or 0) * 0.5
        else
          p.vz, p.vx, p.vy, p.spin = 0, p.vx * 0.3, p.vy * 0.3, 0
          p.along = false
        end
      end
      if p.spin then p.rot = (p.rot or 0) + p.spin * dt end
      list[keep] = p
      keep = keep + 1
    end
  end
  for i = keep, n do list[i] = nil end
  -- (never more than the cap: the oldest go first)
  local cap = require("lib.vfx").cap()
  while #list > cap do table.remove(list, 1) end
end

function Vfx:draw()
  for _, p in ipairs(self.list) do
    local k = p.t / p.life
    local a = p.alpha
    if p.fade then
      local f = 1 - p.fade
      if k > f then a = a * (1 - (k - f) / p.fade) end
    end
    if p.flicker then a = a * (0.6 + 0.4 * math.sin(p.t * 40 + p.x)) end
    if a > 0.01 then
      local sx, sy = nova.cam.to_screen(p.x, p.y)
      local frame = p.frame
      if p.anim then frame = p.anim[1] + math.min(p.anim[2] - p.anim[1], math.floor(k * (p.anim[2] - p.anim[1] + 1))) end
      local w = p.w * (1 + (p.grow or 0) * p.t)
      local h = p.h * (1 + (p.grow or 0) * p.t)
      local rot = p.rot or 0
      if p.along then rot = math.atan(p.vy - p.vz, p.vx) end
      local c = p.color or { 255, 255, 255 }
      nova.sprite(p.spr, sx, sy - p.z, { frame = frame, w = w, h = h, rotation = rot, color = { c[1], c[2], c[3], 255 * a }, blend = p.add and "add" or nil, lit = p.lit or false })
    end
  end
end

return Vfx
