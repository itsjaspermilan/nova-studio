-- The end of slice 2: a banner. (The district chain, the shop and the Den come in later slices.)
local P = require("data.player")
local Ty = require("lib.type")
local J = require("lib.juice")
local Run = require("lib.run")
local Cards = require("data.cards")
local HUD = require("lib.hud")

local End = nova.scene {}

function End:enter()
  nova.cam.set(480, 270)
  nova.pause(false)
  self.t = 0
  nova.log("slice ends here")
end

function End:update(dt)
  self.t = self.t + dt
  if self.t > 1 and nova.input.pressed("interact") then
    Run.active = false
    nova.goto_scene("market_a")
  end
end

function End:draw_ui()
  nova.ui.rect(0, 0, 960, 540, { 5, 6, 15, 255 })
  Ty.text(0, 150, "SLICE ENDS HERE", "banner", { color = { 6, 240, 255, 255 }, align = "center", width = 960, shadow = true })
  Ty.text(0, 214, string.format("2 rooms cleared    scrap %d    cards %d", J.scrap, #Run.cards), "label", { color = { 255, 255, 255, 255 }, align = "center", width = 960 })
  local names = {}
  for _, id in ipairs(Run.cards) do names[#names + 1] = Cards.by_id[id].name end
  Ty.text(120, 252, #names > 0 and table.concat(names, ", ") or "no cards", "small", { color = { 255, 43, 214, 255 }, align = "center", width = 720 })
  HUD.prompt(380, 400, "interact", "again")
end

return End
