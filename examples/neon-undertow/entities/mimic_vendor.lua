-- The Mimic Vendor: a vending machine that is not. It does nothing until the runner comes within `wake`, then flickers for
-- `tell` seconds (its own sound; the three lanes the cans will take are drawn on the ground), opens its mouth and spits three
-- cans. It cannot move. Shots and the baton hurt it at any time. Numbers: data/enemies.lua.
local E = require("data.enemies").mimic_vendor
local P = require("data.player")
local D = require("lib.draw")
local Foe = require("entities.foe")

local Mimic = nova.entity(Foe, {
  sprite = "mimic_vendor", anim = "idle", tags = { "hurtable", "enemy", "solid", "mimic_vendor" },
  pivot = { 0.5, 0.9 }, hitbox = { -9, -6, 18, 6 },
})

function Mimic:create()
  self.E, self.kind_name = E, "mimic_vendor"
  self:setup()
  self.state = "shut"      -- shut | flicker | spit | recover | dead
  self.volleys = 0
  self.base = 0
end

function Mimic:hips() return self.x, self.y - E.hips end

function Mimic:on_stun() if self.state == "flicker" then self.state, self.t = "recover", 0 end end

function Mimic:spit()
  local hx, hy = self:hips()
  for _, off in ipairs(E.cans.fan) do
    local a = self.base + off
    nova.spawn("can", hx, hy + 10, { dx = math.cos(a), dy = math.sin(a), owner = self })
  end
  self.volleys = self.volleys + 1
  nova.sound.play("can_spit", { volume = P.sfx.can_spit })
  nova.log("mimic_vendor spits")
end

function Mimic:update(dt)
  if self:tick(dt) then return end
  local p = nova.first("player")
  local dist = 1e9
  if p and p.state ~= "dead" then dist = self:distance_to(p) end
  local s = self.state

  if s == "shut" then
    if dist < E.wake then
      self.state, self.t = "flicker", 0
      local hx, hy = self:hips()
      self.base = math.atan(p.y - 14 - hy, p.x - hx)       -- the lanes are chosen now: the runner can step out of them
      nova.sound.play("tell_mimic", { volume = P.sfx.tell_mimic })
      nova.log(string.format("mimic_vendor tell at %.0f", dist))
    end
  elseif s == "flicker" then
    if self.t >= E.tell then self.state, self.t = "spit", 0; self:spit() end
  elseif s == "spit" then
    if self.t >= E.open_time then self.state, self.t = "recover", 0 end
  elseif s == "recover" then
    if self.t >= E.recover then
      self.t = 0
      self.state = "shut"       -- (and if the runner is still near, the next check starts another flicker at once)
    end
  end

  if self.flash > 0 then self:play("hit")
  elseif self.state == "flicker" then self:play("flicker")
  elseif self.state == "spit" then self:play("open")
  else self:play("idle") end
  if self.state == "flicker" then self.tint = (math.floor(self.t * 16) % 2 == 0) and { 255, 170, 240 } or { 255, 255, 255 } else self.tint = nil end
end

-- The lanes the cans will fly along, drawn while it flickers.
function Mimic:draw()
  if self.state == "flicker" then
    local hx, hy = self:hips()
    local a = 40 + 50 * (math.floor(self.t * 12) % 2)
    for _, off in ipairs(E.cans.fan) do
      local ang = self.base + off
      D.lane(hx, hy + 10, hx + math.cos(ang) * E.cans.range, hy + 10 + math.sin(ang) * E.cans.range, 14, { 255, 43, 214, a })
    end
  end
  nova.Entity.draw(self)
end

return Mimic
