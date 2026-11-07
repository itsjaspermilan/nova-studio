-- The wipe between screens that change a lot (the menu into a game, a game back to the menu): a diagonal front in two flat colours, a darker band leading it,
-- a planet spinning on the covered screen and a line of text. The state is in this module, so the wipe survives the change of scene: `cover` starts it and
-- calls back when the screen is covered (the callback changes the scene), and the new scene calls `reveal`.
local ui = require("lib.ui")

local transition = {}

local PALETTES = {
  menu = { a = { 36, 44, 110 }, b = { 20, 24, 64 } },
  endless = { a = { 24, 110, 150 }, b = { 14, 66, 100 } },
  puzzle = { a = { 110, 70, 190 }, b = { 66, 40, 120 } },
  versus = { a = { 170, 54, 96 }, b = { 100, 28, 60 } },
}
local CREAM = { 240, 246, 255 }
local COVER, REVEAL, SKEW, ROW = 0.5, 0.45, 220, 6

local s = { phase = "idle", t = 0, spec = nil, on_covered = nil, hold = 0, spin = 0, age = 0 }

local function ease(x) x = math.max(0, math.min(1, x)); return x < 0.5 and 4 * x * x * x or 1 - (-2 * x + 2) ^ 3 / 2 end

-- spec: { title = "ENDLESS", sub = "Normal", palette = "endless" }
function transition.cover(spec, on_covered)
  s.phase, s.t, s.spec, s.on_covered, s.age, s.spin = "covering", 0, spec, on_covered, 0, 0
end

function transition.reveal(hold)
  if s.phase == "covered" or s.phase == "covering" then s.phase, s.t, s.hold = "holding", 0, hold or 0.6 end
end

function transition.busy() return s.phase ~= "idle" end
function transition.covering() return s.phase == "covering" or s.phase == "covered" or s.phase == "holding" end

function transition.update(dt)
  if s.phase == "idle" then return end
  s.t = s.t + dt
  s.age = s.age + dt
  s.spin = s.spin + (1.2 + 3 * math.exp(-s.age * 1.2)) * dt
  if s.phase == "covering" and s.t >= COVER then
    s.phase, s.t = "covered", 0
    local f = s.on_covered
    s.on_covered = nil
    if f then f() end
  elseif s.phase == "covered" and s.t > 3 then
    s.phase, s.t, s.hold = "holding", 0, 0
  elseif s.phase == "holding" and s.t >= s.hold then
    s.phase, s.t = "revealing", 0
  elseif s.phase == "revealing" and s.t >= REVEAL then
    s.phase, s.spec = "idle", nil
  end
end

local function edge(p, y, w, h) return p * (w + SKEW + 120) - SKEW - 120 + (y / h) * SKEW end
local function strip(x0, x1, y, w, colour)
  x0, x1 = math.max(0, x0), math.min(w, x1)
  if x1 > x0 then nova.ui.rect(x0, y, x1 - x0, ROW, colour) end
end

function transition.draw()
  if s.phase == "idle" or not s.spec then return end
  local w, h = nova.view()
  local pal = PALETTES[s.spec.palette or "menu"]
  local covered = s.phase ~= "covering" and s.phase ~= "revealing"
  local cp = s.phase == "covering" and ease(s.t / COVER) or 1
  local rp = s.phase == "revealing" and ease(s.t / REVEAL) or 0
  for y = 0, h - 1, ROW do
    if s.phase == "covering" then
      local e = edge(cp, y, w, h)
      strip(0, e, y, w, pal.a)
      strip(e, e + 110, y, w, pal.b)
    elseif s.phase == "revealing" then
      local e = edge(rp, y, w, h)
      strip(e, e + 110, y, w, pal.b)
      strip(e + 110, w, y, w, pal.a)
    else
      strip(0, w, y, w, pal.a)
    end
  end
  local show = covered and math.min(1, s.t / 0.25 + (s.phase == "holding" and 1 or 0)) or (s.phase == "covering" and math.max(0, (cp - 0.7) / 0.3) or math.max(0, 1 - rp * 2.5))
  if show > 0.01 then
    local cx, cy = w / 2, h / 2 - 34
    local r = 150 * (0.6 + 0.4 * show)
    for y = math.floor(cy - r), math.floor(cy + r), ROW do
      local half = math.sqrt(math.max(0, r * r - (y + ROW / 2 - cy) ^ 2))
      if half > 0 then nova.ui.rect(cx - half, y, half * 2, ROW, { pal.b[1], pal.b[2], pal.b[3], math.floor(255 * math.min(1, show * 1.4)) }) end
    end
    for i = 0, 5 do
      local len = 100 + (i * 53) % 120
      local x = ((s.age * (360 + i * 60) + i * 211) % (w + 400)) - 300
      local yy = 60 + i * 84 + (i % 2) * 18
      if yy < cy - 100 or yy > cy + 120 then nova.ui.rect(x, yy, len, 3, { CREAM[1], CREAM[2], CREAM[3], math.floor(90 * show) }) end
    end
    local size = 190 * (0.4 + 0.6 * show)
    nova.ui.sprite("bg/planet03", cx, cy, { w = size, h = size, rotation = s.spin * 0.5, color = { 255, 255, 255, math.floor(255 * math.min(1, show * 1.5)) } })
    local title = s.spec.title or ""
    if title ~= "" then
      local fit = ui.fit(title, 40, w * 0.8)
      ui.center(title, cy + 118, fit, { CREAM[1], CREAM[2], CREAM[3], math.floor(255 * show) })
    end
    if (s.spec.sub or "") ~= "" then ui.center(s.spec.sub, cy + 118 + 54, 16, { CREAM[1], CREAM[2], CREAM[3], math.floor(220 * show) }) end
    for i = 0, 2 do
      local pulse = 0.5 + 0.5 * math.sin(s.age * 6 - i * 0.9)
      local d = 7 + 5 * pulse
      nova.ui.rect(cx - 28 + i * 28 - d / 2, cy + 118 + 92 - d / 2, d, d, { CREAM[1], CREAM[2], CREAM[3], math.floor(255 * show) })
    end
  end
end

return transition
