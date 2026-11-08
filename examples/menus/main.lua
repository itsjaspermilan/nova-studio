-- Menus with no styling at all: the default theme, a scrolling list, a grid of cards, a HUD in the corners and a menu from a file
-- (menus/pause.menu.json). Up, down, left and right (d-pad, left stick or arrow keys) move, A presses, B goes back.
local screen = "title"
local music, sound, level = 7, 5, 1
local log = ""

local LEVELS = {}
for i = 1, 12 do LEVELS[i] = { name = "Level " .. i, best = i <= 3 and (i * 1200) or nil } end

local function title()
  local r = nova.ui.menu {
    id = "title",
    { "text", "MENUS", style = "title" },
    { "text", "Everything here is laid out by nova.ui.menu", style = "small", align = "center" },
    { "space", h = 12 },
    { "button", "Play", id = "play" },
    { "button", "Options", id = "options" },
    { "button", "A pause menu from a file", id = "pause" },
    { "button", "Quit", id = "quit" },
  }
  if r.pressed == "play" then screen = "levels"
  elseif r.pressed == "options" then screen = "options"
  elseif r.pressed == "pause" then screen = "pause"
  elseif r.pressed == "quit" then log = "(a game would close here)" end
end

local function options()
  local r = nova.ui.menu {
    id = "options", w = 460,
    { "text", "OPTIONS", style = "title" },
    { "button", "Music volume", value = "< " .. music .. " >", id = "music", adjust = true },
    { "button", "Sound volume", value = "< " .. sound .. " >", id = "sound", adjust = true },
    { "button", "A choice whose name is far too long to fit on its button", value = "On", id = "long" },
    { "button", "Back", id = "back" },
  }
  if r.changed == "music" then music = math.max(0, math.min(10, music + r.step)) end
  if r.changed == "sound" then sound = math.max(0, math.min(10, sound + r.step)) end
  if r.back or r.pressed == "back" then screen = "title" end
end

local function levels()
  local grid = { "grid", columns = 4, visible = 2, cell_h = 110 }
  for i, l in ipairs(LEVELS) do
    grid[#grid + 1] = { "panel", focusable = true, id = "level" .. i, pad = 12,
      { "text", l.name, style = "heading" },
      { "text", l.best and ("Best " .. l.best) or "Not played yet", style = "small" },
    }
  end
  local r = nova.ui.menu {
    id = "levels", w = "90%",
    { "text", "CHOOSE A LEVEL", style = "title" },
    grid,
    { "text", "A long note under the grid wraps inside its box instead of running off the side of the screen, however long it is.", wrap = true },
  }
  if r.pressed then level = tonumber(r.pressed:match("%d+")); screen = "game" end
  if r.back then screen = "title" end
end

local function hud()
  nova.ui.layout {
    kind = "stack", w = "100%", h = "100%",
    { "panel", anchor = "topleft", { "text", "LEVEL " .. level, style = "heading" }, { "text", "Score 0", style = "small" } },
    { "text", "1:23.45", anchor = "topright", size = 32 },
    { "hints", anchor = "bottomright", items = { { "a", "Jump" }, { "start", "Pause" } } },
  }
end

function update(dt)
  if screen == "game" and nova.input.pressed("start") then screen = "pause" end
end

function draw()
  nova.clear(36, 52, 84)
  if screen == "title" then title()
  elseif screen == "options" then options()
  elseif screen == "levels" then levels()
  elseif screen == "game" then hud()
  elseif screen == "pause" then
    hud()
    nova.ui.rect(0, 0, 2000, 540, { 0, 0, 0, 120 })
    local r = nova.ui.menu("pause")
    if r.pressed == "resume" or r.back then screen = "game" end
    if r.pressed == "title" then screen = "title" end
  end
  if screen ~= "game" and screen ~= "pause" then
    nova.ui.layout { anchor = "bottom", { "hints", items = { { "dpad", "Move" }, { "a", "Choose" }, { "b", "Back" } } } }
  end
  if log ~= "" then nova.ui.text(12, 12, log, { size = 14 }) end
end
