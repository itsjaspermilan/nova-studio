-- Two cameras for the same game: third person (behind and above the player, swinging round with the right stick) and
-- first person (at the player's head, turning with the right stick). The framework has no camera helper, so this is it.
local state = require("lib.state")

local camera = { yaw = 0, eye = { x = 0, y = 8, z = 10 } }

local function lerp(a, b, t) return a + (b - a) * t end

--- Moves the camera with the right stick and puts it behind (or in) the player.
function camera.update(dt, player)
  camera.yaw = camera.yaw - nova.input.axis("look_x") * 2.4 * dt
  local sy, cy = math.sin(camera.yaw), math.cos(camera.yaw)
  local want
  if state.view == "first" then
    want = { x = player.x, y = 1.5, z = player.z }
    camera.eye.x, camera.eye.y, camera.eye.z = want.x, want.y, want.z
    camera.target = { x = player.x - sy * 10, y = 1.3, z = player.z - cy * 10 }
    camera.fov = 75
  else
    want = { x = player.x + sy * 9, y = 8.5, z = player.z + cy * 9 }
    local k = math.min(1, dt * 6)
    camera.eye.x, camera.eye.y, camera.eye.z = lerp(camera.eye.x, want.x, k), lerp(camera.eye.y, want.y, k), lerp(camera.eye.z, want.z, k)
    camera.target = { x = player.x, y = 1, z = player.z }
    camera.fov = 60
  end
end

function camera.apply()
  local e, t = camera.eye, camera.target
  if e and t then nova.camera(e.x, e.y, e.z, t.x, t.y, t.z, camera.fov) end
end

--- The ground direction a stick pushed forward moves the player, for the current camera.
function camera.forward() return -math.sin(camera.yaw), -math.cos(camera.yaw) end

return camera
