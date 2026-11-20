-- The card lab: a bare room with named training dummies and a wall to bounce shots off, for the routes that prove each card and
-- each enemy. Camera, HUD and pause are the fight room's; this room has no waves (the routes spawn what they test).
local Base = require("lib.fightroom")
local Lab = nova.scene(Base, { room = "test_lab" })

function Lab:enter()
  Base.enter(self)
  self.state = "lab"       -- (no doors to shut, no waves)
  self.def = { waves = {}, scrap = 0 }
end

return Lab
