local state = require("lib.state")
local fx = require("lib.fx")

-- Things to pick up by walking into them.
local Pickup = nova.entity { tags = { "pickup" } }

local KINDS = {
  health = { color = { 80, 255, 120 }, size = 0.32, model = "health_pack", lift = 0.35 },
  ammo = { color = { 255, 210, 70 }, size = 0.3, model = "ammo_clip", lift = 0.45 },
  shotgun = { color = { 255, 140, 60 }, size = 0.4, model = "shotgun", lift = 0.7 },
  key = { color = { 255, 60, 60 }, size = 0.3, model = "key", lift = 0.5 },
}

function Pickup:update(dt)
  self.age = (self.age or 0) + dt
  local p = nova.first("player")
  if not p or state.dead then return end
  local dx, dz = p.x - self.x, p.z - self.z
  if dx * dx + dz * dz > 1.1 then return end
  local k = self.kind
  if k == "health" then
    if state.hp >= 100 then return end
    state.hp = math.min(100, state.hp + 30)
    state.say("health +30")
  elseif k == "ammo" then
    state.ammo.bullets = math.min(150, state.ammo.bullets + 24)
    if state.have[2] then state.ammo.shells = math.min(40, state.ammo.shells + 6) end
    state.say("ammunition")
  elseif k == "shotgun" then
    state.have[2] = true
    state.ammo.shells = state.ammo.shells + 12
    state.armor = math.min(100, state.armor + 25)
    state.say("a shotgun (2), shells and armour", 3.5)
  elseif k == "key" then
    state.key = true
    require("lib.level").nav_dirty = true -- the red door can be passed now
    state.say("the red key: it opens the door below", 3.5)
  end
  nova.sound.play(k == "key" and "key" or "pickup", { volume = 0.8 })
  fx.flash(self.x, 1, self.z, KINDS[k].color, 0.15, 7)
  self:destroy()
end

function Pickup:draw()
  local k = KINDS[self.kind]
  local a = (self.age or 0)
  -- the kit's model, turning and bobbing, with a glow of its own colour so that it can be found in the dark
  nova.model(k.model, self.x, k.lift + math.sin(a * 3) * 0.08 - 0.2, self.z, { ry = a * 2 })
  nova.point_light(self.x, 0.9, self.z, { radius = 3.2, color = k.color })
  fx.want_light(self.x, 1.0, self.z, 5, { k.color[1] / 255, k.color[2] / 255, k.color[3] / 255 }, -30)
end

return Pickup
