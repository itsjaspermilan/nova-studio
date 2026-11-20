-- The Scrapper: a gang kid with a pipe. Walks up, winds up with a visible tell (a pulsing magenta strike zone on the
-- ground, a flash and a sound, `tell` seconds), swings for 2, then catches its breath. 8 health; dies with a burst and
-- drops scrap. Numbers: data/enemies.lua.
local E = require("data.enemies").scrapper
local P = require("data.player")
local J = require("lib.juice")
local C = require("lib.combat")

local Scrapper = nova.entity {
  sprite = "scrapper", anim = "idle_down", tags = { "hurtable", "enemy", "scrapper" },
  pivot = { 0.5, 0.875 }, hitbox = { -5, -5, 10, 5 }, sx = 3, sy = 3, velocity = false,
}

function Scrapper:create()
  self.hp = E.health
  self.state = "idle"      -- idle | walk | tell | swing | recover | stagger | dead
  self.t = 0
  self.facing = "down"
  self.flash = 0
  self.kx, self.ky = 0, 0
  self.swings = 0
  self.depth = -self.y
end

function Scrapper:hips() return self.x, self.y - E.hips end

function Scrapper:move(dx, dy)
  local x, y = self.x, self.y
  self:slide(dx, 0)
  if self:touching("solid") then self.x = x end
  self:slide(0, dy)
  if self:touching("solid") then self.y = y end
end

function Scrapper:take_hit(damage, dx, dy, knock)
  if self.state == "dead" then return false end
  self.hp = self.hp - damage
  self.flash = 0.12
  nova.log(string.format("scrapper takes %d (health %d)", damage, math.max(0, self.hp)))
  if self.hp <= 0 then self:die(); return true end
  -- the wind-up and the swing are armoured against light hits; a knock-back (the third hit) breaks them
  if knock and knock > 0 then
    self.kx, self.ky = dx * knock, dy * knock
    self.state, self.t = "stagger", 0
  end
  return true
end

function Scrapper:die()
  self.state = "dead"
  nova.log("scrapper dies")
  nova.sound.play("enemy_die", { volume = P.sfx.enemy_die })
  nova.spawn("fx", self.x, self.y - 30, { sprite = "fx_burst", anim = "burst", scale = 4 })
  for i = 1, E.drops do
    local a = (i / E.drops) * math.pi * 2 + 0.5
    nova.spawn("scrap", self.x, self.y - 6, { pvx = math.cos(a) * 190, pvy = math.sin(a) * 140 })
  end
  self:destroy()
end

function Scrapper:swing()
  local hx, hy = self:hips()
  nova.spawn("enemy_swing", hx, hy, { owner = self, dir = self.facing, damage = E.damage, area = E.area })
  self.swings = self.swings + 1
end

function Scrapper:update(dt)
  self.depth = -self.y
  if J.frozen() then return end
  self.t = self.t + dt
  self.flash = math.max(0, self.flash - dt)
  local p = nova.first("player")
  local dx, dy, dist = 0, 0, 1e9
  if p then dx, dy = p.x - self.x, p.y - self.y; dist = math.sqrt(dx * dx + dy * dy) end
  local s = self.state

  if s == "idle" then
    if p and p.state ~= "dead" and dist < E.aggro then self.state = "walk" end
  elseif s == "walk" then
    if not p or p.state == "dead" then self.state = "idle"
    else
      self.facing = C.four_way(dx, dy, self.facing)
      -- close in until the runner is inside the strike zone (along the way it faces), then wind up
      local v = C.vec[self.facing]
      local ahead = dx * v[1] + dy * v[2]           -- how far in front
      local aside = math.abs(dx * v[2] - dy * v[1]) -- how far off to the side
      if ahead < E.attack_range and aside < E.area.half_width * 0.8 then
        self.state, self.t = "tell", 0
        nova.sound.play("enemy_tell", { volume = P.sfx.enemy_tell })
        nova.log("scrapper tell")
      else
        local len = math.max(dist, 1)
        self:move(dx / len * E.speed * dt, dy / len * E.speed * dt)
      end
    end
  elseif s == "tell" then
    if self.t >= E.tell then
      self.state, self.t = "swing", 0
      nova.log("scrapper swing")
      self:swing()
    end
  elseif s == "swing" then
    if self.t >= E.swing_frames / 60 then self.state, self.t = "recover", 0 end
  elseif s == "recover" then
    if self.t >= E.recover then self.state, self.t = "walk", 0 end
  elseif s == "stagger" then
    self:move(self.kx * dt, self.ky * dt)
    local k = math.max(0, 1 - 7 * dt)
    self.kx, self.ky = self.kx * k, self.ky * k
    if self.t >= E.stagger then self.state, self.t = "walk", 0 end
  end

  -- look
  local f = self.facing
  if self.flash > 0 then self:play("hurt_" .. f)
  elseif self.state == "walk" then self:play("walk_" .. f)
  elseif self.state == "tell" then self:play("attack_" .. f)
  else self:play("idle_" .. f) end
  if self.state == "tell" then
    -- the tell: it brightens and shakes
    self.tint = (math.floor(self.t * 14) % 2 == 0) and { 255, 150, 235 } or { 255, 255, 255 }
    self.x = self.x + ((math.floor(self.t * 30) % 2 == 0) and 0.6 or -0.6)
  else
    self.tint = nil
  end
end

-- The strike zone drawn on the ground while it winds up (the same box the swing will use).
function Scrapper:draw()
  if self.state == "tell" then
    local hx, hy = self:hips()
    local b = C.box(self.facing, E.area)
    local x, y = nova.cam.to_screen(hx + b[1] * 3, hy + b[2] * 3)
    local a = 60 + 90 * (math.floor(self.t * 12) % 2)
    nova.rect(x, y, b[3] * 3, b[4] * 3, { 255, 43, 214, a })
  end
  nova.Entity.draw(self)
end

function Scrapper:hud()
  if self.state == "dead" then return end
  local x, y = nova.cam.to_screen(self.x, self.y - 82)
  nova.ui.rect(x - 20, y, 40, 5, { 5, 6, 15, 220 })
  nova.ui.rect(x - 19, y + 1, 38 * math.max(0, self.hp) / E.health, 3, { 255, 43, 214, 255 })
end

return Scrapper
