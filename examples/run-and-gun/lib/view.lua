-- Drawing in the world with the camera, zoomed. nova.rect puts a rectangle on the screen, so a level that scrolls takes the camera's place off first, and
-- the zoom makes everything a little bigger (so the screen shows less of the level).
local view = { zoom = 1.3 }

function view.rect(x, y, w, h, color)
  local cx, cy = nova.cam.position()
  local vw, vh = nova.view()
  local z = view.zoom
  -- (corners rounded, so that two rectangles that touch still touch)
  local x0, y0 = math.floor((x - cx) * z + vw * 0.5 + 0.5), math.floor((y - cy) * z + vh * 0.5 + 0.5)
  local x1, y1 = math.floor((x + w - cx) * z + vw * 0.5 + 0.5), math.floor((y + h - cy) * z + vh * 0.5 + 0.5)
  nova.rect(x0, y0, math.max(1, x1 - x0), math.max(1, y1 - y0), color)
end

-- A picture from a sprite sheet: `frame` of `id`, centred on x, y (in the level), turned round if `flip`, with a colour that multiplies it (to fade or tint), and
-- `scale` times its own size (its size in the level is its size in pixels times scale).
function view.sprite(id, x, y, frame, flip, color, scale)
  local cx, cy = nova.cam.position()
  local vw, vh = nova.view()
  local z = view.zoom * (scale or 1)
  nova.sprite(id, math.floor((x - cx) * view.zoom + vw * 0.5 + 0.5), math.floor((y - cy) * view.zoom + vh * 0.5 + 0.5), { frame = frame, scale = z, sx = flip and -z or z, color = color })
end

-- A whole picture (or the part of it in `src` = { x, y, w, h }, in its pixels), its top left at x, y in the level and w by h in size there.
function view.image(id, x, y, w, h, src, color)
  local cx, cy = nova.cam.position()
  local vw, vh = nova.view()
  local z = view.zoom
  local x0, y0 = math.floor((x - cx) * z + vw * 0.5 + 0.5), math.floor((y - cy) * z + vh * 0.5 + 0.5)
  local x1, y1 = math.floor((x + w - cx) * z + vw * 0.5 + 0.5), math.floor((y + h - cy) * z + vh * 0.5 + 0.5)
  if x1 < 0 or x0 > vw or y1 < 0 or y0 > vh then return end
  nova.sprite(id, x0, y0, { anchor = "topleft", w = math.max(1, x1 - x0), h = math.max(1, y1 - y0), src = src, color = color })
end

-- Half of what the screen shows, in the level's units.
function view.half_w() return nova.view() / 2 / view.zoom end
function view.half_h() local _, vh = nova.view() return vh / 2 / view.zoom end

return view
