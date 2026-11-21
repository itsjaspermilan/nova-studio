-- What an elite's mark does every frame, beside the elite (made by lib/elite.lua): Shielded draws the shield, Magnetic bends the runner's
-- shots and drags the runner, Linked picks a partner and heals while it lives, and draws the line between them. Numbers: data/elites.lua.
local D = require("data.elites")
local J = require("lib.juice")
local DR = require("lib.draw")
local V = require("lib.vfx")
local C = require("lib.combat")

local Fx = nova.entity { tags = { "elite_fx" }, velocity = false, t = 0 }

function Fx:create()
  self.m = D.marks[self.mark]
  self.acc = 0
  self.depth = 80
end

function Fx:pick_partner()
  local o, best, bd = self.owner, nil, 1e9
  for _, e in ipairs(nova.all("enemy")) do
    if e ~= o and e.kind_name ~= "tout" and e.state ~= "dead" and not e.elite then
      local d = o:distance_to(e)
      if d < bd then best, bd = e, d end
    end
  end
  self.partner, self.partner_set = best, true
  if best then nova.log("linked to a " .. best.kind_name) else nova.log("linked to no one") end
end

function Fx:update(dt)
  local o = self.owner
  if not o or not o:is_alive() or o.state == "dead" then return self:destroy() end
  if J.frozen() then return end
  self.t = self.t + dt
  local m = self.m
  if self.mark == "magnetic" then
    local tx, ty = o.x, o.y - 10 * (o.size_mult or 1)
    for _, s in ipairs(nova.all("shot")) do
      local dx, dy = tx - s.x, ty - s.y
      local dist = math.sqrt(dx * dx + dy * dy)
      if dist < m.shot_range and dist > 4 then
        local k = math.min(1, m.shot_pull * dt)
        local nx, ny = s.dx + dx / dist * k, s.dy + dy / dist * k
        local len = math.sqrt(nx * nx + ny * ny)
        s.dx, s.dy = nx / len, ny / len
        s.angle = math.atan(s.dy, s.dx)
      end
    end
    local p = nova.first("player")
    if p and p.state ~= "dead" then
      local dx, dy = o.x - p.x, o.y - p.y
      local dist = math.sqrt(dx * dx + dy * dy)
      if dist < m.runner_range and dist > m.gap then
        p:move(dx / dist * m.runner_pull * dt, dy / dist * m.runner_pull * dt)
        self.pulled = (self.pulled or 0) + m.runner_pull * dt
      end
    end
  elseif self.mark == "linked" then
    if not self.partner_set and self.t >= m.partner_after then self:pick_partner() end
    local pa = self.partner
    if pa and (not pa:is_alive() or pa.state == "dead") then
      self.partner = nil
      nova.log("the link is broken: its partner died")
    elseif pa then
      if o.hp < o.max_hp then
        self.acc = self.acc + m.heal * dt
        local whole = math.floor(self.acc)
        if whole > 0 then
          o.hp = math.min(o.max_hp, o.hp + whole)
          self.acc = self.acc - whole
          self.healed = (self.healed or 0) + whole
        end
      else
        self.acc = 0
      end
    end
  end
end

function Fx:draw()
  local o = self.owner
  if not o or not o:is_alive() then return end
  local k = o.size_mult or 1
  if self.mark == "shielded" then
    local v = C.vec[o.facing or "down"]
    local cx, cy = o.x + v[1] * 40 * k, o.y - 16 * k + v[2] * 30 * k
    local px, py = -v[2], v[1]
    -- a curved shield standing in front: its two ends are the old bar's ends, it bulges out 10 units, glowing in layers
    local pts = {}
    for i = 0, 8 do
      local s = i / 4 - 1
      pts[#pts + 1] = { cx + px * s * 30 * k + v[1] * 10 * k * (1 - s * s), cy + py * s * 30 * k + v[2] * 10 * k * (1 - s * s) }
    end
    local shimmer = 0.75 + 0.25 * math.sin(self.t * 12)
    for i = 1, #pts - 1 do
      local a, b = pts[i], pts[i + 1]
      if V.glow() then V.line(a[1], a[2], b[1], b[2], 24, { 6, 240, 255, 50 * shimmer }, 0) end
      V.line(a[1], a[2], b[1], b[2], 12, { 6, 240, 255, 200 * shimmer }, 0)
      V.line(a[1], a[2], b[1], b[2], 4, { 220, 255, 255, 255 }, 0)
    end
    -- a glint runs along it
    local gi = 1 + math.floor((self.t * 5) % 1 * (#pts - 1))
    local gx, gy = nova.cam.to_screen(pts[gi][1], pts[gi][2])
    nova.sprite("fx_bits", gx, gy, { frame = V.bits.star, w = 26, h = 26, blend = "add", lit = false })
  elseif self.mark == "magnetic" then
    -- the reach of the pull (shot_range): a ring that contracts towards the elite, with chevrons pointing in
    local R = self.m.shot_range
    local cx, cy = nova.cam.to_screen(o.x, o.y - 8 * k)
    nova.sprite("fx_tell", cx, cy, { frame = 0, w = R * 2.1, h = R * 1.68, color = { 255, 43, 214, 38 }, blend = "add", lit = false })
    for pass = 0, 1 do
      local pulse = (self.t * 1.2 + pass * 0.5) % 1
      local r = R * (1 - pulse)
      nova.sprite("fx_tell", cx, cy, { frame = 0, w = r * 2.1, h = r * 1.68, color = { 255, 80, 220, 240 * pulse }, blend = "add", lit = false })
      for j = 0, 7 do
        local a = j / 8 * math.pi * 2 + pass * 0.4
        nova.sprite("fx_chev", cx + math.cos(a) * r, cy + math.sin(a) * r * 0.8, { w = 22, h = 22, rotation = a + math.pi, color = { 255, 120, 235, 230 * pulse }, blend = "add", lit = false })
      end
    end
  elseif self.mark == "linked" and self.partner and self.partner:is_alive() then
    -- a crackling cyan cord between the two, re-jagging every few frames, with a spark at each end
    local a, b = self.partner, o
    V.bolt(a.x, a.y - 30, b.x, b.y - 30 * k, 0.85, nil, math.floor(self.t * 14), 0, 10)
  end
end

return Fx
