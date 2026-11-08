-- The wipe between screens: two cardboard flaps swing shut from the top and the bottom like a box closing, a strip of packing tape runs across where
-- they meet with the name of the place written on it, and the flaps open again when the next screen is ready. The state is in this module, so the
-- wipe survives the change of scene: `cover` starts it and calls back when the screen is covered (the callback changes the scene), and the new scene
-- calls `reveal`.
local ui = require("lib.ui")

local transition = {}

local SHUT, OPEN = 0.42, 0.45
local s = { phase = "idle", t = 0, spec = nil, on_covered = nil, hold = 0 }

-- spec: { title = "STUDIO STREET", sub = "Hello, Sofa", color = { r, g, b } (the tape) }
function transition.cover(spec, on_covered)
  s.phase, s.t, s.spec, s.on_covered = "shutting", 0, spec, on_covered
end

function transition.reveal(hold)
  if s.phase == "covered" or s.phase == "shutting" then s.phase, s.t, s.hold = "holding", 0, hold or 0.35 end
end

function transition.busy() return s.phase ~= "idle" end

function transition.update(dt)
  if s.phase == "idle" then return end
  s.t = s.t + dt
  if s.phase == "shutting" and s.t >= SHUT then
    s.phase, s.t = "covered", 0
    local f = s.on_covered
    s.on_covered = nil
    if f then f() end
  elseif s.phase == "covered" and s.t > 3 then
    s.phase, s.t, s.hold = "holding", 0, 0
  elseif s.phase == "holding" and s.t >= s.hold then
    s.phase, s.t = "opening", 0
  elseif s.phase == "opening" and s.t >= OPEN then
    s.phase, s.spec = "idle", nil
  end
end

local function ease_in(x) x = math.max(0, math.min(1, x)); return x * x * x end
local function ease_out(x) x = math.max(0, math.min(1, x)); return 1 - (1 - x) ^ 3 end

function transition.draw()
  if s.phase == "idle" or not s.spec then return end
  local w, h = nova.view()
  local p -- how shut the flaps are: 0 open, 1 shut
  if s.phase == "shutting" then p = ease_in(s.t / SHUT) * 1.0
  elseif s.phase == "opening" then p = 1 - ease_out(s.t / OPEN)
  else p = 1 end
  local half = h / 2 + 4
  -- the flaps: cardboard with darker edges and a few creases, a little bounce when they meet
  local bounce = (s.phase == "covered" or s.phase == "holding") and math.max(0, 1 - s.t * 5) * math.sin(s.t * 40) * 6 or 0
  local top = -half + half * p + bounce
  local bottom = h - half * p - bounce
  for _, f in ipairs({ { top, true }, { bottom, false } }) do
    local y = f[1]
    nova.ui.rect(0, y, w, half, { 206, 160, 110, 255 })
    nova.ui.rect(0, f[2] and y + half - 10 or y, w, 10, { 170, 124, 80, 255 })
    for i = 1, 5 do
      local cy = y + half * i / 6
      nova.ui.rect(0, cy, w, 2, { 190, 144, 96, 160 })
    end
  end
  -- the tape across the middle, with the title on it
  local show = (s.phase == "covered" or s.phase == "holding") and math.min(1, s.t / 0.12 + (s.phase == "holding" and 1 or 0)) or (s.phase == "opening" and math.max(0, 1 - s.t / 0.12) or 0)
  if show > 0.01 then
    local c = s.spec.color or { 238, 128, 112 }
    local th = 150
    local tw = w * show
    nova.ui.rect(w / 2 - tw / 2, h / 2 - th / 2, tw, th, { 236, 214, 170, 235 })
    nova.ui.rect(w / 2 - tw / 2, h / 2 - th / 2, tw, 8, { c[1], c[2], c[3], 255 })
    nova.ui.rect(w / 2 - tw / 2, h / 2 + th / 2 - 8, tw, 8, { c[1], c[2], c[3], 255 })
    if show > 0.6 then
      local old = ui.alpha
      ui.alpha = (show - 0.6) / 0.4
      local title = s.spec.title or ""
      if title ~= "" then ui.center(title, h / 2 - 50, ui.fit(title, ui.HEAD, w * 0.84), ui.color.ink) end
      if (s.spec.sub or "") ~= "" then ui.center(s.spec.sub, h / 2 + 10, ui.LARGE, { 110, 84, 64 }) end
      ui.alpha = old
    end
  end
end

return transition
