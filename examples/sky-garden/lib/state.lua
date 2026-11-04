-- What the run knows.
local S = {}

function S.reset()
  S.gems, S.total = 0, 0
  S.stomps, S.falls, S.hits = 0, 0, 0
  S.time = 0
  S.won = false
  S.respawn = { x = 0, y = 0.01, z = 0 }
  S.message, S.message_for = "", 0
  S.ride_frames, S.cam_pulls = 0, 0
end

function S.say(text, seconds) S.message, S.message_for = text, seconds or 2.5 end

return S
