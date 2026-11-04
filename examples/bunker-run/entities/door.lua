local state = require("lib.state")
local Level = require("lib.level")

-- A door: a wall until it is open. It opens when the player (or something that wants to get through) comes close, if it is not
-- locked; the red one needs the key. It rises into the ceiling.
local Door = nova.entity { tags = { "door" } }

function Door:create()
  self.t = 0 -- 0 shut, 1 open
  self.hold = 0
  self.half = Level.CELL / 2
  local hx, hz = self.ew and 0.2 or self.half, self.ew and self.half or 0.2
  self.hx, self.hz = hx, hz
  self.wall = nova.walls.add(self.x - hx, self.z - hz, self.x + hx, self.z + hz, 0, Level.HEIGHT)
  self.blocking = true
end

local near = {}

function Door:update(dt)
  local p = nova.first("player")
  local want = false
  if p then
    local dx, dz = p.x - self.x, p.z - self.z
    local d2 = dx * dx + dz * dz
    if d2 < 9 then
      if self.locked and not state.key then
        if d2 < 6 and not self.told then self.told = true; state.say("a red door: it needs the key", 2.5); nova.sound.play("click", { volume = 0.6 }) end
      else
        want = true
      end
    else
      self.told = false
    end
  end
  -- things that want to get through open it too
  if not self.locked and #nova.in_radius(self.x, self.z, 2.4, "enemy", near) > 0 then want = true end
  if want then self.hold = 1.5 else self.hold = self.hold - dt end
  local was = self.t
  if self.hold > 0 then self.t = math.min(1, self.t + dt * 1.6) else self.t = math.max(0, self.t - dt * 1.2) end
  if was == 0 and self.t > 0 then
    nova.sound.play("door", { volume = 0.9, at = { self.x, 1.5, self.z }, range = 30 })
  end
  -- it is open enough to walk through when it has risen past a man's height
  local should_block = self.t < 0.6
  if should_block ~= self.blocking then
    self.blocking = should_block
    nova.walls.enable(self.wall, should_block)
    Level.nav_dirty = true
  end
end

function Door:draw()
  local lift = self.t * (Level.HEIGHT + 0.1)
  local color = self.locked and { 150, 40, 40 } or { 120, 128, 140 }
  nova.cuboid(self.x - self.hx, lift, self.z - self.hz, self.x + self.hx, Level.HEIGHT + lift, self.z + self.hz, { color = color })
  -- a strip of light on it: red when it is locked
  local glow = self.locked and { 255, 60, 40 } or { 90, 200, 255 }
  nova.cuboid(self.x - self.hx - 0.01, lift + 1.4, self.z - self.hz - 0.01, self.x + self.hx + 0.01, lift + 1.55, self.z + self.hz + 0.01, { color = glow, glow = true })
end

return Door
