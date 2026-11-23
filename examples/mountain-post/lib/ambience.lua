-- The valley's sound bed: the forest's air everywhere, birds now and then from the trees round you, the creek where you are near
-- it, Pip's radio faintly by his mast. (Hazel's sawing and Pip's tinkering are theirs: lib/resident.lua.) Everything sits at its
-- place, so it pans and fades with distance.
--
-- Kept under the music and the voices at a steady level (the owner: "the ambiance is a little loud at times"; measured by
-- tools/ambience.mjs, docs/games/mountain-post.md "Sound levels"): the ceiling is -30 LUFS over any three seconds for the whole
-- bed wherever you stand or drive (the music on foot is about -28.5, the voices about -22), and -28 for its loudest 400 ms. So:
--   * the creek was the loud one (-22 LUFS on its bridge, -18 for a moment driving over it): it is now about 12 dB quieter there,
--     fades with a gentle square law over 50 m, and its sound slides along its bed and swells or fades over half a second, never
--     jumping when the camera does (getting in and out, a glide) or when the nearest water changes;
--   * the air is 3.5 dB lower (and lower still in the cab);
--   * the birds are 4.4 dB quieter, never two at once, and never right overhead;
--   * every loop's level is eased (`EASE` seconds), so nothing steps. (Hazel's saw is 4 dB lower in its sound group.)
local world = require("lib.world")

local ambience = {}
local playing = {}
ambience.playing = playing -- (the loops by name, for tools/ambience.mjs's measurements)

-- Each source's level (the game's volume), and a gain on it a measurement can set (tools/ambience.mjs: 0 silences one).
ambience.LEVEL = { air = 0.28, air_in_van = 0.19, creek = 0.36, radio = 0.3, bird = 0.3 }
ambience.gain = { air = 1, creek = 1, radio = 1, birds = 1 }
local CREEK_RANGE = 50
local EASE = 0.5          -- seconds for a loop's level or place to settle
local BIRD_GAP = 2.2      -- seconds from one bird's call to the next, at least (a call lasts under a second: never two at once)
local BIRD_NEAR = 16      -- metres: a bird calls from the trees round you, never from right overhead

local RADIO_RANGE = 55
local LISTENER_UP = 4     -- metres the camera is above what it looks at, about (the distances below are from the camera)

-- The creek and the radio are placed sounds whose loudness the game works out itself and eases, rather than the mixer from the
-- camera's place each frame: so when the camera jumps (into the van, out of it, a test's teleport) the level glides instead of
-- stepping. The mixer still pans them by their place (`falloff = "none"`: it leaves the level to us).
local creek = { x = 0, y = 0, z = 0, heard = 0, placed = false }
local radio = { heard = 0 }
local air_vol

function ambience.start(mast)
  ambience.stop()
  air_vol = ambience.LEVEL.air
  playing.air = nova.sound.play("forest_air", { loop = true, volume = air_vol * ambience.gain.air })
  creek.heard, creek.placed = 0, false
  playing.creek = nova.sound.play("creek_loop", { loop = true, volume = 0, at = { 0, -1000, 0 }, range = 10000, falloff = "none" })
  radio.heard = 0
  if mast then
    radio.x, radio.y, radio.z = mast.x, world.height(mast.x, mast.z) + 1.5, mast.z
    playing.radio = nova.sound.play("radio_loop", { loop = true, volume = 0, at = { radio.x, radio.y, radio.z }, range = 10000, falloff = "none" })
  end
  ambience.bird_t = 1.5
end

function ambience.stop()
  for k, id in pairs(playing) do if id then nova.sound.stop(id, 0.3) end playing[k] = nil end
end

-- (the creek's level as heard now: for the tests)
function ambience.creek_volume() return creek.heard end

local function ease(from, to, dt) return from + (to - from) * math.min(1, dt / EASE) end
-- a gentle square law to nothing at the range, from the camera a few metres up
local function falloff(dx, dz, range)
  local d = math.sqrt(dx * dx + dz * dz + LISTENER_UP * LISTENER_UP)
  if d >= range then return 0 end
  local x = 1 - d / range
  return x * x
end

-- Each frame, with the camera's place (the listener): the creek's sound follows its bed to the point nearest you, the air dips
-- in the cab, a bird calls now and then.
function ambience.update(dt, ex, ez, inside_van)
  if playing.creek then
    local w, _, px, pz = world.nearest("water", ex, ez)
    local want = 0
    if w and w.id == "creek" then
      if not creek.placed then creek.x, creek.z, creek.placed = px, pz, true end
      creek.x, creek.z = ease(creek.x, px, dt), ease(creek.z, pz, dt)
      creek.y = world.height(creek.x, creek.z) + 0.5
      want = ambience.LEVEL.creek * falloff(creek.x - ex, creek.z - ez, CREEK_RANGE)
    end
    creek.heard = ease(creek.heard, want * ambience.gain.creek, dt)
    nova.sound.set(playing.creek, { at = { creek.x, creek.y, creek.z }, volume = creek.heard })
  end
  if playing.air then
    air_vol = ease(air_vol or ambience.LEVEL.air, inside_van and ambience.LEVEL.air_in_van or ambience.LEVEL.air, dt)
    nova.sound.set(playing.air, { volume = air_vol * ambience.gain.air })
  end
  if playing.radio then
    radio.heard = ease(radio.heard, ambience.LEVEL.radio * ambience.gain.radio * falloff(radio.x - ex, radio.z - ez, RADIO_RANGE), dt)
    nova.sound.set(playing.radio, { volume = radio.heard })
  end
  ambience.bird_t = (ambience.bird_t or 2) - dt
  if ambience.bird_t <= 0 then
    ambience.bird_t = BIRD_GAP + math.random() * 4.5
    local a = math.random() * 6.283
    local r = BIRD_NEAR + math.random() * 22
    local bx, bz = ex + math.sin(a) * r, ez + math.cos(a) * r
    if ambience.gain.birds > 0 then
      nova.sound.play(math.random() < 0.6 and "bird_a" or "bird_b", { at = { bx, world.height(bx, bz) + 8, bz }, range = 60,
        volume = ambience.LEVEL.bird * ambience.gain.birds, vary = 0.12 })
    end
  end
end

return ambience
