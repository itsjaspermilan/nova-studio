-- The text box at the bottom of the screen: the speaker's name on a tab, their words typed out briskly with a babble voice (short
-- syllables, each character's own: Hazel low and slow, Pip high and quick), A to finish the line at once or to go on.
local ui = require("lib.ui")

local dialogue = {}

-- Each speaker's voice: the sound group, how fast the words come (characters a second), a syllable every how many letters, and the
-- pitch (with a little wobble).
local VOICES = {
  hazel = { sound = "voice_hazel", cps = 34, every = 3, pitch = 1.0, wobble = 0.05, colour = { 134, 88, 60 } },
  pip = { sound = "voice_pip", cps = 62, every = 2, pitch = 1.0, wobble = 0.09, colour = { 210, 150, 52 } },
}

local cur -- { who, name, lines, i, shown, t, on_line, on_done }

-- Starts a conversation: `lines` in order, each said by `who` (the voice and the name on the tab).
function dialogue.start(who, name, lines, opts)
  opts = opts or {}
  cur = { who = who, name = name, lines = lines, i = 1, shown = 0, t = 0, beat = 0, on_line = opts.on_line, on_done = opts.on_done, wait = 0.12 }
  if cur.on_line then cur.on_line(1) end
  nova.log("dialogue " .. who .. " 1: " .. lines[1])
end

function dialogue.active() return cur ~= nil end
function dialogue.line() return cur and cur.lines[cur.i] end
function dialogue.typing() return cur ~= nil and cur.shown < #cur.lines[cur.i] end

function dialogue.update(dt)
  if not cur then return end
  local v = VOICES[cur.who] or VOICES.hazel
  local text = cur.lines[cur.i]
  if cur.wait > 0 then cur.wait = cur.wait - dt; return end
  if cur.shown < #text then
    cur.t = cur.t + dt * v.cps
    local before = math.floor(cur.shown)
    -- (a little pause at a stop or a comma, as one speaks)
    local ch = text:sub(before, before)
    local slow = (ch == "." or ch == "!" or ch == "?") and 0.25 or ch == "," and 0.55 or 1
    cur.shown = math.min(#text, cur.shown + dt * v.cps * slow)
    for k = before + 1, math.floor(cur.shown) do
      local c = text:sub(k, k)
      if c:match("%a") then
        cur.beat = cur.beat + 1
        if cur.beat % v.every == 1 or v.every == 1 then
          -- a capital or a word in capitals is said louder and a touch higher
          local loud = c:match("%u") and 1.25 or 1
          nova.sound.play(v.sound, { volume = 0.45 * loud, pitch = v.pitch * (1 + (loud - 1) * 0.3), vary = v.wobble })
        end
      end
    end
  end
  if nova.input.pressed("interact") then -- (X goes on)
    if cur.shown < #text then
      cur.shown = #text
    elseif cur.i < #cur.lines then
      cur.i, cur.shown, cur.t, cur.wait = cur.i + 1, 0, 0, 0.08
      nova.sound.play("page", { volume = 0.12, vary = 0.1 })
      if cur.on_line then cur.on_line(cur.i) end
      nova.log("dialogue " .. cur.who .. " " .. cur.i .. ": " .. cur.lines[cur.i])
    else
      local done = cur.on_done
      cur = nil
      if done then done() end
    end
  end
end

-- The box's size and where the words go, from the kit's one scale (the test checks every line fits).
local s = ui.s
function dialogue.layout(w)
  local bw = math.min(s(860), w - 80)
  return { w = bw, h = s(142), text_w = bw - s(96), size = ui.F.body + 1, spacing = 1.15, pad_top = s(30) }
end

function dialogue.draw(w, h)
  if not cur then return end
  local v = VOICES[cur.who] or VOICES.hazel
  local L = dialogue.layout(w)
  local bw, bh = L.w, L.h
  local x, y = (w - bw) / 2, h - bh - s(28)
  ui.panel(x, y, bw, bh)
  -- the name on a tag in the speaker's colour, over the panel's top-left corner
  ui.tag(x + s(26), y - s(22), cur.name, v.colour)
  local text = cur.lines[cur.i]:sub(1, math.floor(cur.shown))
  ui.text(x + s(32), y + L.pad_top, text, { size = L.size, width = L.text_w, color = ui.C.ink, line_spacing = L.spacing })
  if cur.shown >= #cur.lines[cur.i] then
    local bob = math.sin(nova.time() * 5) * 2
    ui.glyph(x + bw - s(34), y + bh - s(32) + bob, "X", s(28), { down = nova.input.down("interact") })
  end
end

return dialogue
