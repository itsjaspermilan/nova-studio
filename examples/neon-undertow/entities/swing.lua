-- The baton's arc: a picture (sprites/fx_arc) and a box (hit area) that hurts things tagged "hurtable" once each.
-- Made by the runner at the moment the hit comes out; its numbers come from data/player.lua.
local J = require("lib.juice")
local P = require("data.player")
local C = require("lib.combat")
local Hits = require("lib.hits")

local Swing = nova.entity {
  sprite = "fx_arc", anim = "swing", tags = { "swing" }, pivot = { 6 / 32, 0.5 }, sx = 3, sy = 3, velocity = false,
  frames_left = 9, active_left = P.attack.active_frames,
}

function Swing:create()
  local dir = self.dir or "right"
  self.angle = C.angle[dir]
  self.flip_y = self.flip and true or false
  self.hitbox = C.box(dir, self.area)
  self.depth = -self.y - 5
  self.hit = {}
  if self.scale_arc and self.scale_arc ~= 1 then self.sx, self.sy = 3 * self.scale_arc, 3 * self.scale_arc end -- (Long Reach: the arc is drawn as long as its box)
  self:play(self.arc or "swing", { restart = true })
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
    end
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
