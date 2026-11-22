-- The valley's sound: the forest's air everywhere, birds now and then from the trees round you, the creek where you are near it
-- (its sound sits at the nearest point of its bed and fades with distance), Pip's radio faintly by his mast, the chimney's... no,
-- chimneys are silent. The sawing near Hazel's is hers (lib/resident.lua). All at their places, so they pan and fade by distance.
local world = require("lib.world")

local ambience = {}
local playing = {}

function ambience.start(mast)
  ambience.stop()
  playing.air = nova.sound.play("forest_air", { loop = true, volume = 0.42 })
  playing.creek = nova.sound.play("creek_loop", { loop = true, volume = 0.75, at = { 0, -1000, 0 }, range = 70, falloff = "natural" })
  if mast then playing.radio = nova.sound.play("radio_loop", { loop = true, volume = 0.38, at = { mast.x, world.height(mast.x, mast.z) + 1.5, mast.z }, range = 40 }) end
  ambience.bird_t = 1.5
end

function ambience.stop()
  for k, id in pairs(playing) do if id then nova.sound.stop(id, 0.3) end playing[k] = nil end
end

-- Each frame, with the camera's place: the creek's sound moves along its bed to the point nearest you; a bird calls now and then.
function ambience.update(dt, ex, ez, inside_van)
  local w, d, px, pz = world.nearest("water", ex, ez)
  if playing.creek then
    if w and w.id == "creek" then
      nova.sound.set(playing.creek, { at = { px, world.height(px, pz) + 0.5, pz } })
    else
      nova.sound.set(playing.creek, { at = { 0, -1000, 0 } })
    end
  end
  if playing.air then nova.sound.set(playing.air, { volume = inside_van and 0.28 or 0.42 }) end
  ambience.bird_t = (ambience.bird_t or 2) - dt
  if ambience.bird_t <= 0 then
    ambience.bird_t = 1.6 + math.random() * 4.5
    local a = math.random() * 6.283
    local r = 12 + math.random() * 25
    local bx, bz = ex + math.sin(a) * r, ez + math.cos(a) * r
    nova.sound.play(math.random() < 0.6 and "bird_a" or "bird_b", { at = { bx, world.height(bx, bz) + 8, bz }, range = 60, volume = 0.5, vary = 0.12 })
  end
end

return ambience
