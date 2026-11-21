-- The warning mark at a spawn point: a magenta ring that closes in while it pulses, then the enemy steps out of it.
-- Props: kind (the enemy's entity), time (seconds), props (its settings, optional).
local J = require("lib.juice")
local D = require("lib.draw")

local Warn = nova.entity { tags = { "warn" }, velocity = false, t = 0, time = 0.9 }

function Warn:create() self.depth = 95 end

function Warn:update(dt)
  if J.frozen() then return end
  self.t = self.t + dt
  if self.t >= self.time then
    local e = nova.spawn(self.kind, self.x, self.y, self.props)
    -- (an enemy never steps out of the mark into the middle of a stall or a barrel: the nearest free spot instead)
    if e:touching("solid") then
      local ox, oy = e.x, e.y
      local done = false
      for r = 24, 144, 24 do
        for k = 0, 7 do
          local a = k / 8 * math.pi * 2
          e.x, e.y = ox + math.cos(a) * r, oy + math.sin(a) * r
          if not e:touching("solid") then done = true; break end
        end
        if done then break end
      end
      if not done then e.x, e.y = ox, oy end
      nova.log(string.format("spawn moved out of a solid thing: %.0f,%.0f to %.0f,%.0f", ox, oy, e.x, e.y))
    end
    if self.elite then require("lib.elite").make(e, self.elite) end   -- (the room's elite: its mark)
    require("lib.fx").burst(self.x, self.y - 20, 3)
    nova.log("spawned " .. self.kind)
    self:destroy()
  end
end

function Warn:draw()
  local k = self.t / self.time
  local on = math.floor(self.t * 10) % 2 == 0
  D.disc(self.x, self.y, 30, { 255, 43, 214, on and 70 or 35 })
  D.ring(self.x, self.y, 30 + 22 * (1 - k), { 255, 43, 214, on and 255 or 170 }, 5, 24)
  D.ring(self.x, self.y, 14, { 255, 255, 255, 200 }, 4, 12)
end

return Warn
