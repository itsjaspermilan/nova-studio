-- Elites: a normal enemy made bigger and tougher with one mark (data/elites.lua). `make` wraps the enemy's own take_hit and die, so any
-- enemy can be an elite; the marks that need to run every frame (a pull, a link, the shield's picture) live in entities/elite_fx.lua.
local D = require("data.elites")
local Ty = require("lib.type")
local C = require("lib.combat")
local Hits = require("lib.hits")
local Status = require("lib.status")
local F = require("lib.fx")
local P = require("data.player")

local E = {}

-- The little bar and name over an elite (or a small one): the enemy's own `hud` is replaced because it measures against its kind's health.
function E.hud(self)
  if self.state == "dead" then return end
  local k = self.size_mult or 1
  local x, y = nova.cam.to_screen(self.x, self.y - 82 * k)
  local w = 40 * math.max(1, k)
  if self.hp < self.max_hp or self.elite then
    nova.ui.rect(x - w / 2, y, w, 5, { 5, 6, 15, 220 })
    nova.ui.rect(x - w / 2 + 1, y + 1, (w - 2) * math.max(0, self.hp) / self.max_hp, 3, { 255, 43, 214, 255 })
  end
  if self.elite then
    Ty.text(x - 80, y - 20, D.marks[self.elite].name, "small", { color = { 255, 228, 94, 255 }, align = "center", width = 160, shadow = true })
    Status.hud(self, x, y - 34)
  else
    Status.hud(self, x, y - 14)
  end
end

-- `size` times as big, `health_mult` times the health (a hit enemy keeps nothing: this is for the moment it is made).
function E.resize(e, size, health_mult)
  e.sx, e.sy = e.sx * size, e.sy * size
  e.size_mult = (e.size_mult or 1) * size
  e.max_hp = math.max(1, math.floor(e.hp * health_mult + 0.5))
  e.hp = e.max_hp
  e.hud = E.hud
end

-- Is a shot travelling (dx, dy) hitting the front of `e`? (Its front is the way it faces.)
function E.front(e, dx, dy)
  local v = C.vec[e.facing or "down"]
  return v[1] * dx + v[2] * dy < -0.1
end

function E.split(e, m)
  for i = 1, m.count do
    local side = (i == 1) and -1 or 1
    local c = nova.spawn(e.kind_name, e.x + side * m.spread * (m.count > 2 and i / 2 or 1), e.y + 6)
    E.resize(c, m.size, m.health)
    c.elite_child = true
    nova.log(string.format("a small %s steps out (health %d)", e.kind_name, c.hp))
  end
end

-- Makes `e` an elite with `mark` (one of data/elites.lua's order).
function E.make(e, mark)
  local m = D.marks[mark]
  if not m then error("no elite mark called " .. tostring(mark)) end
  e.elite = mark
  E.resize(e, D.size, D.health)
  local take_hit, die = e.take_hit, e.die
  e.take_hit = function(self, damage, dx, dy, knock)
    if mark == "shielded" and Hits.from == "shot" and E.front(self, dx, dy) then
      self.blocked = (self.blocked or 0) + 1
      nova.sound.play("ricochet", { volume = P.sfx.ricochet })
      F.spark(self.x, self.y - 14 * self.size_mult, 3)
      nova.log("shielded: the shot is blocked")
      return false
    end
    return take_hit(self, damage, dx, dy, knock)
  end
  e.die = function(self)
    if mark == "splitting" then E.split(self, m) end
    if mark == "volatile" then
      nova.spawn("fuse", self.x, self.y, { time = m.fuse, spec = { radius = m.radius, runner = m.runner, enemy = m.enemy, prop = m.enemy } })
      nova.log("volatile: the fuse is lit")
    end
    die(self)
  end
  nova.spawn("elite_fx", e.x, e.y, { owner = e, mark = mark })
  nova.log(string.format("elite: %s %s (health %d)", m.name, e.kind_name, e.hp))
end

return E
