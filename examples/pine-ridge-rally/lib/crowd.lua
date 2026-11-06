-- The people watching: groups of spectators beside the road (by the start, on the outside of the hard corners and here and there along
-- the straights), turned to the road and cheering, jumping or just standing. They are Kenney's Mini Characters (CC0), each with its own
-- clip and phase, drawn only when they are near the camera; the engine skins them on the GPU, so a crowd costs little.
local track = require("lib.track")

local crowd = {}

local KINDS = { "crowd_fa", "crowd_fb", "crowd_fc", "crowd_fd", "crowd_ma", "crowd_mb", "crowd_mc", "crowd_md" }
local SIZE = 2.6          -- the characters are 0.67 m tall as made (big heads): this makes them about 1.75 m
local RANGE = 125         -- metres: further than this from the camera nobody is drawn
local FADE = 40           -- ...and over the last FADE metres they grow from nothing, so that nobody pops into being
local people, count = {}, 0

function crowd.clear() people, count = {}, 0 end

-- A deterministic pseudo-random sequence (a circuit gets the same crowd every time).
local function rng(seed)
  local s = seed
  return function()
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  end
end

local function wrap(a) return track.wrap(a) end

local function add(r, i, off, along)
  local p = track.point(i)
  local nx, nz = p.tz, -p.tx -- to the left of the road
  local x = p.x + nx * off + p.tx * along
  local z = p.z + nz * off + p.tz * along
  local _, _, _, away = track.locate(x, z)
  if away < 9.5 then return end
  -- facing the road (the direction from the person to the nearest road point is -side), a little off
  local face = p.heading + (off > 0 and -math.pi / 2 or math.pi / 2) + (r() - 0.5) * 0.7
  local roll = r()
  local clip = roll < 0.45 and "jump" or (roll < 0.75 and "emote-yes" or "idle")
  count = count + 1
  people[count] = {
    x = x, z = z,
    opts = {
      ry = face, scale = SIZE, clip = clip, time = 0, shadow = false,
    },
    size = SIZE * (0.92 + r() * 0.16),
    kind = KINDS[math.floor(r() * #KINDS) + 1],
    rate = 0.8 + r() * 0.5, phase = r() * 4,
  }
end

-- a group of `n` people in two loose rows at `off` metres from the middle of the road, from waypoint `i`
local function group(r, i, side, off, n)
  for k = 1, n do
    local row = k % 2
    add(r, i, side * (off + row * 1.4 + r() * 0.6), (k // 2) * 1.5 + r() * 0.5)
  end
end

local function bends(n)
  local out = {}
  for i = 1, n do out[i] = wrap(track.point(i + 4).heading - track.point(i).heading) end
  return out
end

function crowd.build()
  crowd.clear()
  track.ensure()
  local n = track.count()
  if n < 20 then return 0 end
  local r = rng(n * 31 + 7)
  local bend = bends(n)
  -- the start: a thick crowd along both sides of the straight, in front of the stands
  for i = 1, 9, 2 do
    group(r, i, 1, 11, 7)
    group(r, i, -1, 11, 7)
  end
  -- the hard corners: the outside
  local length = track.length
  local last = -1e9
  for i = 1, n do
    local p = track.point(i)
    if p.s > 40 and math.abs(bend[i]) > 0.16 and p.s - last > 24 then
      local out = bend[i] > 0 and 1 or -1 -- turning right: the outside is to the left
      group(r, i, out, 10.5, 6 + math.floor(r() * 4))
      last = p.s
    end
  end
  -- along the straights: a few every 70 m or so, either side
  local next_spot, side = 90, 1
  for i = 1, n do
    local p = track.point(i)
    if p.s > next_spot and p.s < length - 30 then
      group(r, i, side, 11 + r() * 2, 3 + math.floor(r() * 3))
      side = -side
      next_spot = p.s + 55 + r() * 40
    end
  end
  return count
end

function crowd.draw(cx, cz, t)
  local r2 = RANGE * RANGE
  for i = 1, count do
    local p = people[i]
    local dx, dz = p.x - cx, p.z - cz
    if dx * dx + dz * dz < r2 then
      p.opts.time = t * p.rate + p.phase
      local d = math.sqrt(dx * dx + dz * dz)
      local grow = math.min(1, (RANGE - d) / FADE)
      grow = grow * grow * (3 - 2 * grow) -- (smooth at both ends)
      p.opts.scale = p.size * grow
      nova.model(p.kind, p.x, 0, p.z, p.opts)
    end
  end
end

return crowd
