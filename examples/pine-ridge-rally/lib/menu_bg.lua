-- What is behind the menus (2026-11-08): no longer the live circuit and car, but a plain dark ground with checkered flags drifting
-- across it on the diagonal, and in the garage a band of steering wheels sliding sideways behind the cars on show. The garage's cars are
-- real models in 3D, each standing behind its card of the grid (the UI is drawn over the 3D picture, so the cards are frames with no
-- fill where the car is).
local ui = require("lib.ui")

local bg = {}

local C = ui.color
local FAR_X = 1000           -- the garage's stage stands far from the title scene's own road, so none of its scenery is in view
local EYE = { FAR_X, 6, 34 }
local AT = { FAR_X, 0.4, 0 }
local FOV = 30

-- The menus' picture: dark, no sky, no fog, no shadows; a soft showroom light for the garage's cars.
function bg.setup()
  nova.sky(nil)
  nova.fog(nil)
  nova.shadows(nil)
  nova.wind()
  nova.clear(C.ground[1], C.ground[2], C.ground[3])
  nova.look()
  nova.light { dir = { -0.35, -0.85, -0.4 }, color = { 150, 150, 160 }, ambient = { 70, 74, 84 } }
  nova.camera(EYE[1], EYE[2], EYE[3], AT[1], AT[2], AT[3], FOV)
end

function bg.leave()
  nova.look()
end

-- ---- the flags (the UI layer, under the menus) ----------------------------------------------------------------------------------
local FLAG_W, FLAG_H = 80, 60
local STEP_X, STEP_Y = 210, 150
local FLAG_COLOUR = { 255, 255, 255, 16 }

-- The dark ground and the flags drifting down and to the right; every other row is set half a step over.
function bg.flags(t)
  local w = nova.view()
  nova.ui.rect(0, 0, w, 540, C.ground)
  local ox, oy = (t * 22) % STEP_X, (t * 14) % (STEP_Y * 2)
  for row = -2, math.ceil(540 / STEP_Y) + 1 do
    local y = row * STEP_Y + oy
    local shift = (row % 2 == 0) and 0 or STEP_X / 2
    for col = -1, math.ceil(w / STEP_X) + 1 do
      local x = col * STEP_X + ox + shift
      nova.ui.sprite("ui/flag", x, y, { anchor = "topleft", w = FLAG_W, h = FLAG_H, color = FLAG_COLOUR })
    end
  end
end

-- ---- the garage (3D) --------------------------------------------------------------------------------------------------------------
-- The camera's own axes, worked out once.
local function sub(a, b) return { a[1] - b[1], a[2] - b[2], a[3] - b[3] } end
local function norm(a) local l = math.sqrt(a[1] ^ 2 + a[2] ^ 2 + a[3] ^ 2); return { a[1] / l, a[2] / l, a[3] / l } end
local function cross(a, b) return { a[2] * b[3] - a[3] * b[2], a[3] * b[1] - a[1] * b[3], a[1] * b[2] - a[2] * b[1] } end
local FWD = norm(sub(AT, EYE))
local RIGHT = norm(cross(FWD, { 0, 1, 0 }))
local UP = cross(RIGHT, FWD)
local TAN = math.tan(math.rad(FOV) / 2)

-- The point in the world `dist` metres in front of the camera that is under screen point (sx, sy) (the UI's units: 540 high), and how many
-- metres one UI unit is there.
function bg.unproject(sx, sy, dist)
  local w = nova.view()
  local aspect = w / 540
  local nx, ny = (sx / w) * 2 - 1, 1 - (sy / 540) * 2
  local kx, ky = nx * TAN * aspect, ny * TAN
  local x = EYE[1] + dist * (FWD[1] + RIGHT[1] * kx + UP[1] * ky)
  local y = EYE[2] + dist * (FWD[2] + RIGHT[2] * kx + UP[2] * ky)
  local z = EYE[3] + dist * (FWD[3] + RIGHT[3] * kx + UP[3] * ky)
  return x, y, z, 2 * TAN * dist / 540
end

-- (a solid model, steering_wheel, dark and a little lighter than the ground: a billboard would be blended over the cars in front of it)
local WHEEL = { scale = 1, rz = 0, shadow = false, tint = { 150, 150, 160 } }
-- Three rows of steering wheels behind the cars, sliding sideways (the middle row the other way) and turning a little as they go.
function bg.wheels(t)
  local w = nova.view()
  local dist = 60
  for row = 0, 2 do
    local sy = 120 + row * 150
    local dir = row == 1 and -1 or 1
    local step = 150
    local off = (t * 26 * dir) % step
    for col = -1, math.ceil(w / step) + 1 do
      local x, y, z, unit = bg.unproject(col * step + off, sy, dist)
      WHEEL.scale = 84 * unit / 1.94
      WHEEL.rz = math.sin(t * 0.8 + col * 0.7 + row) * 0.35
      nova.model("steering_wheel", x, y, z, WHEEL)
    end
  end
end

-- How long each model is, for the size it is shown at (the back of its body, from lib's car table, doubled; trucks and karts differ).
local LENGTH = { car_offroad = 4.15, car_gt = 4.77 } -- metres
local GREY = { 70, 72, 80 }
local SHOWN = { ry = 0, tint = nil, scale = 1, shadow = false }
local POOL = { color = { 255, 214, 160, 70 } }

-- The cars of the garage's grid: `cards` maps a car's index in `list` to the screen rectangle of its card (drawn last frame), `on` is the
-- focused one (it turns on a turntable under a spot light; the rest stand grey and still, each where it stopped), `angles` their turns.
function bg.cars(list, cards, on, angles, dt)
  for i, r in pairs(cards) do
    local car = list[i]
    if car then
      local focused = i == on
      local picture_h = r.h - 24 -- (the name band along the bottom of the card)
      local x, y, z, unit = bg.unproject(r.x + r.w / 2, r.y + picture_h * 0.62, 34)
      local length = LENGTH[car.id] or 4.5
      local scale = math.min(r.w * unit * 0.78 / length, picture_h * unit * 0.5 / 1.6)
      angles[i] = angles[i] or -0.75
      if focused then angles[i] = angles[i] + dt * 0.9 end
      SHOWN.ry, SHOWN.scale = angles[i], scale * (focused and 1.06 or 1)
      SHOWN.tint = (not focused) and GREY or nil
      nova.model(car.id, x, y - 0.35 * scale, z, SHOWN)
      if focused then
        -- the spot light from above and in front, and a warm pool of light behind the car
        nova.point_light(x, y + 4 * scale, z + 2.5 * scale, { radius = 9 * scale, color = { 255, 236, 205 }, dir = { 0, -1, -0.55 }, angle = 46 })
        local bx, by, bz = bg.unproject(r.x + r.w / 2, r.y + picture_h * 0.55, 40)
        nova.billboard("puff", bx, by, bz, r.w * unit * 1.4, POOL)
      end
    end
  end
end

return bg
