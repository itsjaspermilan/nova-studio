-- The Scrapper's pipe: a magenta arc and a box that hurts the runner once. Its box is the one the tell showed.
local J = require("lib.juice")
local C = require("lib.combat")
local E = require("data.enemies").scrapper

local Swing = nova.entity {
  sprite = "fx_arc", anim = "heavy", tags = { "enemy_swing" }, pivot = { 6 / 32, 0.5 }, sx = 3, sy = 3, velocity = false, frames_left = 9, active_left = E.swing_frames,
}

function Swing:create()
  self.angle = C.angle[self.dir]
  self.hitbox = C.box(self.dir, self.area)
  self.depth = -self.y - 5
  self:play("heavy", { restart = true })
  self:strike()
end

function Swing:strike()
  if self.landed then return end
  local p = nova.first("player")
  if p and self:overlaps(p) then
    local took = p:take_damage(self.damage)
    self.landed = true
    if took then nova.log("scrapper hit lands") end
  end
end

function Swing:update(dt)
  if J.frozen() then return end
  if self.active_left > 0 then
    self.active_left = self.active_left - 1
    self:strike()
    if self.active_left == 0 then self.hitbox = { 0, 0, 0, 0 } end
  end
  self.frames_left = self.frames_left - 1
  if self.frames_left <= 0 then self:destroy() end
end

return Swing
