-- Ground and ledges. Something solid to stand on; its size is set in the scene editor. A ledge (oneway) can be jumped up through, and dropped through with down and jump.
local rect = require("lib.view").rect
local Platform = nova.entity {
  tags = { "solid" },
  velocity = false,
  settings = {
    w = { 160, min = 8, max = 4000, step = 4, help = "How wide it is" },
    h = { 24, min = 4, max = 600, step = 4, help = "How tall it is" },
    oneway = { false, help = "A ledge: jump up through it, stand on it, drop down through it" },
    kind = { "ground", choices = { "ground", "rock", "metal" }, help = "How it looks" },
  },
}

local LOOK = {
  ground = { top = { 100, 170, 70 }, mid = { 110, 82, 54 }, edge = { 80, 58, 40 } },
  rock = { top = { 150, 150, 160 }, mid = { 110, 110, 122 }, edge = { 80, 80, 92 } },
  metal = { top = { 170, 180, 200 }, mid = { 90, 100, 124 }, edge = { 60, 70, 90 } },
}

function Platform:draw()
  local c = LOOK[self.kind] or LOOK.ground
  if self.oneway then
    rect(self.x, self.y, self.w, 6, c.top)
    rect(self.x, self.y + 6, self.w, math.min(self.h, 8) - 6 + 6, c.edge)
    return
  end
  rect(self.x, self.y, self.w, self.h, c.mid)
  rect(self.x, self.y, self.w, 8, c.top)
  rect(self.x, self.y + 8, self.w, 3, c.edge)
end

return Platform
