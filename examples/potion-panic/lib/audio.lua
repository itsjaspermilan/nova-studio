-- Sound for the game: Kenney's interface, RPG, foley, impact and digital sounds, and music loops. Each has a gain so that none is far above the rest
-- (measured with `LOUDNESS_PROJECT=potion-panic cargo test -p nova-runtime --test loudness -- --ignored --nocapture`).
local audio = {}

-- (the effects' master volume runs at twice the slider, so these are about a half of what the file would need: the digital and RPG sounds are 10 to 20 dB quieter than the
-- interface ones, and are lifted as far as their peaks allow)
local GAIN = {
  menu_move = 0.45, menu_accept = 0.35, menu_back = 0.45, nope = 0.4, page = 1.3, book_open = 1.9, grab = 1.9, drop = 0.42, grind = 0.35, pot_add = 0.23, brew_start = 0.27,
  coins = 1.7, step = 0.3, bottle = 0.47, shatter = 0.55, order = 0.7, pour = 0.6, bubble = 0.4, dash = 0.28, whoosh = 0.3, ding = 2.4, fail = 0.72, star = 2.2, splash = 2.0, beep = 1.5,
}
-- (the songs are our own, written by scripts/potion/music.mjs: about -20 dB RMS each, ember a little louder)
local MUSIC_GAIN = { menu = 1.8, meadow = 1.7, frost = 1.8, ember = 1.1, mire = 1.7, results = 1.6 }

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
