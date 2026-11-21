-- A car Mother Coil drops: after `delay` its shadow grows on the ground for `tell` seconds (its own sound), then it slams: whoever is
-- within `radius` takes `damage`, wreckage beside it breaks, and the wreck stays as cover (entities/wreckage.lua). Numbers: data/bosses.lua.
local C = require("data.bosses").mother_coil.cars
local P = require("data.player")
local J = require("lib.juice")
local D = require("lib.draw")
local T = require("lib.tell")
local V = require("lib.vfx")

local Car = nova.entity { tags = { "coil_car" }, velocity = false, t = 0, delay = 0 }

function Car:create()
  self.depth = 97
  self.started = false
end

function Car:slam()
  nova.sound.play("car_slam", { volume = P.sfx.car_slam, limit = 3 })
  J.shake(9, 10)
  V.boom(self.x, self.y, C.radius, { shake = 9 })
  local p = nova.first("player")
  local hurt = "no one"
  if p and p.state ~= "dead" and math.sqrt((p.x - self.x) ^ 2 + (p.y - self.y) ^ 2) <= C.radius then
    if p:take_damage(C.damage) then hurt = "runner"; nova.log("boss hit lands: car") end
  end
  for _, e in ipairs(nova.all("enemy")) do
    if e.state ~= "dead" and math.sqrt((e.x - self.x) ^ 2 + (e.y - self.y) ^ 2) <= C.radius then e:take_hit(C.damage, 0, 0, 0) end
  end
  for _, w in ipairs(nova.all("wreckage")) do
    if math.sqrt((w.x - self.x) ^ 2 + (w.y - self.y) ^ 2) <= C.radius then w:smash("car") end
  end
  local list = nova.all("wreckage")
  if #list >= C.wreck.max then list[1]:smash("limit") end
  nova.spawn("wreckage", self.x, self.y)
  nova.log(string.format("car slams at %.0f,%.0f: hurts %s", self.x, self.y, hurt))
  self:destroy()
end

function Car:update(dt)
  if J.frozen(self) then return end
  self.t = self.t + dt
  if self.t < self.delay then return end
  if not self.started then
    self.started = true
    nova.sound.play("tell_car", { volume = P.sfx.tell_car, limit = 3 })
    nova.log(string.format("car shadow at %.0f,%.0f", self.x, self.y))
  end
  if self.t - self.delay >= C.tell then self:slam() end
end

function Car:draw()
  if not self.started then return end
  local k = math.min(1, (self.t - self.delay) / C.tell)
  local on = math.floor(self.t * 10) % 2 == 0
  do -- (the car's shadow darkens: an ordinary soft disc, not an added one)
    local cx, cy = nova.cam.to_screen(self.x, self.y)
    local r = C.radius * (0.25 + 0.75 * k)
    nova.circle(cx, cy, r, { 0, 0, 0, 170 }, { soft = true, lit = false, ry = r * 0.8 })
  end
  T.disc(self.x, self.y, C.radius, k, self.t, T.magenta)
  if k > 0.7 then
    -- the car comes down in the last part of the tell
    local fall = (1 - k) / 0.3
    local sx, sy = nova.cam.to_screen(self.x, self.y)
    nova.sprite("wreckage", sx, sy - 20 - fall * 520, { w = C.wreck.w, h = C.wreck.h + 24, frame = 0 })
  end
end

return Car
