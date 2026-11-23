-- The music: "Fernhollow" as five stems of one piece, played together and in step (nova.music.layers), made by tools/music.mjs:
-- the felt piano, always, and four layers that join while the van is driven (the owner: "pretty simple when not in the vehicle,
-- then as the player drives more and more layers can come on"):
--
--   1 bass      a round, soft bass on the chords' roots
--   2 brushes   a light shaker and brush taps with a little lilt
--   3 pad       warm, slow strings holding the harmony
--   4 celesta   a soft celesta answering the tune in its rests
--
-- The rule (music.step, the same for the game and for tools/music.mjs's audition clip):
--   * on foot, indoors, on the title: the piano alone (indoors a touch quieter);
--   * getting in changes nothing; driving earns the layers one by one, the longer and steadier the drive: the first after about
--     4.5 s of driving faster than a walk, then one about every 9 s (sooner at cruising speed); an earned layer fades in over about a
--     bar, from the next bar line of the piece;
--   * the layers follow the van's speed on the way down (the owner: "for stopping, the layers should start to fade as the speed
--     slows"): from `full` m/s down to `gone` the earned layers thin out, the last earned first, so that by a stop only the piano is
--     left; the speed they follow is eased over about a second and a level is only changed when it has moved enough, so wobbles at
--     cruise do not pump. Speeding up again on the same drive brings the earned ones back as the speed returns (over a second or so),
--     with no wait;
--   * getting out forgets the drive: whatever is left fades away over a few seconds;
--   * a card or a conversation: the piano alone, a little lower.
-- The music's level is one dial (nova.music.volume), eased: the place's level, lower in the van's cab (as before), lower again under
-- a card or a conversation. All the layers at once are about 1.7 dB louder than the piano alone (tools/music.mjs sets their balance).
local music = {}

music.STEMS = { "fernhollow_piano", "fernhollow_bass", "fernhollow_brushes", "fernhollow_pad", "fernhollow_celesta" }
music.EXTRA = #music.STEMS - 1

music.TUNE = {
  moving = 2.0,     -- m/s: driving at least this fast earns layers
  cruise = 7.0,     -- m/s: from this speed on, earning goes 1.6 times as fast
  first = 4.5,      -- seconds of driving to earn the first layer
  every = 9.0,      -- seconds of driving for each one after it
  enter = 3.5,      -- an earned layer fades in over this (about a bar), from the next bar line
  gone = 0.8,       -- m/s: at or under this the extra layers are gone
  full = 6.0,       -- m/s: from this speed every earned layer plays in full
  smooth = 1.0,     -- seconds: the speed the layers follow is eased over this
  step = 0.05,      -- a layer's level is only changed when it has moved this much
  follow = 0.6,     -- seconds a level change takes when it follows the speed
  out = 3.0,        -- seconds for what is left to fade after getting out
  hush = 1.2,       -- seconds for the layers to fade under a card or a conversation
  volume = { title = 0.36, outdoors = 0.3, indoors = 0.26, ending = 0.42 },
  cab = 0.72,       -- the music in the van's cab (under the engine)
  talk = 0.8,       -- under a card or a conversation
  ease = 0.5,       -- seconds for the music's level to settle
}

-- A fresh state of the rule: what has been earned on this drive, how long it has been driven, the eased speed, the level each
-- layer was last given, and until when a layer that is coming in is left to finish its entry.
function music.new_state()
  local st = { t = 0, earned = 0, drive = 0, speed = 0, sent = {}, entering = {} }
  for i = 1, music.EXTRA do st.sent[i] = 0 end
  return st
end

local function clamp(x, a, b) return math.max(a, math.min(b, x)) end

-- One step of the rule: `input` is { driving = in the van, speed = m/s, quiet = a card or a conversation is open }. Returns the
-- changes to make: { layer (1 to EXTRA), level, fade (seconds), at ("bar" or "now") }.
function music.step(st, dt, input)
  local T = music.TUNE
  st.t = st.t + dt
  local out = {}
  local fade = T.follow
  local target = {}
  if not input.driving then
    st.earned, st.drive, st.speed = 0, 0, 0
    fade = input.quiet and T.hush or T.out
    for i = 1, music.EXTRA do target[i] = 0 end
  else
    local sp = math.abs(input.speed or 0)
    st.speed = st.speed + (sp - st.speed) * math.min(1, dt / T.smooth)
    if not input.quiet and sp >= T.moving then
      st.drive = st.drive + dt * (1 + 0.6 * clamp((sp - T.moving) / (T.cruise - T.moving), 0, 1))
    end
    local f = clamp((st.speed - T.gone) / (T.full - T.gone), 0, 1)
    local function level_of(i, earned) return input.quiet and 0 or clamp(f * earned - (i - 1), 0, 1) end
    local want = st.drive < T.first and 0 or math.min(music.EXTRA, 1 + math.floor((st.drive - T.first) / T.every))
    while st.earned < want do
      st.earned = st.earned + 1
      local i = st.earned
      local level = level_of(i, st.earned)
      if level > 0 then
        out[#out + 1] = { layer = i, level = level, fade = T.enter, at = "bar" }
        st.sent[i] = level
        st.entering[i] = st.t + T.enter + 4.5 -- (the wait for the bar line, then the fade)
      end
    end
    for i = 1, music.EXTRA do target[i] = i <= st.earned and level_of(i, st.earned) or 0 end
    if input.quiet then fade = T.hush end
  end
  for i = 1, music.EXTRA do
    local want, had = target[i], st.sent[i]
    local moved = math.abs(want - had) >= T.step or (want == 0 and had > 0) or (want == 1 and had < 1 and want - had > 0.005)
    -- (a layer that is coming in keeps to the bar line: if it should be louder, the change waits for the bar line as its entry did;
    -- only when the van slows does it change at once)
    local entering = st.entering[i] and st.t < st.entering[i] and want >= had - 0.1
    if moved and entering and want > had then
      out[#out + 1] = { layer = i, level = want, fade = T.enter, at = "bar" }
      st.sent[i] = want
    elseif moved and not entering then
      out[#out + 1] = { layer = i, level = want, fade = fade, at = "now" }
      st.sent[i] = want
      st.entering[i] = nil
    end
  end
  return out
end

-- The game's side: the stems, the state, and the music's level.
local playing, where, state, heard = false, "outdoors", music.new_state(), nil

-- Starts the music if it does not play yet (it carries on from scene to scene), and says where we are (the level).
function music.start(place)
  where = place or "outdoors"
  if not playing then
    local levels = { 1 }
    for i = 1, music.EXTRA do levels[i + 1] = 0 end
    nova.music.layers(music.STEMS, { levels = levels, fade = 1.0 })
    playing, state = true, music.new_state()
    heard = music.TUNE.volume[where] or music.TUNE.volume.outdoors
    nova.music.volume(heard)
  end
end

-- Each frame: `input` as for music.step.
function music.update(dt, input)
  if not playing then return end
  for _, c in ipairs(music.step(state, dt, input)) do
    nova.music.layer(music.STEMS[c.layer + 1], c.level, { fade = c.fade, at = c.at })
  end
  local T = music.TUNE
  local want = (T.volume[where] or T.volume.outdoors) * (input.driving and T.cab or 1) * (input.quiet and T.talk or 1)
  heard = (heard or want) + (want - (heard or want)) * math.min(1, dt / T.ease)
  nova.music.volume(heard)
end

-- For the tests: what has been earned, the eased speed, and the level each layer was last given.
function music.status()
  return { earned = state.earned, drive = state.drive, speed = state.speed, levels = { table.unpack(state.sent) }, volume = heard, where = where }
end

-- For tools/music.mjs (the audition clip) and the tests: the rule run over a drive, one input every `dt` seconds; returns the changes
-- as text, "t layer level fade at" separated by semicolons.
function music.simulate(inputs, dt)
  local st, parts = music.new_state(), {}
  for k, input in ipairs(inputs) do
    for _, c in ipairs(music.step(st, dt, input)) do
      parts[#parts + 1] = string.format("%.2f %d %.3f %.2f %s", k * dt, c.layer, c.level, c.fade, c.at)
    end
  end
  return table.concat(parts, ";")
end

return music
