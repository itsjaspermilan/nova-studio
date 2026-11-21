-- A door set in a vertical wall (a gap two tiles tall). Open at first; the room shuts it when the fight starts (solid, magenta
-- light), unlocks it when the fight is won (cyan light, bars still down for an exit door: the cards must be taken first) and opens it.
-- Props: exit (true: walking through it ends the room), leads_to (the scene it opens onto).
local P = require("data.player")
local Run = require("lib.run")
local Look = require("data.look")

local Door = nova.entity {
  sprite = "door", anim = "open", tags = { "door", "solid" }, velocity = false, sx = 1.5, sy = 1.5,
  pivot = { 0.5, 0.5 }, hitbox = { 0, 0, 0, 0 }, exit = false, leads_to = "", state = "open",
}

function Door:create() self.depth = -self.y - 40 end

-- (the shutter's lamp: magenta while it is locked, cyan when it unlocks; the shape is the old one, doubled for the halved scale)
local function lamp(self, color) self.light = { radius = Look.door.radius, radius_y = Look.door.radius * 0.9, color = color, intensity = Look.door.intensity, y = -40 } end

local function closed(self) self.hitbox = { -16, -32, 32, 64 } end

function Door:shut(quiet)
  self.state = "locked"
  closed(self)
  self:play("locked")
  lamp(self, Look.door.locked)
  if not quiet then nova.sound.play("door_shut", { volume = P.sfx.door_shut }) end
end

function Door:unlock(quiet)
  self.state = "unlocked"
  self:play("unlocked")
  lamp(self, Look.door.open)
  self.unlock_t = 0
  if not quiet then nova.sound.play("door_unlock", { volume = P.sfx.door_unlock }) end
end

function Door:open(quiet)
  self.state = "open"
  self.hitbox = { 0, 0, 0, 0 }
  self:play("open")
  lamp(self, Look.door.open)
  if not quiet then nova.sound.play("door_open", { volume = P.sfx.door_open }) end
end

-- (a door of a district run has no `leads_to`: the run's chain says which room comes next, lib/run.lua)
function Door:update(dt)
  if self.unlock_t then
    -- the lamp flares when the door unlocks, then settles
    self.unlock_t = self.unlock_t + dt
    local k = math.max(0, 1 - self.unlock_t / 0.6)
    if self.light then self.light = { radius = Look.door.radius * (1 + k), radius_y = Look.door.radius * 0.9 * (1 + k), color = Look.door.open, intensity = Look.door.intensity * (1 + 2 * k), y = -40 } end
    if self.unlock_t > 0.6 then self.unlock_t = nil end
  end
  if self.exit and self.state == "open" and not self.gone and (self.leads_to ~= "" or Run.chain) then
    local p = nova.first("player")
    if p and p.state ~= "dead" and math.abs(p.x - self.x) < 40 and math.abs(p.y - self.y) < 44 then
      Run.take_from(p)
      local dest = self.leads_to
      if dest == "" then
        dest = Run.exit_room()
      else
        Run.room = Run.room + 1
      end
      nova.log("through the door to " .. dest)
      nova.goto_scene(dest)
      self.gone = true
    end
  end
end

return Door
