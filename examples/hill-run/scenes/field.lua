local state = require("lib.state")
local level = require("lib.level")
local max, min = math.max, math.min

local Scene = nova.scene {}

GOAL_GEMS = 3 -- gems the flag asks for

function Scene:enter()
  state.reset()
  self.paused = false
  nova.solid.clear()
  local t0 = nova.clock()
  nova.solid.add("hills", 0, 0, 0)
  nova.log(string.format("hill: %d solid triangles made in %.0f ms", nova.solid.count(), (nova.clock() - t0) * 1000))
  nova.sky { top = { 80, 140, 225 }, horizon = { 200, 225, 245 }, sun = { 0.4, 0.8, 0.3 }, clouds = 0.5 }
  nova.light { dir = { -0.45, -0.8, -0.35 }, color = { 255, 245, 225 }, ambient = { 100, 106, 125 } }
  nova.fog { color = { 200, 225, 245 }, near = 90, far = 230 }
  for _, g in ipairs(level.gems) do nova.spawn("gem", g.x, 0, { z = g.z, gy = g.y }) end
  state.total = #level.gems
  nova.spawn("flag", level.flag.x, level.flag.y, { z = level.flag.z })
  nova.spawn("player", level.start.x, level.start.y, { z = level.start.z })
  state.say("hold R1 against a wall to climb, press B in the air to glide: climb to the flag", 6)
end

function Scene:update(dt)
  if nova.input.pressed("stats") then
    local p = nova.first("player")
    nova.log(string.format("hill: x=%.1f y=%.1f z=%.1f gems=%d falls=%d slide=%d hops=%d max_height=%.1f won=%s time=%.1f mode=%s stamina=%.1f climb=%.1f glide_dist=%.1f glide_time=%.1f mantles=%d", p and p.x or 0, p and p.y or 0, p and p.z or 0, state.gems, state.falls, state.slide_frames, state.hops, state.max_height, tostring(state.won), state.time, p and p.mode or "-", p and p.stamina or 0, state.climb_time or 0, state.glide_dist or 0, state.glide_time or 0, state.mantles or 0))
  end
  if nova.input.pressed("pause") and not state.won then
    self.paused = not self.paused
    nova.pause(self.paused)
  end
  if state.won and nova.input.pressed("jump") then nova.goto_scene("field") end
end

function Scene:draw() nova.model("hills", 0, 0, 0) end

local function text(x, y, s, size, color, align)
  nova.ui.text(x, y, s, { size = size or 18, color = color or { 255, 255, 255 }, shadow = true, align = align })
end

function Scene:draw_ui()
  local w, h = nova.view()
  nova.ui.rect(16, 16, 330, 34, { 0, 0, 0, 130 })
  nova.ui.rect(24, 25, 14, 14, { 80, 100, 200 })
  text(46, 33, string.format("%d / %d gems   %.0f s", state.gems, state.total, state.time), 20)
  local p = nova.first("player")
  if p then
    text(w - 16, 33, string.format("height %.0f m", p.y), 18, { 220, 230, 255 }, "right")
    -- stamina: it runs down while climbing and gliding and comes back on the ground
    local f = max(0, min(1, p.stamina / 6))
    local bw = 240
    nova.ui.rect(w / 2 - bw / 2 - 3, h - 44, bw + 6, 18, { 0, 0, 0, 130 })
    nova.ui.rect(w / 2 - bw / 2, h - 41, bw * f, 12, f > 0.5 and { 90, 220, 120 } or (f > 0.25 and { 240, 200, 70 } or { 235, 80, 70 }))
    text(w / 2, h - 54, p.mode == "climb" and "climbing" or (p.mode == "glide" and "gliding" or "stamina"), 14, { 230, 235, 245 }, "center")
  end
  if state.message_for > 0 then text(w / 2, 70, state.message, 22, nil, "center") end
  if state.won then
    nova.ui.rect(0, 0, w, h, { 10, 60, 30, 170 })
    text(w / 2, h / 2 - 20, "You made it!", 40, nil, "center")
    text(w / 2, h / 2 + 24, string.format("%d gems, %.0f seconds. Jump to play again.", state.gems, state.time), 20, nil, "center")
  end
end

return Scene
