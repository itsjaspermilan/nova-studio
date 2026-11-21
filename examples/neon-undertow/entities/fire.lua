-- A patch of fire on the ground: hurts anyone standing in it, the runner and every enemy, once each `every` seconds.
-- Props: life (seconds). Numbers: data/enemies.lua (bottle_thrower.fire).
local E = require("data.enemies").bottle_thrower.fire
local P = require("data.player")
local J = require("lib.juice")
local Status = require("lib.status")

local Fire = nova.entity {
  sprite = "fire", anim = "burn", tags = { "fire" }, velocity = false, pivot = { 0.5, 0.75 }, hitbox = { r = 8 }, life = 2, t = 0,
}

function Fire:create()
  self.sx, self.sy = E.radius / 8, E.radius / 8
  self.depth = 90
  self.cool = {}
  if not self.quiet then nova.sound.play("fire_start", { volume = P.sfx.fire_start }) end
  nova.log(string.format("fire burns at %.0f,%.0f", self.x, self.y))
end

function Fire:hurt(e, what)
  local c = self.cool[e]
  if c and self.t < c then return end
  self.cool[e] = self.t + E.every
  if what == "runner" then
    if e:take_damage(E.damage) then nova.log("fire hurts runner") end
  else
    e:take_hit(E.damage, 0, 0, 0)
    nova.log("fire hurts " .. (e.kind_name or e.name or "enemy"))
  end
end

function Fire:update(dt)
  if J.frozen() then return end
  self.t = self.t + dt
  self.alpha = self.t > self.life - 0.4 and math.max(0, (self.life - self.t) / 0.4) or 1
  if self.t >= self.life then nova.log("fire out"); return self:destroy() end
  local p = nova.first("player")
  if not self.friendly and p and p.state ~= "dead" and self:overlaps(p) then self:hurt(p, "runner") end     -- (a friendly fire, Incendiary's or Burn Rubber's, never burns the runner)
  for _, e in ipairs(nova.all("hurtable")) do
    if self:overlaps(e) then
      self:hurt(e, "enemy")
      if self.friendly and not e.prop and e.state ~= "dead" then Status.burn(e, 3, 1) end   -- ... and sets enemies alight
    end
  end
end

return Fire
