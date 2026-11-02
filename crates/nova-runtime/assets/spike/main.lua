-- Rally spike. Lua owns the game rules; the engine owns drawing and the heavy loops.
-- Drive: W/S or up/down, A/D or left/right, gamepad stick + triggers, or touch
-- (drag on the left half to steer, hold the right half to accelerate).
-- With no input for a moment the car drives a circle so captures show motion.

local car = { x = 0, z = 0, heading = 0, speed = 0 }
local idle = 0

function init()
  nova.spike.set_sprites(10000)
  nova.spike.set_cars(400)
  nova.log("main.lua ready")
end

function update(dt)
  local steer = nova.input.axis("steer")
  local throttle = nova.input.axis("throttle")
  local brake = nova.input.axis("brake")

  if steer == 0 and throttle == 0 and brake == 0 then
    idle = idle + dt
  else
    idle = 0
  end
  if idle > 1.0 then
    steer, throttle = 0.45, 0.55
  end

  car.speed = car.speed + (throttle * 16 - brake * 24 - car.speed * 0.35) * dt
  if car.speed < -6 then car.speed = -6 end
  car.heading = car.heading + steer * (car.speed / 7) * dt
  car.x = car.x + math.sin(car.heading) * car.speed * dt
  car.z = car.z + math.cos(car.heading) * car.speed * dt
  nova.car.set(car.x, car.z, car.heading)

  local fx, fz = math.sin(car.heading), math.cos(car.heading)
  nova.camera.set(car.x - fx * 9, 4.6, car.z - fz * 9, car.x + fx * 3, 1.0, car.z + fz * 3)
end
