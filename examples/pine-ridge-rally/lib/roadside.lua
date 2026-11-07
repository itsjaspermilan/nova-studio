-- The life beside the road: stands and tents at the start, flags, banners, billboards along the straights and pylons at the
-- corners. Laid out from the circuit's own waypoints, so every circuit gets it without its scene file listing each one.
-- (Everything is a static prop: the engine draws it only when it is near the camera and the cars bump into it.)
local track = require("lib.track")

local roadside = {}

local EDGE = 6          -- half the road's width, metres
local function wrap(a) return track.wrap(a) end

-- A prop at distance `off` metres to the left (negative: right) of waypoint `i`, turned `turn` radians from the road's heading,
-- and `along` metres further on.
-- Nothing may stand on the road: where the road bends, a spot "beside" one waypoint and "further on" can be across another part
-- of the road, so the spot's real distance from the road's middle is checked and the prop is left out if it is too near
-- (`clear` metres: the road is 12 wide).
local function put(kind, i, off, turn, along, clear)
  local p = track.point(i)
  local nx, nz = p.tz, -p.tx -- to the left
  local x = p.x + nx * off + p.tx * (along or 0)
  local z = p.z + nz * off + p.tz * (along or 0)
  local _, _, _, away = track.locate(x, z)
  if away < (clear or 8) then return nil end
  return nova.spawn(kind, x, 0, { z = z, ry = p.heading + (turn or 0) })
end

-- Where the road turns hard: the heading change over about 40 m after each waypoint (radians; positive: to the right).
local function bends(n)
  local out = {}
  for i = 1, n do
    out[i] = wrap(track.point(i + 4).heading - track.point(i).heading)
  end
  return out
end

local LOOK = {
  forest = { banner = "banner_green", flag = "flag_green", stand = "grandstand" },
  desert = { banner = "banner_red", flag = "flag_red", stand = "grandstand_covered" },
  snow = { banner = "banner_red", flag = "flag_checkers", stand = "grandstand_covered" },
  night = { banner = "banner_green", flag = "flag_checkers", stand = "grandstand" },
}

-- `style` is the circuit's horizon name (forest, desert, snow, night...).
function roadside.build(style)
  track.ensure()
  local n = track.count()
  if n < 20 then return 0 end
  local look = LOOK[style] or LOOK.forest
  local bend = bends(n)
  local count = 0
  local function add(kind, i, off, turn, along, clear)
    if put(kind, i, off, turn, along, clear) then count = count + 1 end
  end
  local pi = math.pi
  -- by the start line (waypoint 1): a stand on each side of the straight, facing the road, with tents and banners between
  add(look.stand, 2, 22, pi / 2, 14, 14)
  add(look.stand, 2, -22, -pi / 2, 14, 14)
  add("tent_long", 3, 17, pi / 2, 30, 11)
  add("tent_long", 3, -17, -pi / 2, 30, 11)
  add(look.banner, 1, 9.5, 0, 0, 8.5)
  add(look.banner, 1, -9.5, 0, 0, 8.5)
  for k = 0, 3 do
    add(look.flag, 1 + k * 3, 8, 0, -22, 7.5)
    add(look.flag, 1 + k * 3, -8, 0, -22, 7.5)
  end
  -- along the road: a billboard on a straight every 120 m or so, alternating sides; pylons on the outside of each hard corner
  local length = track.length
  local next_board, side = 130, 1
  local last_pylon = -1e9
  for i = 1, n do
    local p = track.point(i)
    if p.s > 60 and p.s < length - 40 then
      local straight = math.abs(bend[i]) < 0.08 and math.abs(bend[(i + 3) % n + 1]) < 0.08
      if straight and p.s > next_board then
        add(i % 2 == 0 and "billboard" or "billboard_low", i, side * 13, side * pi / 2, 0, 10)
        side = -side
        next_board = p.s + 120
      end
      -- (one pylon every 20 m or so on the outside of a hard bend: a pair side by side looked like one made twice)
      if math.abs(bend[i]) > 0.22 and p.s - last_pylon > 20 then
        local out = bend[i] > 0 and 1 or -1 -- turning right: the outside is to the left
        add("pylon", i, out * (EDGE + 1.4), 0, 0, 6.2)
        last_pylon = p.s
      end
    end
  end
  return count
end

return roadside
