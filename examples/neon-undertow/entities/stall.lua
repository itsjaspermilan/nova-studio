-- A market stall: cover with health. A counter `tiles` long (`dir` "h" along x, "v" along y) centred on its x, y; solid; baton, shots,
-- fire and blasts hurt it and when its health is gone it breaks. Numbers: data/hazards.lua.
local H = require("data.hazards")
local Art = require("data.art")
local S = H.stall
local D = require("lib.draw")
local F = require("lib.fx")

local Stall = nova.entity { tags = { "hurtable", "solid", "prop", "stall" }, velocity = false, sx = 1, sy = 1, tiles = 3, dir = "h", flash = 0 }

function Stall:create()
  self.hp, self.max_hp = S.health, S.health
  self.prop = true
  self.kind_name = "stall"
  self.w = (self.dir == "h" and self.tiles or 1) * H.tile
  self.h = (self.dir == "h" and 1 or self.tiles) * H.tile
  self.hitbox = { -self.w / 2, -self.h / 2, self.w, self.h }
  self.depth = -self.y
end

function Stall:take_hit(damage, dx, dy, knock)
  if damage <= 0 or self.hp <= 0 then return false end
  self.hp = self.hp - damage
  self.flash = 0.1
  nova.log(string.format("stall takes %d (health %d)", damage, math.max(0, self.hp)))
  if self.hp <= 0 then
    nova.log("stall breaks")
    F.burst(self.x, self.y - 10, 3)
    self:destroy()
  end
  return true
end

function Stall:update(dt) self.flash = math.max(0, self.flash - dt) end

function Stall:draw()
  -- one picture per tile of the counter: the tileset's stall (a counter of goods and, a tile up, its awning with bulbs); it goes darker and
  -- more battered as it breaks (whole, worn, about to go)
  local wear = self.hp > self.max_hp * 0.66 and 0 or (self.hp > self.max_hp * 0.33 and 1 or 2)
  local shade = ({ { 255, 255, 255 }, { 225, 200, 200 }, { 190, 150, 150 } })[wear + 1]
  if self.flash > 0 then shade = { 255, 120, 120 } end
  local n = self.tiles
  for i = 0, n - 1 do
    local cx = self.dir == "h" and (self.x - self.w / 2 + (i + 0.5) * H.tile) or self.x
    local cy = self.dir == "v" and (self.y - self.h / 2 + (i + 0.5) * H.tile) or self.y
    local x, y = nova.cam.to_screen(cx, cy)
    local k = i % 2 + 1
    nova.sprite(Art.tiles, x, y - 24, { w = H.tile, h = H.tile, frame = Art.stall.base[k], color = shade })
    nova.sprite(Art.tiles, x, y - 24 - H.tile, { w = H.tile, h = H.tile, frame = Art.stall.awning[k], color = shade })
  end
end

function Stall:hud()
  if self.hp >= self.max_hp or self.hp <= 0 then return end
  local x, y = nova.cam.to_screen(self.x, self.y - self.h / 2 - 22)
  nova.ui.rect(x - 20, y, 40, 5, { 5, 6, 15, 220 })
  nova.ui.rect(x - 19, y + 1, 38 * math.max(0, self.hp) / self.max_hp, 3, { 6, 240, 255, 255 })
end

return Stall
