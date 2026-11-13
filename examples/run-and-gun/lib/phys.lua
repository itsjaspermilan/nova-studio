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

-- Which side a wall touches the body on: -1 (on its left), 1 (on its right) or 0. Only walls count (not ledges), and the body has to be beside the wall's side
-- (not just above its top).
function phys.wall_side(b)
  local half = b.w / 2
  for _, s in ipairs(nova.all("solid")) do
    if not s.oneway and b.y - b.h < s.y + s.h and b.y - 8 > s.y then
      local gap_r = s.x - (b.x + half) -- the wall to the right
      local gap_l = b.x - half - (s.x + s.w) -- the wall to the left
      if gap_r > -1 and gap_r < 2 then return 1 end
      if gap_l > -1 and gap_l < 2 then return -1 end
    end
  end
  return 0
end

-- Whether there is something to stand on at x, at or just below y (within `reach` pixels): a floor ahead, or a pit.
function phys.floor_at(x, y, reach)
  for _, s in ipairs(nova.all("solid")) do
    if x >= s.x and x <= s.x + s.w and s.y >= y - 4 and s.y <= y + (reach or 24) then return true end
  end
  return false
end

-- Whether a place is on the screen (`margin` more or less than its edge).
function phys.in_view(x, y, margin)
  local cx, cy = nova.cam.position()
  local view = require("lib.view")
  margin = margin or 0
  return math.abs(x - cx) < view.half_w() + margin and math.abs(y - cy) < view.half_h() + margin
end

-- Whether a point is inside a wall (not a ledge: shots fly over those).
function phys.in_wall(px, py)
  for _, s in ipairs(nova.all("solid")) do
    if not s.oneway and px >= s.x and px <= s.x + s.w and py >= s.y and py <= s.y + s.h then return true end
  end
  return false
end

return phys
