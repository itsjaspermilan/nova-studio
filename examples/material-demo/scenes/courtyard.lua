-- The courtyard: three models lit by their glTF materials (bricks with a normal map, a gold orb, a glowing lamp) and two custom
-- shaders (water and a dissolving pillar). A turns a post effect on and off; the camera drifts slowly round.
local Courtyard = nova.scene {}

function Courtyard:enter()
  self.t = 0
  self.post = false
  nova.light { dir = { -0.55, -0.8, -0.35 }, color = { 255, 244, 225 }, ambient = { 92, 102, 122 } }
  nova.shadows { radius = 12, strength = 0.55 }
end

function Courtyard:update(dt)
  self.t = self.t + dt
  if nova.input.pressed("a") then
    self.post = not self.post
    if self.post then nova.post("postcard", { params = { 0.35 } }) else nova.post() end
  end
end

function Courtyard:draw()
  local a = math.sin(self.t * 0.15) * 0.45
  nova.camera(math.sin(a) * 9.5, 3.2, math.cos(a) * 9.5, 0, 1, 0, 50)
  nova.model("ground", 0, 0, 0, { shadow = false })
  -- a warm point light by the lamp
  nova.point_light(1.4, 1.2, 2.2, { radius = 5, color = { 255, 150, 60 } })
end

function Courtyard:draw_ui()
  local w = nova.view()
  nova.ui.text(0, 22, "Materials and shaders", { font = "display", size = 34, align = "center", width = w, shadow = true })
  nova.ui.text(0, 64, "normal-mapped bricks   gold   a glowing lamp   water shader   dissolve shader      A: post effect", { size = 16, align = "center", width = w, shadow = true })
end

return Courtyard
