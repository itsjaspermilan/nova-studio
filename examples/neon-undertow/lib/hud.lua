-- The screen furniture of a fight room: hearts, charge pips, scrap, the prompt row, the wave count, the banner, the card text
-- when the runner stands by a card, and the pause page that lists the cards held.
local P = require("data.player")
local Ty = require("lib.type")
local J = require("lib.juice")
local Run = require("lib.run")
local Cards = require("data.cards")

local H = {}
local W, HH = 960, 540

-- "SET: 2/3 Volt" lines for a card's tags: how many different held cards carry the tag (counting this card if it were taken).
function H.set_lines(d)
  local out = {}
  for _, t in ipairs(d.tags) do
    local have = Run.set_count(t)
    local would = (Run.count(d.id) > 0) and have or have + 1
    local name = Cards.sets[t].name
    local text = string.format("SET: %d/%d %s", math.min(would, Cards.set_size), Cards.set_size, name)
    if Run.set_on(t) then text = text .. " (ON)" elseif would >= Cards.set_size then text = text .. " - this completes it!" end
    out[#out + 1] = text
  end
  return out
end

-- A warning frame: yellow and black stripes round a rectangle (jinx cards).
function H.warning_frame(x, y, w, h, t)
  local n = math.floor(w / 14)
  for i = 0, n do
    local on = (i + math.floor((t or 0) * 4)) % 2 == 0
    local c = on and { 255, 228, 94, 255 } or { 20, 16, 5, 255 }
    nova.ui.rect(x - 6 + i * 14, y - 6, 14, 6, c)
    nova.ui.rect(x - 6 + i * 14, y + h, 14, 6, c)
  end
  for j = 0, math.floor(h / 14) do
    local on = j % 2 == 0
    local c = on and { 255, 228, 94, 255 } or { 20, 16, 5, 255 }
    nova.ui.rect(x - 6, y + j * 14, 6, 14, c)
    nova.ui.rect(x + w, y + j * 14, 6, 14, c)
  end
end

function H.prompt(x, y, action, word)
  local label = nova.input.prompt(action)
  local s = require("lib.prompt").badge(x, y - 1, label, { 53, 230, 255, 255 })
  Ty.text(x + s + 7, y - 2, word, "body", { color = { 225, 232, 250, 255 } })
  return x + s + 7 + Ty.width(word, "body") + 22
end

local function bars(r)
  local max_hp = r.max_hp or P.health
  -- a plate under the hearts and pips: they read over any floor
  nova.ui.rect(0, 0, 14 + math.ceil(max_hp / 2) * 38, 90, { 5, 6, 15, 205 })
  for i = 1, math.ceil(max_hp / 2) do
    local frame = 2
    if r.hp >= i * 2 then frame = 0 elseif r.hp == i * 2 - 1 then frame = 1 end
    nova.ui.sprite("ui", 28 + (i - 1) * 38, 30, { frame = frame, scale = 1.25 })
  end
  local pips = r.max_charge or P.charge.pips
  for i = 1, pips do
    nova.ui.sprite("ui", 28 + (i - 1) * 30, 66, { frame = (r.charge + 1e-6 >= i) and 3 or 4, scale = 1.0 })
  end
  local frac = r.charge - math.floor(r.charge + 1e-6)
  if r.charge < pips and frac > 0.01 then
    local i = math.floor(r.charge + 1e-6) + 1
    nova.ui.rect(14 + (i - 1) * 30, 86, 28 * frac, 3, { 6, 240, 255, 255 })
  end
  nova.ui.rect(868, 8, 92, 44, { 5, 6, 15, 215 })   -- (a plate under the count: it must read over the busiest floor)
  nova.ui.sprite("ui", 890, 30, { scale = 1.1, frame = 5 })
  Ty.text(908, 18, tostring(J.scrap), "label", { color = { 255, 255, 255, 255 } })
end

local function centered(y, text, role, color)
  Ty.text(0, y, text, role, { color = color, align = "center", width = W })
end

-- The text panel for the card the runner stands by.
local function card_panel(card)
  local d, rar = card.def, card.rar
  local fam = Cards.families[d.family]
  local x, y, w, h = 150, 326, 660, 164
  local c = rar.color
  nova.ui.rect(x - 3, y - 3, w + 6, h + 6, { c[1], c[2], c[3], 255 })
  if d.jinx then H.warning_frame(x - 3, y - 3, w + 6, h + 6, nova.time()) end
  nova.ui.rect(x, y, w, h, { 8, 10, 26, 252 })
  nova.ui.sprite("ui", x + 46, y + 48, { frame = Cards.frame_of(d.family, d.rarity), scale = 2.4 })
  Ty.text(x - 2, y + 88, fam.name, "tiny", { color = { 190, 200, 230, 255 }, align = "center", width = 100 })
  Ty.text(x + 100, y + 12, d.name, "name", { color = { c[1], c[2], c[3], 255 } })
  local tags = rar.name
  if #d.tags > 0 then tags = tags .. "  [" .. table.concat(d.tags, ", ") .. "]" end
  local have = Run.count(d.id)
  tags = tags .. "   " .. have .. "/" .. d.max .. " held"
  Ty.text(x + 100, y + 42, tags, "small", { color = { 190, 200, 230, 255 } })
  Ty.text(x + 100, y + 64, d.text, "small", { color = { 255, 255, 255, 255 }, width = w - 116 })
  local ty = y + 118
  if d.cost then
    Ty.text(x + 100, ty, "JINX! " .. d.cost, "small", { color = { 255, 228, 94, 255 }, width = w - 116 })
    ty = ty + 20
  end
  for i, line in ipairs(H.set_lines(d)) do
    Ty.text(x + 100, ty + (i - 1) * 18, line, "small", { color = { 255, 140, 60, 255 } })
  end
  H.prompt(x + w - 120, y + 12, "interact", "take")
end

-- The pause page: the cards held, six to a page (two columns of three), at a size that reads on the handheld; left and right turn the page.
-- Effects (the look's quality, data/look.lua) is changed here too: interact cycles High, Low, Off.
local PER = 6

function H.pause_pages(n) return math.max(1, math.ceil(n / PER)) end

-- (called by the room every frame it is paused)
function H.pause_input(scene)
  local held = {}
  local seen = {}
  for _, id in ipairs(Run.cards) do if not seen[id] then seen[id] = true; held[#held + 1] = id end end
  local pages = H.pause_pages(#held)
  scene.page = math.min(scene.page or 1, pages)
  local ax = nova.input.axis("move_x")
  local dir = ax > 0.6 and 1 or (ax < -0.6 and -1 or 0)
  if dir ~= 0 and dir ~= (scene.page_dir or 0) and pages > 1 then
    scene.page = (scene.page - 1 + dir) % pages + 1
    nova.sound.play("menu_move", { volume = P.sfx.menu_move })
  end
  scene.page_dir = dir
  if nova.input.pressed("interact") then
    local q = require("lib.look").cycle_quality()
    nova.sound.play("menu_select", { volume = P.sfx.menu_select })
    nova.log("effects: " .. q)
  end
  -- Quit: hold the ranged button for three quarters of a second (a tap does nothing, so it cannot happen by accident). The save is
  -- written by nova.quit(); keys and upgrades are already kept, the run in hand is given up.
  scene.quit_hold = nova.input.down("ranged") and (scene.quit_hold or 0) + 1 or 0
  if scene.quit_hold >= H.QUIT_HOLD_FRAMES then
    nova.log("quit from the pause page")
    nova.quit()
  end
end
H.QUIT_HOLD_FRAMES = 45

local function pause_page(scene)
  nova.ui.rect(0, 0, W, HH, { 5, 6, 15, 245 })
  centered(10, "PAUSED", "head", { 6, 240, 255, 255 })
  local held = {}
  local seen = {}
  for _, id in ipairs(Run.cards) do
    if not seen[id] then seen[id] = true; held[#held + 1] = id end
  end
  local pages = H.pause_pages(#held)
  local page = math.min(scene.page or 1, pages)
  centered(50, #Run.cards == 0 and "No cards yet." or string.format("Cards held: %d     page %d of %d", #Run.cards, page, pages), "label", { 210, 218, 245, 255 })
  for k = 1, PER do
    local i = (page - 1) * PER + k
    local id = held[i]
    if not id then break end
    local d = Cards.by_id[id]
    local rar = Cards.rarity[d.rarity]
    local col = (k - 1) % 2
    local row = math.floor((k - 1) / 2)
    local x, y, w, h = 24 + col * 460, 76 + row * 106, 452, 102
    local c = rar.color
    nova.ui.rect(x, y, w, h, { c[1], c[2], c[3], 255 })
    nova.ui.rect(x + 3, y + 3, w - 6, h - 6, { 12, 14, 34, 255 })
    if d.jinx then H.warning_frame(x, y, w, h, 0) end
    nova.ui.sprite("ui", x + 30, y + 49, { frame = Cards.frame_of(d.family, d.rarity), scale = 1.5 })
    local tagtxt = #d.tags > 0 and ("  [" .. table.concat(d.tags, ", ") .. "]") or ""
    Ty.text(x + 62, y + 6, d.name .. (Run.count(id) > 1 and ("  x" .. Run.count(id)) or "") .. tagtxt, "label", { color = { c[1], c[2], c[3], 255 } })
    Ty.text(x + 62, y + 30, d.text, "small", { color = { 235, 240, 255, 255 }, width = w - 74 })
  end
  local sets = {}
  for _, t in ipairs(Cards.set_order) do
    if Run.set_count(t) > 0 then sets[#sets + 1] = string.format("%s %d/%d%s", Cards.sets[t].name, Run.set_count(t), Cards.set_size, Run.set_on(t) and " ON" or "") end
  end
  Ty.text(24, 398, #sets > 0 and ("SETS: " .. table.concat(sets, "   ")) or "SETS: none yet (three different cards of one tag)", "body", { color = { 255, 150, 70, 255 }, width = 912 })
  Ty.text(24, 424, string.format("scrap %d     seed %d", J.scrap, Run.seed or 0), "body", { color = { 210, 218, 245, 255 } })
  local q = require("lib.look").quality
  Ty.text(24, 450, "Effects: " .. ({ high = "HIGH (lights, reflections, rain, bloom)", low = "LOW (no reflections or bloom: for the handheld)", off = "OFF" })[q], "body", { color = { 6, 240, 255, 255 } })
  local x = 24
  x = H.prompt(x, 500, "start", "resume")
  x = H.prompt(x, 500, "interact", "effects")
  x = H.prompt(x, 500, "ranged", (scene.quit_hold or 0) > 0 and ("quitting" .. string.rep(".", 1 + math.floor((scene.quit_hold or 0) / 12))) or "hold: quit game")
  if pages > 1 then Ty.text(x + 6, 503, "left / right: page", "body", { color = { 210, 218, 245, 255 } }) end
end

-- A warning mark that is off the screen: a magenta "!" on the edge where it is.
function H.warn_arrows()
  for _, e in ipairs(nova.all("warn")) do
    local x, y = nova.cam.to_screen(e.x, e.y)
    if x < 0 or x > W or y < 0 or y > HH then
      local cx, cy = math.max(24, math.min(W - 24, x)), math.max(40, math.min(HH - 40, y))
      local on = math.floor(e.t * 10) % 2 == 0
      nova.ui.rect(cx - 12, cy - 12, 24, 24, { 255, 43, 214, on and 255 or 150 })
      Ty.text(cx - 12, cy - 9, "!", "label", { color = { 255, 255, 255, 255 }, align = "center", width = 24 })
    end
  end
end

-- `scene` has: runner, state, wave_i, def (waves), banner_t, near_card, paused.
function H.draw(scene)
  for _, e in ipairs(nova.all("hurtable")) do if e.hud then e:hud() end end
  for _, c in ipairs(nova.all("card")) do c:hud() end
  local r = scene.runner
  if not r then return end
  if scene.paused then pause_page(scene); return end       -- (text is always over rectangles: nothing else may be drawn under the page)
  if require("lib.hits").dip_t > 0 then nova.ui.rect(0, 0, W, HH, { 0, 0, 10, 190 * math.min(1, require("lib.hits").dip_t / 0.3) }) end   -- (Brownout: the lights dip)
  bars(r)
  H.warn_arrows()
  if Run.set_flash then
    local f = Run.set_flash
    local a = math.min(1, f.t / 0.5) * 255
    local sd = Cards.sets[f.tag]
    nova.ui.rect(180, 138, 600, 70, { 20, 10, 30, a * 0.85 })
    nova.ui.rect(180, 138, 600, 4, { 255, 140, 60, a })
    nova.ui.rect(180, 204, 600, 4, { 255, 140, 60, a })
    centered(146, "SET COMPLETE: " .. sd.name:upper(), "head", { 255, 228, 94, a })
    centered(182, sd.text, "small", { 255, 255, 255, a })
  end
  if scene.state == "fight" and scene.def and scene.wave_i > 0 then
    nova.ui.rect(330, 6, 300, 48, { 5, 6, 15, 205 })
    centered(10, string.format("WAVE %d / %d", scene.wave_i, #scene.def.waves), "label", { 255, 80, 225, 255 })
  end
  if scene.entry then
    local e = scene.entry
    if scene.state ~= "fight" or not scene.def or scene.wave_i == 0 then nova.ui.rect(330, 6, 300, 48, { 5, 6, 15, 205 }) end
    Ty.text(0, 32, string.format("ROOM %d / 8", math.min(e.index, 8)), "body", { color = { 190, 200, 230, 255 }, align = "center", width = W })
    if e.kind == "elite" and e.mark and scene.state == "fight" then
      local m = require("data.elites").marks[e.mark]
      nova.ui.rect(150, 54, 660, 26, { 5, 6, 15, 215 })
      centered(58, "ELITE: " .. m.name .. ". " .. m.text, "small", { 255, 228, 94, 255 })
    end
  end
  local eye = require("lib.workbench").eye_text(Run)      -- LULLABY's Eye (a Workbench upgrade)
  if eye then Ty.text(560, 52, eye, "small", { color = { 6, 240, 255, 255 }, align = "right", width = 380 }) end
  nova.ui.rect(0, 498, 620, 42, { 5, 6, 15, 190 })     -- (a plate under the prompts)
  local x = 16
  x = H.prompt(x, 506, "attack", "baton")
  x = H.prompt(x, 506, "dash", "roll")
  x = H.prompt(x, 506, "ranged", "shoot")
  x = H.prompt(x, 506, "interact", "use")
  H.prompt(x, 506, "start", "cards")
  if scene.near_card then card_panel(scene.near_card) end
  if scene.state == "cards" and (Run.rerolls or 0) > 0 then
    H.prompt(700, 478, "ranged", "reroll (" .. Run.rerolls .. " left)")
  end
  if r.state == "dead" then
    local a = math.min(1, r.dead_t / 0.4) * 255
    nova.ui.rect(0, 0, W, HH, { 5, 6, 15, a * 0.62 })
  end
end

return H
