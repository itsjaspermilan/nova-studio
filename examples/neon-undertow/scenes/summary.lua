-- The run summary: at a win it is the "DISTRICT CLEARED" screen (the Bloom Labs come in a later build), at death "PRINTED AGAIN". Rooms,
-- time, keys banked (and Loose Change's), who moved into the Den. Interact leaves: back to the Den when the Den's door began the run,
-- else (a run started with `run_start`, for tests and the editor) straight into a new run.
local Run = require("lib.run")
local Ty = require("lib.type")
local Meta = require("lib.meta")
local HUD = require("lib.hud")
local Wipe = require("lib.wipe")
local Flow = require("data.flow")

local Summary = nova.scene {}

function Summary:enter()
  nova.cam.set(480, 270)
  nova.pause(false)
  self.t = 0
  self.s = Run.summary or { result = "dead", cleared = 0, time = 0, keys = 0, cards = 0, card_names = {}, moved = {}, loose = 0 }
  self.to_den = Run.from_den
  nova.log("summary: " .. self.s.result)
end

function Summary:update(dt)
  Wipe.tick(dt)
  self.t = self.t + dt
  if Wipe.busy() then return end        -- (input is ignored while a wipe runs)
  if self.t > 0.8 and nova.input.pressed("interact") then
    if self.to_den then
      -- back to the Den: a wipe, and a short LULLABY line while it holds (data/flow.lua)
      local set = Flow.den_lines[self.s.result == "win" and "win" or "dead"]
      Wipe.go("den", { line = set[math.random(#set)] })
    else
      nova.goto_scene("run_start")
    end
  end
end

local NAMES = { patch = "Patch", old_sal = "Old Sal" }

function Summary:draw_ui()
  local s = self.s
  local win = s.result == "win"
  nova.ui.rect(0, 0, 960, 540, { 5, 6, 15, 255 })
  Ty.text(0, 40, win and "DISTRICT CLEARED" or "PRINTED AGAIN", "banner", { color = win and { 6, 240, 255, 255 } or { 255, 43, 214, 255 }, align = "center", width = 960 })
  Ty.text(0, 100, win and "The Bloom Labs are next, in a later build. Pack a hat." or "LULLABY: I'm printing, I'm printing. Stop dying at me.", "small", { color = { 190, 200, 230, 255 }, align = "center", width = 960 })
  local m = math.floor(s.time / 60)
  local rows = {
    { "Rooms cleared", string.format("%d of 8", s.cleared) },
    { "Time", string.format("%d:%02d", m, math.floor(s.time - m * 60)) },
    { "Keys from cleared rooms", tostring(s.room_keys or 0) },
    { "Scrap banked as keys", tostring(s.keys) },
  }
  if (s.loose or 0) > 0 then rows[#rows + 1] = { "Loose Change kept", string.format("%d keys", s.loose) } end
  rows[#rows + 1] = { "Keys held", tostring(Meta.keys) }
  if win and (s.best or 0) > 0 then rows[#rows + 1] = { "Best time", string.format("%d:%02d", s.best // 60, math.floor(s.best % 60)) } end
  rows[#rows + 1] = { "Cards held", tostring(s.cards) }
  for i, r in ipairs(rows) do
    local y = 150 + (i - 1) * 32
    Ty.text(250, y, r[1], "label", { color = { 255, 255, 255, 255 } })
    Ty.text(510, y, r[2], "label", { color = { 255, 228, 94, 255 }, align = "right", width = 200 })
  end
  Ty.text(120, 390, #s.card_names > 0 and table.concat(s.card_names, ", ") or "no cards", "small", { color = { 255, 43, 214, 255 }, align = "center", width = 720 })
  for i, who in ipairs(s.moved or {}) do
    Ty.text(0, 420 + (i - 1) * 20, (NAMES[who] or who) .. " is moving into the Den.", "body", { color = { 6, 240, 255, 255 }, align = "center", width = 960 })
  end
  HUD.prompt(380, 480, "interact", self.to_den and "back to the Den" or "run again")
  Wipe.draw()
end

return Summary
