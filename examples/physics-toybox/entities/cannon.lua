-- The cannon: up and down aim it (the stick or the d-pad), A fires a ball. The computer player sweeps it.
local hud = require("lib.hud")
local Cannon = nova.entity { aim = -0.25, power = 1300 }

function Cannon:create() self.cool, self.t = 0, 0 end

function Cannon:update(dt)
  self.t = self.t + dt
  self.cool = math.max(0, self.cool - dt)
  local fire = nova.input.pressed("fire")
  if hud.auto then
    self.aim = -0.45 + 0.35 * math.sin(self.t * 0.7)
    fire = self.cool == 0 and (self.t % 1.4) < dt
  else
    self.aim = math.max(-1.2, math.min(0.3, self.aim + nova.input.axis("move_y") * 1.2 * dt))
  end
  if fire and self.cool == 0 then
    self.cool = 0.25
    local c, s = math.cos(self.aim), math.sin(self.aim)
    nova.spawn("ball2", self.x + c * 46, self.y + s * 46, { vx = c * self.power, vy = s * self.power })
    -- only the newest dozen balls stay
    local balls = nova.all("ball")
    for i = 1, #balls - 12 do balls[i]:destroy() end
  end
end

function Cannon:draw()
  local w, h = nova.view()
  local cx, cy = nova.cam.position()
  local x, y = self.x - (cx - w / 2), self.y - (cy - h / 2)
  local c, s = math.cos(self.aim), math.sin(self.aim)
  nova.sprite("items/block_blue", x + c * 22, y + s * 22, { sx = 0.55, sy = 0.24, rotation = self.aim })
  nova.sprite("items/block_blue", x, y + 14, { sx = 0.5, sy = 0.4 })
end

return Cannon
