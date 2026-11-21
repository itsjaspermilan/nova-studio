-- A room with no fight: the stranger's room (6) and the walk-through room (shop and bank). The doors are
-- open from the start. Everything else (the camera, the pause, the carry from room to room) is the fight room's (lib/fightroom.lua).
local P = require("data.player")
local Ty = require("lib.type")
local J = require("lib.juice")
local Run = require("lib.run")
local HUD = require("lib.hud")
local Talk = require("lib.talk")
local Shop = require("lib.shop")
local ShopData = require("data.shop")
local Strangers = require("data.strangers")
local Base = require("lib.fightroom")
local Wipe = require("lib.wipe")
local Banner = require("lib.banner")
local Prompt = require("lib.prompt")

local Quiet = nova.scene(Base, { room = "gutter.stranger", look = "indoors" })

local W, H = 960, 540
local function centered(y, text, role, color)
  Ty.text(0, y, text, role, { color = color, align = "center", width = W })
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

function Quiet:say(ok, text)
  self.toast, self.toast_t = text, 2.4
  nova.sound.play(ok and "buy" or "empty", { volume = ok and P.sfx.buy or P.sfx.empty })
end

-- The things of this room that take A, as prompt items (lib/prompt.lua): the stranger, or the shop's counters and the bank.
local TINT = { heal = { 255, 63, 164 }, reroll = { 53, 230, 255 }, jinx = { 255, 228, 94 }, bank = { 255, 190, 120 } }
function Quiet:usables()
  local r, items = self.runner, {}
  if self.kind == "stranger" and self.npc then
    local S, n = Strangers[self.who], self.npc
    items[1] = { key = "npc", npc = n, x = n.x, y = n.y - 112, name = S.name:upper(), color = { 255, 63, 164 }, no_cue = false,
      line = self.talked and "Say bye." or ("Talk. " .. S.title:sub(1, 1):upper() .. S.title:sub(2) .. "."),
      near = Prompt.box_distance(r.x, r.y, n.x - 18, n.y - 14, n.x + 18, n.y) }
  elseif self.kind == "walk" then
    for _, c in ipairs(nova.all("counter")) do
      local d = ShopData[c.item]
      local line = d.text
      local price
      if c.item == "bank" then line = string.format("%d scrap = %d keys.", J.scrap, J.scrap // d.rate) else price = d.price .. " scrap" end
      items[#items + 1] = { key = c.item, counter = c, x = c.x, y = c.y - 118, name = d.name:upper(), line = line, price = price, color = TINT[c.item], no_cue = true,
        near = Prompt.box_distance(r.x, r.y, c.x - c.w / 2, c.y - c.h / 2, c.x + c.w / 2, c.y + c.h / 2) }
    end
  end
  return items
end

function Quiet:update(dt)
  if self:frozen(dt) then return end
  local r = self.runner
  if nova.input.pressed("start") and r and r.state ~= "dead" and not Talk.active then self:toggle_pause() end
  if self.paused then return end
  Banner.tick(dt)
  J.tick()
  self.t = self.t + dt
  Run.time = Run.time + dt
  self.toast_t = math.max(0, self.toast_t - dt)
  self:camera(dt)
  if not r or r.state == "dead" then return end
  nova.pause(Talk.active)        -- (the world holds still while someone talks; this scene still runs)
  local target = self:prompts(dt, self:usables(), not Talk.active)
  if self.kind == "stranger" then
    if Talk.active then
      Talk.update(r)
      if not Talk.active then nova.pause(false); self.talked = true; self.toast, self.toast_t = Talk.chosen.note, 3 end
    elseif target and target.key == "npc" and nova.input.pressed("interact") then
      Prompt.used("npc")
      if self.talked then
        self.toast, self.toast_t = Strangers[self.who].after, 2.4
      else
        Talk.start(self.who)
      end
    end
  elseif self.kind == "walk" then
    self.by = target and target.counter or nil
    if self.by and nova.input.pressed("interact") then
      Prompt.used(target.key)
      local ok, text = Shop.buy(self.by.item, r)
      self:say(ok, text)
    end
  end
end

function Quiet:draw_ui()
  self:draw_quiet()
  if not self.paused then Prompt.draw(); Banner.draw() end
  Wipe.draw()
end

function Quiet:draw_quiet()
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
      nova.ui.sprite(S.sprite, x + 70, y + 86, { scale = 1.6, frame = 0 })
      local nw = Ty.text(x + 150, y + 8, S.name, "name", { color = { 255, 43, 214, 255 } })
      Ty.text(x + 150 + nw + 12, y + 14, S.title, "small", { color = { 190, 200, 230, 255 } })
      if Talk.stage == "lines" then
        Ty.text(x + 150, y + 48, Talk.lines[Talk.i], "body", { color = { 255, 255, 255, 255 }, width = w - 180 })
        HUD.prompt(x + w - 140, y + h - 34, "interact", "next")
      else
        for i, c in ipairs(S.choices) do
          local bx = x + 150 + (i - 1) * 300
          local on = Talk.sel == i
          nova.ui.rect(bx - 3, y + 50, 276, 56, on and { 6, 240, 255, 255 } or { 70, 80, 120, 255 })
          nova.ui.rect(bx, y + 53, 270, 50, { 12, 14, 34, 255 })
          Ty.text(bx, y + 66, c.label, "label", { color = on and { 255, 255, 255, 255 } or { 150, 160, 190, 255 }, align = "center", width = 270 })
        end
        Ty.text(x + 150, y + 118, S.choices[Talk.sel].note, "small", { color = { 190, 200, 230, 255 }, width = w - 180 })
        HUD.prompt(x + w - 140, y + h - 34, "interact", "choose")
      end
    end
  end
  -- (the stranger, the counters and the doors are marked by prompts and cues now, not by labels: lib/prompt.lua)
  if self.toast_t > 0 and self.toast then
    centered(268, self.toast, "label", { 255, 255, 255, math.min(1, self.toast_t / 0.4) * 255 })
  end
end

return Quiet
