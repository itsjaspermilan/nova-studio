local state = require("lib.state")
local Level = require("lib.level")

local Scene = nova.scene {}

function Scene:enter()
  state.reset()
  self.paused = false
  Level.build()
  nova.sky { top = { 70, 130, 220 }, horizon = { 190, 220, 245 }, sun = { 0.4, 0.8, 0.3 }, clouds = 0.55 }
  nova.light { dir = { -0.4, -0.8, -0.3 }, color = { 255, 245, 225 }, ambient = { 95, 100, 120 } }
  nova.fog { color = { 190, 220, 245 }, near = 60, far = 160 }
  nova.spawn("platform", 0, 0, { z = 0, kind = "slide" })
  nova.spawn("platform", 0, 0, { z = 0, kind = "lift" })
  for _, g in ipairs(Level.gems) do nova.spawn("gem", g[1], 0, { z = g[3], gy = g[2] }) end
  state.total = #Level.gems
  for _, w in ipairs(Level.walkers) do
    nova.spawn("walker", w[1], w[2], { z = w[3], x0 = w[1], z0 = w[3] + w[4] / 2, ax = 0, az = 1, range = w[4] / 2 })
  end
  for _, c in ipairs(Level.checkpoints) do nova.spawn("checkpoint", c[1], c[2], { z = 0 }) end
  nova.spawn("flag", Level.flag[1], Level.flag[2], { z = 0 })
  nova.spawn("player", 0, 0.01, { z = 0 })
  state.say("collect 10 gems and reach the flag", 4)
end

function Scene:update(dt)
  -- platforms move first so that the player can be carried by what they did this frame
  nova.each("platform", function(p) p:advance(dt) end)
  if nova.input.pressed("stats") then
    local p = nova.first("player")
    nova.log(string.format("sky: x=%.1f y=%.1f z=%.1f gems=%d stomps=%d falls=%d hits=%d won=%s time=%.1f ride=%d cam_pulls=%d walkers=%d fall_x=%.1f fall_vx=%.1f", p and p.x or 0, p and p.y or 0, p and p.z or 0, state.gems, state.stomps, state.falls, state.hits, tostring(state.won), state.time, state.ride_frames, state.cam_pulls, nova.count("walker"), state.fall_x or 0, state.fall_vx or 0))
  end
  if nova.input.pressed("profile") then
    self.profiling = not self.profiling
    nova.profile(self.profiling)
  end
  if nova.input.pressed("pause") and not state.won then
    self.paused = not self.paused
    nova.pause(self.paused)
    nova.input.grab_mouse(not self.paused)
  end
  if state.won and nova.input.pressed("jump") then nova.goto_scene("garden") end
end

function Scene:draw() Level.draw() end

local function text(x, y, s, size, color, align)
  nova.ui.text(x, y, s, { size = size or 18, color = color or { 255, 255, 255 }, shadow = true, align = align })
end

function Scene:draw_ui()
  local w, h = nova.view()
  nova.ui.rect(16, 16, 150, 34, { 0, 0, 0, 130 })
  nova.ui.rect(24, 25, 14, 14, { 80, 100, 200 })
  text(46, 33, string.format("%d / %d", state.gems, state.total), 20)
  if state.message_for > 0 then text(w / 2, 70, state.message, 22, nil, "center") end
  if state.won then
    nova.ui.rect(0, 0, w, h, { 10, 60, 30, 170 })
    text(w / 2, h / 2 - 20, "You made it!", 40, nil, "center")
    text(w / 2, h / 2 + 24, string.format("%d gems, %d stomps, %.0f seconds. Jump to play again.", state.gems, state.stomps, state.time), 20, nil, "center")
  end
end

return Scene
