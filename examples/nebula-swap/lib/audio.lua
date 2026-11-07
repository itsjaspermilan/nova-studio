-- Sound for the game: the effects (Kenney's interface, digital and sci-fi sounds) and the music, with a gain for each so that none is far above the rest.
local audio = {}

-- (measured with `LOUDNESS_PROJECT=nebula-swap cargo test -p nova-runtime --test loudness -- --ignored --nocapture`: Kenney's digital sounds are 10 to 20 dB
-- quieter than his interface sounds, so they are lifted; the master volume for effects runs at twice the slider, which is what makes room for that)
local GAIN = { menu_move = 0.45, menu_accept = 0.35, menu_back = 0.45, swap = 0.6, raise = 0.25, pause = 0.4, nope = 0.4, pop = 2.75, chain = 2.0, combo = 2.25,
  win = 4.0, lose = 0.7, beep = 1.5, garbage_land = 0.4, garbage_break = 0.45, whoosh = 0.125 }
local MUSIC_GAIN = { menu = 0.9, play = 0.8, versus = 1.0, puzzle = 0.95, over = 0.9 }

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
