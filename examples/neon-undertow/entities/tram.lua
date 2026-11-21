-- The tram: every `period` seconds it crosses the room along its rail (entities/rail.lua, placed at the same spot). A bell rings and the
-- rail flashes for `warn` seconds before; then the tram runs the length of the rail and flattens anything on it: `damage` to the runner
-- and to every enemy, once each. Props: dir ("h": from this x along x; "v": from this y along y), span (the rail's length), phase
-- (seconds into the first cycle). Numbers: data/hazards.lua (tram). The tram waits once the room's fight is won.
local H = require("data.hazards").tram
local P = require("data.player")
local J = require("lib.juice")
local D = require("lib.draw")
local Look = require("data.look")
local LK = require("lib.look")
local T = require("lib.tell")
local V = require("lib.vfx")

local Tram = nova.entity { tags = { "tram" }, velocity = false, dir = "h", span = 1920, phase = 0, state = "idle", front = 0 }

function Tram:create()
  self.c = self.phase
  self.hit = {}
  self.depth = -4000
  self.crossings = 0
end

-- (a point's place along the rail and across it)
function Tram:along(e) return self.dir == "h" and (e.x - self.x) or (e.y - self.y) end
function Tram:across(e) return self.dir == "h" and (e.y - self.y) or (e.x - self.x) end

function Tram:flatten(e, what)
  if self.hit[e] then return end
  local a = self:along(e)
  if a > self.front - H.length - H.margin and a < self.front + H.margin and math.abs(self:across(e)) <= H.half + H.margin then
    self.hit[e] = true
    V.hit(e.x, e.y - 26, self.dir == "h" and 1 or 0, self.dir == "h" and 0 or 1, { size = 76, n = 16, magenta = what ~= "runner" })
    V.debris(e.x, e.y, 4, { kind = "grey", speed = 240 })
    if what == "runner" then
      if e:take_damage(H.damage) then nova.log("tram flattens runner") end
    else
      e:take_hit(H.damage, 0, 0, 0)
      nova.log("tram flattens " .. (e.kind_name or e.name or "enemy"))
    end
  end
end

function Tram:update(dt)
  if J.frozen(self) then return end
  local scene = nova.scene_now()
  local calm = scene and (scene.state == "cards" or scene.state == "done")   -- (the fight is won: no new crossings)
  if self.state ~= "cross" then
    if calm then return end
    self.c = self.c + dt
    if self.state == "idle" and self.c >= H.period - H.warn then
      self.state, self.rang = "warn", 0
      nova.sound.play("tram_bell", { volume = P.sfx.tram_bell })
      nova.log("tram warns")
    elseif self.state == "warn" then
      if self.c - (H.period - H.warn) >= 0.75 and self.rang == 0 then
        self.rang = 1
        nova.sound.play("tram_bell", { volume = P.sfx.tram_bell })
      end
      if self.c >= H.period then
        self.state, self.front, self.hit = "cross", 0, {}
        self.c = self.c - H.period
        self.crossings = self.crossings + 1
        nova.sound.play("tram_pass", { volume = P.sfx.tram_pass })
        nova.log("tram crosses")
      end
    end
    return
  end
  self.c = self.c + dt
  self.front = self.front + H.speed * dt
  local p = nova.first("player")
  if p and p.state ~= "dead" then self:flatten(p, "runner") end
  for _, e in ipairs(nova.all("hurtable")) do
    if e.state ~= "dead" then self:flatten(e, "enemy") end
  end
  if self.front - H.length > self.span then
    self.state = "idle"
    nova.log("tram has crossed")
  end
end

-- Seconds until the tram next starts to cross (for the tests and the HUD).
function Tram:eta()
  if self.state == "cross" then return 0 end
  return H.period - self.c
end

function Tram:draw()
  local h = self.dir == "h"
  if self.state == "warn" then
    -- the rail flashes magenta and amber lamps blink at both ends
    local on = math.floor(self.c * 8) % 2 == 0
    local x0, y0 = self.x, self.y
    local x1, y1 = h and (self.x + self.span) or self.x, h and self.y or (self.y + self.span)
    -- the band that flattens (half + margin each side of the rail), filling along its whole length as the tram nears, chevrons running its way
    local k = (self.c - (H.period - H.warn)) / H.warn
    T.lane(x0, y0, x1, y1, (H.half + H.margin) * 2, k, self.c, T.magenta)
    for _, pt in ipairs({ { x0, y0 }, { x1, y1 } }) do
      local sx, sy = nova.cam.to_screen(pt[1] + (h and (pt[1] == x0 and -30 or 30) or 0), pt[2] + (h and 0 or (pt[2] == y0 and -30 or 30)))
      nova.sprite("solid", sx, sy, { w = 26, h = 26, color = on and { 255, 190, 40 } or { 120, 40, 20 }, blend = "add", lit = false })
      if on then nova.light2d(pt[1] + (h and (pt[1] == x0 and -30 or 30) or 0), pt[2] + (h and 0 or (pt[2] == y0 and -30 or 30)), { radius = 120, color = { 255, 150, 40 }, intensity = 2.0 }) end
    end
  end
  if self.state == "cross" then
    local x, y
    if h then x, y = nova.cam.to_screen(self.x + self.front - H.length / 2, self.y)
    else x, y = nova.cam.to_screen(self.x, self.y + self.front - H.length / 2) end
    nova.sprite(h and "tram_h" or "tram_v", x, y, { w = h and H.length or H.half * 2, h = h and H.half * 2 or H.length, foot = nil })
    -- its headlamp: a hard warm pool ahead of it, and a halo on the lamp
    local fx, fy = h and (self.x + self.front) or self.x, h and self.y or (self.y + self.front)
    nova.light2d(fx + (h and 70 or 0), fy + (h and 0 or 70), { radius = Look.tram.radius, radius_y = Look.tram.radius * (h and 0.75 or 1), color = Look.tram.color, intensity = Look.tram.intensity })
    nova.light2d(self.x + (h and self.front - H.length / 2 or 0), self.y + (h and 0 or self.front - H.length / 2), { radius = 150, color = Look.accent.magenta, intensity = 1.2 })
    LK.halo(fx, fy, 34, Look.tram.color, 180)
    -- speed: white streaks trailing from it, sparks from its wheels on the rail, a gust of dust ahead
    local ux, uy = h and 1 or 0, h and 0 or 1
    for i = -2, 2 do
      local off = i * H.half * 0.35
      local sx0, sy0 = fx - ux * (H.length * 0.8 + math.abs(i) * 30) - uy * off, fy - uy * (H.length * 0.8 + math.abs(i) * 30) + ux * off
      V.line(sx0, sy0, fx - ux * (H.length * 0.95) - uy * off, fy - uy * (H.length * 0.95) + ux * off, 3, { 255, 255, 255, 60 }, 14)
    end
    self.fx_t = (self.fx_t or 0) - 1
    if self.fx_t <= 0 then
      self.fx_t = 2
      for _, s in ipairs({ -1, 1 }) do
        V.sparks(fx - ux * H.length * (0.2 + math.random() * 0.6) - uy * s * H.half * 0.7, fy - uy * H.length * (0.2 + math.random() * 0.6) + ux * s * H.half * 0.7, 2,
          { z = 4, angle = h and math.pi or -math.pi / 2, spread = 0.7, speed = 300, up = 60, life = 0.35, colors = { "spark_white", "spark_yellow" }, size = 18 })
      end
      V.dust(fx + ux * 20, fy + uy * 20, 1, -ux, -uy, 70)
    end
  end
end

return Tram
