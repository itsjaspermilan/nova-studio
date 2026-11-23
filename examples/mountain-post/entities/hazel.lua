-- Hazel Brock, a bear, retired carpenter, No. 3 Fern Lane: at her sawhorses until someone comes up the lane. At rest her face is
-- "dry" (half-lidded, unimpressed); it changes with what she says.
-- She walks heavily: slower (1.25 m/s), a long rolling stride with the hips swinging and rolling over each foot, little bounce,
-- her big head steady, her round ears and stubby tail barely moving.
local GAIT = {
  bounce = { { 0, 0 }, { 1.25, 0.012 } }, lift = { { 0, 0.02 }, { 1.25, 0.03 } }, stance = { { 0, 0.62 }, { 1.25, 0.56 } },
  roll = { { 0, 0 }, { 1.25, 0.075 } }, sway = { { 0, 0 }, { 1.25, 0.16 } }, shift = { { 0, 0 }, { 1.25, 0.016 } }, lean = { { 0, 0 }, { 1.25, 0.04 } },
  follow = {
    { part = "head", stiffness = 70, damping = 0.6, max = 0.35, rx = { fwd = -0.004, up = 0.003 }, ry = { look = 0.5, cycle = -0.05 }, rz = { side = 0.004, cycle = -0.04 } },
    { part = "ear_l", stiffness = 200, damping = 0.5, max = 0.2, rx = { fwd = -0.004, up = -0.002 } },
    { part = "ear_r", stiffness = 200, damping = 0.5, max = 0.2, rx = { fwd = -0.004, up = -0.002 } },
    { part = "tail", stiffness = 120, damping = 0.5, max = 0.3, ry = { cycle = 0.12 } },
    { part = "hand_l", stiffness = 90, damping = 0.5, max = 0.3, swing = { "arm_l", "hand_l" }, rx = { swing = 0.025 } },
    { part = "hand_r", stiffness = 90, damping = 0.5, max = 0.3, swing = { "arm_r", "hand_r" }, rx = { swing = 0.025 } },
  },
}
return require("lib.resident")("hazel", { walk = 1.25, ease = 9, gait = GAIT, chest = 0.3, notice = 9, mailbox = "mailbox_3", rest = "dry", work_sound = "saw", work_every = 0.62, work_range = 55, work_volume = 0.55 })
