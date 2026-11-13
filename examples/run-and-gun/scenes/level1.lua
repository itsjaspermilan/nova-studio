-- The level is BUILT when the scene starts (lib/gen.lua joins the chunks in scenes/chunks/ for a seed); level1.scene.json holds only the player and the backdrop.
-- This file is for what the level does: the camera follows the player (a little ahead of the way they face, and up and down when they climb or drop), and the screen
-- shows health, lives, the score, the guns, the boss's health, and which level this is (its seed).
local Level = nova.scene {}

local view = require("lib.view")
local world = require("lib.world")
local run = require("lib.run")
local gen = require("lib.gen")
local DROP = 90 -- the player stands this far below the middle of the view, so that more of what is above shows

function Level:enter()
  self.seed = run.begin()
  gen.build(self.seed)
  local p = nova.first("player")
  self.camx, self.camy = view.half_w(), (p and p.y or 440) - DROP
  self.camv, self.camvy, self.lead = 0, 0, 0
  nova.cam.set(self.camx, self.camy)
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
  -- up and down: the same, with a dead zone of its own (a jump does not bob the view), and a snap if the player is somewhere else altogether (a checkpoint)
  if p and not p.dead then
    local ty = p.y - DROP
    local goal = self.camy
    if ty > self.camy + 70 then goal = ty - 70 elseif ty < self.camy - 70 then goal = ty + 70 end
    if math.abs(ty - self.camy) > 600 then
      self.camy, self.camvy = ty, 0
    else
      local want = (goal - self.camy) * 5
      self.camvy = self.camvy + (want - self.camvy) * math.min(1, 8 * dt)
      self.camy = self.camy + self.camvy * dt
    end
  end
  -- (the camera stays inside the level)
  self.camx = math.max(world.left + view.half_w(), math.min(world.right - view.half_w(), self.camx))
  local lo, hi = world.top - 260 + view.half_h(), world.bottom + 120 - view.half_h()
  self.camy = lo > hi and (lo + hi) / 2 or math.max(lo, math.min(hi, self.camy))
  nova.cam.set(self.camx, self.camy)
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
  -- the two guns; the one you hold is bright
  nova.ui.text(20, 76, "RIFLE", { size = 18, color = p.gun == "rifle" and { 255, 230, 120 } or { 130, 140, 165 }, shadow = true })
  nova.ui.text(92, 76, "SHOTGUN", { size = 18, color = p.gun == "shotgun" and { 255, 230, 120 } or { 130, 140, 165 }, shadow = true })
  -- which level this is, and how far along
  local area, areas = gen.area_at(p.x)
  nova.ui.text(20, h - 28, string.format("LEVEL %d     AREA %d / %d", world.seed, area, areas), { size = 14, color = { 210, 220, 240, 190 }, shadow = true })
  local boss = nova.first("boss")
  if boss and boss.awake then
    local f = math.max(0, boss.hp / boss.max_hp)
    nova.ui.rect(w / 2 - 152, 20, 304, 16, { 20, 20, 30, 200 })
    nova.ui.rect(w / 2 - 150, 22, 300 * f, 12, { 230, 80, 70 })
  end
  if p.won then
    nova.ui.text(w / 2, h / 2 - 50, "STAGE CLEAR", { size = 64, align = "center", shadow = true })
    nova.ui.text(w / 2, h / 2 + 30, "Start: a new level.   L1 + Start: this level again", { size = 22, align = "center", shadow = true })
  elseif p.over then
    nova.ui.text(w / 2, h / 2 - 50, "GAME OVER", { size = 64, align = "center", shadow = true })
    nova.ui.text(w / 2, h / 2 + 30, "Start: a new level.   L1 + Start: this level again", { size = 22, align = "center", shadow = true })
  end
end

return Level
