-- A door set in a vertical wall (a gap two tiles tall). Open at first; the room shuts it when the fight starts (solid, magenta
-- light), unlocks it when the fight is won (cyan light, bars still down for an exit door: the cards must be taken first) and opens it.
-- Props: exit (true: walking through it ends the room), leads_to (the scene it opens onto).
local P = require("data.player")
local Run = require("lib.run")

local Door = nova.entity {
  sprite = "door", anim = "open", tags = { "door", "solid" }, velocity = false, sx = 3, sy = 3,
  pivot = { 0.5, 0.5 }, hitbox = { 0, 0, 0, 0 }, exit = false, leads_to = "", state = "open",
}

function Door:create() self.depth = -self.y - 40 end

local function closed(self) self.hitbox = { -8, -16, 16, 32 } end

function Door:shut(quiet)
  self.state = "locked"
  closed(self)
  self:play("locked")
  if not quiet then nova.sound.play("door_shut", { volume = P.sfx.door_shut }) end
end

function Door:unlock(quiet)
  self.state = "unlocked"
  self:play("unlocked")
  if not quiet then nova.sound.play("door_unlock", { volume = P.sfx.door_unlock }) end
end

function Door:open(quiet)
  self.state = "open"
  self.hitbox = { 0, 0, 0, 0 }
  self:play("open")
  if not quiet then nova.sound.play("door_open", { volume = P.sfx.door_open }) end
end

function Door:update(dt)
  if self.exit and self.state == "open" and self.leads_to ~= "" then
    local p = nova.first("player")
    if p and p.state ~= "dead" and math.abs(p.x - self.x) < 40 and math.abs(p.y - self.y) < 44 then
      Run.take_from(p)
      Run.room = Run.room + 1
      nova.log("through the door to " .. self.leads_to)
      nova.goto_scene(self.leads_to)
      self.leads_to = ""
    end
  end
end

return Door
