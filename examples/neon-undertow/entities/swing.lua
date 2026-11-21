-- The baton's swing: a picture (the neon crescent, sprites/fx_swing: stretched to fill the hit box exactly, with a soft glow, a trailing
-- afterimage and sparks where it lands) and the box itself, which hurts things tagged "hurtable" once each.
-- Made by the runner at the moment the hit comes out; its numbers come from data/player.lua.
local J = require("lib.juice")
local P = require("data.player")
local C = require("lib.combat")
local Hits = require("lib.hits")
local V = require("lib.vfx")

local Swing = nova.entity {
  tags = { "swing" }, sx = 1.5, sy = 1.5, velocity = false,
  frames_left = 9, active_left = P.attack.active_frames, age = 0,
}

function Swing:create()
  local dir = self.dir or "right"
  self.hitbox = C.box(dir, self.area)
  self.depth = -self.y - 5
  self.hit = {}
  if self.scale_arc and self.scale_arc ~= 1 then self.sx, self.sy = 1.5 * self.scale_arc, 1.5 * self.scale_arc end -- (Long Reach: the arc is drawn as long as its box)
  self.heavy = self.arc == "heavy"
  self.rect = V.rect_of(self)                      -- (what is drawn is the box that hurts: taken from it now, before it is emptied)
  self:strike()
end

function Swing:strike()
  for _, e in ipairs(nova.all("hurtable")) do
    if not self.hit[e] and self:overlaps(e) then
      self.hit[e] = true
      local v = C.vec[self.dir]
      local fresh = e.hp ~= nil and e.max_hp ~= nil and e.hp >= e.max_hp          -- (Skim: a hit on a healthy enemy)
      local damage = Hits.baton_damage(e, self.damage, self.rhythm)   -- (Metronome, Tracer, the shares)
      local took = e:take_hit(damage, v[1], v[2], self.knockback or 0)
      if took and self.owner and self.owner:is_alive() then self.owner:on_baton_hit(e, damage, self.chain, fresh) end
      if took then V.hit(e.x, e.y - 26, v[1], v[2], { size = self.heavy and 62 or 46, n = self.heavy and 13 or 8 }) end
    end
  end
end

function Swing:update(dt)
  if J.frozen() then return end
  self.age = self.age + 1
  if self.active_left > 0 then
    self.active_left = self.active_left - 1
    self:strike()
    if self.active_left == 0 then self.hitbox = { 0, 0, 0, 0 } end
  end
  self.frames_left = self.frames_left - 1
  if self.frames_left <= 0 then self:destroy() end
end

function Swing:draw()
  V.crescent(self.rect, "fx_swing", self.heavy, self.flip == true, self.age)
end

return Swing
