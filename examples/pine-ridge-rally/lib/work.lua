-- Long sums spread over frames, for the menus: making a route and its target times can take a desktop a few hundred milliseconds and a
-- handheld several times that, more than one frame may take (the engine stops a script that runs a second in one frame). A job runs in a
-- coroutine; lib/generate.lua and lib/racing.lua call `tick` in their long loops, which hands the frame back once the job has had its
-- share of it. Outside a job (a race being built, which has a load's allowance) `tick` does nothing.
local work = {}

local BUDGET = 0.008 -- seconds of a frame a job may use
local jobs = {}      -- by key: { co, result, done }
local started = 0

function work.tick()
  if coroutine.isyieldable() and nova.clock() - started > BUDGET then coroutine.yield() end
end
require("lib.generate").tick = work.tick
require("lib.racing").tick = work.tick

-- The result of job `key` (`fn` makes it), or nil while it is still being worked out. Call it every frame while it is wanted.
function work.get(key, fn)
  local j = jobs[key]
  if not j then
    j = { co = coroutine.create(fn) }
    jobs[key] = j
  end
  if j.done then return j.result end
  started = nova.clock()
  local ok, result = coroutine.resume(j.co)
  if not ok then error(result, 0) end
  if coroutine.status(j.co) == "dead" then j.done, j.result = true, result end
  return j.result
end

function work.forget() jobs = {} end

return work
