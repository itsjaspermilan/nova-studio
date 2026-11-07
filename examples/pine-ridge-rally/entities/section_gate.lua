-- A place where one section of a rally stage ends and the next begins (the scene file also puts banners and flags there).
local stage = require("lib.stage")

local SectionGate = nova.entity { visible = false, i = 1 }

function SectionGate:create()
  stage.add(self.i, self.x, self.z)
  self:destroy()
end

return SectionGate
