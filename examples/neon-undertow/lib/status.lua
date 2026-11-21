-- What can be done to an enemy besides damage: stunned, set alight, marked by a shot (Tracer), buffed by a Tout.
-- Enemies call `tick(self, dt)` near the top of update (after the hit-stop check) and `hud(self)` where they draw their bar.
local S = {}
local ENEMY = require("data.enemies")
local Ty = require("lib.type")

local function nz(v) return v or 0 end

function S.stun(e, seconds)
  e.stun_t = math.max(nz(e.stun_t), seconds)
  if e.on_stun then e:on_stun(seconds) end
end

function S.burn(e, seconds, damage)
  e.burn_t, e.burn_dmg = seconds, math.max(nz(e.burn_dmg), damage)
  if nz(e.burn_acc) <= 0 then e.burn_acc = 0 end
end

function S.mark(e, seconds, bonus)
  e.mark_t, e.mark_bonus = seconds, bonus
end

-- A Tout's shout reaches this enemy for another moment.
function S.buff(e) e.buff_t = 0.25 end

-- The speed a buffed enemy moves at (every enemy multiplies its own speeds by this).
function S.speed(e) return nz(e.buff_t) > 0 and ENEMY.tout.mult or 1 end

-- Counts the timers down and applies the burn. Returns true while the enemy is stunned (or gone): it should do nothing else.
function S.tick(e, dt)
  if nz(e.buff_t) > 0 then e.buff_t = math.max(0, e.buff_t - dt) end
  if nz(e.mark_t) > 0 then e.mark_t = math.max(0, e.mark_t - dt) end
  if nz(e.burn_t) > 0 then
    e.burn_t = e.burn_t - dt
    e.burn_acc = nz(e.burn_acc) + dt
    if e.burn_acc >= 1 - 1e-6 then
      e.burn_acc = e.burn_acc - 1
      e:take_hit(e.burn_dmg, 0, 0, 0)
      nova.log(string.format("burn ticks on %s (%d)", e.kind_name or "enemy", e.burn_dmg))
      if not e:is_alive() then return true end
    end
    if e.burn_t <= 1e-6 then e.burn_t, e.burn_acc = 0, 0 end
  end
  if nz(e.stun_t) > 0 then
    e.stun_t = e.stun_t - dt
    if e.stun_t <= 1e-6 then
      e.stun_t = 0
      if e.on_unstun then e:on_unstun() end
    else
      return true
    end
  end
  return false
end

-- Small marks over an enemy's head: buffed (cyan chevron), burning, shot-marked, stunned.
function S.hud(e, x, y)
  local marks = {}
  if nz(e.buff_t) > 0 then marks[#marks + 1] = 0 end
  if nz(e.burn_t) > 0 then marks[#marks + 1] = 1 end
  if nz(e.mark_t) > 0 then marks[#marks + 1] = 2 end
  if nz(e.stun_t) > 0 then marks[#marks + 1] = 3 end
  local n = #marks
  for i, frame in ipairs(marks) do
    nova.ui.sprite("marks", x + (i - (n + 1) / 2) * 22, y, { frame = frame, scale = 0.75 })
  end
  if e.bounty then
    -- Bounty Board: a gold tag over the marked enemy (it pays only if it is the room's first kill)
    local on = require("lib.run").room_kills == 0
    nova.ui.rect(x - 26, y - 22, 52, 16, on and { 255, 228, 94, 255 } or { 90, 90, 100, 255 })
    Ty.text(x - 26, y - 20, "$" .. e.bounty, "small", { color = { 20, 16, 5, 255 }, align = "center", width = 52 })
  end
  if e.leaky then Ty.text(x - 20, y + 4, "leak", "tiny", { color = { 6, 240, 255, 255 }, align = "center", width = 40 }) end
end

return S
