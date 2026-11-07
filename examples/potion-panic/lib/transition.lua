-- The wipe between screens: a potion fills the screen from the bottom (a wavy surface, bubbles rising through it), the name of the place is written on it, and
-- it drains away downwards when the next screen is ready. The state is in this module, so the wipe survives the change of scene: `cover` starts it and
-- calls back when the screen is covered (the callback changes the scene), and the new scene calls `reveal`.
local ui = require("lib.ui")

local transition = {}

local FILL, DRAIN, STEP = 0.55, 0.5, 10
local s = { phase = "idle", t = 0, spec = nil, on_covered = nil, hold = 0, age = 0 }

-- spec: { title = "GREENHOLLOW MEADOW", sub = "Cottage Garden", color = { r, g, b } }
function transition.cover(spec, on_covered)
  s.phase, s.t, s.spec, s.on_covered, s.age = "filling", 0, spec, on_covered, 0
end

function transition.reveal(hold)
  if s.phase == "covered" or s.phase == "filling" then s.phase, s.t, s.hold = "holding", 0, hold or 0.5 end
end

function transition.busy() return s.phase ~= "idle" end
function transition.covering() return s.phase == "filling" or s.phase == "covered" or s.phase == "holding" end

function transition.update(dt)
  if s.phase == "idle" then return end
  s.t = s.t + dt
  s.age = s.age + dt
  if s.phase == "filling" and s.t >= FILL then
    s.phase, s.t = "covered", 0
    local f = s.on_covered
    s.on_covered = nil
    if f then f() end
  elseif s.phase == "covered" and s.t > 3 then
    s.phase, s.t, s.hold = "holding", 0, 0
  elseif s.phase == "holding" and s.t >= s.hold then
    s.phase, s.t = "draining", 0
  elseif s.phase == "draining" and s.t >= DRAIN then
    s.phase, s.spec = "idle", nil
  end
end

local function ease(x) x = math.max(0, math.min(1, x)); return x < 0.5 and 2 * x * x or 1 - (-2 * x + 2) ^ 2 / 2 end

-- the surface height (from the bottom, 0 to 1 and a little over) of the liquid in column i, as it fills or drains
local function level(p, x, w, age)
  local wave = math.sin(x * 0.018 + age * 6) * 14 + math.sin(x * 0.041 - age * 4) * 7
  return p, wave
end

function transition.draw()
  if s.phase == "idle" or not s.spec then return end
  local w, h = nova.view()
  local col = s.spec.color or { 120, 70, 170 }
  local dark = { col[1] * 0.72, col[2] * 0.72, col[3] * 0.72 }
  local light = { math.min(255, col[1] * 1.25 + 20), math.min(255, col[2] * 1.25 + 20), math.min(255, col[3] * 1.25 + 20) }
  local p
  if s.phase == "filling" then p = ease(s.t / FILL)
  elseif s.phase == "draining" then p = 1 - ease(s.t / DRAIN)
  else p = 1 end
  -- the liquid, in columns
  local top_h = p * (h + 60)
  for x = 0, w - 1, STEP do
    local _, wave = level(p, x, w, s.age)
    local top = h - top_h + wave * (p < 1 and 1 or 0.2)
    if top < h then
      local y0 = math.max(0, top)
      nova.ui.rect(x, y0, STEP, h - y0, { col[1], col[2], col[3], 255 })
      nova.ui.rect(x, y0, STEP, 5, { light[1], light[2], light[3], 255 }) -- the bright surface
      nova.ui.rect(x, math.min(h - 1, y0 + h * 0.55), STEP, h, { dark[1], dark[2], dark[3], 120 }) -- darker at the bottom
    end
  end
  -- bubbles
  if p > 0.05 then
    for i = 1, 22 do
      local bx = (i * 97 + (i * 53) % 71) % w
      local rise = (s.age * (30 + i * 4) + i * 40) % (h * 0.9)
      local by = h - rise
      local size = 6 + (i * 7) % 14
      if by > h - top_h + 10 then nova.ui.sprite("ui/disc", bx, by, { w = size, h = size, color = { 150, 100, 80, 70 } }) end
    end
  end
  local show = (s.phase == "covered" or s.phase == "holding") and math.min(1, s.t / 0.25 + (s.phase == "holding" and 1 or 0)) or (s.phase == "filling" and math.max(0, (p - 0.75) / 0.25) or math.max(0, (p - 0.5) * 2))
  if show > 0.02 then
    local old = ui.alpha
    ui.alpha = show
    local title = s.spec.title or ""
    if title ~= "" then ui.center(title, h / 2 - 54, ui.fit(title, ui.HEAD + 6, w * 0.84, "display"), ui.color.cream, { font = "display", shadow = true }) end
    if (s.spec.sub or "") ~= "" then ui.center(s.spec.sub, h / 2 + 22, ui.LARGE, ui.color.cream, { shadow = true }) end
    ui.alpha = old
  end
end

return transition
