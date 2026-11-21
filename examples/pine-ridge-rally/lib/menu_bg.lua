-- What is behind the menus (2026-11-08): no longer the live circuit and car, but a plain dark ground with checkered flags drifting
-- across it on the diagonal. The garage (2026-11-21) has a 3D stage instead: one car at a time on a showroom floor (lib/garage.lua).
local ui = require("lib.ui")

local bg = {}

local C = ui.color
local FAR_X = 1000           -- the garage's stage stands far from the title scene's own road, so none of its scenery is in view
local EYE = { FAR_X, 6, 34 }
local AT = { FAR_X, 0.4, 0 }
local FOV = 30
local TAN = math.tan(math.rad(FOV) / 2)

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

-- ---- the car select's stage (2026-11-21) ---------------------------------------------------------------------------------------------
-- One car on the showroom floor, large, turning on the spot; the camera looks down at it from in front, tipped a little more or less
-- by the right stick. The car stands where the stage's middle (STAGE_X, STAGE_Y: UI units) is on the screen, to the right of the details.
local STAGE_DIST = 15
local STAGE_Y = 222
local FLOOR = { scale = 1, shadow = false, tint = { 150, 156, 172 } }
local CAR = { ry = 0, scale = 1, shadow = false }

-- `shown` is a list of { car, off }: the cars on the stage and how far each is from the middle (in screens: 1 is a screen away, so a car
-- sliding in or out is at an `off` between 0 and 1). `turn` is the car's turn (radians), `tilt` the camera's extra pitch.
function bg.stage(shown, turn, tilt, make)
  local w = nova.view()
  local pitch = 0.2 + tilt
  local unit = 2 * TAN * STAGE_DIST / 540
  local stage_x = w * 0.6
  local tx = FAR_X - (stage_x - w / 2) * unit
  local ty = 0.55 + (STAGE_Y - 270) * unit
  nova.camera(tx, ty + STAGE_DIST * math.sin(pitch), STAGE_DIST * math.cos(pitch), tx, ty, 0, FOV)
  nova.fog { color = { C.ground[1], C.ground[2], C.ground[3] }, near = 14, far = 46 }
  nova.light { dir = { -0.3, -0.9, -0.55 }, color = { 175, 175, 185 }, ambient = { 78, 82, 94 } }
  -- the floor under the cars, a wide grey slab that the fog takes into the dark
  nova.model("ground_night", FAR_X, 0.14, 0, FLOOR)
  local mc = make and make.color or { 255, 255, 255 }
  nova.billboard("puff", FAR_X, 1.6, -5, 15, { color = { mc[1], mc[2], mc[3], 60 } })
  for _, s in ipairs(shown) do
    local car = s.car
    local x = FAR_X + s.off * w * unit
    local length = car.length or 4.5
    local px = 340 + 130 * math.min(1, math.max(0, (length - 3.5) / 5))
    local scale = px * unit / length
    CAR.ry, CAR.scale = turn, scale
    nova.model(car.id, x, 0, 0, CAR)
    nova.point_light(x, 5.5, 4, { radius = 15, color = { 255, 236, 205 }, dir = { 0, -1, -0.35 }, angle = 55 })
  end
end

return bg
