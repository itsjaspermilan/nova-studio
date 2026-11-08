-- Water: a flat square drawn with shaders/water.wgsl, see-through (blend). shader_params: ripple speed, ripple size, clarity.
return nova.entity { model = "pool", shader = "water", blend = true, shader_params = { 1.6, 7, 0.72 } }
