-- A risen ally (Loop Trap): the enemy that died stands up on the runner's side for `life` seconds, walks to the nearest enemy and hits it.
-- Its kills count (`kills`). With the Echo set it also repeats the runner's baton hits. Props: sprite (the dead enemy's), life.
local J = require("lib.juice")
local Hits = require("lib.hits")
local Cards = require("data.cards")
local N = Cards.num.loop

local Ally = nova.entity {
  tags = { "ally" }, pivot = { 0.5, 0.875 }, hitbox = { -5, -5, 10, 5 }, sx = 3, sy = 3, velocity = false, tint = { 80, 230, 255 },
  t = 0, cool = 0.4, kills = 0, strikes = 0, life = 8,
}

function Ally:create() self.depth = -self.y end

function Ally:nearest()
  local best, bd = nil, 1e9
  for _, e in ipairs(nova.all("enemy")) do
    if e.state ~= "dead" then
      local d = (e.x - self.x) ^ 2 + (e.y - self.y) ^ 2
      if d < bd then best, bd = e, d end
    end
  end
  return best, math.sqrt(bd)
end

function Ally:update(dt)
  if J.frozen() then return end
  self.t = self.t + dt
  self.cool = self.cool - dt
  self.depth = -self.y
  local left = self.life - self.t
  self.alpha = math.min(1, left / 0.4) * (0.75 + 0.2 * math.sin(self.t * 9))
  if left <= 0 then nova.log("ally falls apart: " .. self.kills .. " kills"); return self:destroy() end
  local e, d = self:nearest()
  if not e then return end
  if d > N.range then
    local x, y = self.x, self.y
    self:slide((e.x - self.x) / d * N.speed * dt, 0)
    if self:touching("solid") then self.x = x end
    self:slide(0, (e.y - self.y) / d * N.speed * dt)
    if self:touching("solid") then self.y = y end
  elseif self.cool <= 0 then
    self.cool = N.every
    self.strikes = self.strikes + 1
    Hits.from = "ally"
    local was = e.state
    e:take_hit(N.damage, (e.x - self.x) / math.max(d, 1), (e.y - self.y) / math.max(d, 1), 0)
    Hits.from = nil
    if e.state == "dead" and was ~= "dead" then self.kills = self.kills + 1 end
    nova.spawn("fx", (self.x + e.x) / 2, (self.y + e.y) / 2 - 24, { sprite = "fx_spark", anim = "spark", scale = 2 })
    nova.log("ally hits " .. (e.kind_name or "enemy"))
  end
end

return Ally
