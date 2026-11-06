-- The 3D picture behind the menus: a piece of road with the car standing on it, dressed like the circuit that is chosen (its sky,
-- sun, ground, mountains, road surface and the trees, cacti or snowy pines beside it). The camera sways gently in front of the car.
local horizon = require("lib.horizon")
local looks = require("lib.looks")
local state = require("lib.state")

local backdrop = {}

local view = { x = 0, z = 0 }
local dressing = {}   -- by circuit id: the things beside the road, made once from a fixed seed (the same every time)
local lamp_opts = { ry = 0, shadow = false }
local overlay_opts = { ry = 0, shadow = false }
local SWAY = { pine = 0.03, pine_dark = 0.03, pine_snow = 0.025, birch = 0.035, autumn_tree = 0.035, bush = 0.06, bush_snow = 0.05, dry_bush = 0.08 }

-- A fixed pseudo-random sequence for a circuit, so that its backdrop is always the same.
local function rng(seed)
  local s = seed
  return function()
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  end
end

local function dress(id, look)
  local list = {}
  local r = rng(#id * 977 + id:byte(1) * 31)
  for side = -1, 1, 2 do
    for i = 0, 17 do
      local z = -48 + i * 5.4 + (r() - 0.5) * 2
      local d = 12 + r() * 20
      local kinds = look.trees
      list[#list + 1] = { model = kinds[math.floor(r() * #kinds) + 1], x = side * d, z = z, opts = { ry = r() * 6.28, scale = 0.85 + r() * 0.55, sway = SWAY[kinds[1]] and 0.03 or 0 } }
      if i % 2 == 0 then
        local low = look.low
        list[#list + 1] = { model = low[math.floor(r() * #low) + 1], x = side * (10 + r() * 4), z = z + 2.5, opts = { ry = r() * 6.28, scale = 0.8 + r() * 0.5 } }
      end
    end
    if look.tall then
      for i = 0, 3 do
        list[#list + 1] = { model = look.tall[1], x = side * (40 + i * 9), z = -30 + i * 22 + side * 6, opts = { ry = r() * 6.28, scale = 1 + r() * 0.4 } }
      end
    end
  end
  return list
end

-- The circuit the menus show: the one that is chosen.
local function current()
  local id = state.current_track().id
  return id, looks[id]
end

-- `mode` "title" or "results" picks the camera. Call from the scene's draw().
function backdrop.draw(t, mode, shift)
  local id, look = current()
  local radius, height = 8.5, 2.4
  if mode == "results" then radius, height = 10, 3.0 end
  -- the camera swings a little to and fro in front of the car, a three-quarter view from the front left, never all the way round
  local a = 0.75 + math.sin(t * 0.18) * 0.38
  view.x, view.z = math.sin(a) * radius, math.cos(a) * radius
  -- `shift` metres moves where the camera looks to the left of the car, so that the car sits to the right of the screen (the menus
  -- are on the left): the camera's right is (-fz, fx) for a forward of (fx, fz)
  local fx, fz = -view.x / radius, -view.z / radius
  local s = shift or 0
  nova.camera(view.x, height, view.z, s * fz, 1.0, -s * fx, 48)
  horizon.draw(view.x, view.z, look.horizon)
  -- the road surface of the circuit: the scene file's road is asphalt, so the others are laid over it
  if look.road ~= "road_asphalt" then
    for z = -40, 40, 5 do nova.model(look.road, 0, 0.03 + (z % 10 == 0 and 0 or 0.012), z, overlay_opts) end
  end
  local list = dressing[id]
  if not list then list = dress(id, look); dressing[id] = list end
  for i = 1, #list do
    local d = list[i]
    nova.model(d.model, d.x, 0, d.z, d.opts)
  end
  if look.night then
    for z = -40, 40, 20 do
      lamp_opts.ry = 0
      nova.model("lamp", 7.2, 0, z, lamp_opts)
      lamp_opts.ry = math.pi
      nova.model("lamp", -7.2, 0, z + 10, lamp_opts)
    end
    -- some light on the car, since the moon gives little
    nova.point_light(-2.5, 4.5, 3, { radius = 14, color = { 255, 214, 150 } })
    nova.point_light(3.5, 4, -3, { radius = 12, color = { 160, 190, 255 } })
  end
end

-- The sun, sky and fog of the chosen circuit (call when the screen is entered and whenever the circuit changes).
function backdrop.light()
  local _, look = current()
  nova.scenery.range = 140 -- (the engine draws the scene file's scenery around the camera by itself)
  nova.light { dir = look.sun.dir, color = look.sun.color, ambient = look.sun.ambient }
  nova.sky(look.sky)
  nova.fog { color = look.sky.horizon, near = 60, far = 230 }
  state.apply_look(look)
end

function backdrop.leave()
  nova.sky(nil)
  nova.fog(nil)
  nova.look()
  nova.wind()
end

return backdrop
