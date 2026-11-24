-- The music: four pieces for felt piano that take turns, with quiet between them (the owner, seventh play: the one piece was "too
-- repetitive"; chosen fix: several pieces that take turns, with quiet between them, as in games where each part of the day has its
-- own piece). Each plays once and ends; then only the ambience is heard for a while; then another piece, never the one just played.
-- Made by tools/music.mjs, each as five stems of one song, played together and in step (nova.music.layers):
--
--   fernhollow   F major, 68 bpm, 4/4         the morning walk (the first piece, shortened, now with an ending)   2:06
--   thistle      G major, 104 bpm, 4/4        a bright skipping tune                                              1:46
--   stillwater   E flat major, 58 bpm, 4/4    reflective and slow                                                 2:03
--   meadowsweet  D major, 120 bpm, 3/4        a folksy waltz                                                      1:53
--
-- The order (music.playlist_step, the same for the game and the tests): the first piece starts about 6 s after the game begins
-- (not at once); the pieces come from a shuffled bag, so all four play before any plays again, and a new bag never starts with the
-- piece just played; between two pieces a quiet of 20 to 60 s (one time in five 30 to 60 s longer), when only the ambience plays.
-- Eight seconds before a piece starts its stems' decoders are started (nova.music.prepare), so it begins with its opening decoded
-- and no burst of decoding as it starts; only the piece that plays is decoded (and, in the quiet, the next one's first second or
-- so). The playlist lives in this module, not in a scene, so walking in and out of the post office does not restart a piece; the
-- ending card cuts a quiet short (the next piece starts within 2 s).
--
-- Each piece's stems: the felt piano, always, and four layers that join while the van is driven (the owner: "pretty simple when not
-- in the vehicle, then as the player drives more and more layers can come on"):
--
--   1 bass      a round, soft bass on the chords' roots
--   2 brushes   a light shaker and brush taps
--   3 pad       warm, slow strings holding the harmony
--   4 celesta   a soft celesta answering the tune in its rests
--
-- The layers' rule (music.step, the same for the game and for tools/music.mjs), whichever piece plays:
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
--   * a card or a conversation: the piano alone, a little lower;
--   * the rule runs in the quiet too, so a piece that starts mid-drive starts with the layers the drive has earned.
-- The music's level is one dial (nova.music.volume), eased: the place's level, lower in the van's cab (as before), lower again under
-- a card or a conversation. Every piece's piano alone measures -18 LUFS, its five stems together 1.0 to 1.5 dB more.
local music = {}

music.PIECES = {
  { name = "fernhollow", title = "Fernhollow", seconds = 126.45 },
  { name = "thistle", title = "Thistle Lane", seconds = 105.71 },
  { name = "stillwater", title = "Stillwater", seconds = 123.30 },
  { name = "meadowsweet", title = "Meadowsweet", seconds = 112.89 },
}
music.KINDS = { "piano", "bass", "brushes", "pad", "celesta" }
music.EXTRA = #music.KINDS - 1

-- The stems of piece `i` (an index into music.PIECES), the piano first.
function music.stems(i)
  local out = {}
  for k, kind in ipairs(music.KINDS) do out[k] = music.PIECES[i].name .. "_" .. kind end
  return out
end

music.PLAYLIST = {
  first = 6,           -- seconds from the game's start to the first piece
  gap = { 20, 60 },    -- seconds of quiet between two pieces
  longer = 0.2,        -- the chance that a quiet is longer
  extra = { 30, 60 },  -- by this many seconds
  prepare = 8,         -- seconds before a piece starts, its stems' decoders start (nova.music.prepare)
  fade = 0.5,          -- seconds a piece's start fades in over (each begins softly anyway)
  hurry = 2,           -- the ending card: the quiet left is cut to this
}

-- A fresh playlist: `rand` gives numbers from 0 to 1 (math.random by default; the tests pass their own).
function music.new_playlist(rand)
  return { rand = rand or math.random, phase = "quiet", left = music.PLAYLIST.first, piece = nil, last = nil, next = nil, bag = {}, prepared = false, gaps = {} }
end

-- The next piece: the next from a shuffled bag of all of them; a new bag never starts with the piece just played.
local function draw(pl)
  if #pl.bag == 0 then
    local bag = {}
    for i = 1, #music.PIECES do bag[i] = i end
    for i = #bag, 2, -1 do
      local j = 1 + math.floor(pl.rand() * i) % i
      bag[i], bag[j] = bag[j], bag[i]
    end
    -- (pieces are taken from the end)
    if #bag > 1 and bag[#bag] == pl.last then bag[#bag], bag[1] = bag[1], bag[#bag] end
    pl.bag = bag
  end
  return table.remove(pl.bag)
end

local function quiet_length(pl)
  local T = music.PLAYLIST
  local g = T.gap[1] + (T.gap[2] - T.gap[1]) * pl.rand()
  if pl.rand() < T.longer then g = g + T.extra[1] + (T.extra[2] - T.extra[1]) * pl.rand() end
  return g
end

-- One step of the playlist: returns what to do now, a list of { kind = "prepare" | "start" | "end", piece = index }.
function music.playlist_step(pl, dt)
  local out = {}
  pl.left = pl.left - dt
  if pl.phase == "quiet" then
    pl.next = pl.next or draw(pl)
    if not pl.prepared and pl.left <= music.PLAYLIST.prepare then
      pl.prepared = true
      out[#out + 1] = { kind = "prepare", piece = pl.next }
    end
    if pl.left <= 0 then
      pl.phase, pl.piece, pl.last, pl.next, pl.prepared = "piece", pl.next, pl.next, nil, false
      pl.left = pl.left + music.PIECES[pl.piece].seconds
      out[#out + 1] = { kind = "start", piece = pl.piece }
    end
  elseif pl.left <= 0 then
    out[#out + 1] = { kind = "end", piece = pl.piece }
    pl.phase, pl.piece = "quiet", nil
    local g = quiet_length(pl)
    pl.gaps[#pl.gaps + 1] = g
    pl.left = pl.left + g
  end
  return out
end

-- Cuts a quiet short (the ending card): the next piece starts within PLAYLIST.hurry seconds.
function music.hurry(pl)
  if pl.phase == "quiet" then pl.left = math.min(pl.left, music.PLAYLIST.hurry) end
end

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

-- The game's side: the playlist, the layers' state, the music's level and the piece that plays (an index, nil in a quiet).
local list, where, state, heard, current = nil, "outdoors", music.new_state(), nil, nil

-- Starts the playlist if it has not started yet (it carries on from scene to scene), and says where we are (the level).
function music.start(place)
  where = place or "outdoors"
  if not list then
    list, state, current = music.new_playlist(), music.new_state(), nil
    heard = music.TUNE.volume[where] or music.TUNE.volume.outdoors
    nova.music.volume(heard)
  end
  if where == "ending" then music.hurry(list) end
end

-- Each frame: `input` as for music.step.
function music.update(dt, input)
  if not list then return end
  local changes = music.step(state, dt, input)
  for _, e in ipairs(music.playlist_step(list, dt)) do
    if e.kind == "prepare" then
      nova.music.prepare(music.stems(e.piece), { loop = false })
    elseif e.kind == "start" then
      -- (the piano heard, each layer at the level the drive has earned)
      local levels = { 1 }
      for i = 1, music.EXTRA do levels[i + 1] = state.sent[i] end
      nova.music.layers(music.stems(e.piece), { levels = levels, fade = music.PLAYLIST.fade, loop = false })
      current = e.piece
    else
      current = nil -- (the stems have ended by themselves)
    end
  end
  if current then
    local stems = music.stems(current)
    for _, c in ipairs(changes) do
      nova.music.layer(stems[c.layer + 1], c.level, { fade = c.fade, at = c.at })
    end
  end
  local T = music.TUNE
  local want = (T.volume[where] or T.volume.outdoors) * (input.driving and T.cab or 1) * (input.quiet and T.talk or 1)
  heard = (heard or want) + (want - (heard or want)) * math.min(1, dt / T.ease)
  nova.music.volume(heard)
end

-- For the tests: forgets the playlist and the drive (the next music.start begins afresh).
function music.reset()
  list, where, state, heard, current = nil, "outdoors", music.new_state(), nil, nil
end

-- For the tests: what has been earned, the eased speed, the level each layer was last given, the piece that plays (its name, or
-- nil in a quiet), the playlist's phase and the seconds left in it.
function music.status()
  return {
    earned = state.earned, drive = state.drive, speed = state.speed, levels = { table.unpack(state.sent) }, volume = heard, where = where,
    piece = current and music.PIECES[current].name or nil, phase = list and list.phase or "off", left = list and list.left or 0,
  }
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
