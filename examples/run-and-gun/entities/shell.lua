local rect = require("lib.view").rect
-- A spent shell: thrown out of the gun, it falls, bounces once or twice on the ground and lies there for a moment before it fades. Purely for show.
-- kind "shotgun" is a red hull with a brass end; anything else is a small brass case.
local phys = require("lib.phys")
local floor, abs = math.floor, math.abs

local Shell = nova.entity { tags = { "shell" }, velocity = false, depth = -15, w = 3, h = 3, kind = "rifle" }

function Shell:create()
  self.t, self.vx, self.vy = 0, self.vx or 0, self.vy or 0
end

function Shell:update(dt)
  self.t = self.t + dt
  if self.t > 2.6 then return self:destroy() end
  local before = self.vy
  phys.step(self, dt, 1500, 900)
  if self.grounded then
    if before > 140 then
      self.vy = -before * 0.35 -- a small bounce
      self.vx = self.vx * 0.6
    else
      self.vx = self.vx * 0.85 -- sliding to a stop
    end
  end
  if self.hit_wall then self.vx = -self.vx * 0.4 end
  if self.y > 700 then self:destroy() end
end

function Shell:draw()
  local x, y = floor(self.x), floor(self.y)
  local fade = self.t > 2 and (1 - (self.t - 2) / 0.6) or 1
  local a = floor(255 * fade)
  local still = self.grounded and abs(self.vx) < 5
  local turned = not still and floor(self.t * 14) % 2 == 0 -- it tumbles in the air
  if self.kind == "shotgun" then
    if turned then
      rect(x - 2, y - 6, 4, 6, { 190, 50, 45, a })
      rect(x - 2, y - 2, 4, 2, { 215, 170, 70, a })
    else
      rect(x - 6, y - 4, 6, 4, { 190, 50, 45, a })
      rect(x, y - 4, 2, 4, { 215, 170, 70, a })
    end
  else
    if turned then rect(x - 1, y - 4, 2, 4, { 225, 185, 80, a }) else rect(x - 2, y - 2, 4, 2, { 225, 185, 80, a }) end
  end
end

return Shell
