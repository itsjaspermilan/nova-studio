-- Shooting by ray: a shot arrives at once, and stops at the first thing it meets along the line (a wall, an enemy or the floor), so it never goes through anything.
local sqrt = math.sqrt
local shot = {}

-- The first enemy along a line over the ground: how far (metres along the ground) and which. The line starts at (ox, oy, oz), goes along the
-- ground direction (hx, hz) and rises `slope` for each metre along. An enemy is a standing circle: find where the line is nearest its middle, check the height there.
local function enemy_hit(ox, oy, oz, hx, hz, slope, len)
  local best, who
  for _, e in ipairs(nova.all("enemy")) do
    if not e.down then
      local ex, ez = e.x - ox, e.z - oz
      local along = ex * hx + ez * hz
      local side2 = ex * ex + ez * ez - along * along
      local r = e.radius
      if side2 < r * r and along > -r then
        local t = math.max(0, along - sqrt(r * r - side2)) -- where the line enters the circle
        if t <= len then
          local y = oy + slope * t
          if y >= e.y and y <= e.y + e.height and (not best or t < best) then best, who = t, e end
        end
      end
    end
  end
  return best, who
end

-- Shoots from (ox, oy, oz) along the unit direction (dx, dy, dz), up to `range` metres. Returns { x, y, z, kind = "wall" | "floor" | "enemy" | "none",
-- enemy, nx, nz (the way a wall faces), hx, hz (the ground direction) }.
function shot.cast(ox, oy, oz, dx, dy, dz, range)
  local h = sqrt(dx * dx + dz * dz)
  local hit = { kind = "none", hx = 0, hz = 1 }
  if h < 1e-4 then
    -- straight up or down: only the floor can be met
    if dy < 0 then hit.kind, hit.x, hit.y, hit.z = "floor", ox, 0, oz else hit.x, hit.y, hit.z = ox, oy + range, oz end
    return hit
  end
  local hx, hz, slope = dx / h, dz / h, dy / h
  local len = range * h -- how far along the ground it goes
  hit.hx, hit.hz = hx, hz
  local best, kind = len, "none"
  local wd, nx, nz = nova.walls.raycast(ox, oz, hx, hz, len, oy, slope)
  if wd and wd < best then best, kind, hit.nx, hit.nz = wd, "wall", nx or 0, nz or 0 end
  if dy < -1e-4 then
    local fl = (oy / -dy) * h -- along the ground to where it reaches the floor
    if fl < best then best, kind = fl, "floor" end
  end
  local ed, e = enemy_hit(ox, oy, oz, hx, hz, slope, best)
  if ed and ed < best then best, kind, hit.enemy = ed, "enemy", e end
  hit.kind = kind
  hit.x, hit.z, hit.y = ox + hx * best, oz + hz * best, oy + slope * best
  if kind == "floor" then hit.y = 0 end
  return hit
end

return shot
