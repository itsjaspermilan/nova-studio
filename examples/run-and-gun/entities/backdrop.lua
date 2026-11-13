-- The far background: hills that move slower than the ground, so the level looks deep. Put one in the scene (anywhere).
local floor = math.floor

local Backdrop = nova.entity { depth = 1000, velocity = false }

local function hill(x, base, w, h, c)
  -- a stepped mountain
  local steps = 6
  for i = 0, steps - 1 do
    local k = i / steps
    nova.rect(floor(x + w * k / 2), floor(base - h * (1 - k)), floor(w * (1 - k)), floor(h / steps + 1), c)
  end
end

function Backdrop:draw()
  local cx = nova.cam.position()
  for layer = 1, 2 do
    local par = layer == 1 and 0.25 or 0.5
    local period = layer == 1 and 520 or 380
    local c = layer == 1 and { 110, 150, 205 } or { 80, 120, 170 }
    local off = (-(cx * par)) % period
    for i = -1, floor(960 / period) + 1 do
      local wx = i * period + off -- (screen places: the hills do not move with the ground)
      hill(wx, 460, period * 0.9, layer == 1 and 220 or 150, c)
    end
  end
end

return Backdrop
