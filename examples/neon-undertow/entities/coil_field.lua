-- Mother Coil's second phase: the floor magnetised in vertical stripes (lib/field.lua keeps their numbers for the shot). It charges
-- for `charge` seconds (drawn dim, its own sound), then is armed: shots bend inside a stripe and Rat-drones are pulled along it. It also
-- lets two Rat-drones out of the arena's corners every so often. Props: boss. Numbers: data/bosses.lua (stripes, phase2).
local B = require("data.bosses").mother_coil
local S = B.stripes
local P = require("data.player")
local J = require("lib.juice")
local Field = require("lib.field")

local FieldE = nova.entity { tags = { "coil_field" }, velocity = false, t = 0 }

function FieldE:create()
  self.depth = 97
  local f = self.boss.floor
  self.f = f
  local list = {}
  for i, share in ipairs(S.centres) do
    local cx = f.x0 + share * (f.x1 - f.x0)
    list[i] = { x0 = cx - S.width / 2, x1 = cx + S.width / 2, cx = cx, omega = (i % 2 == 1) and S.omega or -S.omega, pull = (i % 2 == 1) and S.pull or -S.pull }
  end
  Field.set(list, f.y0, f.y1)
  Field.armed = false
  self.drone_t = S.charge + 1.5
  nova.sound.play("stripes_on", { volume = P.sfx.stripes_on })
end

function FieldE:update(dt)
  if J.frozen() then return end
  self.t = self.t + dt
  if not Field.armed and self.t >= S.charge then
    Field.armed = true
    nova.log("the floor is magnetised: stripes armed")
  end
  if not Field.armed then return end
  for _, d in ipairs(nova.all("rat_drone")) do
    local s = Field.at(d.x, d.y)
    if s and d.state ~= "dead" then d:move(0, s.pull * dt) end
  end
  local D2 = B.phase2.drones
  if self.t >= self.drone_t and self.boss:is_alive() and self.boss.state ~= "dying" then
    self.drone_t = self.t + D2.every
    local alive = nova.count("rat_drone") + nova.count("warn")
    if alive < D2.max then
      local pts = {}
      for _, m in ipairs(nova.all("marker")) do if m.name == "sp_1" or m.name == "sp_2" then pts[#pts + 1] = m end end
      for i = 1, math.min(#pts, D2.max - alive) do
        nova.spawn("warn", pts[i].x, pts[i].y, { kind = D2.kind, time = 0.9 })
      end
      nova.log("rat-drones are let out")
    end
  end
end

function FieldE:draw()
  local f = self.f
  local armed = Field.armed
  for _, s in ipairs(Field.stripes) do
    local cx, cy = nova.cam.to_screen(s.cx, (f.y0 + f.y1) / 2)
    local up = s.pull > 0
    local col = up and { 6, 240, 255 } or { 255, 43, 214 }
    local a = armed and 46 or (math.floor(self.t * 8) % 2 == 0 and 40 or 14)
    nova.sprite("solid", cx, cy, { w = S.width, h = f.y1 - f.y0, color = { col[1], col[2], col[3], a } })
    -- chevrons that run along the stripe in the direction it pulls
    local n = 7
    for i = 0, n - 1 do
      local ph = ((self.t * 0.9 + i / n) % 1)
      local y = up and (f.y1 - ph * (f.y1 - f.y0)) or (f.y0 + ph * (f.y1 - f.y0))
      local sx, sy = nova.cam.to_screen(s.cx, y)
      nova.sprite("solid", sx, sy, { w = S.width * 0.5, h = 5, color = { col[1], col[2], col[3], armed and 150 or 50 } })
    end
  end
end

return FieldE
