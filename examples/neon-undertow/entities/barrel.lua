-- An explosive barrel: solid cover. Any hit (baton, shot, fire, a blast) lights a fuse; `fuse` seconds later it blasts everyone within
-- `radius` (the runner, enemies, stalls, other barrels, which then light their own). Numbers: data/hazards.lua.
local H = require("data.hazards").barrel
local J = require("lib.juice")
local T = require("lib.tell")
local P = require("data.player")
local Blast = require("lib.blast")
local Run = require("lib.run")
local Cards = require("data.cards")

local Art = require("data.art")
local LK = require("lib.look")
local Look = require("data.look")

local Barrel = nova.entity { tags = { "hurtable", "solid", "prop", "barrel" }, velocity = false, sx = 1, sy = 1, t = 0, state = "idle" }

function Barrel:create()
  self.light = nil
  self.hitbox = { -H.w / 2, -H.h, H.w, H.h }      -- (units: sx is 1; the picture is stretched to this box in draw)
  self.depth = -self.y
  self.prop = true
end

function Barrel:take_hit(damage, dx, dy, knock)
  if self.state ~= "idle" or damage <= 0 then return false end
  self.state, self.t = "fuse", 0
  nova.sound.play("fire_start", { volume = P.sfx.fire_start })
  nova.log("barrel fuse lit")
  return true
end

function Barrel:update(dt)
  self.depth = -self.y
  if J.frozen() then return end
  if self.state == "fuse" then
    self.t = self.t + dt
    if self.t >= H.fuse then
      self.state = "dead"
      local x, y = self.x, self.y
      self:destroy()
      if Run.mods.wiring > 0 then
        -- Bad Wiring: twice as wide, and it does not hurt the runner
        Blast.at(x, y, { radius = H.radius * Cards.num.wiring.reach, runner = 0, enemy = H.enemy, prop = H.prop }, self)
      else
        Blast.at(x, y, H, self)
      end
    end
  end
end

function Barrel:draw()
  if self.state == "fuse" then
    local r = H.radius * (Run.mods.wiring > 0 and Cards.num.wiring.reach or 1)
    T.disc(self.x, self.y, r, self.t / H.fuse, self.t, T.orange)
  end
  if self.state == "fuse" then nova.light2d(self.x, self.y - 24, { radius = Look.fuse.radius, color = Look.fuse.color, intensity = Look.fuse.intensity * (math.floor(self.t * 12) % 2 == 0 and 1 or 0.55) }) end
  local x, y = nova.cam.to_screen(self.x, self.y)
  local lit = self.state == "fuse" and math.floor(self.t * 12) % 2 == 0
  nova.sprite(Art.tiles, x, y - 26, { w = 60, h = 60, frame = Art.barrel, color = lit and { 255, 230, 200 } or { 255, 255, 255 } })
  if self.state == "fuse" then LK.halo(self.x, self.y - 24, 70, { 255, 138, 43 }, lit and 190 or 90) end
end

return Barrel
