-- A stone pillar that burns away and comes back: shaders/dissolve.wgsl, with sprites/noise.png deciding which bit goes first.
-- shader_params: how fast (cycles a second), how wide the glowing edge is.
return nova.entity { model = "pillar", shader = "dissolve", shader_textures = { "noise" }, shader_params = { 0.12, 0.06 } }
