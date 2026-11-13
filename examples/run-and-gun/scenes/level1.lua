-- The level's pieces are placed in level1.scene.json (open it in the scene editor); this file is for what the level itself does:
-- the camera follows the player to the right and never goes back, and the screen shows lives, the score and the boss's health.
local Level = nova.scene {}

function Level:enter()
  self.camx = 480
  nova.cam.limit(0, 0, 4200, 540)
  nova.cam.set(self.camx, 270)
end

function Level:update(dt)
  local p = nova.first("player")
  if p and not p.dead then self.camx = math.max(self.camx, p.x + 100) end
  nova.cam.set(self.camx, 270)
end

function Level:draw_ui()
  local w, h = nova.view()
  local p = nova.first("player")
  if not p then return end
  -- lives
  for i = 1, math.max(0, p.lives) do
    nova.ui.rect(20 + (i - 1) * 26, 20, 16, 22, { 70, 110, 220 })
    nova.ui.rect(23 + (i - 1) * 26, 14, 10, 9, { 240, 200, 160 })
  end
  nova.ui.text(w - 20, 18, string.format("%06d", p.score), { size = 28, align = "right", shadow = true })
  if p.gun == "spread" then nova.ui.text(20, 52, "SPREAD", { size = 18, color = { 120, 220, 255 }, shadow = true }) end
  local boss = nova.first("boss")
  if boss and boss.awake then
    local f = math.max(0, boss.hp / boss.max_hp)
    nova.ui.rect(w / 2 - 152, 20, 304, 16, { 20, 20, 30, 200 })
    nova.ui.rect(w / 2 - 150, 22, 300 * f, 12, { 230, 80, 70 })
  end
  if p.won then
    nova.ui.text(w / 2, h / 2 - 50, "STAGE CLEAR", { size = 64, align = "center", shadow = true })
    nova.ui.text(w / 2, h / 2 + 30, "Press Start to play again", { size = 24, align = "center", shadow = true })
  elseif p.over then
    nova.ui.text(w / 2, h / 2 - 50, "GAME OVER", { size = 64, align = "center", shadow = true })
    nova.ui.text(w / 2, h / 2 + 30, "Press Start to try again", { size = 24, align = "center", shadow = true })
  end
end

return Level
