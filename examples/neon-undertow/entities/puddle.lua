-- A puddle on the street, walkable. It shimmers; a neon sign dropped on it makes it live (entities/sign.lua): for a few seconds
-- anyone standing in it takes damage once each second. Numbers: data/hazards.lua (puddle, live).
local H = require("data.hazards")
local P = require("data.player")
local J = require("lib.juice")

local Puddle = nova.entity { sprite = "puddle", anim = "shimmer", sx = 3, sy = 3, velocity = false, depth = 85, tags = { "puddle" }, live_t = 0 }

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
  if p and p.state ~= "dead" and self:holds(p) and self.age >= (self.cool[p] or 0) then
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
  nova.Entity.draw(self)
  if self.live_t > 0 then
    local x, y = nova.cam.to_screen(self.x, self.y)
    local flick = math.floor((self.age or 0) * 18) % 2 == 0
    local fade = self.live_t < 0.5 and self.live_t / 0.5 or 1
    nova.sprite("solid", x, y, { w = H.puddle.w, h = H.puddle.h, color = { 6, 240, 255, (flick and 120 or 70) * fade } })
    for i = 1, 4 do
      local a = (self.age or 0) * 7 + i * 1.7
      nova.sprite("solid", x + math.cos(a) * H.puddle.w * 0.3, y + math.sin(a * 1.3) * H.puddle.h * 0.3, { w = 18, h = 4, rotation = a, color = { 255, 255, 255, 230 * fade } })
    end
  end
end

return Puddle
