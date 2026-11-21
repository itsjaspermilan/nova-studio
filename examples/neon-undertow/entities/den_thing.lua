-- A fixture of the Den: the print bed, LULLABY's cracked screen, the Workbench, the door that starts a run, and the stalls (a name plate and,
-- once someone moved in, the stranger standing at it). Props: thing ("bed", "screen", "bench", "door", "stall"), who (a stall's stranger).
-- Sizes are data/den.lua's `sizes`; the pictures are only stretched to them (sprites/den_*). The scene (scenes/den.lua) uses them.
local Dd = require("data.den")
local Meta = require("lib.meta")
local Strangers = require("data.strangers")

local SPRITE = { bed = "den_bed", screen = "den_screen", bench = "den_bench", door = "den_door", stall = "den_stall" }

local Thing = nova.entity { tags = { "den_thing", "solid" }, velocity = false, sx = 1, sy = 1, thing = "bed", who = "", t = 0 }

function Thing:create()
  local s = Dd.sizes[self.thing]
  self.w, self.h = s.w, s.h
  -- (every fixture is tagged solid; one that can be walked over, the bed and the door, has an empty hitbox: tags cannot change)
  self.hitbox = s.solid and { -self.w / 2, -self.h * 0.35, self.w, self.h * 0.35 } or { 0, 0, 0, 0 }
  self.depth = -self.y
end

function Thing:lives_here() return self.thing == "stall" and Meta.moved_in[self.who] == true end

function Thing:update(dt) self.t = self.t + dt end

function Thing:draw()
  local x, y = nova.cam.to_screen(self.x, self.y)
  local name = SPRITE[self.thing]
  local frame = 0
  if self.thing == "screen" then frame = (math.floor(self.t * 3) % 11 == 0) and 1 or 0 end
  if self.thing == "stall" then frame = self:lives_here() and 1 or 0 end
  nova.sprite(name, x, y - self.h / 2, { w = self.w, h = self.h, frame = frame })
  if self.thing == "door" then
    nova.sprite("solid", x, y - self.h / 2, { w = self.w * 0.5, h = self.h * 0.75, color = { 6, 240, 255, 40 + 30 * math.sin(self.t * 4) } })
  end
  if self:lives_here() then
    local S = Strangers[self.who]
    nova.sprite(S.sprite, x, y - 48, { w = 96, h = 96, frame = 0 })
  end
end

return Thing
