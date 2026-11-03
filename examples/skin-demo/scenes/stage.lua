-- The stage: grass, sky, a low sun with shadows, a camera drifting round two walkers that walk on the spot.
local Stage = nova.scene {}

function Stage:enter()
  self.t = 0
  nova.light { dir = { -0.5, -1, -0.45 }, color = { 255, 240, 214 }, ambient = { 96, 104, 126 } }
  nova.shadows { radius = 10, strength = 0.5 }
  nova.sky { top = { 90, 150, 225 }, horizon = { 200, 225, 240 } }
  nova.fog { color = { 200, 225, 240 }, near = 20, far = 120 }
  self.bendy:play_clip("walk")
  self.stiff:play_clip("walk")
end

function Stage:update(dt)
  self.t = self.t + dt
end

function Stage:draw()
  local a = self.t * 0.25
  nova.camera(math.sin(a) * 6.5, 1.8, math.cos(a) * 6.5, 0, 0.9, 0, 45)
  nova.model("ground", 0, 0, 0, { shadow = false })
end

function Stage:draw_ui()
  local w = nova.view()
  nova.ui.text(0, 24, "Skinned limbs", { font = "display", size = 34, align = "center", width = w, shadow = true })
  nova.ui.text(0, 66, "left: the arms and legs bend at the elbows and knees      right: the same model, stiff limbs", { size = 17, align = "center", width = w, shadow = true })
end

return Stage
