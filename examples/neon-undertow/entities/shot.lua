-- The runner's shot: flies straight, hurts the first "hurtable" it meets, stops at walls and at solid things.
local P = require("data.player")
local J = require("lib.juice")

local Shot = nova.entity {
  sprite = "fx_shot", anim = "fly", tags = { "shot" }, hitbox = { r = 3 }, sx = 3, sy = 3, velocity = false, travelled = 0,
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
  if bx or by or self.travelled > P.aim.shot_range then return self:pop() end
  for _, e in ipairs(nova.all("hurtable")) do
    if self:overlaps(e) then
      if e:take_hit(P.aim.shot_damage, self.dx, self.dy, 0) then nova.log("shot hit: " .. P.aim.shot_damage .. " damage") end
      return self:pop()
    end
  end
  if self:touching("solid") then return self:pop() end
end

return Shot
