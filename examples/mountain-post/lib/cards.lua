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

local C = ui.C

local function label_card(which, w, h, t)
  local s = math.min(1, t / 0.18)
  local cw, ch = 640, 300
  local x, y = (w - cw) / 2, (h - ch) / 2 - 20 + (1 - s) * 30
  nova.ui.rect(0, 0, w, h, { 20, 14, 10, math.floor(110 * s) })
  ui.paper(x, y, cw, ch, { top = { 236, 214, 172 }, bottom = { 214, 186, 140 } })
  -- the label itself, stuck on the brown paper: a white slip with a red edge
  nova.ui.rect(x + 50, y + 44, cw - 100, ch - 88, { 252, 249, 240 }, { radius = 6, outline = { color = C.red, width = 3 } })
  local name, street = words.labels[which]:match("^(.-), (.*)$")
  nova.ui.text(x + 80, y + 66, "To:", { font = "serif", size = 22, color = C.faint })
  nova.ui.text(x + cw / 2, y + 100, name, { font = "serif", size = 50, align = "center", color = C.ink })
  nova.ui.text(x + cw / 2, y + 170, street, { font = "serif", size = 36, align = "center", color = C.ink })
  nova.ui.text(x + cw - 70, y + 66, "PARCEL", { font = "rounded", size = 16, align = "right", color = C.red })
end

local function letter_card(w, h, t)
  local s = math.min(1, t / 0.2)
  local cw, ch = math.min(720, w - 80), 470
  local x, y = (w - cw) / 2, (h - ch) / 2 + (1 - s) * 40
  nova.ui.rect(0, 0, w, h, { 20, 14, 10, math.floor(120 * s) })
  ui.paper(x, y, cw, ch, { top = { 250, 245, 232 }, bottom = { 240, 230, 208 } })
  nova.ui.text(x + 44, y + 34, words.labels.letter, { font = "serif", size = 18, color = C.faint })
  nova.ui.text(x + 44, y + 76, words.letter[1], { font = "serif", size = 25, width = cw - 88, color = C.ink, line_spacing = 1.2 })
  nova.ui.text(x + 44, y + 300, words.letter[2], { font = "serif", size = 23, width = cw - 88, color = C.ink, line_spacing = 1.2 })
  nova.ui.text(x + cw - 44, y + ch - 66, words.letter_from, { font = "script", size = 28, align = "right", color = { 70, 60, 120 } })
end

local function map_card(w, h, t)
  local s = math.min(1, t / 0.2)
  nova.ui.rect(0, 0, w, h, { 20, 14, 10, math.floor(140 * s) })
  local mh = h - 40
  local mw = mh * 1000 / 1100
  nova.ui.sprite("ui/map", w / 2, h / 2 + (1 - s) * 30, { w = mw, h = mh, rotation = (1 - s) * 0.05 - 0.012 })
end

local function ending_card(w, h, t)
  local a = math.min(1, t / 1.5)
  nova.ui.rect(0, 0, w, h, { 34, 26, 20, math.floor(235 * a) }, { layer = "top" })
  local ta = math.max(0, math.min(1, (t - 1.0) / 1.2))
  nova.ui.text(w / 2, h / 2 - 22, words.ending, { font = "serif", size = 40, align = "center", color = { 246, 236, 214, math.floor(255 * ta) } })
  if t > 2.5 then ui.glyph(w / 2, h / 2 + 70, "A", 28) end
end

local function pause_card(o, w, h)
  nova.ui.rect(0, 0, w, h, { 20, 14, 10, 150 })
  local cw, ch = 340, 230
  local x, y = (w - cw) / 2, (h - ch) / 2
  ui.paper(x, y, cw, ch)
  nova.ui.text(w / 2, y + 26, words.pause.title, { font = "serif", size = 34, align = "center", color = C.ink })
  for i, label in ipairs({ words.pause.resume, words.pause.quit }) do
    local yy = y + 92 + (i - 1) * 58
    if o.choice == i then nova.ui.rect(x + 40, yy - 6, cw - 80, 46, C.blue, { radius = 10 }) end
    nova.ui.text(w / 2, yy, label, { font = "rounded", size = 28, align = "center", color = o.choice == i and C.cream or C.ink })
  end
end

function cards.draw(w, h)
  if not open then return end
  local k, t = open.kind, open.t
  if k == "label" then label_card(open.data.which, w, h, t); ui.hints({ { "A", words.hint.close } }, w, h)
  elseif k == "letter" then letter_card(w, h, t); ui.hints({ { "A", words.hint.close } }, w, h)
  elseif k == "map" then map_card(w, h, t); ui.hints({ { "Y", words.hint.close } }, w, h)
  elseif k == "ending" then ending_card(w, h, t)
  elseif k == "pause" then pause_card(open, w, h) end
end

return cards
