-- Warnings drawn on the ground (the tells): a shape that is exactly the hit area, pulsing, with a brighter part that fills it as the hit
-- comes nearer, a bright edge and (for lanes and boxes) chevrons running the way the hit will go. Every one is ADDED to the light, so
-- it glows over the dark street and reads on a bright puddle. The size you pass is the size that hurts: nothing here adds to it.
--   T.disc(x, y, r, k, t, color)             a circle of radius r (blasts, slams, fire)
--   T.box(x, y, w, h, dx, dy, k, t, color)   a box with its top-left corner at (x, y), the hit going the way (dx, dy) (a swing)
--   T.lane(x1, y1, x2, y2, w, k, t, color)   a band from one point to another, w wide (a charge, a tram, a volley)
-- k is 0 to 1: how near the hit is; t is seconds, for the pulse. color: { r, g, b } (the game's warning colours: Look.zone.color
-- magenta for enemies, orange for blasts and fire, cyan for the Tout).
local D = require("lib.draw")
local V = require("lib.vfx")

local T = {}
T.magenta = { 255, 43, 214 }
T.orange = { 255, 138, 43 }
T.cyan = { 6, 240, 255 }

local ADD = { blend = "add", lit = false }
local function col(c, a) return { c[1], c[2], c[3], math.max(0, math.min(255, a)) } end
local function pulse(t, speed) return 0.5 + 0.5 * math.sin(t * (speed or 16)) end

function T.disc(x, y, r, k, t, c)
  c = c or T.magenta
  k = math.max(0, math.min(1, k))
  local p = pulse(t)
  local cx, cy = nova.cam.to_screen(x, y)
  nova.circle(cx, cy, r, col(c, 30 + 26 * p), { blend = "add", lit = false, ry = r * 0.8 })                    -- the area, faint
  nova.sprite("fx_tell", cx, cy, { frame = 1, w = r * 2.1, h = r * 1.68, color = col(c, 70 + 60 * p), blend = "add", lit = false })   -- hatched
  if k > 0.02 then
    nova.circle(cx, cy, r * k, col(c, 55 + 45 * p), { blend = "add", lit = false, ry = r * k * 0.8 })          -- the part that fills up
    nova.sprite("fx_tell", cx, cy, { frame = 2, w = r * 2.1 * k, h = r * 1.68 * k, color = col(c, 230), blend = "add", lit = false })
  end
  nova.sprite("fx_tell", cx, cy, { frame = 0, w = r * 2.1, h = r * 1.68, color = col(c, 255), blend = "add", lit = false })     -- the edge
  nova.sprite("fx_tell", cx, cy, { frame = 0, w = r * 2.1, h = r * 1.68, color = { 255, 255, 255, 90 + 90 * p }, blend = "add", lit = false })
end

-- the chevrons of a band from (x1, y1) to (x2, y2), running the way it points
local function chevrons(x1, y1, x2, y2, w, t, c, alpha)
  local len = math.sqrt((x2 - x1) ^ 2 + (y2 - y1) ^ 2)
  if len < w then return end
  local size = math.min(w * 0.8, 44)
  local gap = size * 1.5
  local n = math.max(1, math.floor(len / gap))
  local ang = math.atan(y2 - y1, x2 - x1)
  for i = 0, n - 1 do
    local f = ((i + (t * 1.6) % 1) / n)
    local px, py = x1 + (x2 - x1) * f, y1 + (y2 - y1) * f
    local sx, sy = nova.cam.to_screen(px, py)
    nova.sprite("fx_chev", sx, sy, { w = size, h = size, rotation = ang, color = col(c, alpha * math.sin(math.pi * f)), blend = "add", lit = false })
  end
end

function T.lane(x1, y1, x2, y2, w, k, t, c)
  c = c or T.magenta
  k = math.max(0, math.min(1, k))
  local p = pulse(t)
  local dx, dy = x2 - x1, y2 - y1
  local len = math.sqrt(dx * dx + dy * dy)
  if len < 1 then return end
  D.lane(x1, y1, x2, y2, w, col(c, 26 + 24 * p))                                                  -- the area, faint
  if k > 0.02 then D.lane(x1, y1, x1 + dx * k, y1 + dy * k, w, col(c, 60 + 40 * p)) end          -- the part that fills up
  local nx, ny = -dy / len * w / 2, dx / len * w / 2
  V.line(x1 + nx, y1 + ny, x2 + nx, y2 + ny, 3, col(c, 255), 0)                                   -- the two edges
  V.line(x1 - nx, y1 - ny, x2 - nx, y2 - ny, 3, col(c, 255), 0)
  V.line(x1 + nx, y1 + ny, x1 - nx, y1 - ny, 3, col(c, 255), 0)                                   -- and the ends
  V.line(x2 + nx, y2 + ny, x2 - nx, y2 - ny, 3, col(c, 255), 0)
  chevrons(x1, y1, x2, y2, w, t, c, 150 + 80 * p)
end

function T.box(x, y, w, h, dx, dy, k, t, c)
  c = c or T.magenta
  k = math.max(0, math.min(1, k))
  local p = pulse(t)
  local sx, sy = nova.cam.to_screen(x, y)
  nova.rect(sx, sy, w, h, col(c, 30 + 26 * p), ADD)                                                -- the area, faint
  -- the part that fills up grows from the owner's side to the far edge
  if k > 0.02 then
    local fx, fy, fw, fh = sx, sy, w, h
    if dx > 0 then fw = w * k elseif dx < 0 then fw = w * k; fx = sx + w - fw elseif dy > 0 then fh = h * k else fh = h * k; fy = sy + h - fh end
    nova.rect(fx, fy, fw, fh, col(c, 60 + 44 * p), ADD)
  end
  local e = 3
  nova.rect(sx, sy, w, e, col(c, 255), ADD)                                                         -- the edge
  nova.rect(sx, sy + h - e, w, e, col(c, 255), ADD)
  nova.rect(sx, sy + e, e, h - 2 * e, col(c, 255), ADD)
  nova.rect(sx + w - e, sy + e, e, h - 2 * e, col(c, 255), ADD)
  nova.rect(sx + e, sy + e, w - 2 * e, 1.5, { 255, 255, 255, 80 + 70 * p }, ADD)
  -- chevrons along the hit's own way, through the middle
  local mx, my = x + w / 2, y + h / 2
  local cw = (dx ~= 0) and h or w
  chevrons(mx - dx * (w / 2 - 1), my - dy * (h / 2 - 1), mx + dx * (w / 2 - 1), my + dy * (h / 2 - 1), cw * 0.9, t, c, 140 + 80 * p)
end

return T
