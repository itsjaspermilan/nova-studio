-- Marks drawn on the ground (the tells): a ring, a lane, a disc. World coordinates in, drawn with the camera applied.
-- Every mark ADDS light (blend "add", never darkened by the night): a tell glows over the floor instead of covering it, so it reads on
-- the dark asphalt and on the brightest puddle alike. (A mark with an alpha of 0 to 255 adds that share of its colour.)
local D = {}

local ADD = { blend = "add", lit = false }
D.ADD = ADD

-- A ring of dots round (wx, wy) with radius r, `dots` of them, each `size` big.
function D.ring(wx, wy, r, color, size, dots)
  size, dots = size or 5, dots or 28
  for i = 0, dots - 1 do
    local a = i / dots * math.pi * 2
    local x, y = nova.cam.to_screen(wx + math.cos(a) * r, wy + math.sin(a) * r * 0.8)
    nova.rect(x - size / 2, y - size / 2, size, size, color, ADD)
  end
end

-- A filled soft disc under a mark (squashed a little, as ground seen from above).
function D.disc(wx, wy, r, color)
  local cx, cy = nova.cam.to_screen(wx, wy)
  nova.circle(cx, cy, r, color, { soft = true, blend = "add", lit = false, ry = r * 0.8 })
end

-- A band from (x1, y1) to (x2, y2) in the world, `w` wide: one stretched, turned square (sprites/solid), so a see-through colour stays
-- see-through (squares laid side by side would add up to solid).
function D.lane(x1, y1, x2, y2, w, color)
  local len = math.sqrt((x2 - x1) ^ 2 + (y2 - y1) ^ 2)
  local mx, my = nova.cam.to_screen((x1 + x2) / 2, (y1 + y2) / 2)
  nova.sprite("solid", mx, my, { w = len, h = w, rotation = math.atan(y2 - y1, x2 - x1), color = color, blend = "add", lit = false })
end

return D
