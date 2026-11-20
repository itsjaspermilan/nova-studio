-- One car on a plain floor in the game's own renderer, from the camera in shot.lua (written by scripts/rally/car-show.mjs).
local Show = nova.scene {}
local shot = require("shot")
function Show:enter()
  -- (shot.ground: the floor's colour for the paint to mirror and be lit by from below, as a course's land is in the game)
  nova.sky { top = { 60, 110, 200 }, horizon = { 205, 222, 238 }, ground = shot.ground }
  nova.light { dir = { -0.5, -0.75, -0.45 }, color = { 255, 246, 230 }, ambient = { 96, 106, 124 } }
  nova.shadows { radius = 14, strength = 0.55 }
  if not shot.ground then pcall(nova.graphics, { ibl = true }) end
end
function Show:draw()
  local c = shot
  nova.camera(c.eye[1], c.eye[2], c.eye[3], c.at[1], c.at[2], c.at[3], c.fov or 35)
  nova.model("ground", 0, 0, 0, { shadow = false })
  nova.model(c.model, 0, 0, 0, { ry = c.ry or 0, dirt = c.dirt, dirt_color = c.dirt_color, dirt_on_top = c.dirt_on_top })
end
return Show
