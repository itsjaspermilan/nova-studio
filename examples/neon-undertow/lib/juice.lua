-- Game feel that every entity shares: the hit-stop, the screen shake, the run's scrap and Phase's slowed time.
-- `stop(n)`: the game's entities hold still for n frames (they check `frozen()` at the top of update).
-- `slow(seconds)`: the enemies' time runs slow (2 frames in 5 at the card's factor): a hostile entity asks `frozen(self)`.
-- The scene calls `tick()` once per step, after the entities.
local J = { hold = 0, shake_amp = 0, shake_left = 0, scrap = 0, step = 0, slow_t = 0 }

function J.reset()
  J.hold, J.shake_amp, J.shake_left, J.scrap, J.step, J.slow_t = 0, 0, 0, 0, 0, 0
end

-- (the frame the hit happens in is spent already, and the tick below takes one off at its end: hence the + 1)
function J.stop(n) if n + 1 > J.hold then J.hold = n + 1 end end
-- Frozen for this frame? An entity passes itself when its time can be slowed (enemies, their shots and attacks); the runner never does.
function J.frozen(e)
  if J.hold > 0 then return true end
  return e ~= nil and J.slow_t > 0 and (J.step % 5) >= 2
end
function J.slow(seconds) if seconds > J.slow_t then J.slow_t = seconds end end

function J.shake(amp, frames)
  if amp >= J.shake_amp or J.shake_left <= 0 then J.shake_amp = amp end
  if frames > J.shake_left then J.shake_left = frames end
end

function J.tick()
  J.step = J.step + 1
  if J.hold > 0 then J.hold = J.hold - 1 end
  if J.slow_t > 0 then J.slow_t = math.max(0, J.slow_t - 1 / 60) end
  if J.shake_left > 0 then J.shake_left = J.shake_left - 1 end
end

-- The camera's shake offset this frame (it alternates, so it reads as a jolt and not as drift).
function J.offset()
  if J.shake_left <= 0 then return 0, 0 end
  local s = (J.step % 2 == 0) and 1 or -1
  local t = (J.step % 4 < 2) and 1 or -1
  return s * J.shake_amp, t * J.shake_amp * 0.5
end

return J
