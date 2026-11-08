-- The heads-up display over a level: hearts, coins, the three gems and any keys on the left, the stopwatch on the right (big in a time trial,
-- with the time to beat), the boss's hearts when there is one, and the speech bubbles of hint signs. Counters bounce when they change.
local ui = require("lib.ui")
local run = require("lib.run")
local fx = require("lib.fx")

local hud = {}

local GEM = { "ui/gem_blue", "ui/gem_green", "ui/gem_red" }

local function bounce(since)
  local t = nova.time() - since
  if t > 0.35 then return 1 end
  return 1 + math.sin(t / 0.35 * math.pi) * 0.35
end

function hud.draw(slide)
  local w = nova.view()
  local oy = -(1 - (slide or 1)) * 90
  -- soft plates behind the counters and the stopwatch, so that they read over any sky
  local keys = 0
  for _, c in ipairs({ "yellow", "blue", "green", "red" }) do if run.keys[c] then keys = keys + 1 end end
  local left_w = 30 + run.max_hearts * 40 + 26 + 26 + ui.width(tostring(math.max(run.coins, 100)), ui.LARGE) + 26 + 3 * 38 + keys * 36
  ui.shade(8, 8 + oy, left_w, 54, 110)
  ui.shade(w - (run.mode == "trial" and 236 or 210), 8 + oy, (run.mode == "trial" and 228 or 202), run.mode == "trial" and 76 or 54, 110)
  -- hearts
  local x, y = 30, 34 + oy
  local hb = bounce(run.pulse.hearts)
  for i = 1, run.max_hearts do
    local full = i <= run.hearts
    local s = (i == run.hearts or i == run.hearts + 1) and hb or 1
    ui.icon(full and "ui/hud_heart" or "ui/hud_heart_empty", x + (i - 1) * 40, y, 46 * s)
  end
  -- coins
  local cx = x + run.max_hearts * 40 + 26
  local cb = bounce(run.pulse.coins)
  ui.icon("ui/hud_coin", cx, y, 44 * cb)
  ui.text(cx + 26, y + 2, tostring(run.coins), math.floor(ui.LARGE * (0.9 + 0.1 * cb)), ui.color.white, { valign = "middle" })
  -- gems: empty slots fill in
  local gx = cx + 26 + ui.width(tostring(math.max(run.coins, 100)), ui.LARGE) + 26
  local gb = bounce(run.pulse.gems)
  for i = 1, 3 do
    local got = run.gems[i]
    ui.icon(GEM[i], gx + (i - 1) * 38, y, (got and 40 or 32) * (got and gb or 1), got and { 255, 255, 255, 255 } or { 255, 255, 255, 80 })
  end
  -- keys
  local kx = gx + 3 * 38 + 14
  for _, c in ipairs({ "yellow", "blue", "green", "red" }) do
    if run.keys[c] then ui.icon("ui/hud_key_" .. c, kx, y, 40 * bounce(run.pulse.keys)); kx = kx + 36 end
  end
  -- the stopwatch
  local trial = run.mode == "trial"
  local size = trial and ui.NUMBER or ui.LARGE
  local t = ui.time(run.time)
  local tw = ui.width("0:00.00", size)
  local rx = w - 30
  ui.icon("ui/watch", rx - tw - 26, y, trial and 44 or 38)
  local col = ui.color.white
  if trial and run.level and run.level.target then col = run.time <= run.level.target and { 140, 255, 160 } or { 255, 170, 150 } end
  ui.text(rx - tw, y + 1, t, size, col, { valign = "middle", outline = true })
  if trial and run.level and run.level.target then
    ui.right("Star time " .. ui.time(run.level.target), rx, y + 26, ui.SMALL, { 255, 240, 200 }, { outline = true })
  end
  -- the boss's hearts
  local boss = run.boss
  if boss and boss:is_alive() and not boss.dead and boss.phase ~= "intro" then
    local bw = 120 + boss.max_hp * 44
    local bx = w / 2 - bw / 2
    ui.shade(bx, 470, bw, 52, 170)
    ui.text(bx + 16, 496, "BOSS", ui.MEDIUM, ui.color.white, { valign = "middle" })
    for i = 1, boss.max_hp do
      ui.icon(i <= boss.hp and "ui/hud_heart" or "ui/hud_heart_empty", bx + 112 + (i - 1) * 44, 496, 40)
    end
  end
end

-- a sign's tip in a speech bubble above it, popping in as the hero comes near
function hud.hints()
  local list = nova.all("hint_sign")
  for _, sign in ipairs(list) do
    if sign.near > 0.01 and sign.text ~= "" then
      local sx, sy = fx.to_screen(sign.x, sign.y - 70)
      local k = ui.ease_back(sign.near)
      local size = ui.MEDIUM
      local glyph = sign.button ~= "" and 38 or 0
      local maxw = 420
      local tw, th = nova.ui.text_size(sign.text, { size = size, font = "rounded", width = maxw })
      local bw, bh = (tw + glyph + (glyph > 0 and 12 or 0) + 36) * k, (math.max(th, glyph) + 26) * k
      local w = nova.view()
      local bx = math.max(10, math.min(w - 10 - bw, sx - bw / 2))
      local by = sy - bh - 14 * k
      local old = ui.alpha
      ui.alpha = math.min(1, sign.near * 1.5)
      ui.panel(bx, by, bw, bh)
      ui.icon("ui/pointer", sx, by + bh + 4, 26 * k, nil, { rotation = math.pi / 2 })
      if k > 0.85 then
        if glyph > 0 then ui.pad(sign.button, bx + 18 + glyph / 2, by + bh / 2, glyph) end
        ui.text(bx + 18 + glyph + (glyph > 0 and 12 or 0), by + bh / 2 - th / 2, sign.text, size, ui.color.ink, { width = maxw, outline = false })
      end
      ui.alpha = old
    end
  end
end

return hud
