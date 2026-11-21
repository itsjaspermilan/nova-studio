-- The screen furniture of a fight room: hearts, charge pips, scrap, the prompt row, the wave count, the banner, the card text
-- when the runner stands by a card, and the pause page that lists the cards held.
local P = require("data.player")
local J = require("lib.juice")
local Run = require("lib.run")
local Cards = require("data.cards")

local H = {}
local W, HH = 960, 540

function H.prompt(x, y, action, word)
  local label = nova.input.prompt(action)
  local w = nova.ui.text_width(label, { font = "pixel", size = 14 }) + 12
  nova.ui.rect(x, y, w, 22, { 5, 6, 15, 220 })
  nova.ui.rect(x, y + 20, w, 2, { 6, 240, 255, 255 })
  nova.ui.text(x + 6, y + 3, label, { font = "pixel", size = 14, color = { 255, 255, 255, 255 } })
  nova.ui.text(x + w + 6, y + 3, word, { font = "pixel", size = 14, color = { 190, 200, 230, 255 }, shadow = true })
  return x + w + 6 + nova.ui.text_width(word, { font = "pixel", size = 14 }) + 22
end

local function bars(r)
  local max_hp = r.max_hp or P.health
  for i = 1, math.ceil(max_hp / 2) do
    local frame = 2
    if r.hp >= i * 2 then frame = 0 elseif r.hp == i * 2 - 1 then frame = 1 end
    nova.ui.sprite("hud_hearts", 28 + (i - 1) * 38, 30, { frame = frame, scale = 2.4 })
  end
  local pips = r.max_charge or P.charge.pips
  for i = 1, pips do
    nova.ui.sprite("hud_pips", 28 + (i - 1) * 30, 66, { frame = (r.charge + 1e-6 >= i) and 0 or 1, scale = 2 })
  end
  local frac = r.charge - math.floor(r.charge + 1e-6)
  if r.charge < pips and frac > 0.01 then
    local i = math.floor(r.charge + 1e-6) + 1
    nova.ui.rect(14 + (i - 1) * 30, 86, 28 * frac, 3, { 6, 240, 255, 255 })
  end
  nova.ui.sprite("scrap", 912, 30, { scale = 2, frame = 0 })
  nova.ui.text(924, 20, tostring(J.scrap), { font = "pixel", size = 20, color = { 255, 255, 255, 255 }, shadow = true })
end

local function centered(y, text, size, color)
  nova.ui.text(0, y, text, { font = "pixel", size = size, color = color, align = "center", width = W, shadow = true })
end

-- The text panel for the card the runner stands by.
local function card_panel(card)
  local d, rar = card.def, card.rar
  local fam = Cards.families[d.family]
  local x, y, w, h = 150, 336, 660, 150
  local c = rar.color
  nova.ui.rect(x - 3, y - 3, w + 6, h + 6, { c[1], c[2], c[3], 255 })
  nova.ui.rect(x, y, w, h, { 8, 10, 26, 245 })
  nova.ui.sprite("icons", x + 46, y + 48, { frame = fam.icon, scale = 4 })
  nova.ui.text(x + 6, y + 88, fam.name, { font = "pixel", size = 14, color = { 190, 200, 230, 255 }, align = "center", width = 80 })
  nova.ui.text(x + 100, y + 12, d.name, { font = "pixel", size = 24, color = { c[1], c[2], c[3], 255 }, shadow = true })
  local tags = rar.name
  if #d.tags > 0 then tags = tags .. "  [" .. table.concat(d.tags, ", ") .. "]" end
  local have = Run.count(d.id)
  tags = tags .. "   " .. have .. "/" .. d.max .. " held"
  nova.ui.text(x + 100, y + 42, tags, { font = "pixel", size = 13, color = { 190, 200, 230, 255 } })
  nova.ui.text(x + 100, y + 68, d.text, { font = "pixel", size = 16, color = { 255, 255, 255, 255 }, width = w - 116, line_spacing = 1.4 })
  H.prompt(x + w - 120, y + 12, "interact", "take")
end

local function pause_page()
  nova.ui.rect(0, 0, W, HH, { 5, 6, 15, 232 })
  centered(26, "PAUSED", 34, { 6, 240, 255, 255 })
  local held = {}
  local seen = {}
  for _, id in ipairs(Run.cards) do
    if not seen[id] then seen[id] = true; held[#held + 1] = id end
  end
  centered(76, #Run.cards == 0 and "No cards yet." or ("Cards held: " .. #Run.cards), 16, { 190, 200, 230, 255 })
  for i, id in ipairs(held) do
    local d = Cards.by_id[id]
    local rar = Cards.rarity[d.rarity]
    local col = (i - 1) % 2
    local row = math.floor((i - 1) / 2)
    local x, y = 40 + col * 450, 108 + row * 66
    local c = rar.color
    nova.ui.rect(x, y, 430, 58, { c[1], c[2], c[3], 255 })
    nova.ui.rect(x + 2, y + 2, 426, 54, { 12, 14, 34, 255 })
    nova.ui.sprite("icons", x + 28, y + 29, { frame = Cards.families[d.family].icon, scale = 2.4 })
    nova.ui.text(x + 54, y + 6, d.name .. (Run.count(id) > 1 and ("  x" .. Run.count(id)) or ""), { font = "pixel", size = 15, color = { c[1], c[2], c[3], 255 } })
    nova.ui.text(x + 54, y + 26, d.text, { font = "pixel", size = 11, color = { 220, 226, 245, 255 }, width = 366 })
  end
  centered(486, string.format("scrap %d    seed %d", J.scrap, Run.seed or 0), 14, { 190, 200, 230, 255 })
  H.prompt(380, 508, "start", "resume")
end

-- A warning mark that is off the screen: a magenta "!" on the edge where it is.
function H.warn_arrows()
  for _, e in ipairs(nova.all("warn")) do
    local x, y = nova.cam.to_screen(e.x, e.y)
    if x < 0 or x > W or y < 0 or y > HH then
      local cx, cy = math.max(24, math.min(W - 24, x)), math.max(40, math.min(HH - 40, y))
      local on = math.floor(e.t * 10) % 2 == 0
      nova.ui.rect(cx - 12, cy - 12, 24, 24, { 255, 43, 214, on and 255 or 150 })
      nova.ui.text(cx - 12, cy - 9, "!", { font = "pixel", size = 18, color = { 255, 255, 255, 255 }, align = "center", width = 24 })
    end
  end
end

-- `scene` has: runner, state, wave_i, def (waves), banner_t, near_card, paused.
function H.draw(scene)
  for _, e in ipairs(nova.all("hurtable")) do if e.hud then e:hud() end end
  for _, c in ipairs(nova.all("card")) do c:hud() end
  local r = scene.runner
  if not r then return end
  if scene.paused then pause_page(); return end       -- (text is always over rectangles: nothing else may be drawn under the page)
  bars(r)
  H.warn_arrows()
  if scene.state == "fight" and scene.def and scene.wave_i > 0 then
    centered(14, string.format("WAVE %d / %d", scene.wave_i, #scene.def.waves), 16, { 255, 43, 214, 255 })
  end
  if scene.entry then
    local e = scene.entry
    nova.ui.text(0, 34, string.format("ROOM %d / 8", math.min(e.index, 8)), { font = "pixel", size = 13, color = { 190, 200, 230, 255 }, align = "center", width = W, shadow = true })
    if e.kind == "elite" and e.mark and scene.state == "fight" then
      local m = require("data.elites").marks[e.mark]
      centered(52, "ELITE: " .. m.name .. ". " .. m.text, 13, { 255, 228, 94, 255 })
    end
  end
  local eye = require("lib.workbench").eye_text(Run)      -- LULLABY's Eye (a Workbench upgrade)
  if eye then nova.ui.text(560, 52, eye, { font = "pixel", size = 12, color = { 6, 240, 255, 255 }, align = "right", width = 380, shadow = true }) end
  if scene.banner_t and scene.banner_t > 0 then
    local a = math.min(1, scene.banner_t / 0.5) * 255
    centered(64, "ROOM CLEARED", 32, { 6, 240, 255, a })
    centered(104, "+" .. (scene.paid or 0) .. " scrap", 18, { 255, 255, 255, a })
  end
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
    nova.ui.rect(0, 0, W, HH, { 5, 6, 15, a * 0.8 })
    centered(230, "PRINTED AGAIN", 40, { 6, 240, 255, a })
    centered(284, "LULLABY: hold still. I have you. Mostly.", 18, { 255, 43, 214, a })
  end
end

return H
