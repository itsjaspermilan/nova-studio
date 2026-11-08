-- Juice: drawing in the world with the camera, screen shake, particle puffs, sparkles, confetti, and numbers that float up from where something
-- happened. The camera is the framework's (nova.cam); the play scene sets it every step, on whole screen pixels so that the tiles stay sharp.
local fx = {}

local opts = { sx = 1, sy = 1, rotation = 0, frame = 0, color = { 255, 255, 255, 255 } }

-- draw a picture centred on a world point; o: sx, sy (picture scale, default 0.5: the art is made at twice its size), rotation, frame, color, alpha
function fx.draw(id, x, y, o)
  local cx, cy = nova.cam.position()
  local w, h = nova.view()
  opts.sx = o and o.sx or 0.5
  opts.sy = o and o.sy or 0.5
  opts.rotation = o and o.rotation or 0
  opts.frame = o and o.frame or 0
  local c, src = opts.color, o and o.color
  c[1], c[2], c[3] = src and src[1] or 255, src and src[2] or 255, src and src[3] or 255
  c[4] = math.floor((src and src[4] or 255) * (o and o.alpha or 1))
  nova.sprite(id, x - (cx - w * 0.5), y - (cy - h * 0.5), opts)
end

-- a world point on the screen (for text, which is drawn in the interface layer)
function fx.to_screen(x, y)
  local cx, cy = nova.cam.position()
  local w, h = nova.view()
  return x - (cx - w * 0.5), y - (cy - h * 0.5)
end

-- ---- shake: a trauma that decays; the offset is applied to the camera
fx.trauma = 0
function fx.shake(amount) fx.trauma = math.min(1, fx.trauma + amount) end
function fx.shake_offset(t, dt)
  fx.trauma = math.max(0, fx.trauma - dt * 1.8)
  local s = fx.trauma * fx.trauma * 14
  return math.sin(t * 53) * s, math.cos(t * 41) * s * 0.8
end
fx.calm = false -- (the computer runner turns the effects down)

-- ---- particles
function fx.dust(x, y, n, color, spread)
  if fx.calm then return end
  nova.burst(x, y, { count = n or 6, image = "fx/puff", size = { 10, 18 }, size_end = 0.2, life = { 0.25, 0.45 }, speed = { 30, 110 },
    angle = -math.pi / 2, spread = spread or 2.6, gravity = -40, drag = 3, color = color or { 255, 255, 255, 230 }, color_end = color and { color[1], color[2], color[3], 0 } or { 255, 255, 255, 0 }, depth = -5 })
end

function fx.sparkle(x, y, n, color)
  if fx.calm then return end
  nova.burst(x, y, { count = n or 8, image = "fx/sparkle", size = { 10, 22 }, size_end = 0, life = { 0.3, 0.6 }, speed = { 60, 180 }, spin = { -6, 6 },
    color = color or { 255, 240, 140, 255 }, color_end = color and { color[1], color[2], color[3], 0 } or { 255, 230, 120, 0 }, drag = 2.5, depth = -20 })
end

local CONFETTI = { { 255, 90, 110 }, { 255, 200, 50 }, { 80, 200, 255 }, { 110, 220, 120 }, { 190, 120, 255 } }
function fx.confetti(x, y, n)
  if fx.calm then return end
  for i = 1, #CONFETTI do
    local c = CONFETTI[i]
    nova.burst(x, y, { count = math.ceil((n or 40) / #CONFETTI), image = "fx/confetti", size = { 8, 14 }, life = { 1.0, 1.8 }, speed = { 220, 520 },
      angle = -math.pi / 2, spread = 1.6, gravity = 700, drag = 1.6, spin = { -10, 10 }, color = { c[1], c[2], c[3], 255 }, color_end = { c[1], c[2], c[3], 0 }, depth = -30 })
  end
end

function fx.ring(x, y, color)
  if fx.calm then return end
  nova.burst(x, y, { count = 1, image = "ui/ring", size = 20, size_end = 5, life = 0.3, speed = 0, color = color or { 255, 255, 255, 220 }, color_end = { 255, 255, 255, 0 }, depth = -25 })
end

-- ---- floating text (+1, a combo): kept here and drawn by the play scene's interface
fx.floaters = {}
function fx.float(x, y, text, color, size)
  fx.floaters[#fx.floaters + 1] = { x = x, y = y, text = text, color = color or { 255, 255, 255 }, size = size or 24, t = 0 }
end
function fx.update(dt)
  for i = #fx.floaters, 1, -1 do
    local f = fx.floaters[i]
    f.t = f.t + dt
    f.y = f.y - dt * 50
    if f.t > 0.9 then table.remove(fx.floaters, i) end
  end
end
function fx.draw_floaters(ui)
  for _, f in ipairs(fx.floaters) do
    local sx, sy = fx.to_screen(f.x, f.y)
    local pop = f.t < 0.12 and (0.6 + f.t / 0.12 * 0.5) or (f.t < 0.2 and 1.1 - (f.t - 0.12) / 0.08 * 0.1 or 1)
    local a = f.t > 0.6 and 1 - (f.t - 0.6) / 0.3 or 1
    local old = ui.alpha
    ui.alpha = a
    local size = math.floor(f.size * pop)
    ui.text(sx - ui.width(f.text, size) / 2, sy - size / 2, f.text, size, f.color, { outline = true })
    ui.alpha = old
  end
end

function fx.reset()
  fx.floaters = {}
  fx.trauma = 0
end

return fx
