-- The car select (2026-11-21), for the garage and for choosing the car before a race: one car at a time on a stage in the top of the
-- screen, turning slowly by itself (or by the right stick), the details of the car beside it, and along the bottom a carousel of cards
-- (the make's logo, the car's name, its class) with the current car's card in the middle and larger. This module is the picture and its
-- motion; what A, B and the shoulder buttons do is in scenes/title.lua (Title:garage_menu).
local state = require("lib.state")
local ui = require("lib.ui")
local menu_bg = require("lib.menu_bg")

local garage = {}
local C, F = ui.color, ui.font

garage.AUTO = 2 * math.pi / 20   -- the slow turn: one turn in twenty seconds (radians a second)
garage.HAND = 3.4                -- the fastest the right stick spins the car
garage.IDLE = 3.0                -- seconds without the right stick before the car eases back into the slow turn
garage.SLIDE = 0.25              -- seconds a change of car takes
local TILT_MIN, TILT_MAX = -0.08, 0.30
local START_ANGLE = 0.55

local function clamp(v, lo, hi) return math.max(lo, math.min(hi, v)) end
local function ease(t) t = clamp(t, 0, 1); return t * t * (3 - 2 * t) end
local function wrap(i, n) return (i - 1) % n + 1 end

-- ---- the stage's state -----------------------------------------------------------------------------------------------------------
-- `at` is the index in the list of the car shown first. `tpos` is the carousel's place (an index that is not wrapped, so going round
-- the end slides on instead of back); `pos` is where the cards are drawn, easing to it.
function garage.new(list, at)
  return { list = list, tpos = at, pos = at, cur = at, off = 0, leaving = nil, slide = 1, dir = 1,
           ang = START_ANGLE, omega = garage.AUTO, tilt = 0, idle = garage.IDLE, hand = false, held = 0, hold_t = 0 }
end

function garage.index(st) return wrap(st.tpos, #st.list) end

-- Moves the choice `delta` cars along the list (negative: back), wrapping at the ends.
function garage.move(st, delta)
  if delta == 0 then return end
  st.tpos = st.tpos + delta
  local now = garage.index(st)
  if now == st.cur then return end
  -- the car on show slides out the way the new one is not coming from, from wherever it had got to
  st.leaving = { idx = st.cur, from = st.off, to = delta > 0 and -1 or 1, t = 0 }
  st.cur, st.off, st.dir = now, delta > 0 and 1 or -1, delta > 0 and 1 or -1
  st.slide = 0
end

-- The index of the first car of the make `step` makes on from the car shown (the list is in make order).
function garage.make_jump(st, step)
  local list, n = st.list, #st.list
  local here = list[garage.index(st)].make
  local makes = {}
  for i, c in ipairs(list) do
    if c.make ~= (list[i - 1] or {}).make then makes[#makes + 1] = { make = c.make, first = i } end
  end
  local at = 1
  for k, m in ipairs(makes) do if m.make == here then at = k end end
  local target = makes[wrap(at + step, #makes)].first
  local cur = garage.index(st)
  -- (forward for R, back for L: the shorter way round would send R backwards from the last make's first car)
  local delta = step > 0 and (target - cur) % n or -((cur - target) % n)
  if delta == 0 then delta = step > 0 and n or -n end
  return delta
end

-- One frame: the slide, the carousel, and the turn (the right stick spins the car with a little weight; let go, and after IDLE seconds it
-- eases back into the slow turn). `stick_x`, `stick_y` are the right stick (up is negative y).
function garage.update(st, dt, stick_x, stick_y)
  dt = clamp(dt, 0, 0.1)
  if st.slide < 1 then
    st.slide = math.min(1, st.slide + dt / garage.SLIDE)
    local e = ease(st.slide)
    st.off = st.dir * (1 - e)
    if st.leaving then st.leaving.t = e end
    if st.slide >= 1 then st.off, st.leaving = 0, nil end
  end
  st.pos = st.pos + (st.tpos - st.pos) * (1 - math.exp(-dt * 13))
  if math.abs(st.tpos - st.pos) < 0.002 then st.pos = st.tpos end
  local active = math.abs(stick_x) > 0.15 or math.abs(stick_y) > 0.15
  if active then st.idle = 0 else st.idle = st.idle + dt end
  local target, rate
  if math.abs(stick_x) > 0.15 then
    -- (right drags the side that faces you to the right: the car's front, seen from the front, goes to the right with a positive turn)
    target, rate = stick_x * garage.HAND, 9
  elseif st.idle < garage.IDLE then
    target, rate = 0, 2.2            -- coasts to a stop
  else
    target, rate = garage.AUTO, 0.9  -- and then eases back into the slow turn
  end
  st.omega = st.omega + (target - st.omega) * (1 - math.exp(-dt * rate))
  st.ang = st.ang + st.omega * dt
  if st.ang > 1e4 then st.ang = st.ang % (2 * math.pi) end
  if math.abs(stick_y) > 0.15 then
    st.tilt = clamp(st.tilt + stick_y * 0.9 * dt, TILT_MIN, TILT_MAX)
  elseif st.idle >= garage.IDLE then
    st.tilt = st.tilt + (0 - st.tilt) * (1 - math.exp(-dt * 1.2))
  end
  local was = st.hand
  st.hand = st.idle < garage.IDLE
  return was, st.hand
end

-- The shown cars (the one on show, and the one sliding out), for the 3D picture.
function garage.shown(st)
  local out = { { car = st.list[st.cur], off = st.off } }
  if st.leaving then
    local l = st.leaving
    out[#out + 1] = { car = st.list[l.idx], off = l.from + (l.to - l.from) * l.t }
  end
  return out
end

function garage.draw3d(st)
  menu_bg.stage(garage.shown(st), st.ang, st.tilt, state.make_of(st.list[st.cur]))
end

-- ---- the carousel ---------------------------------------------------------------------------------------------------------------
-- Cards by distance from the middle: the current car's is the widest, those further out smaller and dimmer.
local WIDTH = { [0] = 196, 134, 106, 86, 72 }
local HEIGHT = { [0] = 108, 84, 68, 56, 48 }
local SHADE = { [0] = 1, 0.86, 0.62, 0.4, 0.2 }
local GAP = 8
local function at_distance(tbl, a)
  local k = math.min(3, math.floor(a))
  local f = a - k
  return tbl[k] + (tbl[k + 1] - tbl[k]) * f
end
-- where the middle of a card `a` (0 to 4) cards from the current one is, from the carousel's middle
local OFFSETS = { [0] = 0 }
for k = 1, 4 do OFFSETS[k] = OFFSETS[k - 1] + (WIDTH[k - 1] + WIDTH[k]) / 2 + GAP end
local function centre_at(a)
  local k = math.min(3, math.floor(a))
  return OFFSETS[k] + (OFFSETS[k + 1] - OFFSETS[k]) * (a - k)
end

local function alpha(c, a) return { c[1], c[2], c[3], math.floor(255 * a + 0.5) } end

-- the line under a card's name: what it costs, or that it is yours
function garage.tag(car, chosen)
  if state.owns(car.id) then return state.cars[chosen] == car and "DRIVING" or "OWNED", C.green end
  return (car.starter and "STARTER  " or "") .. state.money(car.price), C.gold
end

local function card(car, cx, cy, w, h, shade, focus, chosen)
  local owned = state.owns(car.id)
  local make = state.make_of(car)
  local s = w / WIDTH[0]
  local x, y = cx - w / 2, cy - h / 2
  nova.ui.rect(x, y, w, h, alpha(focus and C.panel2 or C.panel, 0.95 * shade + 0.05))
  nova.ui.rect(x, y, w, 3, alpha(make.color, shade * (focus and 1 or 0.8)))
  if focus then
    local o = alpha(C.orange, shade)
    nova.ui.rect(x - 2, y - 2, w + 4, 2.5, o); nova.ui.rect(x - 2, y + h - 0.5, w + 4, 2.5, o)
    nova.ui.rect(x - 2, y, 2.5, h, o); nova.ui.rect(x + w - 0.5, y, 2.5, h, o)
  end
  local logo = h * 0.42
  local logo_y = y + 7 + logo / 2
  nova.ui.sprite(make.logo, cx, logo_y, { w = logo, h = logo, color = owned and { 255, 255, 255, math.floor(255 * shade) } or { 120, 124, 132, math.floor(220 * shade) } })
  if not owned then ui.lock(cx + logo * 0.18, logo_y + logo * 0.02, logo * 0.4, alpha(C.white, shade)) end
  ui.say(cx - (w - 12) / 2, y + 7 + logo + 3 * s, string.upper(car.name), focus and F.heavy or F.bold, 22 * s, alpha(owned and C.white or C.dim, shade),
    { align = "center", width = w - 12, fit = "shrink", spacing = 0.03 })
  if s > 0.6 then
    local tag, colour = garage.tag(car, chosen)
    local label = string.upper(state.class_of(car).name)
    ui.say(cx - (w - 8) / 2, y + h - 7 - 7 * s, focus and tag or label, F.bold, 13 * s, alpha(focus and colour or C.dim, shade),
      { align = "center", width = w - 8, fit = "shrink", spacing = 0.08, valign = "middle" })
  end
end

-- The row of cards, its middle at `cy`. `chosen` is the index in state.cars of the car the player drives now.
function garage.carousel(st, cy, chosen)
  local w = nova.view()
  local n = #st.list
  local mid = w / 2
  local base = math.floor(st.pos + 0.5)
  -- the far ones first, so the near ones lie over them
  for k = 4, 0, -1 do
    for _, side in ipairs(k == 0 and { 0 } or { -1, 1 }) do
      local idx = base + side * k
      local rel = idx - st.pos
      local a = math.abs(rel)
      if a < 4.2 then
        local x = mid + (rel < 0 and -1 or 1) * centre_at(math.min(a, 4))
        local cw, ch = at_distance(WIDTH, math.min(a, 4)), at_distance(HEIGHT, math.min(a, 4))
        local shade = at_distance(SHADE, math.min(a, 4)) * (a > 3.2 and (4.2 - a) or 1)
        card(st.list[wrap(idx, n)], x, cy, cw, ch, shade, a < 0.5, chosen)
      end
    end
  end
end

return garage
