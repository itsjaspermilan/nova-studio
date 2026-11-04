-- The level: a map drawn in text, three metres to a character, built into walls (for bodies and rays), boxes (to see) and the
-- things that live in it.
--   #  wall      .  floor      P  player start     L  ceiling lamp
--   D  door      R  red door (needs the key)       K  the key         E  the exit
--   d  drone     g  guard      b  brute            X  the boss
--   H  health    A  ammunition S  the shotgun
local fx = require("lib.fx")

local Level = { CELL = 3, HEIGHT = 3.2 }
local CELL, HEIGHT = Level.CELL, Level.HEIGHT

local MAP = {
  "#########################",
  "#...L..#.......#L......K#",
  "#P.....D...d...D........#",
  "#...H..#.......#...g....#",
  "#......#...L...#........#",
  "####D###.......#####D####",
  "#......#.......#........#",
  "#.A..L.#...b...#...d....#",
  "#......D.......D........#",
  "#S..g..#.......#...A....#",
  "###########R#############",
  "####.................####",
  "####.................####",
  "####..L.....X.....L..####",
  "####.................####",
  "####........E........####",
  "#########################",
}

for i, row in ipairs(MAP) do
  assert(#row == #MAP[1], "map row " .. i .. " is " .. #row .. " wide, not " .. #MAP[1])
end

Level.W, Level.H = #MAP[1], #MAP
Level.width, Level.depth = Level.W * CELL, Level.H * CELL

local function at(r, c)
  local row = MAP[r + 1]
  return row and row:sub(c + 1, c + 1) or "#"
end

local function centre(r, c) return (c + 0.5) * CELL, (r + 0.5) * CELL end

local boxes, lamps = {}, {}

-- Builds the walls and the boxes that show them, and returns what has to be spawned.
function Level.build()
  nova.walls.clear()
  boxes, lamps = {}, {}
  local spawns = {}
  -- walls: runs of wall cells along each row become one box
  for r = 0, Level.H - 1 do
    local c = 0
    while c < Level.W do
      if at(r, c) == "#" then
        local start = c
        while c < Level.W and at(r, c) == "#" do c = c + 1 end
        local x0, z0, x1, z1 = start * CELL, r * CELL, c * CELL, (r + 1) * CELL
        nova.walls.add(x0, z0, x1, z1, 0, HEIGHT)
        local shade = ((start * 7 + r * 13) % 5) * 3
        local arena = r >= 10
        boxes[#boxes + 1] = { x0, 0, z0, x1, HEIGHT, z1, arena and { 96 + shade, 62, 64 } or { 68 + shade, 76 + shade, 92 } }
      else
        c = c + 1
      end
    end
  end
  for r = 0, Level.H - 1 do
    for c = 0, Level.W - 1 do
      local ch = at(r, c)
      local x, z = centre(r, c)
      if ch == "P" then spawns[#spawns + 1] = { "player", x, z }
      elseif ch == "L" then lamps[#lamps + 1] = { x, z, r >= 10 and { 255, 90, 70 } or { 255, 232, 190 } }
      elseif ch == "D" or ch == "R" then
        -- the corridor runs across the door: walls above and below mean it runs east-west
        local ew = at(r - 1, c) == "#" and at(r + 1, c) == "#"
        spawns[#spawns + 1] = { "door", x, z, { ew = ew, locked = ch == "R" } }
      elseif ch == "d" then spawns[#spawns + 1] = { "drone", x, z }
      elseif ch == "g" then spawns[#spawns + 1] = { "guard", x, z }
      elseif ch == "b" then spawns[#spawns + 1] = { "brute", x, z }
      elseif ch == "X" then spawns[#spawns + 1] = { "boss", x, z }
      elseif ch == "H" then spawns[#spawns + 1] = { "pickup", x, z, { kind = "health" } }
      elseif ch == "A" then spawns[#spawns + 1] = { "pickup", x, z, { kind = "ammo" } }
      elseif ch == "S" then spawns[#spawns + 1] = { "pickup", x, z, { kind = "shotgun" } }
      elseif ch == "K" then spawns[#spawns + 1] = { "pickup", x, z, { kind = "key" } }
      elseif ch == "E" then spawns[#spawns + 1] = { "exit", x, z }
      end
    end
  end
  return spawns
end

-- the path grid, over all the ground (rebuilt when a door opens or shuts)
function Level.build_nav()
  -- doors that can be opened (not the red one before the key) are not in the way of a path: whoever walks up to one opens it
  local ignore = {}
  local state = require("lib.state")
  nova.each("door", function(d)
    if not d.locked or state.key then ignore[#ignore + 1] = d.wall end
  end)
  local t0 = nova.clock()
  nova.nav.build { x0 = 0, z0 = 0, x1 = Level.width, z1 = Level.depth, cell = 0.75, radius = 0.45, ignore = ignore }
  state.nav_ms, state.nav_builds = state.nav_ms + (nova.clock() - t0) * 1000, state.nav_builds + 1
end

function Level.draw()
  local W, D = Level.width, Level.depth
  nova.cuboid(-2, -0.4, -2, W + 2, 0, D + 2, { color = { 70, 72, 80 } })
  nova.cuboid(-2, HEIGHT, -2, W + 2, HEIGHT + 0.4, D + 2, { color = { 50, 52, 60 } })
  for _, b in ipairs(boxes) do nova.cuboid(b[1], b[2], b[3], b[4], b[5], b[6], { color = b[7] }) end
  for _, l in ipairs(lamps) do
    nova.cuboid(l[1] - 0.45, HEIGHT - 0.1, l[2] - 0.45, l[1] + 0.45, HEIGHT, l[2] + 0.45, { color = l[3], glow = true })
    fx.want_light(l[1], HEIGHT - 0.5, l[2], 14, { l[3][1] / 255, l[3][2] / 255, l[3][3] / 255 })
  end
end

return Level
