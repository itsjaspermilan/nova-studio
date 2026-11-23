-- Something on the office's counters: the letter for the postmaster, or a parcel for a resident (`item`: "letter", "hazel" or "pip").
-- A parcel lies on its tile of the package counter (lib/state.lua says which: taking it empties the tile, putting it back fills the first
-- free one) and is drawn only while it is in the room; the letter is read where it lies, on the front counter's desk mat.
local state = require("lib.state")

local Item = nova.entity { tags = { "item" } }

local MODELS = { letter = "letter", hazel = "parcel_hazel", pip = "parcel_pip" }

function Item:create()
  self.model_id = MODELS[self.item] or "letter"
  self.opts = { ry = self.ry or 0 }
  self:place()
end

-- Moves a parcel to where its tile is (the tiles are objects of the scene, "tile_1" ...).
function Item:place()
  if self.item == "letter" then return end
  local slot = state.tile_of(self.item)
  local t = slot and nova.named("tile_" .. slot)
  if t then self.x, self.y, self.z = t.x, t.y, t.z end
end

-- In the room now? (the letter always is: it is read where it lies)
function Item:here()
  if self.item == "letter" then return true end
  return state.on_shelf[self.item] == true
end

function Item:update() self:place() end

-- The one about to be picked up (the nearest takeable parcel, or the letter: scenes/office.lua sets `pick`) gets a clean white outline,
-- a few pixels wide on the screen (nova.model's `outline`).
local OUTLINE = { color = { 255, 255, 255 }, width = 2.5 }
function Item:draw()
  if not self:here() then return end
  local sc = nova.scene_now()
  self.opts.outline = (sc and sc.pick == self) and OUTLINE or nil
  nova.model(self.model_id, self.x, self.y, self.z, self.opts)
end

return Item
