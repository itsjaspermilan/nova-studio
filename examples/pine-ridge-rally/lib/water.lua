-- Water in free roam: each `water` object of the scene is a square of water `size` metres across at height `level`, drawn flat (the
-- engine lifts what is drawn near the ground by the hills under it, so the water's model is made 1000 m down and drawn that much up:
-- above the height where things are lifted) with shaders/water.wgsl. The land above the water hides the square where it is not wet.
local water = {}

local list = {}
local opts = { scale = 1, shader = "water", blend = true, shadow = false, params = { 0, 0, 0, 0.82, 0.5, 1, 0, 0 } }

function water.clear() list = {} end
function water.add(w) list[#list + 1] = w end

-- Call from the scene's draw with the camera's place and the sun's height (0 to 1).
function water.draw(cx, cy, cz, sun_up)
  local p = opts.params
  p[1], p[2], p[3], p[5] = cx, cy, cz, sun_up or 0.5
  for _, w in ipairs(list) do
    local half = w.size / 2 + 360
    if math.abs(cx - w.x) < half and math.abs(cz - w.z) < half then
      opts.scale = w.size
      nova.model("water_plane", w.x, w.level + 1000 * w.size, w.z, opts)
    end
  end
end

return water
