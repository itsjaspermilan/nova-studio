-- A light in the street: no picture, placed in the scene file like any object (tools/gutter.mjs puts one at every lamp and vending machine it paints), its props saying what it is:
--   color = { r, g, b }, radius (world units across the pool), squash (how flat the pool lies on the ground, 0.7),
--   intensity, flicker (0 to 1), and glow (the radius of a soft halo that adds light where the lamp or the sign is, glow_y above).
-- The light only shows in a scene with nova.ambient2d (lib/look.lua).
local Light = nova.entity {
  depth = -100000, -- (the halo is drawn after everything else in the street)
  settings = {
    color = { { 255, 255, 255 }, type = "color" },
    radius = { 120 },
    squash = { 0.7 },
    intensity = { 1.5 },
    flicker = { 0 },
    glow = { 0 },
    glow_y = { 0 },
  },
}

function Light:create()
  self.light = { radius = self.radius, radius_y = self.radius * self.squash, color = self.color, intensity = self.intensity, flicker = self.flicker }
  self.halo = { self.color[1], self.color[2], self.color[3], 150 }
  self.halo_opts = { blend = "add", soft = true, ry = self.glow * 0.8 }
end

function Light:draw()
  nova.Entity.draw(self) -- the light itself (the entity's `light`)
  if self.glow > 0 then
    local x, y = nova.cam.to_screen(self.x, self.y - self.glow_y)
    nova.circle(x, y, self.glow, self.halo, self.halo_opts)
  end
end

return Light
