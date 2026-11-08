-- file: main.lua
-- Shows the robot from the model lesson with the shader in shaders/wave.wgsl.
local t = 0

function update(dt)
  t = t + dt
end

function draw()
  nova.clear(20, 24, 40)
  nova.camera(2.2, 1.8, 2.6, 0, 0.6, 0, 50)
  nova.light { dir = { -0.4, -1, -0.3 } }
  nova.model("robot", 0, 0, 0, { clip = "spin", time = t, shader = "wave" })
end
