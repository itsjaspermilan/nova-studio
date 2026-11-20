-- A fight room: the base of the room scenes (scenes/market_a.lua, market_b.lua). The room's painted map, its doors, spawn points
-- and card spot are in its scene file; its waves and its pay are in data/waves.lua. On entering the doors shut; each wave
-- appears at its spawn points after a warning mark; when the last enemy dies the room is cleared: the doors unlock, the room pays
-- scrap and three cards rise; taking one opens the exit door. This file is also the camera and the pause.
local P = require("data.player")
local J = require("lib.juice")
local Run = require("lib.run")
local R = require("data.rooms")
local Waves = require("data.waves")
local HUD = require("lib.hud")

local Room = nova.scene { room = "market_a", first = false }

local VIEW_W, VIEW_H = 960, 540

function Room:enter()
  J.reset()
  if self.first or not Run.active then Run.begin() end
  J.scrap = Run.scrap
  local data = nova.scene_data(self.room)
  self.w, self.h = data.width, data.height
  self.runner = nova.named("runner")
  Run.give_to(self.runner)       -- (the runner was built before this run began: health, charge and maximums from the run)
  local rx, ry = self.runner.x, self.runner.y - 24
  self.cx, self.cy = rx, ry
  nova.cam.set(math.max(VIEW_W / 2, math.min(self.w - VIEW_W / 2, rx)), math.max(VIEW_H / 2, math.min(self.h - VIEW_H / 2, ry)))
  self.doors = nova.all("door")
  self.points = {}
  for _, m in ipairs(nova.all("marker")) do if m.name then self.points[m.name] = m end end
  self.def = Waves[self.room]
  self.state, self.t, self.wave_i = "intro", 0, 0
  self.paused, self.banner_t, self.paid = false, 0, 0
  nova.pause(false)
  nova.music.play(P.music.track, { volume = P.music.volume })
  nova.log("entered " .. self.room)
end

function Room:camera(dt)
  local r = self.runner
  if not r or not r:is_alive() then return end
  local k = 1 - math.exp(-9 * dt)
  self.cx = self.cx + (r.x - self.cx) * k
  self.cy = self.cy + (r.y - 24 - self.cy) * k
  local cx = math.max(VIEW_W / 2, math.min(self.w - VIEW_W / 2, self.cx))
  local cy = math.max(VIEW_H / 2, math.min(self.h - VIEW_H / 2, self.cy))
  local ox, oy = J.offset()
  nova.cam.set(cx + ox, cy + oy)
end

function Room:toggle_pause()
  self.paused = not self.paused
  nova.pause(self.paused)
  if self.paused then nova.log("paused: cards held " .. (#Run.cards == 0 and "none" or table.concat(Run.cards, ","))) else nova.log("resumed") end
end

function Room:shut_doors()
  for _, d in ipairs(self.doors) do d:shut(true) end
  nova.sound.play("door_shut", { volume = P.sfx.door_shut })
  nova.log("doors shut")
end

function Room:next_wave()
  self.wave_i = self.wave_i + 1
  self.countdown = self.def.waves[self.wave_i].delay
  nova.log(string.format("wave %d of %d in %.1f s", self.wave_i, #self.def.waves, self.countdown))
end

function Room:spawn_wave(i)
  local w = self.def.waves[i]
  nova.sound.play("wave_warn", { volume = P.sfx.wave_warn })
  nova.log("wave " .. i .. " warns")
  for _, row in ipairs(w.rows) do
    local pt = self.points[row.at]
    if not pt then error("data/waves.lua: room " .. self.room .. " has no spawn point named " .. row.at) end
    for k = 1, row.count do
      local ox, oy = 0, 0
      if row.count > 1 then
        local a = (k - 1) / row.count * math.pi * 2 + 0.6
        ox, oy = math.cos(a) * R.spawn_ring, math.sin(a) * R.spawn_ring * 0.8
      end
      nova.spawn("warn", pt.x + ox, pt.y + oy, { kind = row.kind, time = R.warn })
    end
    nova.log(string.format("wave %d: %s x%d at %s", i, row.kind, row.count, row.at))
  end
end

function Room:clear()
  self.state, self.t = "cleared", 0
  nova.log("room cleared")
  for _, d in ipairs(self.doors) do
    if d.exit then d:unlock(true) else d:open(true) end
  end
  nova.sound.play("door_unlock", { volume = P.sfx.door_unlock })
  nova.log("doors unlocked")
  self.paid = Run.add_scrap(self.def.scrap)
  self.banner_t = R.banner
  nova.log("room pays " .. self.paid .. " scrap")
end

function Room:rise_cards()
  self.state = "cards"
  local ids = Run.offer(R.cards)
  local at = self.points.cards
  local n = #ids
  for i, id in ipairs(ids) do
    nova.spawn("card", at.x + (i - (n + 1) / 2) * R.card_gap, at.y, { card_id = id })
  end
  nova.sound.play("card_rise", { volume = P.sfx.card_rise })
  nova.log("cards rise: " .. table.concat(ids, ","))
end

function Room:take(card)
  local id = card.card_id
  Run.add_card(id, self.runner)
  card:taken()
  for _, c in ipairs(nova.all("card")) do if c ~= card then c:sink() end end
  nova.sound.play("card_take", { volume = P.sfx.card_take })
  self.state, self.near_card = "done", nil
  for _, d in ipairs(self.doors) do if d.exit then d:open() end end
  nova.log("exit door opens")
end

function Room:pick()
  local r = self.runner
  local near, nd = nil, R.card_reach
  for _, c in ipairs(nova.all("card")) do
    c.near = false
    if c.ready then
      local d = r:distance_to(c)
      if d < nd then near, nd = c, d end
    end
  end
  if near then near.near = true end
  self.near_card = near
  if near and nova.input.pressed("interact") then self:take(near) end
end

function Room:update(dt)
  if nova.input.pressed("start") and self.runner and self.runner.state ~= "dead" then self:toggle_pause() end
  if self.paused then return end
  J.tick()
  self.t = self.t + dt
  self.banner_t = math.max(0, self.banner_t - dt)
  self:camera(dt)
  local s = self.state
  if s == "intro" then
    if self.t >= R.doors_shut_at then
      self:shut_doors()
      self.state, self.t = "fight", 0
      self:next_wave()
    end
  elseif s == "fight" then
    if self.countdown then
      self.countdown = self.countdown - dt
      if self.countdown <= 0 then self.countdown = nil; self:spawn_wave(self.wave_i) end
    elseif nova.count("warn") == 0 and nova.count("enemy") == 0 then
      if self.wave_i >= #self.def.waves then self.state, self.t = "won", 0 else self:next_wave() end
    end
  elseif s == "won" then
    if self.t >= R.clear_delay then self:clear() end
  elseif s == "cleared" then
    if self.t >= R.clear_beat then self:rise_cards() end
  elseif s == "cards" then
    self:pick()
  end
end

-- Dying ends the run: the first room again, a new run (the Den comes in a later slice).
function Room:on_runner_dead()
  Run.active = false
  nova.goto_scene("market_a")
end

function Room:draw_ui() HUD.draw(self) end

return Room
