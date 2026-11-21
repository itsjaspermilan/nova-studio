-- The Scrapper's pipe: a magenta arc and a box that hurts the runner once. Its box is the one the tell showed.
local J = require("lib.juice")
local C = require("lib.combat")
local E = require("data.enemies").scrapper
local Run = require("lib.run")
local Cards = require("data.cards")

local V = require("lib.vfx")

local Swing = nova.entity {
  tags = { "enemy_swing" }, sx = 1.5, sy = 1.5, velocity = false, frames_left = 9, active_left = E.swing_frames, age = 0,
}

function Swing:create()
  self.hitbox = C.box(self.dir, self.area)
  self.depth = -self.y - 5
  self.rect = V.rect_of(self)           -- (the magenta crescent fills the box that hurts, the one the tell showed)
  self:strike()
end

function Swing:draw()
  V.crescent(self.rect, "fx_eswing", true, false, self.age)
end

function Swing:strike()
  if Run.mods.friendly > 0 then
    -- Friendly Fire: the pipe hurts the other enemies in its box too (once each)
    self.struck = self.struck or {}
    for _, e in ipairs(nova.all("hurtable")) do
      if e ~= self.owner and not e.prop and not self.struck[e] and e.state ~= "dead" and self:overlaps(e) then
        self.struck[e] = true
        e:take_hit(Cards.num.friendly.swing, 0, 0, 0)
        nova.log("friendly fire: a pipe hurts " .. (e.kind_name or "an enemy"))
      end
    end
  end
  if self.landed then return end
  local p = nova.first("player")
  if p and self:overlaps(p) then
    local took = p:take_damage(self.damage)
    self.landed = true
    if took then nova.log("scrapper hit lands"); V.hit(p.x, p.y - 30, C.vec[self.dir][1], C.vec[self.dir][2], { magenta = true, size = 60, n = 12 }) end
  end
end

function Swing:update(dt)
  if J.frozen(self) then return end
  if self.active_left > 0 then
    self.active_left = self.active_left - 1
    self:strike()
    if self.active_left == 0 then self.hitbox = { 0, 0, 0, 0 } end
  end
  self.age = self.age + 1
  self.frames_left = self.frames_left - 1
  if self.frames_left <= 0 then self:destroy() end
end

return Swing
