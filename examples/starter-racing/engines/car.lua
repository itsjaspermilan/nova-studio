-- The engine "car" (engine_make): a 2-litre four petrol turbo, raspy, idle 850 to 7200 rpm.
-- Its loops are sounds/eng_car_<band>.wav (throttle down) and eng_car_off_<band>.wav (lifted); `cycles` are their bands (cycles x 80.75 rpm).
-- Play it with the runtime's library: local engine_sound = require("nova.engine_sound"); local e = engine_sound.new(require("engines.car"))
-- and every step e:update(dt, { rpm = rpm, throttle = 0..1, speed = metres a second, surface = "road" }). Change any number here.
return {
  sound = "car",
  idle = 850,
  max = 7200,
  cycles = { 10, 15, 22, 30, 44, 62, 90 },
  rise = 26,
  fall = 19,
  load_rise = 30,
  load_fall = 22,
  gain = 1,
  quiet = 0.4,
  off = 0.55,
  wander = 0.002,
  limiter = "cut",
  shift = "quick",
  shift_cut = 0.1,
  shift_volume = 0.5,
  turbo = { level = 0.8, lo = 0.75, hi = 1.2, from = 1600, full = 3200 },
  bov = 0.7,
  pops = 1,
}
