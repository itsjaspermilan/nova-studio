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
local Elite = require("lib.elite")
local Hits = require("lib.hits")
local Status = require("lib.status")
local Cards = require("data.cards")
local LK = require("lib.look")
local Wipe = require("lib.wipe")
local Banner = require("lib.banner")
local Prompt = require("lib.prompt")
local Flow = require("data.flow")
local Elites = require("data.elites")

-- `look` is the kind of light of the room (data/look.lua): "outdoors", "yard" (Mother Coil's) or "indoors" (the stranger's room, the shop)
local Room = nova.scene { room = "market_a", first = false, look = "outdoors" }

local VIEW_W, VIEW_H = 960, 540

function Room:enter()
  J.reset()
  -- a room of the Gutter Market belongs to a district run (a chain); the slice-2 rooms (market_a, market_b) to a plain run
  local gutter = Run.find_layout(self.room) ~= nil
  if self.first or not Run.active then
    if gutter then Run.begin_chain() else Run.begin() end
  elseif gutter and not Run.chain then
    Run.begin_chain(Run.seed)
  end
  self.entry = Run.entry_for(self.room)
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
  self.def = self.entry and self.entry.def or Waves[self.room]
  self.state, self.t, self.wave_i = "intro", 0, 0
  self.fight_t = 0
  self.paused, self.banner_t, self.paid = false, 0, 0
  nova.pause(false)
  Prompt.reset(self.runner)
  Banner.clear()
  Banner.runner = self.runner
  -- Arriving through a wipe: the room holds still (nothing spawns, nothing can hurt the runner, the clock stops) until the shutter has fully opened,
  -- then its banners come and it begins (see update).
  self.held = Wipe.busy()
  if self.held then nova.pause(true) end
  nova.music.play(P.music.track, { volume = P.music.volume })
  nova.log("entered " .. self.room)
  LK.enter(self.look)
  Run.room_kills, Run.room_hit, self.crowd_frac, self.bounty_set = 0, false, 0, false
  self.next_dip = Cards.num.brownout.every
  Hits.dip_t = 0
  -- Debt Spiral: a point lost at the start of every room (never the last one)
  if Run.mods.debt > 0 and self.runner and not (self.entry and self.entry.kind == "walk") then
    local r = self.runner
    r.hp = math.max(1, r.hp - 1)
    Run.hp = r.hp
    nova.log("debt spiral takes a point (health " .. r.hp .. ")")
  end
  if self.entry then nova.log(string.format("room %d of 8: %s (%s)", math.min(self.entry.index, 8), self.entry.kind, self.room)) end
  if not self.held then self:announce() end
end

-- The room-start banners: LET'S GO! at the start of a run, and the room counter with the kind of room.
function Room:announce()
  local e = self.entry
  if not e then return end
  if e.index == 1 then Banner.show("go", { text = "LET'S GO!" }) end
  local kind = Flow.room_kinds[e.kind] or ""
  Banner.show("room", { text = e.kind == "walk" and kind or string.format("ROOM %d / 8   %s", math.min(e.index, 8), kind) })
end

-- Every update of a room's scene starts here: the wipe's clock (it runs while the world is paused), then true while the room must do nothing else:
-- a wipe is closing, holding or opening (input is ignored, nothing is hurt). The frame the shutter is fully open the world starts.
function Room:frozen(dt)
  Wipe.tick(dt)
  if Wipe.busy() then return true end
  if self.held then
    self.held = false
    nova.pause(false)
    self:announce()
  end
  return false
end

function Room:leave() LK.leave() end

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
  nova.log(self.shut_text or "doors shut")
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
  -- Open Channel: a wave with an elite in it comes without the elite's escort
  local rows = w.rows
  if Run.mods.open > 0 then
    local has = false
    for _, row in ipairs(rows) do if row.elite then has = true end end
    if has then
      rows = {}
      for _, row in ipairs(w.rows) do if row.elite then rows[#rows + 1] = row end end
      nova.log("open channel: the elite comes alone")
    end
  end
  for _, row in ipairs(rows) do
    local pt = self.points[row.at]
    if not pt then error("data/waves.lua: room " .. self.room .. " has no spawn point named " .. row.at) end
    local kind, mark = row.kind, nil
    if row.elite then
      kind, mark = self.entry.elite_kind, self.entry.mark
      local m = Elites.marks[mark]
      Banner.show("elite", { text = "ELITE!", sub = m.name:upper() .. ": " .. m.text })
    end
    local count = row.count
    if Run.mods.crowd > 0 then
      -- Crowd Pleaser: 25% more enemies (the fractions are carried to the next row, so a room's total is exact)
      local total = count * (1 + Cards.num.crowd.share * Run.mods.crowd) + self.crowd_frac
      count = math.floor(total + 1e-9)
      self.crowd_frac = total - count
    end
    for k = 1, count do
      local ox, oy = 0, 0
      if count > 1 then
        local a = (k - 1) / count * math.pi * 2 + 0.6
        ox, oy = math.cos(a) * R.spawn_ring, math.sin(a) * R.spawn_ring * 0.8
      end
      nova.spawn("warn", pt.x + ox, pt.y + oy, { kind = kind, time = R.warn, elite = (k == 1) and mark or nil })
    end
    nova.log(string.format("wave %d: %s x%d at %s", i, kind, count, row.at))
  end
end

function Room:clear()
  self.state, self.t = "cleared", 0
  nova.log(self.clear_text or "room cleared")
  for _, d in ipairs(self.doors) do
    if d.exit then d:unlock(true) else d:open(true) end
  end
  nova.sound.play("door_unlock", { volume = P.sfx.door_unlock })
  nova.log("doors unlocked")
  self.paid = Run.add_scrap(self.def.scrap)
  local bonus = self.def.bonus
  if bonus and self.fight_t <= bonus.within then
    self.bonus = Run.add_scrap(bonus.scrap)
    self.paid = self.paid + self.bonus
    nova.log(string.format("time bonus: %d scrap (cleared in %.1f s, within %d)", self.bonus, self.fight_t, bonus.within))
  end
  self.banner_t = R.banner
  nova.log("room pays " .. self.paid .. " scrap")
  -- every cleared room pays keys at once (kept even if the run ends next room), by the kind of room
  self.keys_paid = 0
  if self.entry then self.keys_paid = Run.pay_keys(self.entry.kind) end
  if self.keys_paid > 0 then nova.sound.play("key_pay", { volume = P.sfx.key_pay }) end
  -- Clot: a room cleared without being hit heals
  self.heal_note = nil
  if Run.mods.clot > 0 and not Run.room_hit and self.runner and self.runner.hp < self.runner.max_hp then
    local r = self.runner
    local before = r.hp
    r.hp = math.min(r.max_hp, r.hp + Run.mods.clot)
    Run.hp = r.hp
    self.heal_note = string.format("+%d health (Clot)", r.hp - before)
    nova.log(string.format("clot heals %d (a clean room)", r.hp - before))
  end
  -- CLEARED! with what the room paid (the boss's room says DISTRICT CLEARED!)
  local sub = "+" .. (self.paid or 0) .. " scrap"
  if (self.keys_paid or 0) > 0 then sub = sub .. string.format("   +%d key%s", self.keys_paid, self.keys_paid == 1 and "" or "s") end
  if self.heal_note then sub = sub .. "   " .. self.heal_note end
  if self.B then
    Banner.show("win", { text = "DISTRICT CLEARED!", sub = sub })
  else
    Banner.show("clear", { text = "CLEARED!", sub = sub })
  end
end

function Room:rise_cards()
  self.state = "cards"
  local ids = Run.offer(R.cards + Run.mods.choices, { guarantee = self.def.guarantee })
  local at = self.points.cards
  local n = #ids
  for i, id in ipairs(ids) do
    nova.spawn("card", at.x + (i - (n + 1) / 2) * R.card_gap, at.y, { card_id = id })
  end
  nova.sound.play("card_rise", { volume = P.sfx.card_rise })
  nova.log("cards rise: " .. table.concat(ids, ","))
end

function Room:brownout()
  local N = Cards.num.brownout
  local n = 0
  for _, e in ipairs(nova.all("enemy")) do
    if e.state ~= "dead" then Status.stun(e, N.stun); n = n + 1 end
  end
  Hits.dip_t = N.dip
  nova.sound.play("brownout", { volume = P.sfx.brownout })
  nova.log(string.format("brownout: the lights dip, %d enemies stunned for %.1f s", n, N.stun))
end

function Room:take(card)
  local id = card.card_id
  Run.add_card(id, self.runner)
  if Cards.by_id[id].jinx then nova.sound.play("jinx_take", { volume = P.sfx.jinx_take }) end
  card:taken()
  for _, c in ipairs(nova.all("card")) do if c ~= card then c:sink() end end
  nova.sound.play("card_take", { volume = P.sfx.card_take })
  self.state, self.near_card = "done", nil
  for _, d in ipairs(self.doors) do if d.exit then d:open() end end
  nova.log("exit door opens")
end

-- Familiar Streets (a Workbench upgrade): Y on the card floor draws the offer again, as often as the run has rerolls.
function Room:reroll_cards()
  Run.rerolls = Run.rerolls - 1
  for _, c in ipairs(nova.all("card")) do c:destroy() end
  Run.reroll_next = true
  nova.log("cards rerolled (" .. Run.rerolls .. " left)")
  nova.sound.play("reroll", { volume = P.sfx.reroll })
  self:rise_cards()
end

function Room:pick()
  local r = self.runner
  if (Run.rerolls or 0) > 0 and nova.input.pressed("ranged") and #nova.all("card") > 0 then
    r.aiming, r.shot_cd = false, 0.4           -- (the same button aims: it must not also fire)
    self:reroll_cards()
    return
  end
  local near = self.near_card
  if near and nova.input.pressed("interact") then Prompt.used("card" .. near.card_id); self:take(near) end
end

-- The prompts of the room (lib/prompt.lua): a panel over the card the runner stands by, over an open exit door; only the nearest. Run every update.
-- (The cards' own pictures and the doors' lamps are their quiet cues.) `extra` are a scene's own items (the stranger, the counters).
function Room:prompts(dt, extra, enabled)
  local r = self.runner
  local items = {}
  if not r or r.state == "dead" then Prompt.update(dt, {}, false); return end
  for _, c in ipairs(nova.all("card")) do
    c.near = false
    if c.ready and self.state == "cards" then
      local d, def = r:distance_to(c), c.def
      items[#items + 1] = {
        key = "card" .. c.card_id, card = c, x = c.x, y = c.y - 140, name = def.name:upper(), color = c.rar.color, no_cue = true,
        line = Cards.rarity[def.rarity].name .. (def.jinx and "   JINX!" or ""), near = d,
      }
    end
  end
  for i, d in ipairs(self.doors) do
    if d.exit and d.state == "open" and not d.gone then
      local kind = self.entry and self.entry.kind
      local name, line = "NEXT ROOM", "Walk through."
      if kind == "walk" then name, line = "HEAD HOME", "Back to the Den." elseif kind == "boss" then name, line = "TO THE SHOP", "Then home." end
      items[#items + 1] = { key = "door" .. i, x = d.x, y = d.y - 62, name = name, line = line, walk = true,
        near = Prompt.box_distance(r.x, r.y, d.x - 16, d.y - 32, d.x + 16, d.y + 32) }
    end
  end
  for _, it in ipairs(extra or {}) do items[#items + 1] = it end
  local t = Prompt.update(dt, items, enabled ~= false)
  self.near_card = t and t.card or nil
  if self.near_card then self.near_card.near = true end
  return t
end

function Room:update(dt)
  if self:frozen(dt) then return end
  if nova.input.pressed("start") and self.runner and self.runner.state ~= "dead" then self:toggle_pause() end
  if self.paused then HUD.pause_input(self); return end
  Banner.tick(dt)
  if self.runner and self.runner.state == "dead" and not self.death_shown then
    self.death_shown = true
    local L = Flow.death_lines
    Banner.show("death", { text = "FLATLINED!", sub = L[math.random(#L)], hold = 1.0 })
  end
  self:prompts(dt, nil, true)
  J.tick()
  self.t = self.t + dt
  Run.time = Run.time + dt
  if self.state == "fight" then self.fight_t = self.fight_t + dt end
  self.banner_t = math.max(0, self.banner_t - dt)
  if Run.set_flash then
    Run.set_flash.t = Run.set_flash.t - dt
    if Run.set_flash.t <= 0 then Run.set_flash = nil end
  end
  self:camera(dt)
  local s = self.state
  -- Brownout: every 20 s of a fight the lights dip and every enemy is stunned
  if Run.mods.brownout > 0 and (s == "fight" or s == "boss") and self.fight_t >= self.next_dip then
    self.next_dip = self.next_dip + Cards.num.brownout.every
    self:brownout()
  end
  -- Bounty Board: once the first enemies are out, one of them carries the mark
  if Run.mods.bounty > 0 and not self.bounty_set and s == "fight" and nova.count("enemy") > 0 then
    self.bounty_set = true
    local list = {}
    for _, e in ipairs(nova.all("enemy")) do if e.state ~= "dead" and e.kind_name ~= "tout" then list[#list + 1] = e end end
    if #list > 0 then
      local e = list[Run.mix(Run.seed, Run.room * 7 + 3) % #list + 1]
      e.bounty = Cards.num.bounty.pay
      nova.log("bounty: " .. e.kind_name .. " is marked for " .. e.bounty)
    end
  end
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
    elseif nova.count("warn") == 0 and nova.count("enemy") == 0 and nova.count("fuse") == 0 then
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

-- Dying ends the run. A district run goes to its summary (which starts the next run at room 1 with a new seed; the Den comes in a later
-- slice); the slice-2 rooms start again at market_a.
function Room:on_runner_dead()
  if Run.chain then
    Run.finish("dead")
    Wipe.go("summary")
  else
    Run.active = false
    nova.goto_scene("market_a")
  end
end

function Room:draw_ui()
  HUD.draw(self)
  if not self.paused then Prompt.draw(); Banner.draw() end
  Wipe.draw()
end

return Room
