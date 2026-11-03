-- What the game remembers while it runs: the hearts, the room, the key, the clock, and the best time (saved between runs).
local state = {}

state.rooms = { "room1", "room2", "room3" }
state.max_hearts = 5
state.autopilot = false -- F9: the computer plays (for tests and demos); it stays on from room to room

function state.new_game()
  state.hearts = 3
  state.room = 1
  state.time = 0
  state.slain = 0
end

function state.new_room()
  state.has_key = false
end

function state.best() return nova.save.get("best_time", nil) end

-- Called when the last door is opened: keeps the time if it is a record.
function state.finish()
  local best = state.best()
  local record = best == nil or state.time < best
  if record then nova.save.set("best_time", state.time) end
  return record
end

function state.format_time(t)
  if not t then return "--:--.-" end
  return string.format("%d:%04.1f", math.floor(t / 60), t % 60)
end

state.new_game()
return state
