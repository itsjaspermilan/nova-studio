-- A neon sign hanging over the street. A SHOT at it drops it (the baton cannot reach): every puddle touching the square it lands
-- on goes live for a few seconds. Numbers: data/hazards.lua (sign, live).
local H = require("data.hazards")
local P = require("data.player")
local Hits = require("lib.hits")
local F = require("lib.fx")
local V = require("lib.vfx")
local Run = require("lib.run")
local Cards = require("data.cards")
local Art = require("data.art")
local Look = require("data.look")
local LK = require("lib.look")

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
  local reach = H.sign.touch * (Run.mods.wiring > 0 and Cards.num.wiring.reach or 1)     -- (Bad Wiring: twice as wide)
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
  V.debris(self.x, self.y, 7, { kind = "glass", speed = 240, up = 320 })
  V.sparks(self.x, self.y, 12, { z = 20, speed = 320, up = 240, life = 0.8, colors = { "spark_white", "spark_cyan", "spark_yellow" } })
  for _, pd in ipairs(list) do nova.spawn("zap", self.x, self.y - 14, { x2 = pd.x, y2 = pd.y }) end
  nova.log(string.format("sign drops: %d puddles live", #list))
  return true
end

function Sign:update(dt) self.t = self.t + dt end

function Sign:draw()
  local x, y = nova.cam.to_screen(self.x, self.y)
  if self.state == "up" then
    local glow = 0.75 + 0.25 * math.sin(self.t * 5 + self.x)
    local pic = Art.signs[(math.floor(self.x / 48) + math.floor(self.y / 48)) % #Art.signs + 1]
    local col = (math.floor(self.x / 48) + math.floor(self.y / 48)) % 2 == 0 and Look.accent.magenta or Look.accent.cyan
    nova.sprite(Art.tiles, x, y - H.sign.h / 2 - 6, { w = 84, h = 84, frame = pic, color = { 255 * glow, 255 * glow, 255 } })
    LK.halo(self.x, self.y - H.sign.h / 2 - 6, 56, col, 90 * glow)
    nova.light2d(self.x, self.y - 36, { radius = Look.sign.radius, radius_y = Look.sign.radius * Look.sign.squash, color = col, intensity = Look.sign.intensity * glow })
  else
    -- fallen: it lies on the street, dark, with a last spark
    local pic = Art.signs[(math.floor(self.x / 48) + math.floor(self.y / 48)) % #Art.signs + 1]
    nova.sprite(Art.tiles, x, y - 8, { w = 84, h = 84, frame = pic, rotation = 1.4, color = { 120, 120, 140 } })
    if self.t < 0.8 then LK.halo(self.x, self.y - 10, 46, Look.accent.cyan, 200 * (1 - self.t / 0.8)) end
  end
end

return Sign
