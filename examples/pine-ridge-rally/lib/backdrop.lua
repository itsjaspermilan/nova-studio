-- The 3D picture behind the menus: the showroom the scene file built, the car turning, a camera drifting round it.
local horizon = require("lib.horizon")

local backdrop = {}

local view = { x = 0, z = 0 }

-- `mode` "title" or "results" picks the camera. Call from the scene's draw().
function backdrop.draw(t, mode, shift)
  local radius, height, speed = 8.5, 2.6, 0.12
  if mode == "results" then radius, height, speed = 11, 3.2, 0.07 end
  local a = t * speed + 0.6
  view.x, view.z = math.sin(a) * radius, math.cos(a) * radius
  -- `shift` metres moves where the camera looks to the left of the car, so that the car sits to the right of the screen (the menus
  -- are on the left): the camera's right is (-fz, fx) for a forward of (fx, fz)
  local fx, fz = -view.x / radius, -view.z / radius
  local s = shift or 0
  nova.camera(view.x, height, view.z, s * fz, 1.0, -s * fx, 48)
  horizon.draw(view.x, view.z, "forest")
end

function backdrop.light()
  nova.scenery.range = 140 -- (the engine draws the scene file's scenery around the camera by itself)
  nova.light { dir = { -0.5, -1, -0.35 }, color = { 230, 220, 196 }, ambient = { 78, 88, 112 } }
end

function backdrop.leave() end

return backdrop
