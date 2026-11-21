-- The base the new enemies share: health, the hit flash, a mover that stops at solid things, status effects (stun, burn,
-- shot marks, a Tout's buff), the death with its scrap, and the little bar over the head. An enemy file says
-- `nova.entity(Foe, { ... })`, sets `self.E` (its row in data/enemies.lua) and `self.kind_name` in create, calls `self:setup()`, and
-- starts its update with `if self:tick(dt) then return end`.
local P = require("data.player")
local J = require("lib.juice")
local Status = require("lib.status")

local Foe = nova.entity { tags = { "hurtable", "enemy" }, velocity = false, sx = 3, sy = 3 }

function Foe:setup()
  self.hp = self.E.health
  self.max_hp = self.E.health
  self.t = 0
  self.flash = 0
  self.kx, self.ky = 0, 0
  self.depth = -self.y
end

function Foe:hips() return self.x, self.y - (self.E.hips or 14) end

-- Moves, stopping at solid tiles and solid things. Returns true when something stopped it.
function Foe:move(dx, dy)
  local x, y = self.x, self.y
  local bx, by = self:slide(dx, 0)
  local hit = bx
  if self:touching("solid") then self.x = x; hit = true end
  local _, by2 = self:slide(0, dy)
  if by2 then hit = true end
  if self:touching("solid") then self.y = y; hit = true end
  if math.abs(self.x - x) + math.abs(self.y - y) > math.abs(dx) + math.abs(dy) + 4 then self.x, self.y = x, y; hit = true end   -- (never a leap: see Scrapper:move)
  return hit
end

-- Frozen by a hit-stop? Counts the timers, applies status. True means: do nothing else this frame.
function Foe:tick(dt)
  self.depth = -self.y
  if J.frozen(self) then return true end
  self.t = self.t + dt
  self.flash = math.max(0, self.flash - dt)
  return Status.tick(self, dt)
end

function Foe:take_hit(damage, dx, dy, knock)
  if self.state == "dead" then return false end
  self.hp = self.hp - damage
  self.flash = 0.12
  nova.log(string.format("%s takes %d (health %d)", self.kind_name, damage, math.max(0, self.hp)))
  if self.hp <= 0 then self:die(); return true end
  if self.on_hit then self:on_hit(damage, dx, dy, knock) end
  return true
end

function Foe:die()
  self.state = "dead"
  require("lib.hits").on_death(self)
  nova.log(self.kind_name .. " dies")
  nova.sound.play("enemy_die", { volume = P.sfx.enemy_die, limit = 2 })
  nova.spawn("fx", self.x, self.y - 30, { sprite = "fx_burst", anim = "burst", scale = 4 })
  local n = self.E.drops or 0
  for i = 1, n do
    local a = (i / math.max(n, 1)) * math.pi * 2 + 0.5
    nova.spawn("scrap", self.x, self.y - 6, { pvx = math.cos(a) * 190, pvy = math.sin(a) * 140 })
  end
  self:destroy()
end

function Foe:bar_y() return self.y - 82 end

function Foe:hud()
  if self.state == "dead" then return end
  local x, y = nova.cam.to_screen(self.x, self:bar_y())
  if self.hp < self.max_hp then
    nova.ui.rect(x - 20, y, 40, 5, { 5, 6, 15, 220 })
    nova.ui.rect(x - 19, y + 1, 38 * math.max(0, self.hp) / self.max_hp, 3, { 255, 43, 214, 255 })
  end
  Status.hud(self, x, y - 14)
end

return Foe
