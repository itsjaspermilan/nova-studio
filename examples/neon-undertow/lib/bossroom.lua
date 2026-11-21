-- The boss room (Mother Coil's arena): a fight room whose fight is one boss. The doors shut, she wakes (her name and a bark), the boss
-- track starts, and when she is gone: a long burst, the big scrap pay, a guaranteed rare card choice (data/bosses.lua), the district
-- track again, and the exit door. The camera, pause and carry are the fight room's (lib/fightroom.lua), so are the cards.
local P = require("data.player")
local Ty = require("lib.type")
local J = require("lib.juice")
local Run = require("lib.run")
local R = require("data.rooms")
local Bosses = require("data.bosses")
local HUD = require("lib.hud")
local Field = require("lib.field")
local Base = require("lib.fightroom")
local Wipe = require("lib.wipe")
local Banner = require("lib.banner")
local Prompt = require("lib.prompt")
local Flow = require("data.flow")

local Boss = nova.scene(Base, { room = "gutter.boss", boss = "mother_coil", look = "yard" })

local W = 960
local function centered(y, text, role, color)
  Ty.text(0, y, text, role, { color = color, align = "center", width = W })
end

function Boss:enter()
  Base.enter(self)
  self.B = Bosses[self.boss]
  self.def = { waves = {}, scrap = self.B.scrap, guarantee = self.B.guarantee }
  self.state, self.t = "boss_intro", 0
  self.shut_text, self.clear_text = "the boss door shuts", "the boss is beaten"   -- (the fight rooms' own log lines count fights)
  self.coil = nova.first("boss")
  Field.clear()
  nova.log("the boss room: " .. self.B.name)
end

-- The boss's full name card comes with the room's tab, BEFORE the fight: the doors shut and she wakes when it has been up (Flow.boss_delay).
function Boss:announce()
  Base.announce(self)
  local B = Bosses[self.boss]
  Banner.show("boss", { text = B.name:upper(), sub = Flow.boss_subtitles[self.boss] or B.title })
end

function Boss:update(dt)
  Base.update(self, dt)        -- (the wipe, the pause, the clock, the camera, and the cleared / cards states)
  if self.paused or Wipe.busy() or self.held then return end
  local s = self.state
  if s == "boss_intro" then
    if self.t >= R.doors_shut_at + Flow.boss_delay then
      self:shut_doors()
      self.state, self.t = "boss", 0
      nova.music.play(P.music.boss, { volume = P.music.boss_volume })
      if self.coil then self.coil:wake() end
    end
  elseif s == "boss" then
    self.fight_t = self.fight_t + dt
  end
end

-- (called by the boss when the last burst is over) The pay, the cards, the district track again.
function Boss:boss_dead()
  self.state, self.t = "won", 0
  Field.clear()
  nova.music.play(P.music.track, { volume = P.music.volume })
  nova.log("the boss is down")
end

function Boss:draw_ui()
  self:draw_boss()
  if not self.paused then Prompt.draw(); Banner.draw() end
  Wipe.draw()
end

function Boss:draw_boss()
  HUD.draw(self)
  if self.paused then return end
  local c = self.coil
  if not (c and c:is_alive()) or self.state == "cleared" then return end
  if c.state == "dormant" then return end
  -- her bar and name, her barks, the drum's window
  local B = self.B
  local x, y, w = 200, 74, 560
  nova.ui.rect(x - 3, y - 3, w + 6, 20, { 255, 43, 214, 255 })
  nova.ui.rect(x, y, w, 14, { 5, 6, 15, 240 })
  nova.ui.rect(x, y, w * math.max(0, c.hp) / c.max_hp, 14, c.open and { 6, 240, 255, 255 } or { 255, 43, 214, 255 })
  nova.ui.rect(x + w * B.half - 1, y - 3, 2, 20, { 255, 255, 255, 255 })
  Ty.text(x, y - 24, B.name:upper(), "label", { color = { 255, 255, 255, 255 } })
  Ty.text(x + w - 330, y - 20, B.title, "small", { color = { 190, 200, 230, 255 }, align = "right", width = 330 })
  if c.bark_t > 0 and c.bark_text then
    centered(y + 24, "\"" .. c.bark_text .. "\"", "small", { 255, 228, 94, math.min(1, c.bark_t / 0.4) * 255 })
  end
  if c.open then
    local left = math.max(0, B.drum.window - c.t)
    local on = math.floor(c.t * 8) % 2 == 0
    nova.ui.rect(250, 436, 460, 52, { 5, 6, 15, 215 })
    centered(442, "THE DRUM IS OPEN: HIT IT!", "big", on and { 6, 240, 255, 255 } or { 255, 255, 255, 255 })
    nova.ui.rect(380, 474, 200, 8, { 40, 46, 80, 240 })
    nova.ui.rect(380, 474, 200 * left / B.drum.window, 8, { 6, 240, 255, 255 })
  end
end

return Boss
