-- The co-driver: reads each pace note aloud at the right moment, as short clips of one word each played back to back from sounds/voice/
-- (scripts/rally/voice.mjs makes them on a Mac with its own voice; they are not in the repository: see the game's README.md,
-- "The co-driver's voice"). A clip that is missing is simply not spoken: the game stays quiet for that word, with no error.
--
-- It works from the notes of lib/pacenotes_hud.lua (any course's: a list of { s, e, left, grade, long, tightens... }). `words` turns a
-- note, and the ones that follow it closely, into clip names; `update` says them when the car comes to them: early enough to act on
-- at the speed it is going, one call after another and never over each other, dropping a call that came too late to be any use.
local codriver = {}

-- the folder the clips are in (a test points it somewhere empty to hear nothing)
codriver.prefix = "voice/"
codriver.volume = 1.0            -- before the game's sound volume (nova.sound.volume), which the voice follows
codriver.duck = 0.55             -- how far the engine is turned down while he speaks (1 is not at all)
codriver.GAP = 0.04              -- seconds between one clip and the next
codriver.CHAIN = 75              -- metres between the end of one bend and the start of the next at which they are one call ("into")
codriver.LEAD_MIN, codriver.LEAD_MAX = 90, 330
codriver.STALE = 8               -- seconds a call may wait its turn before it is dropped

local NUMBERS = { "one", "two", "three", "four", "five", "six" }
-- how long each clip is (seconds, as scripts/rally/voice.mjs prints them for its voice; another voice's vary a little): 0.45 for any other
codriver.DURATION = {
  left = 0.41, right = 0.37, one = 0.34, two = 0.35, three = 0.42, four = 0.39, five = 0.37, six = 0.45, hairpin = 0.47, square = 0.50,
  flat = 0.40, long = 0.38, short = 0.43, tightens = 0.60, opens = 0.54, crest = 0.44, jump = 0.31, dip = 0.21, caution = 0.46,
  dont_cut = 0.56, into = 0.37, ["and"] = 0.35, fifty = 0.47, one_hundred = 0.57, one_fifty = 0.65, two_hundred = 0.57, three_hundred = 0.62,
  finish = 0.45, go = 0.34,
}

-- the clips of the words of one note: the way it turns and how hard, then what goes with it
local function say_note(note, out)
  if note.kind then
    if note.kind ~= "finish" then out[#out + 1] = note.kind else out[#out + 1] = "finish" end
  else
    local side = note.left and "left" or "right"
    if note.hairpin then
      out[#out + 1] = "hairpin"
      out[#out + 1] = side
    elseif note.square then
      out[#out + 1] = "square"
      out[#out + 1] = side
    elseif note.flat then
      out[#out + 1] = side
      out[#out + 1] = "flat"
    else
      out[#out + 1] = side
      out[#out + 1] = NUMBERS[math.max(1, math.min(6, note.grade or 6))]
    end
    for _, m in ipairs({ "long", "short", "tightens", "opens", "crest", "jump", "dip", "caution", "dont_cut" }) do
      if note[m] then out[#out + 1] = m end
    end
  end
  return out
end

-- the distance as a clip (the nearest of 50, 100, 150, 200 and 300 metres), or nothing when it is too near to be worth saying
function codriver.distance_word(metres)
  if metres < 75 then return nil end
  if metres < 125 then return "one_hundred" end
  if metres < 175 then return "one_fifty" end
  if metres < 250 then return "two_hundred" end
  return "three_hundred"
end

-- The clips that read note number `k` of `notes` when it is `away` metres off, and how many notes they read: "two hundred, left four
-- long, into right two". Bends that follow within `CHAIN` metres are read in the same breath, up to three; a note of its own (a crest)
-- is joined with "and". `away` nil leaves out the distance.
function codriver.words(notes, k, away)
  local out = {}
  local first = notes[k]
  if not first then return out, 0 end
  local d = away and codriver.distance_word(away)
  if d then out[#out + 1] = d end
  say_note(first, out)
  local count = 1
  local last = first
  while count < 3 do
    local nxt = notes[k + count]
    if not nxt or nxt.kind == "finish" and first.kind ~= "finish" then break end
    if nxt.s - (last.e or last.s) > codriver.CHAIN then break end
    out[#out + 1] = (nxt.kind and not last.kind) and "and" or "into"
    say_note(nxt, out)
    last = nxt
    count = count + 1
  end
  return out, count
end

-- how long saying `clips` takes
function codriver.duration(clips)
  local t = 0
  for _, c in ipairs(clips) do t = t + (codriver.DURATION[c] or 0.45) + codriver.GAP end
  return t
end

-- ---- saying them -----------------------------------------------------------------------------------------------------------

local S = { queue = {}, clock = 0 }

-- Starts again for a stage: `notes` are its pace notes.
function codriver.reset(notes)
  S = { queue = {}, clock = 0, notes = notes or {}, next = 1, playing = nil, missing = {}, duck = 1, said = {} }
end

-- Whatever he is saying is dropped (the game is paused).
function codriver.hush()
  S.queue, S.playing = {}, nil
end

-- The clips said so far this stage, as { name, at = seconds } (for the tests and for finding out why he said what he did).
function codriver.log() return S.said end
function codriver.speaking() return S.playing ~= nil end

local function play(clip)
  S.missing = S.missing or {}
  if S.missing[clip] then return false end
  local ok, id = pcall(nova.sound.play, codriver.prefix .. clip, { volume = codriver.volume })
  if not ok then
    S.missing[clip] = true -- (no such clip: silent for this word, and never asked for again)
    return false
  end
  return true
end

-- Says a list of clips now, or queues it behind what is being said. `due`: the metres along the stage of the first note it is about
-- (a call that is already behind the car when its turn comes is dropped).
function codriver.say(clips, due)
  if #clips == 0 then return end
  S.queue[#S.queue + 1] = { clips = clips, due = due, since = S.clock }
end

-- One step. `enabled`: the player has the voice on. `progress`: metres along the stage; `speed`: metres a second.
-- Returns how much the engine should be turned down (1 for not at all).
function codriver.update(dt, enabled, progress, speed)
  if not S.notes then return 1 end
  S.clock = S.clock + dt
  speed = math.max(0, speed or 0)
  if enabled then
    -- the next note whose time has come: far enough ahead that it is read through and acted on before the bend
    while S.notes[S.next] do
      local note = S.notes[S.next]
      local away = note.s - progress
      local clips, count = codriver.words(S.notes, S.next, away)
      local lead = math.max(codriver.LEAD_MIN, math.min(codriver.LEAD_MAX, speed * (codriver.duration(clips) + 2.2) + 25))
      if away > lead then break end
      S.next = S.next + count
      if away > -10 then codriver.say(clips, note.s) end
    end
  else
    -- (the voice is off: the notes are passed without being said)
    while S.notes[S.next] and S.notes[S.next].s - progress <= 400 do S.next = S.next + 1 end
    S.queue = {}
  end
  -- what is being said goes on a clip at a time
  local p = S.playing
  if p and S.clock >= p.until_at then
    p.i = p.i + 1
    if p.i > #p.clips then S.playing, p = nil, nil end
  end
  if not S.playing and #S.queue > 0 then
    local item = table.remove(S.queue, 1)
    -- too late to help: the bend is under the car, or it has waited too long for the one before it
    local late = item.due and item.due - progress < speed * 0.6 + 6
    if not late and S.clock - item.since < codriver.STALE then
      S.playing = { clips = item.clips, i = 1, until_at = S.clock }
      p = S.playing
      p.fresh = true
    end
  end
  p = S.playing
  if p and (p.fresh or S.clock >= p.until_at) then
    p.fresh = false
    local clip = p.clips[p.i]
    local spoken = play(clip)
    S.said[#S.said + 1] = { name = clip, at = S.clock, spoken = spoken }
    p.until_at = S.clock + (spoken and (codriver.DURATION[clip] or 0.45) + codriver.GAP or 0)
  end
  local want = S.playing and codriver.duck or 1
  S.duck = S.duck + (want - S.duck) * math.min(1, dt * (want < S.duck and 12 or 3))
  return S.duck
end

return codriver
