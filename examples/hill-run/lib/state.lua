-- What the run knows.
local S = {}

function S.reset()
  S.gems, S.total = 0, 0
  S.time, S.falls, S.slide_frames, S.hops, S.max_height = 0, 0, 0, 0, 0
  S.won = false
  S.message, S.message_for = "", 0
end

function S.say(text, seconds) S.message, S.message_for = text, seconds or 2.5 end

return S
