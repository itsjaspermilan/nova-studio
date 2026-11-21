-- Does something a moment later (a second arc of lightning). Props: delay (seconds), fn (called once, then this goes).
local J = require("lib.juice")

local Later = nova.entity { tags = { "later" }, velocity = false, t = 0, delay = 0.1 }

function Later:update(dt)
  if J.frozen() then return end
  self.t = self.t + dt
  if self.t >= self.delay then
    local f = self.fn
    self:destroy()
    if f then f() end
  end
end

return Later
