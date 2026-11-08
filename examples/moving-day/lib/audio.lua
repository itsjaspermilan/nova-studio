-- Sound for the game: Kenney's furniture-ish foley, impact, interface and jingle sounds (scripts/moving-day/sounds.sh) and our own music
-- (scripts/moving-day/music.mjs). Each has a gain so that none is far above the rest (measured with
-- `LOUDNESS_PROJECT=moving-day cargo test -p nova-runtime --test loudness -- --ignored --nocapture`).
local audio = {}

local GAIN = {
  menu_move = 0.45, menu_accept = 0.4, menu_back = 0.45, nope = 0.4, step = 0.35, slide = 0.8, bump = 0.7, turn = 0.6, snap = 0.9, unsnap = 0.6,
  undo = 0.5, restart = 0.6, happy = 0.9, star = 1.0, solved = 0.9, page = 0.9, door = 0.7, pop = 0.7,
}
local MUSIC_GAIN = { menu = 1.0, morning = 1.0, afternoon = 1.0, evening = 1.0 }

function audio.sfx(name, opts)
  opts = opts or {}
  opts.volume = (opts.volume or 1) * (GAIN[name] or 1)
  return nova.sound.play(name, opts)
end

local current
function audio.music(name, opts)
  if current == name then return end
  current = name
  opts = opts or {}
  nova.music.play(name, { volume = (opts.volume or 1) * (MUSIC_GAIN[name] or 1), fade = opts.fade or 0.8, loop = opts.loop ~= false })
end
function audio.stop_music(fade) current = nil; nova.music.stop(fade or 0.5) end

return audio
