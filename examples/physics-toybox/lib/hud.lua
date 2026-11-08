-- What both scenes share: the button hints at the bottom, the computer player switch, and the cost log.
local M = { auto = false }

-- a strap of Nintendo-style button pictures with words, bottom right
function M.hints(items)
  local w, h = nova.view()
  local size, glyph, gap, pad, strap = 18, 30, 22, 14, 44
  local total = 0
  for i, it in ipairs(items) do
    local tw = nova.ui.text_width(it[2], { size = size })
    it.tw = tw
    total = total + glyph + 8 + tw + (i < #items and gap or 0)
  end
  local x0, y0 = w - 14 - total - pad * 2, h - 14 - strap
  nova.ui.rect(x0, y0, total + pad * 2, strap, { 20, 24, 40, 190 })
  local x = x0 + pad
  for _, it in ipairs(items) do
    nova.ui.sprite("ui/" .. it[1], x + glyph / 2, y0 + strap / 2, { w = glyph, h = glyph })
    nova.ui.text(x + glyph + 8, y0 + strap / 2, it[2], { size = size, color = { 255, 255, 255 }, valign = "middle" })
    x = x + glyph + 8 + it.tw + gap
  end
end

function M.title(text, sub)
  nova.ui.text(18, 14, text, { size = 30, color = { 255, 255, 255 }, outline = { 20, 24, 40 } })
  if sub then nova.ui.text(18, 52, sub, { size = 16, color = { 230, 236, 255 }, outline = { 20, 24, 40 } }) end
  if M.auto then nova.ui.text(18, 76, "the computer is playing (F9)", { size = 16, color = { 255, 220, 120 }, outline = { 20, 24, 40 } }) end
end

-- every five seconds: how many bodies and what the physics step cost (the worst in the window), for the device log
local window, worst, sum, n = 0, 0, 0, 0
function M.measure(dt, scene)
  local s = nova.stats()
  worst = math.max(worst, s.physics_ms or 0)
  sum, n = sum + (s.physics_ms or 0), n + 1
  window = window + dt
  if window >= 5 or nova.input.pressed("stats") then
    local p = nova.perf()
    nova.log(string.format("toybox: %s bodies=%d physics_avg=%.2f ms physics_max=%.2f ms lua=%.2f ms fps=%.1f gpu=%.1f ms",
      scene, s.bodies or 0, sum / math.max(1, n), worst, p.lua_ms or 0, p.fps or 0, p.gpu_ms or 0))
    window, worst, sum, n = 0, 0, 0, 0
  end
end

function M.common(dt, scene, other)
  if nova.input.pressed("autoplay") then M.auto = not M.auto end
  M.measure(dt, scene)
  if nova.input.pressed("reset") then nova.restart_scene() end
  if nova.input.pressed("other") then nova.goto_scene(other) end
end

-- a knock's loudness from how hard two things met (speed in game units a second, `full` = loud)
function M.knock(speed, full)
  local v = math.min(1, (speed - full * 0.08) / full)
  if v > 0.05 then nova.sound.play("bump", { volume = 0.15 + 0.6 * v, pitch = 0.8 + math.random() * 0.4, limit = 6 }) end
end

return M
