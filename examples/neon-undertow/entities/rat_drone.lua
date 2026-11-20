-- The Rat-drone: a toy car with a blade. Creeps up, then revs for `tell` seconds (the lane it will take is drawn on the ground,
-- shaking, its own sound), charges straight along that lane, and hurts on contact only while charging. A wall or cover stops it
-- dead: it is stunned for `stun` seconds and takes the crash. Numbers: data/enemies.lua.
local E = require("data.enemies").rat_drone
local P = require("data.player")
local D = require("lib.draw")
local Status = require("lib.status")
local Foe = require("entities.foe")

local Drone = nova.entity(Foe, {
  sprite = "rat_drone", anim = "idle", tags = { "hurtable", "enemy", "rat_drone" },
  pivot = { 0.5, 0.5 }, hitbox = { -5, -5, 10, 10 },
})

function Drone:create()
  self.E, self.kind_name = E, "rat_drone"
  self:setup()
  self.state = "idle"      -- idle | creep | tell | charge | recover | stunned | dead
  self.dir_x, self.dir_y = 1, 0
  self.charges = 0
  self.crashes = 0
  self.travelled = 0
end

function Drone:hips() return self.x, self.y end

function Drone:on_stun()
  if self.state == "tell" or self.state == "charge" then self.state = "stunned" end
end

function Drone:on_unstun()
  self.state, self.t = "creep", 0
  nova.log("rat_drone recovers")
end

function Drone:crash()
  self.crashes = self.crashes + 1
  nova.sound.play("wall_thud", { volume = P.sfx.wall_thud })
  nova.spawn("fx", self.x + self.dir_x * 14, self.y + self.dir_y * 14, { sprite = "fx_spark", anim = "spark", scale = 3 })
  nova.log(string.format("rat_drone hits a wall after %.0f", self.travelled))
  self.state = "stunned"
  Status.stun(self, E.stun)
  nova.log("rat_drone stunned")
  self:take_hit(E.crash_damage, 0, 0, 0)
end

function Drone:update(dt)
  if self:tick(dt) then
    if self.state == "stunned" then self:play("hit") end
    return
  end
  local p = nova.first("player")
  local dx, dy, dist = 0, 0, 1e9
  if p then dx, dy = p.x - self.x, p.y - self.y; dist = math.sqrt(dx * dx + dy * dy) end
  local alive = p and p.state ~= "dead"
  local s = self.state
  local sp = Status.speed(self)

  if s == "idle" then
    if alive and dist < E.aggro then self.state = "creep" end
  elseif s == "creep" then
    if not alive then self.state = "idle"
    elseif dist < E.start_dist then
      self.state, self.t = "tell", 0
      local len = math.max(dist, 1)
      self.dir_x, self.dir_y = dx / len, dy / len        -- the lane is chosen now: the runner can step out of it
      self.angle = math.atan(self.dir_y, self.dir_x) + math.pi / 2
      nova.sound.play("rev_up", { volume = P.sfx.rev_up })
      nova.log("rat_drone tell")
    else
      local len = math.max(dist, 1)
      self:move(dx / len * E.speed * sp * dt, dy / len * E.speed * sp * dt)
      self.angle = math.atan(dy, dx) + math.pi / 2
    end
  elseif s == "tell" then
    if self.t >= E.tell then
      self.state, self.t, self.travelled, self.hit_runner = "charge", 0, 0, false
      self.charges = self.charges + 1
      nova.log("rat_drone charges")
    end
  elseif s == "charge" then
    local step = E.charge.speed * sp * dt
    local blocked = self:move(self.dir_x * step, self.dir_y * step)
    self.travelled = self.travelled + step
    if alive and not self.hit_runner and self:overlaps(p) then
      self.hit_runner = p:take_damage(E.charge.damage) or false
      if self.hit_runner then nova.log("rat_drone hit lands") end
    end
    if blocked then self:crash()
    elseif self.t >= E.charge.max_time then self.state, self.t = "recover", 0 end
  elseif s == "recover" then
    if self.t >= E.recover then self.state, self.t = "creep", 0 end
  end

  if self.flash > 0 or self.state == "stunned" then self:play("hit")
  elseif self.state == "charge" or self.state == "creep" then self:play("move")
  else self:play("idle") end
  if self.state == "tell" then
    self.tint = (math.floor(self.t * 14) % 2 == 0) and { 255, 150, 235 } or { 255, 255, 255 }
    self.x = self.x + ((math.floor(self.t * 40) % 2 == 0) and 1.2 or -1.2)
  else
    self.tint = nil
  end
end

-- The lane it will charge along, drawn while it revs (as long as the charge goes, as wide as the blade).
function Drone:draw()
  if self.state == "tell" then
    local len = E.charge.speed * E.charge.max_time
    local a = 28 + 44 * (math.floor(self.t * 12) % 2)
    D.lane(self.x, self.y, self.x + self.dir_x * len, self.y + self.dir_y * len, E.charge.lane_half * 2, { 255, 43, 214, a })
  end
  nova.Entity.draw(self)
end

function Drone:bar_y() return self.y - 50 end

return Drone
