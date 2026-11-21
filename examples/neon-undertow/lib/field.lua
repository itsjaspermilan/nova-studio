-- The magnetised floor of Mother Coil's second phase: vertical stripes (data/bosses.lua, stripes). While `armed`, a shot inside a stripe
-- turns `omega` radians a second (the stripe's sign is its polarity: left, right, left) and a Rat-drone inside one is pulled `pull`
-- units a second along it (up, down, up). Nothing else reads the stripes but the shot, entities/coil_field.lua and the drawing.
local F = { stripes = {}, armed = false, top = 0, bottom = 0 }

function F.clear() F.stripes, F.armed = {}, false end

function F.set(list, top, bottom)
  F.stripes, F.top, F.bottom = list, top, bottom
end

-- The stripe a point is in, or nil.
function F.at(x, y)
  if not F.armed or y < F.top or y > F.bottom then return nil end
  for _, s in ipairs(F.stripes) do
    if x >= s.x0 and x <= s.x1 then return s end
  end
  return nil
end

function F.omega(x, y)
  local s = F.at(x, y)
  return s and s.omega or 0
end

return F
