-- The run summary, at the win and at death: rooms cleared, time, scrap banked as keys, cards held. Interact starts a new run (room 1,
-- a new seed). The Den (where a death will lead) comes in a later slice.
local Run = require("lib.run")
local Meta = require("lib.meta")
local HUD = require("lib.hud")

local Summary = nova.scene {}

function Summary:enter()
  nova.cam.set(480, 270)
  nova.pause(false)
  self.t = 0
  self.s = Run.summary or { result = "dead", cleared = 0, time = 0, keys = 0, cards = 0, card_names = {} }
  nova.log("summary: " .. self.s.result)
end

function Summary:update(dt)
  self.t = self.t + dt
  if self.t > 0.8 and nova.input.pressed("interact") then nova.goto_scene("run_start") end
end

function Summary:draw_ui()
  local s = self.s
  local win = s.result == "win"
  nova.ui.rect(0, 0, 960, 540, { 5, 6, 15, 255 })
  nova.ui.text(0, 60, win and "RUN COMPLETE" or "PRINTED AGAIN", { font = "pixel", size = 44, color = win and { 6, 240, 255, 255 } or { 255, 43, 214, 255 }, align = "center", width = 960, shadow = true })
  nova.ui.text(0, 118, win and "The boss door is behind you. Mother Coil comes next slice." or "LULLABY: hold still. I have you. Mostly.", { font = "pixel", size = 16, color = { 190, 200, 230, 255 }, align = "center", width = 960 })
  local m = math.floor(s.time / 60)
  local rows = {
    { "Rooms cleared", string.format("%d of 8", s.cleared) },
    { "Time", string.format("%d:%02d", m, math.floor(s.time - m * 60)) },
    { "Scrap banked as keys", tostring(s.keys) },
    { "Keys held", tostring(Meta.keys) },
    { "Cards held", tostring(s.cards) },
  }
  for i, r in ipairs(rows) do
    local y = 180 + (i - 1) * 34
    nova.ui.text(250, y, r[1], { font = "pixel", size = 20, color = { 255, 255, 255, 255 } })
    nova.ui.text(510, y, r[2], { font = "pixel", size = 20, color = { 255, 228, 94, 255 }, align = "right", width = 200 })
  end
  nova.ui.text(120, 370, #s.card_names > 0 and table.concat(s.card_names, ", ") or "no cards", { font = "pixel", size = 14, color = { 255, 43, 214, 255 }, align = "center", width = 720 })
  HUD.prompt(380, 450, "interact", "run again")
end

return Summary
