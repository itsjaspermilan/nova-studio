-- The transition screens: flat, two-colour and simple (in the spirit of Breath of the Wild's loading screens). A diagonal wipe in the country's colour
-- (a darker band leads it) covers the picture, a cream wheel spins on a darker disc with the name of the place under it, and when the next scene is
-- ready the wipe carries on off the other side. Used going into a race and coming out of it. The state is in this module, so the wipe survives the
-- change of scene: `cover` starts it and calls back when the screen is covered (the callback changes the scene), and the new scene calls `reveal`.
local ui = require("lib.ui")
local state = require("lib.state")

local transition = {}

-- the colours of each country: the screen (a) and its darker shade (b)
local PALETTES = {
  pine_ridge = { a = { 44, 122, 78 }, b = { 26, 80, 51 } },
  dust_valley = { a = { 228, 138, 62 }, b = { 170, 86, 36 } },
  frost_pass = { a = { 112, 166, 212 }, b = { 70, 122, 172 } },
  harbour_lights = { a = { 38, 46, 96 }, b = { 20, 26, 60 } },
  finish = { a = { 250, 206, 64 }, b = { 36, 34, 44 } },
}
local CREAM = { 250, 244, 226 }
local COVER, REVEAL, SKEW, ROW = 0.55, 0.5, 220, 6

local s = { phase = "idle", t = 0, spec = nil, on_covered = nil, hold = 0, spin = 0, age = 0 }

local function ease(x) x = math.max(0, math.min(1, x)); return x < 0.5 and 4 * x * x * x or 1 - (-2 * x + 2) ^ 3 / 2 end

-- Starts covering the screen. \`spec\` is { title = "PINE RIDGE", sub = "2 LAPS", palette = "pine_ridge" (or "finish"), finish = true (the wheel slows down) }.
function transition.cover(spec, on_covered)
  s.phase, s.t, s.spec, s.on_covered, s.age, s.spin = "covering", 0, spec, on_covered, 0, 0
end

-- The next scene is ready: stay covered for \`hold\` seconds more, then wipe off.
function transition.reveal(hold)
  if s.phase == "covered" or s.phase == "covering" then s.phase, s.t, s.hold = "holding", 0, hold or 0.8 end
end

function transition.busy() return s.phase ~= "idle" end
-- Whether the screen is covered or being covered (a race's countdown waits for the wipe to start going).
function transition.covering() return s.phase == "covering" or s.phase == "covered" or s.phase == "holding" end

function transition.update(dt)
  if s.phase == "idle" then return end
  s.t = s.t + dt
  s.age = s.age + dt
  local speed = s.spec and s.spec.finish and (14 * math.exp(-s.age * 1.3) + 0.4) or (6.5 + 6 * math.exp(-s.age * 1.1))
  s.spin = s.spin + speed * dt
  if s.phase == "covering" and s.t >= COVER then
    s.phase, s.t = "covered", 0
    local f = s.on_covered
    s.on_covered = nil
    if f then f() end
  elseif s.phase == "covered" and s.t > 3 then
    s.phase, s.t, s.hold = "holding", 0, 0 -- (nothing took over: do not stay covered)
  elseif s.phase == "holding" and s.t >= s.hold then
    s.phase, s.t = "revealing", 0
  elseif s.phase == "revealing" and s.t >= REVEAL then
    s.phase, s.spec = "idle", nil
  end
end

-- A diagonal front: for each row of the screen, how far across the front has got (0 to w + SKEW as \`p\` goes 0 to 1).
local function edge(p, y, w, h) return p * (w + SKEW + 120) - SKEW - 120 + (y / h) * SKEW end

local function strip(x0, x1, y, w, colour)
  x0, x1 = math.max(0, x0), math.min(w, x1)
  if x1 > x0 then nova.ui.rect(x0, y, x1 - x0, ROW, colour) end
end

function transition.draw()
  if s.phase == "idle" or not s.spec then return end
  local w, h = nova.view()
  local pal = PALETTES[s.spec.palette or state.look_id()] or PALETTES.pine_ridge
  local covered = s.phase ~= "covering" and s.phase ~= "revealing"
  local cp = s.phase == "covering" and ease(s.t / COVER) or 1
  local rp = s.phase == "revealing" and ease(s.t / REVEAL) or 0
  -- the wipe: the screen's colour, with a darker band at the leading edge
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
  -- what is on the covered screen: a big darker disc, streaks going past, the wheel, the name
  local show = covered and math.min(1, s.t / 0.25 + (s.phase == "holding" and 1 or 0)) or (s.phase == "covering" and math.max(0, (cp - 0.7) / 0.3) or math.max(0, 1 - rp * 2.5))
  if show > 0.01 then
    local cx, cy = w / 2, h / 2 - 30
    local r = 170 * (0.6 + 0.4 * show)
    for y = math.floor(cy - r), math.floor(cy + r), ROW do
      local half = math.sqrt(math.max(0, r * r - (y + ROW / 2 - cy) ^ 2))
      local dark = { pal.b[1], pal.b[2], pal.b[3], math.floor(255 * math.min(1, show * 1.4)) }
      if half > 0 then nova.ui.rect(cx - half, y, half * 2, ROW, dark) end
    end
    for i = 0, 5 do
      local len = 110 + (i * 53) % 120
      local x = ((s.age * (380 + i * 70) + i * 211) % (w + 400)) - 300
      local yy = 70 + i * 82 + (i % 2) * 18
      if yy < cy - 90 or yy > cy + 90 then nova.ui.rect(x, yy, len, 4, { CREAM[1], CREAM[2], CREAM[3], math.floor(90 * show) }) end
    end
    local size = 200 * (0.4 + 0.6 * show)
    nova.ui.sprite("ui/wheel", cx, cy, { w = size, h = size, rotation = s.spin, color = { 255, 255, 255, math.floor(255 * math.min(1, show * 1.5)) } })
    local title = s.spec.title or ""
    if title ~= "" then
      local fit = ui.fit(title, 54, w * 0.82, "thick")
      ui.center(title, cy + 128, fit, { CREAM[1], CREAM[2], CREAM[3], math.floor(255 * show) }, { font = "thick" })
    end
    if (s.spec.sub or "") ~= "" then ui.center(s.spec.sub, cy + 128 + 62, 22, { CREAM[1], CREAM[2], CREAM[3], math.floor(230 * show) }, { font = "rounded" }) end
    if not s.spec.finish then
      for i = 0, 2 do
        local pulse = 0.5 + 0.5 * math.sin(s.age * 6 - i * 0.9)
        local size_dot = 8 + 6 * pulse
        nova.ui.rect(cx - 30 + i * 30 - size_dot / 2, cy + 128 + 100 - size_dot / 2, size_dot, size_dot, { CREAM[1], CREAM[2], CREAM[3], math.floor(255 * show) })
      end
    end
  end
end

-- What the screen says going into the race that is chosen.
function transition.race_spec()
  local info = state.current_track()
  local sub = ({ race = state.laps .. (state.laps == 1 and " LAP" or " LAPS"), trial = "TIME TRIAL", rally = "RALLY STAGE  ·  5 SECTIONS" })[state.mode] or ""
  return { title = string.upper(info.name), sub = sub, palette = state.look_id() }
end

return transition
