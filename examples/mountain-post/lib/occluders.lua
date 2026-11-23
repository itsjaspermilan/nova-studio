-- What stands between the camera and a person, for the see-through cut (lib/camera.lua): the real shapes of the scenery that is big
-- enough to hide someone (tree crowns, the masses of forest, the post office with its porch roof, the cabins, the workshop; the data is
-- lib/occluders_data.lua, made by tools/occluders.mjs from the models themselves). Grass, ferns, bushes, rocks, fences, small props,
-- people and the van are not in it: they hide nobody, and nothing is cut for them (the owner, 2026-11-23: "It should only be present
-- when the camera is really blocked by some item").
-- A shape is a stack of thin bands (0.5 m of height each: a box on the ground, and a radius round the axis for a tree); a line from the
-- eye to a point is walked in short steps and is blocked where a step lies inside a band of a piece.
local world = require("lib.world")
local data = require("lib.occluders_data")

local occluders = {}
local CELL = 20
local STEP = 0.25 -- metres along the line between two looks
local grid = {}
local ready = false

local function build()
  ready = true
  for _, p in ipairs(data.pieces) do
    local k = data.kinds[p[1]]
    local rmax = 0
    for _, b in ipairs(k.bands) do if b and b[5] > rmax then rmax = b[5] end end
    local piece = { k = k, x = p[2], z = p[3], c = math.cos(p[4]), s = math.sin(p[4]), size = p[5], reach = rmax * p[5] }
    piece.g = nil -- (the ground under it, when first looked at: the hills are set up after this loads)
    -- (a piece is in every cell its circle touches)
    for i = math.floor((piece.x - piece.reach) / CELL), math.floor((piece.x + piece.reach) / CELL) do
      for j = math.floor((piece.z - piece.reach) / CELL), math.floor((piece.z + piece.reach) / CELL) do
        local key = i * 100003 + j
        local cell = grid[key]
        if not cell then cell = {}; grid[key] = cell end
        cell[#cell + 1] = piece
      end
    end
  end
end

-- Whether the point (x, y, z) is inside the piece.
local function inside(p, x, y, z)
  if not p.g then p.g = world.height(p.x, p.z) end
  local ly = (y - p.g) / p.size
  if ly < 0 then return false end
  local band = p.k.bands[math.floor(ly / data.band) + 1]
  if not band then return false end
  local dx, dz = x - p.x, z - p.z
  -- (into the piece's own space: turned back by its heading, and at scale 1)
  local lx, lz = (dx * p.c - dz * p.s) / p.size, (dx * p.s + dz * p.c) / p.size
  if p.k.round then return lx * lx + lz * lz <= band[5] * band[5] end
  return lx >= band[1] and lx <= band[2] and lz >= band[3] and lz <= band[4]
end

-- Whether anything of the scenery lies on the straight line from (ax, ay, az) to (bx, by, bz).
function occluders.blocked(ax, ay, az, bx, by, bz)
  if not ready then build() end
  local dx, dy, dz = bx - ax, by - ay, bz - az
  local len = math.sqrt(dx * dx + dy * dy + dz * dz)
  if len < 1e-4 then return false end
  local seen = {}
  local n = math.max(1, math.ceil(len / STEP))
  local i0, i1 = math.floor(math.min(ax, bx) / CELL), math.floor(math.max(ax, bx) / CELL)
  local j0, j1 = math.floor(math.min(az, bz) / CELL), math.floor(math.max(az, bz) / CELL)
  local pl2 = dx * dx + dz * dz
  for i = i0, i1 do
    for j = j0, j1 do
      local cell = grid[i * 100003 + j]
      if cell then
        for _, p in ipairs(cell) do
          if not seen[p] then
            seen[p] = true
            -- (the nearest the line comes to the piece's axis on the ground, against how far the piece reaches)
            local t = pl2 > 1e-6 and math.max(0, math.min(1, ((p.x - ax) * dx + (p.z - az) * dz) / pl2)) or 0
            local qx, qz = ax + dx * t - p.x, az + dz * t - p.z
            if qx * qx + qz * qz <= p.reach * p.reach then
              for s = 0, n do
                local u = s / n
                if inside(p, ax + dx * u, ay + dy * u, az + dz * u) then return true end
              end
            end
          end
        end
      end
    end
  end
  return false
end

-- Whether a person's body at the ground point (x, z), `base` metres up, is hidden from the eye: at least two of three points on them
-- (the feet's end, the middle, the head) have scenery in front. One thin trunk across them hides nobody.
function occluders.hides(ex, ey, ez, x, base, z, heights)
  local hit = 0
  for _, h in ipairs(heights) do
    if occluders.blocked(ex, ey, ez, x, base + h, z) then hit = hit + 1 end
  end
  return hit >= 2, hit
end

-- Whether the eye itself is inside scenery (a camera in a tree's crown or the post office's porch roof).
function occluders.inside(ex, ey, ez)
  return occluders.blocked(ex, ey, ez, ex, ey, ez + 1e-3)
end

return occluders
