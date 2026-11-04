local state = require("lib.state")
local fx = require("lib.fx")
local Level = require("lib.level")

local Scene = nova.scene {}

function Scene:enter()
  state.reset()
  fx.reset()
  Level.nav_dirty, self.nav_age = false, 0
  self.paused = false
  for _, s in ipairs(Level.build()) do
    local props = { z = s[3] }
    if s[4] then for k, v in pairs(s[4]) do props[k] = v end end
    nova.spawn(s[1], s[2], 0, props)
  end
  Level.build_nav()
  Level.bake() -- (after the doors, whose walls stop the light)
  -- a dark bunker: little light but the lamps' own, baked into the walls
  nova.light { dir = { -0.2, -1, -0.1 }, color = { 0, 0, 0 }, ambient = { 30, 32, 42 } }
  nova.fog { color = { 8, 10, 14 }, near = 18, far = 60 }
  state.say("find the red key; the arena is below", 4)
end

function Scene:update(dt)
  if nova.input.pressed("stats") then
    self.show_stats = not self.show_stats
    local p = nova.first("player")
    -- (the tests read this line)
    local doors = ""
    nova.each("door", function(d) doors = doors .. string.format("%.1f%s ", d.t, d.blocking and "B" or "o") end)
    nova.log("doors " .. doors)
    nova.log(string.format("bunker: x=%.1f z=%.1f hp=%d kills=%d enemies=%d key=%s exit=%s dead=%s won=%s lights=%d/%d paths=%d path_ms=%.3f path_worst=%.2f nav_builds=%d nav_ms=%.2f", p and p.x or 0, p and p.z or 0, state.hp, state.kills, nova.count("enemy"), tostring(state.key), tostring(state.exit_open), tostring(state.dead), tostring(state.won), fx.lights.used, fx.lights.wanted, state.path_calls, state.path_ms / math.max(1, state.path_calls), state.path_worst, state.nav_builds, state.nav_ms / math.max(1, state.nav_builds)))
  end
  if nova.input.pressed("profile") then
    self.profiling = not self.profiling
    nova.profile(self.profiling)
  end
  if nova.input.pressed("pause") and not state.dead and not state.won then
    self.paused = not self.paused
    nova.pause(self.paused)
    nova.input.grab_mouse(not self.paused)
  end
  if self.paused then return end
  if state.dead or state.won then
    if nova.input.pressed("fire") or nova.input.pressed("reload") then nova.goto_scene("level") end
    fx.update(dt)
    return
  end
  state.time = state.time + dt
  state.message_for = state.message_for - dt
  fx.update(dt)
  -- a door opened or shut: the paths change (not more than a few times a second)
  self.nav_age = self.nav_age + dt
  if Level.nav_dirty and self.nav_age > 0.25 then
    Level.nav_dirty, self.nav_age = false, 0
    Level.build_nav()
  end
end

function Scene:draw()
  Level.draw()
  fx.draw()
  local p = nova.first("player")
  fx.commit_lights(p and p.x or 0, p and p.z or 0)
end

local function text(x, y, s, size, color, align)
  nova.ui.text(x, y, s, { size = size or 16, color = color or { 255, 255, 255 }, shadow = true, align = align })
end

function Scene:draw_ui()
  local w, h = nova.view()
  local p = nova.first("player")
  if not p then return end
  -- the crosshair, and a mark when a shot hits
  local c = p.hit_marker > 0 and { 255, 80, 60, 255 } or { 255, 255, 255, 200 }
  nova.ui.rect(w / 2 - 9, h / 2 - 1, 6, 2, c)
  nova.ui.rect(w / 2 + 3, h / 2 - 1, 6, 2, c)
  nova.ui.rect(w / 2 - 1, h / 2 - 9, 2, 6, c)
  nova.ui.rect(w / 2 - 1, h / 2 + 3, 2, 6, c)
  if p.hurt_flash > 0 then nova.ui.rect(0, 0, w, h, { 200, 20, 20, math.floor(p.hurt_flash * 260) }) end
  -- health, armour, ammunition
  nova.ui.rect(16, h - 52, 220, 36, { 0, 0, 0, 150 })
  nova.ui.rect(20, h - 44, 212 * state.hp / 100, 12, { 220, 50, 50 })
  nova.ui.rect(20, h - 28, 212 * state.armor / 100, 8, { 70, 130, 230 })
  text(24, h - 48, string.format("%d", math.ceil(state.hp)), 12)
  local wp = state.weapons[state.weapon]
  nova.ui.rect(w - 236, h - 52, 220, 36, { 0, 0, 0, 150 })
  text(w - 28, h - 50, string.format("%s   %d / %d", wp.name, state.mag[state.weapon], state.ammo[wp.ammo]), 20, nil, "right")
  if p.reloading > 0 then text(w - 28, h - 74, "reloading", 14, { 255, 220, 120 }, "right") end
  if state.key then text(w / 2, h - 40, "RED KEY", 16, { 255, 90, 90 }, "center") end
  if state.message_for > 0 then text(w / 2, h * 0.22, state.message, 20, nil, "center") end
  if self.show_stats then
    local s = nova.stats()
    local L = fx.lights
    local lines = {
      string.format("%.0f fps   lua %.1f ms   draw %.1f ms   %d draws", s.fps, s.lua_ms, s.render_ms, s.draws),
      string.format("lights wanted %d, used %d, dropped %d (worst %d)   entities %d   walls %d", L.wanted, L.used, L.dropped, L.worst, s.entities, nova.walls.count()),
      string.format("baked light: %d vertices in %.0f ms", Level.bake_vertices or 0, Level.bake_ms or 0),
      string.format("paths %d, %.2f ms each, worst %.2f ms   grid built %d times, %.1f ms each", state.path_calls, state.path_ms / math.max(1, state.path_calls), state.path_worst, state.nav_builds, state.nav_ms / math.max(1, state.nav_builds)),
      string.format("x %.1f  z %.1f   kills %d   time %d s", p.x, p.z, state.kills, math.floor(state.time)),
    }
    if self.profiling then
      local r = nova.profile_report(5)
      for _, f in ipairs(r.functions) do lines[#lines + 1] = string.format("%4.0f%%  %s", f.share * 100, f.name) end
    end
    nova.ui.rect(6, 6, 640, 20 * #lines + 8, { 0, 0, 0, 160 })
    for i, l in ipairs(lines) do text(12, 8 + (i - 1) * 20, l, 14) end
  end
  if self.paused then
    nova.ui.rect(0, 0, w, h, { 0, 0, 0, 150 })
    text(w / 2, h / 2 - 20, "Paused", 30, nil, "center")
  end
  if state.dead then
    nova.ui.rect(0, 0, w, h, { 90, 10, 10, 170 })
    text(w / 2, h / 2 - 40, "You died", 34, nil, "center")
    text(w / 2, h / 2 + 10, string.format("%d kills   press fire to try again", state.kills), 18, nil, "center")
  end
  if state.won then
    nova.ui.rect(0, 0, w, h, { 10, 60, 30, 170 })
    text(w / 2, h / 2 - 50, "Level clear", 34, nil, "center")
    text(w / 2, h / 2, string.format("%d kills   %d:%02d", state.kills, math.floor(state.time / 60), math.floor(state.time % 60)), 20, nil, "center")
    text(w / 2, h / 2 + 40, "press fire to play again", 16, nil, "center")
  end
end

return Scene
