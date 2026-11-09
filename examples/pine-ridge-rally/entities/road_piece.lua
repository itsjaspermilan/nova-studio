-- A whole road as one placed object (free roam's map: scenes/roam.scene.json). The road models are long ribbons made by the track
-- generator, so they are drawn every frame as they are (not as scenery, which is drawn by the distance to its middle) and cast no
-- shadow, as in a race. Each road model has its own small entity file that names the model (entities/road_pine_ridge.lua...), so the
-- scene editor shows the road where it lies.
return function(model)
  local Road = nova.entity { model = model }
  local opts = { shadow = false }
  function Road:draw() nova.model(model, self.x, 0, self.z, opts) end
  return Road
end
