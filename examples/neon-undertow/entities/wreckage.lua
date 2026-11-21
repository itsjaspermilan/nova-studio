-- A wrecked car left by Mother Coil's car drop: solid cover with health (the baton, shots and her later attacks break it). It lands
-- soft: until nothing stands in it, it is not solid, so a runner under the car is never trapped. Numbers: data/bosses.lua (cars.wreck).
local W = require("data.bosses").mother_coil.cars.wreck
local P = require("data.player")
local F = require("lib.fx")

local Wreck = nova.entity { tags = { "hurtable", "solid", "prop", "wreckage" }, velocity = false, sx = 1, sy = 1, flash = 0, t = 0 }

function Wreck:create()
  self.hp, self.max_hp = W.health, W.health
  self.prop, self.kind_name = true, "wreckage"
  self.w, self.h = W.w, W.h
  self.hitbox = { 0, 0, 0, 0 }
  self.settled = false
  self.depth = -self.y
end

function Wreck:crowded()
  local pad = 10
  local p = nova.first("player")
  if p and math.abs(p.x - self.x) < self.w / 2 + pad and math.abs(p.y - self.y) < self.h / 2 + pad then return true end
  for _, e in ipairs(nova.all("enemy")) do
    if math.abs(e.x - self.x) < self.w / 2 + pad and math.abs(e.y - self.y) < self.h / 2 + pad then return true end
  end
  return false
end

function Wreck:take_hit(damage, dx, dy, knock)
  if damage <= 0 or self.hp <= 0 then return false end
  self.hp = self.hp - damage
  self.flash = 0.1
  nova.log(string.format("wreckage takes %d (health %d)", damage, math.max(0, self.hp)))
  if self.hp <= 0 then
    nova.log("wreckage breaks")
    nova.sound.play("wreck_break", { volume = P.sfx.wreck_break, limit = 2 })
    F.burst(self.x, self.y - 10, 3)
    self:destroy()
  end
  return true
end

function Wreck:smash(by) self:take_hit(self.hp, 0, 0, 0) end

function Wreck:update(dt)
  self.t = self.t + dt
  self.flash = math.max(0, self.flash - dt)
  if not self.settled and not self:crowded() then
    self.settled = true
    self.hitbox = { -self.w / 2, -self.h / 2, self.w, self.h }
  end
end

function Wreck:draw()
  local x, y = nova.cam.to_screen(self.x, self.y)
  local frame = self.hp > self.max_hp * 0.5 and 0 or 1
  nova.sprite("wreckage", x, y - 12, { w = self.w, h = self.h + 24, frame = frame, color = self.flash > 0 and { 255, 140, 140 } or { 255, 255, 255 } })
  if frame == 1 then nova.light2d(self.x, self.y - 30, { radius = 90, color = { 255, 138, 43 }, intensity = 1.1, flicker = 0.5 }) end
end

function Wreck:hud()
  if self.hp >= self.max_hp or self.hp <= 0 then return end
  local x, y = nova.cam.to_screen(self.x, self.y - self.h / 2 - 22)
  nova.ui.rect(x - 20, y, 40, 5, { 5, 6, 15, 220 })
  nova.ui.rect(x - 19, y + 1, 38 * math.max(0, self.hp) / self.max_hp, 3, { 6, 240, 255, 255 })
end

return Wreck
