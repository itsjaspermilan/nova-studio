local S = nova.scene {}
local IDS = { "glowcap", "embergourd", "frostroot", "moonberry", "sunpetal", "bogbulb" }
function S:enter()
  nova.light { dir = { -0.4, -1, -0.7 }, color = { 255, 246, 230 }, ambient = { 150, 140, 160 } }
  nova.look { toon = 4, outline = { color = { 40, 28, 44 }, strength = 0.9, width = 4 }, saturation = 1.15 }
end
function S:draw()
  local bg = nova.input.down("white") and 255 or 0
  nova.sky { top = { bg, bg, bg }, horizon = { bg, bg, bg } }
  -- six cells across, each one unit wide, seen from a little above and in front with a narrow lens
  nova.camera(2.5, 3.15, 4.94, 2.5, 0.3, 0, 10)
  for i, id in ipairs(IDS) do nova.model("ing_" .. id, (i - 1) * 1.0, 0, 0, { scale = 2.1, ry = 0.5 }) end
end
return S
