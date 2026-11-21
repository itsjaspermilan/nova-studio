-- One lane of Mother Coil's junk drag: lit across the whole floor for `tell` seconds (its own sound), then a heap of junk is dragged along it
-- and hurts whatever it touches in the lane (the runner once, enemies once, and it smashes wreckage). Between the lanes it hurts nothing.
-- Props: dir (1 = from the west, -1 = from the east), x0, x1 (the floor's ends), first (the lane that makes the sound).
local L = require("data.bosses").mother_coil.lanes
local P = require("data.player")
local J = require("lib.juice")
local D = require("lib.draw")

local Lane = nova.entity { tags = { "coil_lane" }, velocity = false, t = 0, dir = 1, moving = false }

function Lane:create()
  self.depth = 96
  self.px = self.dir == 1 and (self.x0 - L.length / 2 - 40) or (self.x1 + L.length / 2 + 40)
  self.hit = {}
  if self.first then nova.sound.play("tell_lanes", { volume = P.sfx.tell_lanes }) end
  nova.log(string.format("lane lit at y %.0f", self.y))
end

-- Is the point (feet of a runner or enemy) in the heap's box right now?
function Lane:touches(e, pad)
  return math.abs(e.y - self.y) <= L.width / 2 + (pad or 0) and math.abs(e.x - self.px) <= L.length / 2 + (pad or 0)
end

function Lane:update(dt)
  if J.frozen(self) then return end
  self.t = self.t + dt
  if self.t < L.tell then return end
  if not self.moving then
    self.moving = true
    if self.first then nova.sound.play("junk_drag", { volume = P.sfx.junk_drag }) end
  end
  self.px = self.px + self.dir * L.speed * dt
  local p = nova.first("player")
  if p and p.state ~= "dead" and not self.hit[p] and self:touches(p) then
    if p:take_damage(L.damage) then
      self.hit[p] = true
      nova.log("boss hit lands: lane")
    end
  end
  for _, e in ipairs(nova.all("enemy")) do
    if not self.hit[e] and e.state ~= "dead" and self:touches(e) then
      self.hit[e] = true
      e:take_hit(L.damage, 0, 0, 0)
    end
  end
  for _, w in ipairs(nova.all("wreckage")) do
    if math.abs(w.y - self.y) <= L.width / 2 + w.h / 2 and math.abs(w.x - self.px) <= L.length / 2 + w.w / 2 then w:smash("junk") end
  end
  if (self.dir == 1 and self.px > self.x1 + L.length) or (self.dir == -1 and self.px < self.x0 - L.length) then self:destroy() end
end

function Lane:draw()
  if self.t < L.tell then
    local on = math.floor(self.t * 12) % 2 == 0
    D.lane(self.x0, self.y, self.x1, self.y, L.width, { 255, 43, 214, on and 110 or 55 })
    D.lane(self.x0, self.y - L.width / 2, self.x1, self.y - L.width / 2, 4, { 255, 255, 255, 200 })
    D.lane(self.x0, self.y + L.width / 2, self.x1, self.y + L.width / 2, 4, { 255, 255, 255, 200 })
  else
    D.lane(self.x0, self.y, self.x1, self.y, L.width, { 255, 43, 214, 28 })
    local sx, sy = nova.cam.to_screen(self.px, self.y)
    nova.sprite("coil_junk", sx, sy - 10, { w = L.length, h = L.width + 24, flip_x = self.dir == -1 })
  end
end

return Lane
