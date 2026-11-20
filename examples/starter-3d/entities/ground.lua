-- The ground: ground 24 by 20 m (12 by 10 squares of 2 m), 90 grass, 15 path, 15 paved; 3397 faces, and 40 m of flat grass beyond the edge.
-- solid = true: bodies moved with nova.solid.move walk on it, and the follow camera stays above it. It casts no shadow of its own.
local Ground = nova.entity { model = "ground", solid = true }

function Ground:draw()
  nova.model("ground", self.x, self.y, self.z or 0, { shadow = false })
end

return Ground
