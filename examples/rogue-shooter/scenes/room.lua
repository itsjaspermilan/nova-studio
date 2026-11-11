-- The room's pieces (walls, the hero) are placed in room.scene.json; this file is for what the room itself does.
local Room = nova.scene {}

function Room:enter()
  nova.light { dir = { -0.5, -1, -0.35 }, ambient = { 90, 95, 115 } }
  -- the walls are placed by now: make the grid that enemies find their way by
  nova.nav.build { x0 = -12, z0 = -12, x1 = 12, z1 = 12, cell = 0.5, radius = 0.45 }
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
  if hero then
    if hero.hit_t > 0 then nova.ui.rect(0, 0, w, h, { 220, 30, 30, math.floor(120 * hero.hit_t / 0.3) }) end
    nova.ui.text(24, 20, "HP " .. hero.hp .. " / " .. hero.max_hp, { size = 22, color = { 255, 200, 200 }, shadow = true })
    nova.ui.text(24, 50, "Enemies " .. nova.count("enemy"), { size = 18, color = { 220, 220, 230 }, shadow = true })
    if hero.dead then nova.ui.text(w / 2, h / 2 - 60, "You died", { size = 48, align = "center", shadow = true }) end
    if nova.count("enemy") == 0 then nova.ui.text(w / 2, h / 2 - 60, "Room clear", { size = 48, align = "center", shadow = true }) end
  end
end

return Room
