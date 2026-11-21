-- A stranger standing in their room (Patch, Old Sal). Props: who, sprite (set by the room from data/strangers.lua). Solid: the runner
-- walks up to them; the room's talk starts when interact is pressed beside them.
local Stranger = nova.entity {
  anim = "idle_down", tags = { "stranger", "solid" }, pivot = { 0.5, 0.906 }, hitbox = { -10, -10, 20, 10 }, sx = 1.5, sy = 1.5, velocity = false, shadow = true,
  light = { radius = 100, radius_y = 70, color = { 255, 190, 120 }, intensity = 0.9, y = -40 },
}

function Stranger:create() self.depth = -self.y end

function Stranger:update(dt)
  -- turns towards the runner (four ways)
  local p = nova.first("player")
  if p then
    local dx, dy = p.x - self.x, p.y - self.y
    local f = require("lib.combat").four_way(dx, dy, "down")
    self:play("idle_" .. f)
  end
end

return Stranger
