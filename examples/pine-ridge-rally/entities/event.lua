-- An event in free roam: drive up to it and press Y to see what it is, then start it. `course` is the course's id (a circuit or a
-- stage, as in lib/state.lua), `mode` "race", "trial" or "rally"; `ry` the way the start faces. The marker is a ring of light on the
-- ground and a checkered flag; scenes/roam.lua finds the events by the tag.
local Event = nova.entity { tags = { "event" }, mode = "race" }

local FLAG = { ry = 0, shadow = false, scale = 1.6 }
local RING = { color = { 255, 140, 60, 120 }, round = true }

function Event:draw()
  local t = nova.time()
  FLAG.ry = (self.ry or 0) + math.pi / 2
  nova.model("flag_checkers", self.x, 0, self.z, FLAG)
  -- a soft orange disc on the ground that breathes, and a column of glow above it
  RING.color[4] = math.floor(90 + 50 * math.sin(t * 3))
  nova.quad3(self.x, 0.06, self.z, 0, 1, 0, 9, RING)
  for h = 1, 5 do nova.billboard("puff", self.x, h * 1.6, self.z, 2.4 - h * 0.25, { color = { 255, 150, 70, 60 - h * 8 } }) end
end

return Event
