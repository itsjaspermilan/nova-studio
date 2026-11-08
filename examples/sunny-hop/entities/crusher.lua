-- A stone block that waits high up and slams down when the hero passes underneath, then climbs back. Its top is safe to bounce on; its sides
-- and bottom hurt. Props: reach (tiles it can fall, default 8).
local world = require("lib.world")
local fx = require("lib.fx")
local audio = require("lib.audio")
local Enemy = require("entities.enemy")
local Crusher = nova.entity(Enemy, { sprite = "enemies/crusher", bw = 46, bh = 46, walker = false, stompable = false, bounce_top = true, reach = 8, mode = "wait", wait_t = 0, vy = 0 })

function Crusher:act(dt)
  local hero = nova.first("hero")
  if self.mode == "wait" then
    if hero and math.abs(hero.x - self.x) < 70 and hero.y > self.y and hero.y < self.y + self.reach * 48 + 60 then self.mode, self.vy = "fall", 0 end
  elseif self.mode == "fall" then
    self.vy = math.min(1100, self.vy + 3000 * dt)
    local b = self.b
    world.move(b, 0, self.vy * dt, false, false, false)
    self.x, self.y = b.x, b.y
    if b.ground or self.y >= self.home_y + self.reach * 48 then
      self.mode, self.wait_t = "rest", 1.0
      audio.sfx("bump", { pitch = 0.6, volume = 1 })
      fx.dust(self.x - 20, self.y, 5); fx.dust(self.x + 20, self.y, 5)
      if hero and math.abs(hero.x - self.x) < 400 then fx.shake(0.35) end
    end
  elseif self.mode == "rest" then
    self.wait_t = self.wait_t - dt
    if self.wait_t <= 0 then self.mode = "rise" end
  else
    self.y = math.max(self.home_y, self.y - 120 * dt)
    self.b.y = self.y
    if self.y <= self.home_y then self.mode = "wait" end
  end
end
function Crusher:predict(dt)
  if self.mode == "fall" then return self.x, math.min(self.home_y + self.reach * 48, self.y + 1000 * dt) end
  return self.x, self.y
end
function Crusher:frame_now() return self.mode == "fall" and 2 or (self.mode == "wait" and 1 or 0) end
function Crusher:draw() fx.draw("enemies/crusher", self.x, self.y - 24, { frame = self:frame_now() }) end
return Crusher
