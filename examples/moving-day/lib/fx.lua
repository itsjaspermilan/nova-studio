-- Particles that make the flat feel alive: dust when furniture slides or bumps, sparkles and hearts when a wish comes true, confetti for a finished
-- flat. Everything is cosmetic: the rules never read it.
local Fx = {}

local CONFETTI = { { 255, 110, 110 }, { 255, 206, 80 }, { 96, 200, 230 }, { 140, 220, 120 }, { 200, 140, 255 } }
local function rgba(c, a) return { c[1], c[2], c[3], a or 255 } end

function Fx.dust(x, z, n, dx, dz)
  nova.burst(x, 0.08, z, { sprite = "fx/puff", count = n or 6, life = { 0.35, 0.7 }, speed = { 0.4, 1.4 }, dir = { -(dx or 0), 0.5, -(dz or 0) }, spread = 2.2, gravity = 0.3,
    size = 0.32, size_end = 2.2, color = { 236, 226, 210, 170 }, color_end = { 236, 226, 210, 0 }, drag = 3, max = 40 })
end

function Fx.sparkle(x, y, z, color, n)
  nova.burst(x, y, z, { sprite = "fx/spark", count = n or 12, life = { 0.5, 1.0 }, speed = { 0.8, 2.4 }, spread = 2.4, gravity = -1.5, size = 0.3, size_end = 0.1,
    color = rgba(color or { 255, 236, 150 }), color_end = rgba(color or { 255, 236, 150 }, 0), max = 40 })
end

function Fx.hearts(x, y, z, n)
  nova.burst(x, y, z, { sprite = "fx/heart", count = n or 4, life = { 0.8, 1.3 }, speed = { 0.5, 1.2 }, dir = { 0, 1, 0 }, spread = 0.9, gravity = 0.6, size = 0.34, size_end = 0.7,
    color = { 255, 120, 140, 255 }, color_end = { 255, 120, 140, 0 }, drag = 1.5, max = 20 })
end

function Fx.confetti(x, y, z, n)
  for i = 1, 3 do
    nova.burst(x, y, z, { sprite = "fx/confetti", count = math.floor((n or 36) / 3), life = { 1.0, 1.7 }, speed = { 2.5, 5.0 }, spread = 1.4, gravity = -8, size = 0.18, size_end = 0.6,
      color = rgba(CONFETTI[(i * 2 + math.random(0, 2)) % #CONFETTI + 1]), color_end = { 255, 255, 255, 0 }, drag = 0.6, max = 60 })
  end
end

return Fx
