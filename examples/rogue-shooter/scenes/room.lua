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
  -- a small cross where the shots go
  local w, h = nova.view()
  nova.ui.rect(w / 2 - 6, h / 2 - 1, 12, 2, { 255, 255, 255, 200 })
  nova.ui.rect(w / 2 - 1, h / 2 - 6, 2, 12, { 255, 255, 255, 200 })
end

return Room
