local state = require("lib.state")
local upgrades = require("lib.upgrades")

local Arena = nova.scene {}

local SPAWN_RADIUS, MAX_PER_FRAME = 30, 8

function Arena:enter()
  state.new_run()
  self.spawn_carry = 0
  nova.light { dir = { -0.4, -1, -0.3 }, color = { 255, 214, 170 }, ambient = { 70, 70, 96 } }
  nova.shadows { radius = 26, strength = 0.5 }
  nova.cam3.yaw, nova.cam3.pitch = 0, 0
  nova.cam3.eye = { x = 0, y = 8.5, z = 9 }
  self.cards = nova.ui.row { count = 3, w = 208, h = 200, gap = 18, y = 190 }
end

-- How many enemies the director wants alive: a few, then more every second.
local function wanted()
  if state.target then return state.target end
  return math.min(600, 12 + math.floor(state.time * 3.5))
end

local function spawn_one(self)
  local p = nova.first("player")
  if not p then return end
  local a = math.random() * math.pi * 2
  local kind = "grunt"
  local roll = math.random()
  if state.time > 25 and roll < 0.12 then kind = "brute" elseif state.time > 8 and roll < 0.42 then kind = "runner" end
  nova.spawn(kind, p.x + math.cos(a) * SPAWN_RADIUS, 0, { z = p.z + math.sin(a) * SPAWN_RADIUS })
end

function Arena:update(dt)
  if nova.input.pressed("god") then state.god = not state.god end
  if nova.input.pressed("stats") then self.show_stats = not self.show_stats end
  if nova.input.pressed("stress") then
    -- the benchmark: hold a number of enemies steady, a hundred more on each press
    state.god = true
    state.target = (state.target or 0) + 100
  end
  -- level-ups wait for a choice
  if state.choosing then
    -- the cards: left and right, the mouse or a finger over one, a click or A takes it (the engine's nova.ui.choose)
    local pick, accepted, moved = nova.ui.choose { rects = self.cards, current = self.pick or 1 }
    if moved then nova.sound.play("blip") end
    self.pick = pick
    if accepted then
      state.choosing[pick].apply()
      state.choosing, self.pick = nil, nil
      nova.pause(false)
    end
    return
  end
  if nova.input.pressed("pause") then self.paused_by_player = not self.paused_by_player; nova.pause(self.paused_by_player) end
  if self.paused_by_player then return end

  state.time = state.time + dt
  -- the director
  local missing = wanted() - nova.count("enemy")
  local n = math.max(0, math.min(missing, MAX_PER_FRAME))
  for _ = 1, n do spawn_one(self) end
  -- experience
  if state.xp >= state.need() then
    state.xp = state.xp - state.need()
    state.level = state.level + 1
    state.choosing = upgrades.offer()
    self.pick = 1
    nova.sound.play("levelup")
    nova.pause(true)
  end
end

function Arena:draw()
  nova.model("ground", 0, 0, 0, { shadow = false })
end

-- ---- the interface ----------------------------------------------------------------------------------------------------------
local function bar(x, y, w, h, v, color)
  nova.ui.rect(x, y, w, h, { 255, 255, 255, 40 })
  nova.ui.rect(x, y, w * math.max(0, math.min(1, v)), h, color)
end

function Arena:draw_ui()
  local w = nova.view()
  bar(20, 20, 260, 14, state.hp / state.max_hp, { 255, 90, 90 })
  nova.ui.text(24, 38, string.format("HP %d", math.max(0, math.floor(state.hp))), { size = 14, shadow = true })
  bar(w / 2 - 200, 20, 400, 10, state.xp / state.need(), { 82, 214, 255 })
  nova.ui.text(w / 2 - 200, 34, string.format("level %d", state.level), { size = 14, shadow = true })
  nova.ui.text(w - 260, 18, string.format("%d:%02d   kills %d", math.floor(state.time / 60), math.floor(state.time % 60), state.kills), { size = 16, align = "right", width = 240, shadow = true })
  nova.ui.text(w - 260, 40, string.format("enemies %d  bullets %d  gems %d", nova.count("enemy"), nova.count("bullet"), nova.count("gem")), { size = 12, align = "right", width = 240, color = { 200, 200, 220 }, shadow = true })
  if self.show_stats then
    -- the engine's own numbers for the last frame (F3)
    local t = nova.stats()
    nova.ui.rect(16, 64, 250, 112, { 0, 0, 0, 150 })
    nova.ui.text(24, 70, string.format("%.0f fps   lua %.1f ms   draw %.1f ms", t.fps, t.lua_ms, t.render_ms), { size = 13, shadow = true })
    nova.ui.text(24, 92, string.format("%d draws   %d triangles", t.draws, t.triangles), { size = 13, shadow = true })
    nova.ui.text(24, 114, string.format("%d entities   %d scenery", t.entities, t.scenery), { size = 13, shadow = true })
    nova.ui.text(24, 136, string.format("lua memory %.1f MB", t.memory_kb / 1024), { size = 13, shadow = true })
  end
  if state.view == "first" then nova.ui.rect(w / 2 - 1, 270 - 8, 2, 16, { 255, 255, 255, 160 }); nova.ui.rect(w / 2 - 8, 269, 16, 2, { 255, 255, 255, 160 }) end
  if state.choosing then
    nova.ui.rect(0, 0, w, 540, { 0, 0, 0, 150 })
    nova.ui.text(0, 90, "LEVEL UP", { font = "display", size = 46, align = "center", width = w, color = { 255, 214, 120 }, shadow = true })
    for i, u in ipairs(state.choosing) do
      local x, y = self.cards[i].x, self.cards[i].y
      local on = i == self.pick
      nova.ui.rect(x, y, 208, 200, on and { 240, 160, 40, 235 } or { 30, 34, 52, 235 })
      nova.ui.text(x + 12, y + 18, u.name, { size = 22, width = 184, shadow = true, color = on and { 20, 20, 30 } or nil })
      nova.ui.text(x + 12, y + 70, u.text, { size = 16, width = 184, color = on and { 40, 30, 20 } or { 190, 195, 215 } })
    end
    nova.ui.text(0, 430, "left / right: choose     A: take it", { size = 16, align = "center", width = w, color = { 200, 200, 220 } })
  elseif self.paused_by_player then
    nova.ui.rect(0, 0, w, 540, { 0, 0, 0, 140 })
    nova.ui.text(0, 220, "PAUSED", { font = "display", size = 56, align = "center", width = w, shadow = true })
  end
end

return Arena
