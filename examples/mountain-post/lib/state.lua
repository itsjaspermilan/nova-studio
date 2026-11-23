-- What the slice remembers across its two scenes (the office and the valley are built again each time they are entered).
local state = {}

function state.reset()
  state.carrying = nil        -- the parcel in the postmaster's arms: "hazel", "pip" or nil (one at a time)
  state.van_load = {}         -- the parcels in the back of the van, in the order they went in (it holds both of the day's)
  state.on_shelf = { hazel = true, pip = true }
  state.delivered = { hazel = false, pip = false }
  state.after = { hazel = 0, pip = 0 } -- which "after that" line each says next
  state.letter_read = false
  state.ended = false         -- the end card has been shown
  state.van = nil             -- where the van was left: { x, z, heading }; nil is its place outside the post office
  state.came_out = false      -- the postmaster has been outside (the valley starts on the porch, not at the office door)
  state.steps = 0             -- a count of things done, for the log and the tests
end
state.reset()

-- The van holds this many parcels (the owner, sixth play: "The maximum capacity for the truck storage should be 4 parcels for now.
-- We'll work on upgrades later."): an upgrade will raise it. The postmaster still carries one at a time.
state.VAN_HOLDS = 4

-- Is this parcel in the van? Takes it out (true) when asked to.
function state.in_van(which, take)
  for i, p in ipairs(state.van_load) do
    if p == which then
      if take then table.remove(state.van_load, i) end
      return true
    end
  end
  return false
end

-- Both parcels are with their people.
function state.all_delivered() return state.delivered.hazel and state.delivered.pip end

return state
