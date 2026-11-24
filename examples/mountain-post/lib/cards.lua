-- What opens over the game and waits for the player: the Mayor's letter, the paper map, the
-- quiet card at the end, and the pause menu. One at a time; while one is open the world stands still around the player.
local ui = require("lib.ui")
local words = require("lib.words")

local cards = {}
local open -- { kind, data, t, choice }

function cards.open(kind, data)
  open = { kind = kind, data = data, t = 0, choice = 1, prev = (kind == "controls" and open and open.kind == "pause") and open or nil }
  if kind == "letter" or kind == "map" then nova.sound.play("paper", { volume = 0.5, vary = 0.06 }) end
  nova.log("card " .. kind .. (data and data.which and (" " .. data.which) or ""))
end
function cards.close()
  if open and open.kind == "controls" and open.prev then -- (the Controls page opened from the pause menu: back to the menu)
    open = open.prev
    return
  end
  if open and (open.kind == "letter" or open.kind == "map") then nova.sound.play("paper", { volume = 0.35, pitch = 1.12, vary = 0.06 }) end
  local was = open
  open = nil
  if was and was.data and was.data.on_close then was.data.on_close() end
end
function cards.kind() return open and open.kind end
function cards.active() return open ~= nil end

cards.PAUSE_CHOICES = { "resume", "controls", "quit" }

function cards.update(dt)
  if not open then return end
  open.t = open.t + dt
  local k = open.kind
  if k == "pause" then
    local n = #cards.PAUSE_CHOICES
    if nova.input.pressed("menu_down") then open.choice = open.choice % n + 1; nova.sound.play("tick", { volume = 0.35 })
    elseif nova.input.pressed("menu_up") then open.choice = (open.choice - 2) % n + 1; nova.sound.play("tick", { volume = 0.35 }) end
    -- (Start closes it; A confirms the choice: nothing else does anything here)
    if nova.input.pressed("pause") then cards.close(); return end
    if nova.input.pressed("confirm") then
      nova.sound.play("tick", { volume = 0.45, pitch = 1.2 })
      local what = cards.PAUSE_CHOICES[open.choice]
      if what == "resume" then cards.close()
      elseif what == "controls" then cards.open("controls")
      else nova.log("quit"); nova.quit() end
    end
    return
  end
  if k == "controls" then
    -- (B or Start goes back: to the pause menu it came from, or to the title)
    if open.t > 0.15 and (nova.input.pressed("run") or nova.input.pressed("pause")) then cards.close() end
    return
  end
  if open.t < 0.25 then return end -- (a press that opened it does not close it)
  if k == "map" then
    if nova.input.pressed("map") then cards.close() end -- (Select opens it and closes it)
  elseif k == "ending" then
    if open.t > 2.5 and nova.input.pressed("interact") then cards.close() end
  elseif nova.input.pressed("interact") then -- (X closes the letter)
    cards.close()
  end
end

local C, F, s, SP = ui.C, ui.F, ui.s, ui.SP
local text = ui.text

-- (cards come in with a short rise and fade: s goes 0 to 1)
local function rise(t, d) local k = math.min(1, t / (d or 0.18)); return k, 1 - (1 - k) * (1 - k) end

-- The Mayor's letter: a sheet of the paper, who it is to over a rule, her words, her name in her hand. The sheet is as tall as the
-- words (and the test that the letter fits uses its layout).
function cards.letter_layout(w)
  local cw = math.min(s(720), w - 80)
  local I, P = ui.inset(), ui.PAD_LONG
  local px = I.x + P.x -- (the words' left and right, from the sheet's edge)
  local L = { w = cw, text_w = cw - 2 * px, px = px, size = F.body + 1, size2 = F.body, spacing = 1.2 }
  local _, h1 = nova.ui.text_size(words.letter[1], { font = "rounded", size = L.size, width = L.text_w, line_spacing = L.spacing, bold = 0.55 })
  local _, h2 = nova.ui.text_size(words.letter[2], { font = "rounded", size = L.size2, width = L.text_w, line_spacing = L.spacing, bold = 0.55 })
  L.h1, L.h2 = h1, h2
  -- the label line and its rule, then the words; the Mayor's name under them, xl clear
  L.label_y = I.top + P.y
  L.rule_y = L.label_y + F.line + SP.s
  L.top = L.rule_y + SP.xs + SP.m
  L.sign_h = s(28) * 1.3
  L.h = L.top + h1 + SP.l + h2 + SP.xl + L.sign_h + P.y + I.bottom
  return L
end
local function letter_card(w, h, t)
  local k, e = rise(t, 0.2)
  local L = cards.letter_layout(w)
  local cw, ch = L.w, L.h
  local x, y = (w - cw) / 2, (h - ch) / 2 + (1 - e) * 40
  ui.dim(w, h, k * 0.85)
  ui.panel(x, y, cw, ch, { alpha = k })
  text(x + L.px, y + L.label_y, words.labels.letter, { size = F.line, color = ui.alpha(C.faint, k), bold = true })
  ui.rule(x + L.px, y + L.rule_y, cw - 2 * L.px, { alpha = k })
  text(x + L.px, y + L.top, words.letter[1], { size = L.size, width = L.text_w, color = ui.alpha(C.ink, k), line_spacing = L.spacing })
  text(x + L.px, y + L.top + L.h1 + SP.l, words.letter[2], { size = L.size2, width = L.text_w, color = ui.alpha(C.ink, k), line_spacing = L.spacing })
  -- (the Mayor's name in her own hand: the one word in the script face)
  nova.ui.text(x + cw - L.px, y + ch - ui.inset().bottom - ui.PAD_LONG.y - L.sign_h, words.letter_from, { font = "script", size = s(28), align = "right", color = ui.alpha({ 70, 60, 120 }, k) })
end

-- The paper map in a wooden frame (a panel round it; the sheet has the town's name on it already). It is drawn by Nova's map generator
-- (tools/map.mjs, map_make) at the size it is shown, nearly the screen's whole height, for each of the two screens it is made for: the
-- Retroid's 720p (ui/map_720, 650 px high) and 1080p (ui/map, 976 px). It is drawn one texel to a pixel, its corner on a whole pixel,
-- so its lettering is as sharp as it was drawn (scaled, a picture's thin strokes go soft). A screen much bigger draws it twice as big,
-- still whole pixels.
cards.MAPS = { { name = "ui/map_720", below = 900 }, { name = "ui/map" } }
function cards.map_picture()
  local _, ph = nova.view("pixels")
  for _, m in ipairs(cards.MAPS) do
    if not m.below or ph < m.below then return m.name, ph end
  end
end
local function map_card(w, h, t)
  local k, e = rise(t, 0.2)
  ui.dim(w, h, k)
  local name, ph = cards.map_picture()
  local iw, ih = nova.image_size(name)
  local px = ph / h -- (pixels to a unit)
  -- (whole times bigger on a bigger screen; on one smaller than the picture was made for, shrunk to fit: soft, but whole)
  local times = ph * 0.95 >= ih and math.floor(ph * 0.95 / ih) or ph * 0.92 / ih
  local mw, mh = iw * times / px, ih * times / px
  -- (the top-left corner on a whole pixel, rising in whole pixels)
  local x = math.floor((w * px - iw * times) / 2) / px
  local y = math.floor((h * px - ih * times) / 2 + (1 - e) * 30 * px + 0.5) / px
  -- (the frame: the picture is SP.xs inside the wood all round)
  local I = ui.inset()
  ui.panel(x - I.x - SP.xs, y - I.top - SP.xs, mw + 2 * (I.x + SP.xs), mh + I.top + I.bottom + 2 * SP.xs, { alpha = k })
  cards.drawn_map = { name = name, x = x, y = y, w = mw, h = mh, px = px }
  nova.ui.sprite(name, x + mw / 2, y + mh / 2, { w = mw, h = mh, color = { 255, 255, 255, math.floor(255 * k) } })
end

-- The end: the screen goes dark, then a card with the spec's words, and X to go on.
local function ending_card(w, h, t)
  local a = math.min(1, t / 1.5)
  -- (not on the top layer: the card's panel is drawn over it, and the scene hides its prompts and corner card under a card)
  ui.dim(w, h, a, 235)
  local ta = math.max(0, math.min(1, (t - 1.0) / 1.2))
  if ta <= 0 then return end
  local fs = s(36)
  local tw = ui.text_width(words.ending, fs, true)
  local I, P = ui.inset(), ui.PAD_LONG
  local strip = F.heading + 2 * SP.s -- (the title strip hangs half over the card's top edge)
  local text_y = strip / 2 + SP.m
  local cw, ch = tw + 2 * (I.x + P.x), text_y + fs * 1.25 + P.y + I.bottom
  local x, y = (w - cw) / 2, h / 2 - ch / 2
  ui.panel(x, y, cw, ch, { alpha = ta })
  ui.title_strip(w / 2, y - strip / 2, words.title, { alpha = ta })
  text(w / 2, y + text_y, words.ending, { size = fs, align = "center", color = ui.alpha(C.ink, ta), bold = true })
end

-- A column of menu choices as keys (the chosen one red, pressed while A is held), the first one's top at y, centred on x; `alpha` fades them.
-- Plain choices: no button is drawn on them.
function cards.buttons(x, y, bw, labels, choice, alpha)
  local bh = s(56)
  for i, label in ipairs(labels) do
    local yy = y + (i - 1) * (bh + SP.l)
    local on = choice == i
    local down = on and nova.input.down("confirm")
    ui.key(x - bw / 2, yy, bw, bh, on and C.red or nil, { scale = ui.FRAME.big * ui.S, down = down, alpha = alpha })
    text(x, yy + bh / 2 - (F.button + 4) * 0.62 + (down and 3 or 0), label, { size = F.button + 4, align = "center", color = ui.alpha(on and C.cream or C.ink, alpha), bold = on or nil })
  end
  return bh
end

-- Paused: a small card, its choices as keys.
local function pause_card(o, w, h)
  ui.dim(w, h, 1)
  local I, P = ui.inset(), ui.PAD_LONG
  local strip = F.heading + 2 * SP.s -- (the title strip hangs half over the card's top edge)
  local bh = s(56)                  -- a button
  local labels = { words.pause.resume, words.pause.controls, words.pause.quit }
  local cw = s(360)
  local ch = strip / 2 + SP.m + #labels * bh + (#labels - 1) * SP.l + P.y + I.bottom
  local x, y = (w - cw) / 2, (h - ch) / 2
  ui.panel(x, y, cw, ch)
  ui.title_strip(w / 2, y - strip / 2, words.pause.title, { min_w = s(170) })
  cards.buttons(w / 2, y + strip / 2 + SP.m, cw - 2 * (I.x + P.x), labels, o.choice)
end

-- The Controls page: two columns, "On foot" and "Driving", each control as the button engraved on the Retroid (the kit's caps) and
-- what it does. The one place in the game where buttons are drawn. Rows come from words.controls_rows.
local FACE = { A = true, B = true, X = true, Y = true }
local KEY_GAP = SP.xs
local function keys_width(keys)
  local tw = 0
  for i, k in ipairs(keys) do tw = tw + (FACE[k] and ui.KEYCAP or ui.pad_key_width(k)) + (i > 1 and KEY_GAP or 0) end
  return tw
end
local function draw_keys(x, y, keys)
  for _, k in ipairs(keys) do
    if FACE[k] then ui.glyph(x + ui.KEYCAP / 2, y, k, ui.KEYCAP); x = x + ui.KEYCAP + KEY_GAP
    else x = x + ui.pad_key(x, y, k) + KEY_GAP end
  end
end
local ROW = ui.KEYCAP + SP.xs
-- Where everything is, for a screen `w` wide (and the tests).
function cards.controls_layout(w)
  local I, P = ui.inset(), ui.PAD
  local L = { cols = {} }
  for ci, name in ipairs({ "foot", "van" }) do
    local rows = words.controls_rows[name]
    local kw, ww = 0, 0
    for _, r in ipairs(rows) do kw = math.max(kw, keys_width(r.keys)); ww = math.max(ww, ui.text_width(r.word, F.hint)) end
    L.cols[ci] = { name = name, rows = rows, key_w = kw, w = kw + SP.m + ww }
  end
  local gap = SP.xl * 2
  L.gap = gap
  L.w = L.cols[1].w + gap + L.cols[2].w + 2 * (I.x + P.x + SP.m)
  L.left = I.x + P.x + SP.m
  L.strip = F.heading + 2 * SP.s
  L.head_y = L.strip / 2 + SP.m
  L.rows_y = L.head_y + F.name + SP.s + SP.xs + SP.s
  local n = math.max(#L.cols[1].rows, #L.cols[2].rows)
  L.foot_y = L.rows_y + n * ROW + SP.s
  L.h = L.foot_y + SP.xs + SP.m + ROW + P.y + I.bottom
  return L
end
local function controls_card(w, h, t)
  local k, e = rise(t, 0.2)
  ui.dim(w, h, k)
  local L = cards.controls_layout(w)
  local x, y = (w - L.w) / 2, (h - L.h) / 2 + (1 - e) * 30 + L.strip / 4
  ui.panel(x, y, L.w, L.h, { alpha = k })
  ui.title_strip(w / 2, y - L.strip / 2, words.controls.title, { alpha = k })
  local cx = x + L.left
  for ci, col in ipairs(L.cols) do
    text(cx, y + L.head_y, words.controls[col.name], { size = F.name, color = ui.alpha(C.faint, k), bold = true })
    ui.rule(cx, y + L.head_y + F.name + SP.s, col.w, { alpha = k })
    for i, r in ipairs(col.rows) do
      local ry = y + L.rows_y + (i - 1) * ROW + ui.KEYCAP / 2
      draw_keys(cx, ry, r.keys)
      text(cx + col.key_w + SP.m, ry - F.hint * 0.62, r.word, { size = F.hint, color = ui.alpha(C.ink, k) })
    end
    cx = cx + col.w + L.gap
  end
  -- the foot: how the menus go
  local fy = y + L.foot_y
  ui.rule(x + L.left, fy, L.w - 2 * L.left, { alpha = k })
  local fx, ry = x + L.left, fy + SP.xs + SP.m + ui.KEYCAP / 2
  for _, r in ipairs(words.controls_menus) do
    draw_keys(fx, ry, r.keys)
    fx = fx + keys_width(r.keys) + ui.GAP
    text(fx, ry - F.hint * 0.62, r.word, { size = F.hint, color = ui.alpha(C.ink, k) })
    fx = fx + ui.text_width(r.word, F.hint) + SP.xl
  end
end

function cards.draw(w, h)
  if not open then return end
  local k, t = open.kind, open.t
  if k == "letter" then letter_card(w, h, t)
  elseif k == "map" then map_card(w, h, t)
  elseif k == "ending" then ending_card(w, h, t)
  elseif k == "controls" then controls_card(w, h, t)
  elseif k == "pause" then pause_card(open, w, h) end
end

return cards
