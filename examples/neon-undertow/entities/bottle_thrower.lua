-- The Bottle Thrower: keeps its distance (backs off when the runner is near, closes in when far), raises an arm for `tell`
-- seconds (orange flash, its own sound), then lobs a bottle at where the runner stood. The landing spot is marked on the ground
-- while the bottle flies; it leaves fire that hurts anyone. Numbers: data/enemies.lua.
local E = require("data.enemies").bottle_thrower
local P = require("data.player")
local C = require("lib.combat")
local Status = require("lib.status")
local Foe = require("entities.foe")
local Target = require("lib.target")
local Look = require("data.look")
local LK = require("lib.look")

local Thrower = nova.entity(Foe, {
  sprite = "bottle_thrower", anim = "idle_down", tags = { "hurtable", "enemy", "bottle_thrower" },
  pivot = { 0.5, 0.906 }, hitbox = { -6, -10, 12, 10 },
})

function Thrower:create()
  self.E, self.kind_name = E, "bottle_thrower"
  self:setup()
  self.state = "idle"        -- idle | keep | tell | recover | stagger | dead
  self.facing = "down"
  self.throws = 0
end

function Thrower:on_hit(damage, dx, dy, knock)
  if knock and knock > 0 then
    self.kx, self.ky = dx * knock, dy * knock
    self.state, self.t = "stagger", 0
  end
end

function Thrower:on_stun()
  if self.state == "tell" or self.state == "keep" then self.state, self.t = "stagger", 0 end
end

function Thrower:throw()
  local p = Target.of(self)
  local hx, hy = self:hips()
  local tx, ty = hx + C.vec[self.facing][1] * 200, self.y
  if p then
    tx, ty = p.x, p.y
    local d = math.sqrt((tx - self.x) ^ 2 + (ty - self.y) ^ 2)
    if d > E.lob.range then tx, ty = self.x + (tx - self.x) / d * E.lob.range, self.y + (ty - self.y) / d * E.lob.range end
  end
  nova.spawn("bottle", hx, hy, { sx0 = hx, sy0 = hy, tx = tx, ty = ty, time = E.lob.time, height = E.lob.height })
  nova.sound.play("throw", { volume = P.sfx.throw, vary = 0.05 })
  self.throws = self.throws + 1
  nova.log(string.format("bottle thrown at %.0f,%.0f", tx, ty))
end

function Thrower:update(dt)
  if self:tick(dt) then return end
  local p = Target.of(self)
  local dx, dy, dist = 0, 0, 1e9
  if p then dx, dy = p.x - self.x, p.y - self.y; dist = math.sqrt(dx * dx + dy * dy) end
  local alive = p and p.state ~= "dead"
  local s = self.state
  local sp = E.speed * Status.speed(self)

  if s == "idle" then
    if alive and dist < E.aggro then self.state = "keep" end
  elseif s == "keep" then
    if not alive then self.state = "idle"
    else
      self.facing = C.four_way(dx, dy, self.facing)
      local len = math.max(dist, 1)
      if dist < E.keep_min then
        -- back away; if a wall stops it, slide along the wall
        if self:move(-dx / len * sp * dt, -dy / len * sp * dt) then self:move(0, (dy >= 0 and -1 or 1) * sp * dt) end
      elseif dist > E.keep_max then
        self:move(dx / len * sp * dt, dy / len * sp * dt)
      else
        self.state, self.t = "tell", 0
        nova.sound.play("tell_thrower", { volume = P.sfx.tell_thrower })
        nova.log("bottle_thrower tell")
      end
    end
  elseif s == "tell" then
    if alive then self.facing = C.four_way(dx, dy, self.facing) end
    if self.t >= E.tell then
      self:throw()
      self.state, self.t = "recover", 0
    end
  elseif s == "recover" then
    if self.t >= E.recover then self.state, self.t = "keep", 0 end
  elseif s == "stagger" then
    self:move(self.kx * dt, self.ky * dt)
    local k = math.max(0, 1 - 7 * dt)
    self.kx, self.ky = self.kx * k, self.ky * k
    if self.t >= E.stagger then self.state, self.t = "keep", 0 end
  end

  local f = self.facing
  if self.flash > 0 then self:play("hurt_" .. f)
  elseif self.state == "keep" and dist < E.keep_min then self:play("walk_" .. f)
  elseif self.state == "keep" and dist > E.keep_max then self:play("walk_" .. f)
  elseif self.state == "tell" then self:play("tell_" .. f)       -- (wound up, the arm cocked, flashing)
  elseif self.state == "recover" and self.t < 0.4 then self:play("attack_" .. f)   -- (the throw)
  else self:play("idle_" .. f) end
  if self.state == "tell" then
    self.x = self.x + ((math.floor(self.t * 30) % 2 == 0) and 0.6 or -0.6)
    self.light = Look.tell
  else
    self.light = Look.enemy
  end
end

function Thrower:draw()
  nova.Entity.draw(self)
  if self.state == "tell" then LK.halo(self.x, self.y - 44, 72, Look.tell_halo, 120 + 90 * (math.floor(self.t * 14) % 2)) end
end

return Thrower
