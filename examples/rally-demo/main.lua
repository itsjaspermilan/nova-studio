-- Rally Demo: the smallest real Nova project. A 3D car on a field, a 2D sky behind it
-- and a native-resolution HUD in front. Drive with W/S + A/D, the arrow keys, a gamepad,
-- or touch (drag the left half to steer, hold the right half to accelerate).
-- Edit this file while the game runs: it reloads when you save.

local car = { x = 0, z = 0, heading = 0, speed = 0 }
local clouds = {}
local crates = {}
local idle = 0

function init()
  nova.clear(130, 178, 232)
  for i = 1, 14 do
    clouds[i] = { x = (i * 83) % 1100, y = 14 + (i * 41) % 120, size = 0.7 + (i % 4) * 0.25, speed = 5 + (i % 5) * 3 }
  end
  -- A ring of crates around the start, placed with simple maths: no editor needed yet.
  for i = 1, 40 do
    local angle = i / 40 * math.pi * 2
    local radius = 22 + (i % 3) * 5
    crates[i] = { x = math.cos(angle) * radius, z = math.sin(angle) * radius, turn = i * 0.7 }
  end
end

function update(dt)
  local steer = nova.input.axis("steer")
  local throttle = nova.input.axis("throttle")
  local brake = nova.input.axis("brake")

  -- With no input for a second the car drives a circle, so a fresh run shows motion.
  if steer == 0 and throttle == 0 and brake == 0 then idle = idle + dt else idle = 0 end
  if idle > 1 then steer, throttle = 0.4, 0.5 end

  car.speed = car.speed + (throttle * 16 - brake * 24 - car.speed * 0.35) * dt
  car.speed = math.max(car.speed, -6)
  car.heading = car.heading + steer * (car.speed / 7) * dt
  car.x = car.x + math.sin(car.heading) * car.speed * dt
  car.z = car.z + math.cos(car.heading) * car.speed * dt

  local w = nova.view()
  for _, c in ipairs(clouds) do
    c.x = c.x + c.speed * dt
    if c.x > w + 60 then c.x = -60 end
  end

  local fx, fz = math.sin(car.heading), math.cos(car.heading)
  nova.camera(car.x - fx * 9, 4.6, car.z - fz * 9, car.x + fx * 3, 1.0, car.z + fz * 3)
end

function draw()
  -- World layer: drawn at the project's world resolution (540 high by default).
  for _, c in ipairs(clouds) do
    nova.sprite("sprites/cloud.png", c.x, c.y, { scale = c.size, color = { 255, 255, 255, 235 } })
  end
  nova.model("models/ground.glb", 0, 0, 0)
  for _, c in ipairs(crates) do
    nova.model("models/crate.glb", c.x, 0, c.z, { ry = c.turn })
  end
  nova.model("models/car.glb", car.x, 0, car.z, { ry = car.heading })

  -- UI layer: always native resolution, so text stays sharp.
  local w, h = nova.view()
  local cx, cy = w - 70, h - 70
  nova.ui.sprite("sprites/gauge.png", cx, cy)
  local speed = string.format("%d", math.abs(car.speed) * 3.6 // 1)
  nova.ui.text(cx - nova.ui.text_width(speed, 3) / 2, cy - 22, speed, { scale = 3 })
  nova.ui.text(cx - nova.ui.text_width("KM/H", 2) / 2, cy + 8, "KM/H", { scale = 2, color = { 190, 190, 190 } })
  nova.ui.text(12, 12, "RALLY DEMO", { scale = 3 })
end
