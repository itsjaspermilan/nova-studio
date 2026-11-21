-- The runner's shot: flies straight, hurts the first "hurtable" it meets (a slug goes through `pierce` of them), stops at walls and at solid
-- things. Props (set by the runner from the run's modifiers): dx, dy, damage, bounces, pierce, cost (pips it cost), smart (an enemy to curve
-- towards: Smart Round).
local P = require("data.player")
local J = require("lib.juice")
local Hits = require("lib.hits")
local Field = require("lib.field")
local Run = require("lib.run")
local Cards = require("data.cards")

local Shot = nova.entity {
  sprite = "fx_shot", anim = "fly", tags = { "shot" }, hitbox = { r = 3 }, sx = 3, sy = 3, velocity = false, travelled = 0, bounces = 0, damage = P.aim.shot_damage,
  pierce = 1, cost = 1,
}

function Shot:create()
  self.angle = math.atan(self.dy, self.dx)
  self.depth = -self.y - 5
  self.struck = {}
end

-- The shot ends. `fire`: it ended on something (an enemy, a wall), not at the end of its range: Incendiary leaves a patch of fire there.
function Shot:pop(fire)
  nova.spawn("fx", self.x, self.y, { sprite = "fx_spark", anim = "spark", scale = 2 })
  if fire and Run.mods.incendiary > 0 then
    local N = Cards.num.incendiary
    nova.spawn("fire", self.x, self.y, { life = N.life + N.per_copy * (Run.mods.incendiary - 1), friendly = true })
  end
  self:destroy()
end

-- Smart Round: turn towards the chosen enemy (or, when it is gone, the nearest one still ahead) a little each frame.
function Shot:steer(dt)
  local t = self.smart
  if not (t and t.state ~= "dead" and t:is_alive()) then
    t = nil
    local bd = 1e9
    for _, e in ipairs(nova.all("enemy")) do
      if e.state ~= "dead" then
        local ex, ey = e.x - self.x, e.y - 14 - self.y
        local along = ex * self.dx + ey * self.dy
        if along > 0 and along < 500 then
          local off = math.abs(ex * self.dy - ey * self.dx)
          if off < bd then t, bd = e, off end
        end
      end
    end
    self.smart = t
  end
  if not t then return end
  local want = math.atan(t.y - 14 - self.y, t.x - self.x)
  local have = math.atan(self.dy, self.dx)
  local diff = (want - have + math.pi) % (2 * math.pi) - math.pi
  local turn = math.max(-5 * dt, math.min(5 * dt, diff))
  self.dx, self.dy = math.cos(have + turn), math.sin(have + turn)
  self.angle = have + turn
end

function Shot:update(dt)
  if J.frozen() then return end
  -- Mother Coil's magnetised stripes bend a shot's path while it is inside one
  local w = Field.omega(self.x, self.y)
  if w ~= 0 then
    local c, s = math.cos(w * dt), math.sin(w * dt)
    self.dx, self.dy = self.dx * c - self.dy * s, self.dx * s + self.dy * c
    self.angle = math.atan(self.dy, self.dx)
    self.curved = (self.curved or 0) + math.abs(w * dt)
  end
  if self.smart then self:steer(dt) end
  local step = P.aim.shot_speed * dt
  local bx, by = self:slide(self.dx * step, self.dy * step)
  self.travelled = self.travelled + step
  if self.travelled > P.aim.shot_range then return self:pop() end
  if bx or by then
    -- Ricochet: a wall turns the shot back (once for each time the card was taken); otherwise it stops
    if self.bounces <= 0 then return self:pop(true) end
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
    if not self.struck[e] and self:overlaps(e) then
      self.struck[e] = true
      Hits.from = "shot"
      local took = e:take_hit(self.damage, self.dx, self.dy, 0)
      Hits.from = nil
      if took then
        nova.log("shot hit: " .. self.damage .. " damage")
        Hits.after_shot(e)
        if e.state == "dead" or not e:is_alive() then Hits.shot_kill(self) end
      end
      self.pierce = self.pierce - 1
      if self.pierce <= 0 then return self:pop(true) end
    end
  end
  local solid = self:touching("solid")
  if solid and not self.struck[solid] then return self:pop(true) end
end

return Shot
