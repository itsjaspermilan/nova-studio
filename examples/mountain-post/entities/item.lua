-- Something on the office's shelf of today's post: the letter for the postmaster, or a parcel for a resident (`item`: "letter",
-- "hazel" or "pip"). It is drawn only while it is on the shelf (lib/state.lua remembers what has been taken).
local state = require("lib.state")

local Item = nova.entity { tags = { "item" } }

local MODELS = { letter = "letter", hazel = "parcel_hazel", pip = "parcel_pip" }

function Item:create()
  self.model_id = MODELS[self.item] or "letter"
  self.opts = { ry = self.ry or 0 }
end

-- On the shelf now? (the letter always is: it is read where it lies)
function Item:here()
  if self.item == "letter" then return true end
  return state.on_shelf[self.item] == true
end

function Item:draw()
  if self:here() then nova.model(self.model_id, self.x, self.y, self.z, self.opts) end
end

return Item
