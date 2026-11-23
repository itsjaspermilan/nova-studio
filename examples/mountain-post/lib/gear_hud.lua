-- The van's cluster (the owner's sixth play: "show the drive selection ... There should also be a handbrake indicator near the drive
-- symbol"; then "We should move the PRNDL to the right along with an analog speedometer"), drawn by the valley whenever the van is
-- driven, never on foot nor during a conversation. Bottom right, one compact group:
--   - an analog speedometer: the minimap's own painted disc (cream face, wooden rim: the two bottom corners match), ticks every
--     5 km/h and numbers every 10 from 0 to 40 (the starting van tops out near 37), a soft red needle on a small hub, eased so it
--     never jitters. It shows the speed whichever way the van goes (backing up at 3.4 km/h, the needle stands at 3.4);
--   - in the dial's open foot, the handbrake lamp: a circled "(P)" on a key, lit red while B holds the handbrake;
--   - left of the dial, a small paper panel with the lever's column P R N D L (top to bottom), the gear it is in on the kit's raised
--     red key, X at the top end (X moves the lever up, towards P) and A at the bottom end (A moves it down, towards L).
-- A refused shift (into P or R on the move) says why for a moment on a slip over the panel ("Stop to shift"). The prompt chips sit
-- above the cluster while driving (hud.hints_floor). Everything is drawn with the kit (lib/ui.lua) and the minimap's pictures;
-- nothing here draws a rectangle of its own.
local ui = require("lib.ui")

local hud = {}

local s, C, F = ui.s, ui.C, ui.F
local KIT = "ui/kit/"
local ORDER = { "P", "R", "N", "D", "L" }
hud.HINTS = { stop = "Stop to shift" }
-- The dial: its face's radius (the minimap's frame is 8 wider), its range, and its sweep (radians from straight up, clockwise
-- positive: 0 km/h down at the lower left, the top of the range down at the lower right).
hud.DIAL = { r = 60, top = 40, from = -math.rad(135), to = math.rad(135), ease = 0.18 }
local D = hud.DIAL

-- Where it all sits on a screen `w` x `h` (screen units, 540 high): the dial's middle and radius, the panel's box, each gear's row
-- middle, the handbrake lamp (for the tests and the prompts).
function hud.layout(w, h)
  local rim = D.r + 8
  local cx, cy = w - 20 - rim, h - 20 - rim
  local row = s(21)
  local pad = s(9)
  local ph = row * #ORDER + pad * 2
  local pw = s(78)
  local x, y = cx - rim - s(8) - pw, h - 20 - ph
  local L = { cx = cx, cy = cy, r = D.r, rim = rim, x = x, y = y, w = pw, h = ph, row = row, pad = pad, rows = {} }
  for i = 1, #ORDER do L.rows[ORDER[i]] = y + pad + row * (i - 0.5) end
  L.col = x + pad + s(15)                     -- the letters' middle
  L.btn = L.col + s(32)                       -- the X and A buttons' middle
  L.hb = { cx, cy + D.r * 0.62 }              -- the handbrake lamp, in the dial's open foot
  L.top = math.min(cy - rim, y)               -- the cluster's top edge
  return L
end

-- The prompt chips' floor while driving: ui.hints given this as the screen's height puts them just above the cluster.
function hud.hints_floor(w, h)
  local L = hud.layout(w, h)
  return L.top + s(22) - s(8)
end

local CHEV = { w = 0, h = 0, rotation = 0, color = nil }
local function chevron(x, y, up, a)
  CHEV.w, CHEV.h = s(11), s(11)
  CHEV.rotation = up and -math.pi / 2 or math.pi / 2
  CHEV.color = { 112, 102, 96, math.floor(255 * a) }
  nova.ui.sprite(KIT .. "chev_r", x, y, CHEV)
end

-- A straight stroke on the dial (a tick, the needle): the minimap's soft road bar, from radius r0 to r1 at angle `a`.
local BAR = { w = 0, h = 0, rotation = 0, color = nil }
local function stroke(L, a, r0, r1, width, colour)
  local sx, sy = math.sin(a), -math.cos(a)
  BAR.w, BAR.h = r1 - r0, width * 16 / 12
  BAR.rotation = a - math.pi / 2
  BAR.color = colour
  nova.ui.sprite("ui/minimap_road", L.cx + sx * (r0 + r1) / 2, L.cy + sy * (r0 + r1) / 2, BAR)
end
local function angle_of(kmh) return D.from + (D.to - D.from) * math.max(0, math.min(1.04, kmh / D.top)) end

local TICK = { 62, 54, 49, 230 }
local NEEDLE = { 214, 84, 66, 255 }
local HUB = { w = 0, h = 0, color = { 62, 54, 49, 255 } }

-- The cluster for van `v` (its `gear`, `speed`, `handbrake`, `hint` and `hint_t`).
function hud.draw(v, w, h)
  local L = hud.layout(w, h)
  hud.last = L
  -- the speedometer: the disc, the ticks and numbers, the needle eased towards the speed
  nova.ui.sprite("ui/minimap_disc", L.cx, L.cy, { w = L.rim * 2, h = L.rim * 2 })
  for k = 0, D.top, 5 do
    local a = angle_of(k)
    local major = k % 10 == 0
    stroke(L, a, D.r - (major and 11 or 7), D.r - 3, major and 2.6 or 1.6, TICK)
    if major then
      local nx, ny = L.cx + math.sin(a) * (D.r - 21), L.cy - math.cos(a) * (D.r - 21)
      ui.text(nx, ny - F.small * 0.62, tostring(k), { size = F.small, align = "center", color = C.ink, bold = true })
    end
  end
  ui.text(L.cx, L.cy - D.r * 0.42 - F.small * 0.5, "km/h", { size = F.small - 2, align = "center", color = ui.alpha(C.faint, 0.9) })
  local kmh = math.abs(v.speed or 0) * 3.6
  hud.kmh = (hud.kmh or kmh) + (kmh - (hud.kmh or kmh)) * D.ease
  if hud.kmh < 0.05 then hud.kmh = 0 end
  local a = angle_of(hud.kmh)
  stroke(L, a + math.pi, 0, 9, 3.4, NEEDLE)        -- (its short tail past the hub)
  stroke(L, a, 0, D.r - 8, 3.4, NEEDLE)
  HUB.w, HUB.h = s(16), s(16)
  nova.ui.sprite("ui/minimap_joint", L.cx, L.cy, HUB)
  -- the handbrake lamp: a circled P, lit red while B holds it, a faint slate key when off
  local on = v.handbrake and true or false
  hud.lit, hud.shown = on, v.gear -- (for the tests: what this frame's display showed)
  local bw, bh = s(40), s(26)
  ui.key(L.hb[1] - bw / 2, L.hb[2] - bh / 2, bw, bh, on and C.red or C.slate, { alpha = on and 1 or 0.35 })
  ui.text(L.hb[1], L.hb[2] - F.hint * 0.72, "(P)", { size = F.hint, align = "center", color = ui.alpha(C.cream, on and 1 or 0.75), bold = true })
  -- the lever's column on its panel, left of the dial
  ui.panel(L.x, L.y, L.w, L.h, { scale = 0.4 })
  local kw, kh = s(28), L.row + s(3)
  for _, g in ipairs(ORDER) do
    local cy = L.rows[g]
    if g == v.gear then
      ui.key(L.col - kw / 2, cy - kh / 2 - s(1), kw, kh, C.red)
      ui.text(L.col, cy - F.button * 0.66, g, { size = F.button, align = "center", color = C.cream, bold = true })
    else
      ui.text(L.col, cy - F.hint * 0.62, g, { size = F.hint, align = "center", color = ui.alpha(C.faint, 0.85), bold = true })
    end
  end
  -- X at the top end (up, towards P) and A at the bottom end (down, towards L), each pressed while held
  local top, bottom = L.rows.P + s(4), L.rows.L - s(4)
  ui.glyph(L.btn, top, "X", s(21), { down = nova.input.down("interact") })
  chevron(L.btn, top + s(18), true, 0.8)
  ui.glyph(L.btn, bottom, "A", s(21), { down = nova.input.down("confirm") })
  chevron(L.btn, bottom - s(18), false, 0.8)
  -- a refused shift: why, on a slip over the panel, for a moment
  local t = v.hint_t or 0
  if t > 0 and v.hint and hud.HINTS[v.hint] then
    local al = math.min(1, t / 0.3)
    local str = hud.HINTS[v.hint]
    local tw = ui.text_width(str, F.small)
    local sw, sh = tw + s(28), s(30)
    local sx = L.x + L.w - sw
    ui.panel(sx, L.y - sh - s(8), sw, sh, { scale = 0.4, alpha = al })
    ui.text(sx + s(14), L.y - sh - s(8) + sh / 2 - F.small * 0.66, str, { size = F.small, color = ui.alpha(C.ink, al) })
  end
end

return hud
