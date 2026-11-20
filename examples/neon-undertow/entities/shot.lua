-- The runner's shot: flies straight, hurts the first "hurtable" it meets, stops at walls and at solid things.
local P = require("data.player")
local J = require("lib.juice")
local Hits = require("lib.hits")

local Shot = nova.entity {
  sprite = "fx_shot", anim = "fly", tags = { "shot" }, hitbox = { r = 3 }, sx = 3, sy = 3, velocity = false, travelled = 0, bounces = 0, damage = P.aim.shot_damage,
}

function Shot:create()
  self.angle = math.atan(self.dy, self.dx)
  self.depth = -self.y - 5
end

function Shot:pop()
  nova.spawn("fx", self.x, self.y, { sprite = "fx_spark", anim = "spark", scale = 2 })
  self:destroy()
end

function Shot:update(dt)
  if J.frozen() then return end
  local step = P.aim.shot_speed * dt
  local bx, by = self:slide(self.dx * step, self.dy * step)
  self.travelled = self.travelled + step
  if self.travelled > P.aim.shot_range then return self:pop() end
  if bx or by then
    -- Ricochet: a wall turns the shot back (once for each time the card was taken); otherwise it stops
    if self.bounces <= 0 then return self:pop() end
    self.bounces = self.bounces - 1
    if bx then self.dx = -self.dx end
    if by then self.dy = -self.dy end
    self.angle = math.atan(self.dy, self.dx)
    nova.spawn("fx", self.x, self.y, { sprite = "fx_spark", anim = "spark", scale = 2 })
    nova.sound.play("ricochet", { volume = P.sfx.ricochet })
    nova.log("shot ricochets")
    return
  end
  for _, e in ipairs(nova.all("hurtable")) do
    if self:overlaps(e) then
      Hits.from = "shot"
      local took = e:take_hit(self.damage, self.dx, self.dy, 0)
      Hits.from = nil
      if took then
        nova.log("shot hit: " .. self.damage .. " damage")
        Hits.after_shot(e)
      end
      return self:pop()
    end
  end
  if self:touching("solid") then return self:pop() end
end

return Shot
