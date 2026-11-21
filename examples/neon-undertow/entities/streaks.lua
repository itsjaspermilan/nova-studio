-- The dash attack's speed streaks: long bright lines laid along the lunge, from where it began to where the runner is, that shrink
-- back into him and fade (0.3 s). Made by Runner:start_dash_attack with its owner and the way the lunge goes (dx, dy).
local J = require("lib.juice")
local V = require("lib.vfx")

local Streaks = nova.entity { velocity = false, life = 0.32, t = 0 }

function Streaks:create()
  self.x0, self.y0 = self.x, self.y
  self.depth = -self.y - 2
  -- five lines across the lunge, at different heights on the body: lateral offset (units), height above the ground, thickness
  self.lines = { { -34, 10, 5 }, { -17, 26, 3 }, { 0, 18, 6 }, { 17, 34, 3 }, { 34, 12, 5 } }
end

function Streaks:update(dt)
  if J.frozen() then return end
  self.t = self.t + dt
  if self.t >= self.life then self:destroy() end
end

function Streaks:draw()
  local o = self.owner
  local hx, hy = self.x0, self.y0
  if o and o:is_alive() then hx, hy = o.x, o.y end
  local dx, dy = self.dx or 1, self.dy or 0
  local px, py = -dy, dx
  local k = math.min(1, self.t / self.life)
  local fade = (1 - k) ^ 1.4
  local pull = k ^ 1.3                        -- (the tail comes in towards the runner as the streak ends)
  for _, l in ipairs(self.lines) do
    local ox, oy = px * l[1], py * l[1] * 0.8
    local ax, ay = self.x0 - dx * 14 + ox, self.y0 - dy * 14 + oy
    local bx, by = hx - dx * 10 + ox, hy - dy * 10 + oy
    ax, ay = ax + (bx - ax) * pull, ay + (by - ay) * pull
    if V.glow() then V.line(ax, ay, bx, by, l[3] * 2.4, { 6, 200, 255, 70 * fade }, l[2]) end
    V.line(ax, ay, bx, by, l[3], { 120, 235, 255, 200 * fade }, l[2])
    V.line(ax, ay, bx, by, math.max(1.5, l[3] * 0.4), { 255, 255, 255, 255 * fade }, l[2])
  end
end

return Streaks
