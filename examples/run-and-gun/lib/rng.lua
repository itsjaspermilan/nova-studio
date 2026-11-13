-- A random number generator you can start from a number (a seed): the same seed gives the same numbers, in the same order, every time. That is what makes a generated level
-- repeatable: write the seed down and you can play the same level again. (math.random cannot be started from a seed in a way that keeps its order, so we use our own.)
local rng = {}
rng.__index = rng

function rng.new(seed)
  local s = math.floor(seed) % 2147483647
  if s <= 0 then s = s + 2147483646 end
  return setmetatable({ s = s }, rng)
end

function rng:next()
  self.s = (self.s * 48271) % 2147483647 -- a classic, simple generator (the "minimal standard")
  return self.s
end

function rng:float() return self:next() / 2147483647 end -- 0 up to (not including) 1
function rng:int(a, b) return a + math.floor(self:float() * (b - a + 1)) end -- a whole number from a to b, both included
function rng:chance(p) return self:float() < p end -- true p of the time (0.25 is one time in four)
function rng:pick(list) return list[self:int(1, #list)] end

return rng
