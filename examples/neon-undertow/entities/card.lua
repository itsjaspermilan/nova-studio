-- A card on the floor: rises out of it, then waits to be taken. Shows its name and family icon above it, a ring in its rarity's
-- colour on the ground; the text appears in the room's panel when the runner stands by it. Props: card_id.
local P = require("data.player")
local J = require("lib.juice")
local D = require("lib.draw")
local R = require("data.rooms")
local Cards = require("data.cards")

local Card = nova.entity {
  sprite = "card", anim = "common", tags = { "card" }, velocity = false, pivot = { 0.5, 0.95 }, sx = 0, sy = 0, t = 0, state = "rising",
}

function Card:create()
  self.def = Cards.by_id[self.card_id]
  self.rar = Cards.rarity[self.def.rarity]
  self:play(self.def.rarity)
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
    self.sx, self.sy = 3 * e, 3 * e
    self.alpha = e
    if k >= 1 then self.state, self.ready = "ready", true end
  elseif self.state == "ready" then
    self.sx, self.sy = 3, 3
    self.alpha = 1
  elseif self.state == "sinking" then
    self.ready = false
    local k = math.min(1, self.t / R.sink)
    self.sx, self.sy = 3 * (1 - k), 3 * (1 - k)
    self.alpha = 1 - k
    if k >= 1 then self.state = "gone"; self:destroy() end
  elseif self.state == "taken" then
    self.ready = false
    local k = math.min(1, self.t / 0.35)
    self.sx, self.sy = 3 + 2 * k, 3 + 2 * k
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
  nova.ui.sprite("icons", x, y - 30, { frame = fam.icon, scale = 2 * k })
  if k >= 1 then
    nova.ui.text(x - 70, y - 12, self.def.name, { font = "pixel", size = 12, color = { col[1], col[2], col[3], 255 }, align = "center", width = 140, shadow = true })
    if self.def.jinx then nova.ui.text(x - 70, y + 2, "JINX!", { font = "pixel", size = 12, color = { 255, 228, 94, 255 }, align = "center", width = 140, shadow = true }) end
  end
end

return Card
