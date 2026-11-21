-- A patch of fire on the ground: hurts anyone standing in it, the runner and every enemy, once each `every` seconds.
-- Props: life (seconds). Numbers: data/enemies.lua (bottle_thrower.fire).
local E = require("data.enemies").bottle_thrower.fire
local P = require("data.player")
local J = require("lib.juice")
local Status = require("lib.status")
local Look = require("data.look")
local V = require("lib.vfx")
local LK = require("lib.look")

local Fire = nova.entity {
  tags = { "fire" }, velocity = false, hitbox = { r = 8 }, life = 2, t = 0,   -- (no picture of its own: `sx` of E.radius / 8 is the hit circle's scale, so the flames are drawn by hand below)
  light = { radius = Look.fire.radius, radius_y = Look.fire.radius * 0.8, color = Look.fire.color, intensity = Look.fire.intensity, flicker = 0.5, y = -20 },
}

function Fire:create()
  self.sx, self.sy = E.radius / 8, E.radius / 8
  self.depth = 90
  self.cool = {}
  if not self.quiet then nova.sound.play("fire_start", { volume = P.sfx.fire_start }) end
  nova.log(string.format("fire burns at %.0f,%.0f", self.x, self.y))
  if not self.quiet then V.scorch(self.x, self.y, E.radius * 0.9) end
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

-- Where the flames stand, as shares of the radius (nearest the back first, so the front ones are drawn over them)
local TONGUES = { { 0, -0.5, 1.0 }, { -0.62, -0.2, 0.9 }, { 0.62, -0.2, 0.9 }, { 0, 0.0, 1.15 }, { -0.35, 0.42, 0.85 }, { 0.35, 0.42, 0.85 } }

function Fire:draw()
  local fade = self.alpha or 1
  local R = E.radius
  local x, y = nova.cam.to_screen(self.x, self.y)
  -- the area that burns (the same circle that hurts), faint, with a thin edge: where it is safe to stand is plain
  nova.circle(x, y, R, { 255, 138, 43, 26 * fade }, { blend = "add", lit = false, ry = R * 0.8 })
  nova.sprite("fx_tell", x, y, { frame = 0, w = R * 2.1, h = R * 1.68, color = { 255, 150, 60, 100 * fade }, blend = "add", lit = false })
  if V.glow() then LK.halo(self.x, self.y - 14, R * 1.5, { 255, 130, 40 }, 80 * fade) end
  -- the flames: eight pictures of a flame (sprites/fx_flame), six of them standing about the patch, each a step on in the cycle
  local grow = math.min(1, self.t / 0.25)
  for i, s in ipairs(TONGUES) do
    local w = R * 1.25 * s[3] * grow * (0.6 + 0.4 * fade)
    local px, py = x + s[1] * R * 0.85, y + s[2] * R * 0.85 * 0.8
    local frame = (math.floor(self.t * 13) + i * 3) % 8
    nova.sprite("fx_flame", px, py - w * 0.52, { frame = frame, w = w, h = w * 1.25, alpha = fade, lit = false })
  end
end

function Fire:update(dt)
  if J.frozen() then return end
  self.t = self.t + dt
  self.alpha = self.t > self.life - 0.4 and math.max(0, (self.life - self.t) / 0.4) or 1
  if self.t >= self.life then nova.log("fire out"); return self:destroy() end
  self.fx_t = (self.fx_t or 0) - dt
  if self.fx_t <= 0 and not self.quiet then
    self.fx_t = 0.14
    V.embers(self.x, self.y, 1, { radius = E.radius * 0.8, up = 120, life = 1.2 })
    if math.random() < 0.25 then V.smoke(self.x, self.y, 1, { radius = E.radius * 0.5, size = 30, up = 60, life = 1.4, alpha = 0.35 }) end
  end
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
