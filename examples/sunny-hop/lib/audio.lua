-- Sound for the game: the New Platformer Pack's own effects, a few from Kenney's Interface, Impact and Digital Audio packs, the Music Jingles for a
-- cleared level, and the Voiceover Pack's "ready, set, go" for the time trial. Each has a gain so that none is far above the rest.
local audio = {}

local GAIN = {
  jump = 0.55, jump_high = 0.6, coin = 0.5, gem = 0.75, hurt = 0.75, bump = 0.6, stomp = 0.8, spring = 0.75, magic = 0.6, disappear = 0.6, select = 0.55, throw = 0.6,
  move = 0.5, accept = 0.6, back = 0.55, nope = 0.6, pause = 0.6, land = 0.35, key = 0.7, unlock = 0.7, switch = 0.7, checkpoint = 0.8, heart = 0.7, secret = 0.7,
  fall = 0.6, boss_hit = 0.9, boss_roar = 0.8, splash = 0.7, clear = 0.9, star = 0.8, tick = 0.5, ready = 1, set = 1, go = 1, new_best = 1, powerup = 0.6, whoosh = 0.5,
}
local MUSIC_GAIN = { title = 1, map = 1, grass = 1, sand = 1, snow = 1, castle = 1, boss = 1 }

audio.sfx_volume, audio.music_volume = 0.9, 0.8
audio.muted = false -- (the computer runner plays silently)

function audio.sfx(name, opts)
  if audio.muted then return end
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
function audio.playing() return current end

return audio
