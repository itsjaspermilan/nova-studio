-- The ground: models/land.glb (land_make), a grid of squares 480 m across under the whole course, textured with grass.
local Land = nova.entity { model = "land", static = true }

function Land:draw()
  nova.model("land", 0, 0, 0, { shadow = false })
end

return Land
