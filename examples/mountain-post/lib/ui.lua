-- The slice's UI kit: one theme for every piece of UI in the game (docs/games/mountain-post.md, "UI theme"). Its pictures are a
-- few pieces of Kenney's UI Pack (CC0) recoloured into the toy palette by tools/ui-kit.mjs (sprites/ui/kit/): a paper panel on a
-- wooden frame, a key (raised, or pressed), a round button cap, a parcel's label slip, a rule and two chevrons. Everything below
-- draws from them; nothing else in the game draws a panel or a button of its own.
--
--   ui.panel        a paper panel (cards, the dialogue box, menus, the map's frame, the letter)
--   ui.key          a key, raised or pressed, in any colour (buttons, tabs, tags, title strips)
--   ui.glyph        a face button's cap with its letter (A, B, X, Y in the pad's colours); ui.pad_key: L1, R2, Start... (the Controls page only:
--                   no prompt in play draws a button)
--   ui.title_strip  a heading on a red key; ui.tag a name tag in a speaker's colour; ui.rule a groove under a heading
--   ui.slip         a parcel's label (white, the post's red double edge); ui.cycler: < 1 of 2 >
--   ui.parcel_card  the one card in the top-left corner; ui.van_panel the van's floating panel; ui.dim, ui.fade
--   ui.text         all words: the rounded face (Fredoka) in two weights; ui.s(n) a length of the first design, scaled by ui.S
-- (The minimap is its own painted disc, lib/ui.lua's ui.minimap, made in the same palette by tools/art.mjs.)
local world = require("lib.world")
local words = require("lib.words")

local ui = {}

-- One scale for the whole kit (the owner: "we can make the UI elements a little smaller"): every length below is written for the
-- first design and goes through s(). Text sizes keep a floor, in the screen's units (540 high, 1.33 px each at 720p): body 15 =
-- 20 px, small and hints 13 = 17 px.
ui.S = 0.82
local S = ui.S
local function s(n) return n * S end
ui.s = s
local function sz(n, min) return math.max(min or 0, math.floor(n * S + 0.5)) end

-- ONE SPACING SYSTEM (the owner, sixth play: "some padding is too tight, and some is too large"). Every gap, padding and margin in
-- the game's UI (this file, lib/cards.lua, lib/dialogue.lua, lib/gear_hud.lua) is one of these five steps, named, never a raw number:
--   xs 4   s 8   m 12   l 16   xl 24      (units of the 540-line screen, times ui.S)
-- and the rules below say which step goes where (docs/games/mountain-post.md, "UI theme"):
--   PAD        text panels (cards, the van's panel, the tip, the pause menu): m across, s down, INSIDE the frame
--   PAD_SMALL  chips, slips, name tags: s across, xs down, inside the frame
--   PAD_LONG   panels of running text (the dialogue box, the letter, the end card): xl across, m down
--   GAP        icon to its text, a button to its word: s;  between rows of one panel: xs (SP.xs) or s;  between chips: s
--   EDGE       from the screen's edge to a corner element (card, chips, minimap, instrument): xl
--   FRAME      the panel's wooden frame at one of two scales: big (cards, dialogue, letter, menus) and small (chips, tips, slips)
-- A text is never nearer than s to the inside of a frame and short text never has more than l of padding (ui.PAD_RULES; a test
-- measures a few panels).
ui.SP = { xs = s(4), s = s(8), m = s(12), l = s(16), xl = s(24) }
local SP = ui.SP
ui.PAD = { x = SP.m, y = SP.s }
ui.PAD_SMALL = { x = SP.s, y = SP.xs }
ui.PAD_LONG = { x = SP.xl, y = SP.m }
ui.GAP = SP.s
ui.EDGE = SP.xl
ui.RADIUS = SP.m
ui.FRAME = { big = 0.5, small = 0.36, key = 0.45 }
ui.PAD_RULES = { min = SP.xs, max_short = SP.xl } -- (what a test may hold the gaps to, inside the frame)
-- The wood on each side of a panel drawn at frame scale `k` (the kit's nine-slice borders are 16, 16, 16 and 24 pixels).
function ui.inset(k)
  k = (k or ui.FRAME.big) * S
  return { x = 16 * k, top = 16 * k, bottom = 24 * k }
end
-- The size of a panel round a content `cw` x `chh`, and where the content starts in it: with `pad` (PAD by default) and frame scale
-- `k` (big by default). Returns w, h, left, top.
function ui.box(cw, chh, pad, k)
  pad = pad or ui.PAD
  local I = ui.inset(k)
  return cw + 2 * (I.x + pad.x), chh + 2 * pad.y + I.top + I.bottom, I.x + pad.x, I.top + pad.y
end

-- The theme's colours (the toy palette's paper, inks and paints: tools/palette.mjs).
ui.C = {
  paper = { 243, 230, 200 }, ink = { 62, 54, 49 }, faint = { 122, 101, 80 }, wood = { 154, 106, 68 }, cream = { 255, 248, 234 },
  red = { 201, 74, 59 }, mustard = { 226, 176, 74 }, blue = { 79, 120, 173 }, green = { 111, 159, 82 }, slate = { 112, 102, 96 },
  shade = { 34, 24, 16 },
}
local C = ui.C
-- The font: every word is the rounded face (Fredoka), in two weights (regular is the face a little thickened, its own is light for
-- small paper text; heavy for names, headings, buttons: `bold`). The sizes, in the screen's units (540 high).
ui.F = { heading = sz(26, 15), button = sz(24, 15), hint = sz(19, 13), small = sz(15, 13), body = sz(24, 15), name = sz(22, 15), line = sz(17, 13) }
local F = ui.F

local REGULAR, HEAVY = 0.55, 1.3
-- Text in the one face: `bold = true` is the heavy weight, nothing the regular. Everything is rounded, whatever is asked.
function ui.text(x, y, str, opts)
  opts = opts or {}
  opts.font = "rounded"
  if opts.bold == nil then opts.bold = REGULAR elseif opts.bold == true then opts.bold = HEAVY elseif opts.bold == false then opts.bold = nil end
  return nova.ui.text(x, y, str, opts)
end
-- A line with the engine's markup ({shake}, {wave}, {big}, {slow}, {pop}, {c=red}, {pause}), typed on `opts.time`: the dialogue's
-- words. The face and weights as ui.text's. `ui.rich_letters` gives the same line's letters (where, when, how) without drawing.
local function rich_opts(opts)
  opts = opts or {}
  opts.font = "rounded"
  if opts.bold == nil then opts.bold = REGULAR elseif opts.bold == true then opts.bold = HEAVY elseif opts.bold == false then opts.bold = nil end
  return opts
end
function ui.rich_text(x, y, str, opts) return nova.ui.rich_text(x, y, str, rich_opts(opts)) end
function ui.rich_letters(x, y, str, opts) return nova.ui.rich_text_letters(x, y, str, rich_opts(opts)) end
function ui.text_width(str, size, bold)
  return nova.ui.text_width(str, { font = "rounded", size = size, bold = bold and HEAVY or REGULAR })
end
local text, text_width = ui.text, ui.text_width

-- The pad's buttons, as engraved on the Retroid and coloured like a Nintendo-style pad.
local GLYPH = { A = C.red, B = C.mustard, X = C.blue, Y = C.green }

local KIT = "ui/kit/"
-- (the kit's neutral pieces have a face of grey 232: a tint of c * 255 / 232 shows the face in c exactly)
local function tint(c, a)
  return { math.min(255, c[1] * 1.1), math.min(255, c[2] * 1.1), math.min(255, c[3] * 1.1), a or c[4] or 255 }
end
local function alpha(c, a) return { c[1], c[2], c[3], math.floor((c[4] or 255) * (a or 1)) } end
ui.alpha = alpha

-- A paper panel: the frame keeps its size, the paper stretches (a nine-slice of the kit's panel). `opts.alpha` fades it.
local PANEL = { slice = { 16, 16, 16, 24 }, scale = 0.5 }
function ui.panel(x, y, w, h, opts)
  opts = opts or {}
  local a = opts.alpha or 1
  PANEL.scale = (opts.scale or ui.FRAME.big) * S
  PANEL.color = { 255, 255, 255, math.floor(255 * a) }
  -- a soft shadow on what is under it (the world, or the room)
  nova.ui.rect(x + SP.xs, y + SP.s, w, h, { C.shade[1], C.shade[2], C.shade[3], math.floor(60 * a) }, { radius = ui.RADIUS })
  nova.ui.panel(KIT .. "panel", x, y, w, h, PANEL)
end

-- A key in a colour: raised (its wooden foot under it) or pressed (flat, lower by the foot). `h` is the raised key's height. With
-- no colour it is a paper key on the panel's wood (a button that is not chosen).
local KEY = { slice = { 16, 16, 16, 24 }, scale = 0.4 }
function ui.key(x, y, w, h, colour, opts)
  opts = opts or {}
  local k = opts.scale or math.min(0.5, h / 64)
  local a = math.floor(255 * (opts.alpha or 1))
  KEY.scale = k
  KEY.color = colour and tint(colour, a) or { 255, 255, 255, a }
  if opts.down then
    local foot = 8 * k
    KEY.slice = { 16, 16, 16, 16 }
    nova.ui.panel(KIT .. (colour and "pressed" or "panel_down"), x, y + foot, w, h - foot, KEY)
    KEY.slice = { 16, 16, 16, 24 }
  else
    nova.ui.panel(KIT .. (colour and "raised" or "panel"), x, y, w, h, KEY)
  end
end

-- A face button's cap with its letter, centred on x, y; `down` shows it held.
function ui.glyph(x, y, letter, size, opts)
  size = size or s(28)
  opts = opts or {}
  local a = opts.alpha or 1
  local col = tint(GLYPH[letter] or C.slate, math.floor(255 * a))
  local foot = size * 8 / 128
  if opts.down then
    nova.ui.sprite(KIT .. "round_down", x, y + foot / 2, { w = size, h = size - foot, color = col })
    text(x, y + foot / 2 - size * 0.37, letter, { size = size * 0.62, align = "center", color = alpha(C.cream, a), bold = true })
  else
    nova.ui.sprite(KIT .. "round", x, y, { w = size, h = size, color = col })
    text(x, y - foot / 2 - size * 0.37, letter, { size = size * 0.62, align = "center", color = alpha(C.cream, a), bold = true })
  end
end

-- The one small chip of play (the owner's ninth notes: a few small, deliberate ones back): a face button's cap at the bottom-right
-- corner of a panel (the talk tip, the dialogue box, the van's panel), overlapping the corner a little. Every one is this size and
-- this far in: `ui.CHIP` across, its middle SP.s in from the right edge and SP.xs up from the bottom.
ui.CHIP = s(24)
function ui.corner_chip(x, y, w, h, letter, a)
  ui.glyph(x + w - SP.s, y + h - SP.xs, letter, ui.CHIP, { alpha = a })
  ui.chip_box = { x = x + w - SP.s - ui.CHIP / 2, y = y + h - SP.xs - ui.CHIP / 2, w = ui.CHIP, h = ui.CHIP, letter = letter } -- (for the tests)
end

-- A slate key with a name on it (L1, R2, L3, Start, Left stick...), left edge at x, middle at y, as wide as its name needs; returns its
-- width. (The Controls page is the one place buttons are drawn: no prompt in play names a button.)
local KEYCAP = s(26)
local KEY_FS = math.max(12, sz(15))
function ui.pad_key_width(name) return text_width(name, KEY_FS, true) + KEYCAP * 0.75 end
function ui.pad_key(x, y, name, opts)
  opts = opts or {}
  local w = ui.pad_key_width(name)
  ui.key(x, y - KEYCAP / 2, w, KEYCAP, C.slate, { alpha = opts.alpha, scale = KEYCAP / 70 })
  text(x + w / 2, y - KEY_FS * 0.66, name, { size = KEY_FS, align = "center", color = alpha(C.cream, opts.alpha), bold = true })
  return w
end
ui.KEYCAP = KEYCAP
-- A heading on a red key, centred on x (its top at y); returns its height. Its words have xl either side and s above and below.
function ui.title_strip(x, y, str, opts)
  opts = opts or {}
  local size = opts.size or F.heading
  local tw = text_width(str, size, true)
  local w, h = math.max(opts.min_w or 0, tw + 2 * SP.xl), size + 2 * SP.s
  ui.key(x - w / 2, y, w, h, opts.colour or C.red, { scale = ui.FRAME.key * S, alpha = opts.alpha })
  text(x, y + (h - size) / 3, str, { size = size, align = "center", color = alpha(C.cream, opts.alpha), bold = true })
  return h
end

-- A name tag in the speaker's colour, its left edge at x, its top at y: its words have l either side and s above and below.
function ui.tag(x, y, str, colour)
  local tw = text_width(str, F.name, true) + 2 * SP.l
  local th = F.name + 2 * SP.s
  ui.key(x, y, tw, th, colour, { scale = ui.FRAME.key * S })
  text(x + tw / 2, y + (th - F.name) / 3, str, { size = F.name, align = "center", color = C.cream, bold = true })
  return tw, th
end

-- A groove under a heading, from x to x + w.
function ui.rule(x, y, w, opts)
  nova.ui.panel(KIT .. "rule", x, y, w, SP.xs, { slice = { 8, 0, 8, 0 }, scale = ui.FRAME.big * S, color = { 255, 255, 255, math.floor(255 * ((opts and opts.alpha) or 1)) } })
end

-- A parcel's label slip (white, the post's red double edge).
local SLIP = { slice = { 20, 20, 20, 20 }, scale = 0.45 }
function ui.slip(x, y, w, h, opts)
  SLIP.scale = 0.45 * S
  SLIP.color = { 255, 255, 255, math.floor(255 * ((opts and opts.alpha) or 1)) }
  nova.ui.panel(KIT .. "slip", x, y, w, h, SLIP)
end

-- "< 1 of 2 >": going round a list, centred on x (its middle at y): the count between two small slate chevrons, no buttons drawn.
-- `ui.cycler_width` is how wide it is.
local CYCLER_FS = F.small + 1
local CHEV = SP.l
function ui.cycler_width(i, n)
  return text_width(i .. " of " .. n, CYCLER_FS) + 2 * (SP.m + CHEV)
end
function ui.cycler(x, y, i, n, opts)
  opts = opts or {}
  local a = opts.alpha or 1
  local count = i .. " of " .. n
  local tw = text_width(count, CYCLER_FS)
  local ch = { w = CHEV, h = CHEV, color = tint(C.slate, math.floor(255 * a)) }
  nova.ui.sprite(KIT .. "chev_l", x - tw / 2 - SP.m - CHEV / 2, y - 1, ch)
  nova.ui.sprite(KIT .. "chev_r", x + tw / 2 + SP.m + CHEV / 2, y - 1, ch)
  text(x, y - CYCLER_FS * 0.62, count, { size = CYCLER_FS, align = "center", color = alpha(opts.colour or C.faint, a) })
end

-- A dimming of everything under a card (0 to 1; `most` is how dark at 1: 140 of 255, a card's; the end card's is nearly black).
function ui.dim(w, h, a, most)
  if a > 0.003 then nova.ui.rect(0, 0, w, h, { 34, 24, 18, math.floor((most or 140) * math.min(1, a)) }) end
end

-- A soft dark band across the screen behind a title (its middle at y), so cream letters stand out of a bright sky.
function ui.band(y, w, a)
  local k = math.floor(95 * a)
  nova.ui.rect(0, y - 120, w, 120, { 30, 44, 62, k }, { gradient = { { 30, 44, 62, 0 }, { 30, 44, 62, k } } })
  nova.ui.rect(0, y, w, 120, { 30, 44, 62, k }, { gradient = { { 30, 44, 62, k }, { 30, 44, 62, 0 } } })
end

-- The name and the street of a parcel's label.
function ui.label_lines(which)
  return words.labels[which]:match("^(.-), (.*)$")
end

-- The one card in the top-left corner: one active parcel (carried, or in the van), where it is, and, with more than one, "1 of 2"
-- and the L1 / R1 buttons that go round them. `opts.dim`: the van's panel is open (L1 and R1 are the panel's): the card fades back
-- and shows neither the count nor the buttons. A text panel (PAD in the big frame): the icon, GAP, then three lines xs apart.
local ICON = { w = s(58), h = s(48) }
local CARD_TEXT_W = s(180)                       -- the room for a name and a street
local LINES_H = F.name + SP.xs + F.line + SP.xs + F.small
local CYC_H = s(22)                              -- the cycler's keys
local MORE_H = SP.s + SP.xs + SP.s + CYC_H       -- under the lines, with more than one parcel: a gap, the rule, a gap, the cycler
local CARD_W = ui.box(ICON.w + ui.GAP + CARD_TEXT_W, LINES_H)
function ui.parcel_card(which, where, i, n, opts)
  if not which then return end
  opts = opts or {}
  local a = opts.dim and 0.45 or 1
  local many = n > 1 and not opts.dim
  local cw, ch, left, top = ui.box(ICON.w + ui.GAP + CARD_TEXT_W, LINES_H + (many and MORE_H or 0))
  local x, y = ui.EDGE, ui.EDGE
  ui.panel(x, y, cw, ch, { alpha = a })
  local x0, y0 = x + left, y + top
  nova.ui.sprite("ui/parcel_icon", x0 + ICON.w / 2, y0 + LINES_H / 2, { w = ICON.w, h = ICON.h, color = { 255, 255, 255, math.floor(255 * a) } })
  local tx = x0 + ICON.w + ui.GAP
  local name, street = ui.label_lines(which)
  text(tx, y0, name, { size = F.name, color = alpha(C.ink, a), bold = true })
  text(tx, y0 + F.name + SP.xs, street, { size = F.line, color = alpha(C.faint, a) })
  -- where it is: in your arms, or in the van
  local col = where == "hands" and C.blue or C.red
  text(tx, y0 + F.name + SP.xs + F.line + SP.xs, where == "hands" and words.card.hands or words.card.van, { size = F.small, color = alpha(col, a), bold = true })
  if many then
    local ry = y0 + LINES_H + SP.s
    ui.rule(x0, ry, cw - 2 * left)
    ui.cycler(x + cw / 2, ry + SP.xs + SP.s + CYC_H / 2, i, n)
  end
  ui.card_box = { x = x, y = y, w = cw, h = ch, left = left, top = top } -- (for the tests)
end

-- The van's panel: a small panel floating above the van's open back doors (the owner, sixth play: "The popup currently blocks the
-- player. Let's have the UI appear a little smaller ... but make it appear floating above the truck doors. So it'll technically move
-- with the camera to remain above the doors."). The scene projects a point just over the doors to the screen every frame (lib/camera.lua,
-- camera.project) and the panel stands on it, bottom-centre, a small tail pointing down to the doors; clamped to stay on the screen.
-- It is a light overlay: it never takes the stick or stops anything (see Valley:fade_picker). One of
--   "pick"   parcels in the van, empty hands: one parcel line (its name and street), a "Take" button row with the A chip on the panel's
--            corner, and with more than one "1 of 2" and L1 and R1 to go round them
--   "load"   a parcel in the arms at the back: a "Store" button row with the A chip; the van full (`d.full`): just the note "The van is full"
--   "empty"  nothing in the van and nothing carried: "The van is empty"
-- under a small red tag "Van 2/4" (parcels in the van over what it holds). `d`: mode, list (the parcels), i (the one shown), count,
-- cap, note (0 to 1: how strongly the refusal's note shows), ax, ay (where the doors are on the screen), a (0 to 1: faded up).
-- `dt` eases the anchor, so the panel does not jitter with the van's springs. A text panel (PAD in the small frame), with xs more
-- over the top for the tag that sits on its corner.
local TAIL = SP.m
local TAG_CLEAR = SP.xs
ui.float = nil -- (the eased anchor; nil: the next frame starts at the anchor itself)
function ui.van_panel_reset() ui.float = nil end

-- A little tail pointing down, its tip at (x, y + len): wood edge, paper inside.
local function tail(x, y, hw, len, a)
  local n = math.max(2, math.floor(len))
  for pass = 1, 2 do
    local col = pass == 1 and alpha(C.wood, a) or alpha(C.paper, a)
    local grow = pass == 1 and 1.8 or 0
    for i = 0, n - 1 do
      local ww = (hw + grow) * 2 * (1 - i / n)
      nova.ui.rect(x - ww / 2, y + i + (pass == 1 and 0 or -1), ww, 1.5, col)
    end
  end
end

local PICK_ICON = { w = s(42), h = s(35) }
local CYC_ROW = s(18) -- (the count's row under the parcel's lines)
local LINE_H = F.name -- (a one-line panel: the full van, or the empty van)
local BTN_H = F.name + 2 * SP.s -- (the button row: a red key, its word xs-s inside it)
-- A button-like row: a red key across x, x + w with its word on it (a button; the chip on the panel's corner names the pad's button).
local function button_row(x, y, w, str, a)
  ui.key(x, y, w, BTN_H, C.red, { scale = ui.FRAME.key * S, alpha = a })
  text(x + w / 2, y + (BTN_H - F.name) / 3, str, { size = F.name, align = "center", color = alpha(C.cream, a), bold = true })
  ui.button_box = { x = x, y = y, w = w, h = BTN_H, word = str } -- (for the tests)
end
local PICK_LINES_H = F.name + SP.xs + F.line
function ui.van_panel(d, w, h, dt)
  local a = d.a or 1
  local mode = d.mode
  local many = mode == "pick" and #d.list > 1
  local name, street, which
  if mode == "pick" then which = d.list[d.i] or d.list[1]; name, street = ui.label_lines(which) end
  -- the size, from the content
  -- "pick": parcel lines, the count, then a "Take" button row; "load": a "Store" button row, or (the van full) the plain note
  -- "The van is full" with no button; "empty": the plain note. A button row has a chip, the A cap, on the panel's bottom-right corner.
  local cw, chh
  local btn = (mode == "pick" and words.van.take) or (mode == "load" and not d.full and words.van.store) or nil
  local btn_w = btn and (text_width(btn, F.name, true) + 2 * SP.xl) or 0
  if mode == "pick" then
    local row1 = PICK_ICON.w + ui.GAP + math.max(text_width(name, F.name, true), text_width(street, F.line))
    local row2 = many and ui.cycler_width(d.i, #d.list) or 0
    cw, chh = math.max(row1, row2, btn_w), PICK_LINES_H + (many and SP.s + CYC_ROW or 0) + SP.s + BTN_H
  elseif mode == "load" then
    if btn then cw, chh = btn_w, BTN_H
    else cw, chh = text_width(words.van.full, F.name, true), LINE_H end
  else
    cw, chh = text_width(words.van.empty, F.name, true), LINE_H
  end
  local pw, ph, left, top = ui.box(cw, chh + TAG_CLEAR, ui.PAD, ui.FRAME.small)
  top = top + TAG_CLEAR
  -- the anchor, eased
  local f = ui.float
  if not f then f = { x = d.ax, y = d.ay }; ui.float = f
  else
    local k = 1 - math.exp(-(dt or 1 / 60) * 16)
    f.x, f.y = f.x + (d.ax - f.x) * k, f.y + (d.ay - f.y) * k
  end
  local x = math.max(SP.s, math.min(w - SP.s - pw, f.x - pw / 2))
  local y = math.max(SP.xl + SP.xs, math.min(h - SP.s - ph - TAIL, f.y - TAIL - ph)) + (1 - a) * SP.s
  local note = d.note or 0
  if note > 0 then x = x + math.sin(note * 38) * SP.xs * note end
  ui.panel(x, y, pw, ph, { alpha = a, scale = ui.FRAME.small })
  tail(math.max(x + SP.l, math.min(x + pw - SP.l, f.x)), y + ph - SP.xs, SP.s, TAIL + SP.xs, a)
  -- the tag: "Van 2/4"
  local tag = words.van.tag .. " " .. d.count .. "/" .. d.cap
  local tw, th = text_width(tag, F.small, true) + 2 * SP.m, F.small + 2 * SP.xs + SP.xs
  local tx, ty = x + SP.m, y - th * 0.55
  ui.key(tx, ty, tw, th, C.red, { scale = 0.25 * S, alpha = a })
  text(tx + tw / 2, ty + th / 2 - F.small * 0.62 - 1, tag, { size = F.small, align = "center", color = alpha(C.cream, a), bold = true })
  local x0, y0 = x + left, y + top
  if mode == "pick" then
    nova.ui.sprite("ui/parcel_icon", x0 + PICK_ICON.w / 2, y0 + PICK_LINES_H / 2, { w = PICK_ICON.w, h = PICK_ICON.h, color = { 255, 255, 255, math.floor(255 * a) } })
    local tx0 = x0 + PICK_ICON.w + ui.GAP
    text(tx0, y0, name, { size = F.name, color = alpha(C.ink, a), bold = true })
    text(tx0, y0 + F.name + SP.xs, street, { size = F.line, color = alpha(C.faint, a) })
    if many then ui.cycler(x0 + cw / 2, y0 + PICK_LINES_H + SP.s + CYC_ROW / 2, d.i, #d.list, { alpha = a }) end
    button_row(x0, y0 + chh - BTN_H, cw, btn, a)
  elseif mode == "load" and btn then
    button_row(x0, y0, cw, btn, a)
  elseif mode == "load" then
    text(x0 + cw / 2, y0, words.van.full, { size = F.name, align = "center", color = alpha(note > 0 and C.red or C.faint, a), bold = true })
  else
    text(x0 + cw / 2, y0, words.van.empty, { size = F.name, align = "center", color = alpha(C.faint, a), bold = true })
  end
  if btn then ui.corner_chip(x, y, pw, ph, "A", a) else ui.chip_box = nil end
  ui.van_panel_box = { x = x, y = y, w = pw, h = ph, left = left, top = top, tail_x = f.x, anchor_y = f.y } -- (for the tests: where the panel is)
end

-- A small tip floating over what can be picked up (the owner, 2026-11-23: "a similar floating tooltip when the player is near the package
-- that shows a trimmed version of that popup"): the van panel's style (paper panel, a tail down to the point), a name over a street (the
-- parcel's label, trimmed) or one line (the Mayor's letter), and the button's cap with its word, small. `d`: id (what it is over: a new id
-- starts at the new anchor), ax, ay (the point on the screen), name, street (or nil), key and word (the button and what it does), a (0 to 1).
-- The anchor eases, so the tip does not jitter; it stays on the screen. A text panel (PAD in the small frame).
ui.tip_f = nil
ui.tip_id = nil
function ui.tip_reset() ui.tip_f, ui.tip_id = nil, nil end
local TIP_ICON = { w = s(40), h = s(33) }
function ui.tip(d, w, h, dt)
  local a = d.a or 1
  if a <= 0 then return end
  local f = ui.tip_f
  if not f or ui.tip_id ~= d.id then f = { x = d.ax, y = d.ay }; ui.tip_f, ui.tip_id = f, d.id
  else
    local k = 1 - math.exp(-(dt or 1 / 60) * 16)
    f.x, f.y = f.x + (d.ax - f.x) * k, f.y + (d.ay - f.y) * k
  end
  local two = d.street ~= nil
  local nw = text_width(d.name, F.name, true)
  local sw = two and text_width(d.street, F.line) or 0
  local lines_h = two and (F.name + SP.xs + F.line) or F.name
  local row1 = two and (TIP_ICON.w + ui.GAP + math.max(nw, sw)) or nw
  -- (with a chip on the corner: the content keeps the chip's half clear on the right, and the bottom pad grows to clear it)
  local cw, ch, left, top = ui.box(row1 + (d.chip and ui.CHIP / 2 or 0), lines_h + (d.chip and SP.xs or 0), ui.PAD, ui.FRAME.small)
  local x = math.max(SP.s, math.min(w - SP.s - cw, f.x - cw / 2))
  local y = math.max(SP.xl + SP.xs, math.min(h - SP.s - ch - TAIL, f.y - TAIL - ch)) + (1 - a) * SP.s
  ui.panel(x, y, cw, ch, { alpha = a, scale = ui.FRAME.small })
  tail(math.max(x + SP.l, math.min(x + cw - SP.l, f.x)), y + ch - SP.xs, SP.s, TAIL + SP.xs, a)
  local x0, y0 = x + left, y + top
  local tx = x0
  if two then
    nova.ui.sprite("ui/parcel_icon", x0 + TIP_ICON.w / 2, y0 + lines_h / 2, { w = TIP_ICON.w, h = TIP_ICON.h, color = { 255, 255, 255, math.floor(255 * a) } })
    tx = x0 + TIP_ICON.w + ui.GAP
    text(tx, y0, d.name, { size = F.name, color = alpha(C.ink, a), bold = true })
    text(tx, y0 + F.name + SP.xs, d.street, { size = F.line, color = alpha(C.faint, a) })
  else
    text(tx, y0, d.name, { size = F.name, color = alpha(C.ink, a), bold = true })
  end
  if d.chip then ui.corner_chip(x, y, cw, ch, d.chip, a) else ui.chip_box = nil end
  ui.tip_box = { x = x, y = y, w = cw, h = ch, left = left, top = top, tail_x = f.x, anchor_y = f.y, word = d.name } -- (for the tests)
end

-- The minimap: a small disc in the bottom-left corner with the roads right round you (about 90 m each way) and you in the middle.
-- Nothing else: no houses, no numbers, nowhere to go. It turns with the camera (the owner's fifth play: "The direction should move
-- when rotated to follow the players camera direction. There should be a North marker on the map too."): up on the disc is always the
-- way the camera looks, the roads turn under you, your mark shows which way you (or the van) face against that, and a red "N" tab rides
-- the rim where north is. `yaw` is the camera's (0 looks north, +z; it turns towards +x, the west, as it grows). The roads are drawn in
-- the paper map's colours and casing (tools/map.mjs), on the kit's wooden frame (tools/art.mjs).
local MM = { r = 64, scale = 64 / 85, north_r = 65.5 }
local ROAD_COLOURS = {
  road = { fill = { 251, 244, 226 }, edge = { 90, 70, 52, 230 }, w = 6 },
  gravel = { fill = { 239, 223, 186 }, edge = { 109, 86, 64, 230 }, w = 4.5 },
}
function ui.minimap(px, pz, heading, w, h, yaw)
  yaw = yaw or 0
  local cx, cy = ui.EDGE + MM.r + 8, h - ui.EDGE - MM.r - 8
  nova.ui.sprite("ui/minimap_disc", cx, cy, { w = (MM.r + 8) * 2, h = (MM.r + 8) * 2 })
  -- (a road is cut at 62, a little past the meadow's edge (61.2) and under the frame's rim, drawn over the roads below: no flat end shows)
  local r, k = MM.r - 2, MM.scale
  -- (seen from above with the camera's look up the screen: its right is (-cos yaw, sin yaw) in x, z and its look (sin yaw, cos yaw);
  -- at yaw 0 screen x is east = -x and screen y is south = -z, as on the paper map)
  local fs, fc = math.sin(yaw), math.cos(yaw)
  local function to(x, z)
    local dx, dz = x - px, z - pz
    return cx + (dz * fs - dx * fc) * k, cy - (dx * fs + dz * fc) * k
  end
  MM.to, MM.yaw = to, yaw -- (for the tests: where a point of the ground is on the disc)
  -- Each road is a stroked line with round joins: every piece a soft-edged bar picture (ui/minimap_road, its long edges smoothed in the
  -- picture, so a line at any angle has no stair-steps and does not shimmer as the disc turns), and every bend a soft disc
  -- (ui/minimap_joint) of the same width, so the pieces meet with no notch. The casing of every road first, then every fill: where two
  -- roads meet they join. (The roads' points within reach are found once and reused for both passes.)
  local near = {}
  for _, road in ipairs(world.roads) do
    local pts, list = road.points, {}
    for i = 1, #pts do
      local x, y = to(pts[i][1], pts[i][2])
      list[i] = { x, y, (x - cx) ^ 2 + (y - cy) ^ 2 }
    end
    near[#near + 1] = { list = list, style = ROAD_COLOURS[road.surface] or ROAD_COLOURS.gravel }
  end
  local R2 = (r + 12) ^ 2
  local PAD = 16 / 12 -- (the pictures have a soft margin round the stroke: tools/art.mjs)
  for pass = 1, 2 do
    for _, road in ipairs(near) do
      local list, style = road.list, road.style
      local lw = pass == 1 and style.w + 3 or style.w
      local col = pass == 1 and style.edge or style.fill
      for i = 1, #list - 1 do
        local p, q = list[i], list[i + 1]
        if p[3] < R2 or q[3] < R2 then
          local ax, ay, bx, by = p[1], p[2], q[1], q[2]
          -- clip the piece to the disc
          local dx, dy = bx - ax, by - ay
          local fx, fy = ax - cx, ay - cy
          local a = dx * dx + dy * dy
          if a > 1e-6 then
            local b, c = 2 * (fx * dx + fy * dy), fx * fx + fy * fy - r * r
            local disc = b * b - 4 * a * c
            if disc > 0 then
              local s = math.sqrt(disc)
              local t0, t1 = math.max(0, (-b - s) / (2 * a)), math.min(1, (-b + s) / (2 * a))
              if t1 > t0 then
                local x0, y0, x1, y1 = ax + dx * t0, ay + dy * t0, ax + dx * t1, ay + dy * t1
                local len = math.sqrt((x1 - x0) ^ 2 + (y1 - y0) ^ 2)
                nova.ui.sprite("ui/minimap_road", (x0 + x1) / 2, (y0 + y1) / 2, { w = len, h = lw * PAD, rotation = math.atan(dy, dx), color = col })
                -- (the joint at the far end, when it is inside the disc with room for its round)
                if i == 1 and t0 <= 0 and p[3] < (r - lw / 2) ^ 2 then
                  nova.ui.sprite("ui/minimap_joint", ax, ay, { w = lw * PAD, h = lw * PAD, color = col }) -- (a road's start: round too)
                end
                if t1 >= 1 and q[3] < (r - lw / 2) ^ 2 then
                  nova.ui.sprite("ui/minimap_joint", bx, by, { w = lw * PAD, h = lw * PAD, color = col })
                end
              end
            end
          end
        end
      end
    end
  end
  -- the frame's rim over the roads' ends (the disc's own paper edge and wood, with nothing inside): the roads go under the frame
  nova.ui.sprite("ui/minimap_rim", cx, cy, { w = (MM.r + 8) * 2, h = (MM.r + 8) * 2 })
  -- north: a red tab on the rim, its letter upright, going round as the camera turns
  nova.ui.sprite("ui/minimap_north", cx + fs * MM.north_r, cy - 1.4 - fc * MM.north_r, { w = 21, h = 21 })
  -- you: pointing the way you face against the way the camera looks (heading 0 faces north; a heading towards +x, the west, turns it
  -- left; the same heading as the camera's yaw points straight up)
  MM.you = yaw - heading
  nova.ui.sprite("ui/you", cx, cy, { w = 24, h = 24, rotation = MM.you })
end
ui.MINIMAP = MM

-- A fade over everything (scene changes, getting in and out): 0 clear to 1 dark.
function ui.fade(a, w, h)
  if a > 0.003 then nova.ui.rect(0, 0, w, h, { 26, 20, 16, math.floor(255 * math.min(1, a)) }, { layer = "top" }) end
end

return ui
