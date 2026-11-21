-- A fixture of the Den: the print bed, LULLABY's cracked screen, the Workbench, the door that starts a run, and the stalls (a name plate and,
-- once someone moved in, the stranger standing at it). Props: thing ("bed", "screen", "bench", "door", "stall"), who (a stall's stranger).
-- Sizes are data/den.lua's `sizes`; the pictures are only stretched to them (sprites/den_*). The scene (scenes/den.lua) uses them.
local Dd = require("data.den")
local Meta = require("lib.meta")
local Strangers = require("data.strangers")
local Art = require("data.art")
local Look = require("data.look")
local LK = require("lib.look")

local SPRITE = { bed = "den_bed", screen = "den_screen", bench = "den_bench", codex = "den_screen", door = "den_door", stall = "den_stall" }

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
  if self.thing == "stall" then
    -- the tileset's stall, three tiles wide: lit and lived in, or dark and shut
    local lived = self:lives_here()
    local shade = lived and { 255, 255, 255 } or { 95, 95, 120 }
    for i = 0, 2 do
      local cx, k = x + (i - 1) * 48, i % 2 + 1
      nova.sprite(Art.tiles, cx, y - 24, { w = 48, h = 48, frame = Art.stall.base[k], color = shade })
      nova.sprite(Art.tiles, cx, y - 72, { w = 48, h = 48, frame = Art.stall.awning[k], color = shade })
    end
    if lived then nova.light2d(self.x, self.y - 40, { radius = 190, radius_y = 120, color = Look.accent.warm, intensity = 1.9 }) end
  else
    nova.sprite(name, x, y - self.h / 2, { w = self.w, h = self.h, frame = frame, color = self.thing == "codex" and { 255, 200, 120 } or nil })
  end
  if self.thing == "door" then
    LK.halo(self.x, self.y - self.h / 2, self.h * 0.5, Look.accent.cyan, 70 + 40 * math.sin(self.t * 4))
    nova.light2d(self.x - 40, self.y - 60, { radius = 160, radius_y = 120, color = Look.accent.cyan, intensity = 1.8 })
  elseif self.thing == "screen" then
    nova.light2d(self.x, self.y - 40, { radius = 190, radius_y = 130, color = frame == 1 and Look.accent.magenta or Look.accent.cyan, intensity = 1.9, flicker = 0.2 })
  elseif self.thing == "bench" then
    nova.light2d(self.x - 30, self.y - 40, { radius = 170, radius_y = 120, color = Look.accent.cyan, intensity = 1.7 })
  elseif self.thing == "bed" then
    nova.light2d(self.x, self.y - 20, { radius = 170, radius_y = 110, color = Look.accent.cyan, intensity = 1.4 })
  elseif self.thing == "codex" then
    nova.light2d(self.x, self.y - 40, { radius = 120, radius_y = 90, color = Look.accent.warm, intensity = 1.5 })
  end
  if self:lives_here() then
    local S = Strangers[self.who]
    nova.sprite(S.sprite, x, y - 70, { w = 144, h = 144, frame = 0 })
  end
end

return Thing
