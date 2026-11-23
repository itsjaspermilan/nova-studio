-- What opens over the game and waits for the player: a parcel's label held up to read, the Mayor's letter, the paper map, the
-- quiet card at the end, and the pause menu. One at a time; while one is open the world stands still around the player.
local ui = require("lib.ui")
local words = require("lib.words")

local cards = {}
local open -- { kind, data, t, choice }

function cards.open(kind, data)
  open = { kind = kind, data = data, t = 0, choice = 1 }
  if kind == "label" or kind == "letter" or kind == "map" then nova.sound.play("paper", { volume = 0.5, vary = 0.06 }) end
  nova.log("card " .. kind .. (data and data.which and (" " .. data.which) or ""))
end
function cards.close()
  if open and (open.kind == "label" or open.kind == "letter" or open.kind == "map") then nova.sound.play("paper", { volume = 0.35, pitch = 1.12, vary = 0.06 }) end
  local was = open
  open = nil
  if was and was.data and was.data.on_close then was.data.on_close() end
end
function cards.kind() return open and open.kind end
function cards.active() return open ~= nil end

function cards.update(dt)
  if not open then return end
  open.t = open.t + dt
  local k = open.kind
  if k == "pause" then
    if nova.input.pressed("menu_up") or nova.input.pressed("menu_down") then
      open.choice = 3 - open.choice
      nova.sound.play("tick", { volume = 0.35 })
    end
    -- (Start closes it; A confirms the choice: nothing else does anything here)
    if nova.input.pressed("pause") then cards.close(); return end
    if nova.input.pressed("confirm") then
      nova.sound.play("tick", { volume = 0.45, pitch = 1.2 })
      if open.choice == 1 then cards.close() else nova.log("quit"); nova.quit() end
    end
    return
  end
  if open.t < 0.25 then return end -- (a press that opened it does not close it)
  if k == "map" then
    if nova.input.pressed("map") then cards.close() end -- (Select opens it and closes it)
  elseif k == "ending" then
    if open.t > 2.5 and nova.input.pressed("interact") then cards.close() end
  elseif nova.input.pressed("interact") then -- (X closes a label or the letter)
    cards.close()
  end
end

local C, F, s = ui.C, ui.F, ui.s
local text = ui.text

-- (cards come in with a short rise and fade: s goes 0 to 1)
local function rise(t, d) local k = math.min(1, t / (d or 0.18)); return k, 1 - (1 - k) * (1 - k) end

-- A parcel's label held up to read: a paper card with "Parcel" on its title strip, the label slip on it, "To:" and the name and
-- the street large.
local function label_card(which, w, h, t)
  local k, e = rise(t)
  local cw, ch = s(640), s(300)
  local x, y = (w - cw) / 2, (h - ch) / 2 - s(6) + (1 - e) * 30
  ui.dim(w, h, k * 0.8)
  ui.panel(x, y, cw, ch, { alpha = k })
  ui.title_strip(w / 2, y - s(20), words.parcel, { alpha = k })
  ui.slip(x + s(36), y + s(42), cw - s(72), ch - s(80), { alpha = k })
  local name, street = ui.label_lines(which)
  text(x + s(70), y + s(62), "To:", { size = F.line, color = ui.alpha(C.faint, k) })
  text(w / 2, y + s(92), name, { size = s(50), align = "center", color = ui.alpha(C.ink, k), bold = true })
  text(w / 2, y + s(166), street, { size = s(36), align = "center", color = ui.alpha(C.ink, k) })
end

-- The Mayor's letter: a sheet of the paper, who it is to over a rule, her words, her name in her hand. The sheet is as tall as the
-- words (and the test that the letter fits uses its layout).
function cards.letter_layout(w)
  local cw = math.min(s(720), w - 80)
  local L = { w = cw, text_w = cw - s(88), size = F.body + 1, size2 = F.body, spacing = 1.2 }
  local _, h1 = nova.ui.text_size(words.letter[1], { font = "rounded", size = L.size, width = L.text_w, line_spacing = L.spacing, bold = 0.55 })
  local _, h2 = nova.ui.text_size(words.letter[2], { font = "rounded", size = L.size2, width = L.text_w, line_spacing = L.spacing, bold = 0.55 })
  L.h1, L.h2 = h1, h2
  L.top = s(78)
  L.h = L.top + h1 + s(18) + h2 + s(34) + s(40) + s(30)
  return L
end
local function letter_card(w, h, t)
  local k, e = rise(t, 0.2)
  local L = cards.letter_layout(w)
  local cw, ch = L.w, L.h
  local x, y = (w - cw) / 2, (h - ch) / 2 + (1 - e) * 40
  ui.dim(w, h, k * 0.85)
  ui.panel(x, y, cw, ch, { alpha = k })
  text(x + s(44), y + s(28), words.labels.letter, { size = F.line, color = ui.alpha(C.faint, k), bold = true })
  ui.rule(x + s(40), y + s(58), cw - s(80), { alpha = k })
  text(x + s(44), y + L.top, words.letter[1], { size = L.size, width = L.text_w, color = ui.alpha(C.ink, k), line_spacing = L.spacing })
  text(x + s(44), y + L.top + L.h1 + s(18), words.letter[2], { size = L.size2, width = L.text_w, color = ui.alpha(C.ink, k), line_spacing = L.spacing })
  -- (the Mayor's name in her own hand: the one word in the script face)
  nova.ui.text(x + cw - s(44), y + ch - s(66), words.letter_from, { font = "script", size = s(28), align = "right", color = ui.alpha({ 70, 60, 120 }, k) })
end

-- The paper map in a wooden frame (a panel round it; the sheet has the town's name on it already).
local function map_card(w, h, t)
  local k, e = rise(t, 0.2)
  ui.dim(w, h, k)
  local mh = (h - 74) * 0.88
  local mw = mh * 1000 / 1100
  local x, y = (w - mw) / 2, (h - mh) / 2 + 10 + (1 - e) * 30
  ui.panel(x - s(12), y - s(12), mw + s(24), mh + s(28), { alpha = k })
  nova.ui.sprite("ui/map", w / 2, y + mh / 2, { w = mw, h = mh, color = { 255, 255, 255, math.floor(255 * k) } })
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
  local cw, ch = tw + s(100), s(150)
  local x, y = (w - cw) / 2, h / 2 - s(70)
  ui.panel(x, y, cw, ch, { alpha = ta })
  ui.title_strip(w / 2, y - s(20), words.title, { alpha = ta })
  text(w / 2, y + s(44), words.ending, { size = fs, align = "center", color = ui.alpha(C.ink, ta), bold = true })
  if t > 2.5 then ui.chip(w / 2 - ui.chip_width("X", words.hint.close) / 2, y + ch + s(18), "X", words.hint.close, { down = nova.input.down("interact") }) end
end

-- Paused: a small card, its two choices as keys (the chosen one red, pressed while A is held).
local function pause_card(o, w, h)
  ui.dim(w, h, 1)
  local cw, ch = s(360), s(230)
  local x, y = (w - cw) / 2, (h - ch) / 2
  ui.panel(x, y, cw, ch)
  ui.title_strip(w / 2, y - s(22), words.pause.title, { min_w = s(170) })
  for i, label in ipairs({ words.pause.resume, words.pause.quit }) do
    local yy = y + s(52) + (i - 1) * s(76)
    local on = o.choice == i
    local down = on and nova.input.down("confirm")
    ui.key(x + s(46), yy, cw - s(92), s(56), on and C.red or nil, { scale = 0.5 * ui.S, down = down })
    text(w / 2, yy + s(28) - (F.button + 4) * 0.62 + (down and 3 or 0), label, { size = F.button + 4, align = "center", color = on and C.cream or C.ink, bold = on or nil })
  end
end

function cards.draw(w, h)
  if not open then return end
  local k, t = open.kind, open.t
  if k == "label" then label_card(open.data.which, w, h, t); ui.hints({ { "X", words.hint.close } }, w, h)
  elseif k == "letter" then letter_card(w, h, t); ui.hints({ { "X", words.hint.close } }, w, h)
  elseif k == "map" then map_card(w, h, t); ui.hints({ { "SELECT", words.hint.close } }, w, h)
  elseif k == "ending" then ending_card(w, h, t)
  elseif k == "pause" then pause_card(open, w, h); ui.hints({ { "A", words.hint.choose } }, w, h) end
end

return cards
