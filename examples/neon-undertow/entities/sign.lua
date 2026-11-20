-- A neon sign hanging over the street. A SHOT at it drops it (the baton cannot reach): every puddle touching the square it lands
-- on goes live for a few seconds. Numbers: data/hazards.lua (sign, live).
local H = require("data.hazards")
local P = require("data.player")
local Hits = require("lib.hits")
local F = require("lib.fx")

local Sign = nova.entity { tags = { "hurtable", "prop", "sign" }, velocity = false, sx = 1, sy = 1, state = "up", t = 0 }

function Sign:create()
  self.prop = true
  self.kind_name = "sign"
  self.hitbox = { -H.sign.w / 2, -H.sign.h, H.sign.w, H.sign.h }
  self.depth = -self.y - 200
  self.drops = 0
end

-- The puddles touching the square the sign lands on (their boxes overlap it).
function Sign:touching_puddles()
  local out = {}
  local reach = H.sign.touch
  for _, p in ipairs(nova.all("puddle")) do
    if math.abs(p.x - self.x) <= reach + H.puddle.w / 2 and math.abs(p.y - self.y) <= reach + H.puddle.h / 2 then out[#out + 1] = p end
  end
  return out
end

function Sign:take_hit(damage, dx, dy, knock)
  if self.state ~= "up" or Hits.from ~= "shot" then return false end
  self.state, self.t = "down", 0
  self.hitbox = { 0, 0, 0, 0 }
  local list = self:touching_puddles()
  for _, p in ipairs(list) do p:electrify() end
  nova.sound.play("sign_drop", { volume = P.sfx.sign_drop })
  F.spark(self.x, self.y - 20, 4)
  nova.log(string.format("sign drops: %d puddles live", #list))
  return true
end

function Sign:update(dt) self.t = self.t + dt end

function Sign:draw()
  local x, y = nova.cam.to_screen(self.x, self.y)
  if self.state == "up" then
    local glow = 0.75 + 0.25 * math.sin(self.t * 5 + self.x)
    nova.sprite("sign", x, y - H.sign.h / 2, { w = H.sign.w + 16, h = H.sign.h, frame = 0, color = { 255 * glow, 255 * glow, 255 } })
  else
    nova.sprite("sign", x, y, { w = H.sign.h, h = H.sign.w, frame = 1 })
  end
end

return Sign
