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
    if nova.input.pressed("pause") or nova.input.pressed("van") then cards.close(); return end
    if nova.input.pressed("act") then
      nova.sound.play("tick", { volume = 0.45, pitch = 1.2 })
      if open.choice == 1 then cards.close() else nova.log("quit"); nova.quit() end
    end
    return
  end
  if open.t < 0.25 then return end -- (a press that opened it does not close it)
  if k == "map" then
    if nova.input.pressed("map") or nova.input.pressed("van") or nova.input.pressed("act") then cards.close() end
  elseif k == "ending" then
    if open.t > 2.5 and nova.input.pressed("act") then cards.close() end
  elseif nova.input.pressed("act") or nova.input.pressed("van") then
    cards.close()
  end
end

local C, F = ui.C, ui.F

-- (cards come in with a short rise and fade: s goes 0 to 1)
local function rise(t, d) local s = math.min(1, t / (d or 0.18)); return s, 1 - (1 - s) * (1 - s) end

-- A parcel's label held up to read: a paper card with "Parcel" on its title strip, the label slip on it, "To:" and the name and
-- the street large.
local function label_card(which, w, h, t)
  local s, e = rise(t)
  local cw, ch = 640, 300
  local x, y = (w - cw) / 2, (h - ch) / 2 - 6 + (1 - e) * 30
  ui.dim(w, h, s * 0.8)
  ui.panel(x, y, cw, ch, { alpha = s })
  ui.title_strip(w / 2, y - 20, words.parcel, { alpha = s })
  ui.slip(x + 36, y + 42, cw - 72, ch - 80, { alpha = s })
  local name, street = ui.label_lines(which)
  nova.ui.text(x + 70, y + 66, "To:", { font = "serif", size = 22, color = ui.alpha(C.faint, s) })
  nova.ui.text(w / 2, y + 98, name, { font = "serif", size = 50, align = "center", color = ui.alpha(C.ink, s) })
  nova.ui.text(w / 2, y + 168, street, { font = "serif", size = 36, align = "center", color = ui.alpha(C.ink, s) })
end

-- The Mayor's letter: a sheet of the paper, who it is to over a rule, her words, her name in her hand.
local function letter_card(w, h, t)
  local s, e = rise(t, 0.2)
  local cw, ch = math.min(720, w - 80), 476
  local x, y = (w - cw) / 2, (h - ch) / 2 + (1 - e) * 40
  ui.dim(w, h, s * 0.85)
  ui.panel(x, y, cw, ch, { alpha = s })
  nova.ui.text(x + 44, y + 28, words.labels.letter, { font = "serif", size = 18, color = ui.alpha(C.faint, s) })
  ui.rule(x + 40, y + 58, cw - 80, { alpha = s })
  nova.ui.text(x + 44, y + 78, words.letter[1], { font = "serif", size = F.body + 1, width = cw - 88, color = ui.alpha(C.ink, s), line_spacing = 1.2 })
  nova.ui.text(x + 44, y + 300, words.letter[2], { font = "serif", size = F.body - 1, width = cw - 88, color = ui.alpha(C.ink, s), line_spacing = 1.2 })
  nova.ui.text(x + cw - 44, y + ch - 70, words.letter_from, { font = "script", size = 28, align = "right", color = ui.alpha({ 70, 60, 120 }, s) })
end

-- The paper map in a wooden frame (a panel round it; the sheet has the town's name on it already).
local function map_card(w, h, t)
  local s, e = rise(t, 0.2)
  ui.dim(w, h, s)
  local mh = h - 74
  local mw = mh * 1000 / 1100
  local x, y = (w - mw) / 2, (h - mh) / 2 + 10 + (1 - e) * 30
  ui.panel(x - 12, y - 12, mw + 24, mh + 28, { alpha = s })
  nova.ui.sprite("ui/map", w / 2, y + mh / 2, { w = mw, h = mh, color = { 255, 255, 255, math.floor(255 * s) } })
end

-- The end: the screen goes dark, then a card with the spec's words, and A to go on.
local function ending_card(w, h, t)
  local a = math.min(1, t / 1.5)
  -- (not on the top layer: the card's panel is drawn over it, and the scene hides its prompts and corner card under a card)
  ui.dim(w, h, a, 235)
  local ta = math.max(0, math.min(1, (t - 1.0) / 1.2))
  if ta <= 0 then return end
  local tw = nova.ui.text_width(words.ending, { font = "serif", size = 36 })
  local cw, ch = tw + 100, 150
  local x, y = (w - cw) / 2, h / 2 - 70
  ui.panel(x, y, cw, ch, { alpha = ta })
  ui.title_strip(w / 2, y - 20, words.title, { alpha = ta })
  nova.ui.text(w / 2, y + 44, words.ending, { font = "serif", size = 36, align = "center", color = ui.alpha(C.ink, ta) })
  if t > 2.5 then ui.chip(w / 2 - ui.chip_width("A", words.hint.close) / 2, y + ch + 18, "A", words.hint.close) end
end

-- Paused: a small card, its two choices as keys (the chosen one red, pressed while A is held).
local function pause_card(o, w, h)
  ui.dim(w, h, 1)
  local cw, ch = 360, 230
  local x, y = (w - cw) / 2, (h - ch) / 2
  ui.panel(x, y, cw, ch)
  ui.title_strip(w / 2, y - 22, words.pause.title, { min_w = 170 })
  for i, label in ipairs({ words.pause.resume, words.pause.quit }) do
    local yy = y + 52 + (i - 1) * 76
    local on = o.choice == i
    local down = on and nova.input.down("act")
    ui.key(x + 46, yy, cw - 92, 56, on and C.red or nil, { scale = 0.5, down = down })
    nova.ui.text(w / 2, yy + 12 + (down and 4 or 0), label, { font = "rounded", size = F.button + 4, align = "center", color = on and C.cream or C.ink })
  end
end

function cards.draw(w, h)
  if not open then return end
  local k, t = open.kind, open.t
  if k == "label" then label_card(open.data.which, w, h, t); ui.hints({ { "A", words.hint.close } }, w, h)
  elseif k == "letter" then letter_card(w, h, t); ui.hints({ { "A", words.hint.close } }, w, h)
  elseif k == "map" then map_card(w, h, t); ui.hints({ { "Y", words.hint.close } }, w, h)
  elseif k == "ending" then ending_card(w, h, t)
  elseif k == "pause" then pause_card(open, w, h); ui.hints({ { "A", words.hint.choose } }, w, h) end
end

return cards
