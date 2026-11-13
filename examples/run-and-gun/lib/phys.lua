-- Walking bodies: gravity, and landing on the things with the "solid" tag. A body is anything with x and y (its feet, in the middle), w and h (its size), and vx and vy.
-- A solid with `oneway` set is a ledge: you can jump up through it and land on it, and a body with drop_t above 0 falls through it.
local phys = {}

local function overlaps(b, s)
  local half = b.w / 2
  return b.x - half < s.x + s.w and b.x + half > s.x and b.y - b.h < s.y + s.h and b.y > s.y
end
phys.overlaps = overlaps

-- Moves a body one step. Sets b.grounded (standing on something) and b.hit_wall (stopped by a wall).
function phys.step(b, dt, gravity, fall_max)
  local solids = nova.all("solid")
  b.vy = math.min(b.vy + (gravity or 1500) * dt, fall_max or 900)
  local prev_y = b.y
  local half = b.w / 2
  b.x = b.x + b.vx * dt
  b.hit_wall = false
  for _, s in ipairs(solids) do
    if not s.oneway and overlaps(b, s) then
      if b.vx > 0 then b.x = s.x - half elseif b.vx < 0 then b.x = s.x + s.w + half end
      b.hit_wall = true
    end
  end
  b.y = b.y + b.vy * dt
  b.grounded = false
  for _, s in ipairs(solids) do
    if overlaps(b, s) then
      if s.oneway then
        if b.vy >= 0 and prev_y <= s.y + 1 and (b.drop_t or 0) <= 0 then b.y, b.vy, b.grounded = s.y, 0, true end
      elseif b.vy > 0 then
        b.y, b.vy, b.grounded = s.y, 0, true
      elseif b.vy < 0 then
        b.y, b.vy = s.y + s.h + b.h, 0
      end
    end
  end
end

-- Whether a point is inside a wall (not a ledge: shots fly over those).
function phys.in_wall(px, py)
  for _, s in ipairs(nova.all("solid")) do
    if not s.oneway and px >= s.x and px <= s.x + s.w and py >= s.y and py <= s.y + s.h then return true end
  end
  return false
end

return phys
