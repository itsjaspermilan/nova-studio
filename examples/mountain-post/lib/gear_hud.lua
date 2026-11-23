-- The van's instrument (the owner's sixth play: "show the drive selection ... a handbrake indicator near the drive symbol"; "move the
-- PRNDL to the right along with an analog speedometer"; "For the speedo and gears, can we merge them in a nice UI way. Not just two
-- separate shapes."; "We don't need the button chips there either."), drawn by the valley whenever the van is driven, never on foot
-- nor during a conversation. ONE round instrument in the bottom right, on the minimap's own painted disc (cream face, wooden rim:
-- the two bottom corners match), with the gear indicator inside the speedometer as a real car's cluster has it:
--   - the speed scale round the top: 0 to 100 km/h (the starting van is held at 40: Van.TUNE.cap), bold dark ticks every 10, numbers every 20,
--     swept from just below the left to just below the right; a soft red needle on a small hub, eased so it never jitters. At a
--     standstill it rests on a small peg below the 0 (clear of the 0 and of the gears), and leaves it for the 0 mark as the van
--     moves. Backing up it shows the speed it backs at;
--   - the gears in the dial's foot, one row P R N D L, the one the lever is in on the kit's raised red key;
--   - the handbrake's warning light, a small circled "(P)" over the hub, lit red while B holds the handbrake; "km/h" under it.
-- No button glyphs (the owner: the prompts say what the buttons do; the lever is X towards L, A towards P). A refused shift (into P
-- or R on the move) says why for a moment on a slip beside the dial ("Stop to shift"). The prompt chips sit above the instrument while
-- driving (hud.hints_floor). Everything is drawn with the kit (lib/ui.lua) and the minimap's pictures.
-- (Three layouts were tried in pictures: an arc of gears round the foot, this row, and a strip set into the rim's left side; the
-- row read best at a glance: the letters stay level and evenly spaced, and it is one round shape. build/gallery/option-*.png.)
local ui = require("lib.ui")

local hud = {}

local s, C, F, SP = ui.s, ui.C, ui.F, ui.SP
local ORDER = { "P", "R", "N", "D", "L" }
hud.HINTS = { stop = "Stop to shift" }
-- The dial: its face's radius (the rim is 8 wider), its range, its sweep (radians from straight up, clockwise positive: 0 km/h a
-- little below the left, the top of the range a little below the right), the needle's resting peg (further round, below the 0),
-- the row of gears (how far below the hub; the letters are SP.xl apart).
hud.DIAL = { r = 74, top = 100, minor = 10, major = 20, from = -math.rad(105), to = math.rad(105), rest = -math.rad(126), ease = 0.18, row = 0.58 }
local D = hud.DIAL

-- Where it sits on a screen `w` x `h` (screen units, 540 high): the dial's middle and radius, each gear's letter, the lamp.
function hud.layout(w, h)
  local rim = D.r + 8
  local cx, cy = w - ui.EDGE - rim, h - ui.EDGE - rim
  local L = { cx = cx, cy = cy, r = D.r, rim = rim, x = cx - rim, y = cy - rim, w = rim * 2, h = rim * 2, letters = {} }
  for i, g in ipairs(ORDER) do L.letters[g] = { cx + (i - 3) * SP.xl, cy + D.r * D.row } end
  L.lamp = { cx, cy - D.r * 0.34 }
  L.peg = { cx + math.sin(D.rest) * (D.r - 9), cy - math.cos(D.rest) * (D.r - 9) }
  L.top = cy - rim
  return L
end

-- The prompt chips' floor while driving: ui.hints given this as the screen's height puts them just above the instrument.
function hud.hints_floor(w, h)
  return hud.layout(w, h).top + ui.EDGE - SP.s
end

-- A straight stroke on the dial (a tick, the needle): the minimap's soft bar, from radius r0 to r1 at angle `a`.
local BAR = { w = 0, h = 0, rotation = 0, color = nil }
local function stroke(L, a, r0, r1, width, colour)
  local sx, sy = math.sin(a), -math.cos(a)
  BAR.w, BAR.h = r1 - r0, width * 16 / 12
  BAR.rotation = a - math.pi / 2
  BAR.color = colour
  nova.ui.sprite("ui/minimap_road", L.cx + sx * (r0 + r1) / 2, L.cy + sy * (r0 + r1) / 2, BAR)
end
local function angle_of(kmh) return D.from + (D.to - D.from) * math.max(0, math.min(1.04, kmh / D.top)) end
-- (the needle: on its peg standing, swinging up to the 0 over the first half km/h, then the scale)
function hud.needle_angle(kmh)
  if kmh < 0.5 then return D.rest + (D.from - D.rest) * (kmh / 0.5) end
  return angle_of(kmh)
end

local TICK = { 52, 44, 40, 255 }
local NEEDLE = { 214, 76, 58, 255 }
local HUB = { w = 0, h = 0, color = { 62, 54, 49, 255 } }
local PEG = { w = 0, h = 0, color = { 112, 102, 96, 255 } }

-- The instrument for van `v` (its `gear`, `speed`, `handbrake`, `hint` and `hint_t`).
function hud.draw(v, w, h)
  local L = hud.layout(w, h)
  hud.last = L
  nova.ui.sprite("ui/minimap_disc", L.cx, L.cy, { w = L.rim * 2, h = L.rim * 2 })
  -- the scale: bold dark ticks, the numbers just inside them
  for k = 0, D.top, D.minor do
    local a = angle_of(k)
    local major = k % D.major == 0
    stroke(L, a, D.r - (major and 14 or 9), D.r - 3, major and 4.2 or 2.8, TICK)
    if major then
      local nr = D.r - 25
      ui.text(L.cx + math.sin(a) * nr, L.cy - math.cos(a) * nr - F.small * 0.64, tostring(k),
        { size = F.small, align = "center", color = C.ink, bold = true })
    end
  end
  -- the peg the needle rests on, below the 0
  PEG.w, PEG.h = s(7), s(7)
  nova.ui.sprite("ui/minimap_joint", L.peg[1], L.peg[2], PEG)
  ui.text(L.cx, L.cy + D.r * 0.2 - F.small * 0.5, "km/h", { size = F.small - 2, align = "center", color = ui.alpha(C.faint, 0.9) })
  -- the handbrake's warning light: a circled P, lit red while B holds it, faint when off
  local on = v.handbrake and true or false
  hud.lit, hud.shown = on, v.gear -- (for the tests: what this frame's instrument showed)
  local lw, lh = s(34), s(22)
  ui.key(L.lamp[1] - lw / 2, L.lamp[2] - lh / 2, lw, lh, on and C.red or C.slate, { alpha = on and 1 or 0.3 })
  ui.text(L.lamp[1], L.lamp[2] - F.small * 0.72, "(P)", { size = F.small, align = "center", color = ui.alpha(C.cream, on and 1 or 0.8), bold = true })
  -- the gears: one row in the dial's foot, the one the lever is in on a raised red key
  local kw, kh = s(21), s(24)
  for _, g in ipairs(ORDER) do
    local p = L.letters[g]
    if g == v.gear then
      ui.key(p[1] - kw / 2, p[2] - kh / 2, kw, kh, C.red)
      ui.text(p[1], p[2] - F.hint * 0.68, g, { size = F.hint, align = "center", color = C.cream, bold = true })
    else
      ui.text(p[1], p[2] - F.small * 0.66, g, { size = F.small, align = "center", color = ui.alpha(C.faint, 0.95), bold = true })
    end
  end
  -- the needle (over the face, under the hub), eased towards the speed
  local kmh = math.abs(v.speed or 0) * 3.6
  hud.kmh = (hud.kmh or kmh) + (kmh - (hud.kmh or kmh)) * D.ease
  if hud.kmh < 0.02 then hud.kmh = 0 end
  local a = hud.needle_angle(hud.kmh)
  hud.angle = a
  stroke(L, a + math.pi, 0, 10, 4, NEEDLE)        -- (its short tail past the hub)
  stroke(L, a, 0, D.r - 9, 4, NEEDLE)
  HUB.w, HUB.h = s(17), s(17)
  nova.ui.sprite("ui/minimap_joint", L.cx, L.cy, HUB)
  -- a refused shift: why, on a slip beside the dial, for a moment
  local t = v.hint_t or 0
  if t > 0 and v.hint and hud.HINTS[v.hint] then
    local al = math.min(1, t / 0.3)
    local str = hud.HINTS[v.hint]
    -- a small slip: PAD_SMALL's across and down in the small frame, SP.s clear of the dial
    local sw, sh, left, top = ui.box(ui.text_width(str, F.small), F.small, ui.PAD_SMALL, ui.FRAME.small)
    local sx, sy = L.x - sw - SP.s, L.cy - sh / 2
    ui.panel(sx, sy, sw, sh, { scale = ui.FRAME.small, alpha = al })
    ui.text(sx + left, sy + top, str, { size = F.small, color = ui.alpha(C.ink, al) })
    hud.slip_box = { x = sx, y = sy, w = sw, h = sh, left = left, top = top } -- (for the tests)
  end
end

return hud
