-- A card on the floor: rises out of it, then waits to be taken. Shows its name and family icon above it, a ring in its rarity's
-- colour on the ground; the text appears in the room's panel when the runner stands by it. Props: card_id.
local P = require("data.player")
local Ty = require("lib.type")
local J = require("lib.juice")
local D = require("lib.draw")
local R = require("data.rooms")
local Cards = require("data.cards")

local Card = nova.entity {
  sprite = "ui", tags = { "card" }, velocity = false, pivot = { 0.5, 0.95 }, sx = 0, sy = 0, t = 0, state = "rising",
  light = { radius = 140, radius_y = 100, color = { 255, 255, 255 }, intensity = 0, y = -20 },
}

function Card:create()
  self.def = Cards.by_id[self.card_id]
  self.rar = Cards.rarity[self.def.rarity]
  self.frame = Cards.frame_of(self.def.family, self.def.rarity)
  local c = self.rar.color
  self.light = { radius = 140, radius_y = 100, color = { c[1], c[2], c[3] }, intensity = 0, y = -20 }
  self.depth = -self.y
  self.ready = false
end

function Card:sink() if self.state ~= "gone" then self.state, self.t = "sinking", 0 end end
function Card:taken() self.state, self.t = "taken", 0 end

function Card:update(dt)
  self.t = self.t + dt
  if self.state == "rising" then
    local k = math.min(1, self.t / R.rise)
    local e = 1 - (1 - k) * (1 - k)
    self.sx, self.sy = 1.5 * e, 1.5 * e
    self.light.intensity = 2.0 * e
    self.alpha = e
    if k >= 1 then self.state, self.ready = "ready", true end
  elseif self.state == "ready" then
    self.sx, self.sy = 1.5, 1.5
    self.light.intensity = 2.0
    self.alpha = 1
  elseif self.state == "sinking" then
    self.ready = false
    local k = math.min(1, self.t / R.sink)
    self.sx, self.sy = 1.5 * (1 - k), 1.5 * (1 - k)
    self.light.intensity = 2.0 * (1 - k)
    self.alpha = 1 - k
    if k >= 1 then self.state = "gone"; self:destroy() end
  elseif self.state == "taken" then
    self.ready = false
    local k = math.min(1, self.t / 0.35)
    self.sx, self.sy = 1.5 + 1 * k, 1.5 + 1 * k
    self.alpha = 1 - k
    if k >= 1 then self.state = "gone"; self:destroy() end
  end
end

function Card:draw()
  local k = (self.state == "rising") and math.min(1, self.t / R.rise) or (self.state == "ready" and 1 or 0)
  local col = self.rar.color
  local near = self.near
  if self.state ~= "gone" and self.def.jinx then
    -- a jinx: a warning ring of yellow and black dashes
    for i = 0, 23 do
      local ang = i / 24 * math.pi * 2
      local x, y = nova.cam.to_screen(self.x + math.cos(ang) * 52, self.y + math.sin(ang) * 52 * 0.8)
      local on = (i + math.floor(self.t * 4)) % 2 == 0
      nova.rect(x - 4, y - 4, 8, 8, on and { 255, 228, 94, 255 } or { 20, 16, 5, 255 })
    end
  end
  if self.state ~= "gone" then
    local a = (near and 255 or 170) * math.max(k, 0.2)
    D.disc(self.x, self.y, 40 * math.max(k, 0.3), { col[1], col[2], col[3], 40 })
    D.ring(self.x, self.y, 40, { col[1], col[2], col[3], a }, 5, 28)
    if near then D.ring(self.x, self.y, 48, { 255, 255, 255, 200 }, 4, 32) end
  end
  nova.Entity.draw(self)
end

-- Name and family icon over the card (screen coordinates).
function Card:hud()
  if self.state ~= "ready" and self.state ~= "rising" then return end
  local k = self.state == "rising" and math.min(1, self.t / R.rise) or 1
  local x, y = nova.cam.to_screen(self.x, self.y - 78 * k)
  local fam = Cards.families[self.def.family]
  local col = self.rar.color
  -- (the icon is the card's quiet cue; its name comes in a prompt when the runner is near: lib/prompt.lua)
  nova.ui.sprite("ui", x, y - 34, { frame = Cards.frame_of(self.def.family, self.def.rarity), scale = 1.6 * k })
end

return Card
