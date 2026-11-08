-- The wipe between screens: round dots swell from the left until the screen is one colour, the name of the place is written on it, and the dots
-- shrink away when the next screen is ready. The state lives in this module, so the wipe outlives the change of scene: `cover` starts it and
-- calls back once the screen is covered (the callback changes the scene); the new scene calls `reveal`.
local ui = require("lib.ui")

local transition = {}

local IN, OUT, CELL = 0.5, 0.45, 64
local s = { phase = "idle", t = 0 }

-- spec: { title, sub, color }
function transition.cover(spec, on_covered)
  if s.phase == "filling" then return end
  s.phase, s.t, s.spec, s.on_covered = "filling", 0, spec or {}, on_covered
end

function transition.reveal(hold)
  if s.phase == "covered" or s.phase == "filling" then s.phase, s.t, s.hold = "holding", 0, hold or 0.25 end
end

function transition.busy() return s.phase ~= "idle" end
function transition.covered() return s.phase == "covered" or s.phase == "holding" end

function transition.update(dt)
  if s.phase == "idle" then return end
  s.t = s.t + dt
  if s.phase == "filling" and s.t >= IN then
    s.phase, s.t = "covered", 0
    local f = s.on_covered
    s.on_covered = nil
    if f then f() end
  elseif s.phase == "covered" and s.t > 4 then
    s.phase, s.t, s.hold = "holding", 0, 0
  elseif s.phase == "holding" and s.t >= s.hold then
    s.phase, s.t = "clearing", 0
  elseif s.phase == "clearing" and s.t >= OUT then
    s.phase, s.spec = "idle", nil
  end
end

function transition.draw()
  if s.phase == "idle" then return end
  local w, h = nova.view()
  local col = s.spec.color or { 255, 200, 50 }
  local dark = { col[1] * 0.85, col[2] * 0.85, col[3] * 0.85 }
  local p, from_left
  if s.phase == "filling" then p, from_left = s.t / IN, true
  elseif s.phase == "clearing" then p, from_left = 1 - s.t / OUT, false
  else p = 1 end
  if p >= 1 then
    nova.ui.rect(0, 0, w, h, { col[1], col[2], col[3], 255 })
  else
    local cols = math.ceil(w / CELL) + 1
    for cx = 0, cols do
      for cy = 0, math.ceil(h / CELL) do
        local x, y = cx * CELL, cy * CELL
        -- each dot starts a little after the one to its left (filling) or before (clearing)
        local order = (cx + cy * 0.35) / (cols + 3)
        local k = math.max(0, math.min(1, (p - (from_left == false and (1 - order) * 0.5 or order * 0.5)) / 0.5))
        if k > 0 then
          local d = CELL * 1.6 * ui.ease_out(k)
          nova.ui.sprite("ui/disc", x, y, { w = d, h = d, color = { (cx + cy) % 2 == 0 and col[1] or dark[1], (cx + cy) % 2 == 0 and col[2] or dark[2], (cx + cy) % 2 == 0 and col[3] or dark[3], 255 } })
        end
      end
    end
  end
  local show = (s.phase == "covered" or s.phase == "holding") and math.min(1, s.t / 0.2 + (s.phase == "holding" and 1 or 0)) or 0
  if show > 0.02 and s.spec.title then
    local old = ui.alpha
    ui.alpha = show
    local pop = ui.ease_back(math.min(1, (s.phase == "holding" and 1 or s.t / 0.3)))
    local size = math.floor(ui.HEAD * (0.7 + 0.3 * pop))
    if s.spec.sub then ui.center(s.spec.sub, h / 2 - 66, ui.LARGE, ui.color.white) end
    ui.center(s.spec.title, h / 2 - 22, ui.fit(s.spec.title, size, w * 0.86), ui.color.white)
    ui.alpha = old
  end
end

return transition
