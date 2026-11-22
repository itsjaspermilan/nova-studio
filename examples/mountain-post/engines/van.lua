-- The engine "van" (engine_make): a 1-litre three petrol, smooth, idle 820 to 5200 rpm.
-- Its loops are sounds/eng_van_<band>.wav (throttle down) and eng_van_off_<band>.wav (lifted); `cycles` are their bands (cycles x 80.75 rpm).
-- Play it with the runtime's library: local engine_sound = require("nova.engine_sound"); local e = engine_sound.new(require("engines.van"))
-- and every step e:update(dt, { rpm = rpm, throttle = 0..1, speed = metres a second, surface = "road" }). Change any number here.
return {
  sound = "van",
  idle = 820,
  max = 5200,
  cycles = { 10, 14, 22, 30, 44, 64 },
  rise = 20,
  fall = 14,
  load_rise = 24,
  load_fall = 18,
  gain = 0.7,
  quiet = 0.45,
  off = 0.5,
  wander = 0.004,
  limiter = "soft",
  shift = "stick",
  shift_cut = 0.22,
  shift_volume = 0.45,
}
