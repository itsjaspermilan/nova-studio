-- What an elite's mark does every frame, beside the elite (made by lib/elite.lua): Shielded draws the shield, Magnetic bends the runner's
-- shots and drags the runner, Linked picks a partner and heals while it lives, and draws the line between them. Numbers: data/elites.lua.
local D = require("data.elites")
local J = require("lib.juice")
local DR = require("lib.draw")
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
    DR.lane(cx - px * 30 * k, cy - py * 30 * k, cx + px * 30 * k, cy + py * 30 * k, 12, { 6, 240, 255, 230 })
    DR.lane(cx - px * 30 * k, cy - py * 30 * k, cx + px * 30 * k, cy + py * 30 * k, 22, { 6, 240, 255, 60 })
  elseif self.mark == "magnetic" then
    local pulse = (self.t * 1.2) % 1
    DR.ring(o.x, o.y - 8 * k, self.m.shot_range * (1 - pulse), { 255, 43, 214, 240 * pulse }, 6, 36)
  elseif self.mark == "linked" and self.partner and self.partner:is_alive() then
    local on = math.floor(self.t * 10) % 2 == 0
    local a, b = self.partner, o
    DR.lane(a.x, a.y - 30, b.x, b.y - 30 * k, 6, { 6, 240, 255, on and 230 or 150 })
    DR.lane(a.x, a.y - 30, b.x, b.y - 30 * k, 14, { 6, 240, 255, 50 })
  end
end

return Fx
