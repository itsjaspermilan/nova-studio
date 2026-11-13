-- Drawing in the world with the camera: nova.rect puts a rectangle on the screen, so a level that scrolls takes the camera's place off first.
local view = {}

function view.rect(x, y, w, h, color)
  local cx, cy = nova.cam.position()
  local vw, vh = nova.view()
  nova.rect(x - (cx - vw * 0.5), y - (cy - vh * 0.5), w, h, color)
end

return view
