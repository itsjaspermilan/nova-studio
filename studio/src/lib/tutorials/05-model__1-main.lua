-- file: main.lua
-- Shows a 3D model ("robot", made in the model editor) playing its "spin" animation.
local t = 0

function update(dt)
  t = t + dt
end

function draw()
  nova.clear(30, 40, 60)
  nova.camera(2.2, 1.8, 2.6, 0, 0.6, 0, 50)   -- where the camera is, what it looks at, how wide it sees
  nova.light { dir = { -0.4, -1, -0.3 } }      -- which way the sun shines
  nova.model("robot", 0, 0, 0, { clip = "spin", time = t })
end
