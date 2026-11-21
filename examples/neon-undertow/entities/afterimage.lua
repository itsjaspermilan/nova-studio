-- Afterimage's copy: stands where the roll began, looks like the runner (cyan, flickering) and is what enemies attack until it fades.
-- It cannot be hurt. With the Echo set it also repeats the runner's baton hits (lib/hits.lua). Props: life (seconds), facing.
local J = require("lib.juice")

local Decoy = nova.entity {
  sprite = "runner", anim = "idle_down", tags = { "decoy" }, pivot = { 0.5, 0.875 }, hitbox = { -3, -5, 6, 5 }, sx = 3, sy = 3,
  velocity = false, tint = { 80, 230, 255 }, life = 1.5, t = 0, state = "free",
}

function Decoy:create()
  self.depth = -self.y
  self:play("idle_" .. (self.facing or "down"))
end

function Decoy:take_damage() return false end

function Decoy:update(dt)
  self.t = self.t + dt
  local left = self.life - self.t
  self.alpha = (math.floor(self.t * 14) % 2 == 0 and 0.7 or 0.45) * math.min(1, left / 0.3)
  if left <= 0 then self:destroy() end
end

return Decoy
