-- A patch of trees in free roam: `kinds` the models, `trees` each tree's [dx, dz, which kind, turn in hundredths of a radian, size in
-- hundredths] from this object. lib/woods.lua plants them.
local woods = require("lib.woods")

local Woods = nova.entity { visible = false }

function Woods:create()
  woods.add({ x = self.x, z = self.z, kinds = self.kinds or {}, trees = self.trees or {} })
  self:destroy()
end

return Woods
