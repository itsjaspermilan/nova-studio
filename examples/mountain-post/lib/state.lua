-- What the slice remembers across its two scenes (the office and the valley are built again each time they are entered).
local state = {}

function state.reset()
  state.carrying = nil        -- the parcel in the postmaster's arms: "hazel", "pip" or nil (one at a time)
  state.van_load = {}         -- the parcels in the back of the van, in the order they went in (it holds both of the day's)
  state.on_shelf = { hazel = true, pip = true }
  state.delivered = { hazel = false, pip = false }
  state.slot = {}             -- the package counter's tile each parcel in the room lies on (1 is the leftmost): see state.settle
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

-- The day's parcels in the order they wait on the package counter (a later backlog is a longer list), and what there is room for.
state.WAITING = { "hazel", "pip" }
state.TILES = 10

-- Where the parcels in the room lie: a function of who is waiting (`on_shelf`, the parcels in the room, in WAITING's order). A parcel that
-- lies on a tile keeps it; taking one empties its tile; one put back (or newly arrived) takes the first free tile, so a backlog fills the
-- tiles in order. Returns the tiles as a list: tiles[i] is the parcel on tile i, or nil.
function state.settle()
  local tiles = {}
  for _, w in ipairs(state.WAITING) do
    local s = state.slot[w]
    if state.on_shelf[w] and s and not tiles[s] then tiles[s] = w else state.slot[w] = nil end
  end
  for _, w in ipairs(state.WAITING) do
    if state.on_shelf[w] and not state.slot[w] then
      for i = 1, state.TILES do
        if not tiles[i] then tiles[i], state.slot[w] = w, i; break end
      end
    end
  end
  return tiles
end

-- The tile a parcel lies on (nil: it is not in the room).
function state.tile_of(which)
  state.settle()
  return state.slot[which]
end

-- How many parcels are still to deliver: in the room, in the arms or in the van, none yet handed over (the picture frame's number).
function state.remaining()
  local n = 0
  for _, w in ipairs(state.WAITING) do
    if not state.delivered[w] then n = n + 1 end
  end
  return n
end

-- Both parcels are with their people.
function state.all_delivered() return state.delivered.hazel and state.delivered.pip end

return state
