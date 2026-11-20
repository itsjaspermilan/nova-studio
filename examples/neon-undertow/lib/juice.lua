-- Game feel that every entity shares: the hit-stop, the screen shake and the run's scrap.
-- `stop(n)`: the game's entities hold still for n frames (they check `frozen()` at the top of update).
-- The scene calls `tick()` once per step, after the entities.
local J = { hold = 0, shake_amp = 0, shake_left = 0, scrap = 0, step = 0 }

function J.reset()
  J.hold, J.shake_amp, J.shake_left, J.scrap, J.step = 0, 0, 0, 0, 0
end

-- (the frame the hit happens in is spent already, and the tick below takes one off at its end: hence the + 1)
function J.stop(n) if n + 1 > J.hold then J.hold = n + 1 end end
function J.frozen() return J.hold > 0 end

function J.shake(amp, frames)
  if amp >= J.shake_amp or J.shake_left <= 0 then J.shake_amp = amp end
  if frames > J.shake_left then J.shake_left = frames end
end

function J.tick()
  J.step = J.step + 1
  if J.hold > 0 then J.hold = J.hold - 1 end
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
