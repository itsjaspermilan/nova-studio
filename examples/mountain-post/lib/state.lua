-- What the slice remembers across its two scenes (the office and the valley are built again each time they are entered).
local state = {}

function state.reset()
  state.carrying = nil        -- the parcel in the postmaster's arms: "hazel", "pip" or nil (one at a time)
  state.in_van = nil          -- the parcel in the back of the van, while it is there
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

-- Both parcels are with their people.
function state.all_delivered() return state.delivered.hazel and state.delivered.pip end

return state
