-- The slice's UI kit: one theme for every piece of UI in the game (docs/games/mountain-post.md, "UI theme"). Its pictures are a
-- few pieces of Kenney's UI Pack (CC0) recoloured into the toy palette by tools/ui-kit.mjs (sprites/ui/kit/): a paper panel on a
-- wooden frame, a key (raised, or pressed), a round button cap, a parcel's label slip, a rule and two chevrons. Everything below
-- draws from them; nothing else in the game draws a panel, a button or a chip of its own.
--
--   ui.panel        a paper panel (cards, the dialogue box, menus, the map's frame, the letter)
--   ui.key          a key, raised or pressed, in any colour (buttons, tabs, tags, title strips)
--   ui.glyph        a face button's cap with its letter (A, B, X, Y in the pad's colours); ui.shoulder: L1 / R1
--   ui.chip         a prompt: a small panel with a button and its word; ui.hints lays them out at the bottom right
--   ui.title_strip  a heading on a red key; ui.tag a name tag in a speaker's colour; ui.rule a groove under a heading
--   ui.slip         a parcel's label (white, the post's red double edge); ui.cycler: L1  1 of 2  R1
--   ui.parcel_card  the one card in the top-left corner; ui.picker the van's parcel panel; ui.dim, ui.fade
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
ui.PAD = s(18) -- inside a panel, from its frame to what it holds

local REGULAR, HEAVY = 0.55, 1.3
-- Text in the one face: `bold = true` is the heavy weight, nothing the regular. Everything is rounded, whatever is asked.
function ui.text(x, y, str, opts)
  opts = opts or {}
  opts.font = "rounded"
  if opts.bold == nil then opts.bold = REGULAR elseif opts.bold == true then opts.bold = HEAVY elseif opts.bold == false then opts.bold = nil end
  return nova.ui.text(x, y, str, opts)
end
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
  PANEL.scale = (opts.scale or 0.5) * S
  PANEL.color = { 255, 255, 255, math.floor(255 * a) }
  -- a soft shadow on what is under it (the world, or the room)
  nova.ui.rect(x + s(3), y + s(7), w, h, { C.shade[1], C.shade[2], C.shade[3], math.floor(60 * a) }, { radius = s(12) })
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

-- A shoulder button (L1, R1): a small slate key with its name, centred on x, y.
function ui.shoulder(x, y, name, size, opts)
  size = size or s(26)
  opts = opts or {}
  local w = size * 1.75
  ui.key(x - w / 2, y - size / 2, w, size, C.slate, { down = opts.down, alpha = opts.alpha, scale = size / 70 })
  local dy = opts.down and size * 0.06 or 0
  text(x, y - size * 0.4 + dy, name, { size = size * 0.58, align = "center", color = alpha(C.cream, opts.alpha), bold = true })
end

-- How wide a prompt chip is, and the chip itself: a small panel holding a button and its word (`button` nil: the word alone).
local CHIP_H = s(40)
function ui.chip_width(button, str)
  return text_width(str, F.hint) + (button and s(56) or s(34))
end
function ui.chip(x, y, button, str, opts)
  opts = opts or {}
  local w = ui.chip_width(button, str)
  ui.panel(x, y, w, CHIP_H, { scale = 0.4, alpha = opts.alpha })
  local tx = x + s(17)
  if button then
    if button == "L1" or button == "R1" then ui.shoulder(x + s(24), y + CHIP_H / 2 - 1, button, s(20), { down = opts.down })
    else ui.glyph(x + s(22), y + CHIP_H / 2 - 1, button, s(25), { down = opts.down }) end
    tx = x + s(42)
  end
  text(tx, y + CHIP_H / 2 - F.hint * 0.62, str, { size = F.hint, color = alpha(C.ink, opts.alpha) })
  return w
end

-- Which game action each button of a hint is (so a chip shows its button held while it is held).
local ACTION = { A = "act", B = "van", X = "horn", Y = "map", L1 = "prev", R1 = "next" }
local function held(button) return button and ACTION[button] and nova.input.down(ACTION[button]) end

-- The prompts at the bottom right: { { "A", "Take" }, { "B", "Get in" } } (a hint with no button, { nil, "words" }, is words alone).
function ui.hints(list, w, h)
  if not list or #list == 0 then return end
  local x = w - s(22)
  for i = #list, 1, -1 do
    local item = list[i]
    x = x - ui.chip_width(item[1], item[2])
    ui.chip(x, h - s(22) - CHIP_H, item[1], item[2], { down = held(item[1]) })
    x = x - s(10)
  end
end

-- A heading on a red key, centred on x (its top at y); returns its height.
function ui.title_strip(x, y, str, opts)
  opts = opts or {}
  local size = opts.size or F.heading
  local tw = text_width(str, size, true)
  local w, h = math.max(opts.min_w or 0, tw + s(44)), size + s(20)
  ui.key(x - w / 2, y, w, h, opts.colour or C.red, { scale = 0.45 * S, alpha = opts.alpha })
  text(x, y + s(6), str, { size = size, align = "center", color = alpha(C.cream, opts.alpha), bold = true })
  return h
end

-- A name tag in the speaker's colour, its left edge at x, its top at y.
function ui.tag(x, y, str, colour)
  local tw = text_width(str, F.name, true) + s(36)
  ui.key(x, y, tw, s(38), colour, { scale = 0.42 * S })
  text(x + tw / 2, y + s(5), str, { size = F.name, align = "center", color = C.cream, bold = true })
  return tw
end

-- A groove under a heading, from x to x + w.
function ui.rule(x, y, w, opts)
  nova.ui.panel(KIT .. "rule", x, y, w, s(4), { slice = { 8, 0, 8, 0 }, scale = 0.5 * S, color = { 255, 255, 255, math.floor(255 * ((opts and opts.alpha) or 1)) } })
end

-- A parcel's label slip (white, the post's red double edge).
local SLIP = { slice = { 20, 20, 20, 20 }, scale = 0.45 }
function ui.slip(x, y, w, h, opts)
  SLIP.scale = 0.45 * S
  SLIP.color = { 255, 255, 255, math.floor(255 * ((opts and opts.alpha) or 1)) }
  nova.ui.panel(KIT .. "slip", x, y, w, h, SLIP)
end

-- "L1  1 of 2  R1": going round a list, centred on x (its middle at y).
function ui.cycler(x, y, i, n, opts)
  opts = opts or {}
  local a = opts.alpha or 1
  local count = i .. " of " .. n
  local fs = F.small + 1
  local tw = text_width(count, fs)
  local half = tw / 2 + s(40)
  ui.shoulder(x - half, y, "L1", s(22), { down = held("L1"), alpha = a })
  ui.shoulder(x + half, y, "R1", s(22), { down = held("R1"), alpha = a })
  local ch = { w = s(13), h = s(13), color = tint(C.slate, math.floor(255 * a)) }
  nova.ui.sprite(KIT .. "chev_l", x - half - s(30), y - 1, ch)
  nova.ui.sprite(KIT .. "chev_r", x + half + s(30), y - 1, ch)
  text(x, y - fs * 0.62, count, { size = fs, align = "center", color = alpha(opts.colour or C.faint, a) })
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
-- and shows neither the count nor the buttons.
local CARD_W, CARD_H = s(318), s(92)
function ui.parcel_card(which, where, i, n, opts)
  if not which then return end
  opts = opts or {}
  local a = opts.dim and 0.45 or 1
  local x, y = s(20), s(18)
  local many = n > 1 and not opts.dim
  ui.panel(x, y, CARD_W, CARD_H + (many and s(36) or 0), { alpha = a })
  nova.ui.sprite("ui/parcel_icon", x + s(46), y + s(44), { w = s(58), h = s(48), color = { 255, 255, 255, math.floor(255 * a) } })
  local name, street = ui.label_lines(which)
  text(x + s(86), y + s(12), name, { size = F.name, color = alpha(C.ink, a), bold = true })
  text(x + s(86), y + s(40), street, { size = F.line, color = alpha(C.faint, a) })
  -- where it is: in your arms, or in the van
  local col = where == "hands" and C.blue or C.red
  text(x + s(86), y + s(63), where == "hands" and words.card.hands or words.card.van, { size = F.small, color = alpha(col, a), bold = true })
  if many then
    ui.rule(x + s(16), y + CARD_H - s(4), CARD_W - s(32))
    ui.cycler(x + CARD_W / 2, y + CARD_H + s(15), i, n)
  end
end

-- The panel at the van's open back, a light overlay low in the middle of the screen (it never takes the stick or stops anything: see
-- Valley:fade_picker): the parcels in the van shown one at a time (the label: name and street), "1 of 2" and L1 / R1 to go round
-- them when there is more than one, and A to take the one shown. With one parcel: the same panel, without the count and the
-- shoulder buttons. `a` (0 to 1) is how far it has faded up; it slides up a little as it comes.
function ui.picker(list, i, w, h, a)
  if not list or #list == 0 then return end
  a = a or 1
  local which = list[i] or list[1]
  local name, street = ui.label_lines(which)
  local many = #list > 1
  local cw, ch = s(430), s(many and 176 or 156)
  local x, y = (w - cw) / 2, h - ch - s(24) + (1 - a) * s(26)
  local o = { alpha = a }
  ui.panel(x, y, cw, ch, o)
  ui.title_strip(w / 2, y - s(16), words.picker.title, { size = sz(22, 15), alpha = a })
  -- the label: a slip with the parcel's icon beside the name and the street
  local sy = y + s(28)
  ui.slip(x + s(20), sy, cw - s(40), s(78), o)
  nova.ui.sprite("ui/parcel_icon", x + s(66), sy + s(39), { w = s(54), h = s(45), color = { 255, 255, 255, math.floor(255 * a) } })
  text(x + s(104), sy + s(10), name, { size = sz(27, 15), color = alpha(C.ink, a), bold = true })
  text(x + s(104), sy + s(43), street, { size = F.line + 1, color = alpha(C.faint, a) })
  local by = sy + s(78) + s(9)
  if many then
    ui.cycler(w / 2, by + s(11), i, #list, o)
    by = by + s(24)
  end
  -- A takes it
  local tw = ui.chip_width("A", words.hint.take)
  ui.glyph(w / 2 - tw / 2 + s(22), by + s(19), "A", s(25), { down = held("A"), alpha = a })
  text(w / 2 - tw / 2 + s(42), by + s(19) - F.hint * 0.62, words.hint.take, { size = F.hint, color = alpha(C.ink, a), bold = true })
end

-- The minimap: a small disc in the bottom-left corner with the roads right round you (about 90 m each way) and you in the middle,
-- north up, like the paper map. Nothing else: no houses, no numbers, nowhere to go.
local MM = { r = 64, scale = 64 / 85 }
function ui.minimap(px, pz, heading, w, h)
  local cx, cy = 24 + MM.r + 4, h - 24 - MM.r - 4
  nova.ui.sprite("ui/minimap_disc", cx, cy, { w = (MM.r + 8) * 2, h = (MM.r + 8) * 2 })
  local r, k = MM.r - 4, MM.scale
  -- (screen x is east = -x; screen y is south = -z)
  local function to(x, z) return cx + (px - x) * k, cy + (pz - z) * k end
  for _, road in ipairs(world.roads) do
    local pts = road.points
    local lw = road.surface == "road" and 6 or 4.5
    local col = road.surface == "road" and { 255, 251, 240 } or { 244, 230, 196 }
    for i = 1, #pts - 1 do
      local ax, ay = to(pts[i][1], pts[i][2])
      local bx, by = to(pts[i + 1][1], pts[i + 1][2])
      -- clip the segment to the disc
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
            nova.ui.line(ax + dx * t0, ay + dy * t0, ax + dx * t1, ay + dy * t1, lw + 3, { 70, 58, 44, 200 })
            nova.ui.line(ax + dx * t0, ay + dy * t0, ax + dx * t1, ay + dy * t1, lw, col)
          end
        end
      end
    end
  end
  -- you: pointing the way you face (heading 0 faces north; a heading towards +x, the west, turns it left)
  nova.ui.sprite("ui/you", cx, cy, { w = 24, h = 24, rotation = -heading })
end
ui.MINIMAP = MM

-- A fade over everything (scene changes, getting in and out): 0 clear to 1 dark.
function ui.fade(a, w, h)
  if a > 0.003 then nova.ui.rect(0, 0, w, h, { 26, 20, 16, math.floor(255 * math.min(1, a)) }, { layer = "top" }) end
end

return ui
