-- What every enemy shares (not placed by itself): a body that walks and falls against the world, turns at walls (and at ledges, unless
-- `ledges` is "fall"), squashes when stomped, and says where it will be (`predict`) for the computer player. Props a scene file may set:
-- dir ("left" or "right"), speed, ledges ("turn" or "fall"). A placed enemy's y is where its feet are.
local world = require("lib.world")
local fx = require("lib.fx")
local audio = require("lib.audio")

local Enemy = nova.entity {
  sprite = "enemies/slime", sx = 0.5, sy = 0.5, pivot = { 0.5, 1 },
  tags = { "enemy" }, depth = 5, velocity = false,
  bw = 38, bh = 30,           -- the body, in units
  walker = true, gravity = true,
  settings = {
    speed = { 55, min = 0, max = 400, step = 5, help = "How fast it walks, in units a second" },
    dir = { "left", choices = { "left", "right" }, help = "The way it walks first" },
    ledges = { "turn", choices = { "turn", "fall" }, help = "At the edge of a ledge: turn round, or walk off" },
  },
  stompable = true,           -- false: hurts from above too (spikes on its head)
  anim_rate = 6,
  dead = false, squash_x = 1, squash_y = 1, flash = 0,
}

local SOLID, ONEWAY = world.SOLID, world.ONEWAY

function Enemy:create()
  if type(self.dir) == "string" then self.dir = self.dir == "right" and 1 or -1 end
  self.b = { x = self.x, y = self.y, w = self.bw, h = self.bh, vx = 0, vy = 0 }
  self.home_x, self.home_y = self.x, self.y
  self.t = (self.x * 0.013) % 1
  self:init()
end
function Enemy:init() end

function Enemy:box()
  local hw = self.bw * 0.5
  return self.x - hw, self.y - self.bh, self.x + hw, self.y
end

-- where the body will be in `dt` seconds (feet), for the computer player's look-ahead
function Enemy:predict(dt)
  if self.dead then return nil end
  if self.walker then return self.x + self.dir * self.speed * dt, self.y end
  return self.x, self.y
end

local function ground_ahead(x, y)
  local f = world.flags_at(x, y + 4)
  if f & (SOLID | ONEWAY) ~= 0 then return true end
  for _, b in ipairs(world.boxes) do
    if not b.off and x >= b.x0 and x <= b.x1 and y + 4 >= b.y0 and y + 4 <= b.y1 then return true end
  end
  return false
end

function Enemy:walk(dt)
  local b = self.b
  b.vx = self.dir * self.speed
  b.vy = math.min(900, b.vy + 2400 * dt)
  world.move(b, b.vx * dt, b.vy * dt, false, true, false)
  if b.hit_x then self.dir = -self.dir end
  if b.ground then
    b.vy = 0
    if self.ledges == "turn" and not ground_ahead(b.x + self.dir * (b.w * 0.5 + 3), b.y) then self.dir = -self.dir end
  end
  self.x, self.y = b.x, b.y
  if self.y > world.height + 200 then self:destroy() end
end

function Enemy:update(dt)
  self.t = self.t + dt
  self.squash_x = self.squash_x + (1 - self.squash_x) * math.min(1, dt * 12)
  self.squash_y = self.squash_y + (1 - self.squash_y) * math.min(1, dt * 12)
  self.flash = math.max(0, self.flash - dt)
  if self.dead then
    self.dead_t = self.dead_t + dt
    if self.dead_t > 0.45 then self.alpha = math.max(0, 1 - (self.dead_t - 0.45) / 0.25) end
    if self.dead_t > 0.7 then self:destroy() end
    if self.fly_off then
      self.vy_off = self.vy_off + 1800 * dt
      self.x, self.y = self.x + self.vx_off * dt, self.y + self.vy_off * dt
    end
    return
  end
  self:act(dt)
end

function Enemy:act(dt)
  if self.walker then self:walk(dt) end
end

-- the frame to show: 0 rest, 1-2 moving, 3 squashed
function Enemy:frame_now()
  if self.dead and not self.fly_off then return 3 end
  return 1 + math.floor(self.t * self.anim_rate) % 2
end

-- (the class's `sprite` is kept by the framework, not as a field)
function Enemy:picture() return rawget(self, "sprite") or getmetatable(self).__sprite end

function Enemy:draw()
  local face = self.dir > 0 and -1 or 1 -- (the pack's enemies look left)
  local bob = 0
  fx.draw(self:picture(), self.x, self.y - 24 * self.squash_y + bob, {
    frame = self:frame_now(), sx = 0.5 * face * self.squash_x, sy = 0.5 * self.squash_y * (self.fly_off and -1 or 1),
    alpha = self.alpha, color = self.flash > 0 and { 255, 160, 160 } or nil,
  })
end

-- stomped from above: flattened, then gone. Returns true when it was a stomp (false for one that cannot be stomped)
function Enemy:stomp(hero)
  if not self.stompable then return false end
  self:die(false)
  self.squash_x, self.squash_y = 1.5, 0.5
  audio.sfx("stomp", { pitch = 0.95 + math.random() * 0.1 })
  fx.dust(self.x, self.y - 6, 8)
  fx.ring(self.x, self.y - 14)
  return true
end

-- knocked out from the side (a shell, a falling block): flips and falls off the screen
function Enemy:knock(from_x)
  self:die(true)
  self.vx_off = (self.x < from_x and -1 or 1) * 160
  self.vy_off = -520
  audio.sfx("stomp", { pitch = 1.2 })
end

function Enemy:die(fly)
  self.dead, self.dead_t, self.fly_off = true, 0, fly
  self.depth = -15
end

return Enemy
