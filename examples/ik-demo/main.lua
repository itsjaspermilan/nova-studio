-- Two-bone inverse kinematics (nova.ik): a limb of three parts hangs from a shoulder and its end is put on a target that
-- moves around. The elbow bends toward the pole (in front). Run it: nova run examples/ik-demo
local SCALE = 2                       -- how big the limb is drawn
local SHOULDER = { x = 0, y = 4, z = 0 }
local t = 0

function update(dt)
  t = t + dt
  nova.camera(7, 4.5, 9, 0, 2, 0, 50)
  nova.sky { top = { 120, 170, 230 }, horizon = { 220, 235, 250 } }
  nova.light { dir = { -0.4, -1, -0.5 }, color = { 255, 240, 225 }, ambient = { 100, 105, 120 } }

  -- the target in the world: a circle that rises and falls, sometimes out of reach (the limb then stretches toward it)
  local r = 2.0 + 1.6 * math.sin(t * 0.5)
  local wx, wy, wz = r * math.cos(t), 2.4 + 0.9 * math.sin(t * 1.3), r * math.sin(t)
  -- nova.ik wants it in the limb's own space: take the shoulder away and undo the scale
  local target = { x = (wx - SHOULDER.x) / SCALE, y = (wy - SHOULDER.y) / SCALE, z = (wz - SHOULDER.z) / SCALE }
  local pole = { x = 0, y = -0.5, z = 2 }                 -- the elbow bends toward the front (+z)
  local parts, reached = nova.ik("limb", nil, { "upper", "lower", "hand" }, target, pole)

  nova.model("limb", SHOULDER.x, SHOULDER.y, SHOULDER.z, { scale = SCALE, parts = parts })
  nova.model("limb", wx, wy, wz, { scale = 0.3, tint = reached and { 120, 255, 120 } or { 255, 120, 120 } })   -- the target
end
