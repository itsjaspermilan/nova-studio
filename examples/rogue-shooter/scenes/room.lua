-- The room's pieces (walls, the hero) are placed in room.scene.json; this file is for what the room itself does.
local Room = nova.scene {}

function Room:enter()
  nova.light { dir = { -0.5, -1, -0.35 }, ambient = { 90, 95, 115 } }
end

function Room:draw()
  -- the floor
  nova.cuboid(-30, -0.2, -30, 30, 0, 30, { color = { 70, 76, 92 } })
end

function Room:draw_ui()
  -- a cross where the shots go; it closes in while aiming down the sights
  local w, h = nova.view()
  local hero = nova.first("hero")
  local k = hero and hero.ads or 0
  local gap, len = 6 - 4 * k, 8
  local c = { 255, 255, 255, 210 }
  nova.ui.rect(w / 2 - gap - len, h / 2 - 1, len, 2, c)
  nova.ui.rect(w / 2 + gap, h / 2 - 1, len, 2, c)
  nova.ui.rect(w / 2 - 1, h / 2 - gap - len, 2, len, c)
  nova.ui.rect(w / 2 - 1, h / 2 + gap, 2, len, c)
end

return Room
