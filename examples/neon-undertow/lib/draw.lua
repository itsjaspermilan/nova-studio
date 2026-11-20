-- Marks drawn on the ground (the tells): a ring, a lane, a cross. World coordinates in, drawn with the camera applied.
local D = {}

-- A ring of dots round (wx, wy) with radius r, `dots` of them, each `size` big.
function D.ring(wx, wy, r, color, size, dots)
  size, dots = size or 5, dots or 28
  for i = 0, dots - 1 do
    local a = i / dots * math.pi * 2
    local x, y = nova.cam.to_screen(wx + math.cos(a) * r, wy + math.sin(a) * r * 0.8)
    nova.rect(x - size / 2, y - size / 2, size, size, color)
  end
end

-- A filled soft disc under a mark (squashed a little, as ground seen from above), made of a few stacked rows.
function D.disc(wx, wy, r, color)
  local cx, cy = nova.cam.to_screen(wx, wy)
  local ry = r * 0.8
  for i = -4, 4 do
    local y = i / 4
    local half = r * math.sqrt(1 - y * y)
    nova.rect(cx - half, cy + y * ry - ry / 8, half * 2, ry / 4 + 1, color)
  end
end

-- A band from (x1, y1) to (x2, y2) in the world, `w` wide: one stretched, turned square (sprites/solid), so a see-through colour stays
-- see-through (squares laid side by side would add up to solid).
function D.lane(x1, y1, x2, y2, w, color)
  local len = math.sqrt((x2 - x1) ^ 2 + (y2 - y1) ^ 2)
  local mx, my = nova.cam.to_screen((x1 + x2) / 2, (y1 + y2) / 2)
  nova.sprite("solid", mx, my, { w = len, h = w, rotation = math.atan(y2 - y1, x2 - x1), color = color })
end

return D
