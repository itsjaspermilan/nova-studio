-- A room with no fight: the stranger's room (6) and the walk-through room (shop and bank). The doors are
-- open from the start. Everything else (the camera, the pause, the carry from room to room) is the fight room's (lib/fightroom.lua).
local P = require("data.player")
local J = require("lib.juice")
local Run = require("lib.run")
local HUD = require("lib.hud")
local Talk = require("lib.talk")
local Shop = require("lib.shop")
local ShopData = require("data.shop")
local Strangers = require("data.strangers")
local Base = require("lib.fightroom")

local Quiet = nova.scene(Base, { room = "gutter.stranger" })

local W, H = 960, 540
local function centered(y, text, size, color)
  nova.ui.text(0, y, text, { font = "pixel", size = size, color = color, align = "center", width = W, shadow = true })
end

function Quiet:enter()
  Base.enter(self)
  self.state = "quiet"
  self.kind = self.entry and self.entry.kind or "walk"
  self.toast, self.toast_t = nil, 0
  self.talked = false
  Talk.active, Talk.stage = false, "none"
  for _, d in ipairs(self.doors) do d:open(true) end
  if self.kind == "stranger" then
    local who = self.entry.who or "patch"
    local S = Strangers[who]
    local at = self.points.npc
    self.npc = nova.spawn("stranger", at.x, at.y, { who = who, sprite = S.sprite })
    self.who = who
    nova.log("a stranger waits: " .. S.name)
  end
end

function Quiet:near_counter()
  local r = self.runner
  local best, bd = nil, 112
  for _, c in ipairs(nova.all("counter")) do
    local d = r:distance_to(c)
    if d < bd then best, bd = c, d end
  end
  return best
end

function Quiet:say(ok, text)
  self.toast, self.toast_t = text, 2.4
  nova.sound.play(ok and "buy" or "empty", { volume = ok and P.sfx.buy or P.sfx.empty })
end

function Quiet:update(dt)
  local r = self.runner
  if nova.input.pressed("start") and r and r.state ~= "dead" and not Talk.active then self:toggle_pause() end
  if self.paused then return end
  J.tick()
  self.t = self.t + dt
  Run.time = Run.time + dt
  self.toast_t = math.max(0, self.toast_t - dt)
  self:camera(dt)
  if not r or r.state == "dead" then return end
  nova.pause(Talk.active)        -- (the world holds still while someone talks; this scene still runs)
  if self.kind == "stranger" then
    if Talk.active then
      Talk.update(r)
      if not Talk.active then nova.pause(false); self.talked = true; self.toast, self.toast_t = Talk.chosen.note, 3 end
    elseif r:distance_to(self.npc) < 100 and nova.input.pressed("interact") then
      if self.talked then
        self.toast, self.toast_t = Strangers[self.who].after, 2.4
      else
        Talk.start(self.who)
      end
    end
  elseif self.kind == "walk" then
    self.by = self:near_counter()
    if self.by and nova.input.pressed("interact") then
      local ok, text = Shop.buy(self.by.item, r)
      self:say(ok, text)
    end
  end
end

local function panel(title, lines, prompt_word)
  local x, y, w, h = 150, 330, 660, 156
  nova.ui.rect(x - 3, y - 3, w + 6, h + 6, { 6, 240, 255, 255 })
  nova.ui.rect(x, y, w, h, { 8, 10, 26, 245 })
  nova.ui.text(x + 18, y + 12, title, { font = "pixel", size = 22, color = { 6, 240, 255, 255 }, shadow = true })
  nova.ui.text(x + 18, y + 46, lines, { font = "pixel", size = 16, color = { 255, 255, 255, 255 }, width = w - 36, line_spacing = 1.4 })
  if prompt_word then HUD.prompt(x + w - 150, y + 12, "interact", prompt_word) end
end

function Quiet:draw_ui()
  HUD.draw(self)
  if self.paused then return end
  local r = self.runner
  if not r then return end
  if self.kind == "stranger" then
    local S = Strangers[self.who]
    if Talk.active then
      local x, y, w, h = 90, 300, 780, 190
      nova.ui.rect(x - 3, y - 3, w + 6, h + 6, { 255, 43, 214, 255 })
      nova.ui.rect(x, y, w, h, { 8, 10, 26, 248 })
      nova.ui.sprite(S.sprite, x + 70, y + 86, { scale = 4.5, frame = 0 })
      nova.ui.text(x + 150, y + 12, S.name .. "  " .. S.title, { font = "pixel", size = 18, color = { 255, 43, 214, 255 }, shadow = true })
      if Talk.stage == "lines" then
        nova.ui.text(x + 150, y + 48, Talk.lines[Talk.i], { font = "pixel", size = 17, color = { 255, 255, 255, 255 }, width = w - 180, line_spacing = 1.45 })
        HUD.prompt(x + w - 140, y + h - 34, "interact", "next")
      else
        for i, c in ipairs(S.choices) do
          local bx = x + 150 + (i - 1) * 300
          local on = Talk.sel == i
          nova.ui.rect(bx - 3, y + 50, 276, 56, on and { 6, 240, 255, 255 } or { 70, 80, 120, 255 })
          nova.ui.rect(bx, y + 53, 270, 50, { 12, 14, 34, 255 })
          nova.ui.text(bx, y + 66, c.label, { font = "pixel", size = 18, color = on and { 255, 255, 255, 255 } or { 150, 160, 190, 255 }, align = "center", width = 270 })
        end
        nova.ui.text(x + 150, y + 118, S.choices[Talk.sel].note, { font = "pixel", size = 14, color = { 190, 200, 230, 255 }, width = w - 180 })
        HUD.prompt(x + w - 140, y + h - 34, "interact", "choose")
      end
    elseif r:distance_to(self.npc) < 100 then
      HUD.prompt(380, 440, "interact", self.talked and "say bye" or "talk to " .. S.name)
    end
  elseif self.kind == "walk" then
    centered(96, "THE SHOP AND THE BANK", 26, { 6, 240, 255, 255 })
    for _, c in ipairs(nova.all("counter")) do
      local d = ShopData[c.item]
      local x, y = nova.cam.to_screen(c.x, c.y - 52)
      nova.ui.text(x - 90, y - 18, d.name, { font = "pixel", size = 13, color = { 255, 228, 94, 255 }, align = "center", width = 180, shadow = true })
      nova.ui.text(x - 90, y, c.item == "bank" and "4 : 1" or (d.shut and "shut" or (d.price .. " scrap")), { font = "pixel", size = 12, color = { 255, 255, 255, 255 }, align = "center", width = 180, shadow = true })
    end
    if self.by then
      local d = ShopData[self.by.item]
      local lines = d.shut or d.text
      if self.by.item == "bank" then lines = d.text .. string.format("\nScrap %d -> %d keys. Keys held %d.", J.scrap, J.scrap // d.rate, require("lib.meta").keys) end
      panel(d.name, lines, (not d.shut) and (self.by.item == "bank" and "bank it" or "buy") or nil)
    end
  end
  if self.toast_t > 0 and self.toast then
    centered(268, self.toast, 18, { 255, 255, 255, math.min(1, self.toast_t / 0.4) * 255 })
  end
end

return Quiet
