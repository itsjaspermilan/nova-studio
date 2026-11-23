-- The van's gear display (the owner's sixth play: "We should show the drive selection in the bottom left ... There should also be a
-- handbrake indicator near the drive symbol in the UI"), drawn by the valley while driving, never on foot. Bottom left, just right of
-- the minimap and level with its foot: one small paper panel holding the lever's column P R N D L (top to bottom, as a column shifter
-- reads), the gear it is in on the kit's raised red key; beside the column the X button at its top end (X moves the lever up, towards
-- P) and the A button at its bottom end (A moves it down, towards L), each with a small chevron; and the handbrake lamp, a circled
-- "(P)" on a key that lights red while B holds the handbrake. A refused shift says why for a moment on a slip over the panel ("Hold
-- the brake to shift"). Everything is drawn with the kit (lib/ui.lua); nothing here draws a rectangle of its own.
local ui = require("lib.ui")

local hud = {}

local s, C, F = ui.s, ui.C, ui.F
local KIT = "ui/kit/"
local ORDER = { "P", "R", "N", "D", "L" }
hud.HINTS = { brake = "Hold the brake to shift", stop = "Stop to shift" }

-- Where it sits on a screen `w` x `h` (screen units, 540 high): the panel's box, and each gear's row middle (for the tests).
function hud.layout(w, h)
  local mm = ui.MINIMAP
  local row = s(23)
  local pad = s(10)
  local ph = row * #ORDER + pad * 2
  local pw = s(160)
  -- (the minimap's disc: its middle 24 + r + 4 from the left and the bottom, its frame 8 wider than r)
  local disc_right = 24 + mm.r + 4 + mm.r + 8
  local x, y = disc_right + s(12), h - 20 - ph
  local L = { x = x, y = y, w = pw, h = ph, row = row, pad = pad, rows = {} }
  for i = 1, #ORDER do L.rows[ORDER[i]] = y + pad + row * (i - 0.5) end
  L.col = x + pad + s(16)                     -- the letters' middle
  L.btn = L.col + s(34)                       -- the X and A buttons' middle
  L.hb = x + pw - pad - s(38)                 -- the handbrake lamp's middle (its word under it, inside the panel)
  return L
end

local CHEV = { w = 0, h = 0, rotation = 0, color = nil }
local function chevron(x, y, up, a)
  CHEV.w, CHEV.h = s(11), s(11)
  CHEV.rotation = up and -math.pi / 2 or math.pi / 2
  CHEV.color = { 112, 102, 96, math.floor(255 * a) }
  nova.ui.sprite(KIT .. "chev_r", x, y, CHEV)
end

-- The display for van `v` (its `gear`, `handbrake`, `hint` and `hint_t`).
function hud.draw(v, w, h)
  local L = hud.layout(w, h)
  hud.last = L
  ui.panel(L.x, L.y, L.w, L.h, { scale = 0.4 })
  -- the column: each gear's letter; the one it is in on a raised red key
  local kw, kh = s(30), L.row + s(3)
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
  ui.glyph(L.btn, top, "X", s(22), { down = nova.input.down("interact") })
  chevron(L.btn, top + s(19), true, 0.8)
  ui.glyph(L.btn, bottom, "A", s(22), { down = nova.input.down("confirm") })
  chevron(L.btn, bottom - s(19), false, 0.8)
  -- the handbrake lamp: a circled P, lit red while B holds it, a faint slate key when off
  local on = v.handbrake and true or false
  hud.lit, hud.shown = on, v.gear -- (for the tests: what this frame's display showed)
  local bw, bh = s(46), s(34)
  local by = L.y + L.h / 2 - s(8)
  ui.key(L.hb - bw / 2, by - bh / 2, bw, bh, on and C.red or C.slate, { alpha = on and 1 or 0.35 })
  ui.text(L.hb, by - F.hint * 0.7, "(P)", { size = F.hint, align = "center", color = ui.alpha(C.cream, on and 1 or 0.7), bold = true })
  ui.text(L.hb, by + bh / 2 + s(3), "Handbrake", { size = F.small, align = "center", color = ui.alpha(on and C.red or C.faint, on and 1 or 0.7) })
  -- a refused shift: why, on a slip over the panel, for a moment
  local t = v.hint_t or 0
  if t > 0 and v.hint and hud.HINTS[v.hint] then
    local a = math.min(1, t / 0.3)
    local str = hud.HINTS[v.hint]
    local tw = ui.text_width(str, F.small)
    local sw, sh = tw + s(28), s(30)
    ui.panel(L.x, L.y - sh - s(8), sw, sh, { scale = 0.4, alpha = a })
    ui.text(L.x + s(14), L.y - sh - s(8) + sh / 2 - F.small * 0.66, str, { size = F.small, color = ui.alpha(C.ink, a) })
  end
end

return hud
