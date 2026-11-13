-- The level's pieces are placed in level1.scene.json (open it in the scene editor); this file is for what the level itself does:
-- the camera follows the player (a little ahead of the way they face), and the screen shows lives, the score and the boss's health.
local Level = nova.scene {}

local view = require("lib.view")
local CAM_Y = 320 -- the camera's height: the ground and the ledges are in the lower part of the picture

function Level:enter()
  self.camx = view.half_w()
  self.camv, self.lead = 0, 0
  nova.cam.set(self.camx, CAM_Y)
end

-- The camera: it stays still while the player moves about near the middle (a dead zone), then follows with a speed that builds up and dies away smoothly,
-- looking a little ahead of the way the player faces (the look-ahead eases in slowly, so turning round does not swing the view). A jump of the player
-- (starting again at a checkpoint) moves it at once.
local DEAD = 34 -- pixels either side of the middle where the camera does not move
local AHEAD = 150 -- how far ahead it looks (the player stands this far from the middle of the view, towards the side they come from)
function Level:update(dt)
  local p = nova.first("player")
  if p and not p.dead then
    self.lead = self.lead + (p.face * AHEAD - self.lead) * math.min(1, 1.6 * dt)
    local target = p.x + self.lead
    local goal = self.camx
    if target > self.camx + DEAD then goal = target - DEAD elseif target < self.camx - DEAD then goal = target + DEAD end
    if math.abs(target - self.camx) > 700 then
      self.camx, self.camv = target, 0 -- a long way off: go there
    else
      local want = (goal - self.camx) * 5
      self.camv = self.camv + (want - self.camv) * math.min(1, 8 * dt)
      self.camx = self.camx + self.camv * dt
    end
  end
  -- (the camera stays inside the level: 0 to 4200)
  self.camx = math.max(view.half_w(), math.min(4200 - view.half_w(), self.camx))
  nova.cam.set(self.camx, CAM_Y)
end

function Level:draw_ui()
  local w, h = nova.view()
  local p = nova.first("player")
  if not p then return end
  -- the health bar (it flashes white when you are hit), with the lives under it
  local f = math.max(0, p.hp / p.hp_max)
  local bw = 300
  nova.ui.rect(18, 18, bw + 4, 26, { 15, 15, 25, 220 })
  local col = f > 0.5 and { 90, 200, 90 } or (f > 0.25 and { 230, 190, 60 } or { 230, 70, 60 })
  if p.hurt_t > 0 then col = { 255, 255, 255 } end
  nova.ui.rect(20, 20, bw * f, 22, col)
  nova.ui.text(26, 24, string.format("%d / %d", math.max(0, math.ceil(p.hp)), p.hp_max), { size = 16, shadow = true })
  for i = 1, math.max(0, p.lives) do
    nova.ui.rect(20 + (i - 1) * 22, 52, 12, 16, { 70, 110, 220 })
    nova.ui.rect(22 + (i - 1) * 22, 47, 8, 7, { 240, 200, 160 })
  end
  if p.hurt_t > 0 then nova.ui.rect(0, 0, w, h, { 220, 30, 30, math.floor(45 * p.hurt_t / 0.3) }) end
  nova.ui.text(w - 20, 18, string.format("%06d", p.score), { size = 28, align = "right", shadow = true })
  if p.gun == "shotgun" then nova.ui.text(20, 76, "SHOTGUN", { size = 18, color = { 120, 220, 255 }, shadow = true }) end
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
