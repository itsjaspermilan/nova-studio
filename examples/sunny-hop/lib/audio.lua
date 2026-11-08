-- Sound for the game: the New Platformer Pack's own effects, a few from Kenney's Interface, Impact and Digital Audio packs, the Music Jingles for a
-- cleared level, and the Voiceover Pack's "ready, set, go" for the time trial. Each has a gain so that none is far above the rest.
local audio = {}

-- Gains set from measured loudness (LOUDNESS_PROJECT=sunny-hop cargo test --release -p nova-runtime --test loudness -- --ignored --nocapture) so that
-- each lands near -17 dB RMS before the master volume, the quiet Digital Audio ones lifted as far as their peaks allow and the frequent ones
-- (jumps, coins, landings) a little under the rest.
local GAIN = {
  accept = 0.45, back = 1.0, boss_hit = 0.6, boss_roar = 1.6, bump = 0.5, checkpoint = 3.2, clear = 0.8, coin = 0.5, disappear = 0.68, fall = 0.72,
  gem = 0.55, go = 0.8, heart = 4, hurt = 0.51, jump = 0.4, jump_high = 0.6, key = 4, land = 0.6, magic = 0.65, move = 0.6, new_best = 0.8, nope = 0.7,
  pause = 0.67, powerup = 4, ready = 0.95, set = 0.86, secret = 0.66, splash = 0.68, spring = 4, star = 4, stomp = 0.55, switch = 1.3, throw = 0.6,
  tick = 1.2, unlock = 0.73, whoosh = 1.0, select = 0.55,
}
-- (the songs are about -18 dB RMS; the map's is quieter, the boss's louder)
local MUSIC_GAIN = { title = 1, map = 1.2, grass = 1, sand = 1.1, snow = 1, castle = 1, boss = 0.85 }

audio.sfx_volume, audio.music_volume = 0.9, 0.8
audio.muted = false -- (the computer runner plays silently)

function audio.sfx(name, opts)
  if audio.muted then return end
  opts = opts or {}
  opts.volume = math.min(4, (opts.volume or 1) * (GAIN[name] or 1)) -- (a sound plays at most four times its own loudness)
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
