-- nova.timers: delayed calls, repeating calls, coroutines that can wait, and tweens.
-- All of them run in game time (a paused or slowed game delays them too) and are
-- cancelled for good when the entity or scene that owns them is destroyed.
--
--   self:after(1.5, function() ... end)              once, in 1.5 seconds
--   self:every(2, function() ... end)                every 2 seconds until cancelled
--   self:go(function() nova.wait(0.5) ... end)       a little script that can wait
--   self:tween({ x = 100, alpha = 0 }, 0.4, "out_quad")   glide fields to new values
-- Each returns a handle with :cancel().
local M = {}

local list = {} -- every running thing, in the order it was made
local pending = {}

local ease = {
  linear = function(t) return t end,
  in_quad = function(t) return t * t end,
  out_quad = function(t) return 1 - (1 - t) * (1 - t) end,
  in_out_quad = function(t) return t < 0.5 and 2 * t * t or 1 - (-2 * t + 2) ^ 2 / 2 end,
  in_cubic = function(t) return t * t * t end,
  out_cubic = function(t) return 1 - (1 - t) ^ 3 end,
  in_out_cubic = function(t) return t < 0.5 and 4 * t * t * t or 1 - (-2 * t + 2) ^ 3 / 2 end,
  out_back = function(t)
    local c1, c3 = 1.70158, 2.70158
    return 1 + c3 * (t - 1) ^ 3 + c1 * (t - 1) ^ 2
  end,
  out_bounce = function(t)
    local n1, d1 = 7.5625, 2.75
    if t < 1 / d1 then return n1 * t * t
    elseif t < 2 / d1 then t = t - 1.5 / d1; return n1 * t * t + 0.75
    elseif t < 2.5 / d1 then t = t - 2.25 / d1; return n1 * t * t + 0.9375
    else t = t - 2.625 / d1; return n1 * t * t + 0.984375 end
  end,
}
M.ease = ease

local Handle = {}
Handle.__index = Handle
function Handle:cancel() self.dead = true end

local function add(t)
  t.dead = false
  setmetatable(t, Handle)
  pending[#pending + 1] = t
  return t
end

function M.after(owner, seconds, fn) return add({ owner = owner, left = seconds, fn = fn }) end
function M.every(owner, seconds, fn)
  if seconds <= 0 then error("every(): the interval must be greater than 0", 3) end
  return add({ owner = owner, left = seconds, every = seconds, fn = fn })
end
function M.go(owner, fn) return add({ owner = owner, co = coroutine.create(fn), left = 0 }) end
function M.tween(owner, target, props, seconds, easing, on_done)
  if easing ~= nil and ease[easing] == nil then
    error("tween(): unknown easing '" .. tostring(easing) .. "'", 3)
  end
  local from = {}
  for k in pairs(props) do from[k] = target[k] end
  return add({
    owner = owner, tween = true, target = target, from = from, to = props, time = 0,
    total = math.max(seconds, 1e-6), ease = ease[easing or "out_quad"], on_done = on_done,
  })
end

-- nova.wait(seconds) inside a go() script pauses it; nova.wait_until(fn) waits for fn() to be true.
function M.wait(seconds) coroutine.yield(seconds or 0) end
function M.wait_until(fn) coroutine.yield(fn) end

local function alive(t) return not t.dead and not (t.owner and t.owner._dead) end

function M.update(dt)
  for i = 1, #pending do
    list[#list + 1] = pending[i]
    pending[i] = nil
  end
  local count = #list
  for i = 1, count do
    local t = list[i]
    if alive(t) then
      if t.tween then
        t.time = t.time + dt
        local k = math.min(1, t.time / t.total)
        local e = t.ease(k)
        local target = t.target
        for key, to in pairs(t.to) do target[key] = t.from[key] + (to - t.from[key]) * e end
        if k >= 1 then
          t.dead = true
          if t.on_done then t.on_done(target) end
        end
      elseif t.co then
        local ready
        if t.cond then ready = t.cond() else t.left = t.left - dt; ready = t.left <= 0 end
        if ready then
          t.cond = nil
          local ok, res = coroutine.resume(t.co)
          if not ok then
            t.dead = true
            error(debug and debug.traceback(t.co, tostring(res)) or tostring(res), 0)
          end
          if coroutine.status(t.co) == "dead" then t.dead = true
          elseif type(res) == "function" then t.cond = res
          else t.left = res or 0 end
        end
      else
        t.left = t.left - dt
        if t.left <= 0 then
          if t.every then t.left = t.left + t.every else t.dead = true end
          t.fn(t.owner)
        end
      end
    end
  end
  local j = 0
  for i = 1, #list do
    local t = list[i]
    if alive(t) then
      j = j + 1
      list[j] = t
    end
  end
  for i = #list, j + 1, -1 do list[i] = nil end
end

function M.clear()
  for i = #list, 1, -1 do list[i] = nil end
  for i = #pending, 1, -1 do pending[i] = nil end
end

function M.count() return #list + #pending end

return M
