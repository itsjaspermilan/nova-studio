-- What the run knows: the player's health and ammunition, the key, and how it is going.
local S = {}

-- the two weapons: damage is for each pellet, spread is how wide the pellets scatter (radians)
S.weapons = {
  { name = "pistol", mag = 12, ammo = "bullets", damage = 14, pellets = 1, spread = 0.004, cooldown = 0.26, reload = 1.0, kick = 0.012 },
  { name = "shotgun", mag = 6, ammo = "shells", damage = 9, pellets = 8, spread = 0.07, cooldown = 0.85, reload = 1.7, kick = 0.05 },
}

function S.reset()
  S.hp, S.armor = 100, 0
  S.weapon = 1
  S.have = { true, false }
  S.ammo = { bullets = 48, shells = 0 }
  S.mag = { 12, 0 }
  S.key = false
  S.kills, S.time = 0, 0
  S.dead, S.won = false, false
  S.message, S.message_for = "", 0
  S.exit_open = false
  S.god = S.god or false
  -- what the paths cost (milliseconds, and how many), for the F3 screen and the write-up
  S.path_ms, S.path_calls, S.path_worst, S.nav_ms, S.nav_builds = 0, 0, 0, 0, 0
end

function S.say(text, seconds)
  S.message, S.message_for = text, seconds or 2.5
end

return S
