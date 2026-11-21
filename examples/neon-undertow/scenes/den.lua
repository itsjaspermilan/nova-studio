-- The Den: the hub. You wake on the print bed (LULLABY's line for how you got here), and walk to: her cracked screen (talk), the Workbench
-- (permanent upgrades, bought with keys), the stalls (name plates; the strangers who moved in live there) and the door (a run starts).
-- Everything it says is data/den.lua; the upgrades are data/upgrades.lua; the sums are lib/workbench.lua; what is saved is lib/meta.lua.
local P = require("data.player")
local J = require("lib.juice")
local Run = require("lib.run")
local Meta = require("lib.meta")
local Dd = require("data.den")
local Strangers = require("data.strangers")
local Cards = require("data.cards")
local Work = require("lib.workbench")
local HUD = require("lib.hud")
local Lullaby = require("lib.lullaby")

local Den = nova.scene {}
local VIEW_W, VIEW_H, W = 960, 540, 960

local function centered(y, text, size, color)
  nova.ui.text(0, y, text, { font = "pixel", size = size, color = color, align = "center", width = W, shadow = true })
end

function Den:enter()
  J.reset()
  nova.pause(false)
  if not Meta.started then Meta.started = true; Meta.save() end
  local data = nova.scene_data("den")
  self.w, self.h = data.width, data.height
  self.runner = nova.named("runner")
  local r = self.runner
  r.hp, r.max_hp = r.max_hp, r.max_hp
  self.cx, self.cy = r.x, r.y - 24
  nova.cam.set(math.max(VIEW_W / 2, math.min(self.w - VIEW_W / 2, r.x)), math.max(VIEW_H / 2, math.min(self.h - VIEW_H / 2, r.y - 24)))
  self.things = {}
  for _, t in ipairs(nova.all("den_thing")) do self.things[t.name] = t end
  self.t, self.state, self.sel, self.last_dir = 0, "wake", 1, 0
  self.toast, self.toast_t = nil, 0
  self.line, self.line_kind, self.line_n = Lullaby.wake_line(Meta.last)
  Meta.save()
  nova.pause(true)
  nova.sound.play("printed", { volume = P.sfx.printed })
  nova.music.play(P.music.den, { volume = P.music.den_volume })
  require("lib.look").enter("indoors")
  nova.log(string.format("the den: printed again (%s, line %d): %s", self.line_kind, self.line_n, self.line))
end

function Den:leave() require("lib.look").leave() end

function Den:camera(dt)
  local r = self.runner
  if not r or not r:is_alive() then return end
  local k = 1 - math.exp(-9 * dt)
  self.cx = self.cx + (r.x - self.cx) * k
  self.cy = self.cy + (r.y - 24 - self.cy) * k
  nova.cam.set(math.max(VIEW_W / 2, math.min(self.w - VIEW_W / 2, self.cx)), math.max(VIEW_H / 2, math.min(self.h - VIEW_H / 2, self.cy)))
end

-- The fixture the runner stands at (the screen, the bench, the door, a stall), or nil.
function Den:near_thing()
  local r, best, bd = self.runner, nil, Dd.reach
  for _, t in pairs(self.things) do
    if t.thing ~= "bed" then
      local dx = math.max(0, math.abs(r.x - t.x) - t.w * 0.3)
      local dy = r.y - t.y
      local d = math.sqrt(dx * dx + dy * dy)
      if d < bd then best, bd = t, d end
    end
  end
  return best
end

function Den:open_panel(kind, data)
  self.state, self.panel, self.pi = kind, data, 1
  nova.pause(true)
end

function Den:close_panel()
  self.state, self.panel = "free", nil
  nova.pause(false)
end

function Den:announce()
  for _, id in ipairs({ "patch", "old_sal" }) do
    if Meta.moved_in[id] and not Meta.seen_in[id] then
      Meta.seen_in[id] = true
      Meta.save()
      local M = Dd.movers[id]
      nova.sound.play("move_in", { volume = P.sfx.move_in })
      nova.log("a stranger has moved in: " .. id)
      self:open_panel("movein", { who = id, name = M.name, note = M.note, perk = M.perk })
      return true
    end
  end
  return false
end

function Den:use(t)
  if t.thing == "screen" then
    local lines, which = Lullaby.screen_set()
    Meta.talks.screen = (Meta.talks.screen or 0) + 1
    Meta.save()
    nova.log("lullaby talks (" .. which .. ")")
    self:open_panel("screen", { lines = lines, set = which })
  elseif t.thing == "codex" then
    self.csel = self.csel or 1
    self:open_panel("codex", {})
    nova.log("the codex opens")
  elseif t.thing == "bench" then
    self.sel = self.sel or 1
    self.toast = nil
    self:open_panel("bench", {})
    nova.log("the workbench opens")
  elseif t.thing == "door" then
    nova.pause(false)
    Run.begin_chain()
    Run.from_den = true
    nova.log("through the door: a run begins")
    nova.goto_scene(Run.chain[1].scene)
  elseif t.thing == "stall" then
    local M = Dd.movers[t.who]
    if Meta.moved_in[t.who] and M then
      local n = Meta.talks[t.who] or 0
      Meta.talks[t.who] = n + 1
      Meta.save()
      self:open_panel("resident", { name = M.name, line = M.den_lines[n % #M.den_lines + 1], perk = M.perk, sprite = M.sprite })
      nova.log("den talk: " .. t.who)
    else
      local stall
      for _, s in ipairs(Dd.stalls) do if s.id == t.who then stall = s end end
      local met = Meta.met[t.who]
      local text
      if stall.later then text = "Not in the Market yet. They will be in a later district."
      else text = string.format("Empty stall. Met %d of %d times: help them %d more to move them in.", met, Dd.moved_in_needed, math.max(0, Dd.moved_in_needed - met)) end
      self:open_panel("plate", { name = stall.name, sub = stall.sub, text = text })
    end
  end
end

-- ---------------------------------------------------------------- the Workbench
function Den:bench_update()
  local ay = nova.input.axis("move_y")
  local dir = ay > 0.6 and 1 or (ay < -0.6 and -1 or 0)
  if dir ~= 0 and dir ~= self.last_dir then
    self.sel = (self.sel - 1 + dir) % #Work.list + 1
    nova.sound.play("menu_move", { volume = P.sfx.menu_move })
  end
  self.last_dir = dir
  local ax = nova.input.axis("move_x")
  local dx = ax > 0.6 and 1 or (ax < -0.6 and -1 or 0)
  local u = Work.list[self.sel]
  if dx ~= 0 and dx ~= (self.last_dx or 0) and u.id == "warm_start" and Work.tier("warm_start") >= 3 then
    -- the chosen card: left and right through the cards of the pool
    local ids = {}
    for _, c in ipairs(Cards.list) do if c.index <= Work.pool_size() and not c.jinx then ids[#ids + 1] = c.id end end
    local at = 1
    for i, id in ipairs(ids) do if id == Meta.warm_pick then at = i end end
    Meta.warm_pick = ids[(at - 1 + dx) % #ids + 1]
    Meta.save()
    nova.sound.play("menu_move", { volume = P.sfx.menu_move })
    nova.log("warm start card: " .. Meta.warm_pick)
  end
  self.last_dx = dx
  if nova.input.pressed("interact") then
    local ok, text = Work.buy(u.id)
    self.toast, self.toast_t = text, 3
    nova.sound.play(ok and "buy" or "empty", { volume = ok and P.sfx.buy or P.sfx.empty })
    if ok and u.id == "warm_start" and Work.tier("warm_start") == 3 and not Cards.by_id[Meta.warm_pick] then
      Meta.warm_pick = Cards.list[1].id
      Meta.save()
    end
  elseif nova.input.pressed("dash") then
    self:close_panel()
  end
end

-- ---------------------------------------------------------------- the codex (every card, by what you have seen)
-- A card is "seen" (full colour) once it was offered or held; "unseen" when it is in the pool but never turned up (a question mark);
-- "locked" (grey, text shown so you can plan) when Deeper Deck has not unlocked it yet.
function Den:card_state(c)
  if c.index > Work.pool_size() then return "locked" end
  return Meta.seen_cards[c.id] and "seen" or "unseen"
end
function Den:tier_needed(c) return math.ceil((c.index - require("data.upgrades").deck_base) / require("data.upgrades").deck_step) end

function Den:codex_update()
  local ay = nova.input.axis("move_y")
  local dir = ay > 0.6 and 1 or (ay < -0.6 and -1 or 0)
  if dir ~= 0 and dir ~= self.last_dir then
    self.csel = (self.csel - 1 + dir) % #Cards.list + 1
    nova.sound.play("menu_move", { volume = P.sfx.menu_move })
  end
  self.last_dir = dir
  if nova.input.pressed("dash") or nova.input.pressed("interact") then self:close_panel() end
end

function Den:draw_codex()
  local WHITE, DIM = { 255, 255, 255, 255 }, { 190, 200, 230, 255 }
  nova.ui.rect(0, 0, W, 540, { 5, 6, 15, 240 })
  nova.ui.text(40, 22, "CARD CODEX", { font = "pixel", size = 30, color = { 255, 200, 120, 255 }, shadow = true })
  local seen, total = 0, #Cards.list
  for _, c in ipairs(Cards.list) do if Meta.seen_cards[c.id] then seen = seen + 1 end end
  nova.ui.text(0, 30, string.format("SEEN %d / %d   POOL %d / %d", seen, total, Work.pool_size(), total), { font = "pixel", size = 16, color = { 255, 228, 94, 255 }, align = "right", width = 920 })
  local first = math.max(1, math.min(self.csel - 5, total - 11))
  for row = 0, 11 do
    local i = first + row
    local c = Cards.list[i]
    if not c then break end
    local y = 70 + row * 35
    local on = i == self.csel
    local st = self:card_state(c)
    nova.ui.rect(30, y, 400, 32, on and { 255, 200, 120, 255 } or { 40, 46, 80, 255 })
    nova.ui.rect(32, y + 2, 396, 28, on and { 30, 24, 14, 255 } or { 12, 14, 34, 255 })
    local col = st == "seen" and { c.rarity == "rare" and 255 or (c.rarity == "uncommon" and 6 or 255), c.rarity == "rare" and 43 or (c.rarity == "uncommon" and 240 or 255), c.rarity == "rare" and 214 or 255, 255 }
      or { 110, 116, 140, 255 }
    local name = st == "unseen" and "? ? ?" or c.name
    nova.ui.text(42, y + 6, string.format("%d. %s", i, name), { font = "pixel", size = 17, color = col })
    if st == "locked" then nova.ui.text(250, y + 9, "Deck " .. self:tier_needed(c), { font = "pixel", size = 14, color = { 200, 170, 120, 255 }, align = "right", width = 170 }) end
  end
  local c = Cards.list[self.csel]
  local st = self:card_state(c)
  local x, y, w = 460, 70, 470
  nova.ui.rect(x - 3, y - 3, w + 6, 396, st == "seen" and { 255, 200, 120, 255 } or { 70, 80, 120, 255 })
  nova.ui.rect(x, y, w, 390, { 8, 10, 26, 248 })
  if st == "unseen" then
    nova.ui.text(x + 14, y + 14, "? ? ?", { font = "pixel", size = 22, color = { 150, 160, 190, 255 } })
    nova.ui.text(x + 14, y + 54, "In your pool, but it has not turned up yet.", { font = "pixel", size = 14, color = WHITE, width = w - 28 })
  else
    local rc = Cards.rarity[c.rarity].color
    local head = st == "locked" and { 150, 156, 180, 255 } or { rc[1], rc[2], rc[3], 255 }
    nova.ui.text(x + 14, y + 12, c.name, { font = "pixel", size = 22, color = head, shadow = true })
    local fam = Cards.families[c.family].name
    local tags = #c.tags > 0 and ("  [" .. table.concat(c.tags, ", ") .. "]") or ""
    nova.ui.text(x + 14, y + 44, Cards.rarity[c.rarity].name .. "  " .. fam .. tags .. "   up to " .. c.max, { font = "pixel", size = 15, color = DIM, width = w - 28 })
    nova.ui.text(x + 14, y + 74, c.text, { font = "pixel", size = 18, color = st == "locked" and { 170, 176, 200, 255 } or WHITE, width = w - 28, line_spacing = 1.3 })
    local ty = y + 178
    if c.cost then nova.ui.text(x + 14, ty, "JINX! " .. c.cost, { font = "pixel", size = 14, color = { 255, 228, 94, 255 }, width = w - 28 }); ty = ty + 40 end
    for _, t in ipairs(c.tags) do
      nova.ui.text(x + 14, ty, string.format("SET %s (3 different cards): %s", Cards.sets[t].name, Cards.sets[t].text), { font = "pixel", size = 15, color = { 255, 150, 70, 255 }, width = w - 28 })
      ty = ty + 50
    end
    if st == "locked" then nova.ui.text(x + 14, y + 340, "LOCKED: buy Deeper Deck tier " .. self:tier_needed(c) .. " at the Workbench.", { font = "pixel", size = 16, color = { 255, 228, 94, 255 }, width = w - 28 }) end
  end
  HUD.prompt(40, 508, "dash", "back")
end

function Den:update(dt)
  self.t = self.t + dt
  self.toast_t = math.max(0, self.toast_t - dt)
  self:camera(dt)
  local pressed = nova.input.pressed("interact")
  if self.state == "wake" then
    if self.t >= Dd.wake or (self.t > 0.9 and pressed) then
      self.state = "free"
      nova.pause(false)
      self:announce()
    end
  elseif self.state == "free" then
    self.by = self:near_thing()
    if self.by and pressed then self:use(self.by) end
  elseif self.state == "bench" then
    self:bench_update()
  elseif self.state == "codex" then
    self:codex_update()
  elseif self.state == "screen" then
    if pressed then
      nova.sound.play("lullaby_blip", { volume = P.sfx.lullaby_blip })
      self.pi = self.pi + 1
      if self.pi > #self.panel.lines then self:close_panel() end
    end
  elseif self.panel and pressed then
    self:close_panel()
  end
end

-- ---------------------------------------------------------------- drawing
local MAG, CYAN, WHITE, DIM = { 255, 43, 214, 255 }, { 6, 240, 255, 255 }, { 255, 255, 255, 255 }, { 190, 200, 230, 255 }

local function box(x, y, w, h, edge)
  nova.ui.rect(x - 3, y - 3, w + 6, h + 6, edge)
  nova.ui.rect(x, y, w, h, { 8, 10, 26, 248 })
end

local function speech(name, text, color, sprite, prompt)
  local x, y, w, h = 90, 308, 780, 172
  box(x, y, w, h, color)
  nova.ui.text(x + 18, y + 12, name, { font = "pixel", size = 18, color = color, shadow = true })
  if sprite then nova.ui.sprite(sprite, x + w - 60, y + 80, { scale = 1.2, frame = 0 }) end
  nova.ui.text(x + 18, y + 46, text, { font = "pixel", size = 16, color = WHITE, width = w - (sprite and 130 or 40), line_spacing = 1.4 })
  HUD.prompt(x + w - 150, y + h - 32, "interact", prompt or "next")
end

local function pips(n, max)
  local s = ""
  for i = 1, max do s = s .. (i <= n and "#" or "-") end
  return s
end

function Den:draw_bench()
  nova.ui.rect(0, 0, W, 540, { 5, 6, 15, 240 })
  nova.ui.text(40, 22, "THE WORKBENCH", { font = "pixel", size = 30, color = CYAN, shadow = true })
  nova.ui.text(0, 28, string.format("KEYS %d", Meta.keys), { font = "pixel", size = 22, color = { 255, 228, 94, 255 }, align = "right", width = 920 })
  for i, u in ipairs(Work.list) do
    local y = 76 + (i - 1) * 40
    local on = i == self.sel
    local tier, max = Work.tier(u.id), Work.max_tier(u.id)
    nova.ui.rect(30, y, 540, 36, on and CYAN or { 40, 46, 80, 255 })
    nova.ui.rect(33, y + 3, 534, 30, on and { 14, 30, 50, 255 } or { 12, 14, 34, 255 })
    nova.ui.text(44, y + 9, u.name, { font = "pixel", size = 16, color = u.locked and { 120, 128, 160, 255 } or WHITE })
    nova.ui.text(330, y + 9, pips(tier, max), { font = "pixel", size = 16, color = MAG })
    local right
    if u.locked then right = "LOCKED"
    elseif tier >= max then right = "MAX"
    else right = Work.next_cost(u.id) .. " keys" end
    local can = Work.can_buy(u.id)
    nova.ui.text(400, y + 9, right, { font = "pixel", size = 16, color = can and { 255, 228, 94, 255 } or { 150, 160, 190, 255 }, align = "right", width = 160 })
  end
  local u = Work.list[self.sel]
  local x, y, w = 600, 76, 330
  box(x, y, w, 396, MAG)
  nova.ui.text(x + 14, y + 12, u.name, { font = "pixel", size = 20, color = MAG, shadow = true })
  nova.ui.text(x + 14, y + 46, u.text, { font = "pixel", size = 14, color = WHITE, width = w - 28, line_spacing = 1.4 })
  local tier, max = Work.tier(u.id), Work.max_tier(u.id)
  local ty = y + 150
  nova.ui.text(x + 14, ty, string.format("Tier %d of %d", tier, max), { font = "pixel", size = 14, color = DIM })
  nova.ui.text(x + 14, ty + 24, tier > 0 and ("Now: " .. u.tier_text[tier]) or "Now: nothing yet", { font = "pixel", size = 14, color = CYAN, width = w - 28, line_spacing = 1.4 })
  if u.locked then
    nova.ui.text(x + 14, ty + 80, string.format("Tiers: %d. Locked: %s.", max, u.locked), { font = "pixel", size = 14, color = { 255, 228, 94, 255 }, width = w - 28, line_spacing = 1.4 })
  elseif tier < max then
    nova.ui.text(x + 14, ty + 80, string.format("Next: %s\nCosts %d keys.", u.tier_text[tier + 1], Work.next_cost(u.id)), { font = "pixel", size = 14, color = { 255, 228, 94, 255 }, width = w - 28, line_spacing = 1.4 })
  end
  if u.id == "warm_start" and tier >= 3 then
    local c = Cards.by_id[Meta.warm_pick]
    nova.ui.text(x + 14, ty + 150, "Your card (left, right): " .. (c and c.name or "none"), { font = "pixel", size = 14, color = MAG, width = w - 28 })
  end
  if self.toast_t > 0 and self.toast then
    nova.ui.text(0, 480, self.toast, { font = "pixel", size = 16, color = { 255, 255, 255, math.min(1, self.toast_t / 0.4) * 255 }, align = "center", width = W, shadow = true })
  end
  local nx = HUD.prompt(40, 508, "interact", "buy")
  HUD.prompt(nx, 508, "dash", "back")
end

function Den:draw_ui()
  local r = self.runner
  -- name plates over the stalls and the fixtures
  for _, t in pairs(self.things) do
    local x, y = nova.cam.to_screen(t.x, t.y - t.h - 6)
    if self.state ~= "free" then
      -- (text is always over rectangles: nothing of the world's labels may show through a panel)
    elseif t.thing == "stall" then
      local stall
      for _, s in ipairs(Dd.stalls) do if s.id == t.who then stall = s end end
      local here = Meta.moved_in[t.who]
      nova.ui.rect(x - 62, y + 18, 124, 36, { 5, 6, 15, 225 })
      nova.ui.rect(x - 62, y + 52, 124, 2, here and CYAN or { 70, 80, 120, 255 })
      nova.ui.text(x - 62, y + 22, stall.name, { font = "pixel", size = 15, color = here and WHITE or { 150, 160, 190, 255 }, align = "center", width = 124 })
      nova.ui.text(x - 62, y + 38, here and "lives here" or (stall.later and "later" or string.format("met %d/%d", Meta.met[t.who] or 0, Dd.moved_in_needed)), { font = "pixel", size = 13, color = here and CYAN or { 120, 128, 160, 255 }, align = "center", width = 124 })
    elseif t.thing == "bench" or t.thing == "screen" or t.thing == "door" or t.thing == "bed" or t.thing == "codex" then
      local label = ({ bench = "WORKBENCH", screen = "LULLABY", door = "DOOR: A RUN", bed = "PRINT BED", codex = "CARD CODEX" })[t.thing]
      nova.ui.text(x - 80, y + 10, label, { font = "pixel", size = 15, color = CYAN, align = "center", width = 160, shadow = true })
    end
  end
  if self.state == "bench" then self:draw_bench(); return end
  if self.state == "codex" then self:draw_codex(); return end
  nova.ui.sprite("ui", 912, 30, { scale = 1.2, frame = 6 })
  nova.ui.text(0, 20, string.format("KEYS %d", Meta.keys), { font = "pixel", size = 20, color = { 255, 228, 94, 255 }, align = "right", width = 890, shadow = true })
  nova.ui.text(16, 16, string.format("runs %d   wins %d%s", Meta.runs, Meta.wins, Meta.best > 0 and string.format("   best %d:%02d", Meta.best // 60, math.floor(Meta.best % 60)) or ""), { font = "pixel", size = 15, color = DIM, shadow = true })
  if self.state == "free" and self.by then
    local t = self.by
    local word = ({ screen = "talk to LULLABY", codex = "read the codex", bench = "open the Workbench", door = "start a run", stall = "talk" })[t.thing]
    if t.thing == "stall" and not Meta.moved_in[t.who] then word = "read the plate" end
    if word then HUD.prompt(360, 470, "interact", word) end
  end
  if self.state == "free" and self.by and self.by.thing == "door" then
    local perks = {}
    for _, id in ipairs({ "patch", "old_sal" }) do if Meta.moved_in[id] then perks[#perks + 1] = Dd.movers[id].name .. ": " .. Dd.movers[id].perk end end
    for i, p in ipairs(perks) do centered(420 - (#perks - i) * 18 - 18, p, 12, CYAN) end
  end
  if self.state == "wake" then
    local a = math.max(0, 1 - self.t / Dd.wake)
    nova.ui.rect(0, 0, W, 540, { 5, 6, 15, 200 * a })
    centered(60, self.line_kind == "first" and "PRINTING" or "PRINTED AGAIN", 36, { 6, 240, 255, 255 * math.min(1, self.t / 0.3) })
    speech("LULLABY", self.line, MAG, nil, "wake up")
  elseif self.state == "screen" then
    speech("LULLABY", self.panel.lines[self.pi], MAG, nil, self.pi < #self.panel.lines and "next" or "bye")
  elseif self.state == "resident" then
    speech(self.panel.name, self.panel.line .. "\n(" .. self.panel.perk .. ")", CYAN, self.panel.sprite, "bye")
  elseif self.state == "plate" then
    speech(self.panel.name .. "  " .. self.panel.sub, self.panel.text, { 70, 80, 120, 255 }, nil, "ok")
  elseif self.state == "movein" then
    centered(120, self.panel.name:upper() .. " MOVED IN", 34, CYAN)
    speech(self.panel.name, self.panel.note .. "\n(" .. self.panel.perk .. ")", CYAN, Strangers[self.panel.who].sprite, "nice")
  end
end

return Den
