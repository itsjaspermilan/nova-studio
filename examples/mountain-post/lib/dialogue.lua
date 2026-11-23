-- The text box at the bottom of the screen: the speaker's name on a tab, their words typed out with a babble voice (short syllables,
-- each character's own: Hazel low and a little slower, Pip high and quick). The line is laid out whole before it is typed (the
-- engine's nova.ui.rich_text), so a word never starts on one line and jumps to the next; each letter rises softly into place as it
-- appears, and the markup in lib/words.lua ({wave}, {big}, {shake}, {slow}, {pop}, {pause}) gives a line its feeling. The pace
-- pauses a little after a comma, more after a full stop, most after "...". X once finishes the line at once, X again goes on.
local ui = require("lib.ui")

local dialogue = {}

-- Each speaker's voice: the sound group, how fast the words come (letters a second, spaces too), a syllable every how many letters,
-- and the pitch (with a little wobble).
local VOICES = {
  hazel = { sound = "voice_hazel", cps = 46, every = 3, pitch = 1.0, wobble = 0.05, colour = { 134, 88, 60 } },
  pip = { sound = "voice_pip", cps = 60, every = 2, pitch = 1.0, wobble = 0.09, colour = { 210, 150, 52 } },
}
dialogue.VOICES = VOICES

-- How long the box takes to rise into place when a talk opens (it goes at once when the talk ends), and the wait before the first
-- letter.
dialogue.OPEN = 0.1
local LEAD = 0.06

local cur -- { who, name, lines, i, t, skip, done, said, beat, letters, plain, last, open, on_line, on_done }

local s, SP = ui.s, ui.SP
-- The box's size and where the words go, from the kit's one scale (the test checks every line fits).
-- A panel of running text: PAD_LONG inside the big frame.
function dialogue.layout(w)
  local bw = math.min(s(860), w - 80)
  local I, P = ui.inset(), ui.PAD_LONG
  return { w = bw, h = s(120), text_w = bw - 2 * (I.x + P.x), left = I.x + P.x, size = ui.F.body + 1, spacing = 1.15, pad_top = I.top + P.y }
end

-- The options the words are drawn with (the same for laying out, timing and drawing).
function dialogue.text_opts(who, L, time, skip)
  local v = VOICES[who] or VOICES.hazel
  return { size = L.size, width = L.text_w, color = ui.C.ink, line_spacing = L.spacing, cps = v.cps, time = time, skip = skip }
end

-- Reads the line the talk is on: its plain words and when each letter comes out (for the babble and the mouth).
local function begin_line()
  local L = dialogue.layout(1280)
  local info = ui.rich_letters(0, 0, cur.lines[cur.i], dialogue.text_opts(cur.who, L, 0))
  cur.letters, cur.plain, cur.last = info.letters, info.text, info.last
  cur.t, cur.skip, cur.done, cur.said = -LEAD, nil, false, 0
  if cur.on_line then cur.on_line(cur.i) end
  nova.log("dialogue " .. cur.who .. " " .. cur.i .. ": " .. cur.plain)
end

-- Starts a conversation: `lines` in order, each said by `who` (the voice and the name on the tab).
function dialogue.start(who, name, lines, opts)
  opts = opts or {}
  cur = { who = who, name = name, lines = lines, i = 1, beat = 0, open = 0, on_line = opts.on_line, on_done = opts.on_done }
  begin_line()
end

function dialogue.active() return cur ~= nil end
-- the line being said, its words without the markup
function dialogue.line() return cur and cur.plain end
-- whether letters are coming out now (the speaker's mouth moves; it rests in the pauses and once the line is out)
function dialogue.typing()
  if not cur or cur.done then return false end
  local k = cur.said
  local last = k > 0 and cur.letters[k].at or 0
  return cur.t - last < 0.15
end
-- whether the whole line is out (X then goes on)
function dialogue.complete() return cur ~= nil and cur.done end
-- seconds into the line, and the time the player asked for all of it (nil if they did not): what nova.ui.rich_text is drawn at
function dialogue.clock() return cur and cur.t, cur and cur.skip end

function dialogue.update(dt)
  if not cur then return end
  local v = VOICES[cur.who] or VOICES.hazel
  cur.open = math.min(dialogue.OPEN, cur.open + dt)
  cur.t = cur.t + dt
  -- the babble: a syllable every few letters as they come out (a capital, or a big letter, said louder and a touch higher)
  while not cur.done and cur.said < #cur.letters and cur.letters[cur.said + 1].at <= cur.t do
    cur.said = cur.said + 1
    local l = cur.letters[cur.said]
    if l.char:match("%a") then
      cur.beat = cur.beat + 1
      if cur.beat % v.every == 1 or v.every == 1 then
        local loud = (l.char:match("%u") or l.fx.big) and 1.25 or 1
        nova.sound.play(v.sound, { volume = 0.45 * loud, pitch = v.pitch * (1 + (loud - 1) * 0.3), vary = v.wobble })
      end
    end
  end
  if cur.t >= cur.last then cur.done = true end
  if nova.input.pressed("interact") then -- (X: the rest of the line at once, then on)
    if not cur.done then
      cur.skip, cur.done, cur.said = math.max(0, cur.t), true, #cur.letters
    elseif cur.i < #cur.lines then
      cur.i = cur.i + 1
      nova.sound.play("page", { volume = 0.12, vary = 0.1 })
      begin_line()
    else
      local done = cur.on_done
      cur = nil
      if done then done() end
    end
  end
end

function dialogue.draw(w, h)
  if not cur then return end
  local v = VOICES[cur.who] or VOICES.hazel
  local L = dialogue.layout(w)
  local bw, bh = L.w, L.h
  -- (the box rises the last few units into place as the talk opens)
  local e = cur.open / dialogue.OPEN
  local x, y = (w - bw) / 2, h - bh - ui.EDGE + (1 - e) * (1 - e) * SP.l
  ui.panel(x, y, bw, bh)
  -- the name on a tag in the speaker's colour, over the panel's top-left corner
  ui.tag(x + SP.xl, y - SP.xl, cur.name, v.colour)
  ui.rich_text(x + L.left, y + L.pad_top, cur.lines[cur.i], dialogue.text_opts(cur.who, L, math.max(0, cur.t), cur.skip))
  if cur.done then
    -- the "next" button, bobbing softly once the line is out
    local since = cur.t - math.min(cur.skip or cur.last, cur.last)
    local a = math.min(1, math.max(0, since / 0.15))
    local bob = math.sin(cur.t * 4.5) * 2
    local cap = s(28)
    ui.glyph(x + bw - L.left - cap / 2, y + bh - ui.inset().bottom - ui.PAD_LONG.y - cap / 2 + bob, "X", cap, { down = nova.input.down("interact"), alpha = a })
  end
end

return dialogue
