-- The test room: one painted room (scenes/test_room.scene.json) bigger than the screen, the runner, a training dummy and
-- one Scrapper. This file is the camera (follows the runner, shakes on a hit), the hit-stop tick and the HUD.
local P = require("data.player")
local J = require("lib.juice")

local Room = nova.scene {}

local VIEW_W, VIEW_H = 960, 540

function Room:enter()
  J.reset()
  local data = nova.scene_data("test_room")
  self.w, self.h = data.width or 1440, data.height or 864
  self.runner = nova.named("runner")
  local rx, ry = self.runner.x, self.runner.y - 24
  self.cx, self.cy = rx, ry
  nova.cam.set(rx, ry)
  nova.music.play(P.music.track, { volume = P.music.volume })
  nova.log("entered test_room")
end

function Room:update(dt)
  J.tick()
  local r = self.runner
  if not r or not r:is_alive() then return end
  -- follow the runner smoothly, keep the view inside the room, then add the shake
  local k = 1 - math.exp(-9 * dt)
  self.cx = self.cx + (r.x - self.cx) * k
  self.cy = self.cy + (r.y - 24 - self.cy) * k
  local cx = math.max(VIEW_W / 2, math.min(self.w - VIEW_W / 2, self.cx))
  local cy = math.max(VIEW_H / 2, math.min(self.h - VIEW_H / 2, self.cy))
  local ox, oy = J.offset()
  nova.cam.set(cx + ox, cy + oy)
end

local function prompt(x, y, action, word)
  local label = nova.input.prompt(action)
  local w = nova.ui.text_width(label, { font = "pixel", size = 14 }) + 12
  nova.ui.rect(x, y, w, 22, { 5, 6, 15, 220 })
  nova.ui.rect(x, y + 20, w, 2, { 6, 240, 255, 255 })
  nova.ui.text(x + 6, y + 3, label, { font = "pixel", size = 14, color = { 255, 255, 255, 255 } })
  nova.ui.text(x + w + 6, y + 3, word, { font = "pixel", size = 14, color = { 190, 200, 230, 255 }, shadow = true })
  return x + w + 6 + nova.ui.text_width(word, { font = "pixel", size = 14 }) + 22
end

function Room:draw_ui()
  for _, e in ipairs(nova.all("hurtable")) do if e.hud then e:hud() end end
  local r = self.runner
  if not r then return end
  -- hearts: 6 hearts, 12 points, in halves
  for i = 1, math.ceil((r.max_hp or P.health) / 2) do
    local frame = 2
    if r.hp >= i * 2 then frame = 0 elseif r.hp == i * 2 - 1 then frame = 1 end
    nova.ui.sprite("hud_hearts", 28 + (i - 1) * 38, 30, { frame = frame, scale = 2.4 })
  end
  -- charge pips and the fraction of the next one
  for i = 1, (r.max_charge or P.charge.pips) do
    nova.ui.sprite("hud_pips", 28 + (i - 1) * 30, 66, { frame = (r.charge + 1e-6 >= i) and 0 or 1, scale = 2 })
  end
  local frac = r.charge - math.floor(r.charge + 1e-6)
  if r.charge < (r.max_charge or P.charge.pips) and frac > 0.01 then
    local i = math.floor(r.charge + 1e-6) + 1
    nova.ui.rect(14 + (i - 1) * 30, 86, 28 * frac, 3, { 6, 240, 255, 255 })
  end
  -- scrap
  nova.ui.sprite("scrap", 912, 30, { scale = 2, frame = 0 })
  nova.ui.text(924, 20, tostring(J.scrap), { font = "pixel", size = 20, color = { 255, 255, 255, 255 }, shadow = true })
  -- prompt row
  local x = 16
  x = prompt(x, 506, "attack", "baton")
  x = prompt(x, 506, "dash", "roll")
  x = prompt(x, 506, "ranged", "shoot")
  prompt(x, 506, "interact", "use")
  if r.state == "dead" then
    local a = math.min(1, r.dead_t / 0.4) * 255
    nova.ui.rect(0, 0, VIEW_W, VIEW_H, { 5, 6, 15, a * 0.8 })
    nova.ui.text(0, 230, "PRINTED AGAIN", { font = "pixel", size = 40, color = { 6, 240, 255, a }, align = "center", width = VIEW_W, shadow = true })
    nova.ui.text(0, 284, "LULLABY: hold still. I have you. Mostly.", { font = "pixel", size = 18, color = { 255, 43, 214, a }, align = "center", width = VIEW_W })
  end
end

return Room
