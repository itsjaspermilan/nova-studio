-- Pip Tansy, a young rabbit, the one-rabbit radio station at No. 7 Kettle Creek Road: fiddling at the foot of his mast.
-- He walks lightly: quick short steps (a shorter stride than the clip's, so a quicker beat), a springy bounce with his feet
-- lifted high, his big ears trailing behind and flopping with every step, his head bobbing.
local GAIT = {
  bounce = { { 0, 0 }, { 1.6, 0.034 } }, lift = { { 0, 0.03 }, { 1.6, 0.06 } }, stance = { { 0, 0.58 }, { 1.6, 0.47 } },
  roll = { { 0, 0 }, { 1.6, 0.02 } }, sway = { { 0, 0 }, { 1.6, 0.1 } }, lean = { { 0, 0 }, { 1.6, 0.08 } },
  follow = {
    { part = "head", stiffness = 110, damping = 0.35, max = 0.4, rx = { fwd = -0.007, up = 0.007 }, ry = { look = 0.6 }, rz = { side = 0.008 } },
    { part = "ear_l", stiffness = 32, damping = 0.22, max = 0.75, rx = { fwd = -0.03, speed = -0.14, up = -0.012 }, rz = { side = 0.02, up = -0.006, cycle = 0.05 } },
    { part = "ear_r", stiffness = 32, damping = 0.22, max = 0.75, rx = { fwd = -0.03, speed = -0.14, up = -0.012 }, rz = { side = 0.02, up = 0.006, cycle = 0.05 } },
    { part = "tail", stiffness = 150, damping = 0.3, max = 0.3, rx = { up = -0.004 } },
    { part = "hand_l", stiffness = 140, damping = 0.35, max = 0.35, swing = { "arm_l", "hand_l" }, rx = { swing = 0.03 } },
    { part = "hand_r", stiffness = 140, damping = 0.35, max = 0.35, swing = { "arm_r", "hand_r" }, rx = { swing = 0.03 } },
  },
}
return require("lib.resident")("pip", { walk = 1.6, stride = 0.6, ease = 14, gait = GAIT, chest = 0.3, notice = 10, mailbox = "mailbox_7", work_sound = "tinker", work_every = 1.1, work_range = 30, work_volume = 0.35 })
