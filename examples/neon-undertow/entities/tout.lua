-- The Tout: a hologram barker. It cannot hurt anyone. While it shouts, every enemy within `range` moves 30% faster and shows a
-- small mark; one hit of any kind switches it off for good. Its shout is a ring that spreads (and a sound) every few seconds.
-- Numbers: data/enemies.lua.
local E = require("data.enemies").tout
local P = require("data.player")
local D = require("lib.draw")
local Status = require("lib.status")
local Foe = require("entities.foe")

local Tout = nova.entity(Foe, {
  sprite = "tout", anim = "idle_down", tags = { "hurtable", "enemy", "tout" },
  pivot = { 0.5, 0.875 }, hitbox = { -5, -5, 10, 5 }, tint = { 120, 255, 255 },
})

function Tout:create()
  self.E, self.kind_name = E, "tout"
  self:setup()
  self.state = "idle"     -- idle | shout | dead
  self.t = E.pulse_every - 1.0
  self.facing = "down"
  self.buffing = 0
end

-- Any hit switches it off.
function Tout:take_hit(damage, dx, dy, knock)
  if self.state == "dead" or damage <= 0 then return false end
  self.state = "dead"
  nova.log("tout switched off")
  nova.sound.play("tout_off", { volume = P.sfx.tout_off })
  nova.spawn("fx", self.x, self.y - 30, { sprite = "fx_spark", anim = "spark", scale = 5 })
  for _, e in ipairs(nova.all("enemy")) do
    if e ~= self and (e.buff_t or 0) > 0 and self:distance_to(e) <= E.range + 1 then e.buff_t = 0 end
  end
  self:destroy()
  return true
end

function Tout:update(dt)
  self.depth = -self.y
  if require("lib.juice").frozen() then return end
  self.t = self.t + dt
  self.flash = math.max(0, self.flash - dt)
  -- the buff: everything else within range moves faster for another moment
  local n = 0
  for _, e in ipairs(nova.all("enemy")) do
    if e ~= self and e.kind_name ~= "tout" and self:distance_to(e) <= E.range then Status.buff(e); n = n + 1 end
  end
  self.buffing = n

  local p = nova.first("player")
  if self.state == "idle" then
    if p and p.state ~= "dead" then
      local dx, dy = p.x - self.x, p.y - self.y
      local d = math.sqrt(dx * dx + dy * dy)
      self.facing = require("lib.combat").four_way(dx, dy, self.facing)
      if d < E.keep then self:move(-dx / math.max(d, 1) * E.speed * dt, -dy / math.max(d, 1) * E.speed * dt) end
    end
    if self.t >= E.pulse_every then
      self.state, self.t = "shout", 0
      nova.sound.play("tell_tout", { volume = P.sfx.tell_tout })
      nova.log("tout shouts")
    end
  elseif self.state == "shout" then
    if self.t >= E.pulse_tell then self.state, self.t = "idle", 0 end
  end

  local f = self.facing
  if self.state == "shout" then self:play("attack_" .. f) else self:play("idle_" .. f) end
  self.alpha = 0.78 + 0.12 * math.sin(self.t * 18)
end

-- The shout: a ring spreading to the buff's reach.
function Tout:draw()
  if self.state == "shout" then
    local k = self.t / E.pulse_tell
    D.ring(self.x, self.y, E.range * k, { 6, 240, 255, 200 * (1 - k) + 30 }, 5, 40)
  end
  nova.Entity.draw(self)
end

return Tout
