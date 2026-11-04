local state = require("lib.state")
local Level = require("lib.level")

-- A platform that moves on a track and carries what stands on it. `kind` is "slide" (along x) or "lift" (up and down).
local Platform = nova.entity { tags = { "platform" }, velocity = false }

local PLATFORMS = {
  slide = { w = 3, d = 3, thick = 0.9, color = { 230, 190, 70 } },
  lift = { w = 3, d = 3, thick = 0.6, color = { 90, 190, 230 } },
}

function Platform:create()
  self.spec = PLATFORMS[self.kind]
  self.t = 0
  self.cx, self.top, self.cz = Level.platform_at(self.kind, 0)
  local s = self.spec
  self.wall = nova.walls.add(self.cx - s.w / 2, self.cz - s.d / 2, self.cx + s.w / 2, self.cz + s.d / 2, self.top - s.thick, self.top)
  self.dx, self.dy, self.dz = 0, 0, 0
end

-- moved by the scene before the player, so the player can be carried by what this frame did
function Platform:advance(dt)
  self.t = self.t + dt
  local cx, top, cz = Level.platform_at(self.kind, self.t)
  self.dx, self.dy, self.dz = cx - self.cx, top - self.top, cz - self.cz
  self.cx, self.top, self.cz = cx, top, cz
  local s = self.spec
  nova.walls.set_box(self.wall, cx - s.w / 2, cz - s.d / 2, cx + s.w / 2, cz + s.d / 2, top - s.thick, top)
end

function Platform:draw()
  local s = self.spec
  -- Kenney's moving block (the slider) and platform (the lift), a metre across: scaled to three
  nova.model(self.kind == "slide" and "block-moving" or "platform", self.cx, self.top - s.thick, self.cz, { scale = 3 })
end

return Platform
