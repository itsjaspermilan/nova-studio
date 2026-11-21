-- A puddle on the street, walkable. It shimmers; a neon sign dropped on it makes it live (entities/sign.lua): for a few seconds
-- anyone standing in it takes damage once each second. Numbers: data/hazards.lua (puddle, live).
local H = require("data.hazards")
local P = require("data.player")
local J = require("lib.juice")
local Run = require("lib.run")
local Look = require("data.look")
local LK = require("lib.look")
local V = require("lib.vfx")

-- (its picture is the map's own: the room is painted with reflective puddle tiles under every puddle entity, so this one only draws the live part)
local Puddle = nova.entity { velocity = false, depth = 85, tags = { "puddle" }, live_t = 0 }

function Puddle:create() self.cool = {} end

function Puddle:electrify()
  self.live_t = H.live.time
  self.cool = {}
  self.age = 0
  nova.log(string.format("puddle at %.0f,%.0f is live", self.x, self.y))
end

function Puddle:is_live() return self.live_t > 0 end

-- Is the point (the feet of a runner or an enemy) standing in the puddle?
function Puddle:holds(e)
  return math.abs(e.x - self.x) <= H.puddle.w / 2 and math.abs(e.y - self.y) <= H.puddle.h / 2
end

function Puddle:update(dt)
  if J.frozen() or self.live_t <= 0 then return end
  self.live_t = self.live_t - dt
  self.age = (self.age or 0) + dt
  local p = nova.first("player")
  if p and p.state ~= "dead" and Run.mods.wiring <= 0 and self:holds(p) and self.age >= (self.cool[p] or 0) then     -- (Bad Wiring: no damage to the runner)
    self.cool[p] = self.age + H.live.every
    if p:take_damage(H.live.damage) then nova.log("live puddle hurts runner") end
  end
  for _, e in ipairs(nova.all("hurtable")) do
    if not e.prop and e.state ~= "dead" and self:holds(e) and self.age >= (self.cool[e] or 0) then
      self.cool[e] = self.age + H.live.every
      e:take_hit(H.live.damage, 0, 0, 0)
      nova.log("live puddle hurts " .. (e.kind_name or e.name or "enemy"))
    end
  end
  if self.live_t <= 0 then self.live_t = 0; nova.log(string.format("puddle at %.0f,%.0f is dry", self.x, self.y)) end
end

function Puddle:draw()
  if self.live_t > 0 then
    nova.light2d(self.x, self.y, { radius = Look.puddle_live.radius, radius_y = Look.puddle_live.radius * 0.7, color = Look.puddle_live.color, intensity = Look.puddle_live.intensity * (math.floor((self.age or 0) * 18) % 2 == 0 and 1 or 0.7), flicker = 0.4 })
    local x, y = nova.cam.to_screen(self.x, self.y)
    local flick = math.floor((self.age or 0) * 18) % 2 == 0
    local fade = self.live_t < 0.5 and self.live_t / 0.5 or 1
    nova.sprite("solid", x, y, { w = H.puddle.w, h = H.puddle.h, color = { 6, 240, 255, (flick and 130 or 80) * fade }, blend = "add", lit = false })
    -- the edge of the box that hurts (the whole puddle), bright
    local w, h = H.puddle.w, H.puddle.h
    local edge = { 6, 240, 255, 230 * fade }
    nova.rect(x - w / 2, y - h / 2, w, 3, edge, { blend = "add", lit = false })
    nova.rect(x - w / 2, y + h / 2 - 3, w, 3, edge, { blend = "add", lit = false })
    nova.rect(x - w / 2, y - h / 2 + 3, 3, h - 6, edge, { blend = "add", lit = false })
    nova.rect(x + w / 2 - 3, y - h / 2 + 3, 3, h - 6, edge, { blend = "add", lit = false })
    -- arcs jumping across it: three bolts that jump to new places every few frames
    local step = math.floor((self.age or 0) * 14)
    for i = 1, 3 do
      local s = step * 3 + i
      local function r(n) return (math.sin(s * 12.9898 + n * 78.233) * 43758.5453) % 1 - 0.5 end
      V.bolt(self.x + r(1) * w * 0.9, self.y + r(2) * h * 0.9, self.x + r(3) * w * 0.9, self.y + r(4) * h * 0.9, fade * (0.6 + 0.4 * ((step + i) % 2)), nil, s, 6, 14)
    end
    if step ~= self.last_step then
      self.last_step = step
      V.sparks(self.x + (math.random() - 0.5) * w * 0.8, self.y + (math.random() - 0.5) * h * 0.8, 2, { z = 4, speed = 120, up = 160, life = 0.4, colors = { "spark_white", "spark_cyan" }, size = 16 })
    end
  end
end

return Puddle
