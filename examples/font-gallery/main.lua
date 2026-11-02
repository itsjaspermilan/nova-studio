-- Every built-in font, drawn with nova.ui.text. Use a font by name:
--   nova.ui.text(x, y, "Hello", { font = "pixel", size = 24, color = { 255, 220, 120 } })
-- Your own fonts: put a .ttf or .otf in the project (for example fonts/title.ttf) and use
-- { font = "title" } or { font = "fonts/title.ttf" }.
-- Also: width (wraps lines), align ("left", "center", "right" inside width), shadow = true,
-- nova.ui.text_size(text, opts) to measure.

local samples = {
  { "sans", "Inter: clean and neutral, good for menus and readouts", 22 },
  { "rounded", "Fredoka: soft and friendly for casual games", 24 },
  { "pixel", "PRESS START 2P: arcade pixels", 16 },
  { "terminal", "VT323: green-screen terminal text, 0123456789", 28 },
  { "mono", "JetBrains Mono: code and tables  {} [] () ->", 18 },
  { "serif", "Lora: an elegant serif for stories and dialogue", 22 },
  { "comic", "BANGERS: loud comic-book titles!", 28 },
  { "display", "Cinzel: classical capitals for fantasy", 24 },
  { "script", "Pacifico: a casual brush script", 26 },
}

function init()
  nova.clear(22, 26, 40)
end

function draw()
  local w, h = nova.view()
  nova.ui.text(0, 14, "FONT GALLERY", { font = "display", size = 30, width = w, align = "center", color = { 255, 218, 120 }, shadow = true })
  local y = 62
  for _, s in ipairs(samples) do
    local name, text, size = s[1], s[2], s[3]
    nova.ui.text(24, y + 6, name, { font = "mono", size = 13, color = { 120, 140, 180 } })
    local _, th = nova.ui.text(120, y, text, { font = name, size = size, color = { 240, 240, 245 } })
    y = y + math.max(th, 28) + 10
  end
  nova.ui.text(24, y + 8, "Wrapping and alignment: this paragraph is set in a narrow column and breaks at word boundaries, so long descriptions stay readable on small screens.",
    { font = "serif", size = 18, width = 420, color = { 200, 210, 230 } })
  nova.ui.text(w - 444, y + 8, "Right aligned within a column, with a drop shadow behind the letters.",
    { font = "rounded", size = 20, width = 420, align = "right", shadow = true, color = { 150, 220, 160 } })
end
