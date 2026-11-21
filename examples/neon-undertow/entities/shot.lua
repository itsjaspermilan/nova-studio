-- The runner's shot: flies straight, hurts the first "hurtable" it meets (a slug goes through `pierce` of them), stops at walls and at solid
-- things. Props (set by the runner from the run's modifiers): dx, dy, damage, bounces, pierce, cost (pips it cost), smart (an enemy to curve
-- towards: Smart Round).
local P = require("data.player")
local J = require("lib.juice")
local Hits = require("lib.hits")
local Field = require("lib.field")
local Run = require("lib.run")
local Cards = require("data.cards")
local V = require("lib.vfx")
local LK = require("lib.look")

local Shot = nova.entity {
  sprite = "fx_shot", anim = "fly", tags = { "shot" }, hitbox = { r = 6 }, sx = 1.5, sy = 1.5, velocity = false, blend = "add", lit = false, light = { radius = 70, color = { 53, 230, 255 }, intensity = 1.6 }, travelled = 0, bounces = 0, damage = P.aim.shot_damage,
  pierce = 1, cost = 1,
}

function Shot:create()
  self.angle = math.atan(self.dy, self.dx)
  self.depth = -self.y - 5
  self.struck = {}
  self.trail = {}
  -- the muzzle flash: a cone of light along the shot's way, at the runner's hand
  local s = self.slug and 1.3 or 1
  nova.spawn("fx", self.x + self.dx * 22 * s, self.y + self.dy * 22 * s, { sprite = "fx_muzzle", anim = "flash", angle = self.angle, scale = 2 * s })
  V.sparks(self.x, self.y, 3, { z = 0, angle = self.angle, spread = 0.5, speed = 360, up = 40, life = 0.3, colors = { "spark_white", "spark_cyan" }, size = 16 })
end

-- The shot's glow and the trail of light behind it: seven fading copies of its head along where it has been.
function Shot:draw()
  local s = self.slug and 1.5 or 1
  local n = #self.trail
  for i, p in ipairs(self.trail) do
    local k = i / (n + 1)
    local sx, sy = nova.cam.to_screen(p[1], p[2])
    nova.sprite("fx_dot", sx, sy, { w = 26 * k * s, h = 26 * k * s, color = { 255, 255, 255, 190 * k }, blend = "add", lit = false })
  end
  if V.glow() then LK.halo(self.x, self.y, 40 * s, { 53, 230, 255 }, 120) end
  nova.Entity.draw(self)
end

-- The shot ends. `fire`: it ended on something (an enemy, a wall), not at the end of its range: Incendiary leaves a patch of fire there.
function Shot:pop(fire)
  nova.spawn("fx", self.x, self.y, { sprite = "fx_impact", anim = "burst", scale = self.slug and 4.2 or 2.8 })
  V.sparks(self.x, self.y, self.slug and 14 or 7, { z = 6, speed = 260, up = 160, life = 0.45, colors = { "spark_white", "spark_cyan", "spark_cyan" } })
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
  self.trail[#self.trail + 1] = { self.x, self.y }
  if #self.trail > 7 then table.remove(self.trail, 1) end
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
    nova.spawn("fx", self.x, self.y, { sprite = "fx_impact", anim = "burst", scale = 2.2 })
    V.sparks(self.x, self.y, 5, { z = 6, speed = 240, up = 120, life = 0.4, colors = { "spark_white", "spark_cyan" } })
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
