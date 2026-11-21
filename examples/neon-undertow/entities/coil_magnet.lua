-- Mother Coil's magnet slam: it follows the runner for `track` seconds (a faint ring), locks where he stands for `lock` seconds (the
-- ring is drawn in full and fills, its own sound), then slams: whoever is within `radius` takes `damage`, wreckage there breaks, and
-- THE DRUM OPENS (lib/../mother_coil.lua `open_drum`) whether or not it hit. Props: boss. Numbers: data/bosses.lua (slam).
local S = require("data.bosses").mother_coil.slam
local P = require("data.player")
local J = require("lib.juice")
local D = require("lib.draw")
local T = require("lib.tell")
local V = require("lib.vfx")

local Magnet = nova.entity { tags = { "coil_magnet" }, velocity = false, t = 0, state = "track" }

function Magnet:create()
  self.depth = 50          -- (behind the runner: he must be seen under the ring)
  self.cx, self.cy = self.x, self.y
end

function Magnet:impact()
  self.state, self.t = "linger", 0
  nova.sound.play("magnet_slam", { volume = P.sfx.magnet_slam })
  V.boom(self.x, self.y, S.radius, { shake = 12 })
  -- the field breaks across the floor: bolts to the edge of the circle
  for i = 1, 6 do
    local a = i / 6 * math.pi * 2 + self.t
    nova.spawn("zap", self.x, self.y - 6, { x2 = self.x + math.cos(a) * S.radius, y2 = self.y - 6 + math.sin(a) * S.radius * 0.8, color = { 255, 63, 164 } })
  end
  local p = nova.first("player")
  local hurt = "no one"
  if p and p.state ~= "dead" and math.sqrt((p.x - self.x) ^ 2 + (p.y - self.y) ^ 2) <= S.radius then
    if p:take_damage(S.damage) then hurt = "runner"; nova.log("boss hit lands: slam") end
  end
  for _, e in ipairs(nova.all("enemy")) do
    if e.state ~= "dead" and math.sqrt((e.x - self.x) ^ 2 + (e.y - self.y) ^ 2) <= S.radius then e:take_hit(S.damage, 0, 0, 0) end
  end
  for _, w in ipairs(nova.all("wreckage")) do
    if math.sqrt((w.x - self.x) ^ 2 + (w.y - self.y) ^ 2) <= S.radius then w:smash("magnet") end
  end
  nova.log(string.format("magnet slams at %.0f,%.0f: hurts %s", self.x, self.y, hurt))
  if self.boss and self.boss:is_alive() then self.boss:open_drum() end
end

function Magnet:update(dt)
  if J.frozen(self) then return end
  self.t = self.t + dt
  local p = nova.first("player")
  if self.state == "track" then
    if p then
      local dx, dy = p.x - self.x, p.y - self.y
      local d = math.sqrt(dx * dx + dy * dy)
      local step = math.min(d, S.follow * dt)
      if d > 0.01 then self.x, self.y = self.x + dx / d * step, self.y + dy / d * step end
    end
    if self.t >= S.track then
      if p then self.x, self.y = p.x, p.y end        -- it locks where he stands
      self.state, self.t = "lock", 0
      nova.sound.play("tell_magnet", { volume = P.sfx.tell_magnet })
      nova.log(string.format("magnet locks at %.0f,%.0f", self.x, self.y))
    end
  elseif self.state == "lock" then
    if self.t >= S.lock then self:impact() end
  elseif self.state == "linger" then
    if self.t >= S.linger then self:destroy() end
  end
end

function Magnet:draw()
  local boss = self.boss
  local k = self.state == "lock" and math.min(1, self.t / S.lock) or (self.state == "track" and 0 or 1)
  if self.state == "track" then
    -- following him: the circle it will crush, pale (it only turns magenta when it locks)
    local cx, cy = nova.cam.to_screen(self.x, self.y)
    nova.sprite("fx_tell", cx, cy, { frame = 0, w = S.radius * 2.1, h = S.radius * 1.68, color = { 200, 220, 255, 150 }, blend = "add", lit = false })
    nova.sprite("fx_tell", cx, cy, { frame = 1, w = S.radius * 2.1, h = S.radius * 1.68, color = { 200, 220, 255, 40 }, blend = "add", lit = false })
  elseif self.state == "lock" then
    T.disc(self.x, self.y, S.radius, k, self.t, T.magenta)
  end
  local lift = self.state == "track" and 80 or (self.state == "lock" and 80 * (1 - k) + 6 or 0)
  if boss and boss:is_alive() then D.lane(boss.x, boss.y - 60, self.x, self.y - 34 - lift, 6, { 120, 130, 170, 255 }) end
  local sx, sy = nova.cam.to_screen(self.x, self.y)
  nova.sprite("crane_arm", sx, sy - 70 - lift + 8, { w = 126, h = 126, frame = 2 + math.floor(nova.time() * 2.5) % 2, alpha = self.state == "linger" and 1 or 0.85 })
  nova.light2d(self.x, self.y - 40, { radius = 160, radius_y = 110, color = { 255, 63, 164 }, intensity = self.state == "lock" and 2.4 or 1.4 })
end

return Magnet
