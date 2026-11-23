-- The parcels on the go, for the one card in the top-left corner (the owner, after the second play: "Instead of listing all the
-- active packages in the top left, the user should be able to scroll through them with LB/RB assuming they're not in the van
-- storage menu."). Active means carried or in the van: the ones on the shelf are not on the go yet, and the shelf shows them. The
-- card shows one at a time, the carried one first; L1 and R1 go round them anywhere but in a conversation, over a card, or at the
-- van's open back, where L1 and R1 belong to the van's panel.
local state = require("lib.state")
local ui = require("lib.ui")

local parcels = {}
local shown -- the parcel the card shows ("hazel", "pip"), kept while it stays active

-- The active parcels in order (carried, then the van's in the order they went in), each { which, where = "hands" | "van" }.
function parcels.active()
  local list = {}
  if state.carrying then list[#list + 1] = { which = state.carrying, where = "hands" } end
  for _, w in ipairs(state.van_load) do list[#list + 1] = { which = w, where = "van" } end
  return list
end

-- The one the card shows now, its place in the list and the list's length (nil when there is none).
function parcels.current()
  local list = parcels.active()
  if #list == 0 then shown = nil; return nil, 0, 0 end
  for i, p in ipairs(list) do
    if p.which == shown then return p, i, #list end
  end
  -- what it showed has gone (handed over): show the first, the one in the arms if there is one
  shown = list[1].which
  return list[1], 1, #list
end

-- A parcel just taken into the arms comes to the front of the card.
function parcels.show(which) shown = which end

-- L1 and R1: once a frame while the card is the one listening.
function parcels.update()
  local p, i, n = parcels.current()
  if not p or n < 2 then return end
  local step = (nova.input.pressed("next") and 1 or 0) - (nova.input.pressed("prev") and 1 or 0)
  if step ~= 0 then
    local list = parcels.active()
    shown = list[(i - 1 + step) % n + 1].which
    nova.sound.play("tick", { volume = 0.3, pitch = step > 0 and 1.06 or 0.94 })
    nova.log("card " .. shown)
  end
end

-- The card; `dim` when the van's panel has L1 and R1.
function parcels.draw(dim)
  local p, i, n = parcels.current()
  if p then ui.parcel_card(p.which, p.where, i, n, { dim = dim }) end
end

return parcels
