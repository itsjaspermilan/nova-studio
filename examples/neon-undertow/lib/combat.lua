-- Small helpers the fighters share: four-way directions and the box a swing covers in front of its owner.
local C = {}

C.vec = { right = { 1, 0 }, left = { -1, 0 }, down = { 0, 1 }, up = { 0, -1 } }
C.angle = { right = 0, down = math.pi / 2, left = math.pi, up = -math.pi / 2 }

-- Which of the four ways a vector points (ties go to left/right).
function C.four_way(dx, dy, keep)
  if dx == 0 and dy == 0 then return keep end
  if math.abs(dx) >= math.abs(dy) - 0.001 then return dx < 0 and "left" or "right" end
  return dy < 0 and "up" or "down"
end

-- The box (in sprite pixels from the swing's own x, y, at a scale of 3) in front of `dir`:
-- area = { reach, length, half_width } in world units.
function C.box(dir, area)
  local r, l, h = area.reach / 3, area.length / 3, area.half_width / 3
  if dir == "right" then return { r, -h, l, 2 * h } end
  if dir == "left" then return { -r - l, -h, l, 2 * h } end
  if dir == "down" then return { -h, r, 2 * h, l } end
  return { -h, -r - l, 2 * h, l }
end

return C
