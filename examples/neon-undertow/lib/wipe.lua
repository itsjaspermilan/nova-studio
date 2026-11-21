-- The neon wipe between screens: a diagonal shutter in the district's colours closes over the screen, the next scene is loaded behind it (a card or a
-- line of LULLABY's can hold the screen), and the shutter opens on the new scene.
--
--   Wipe.go("gutter.s1_square", { card = Wipe.district_card(seed), actor = runner, to = { x, y } })   leaving the Den for a run
--   Wipe.go(dest)                                                                                   between rooms (a quick wipe each way)
--   Wipe.go("den", { line = "LULLABY: ..." })                                                       back to the Den
--
-- THE RULES (the brief): input is ignored while it runs, and a wipe never hides a moment where the runner can be hurt. So the world is PAUSED from
-- `go` until the shutter has fully opened on the next scene: every scene calls `Wipe.tick(dt)` in its update (it runs while the world is paused),
-- holds its own start while `Wipe.busy()`, and the room's clock, its waves and its doors begin when it has opened.
-- State lives in this module, so it carries over the scene change. Numbers: data/flow.lua.
local Flow = require("data.flow")
local Ty = require("lib.type")
local P = require("data.player")

local W, H = 960, 540
local Wipe = { state = "idle", t = 0, done = 0 }

local function clamp(x, a, b) return math.max(a, math.min(b, x)) end
local function ease_out(t) return 1 - (1 - t) ^ 3 end
local function ease_in_out(t) return t < 0.5 and 4 * t ^ 3 or 1 - (-2 * t + 2) ^ 3 / 2 end

function Wipe.busy() return Wipe.state ~= "idle" end

-- Is the shutter completely closed (the screen is covered, nothing of the scene shows)?
function Wipe.covered() return Wipe.state == "hold" or (Wipe.state == "closing" and Wipe.t >= Wipe.spec.close) end

local last_tag = nil

-- The card of a district run: its name and a tagline the seed picks (never the one of the run before).
function Wipe.district_card(seed, district)
  local d = Flow.districts[district or "gutter"]
  local list = Flow.taglines
  local k = (require("lib.run").mix(seed or 1, 77) % #list) + 1
  if list[k] == last_tag then k = k % #list + 1 end
  last_tag = list[k]
  return { top = d.top, name = d.name, tag = list[k], district = district or "gutter" }
end

-- Starts a wipe towards `dest` (a scene name). `opts`: card (see district_card) or line (a string: LULLABY's), `close`, `hold`, `open` (seconds),
-- `actor` (an entity that steps into the door: it glides to `to` = { x, y } and fades while the shutter closes), `district`.
function Wipe.go(dest, opts)
  if Wipe.state ~= "idle" then return false end
  opts = opts or {}
  local F = Flow.wipe
  local spec = {
    dest = dest, card = opts.card, line = opts.line, district = opts.district or (opts.card and opts.card.district) or "gutter",
    actor = opts.actor, to = opts.to,
  }
  if opts.card then
    spec.close, spec.hold, spec.open = opts.close or F.close, opts.hold or F.card_hold, opts.open or F.open
  elseif opts.line then
    spec.close, spec.hold, spec.open = opts.close or F.close, opts.hold or F.line_hold, opts.open or F.open
  else
    spec.close, spec.hold, spec.open = opts.close or F.room_close, opts.hold or 0.05, opts.open or F.room_open
  end
  spec.actor_from = opts.actor and { x = opts.actor.x, y = opts.actor.y } or nil
  Wipe.spec, Wipe.state, Wipe.t = spec, "closing", 0
  nova.pause(true)
  Wipe.sync()
  nova.sound.play("wipe", { volume = Flow.sfx.wipe })
  nova.log(string.format("wipe: to %s (%s)", tostring(dest), opts.card and "district card" or (opts.line and "LULLABY's line" or "quick")))
  if spec.close <= 0 then Wipe.tick(0) end
  return true
end

-- The text of the scene under (or over) the shutter fades out as it closes and back in as it opens: text cannot be covered by a rectangle, only faded.
function Wipe.sync()
  local s, a = Wipe.spec, 1
  if Wipe.state == "closing" then a = 1 - clamp(Wipe.t / math.max(s.close, 0.01) / 0.45, 0, 1)
  elseif Wipe.state == "hold" then a = 0
  elseif Wipe.state == "opening" then a = clamp((Wipe.t / math.max(s.open, 0.01) - 0.55) / 0.45, 0, 1) end
  Ty.fade = a
end

-- Called by every scene's update, every frame (the world may be paused: the scene's update still runs).
function Wipe.tick(dt)
  if Wipe.state == "idle" then return end
  local s = Wipe.spec
  Wipe.t = Wipe.t + dt
  Wipe.tick_state(s)
  Wipe.sync()
end

function Wipe.tick_state(s)
  if Wipe.state == "closing" then
    local a = s.actor
    if a and s.to and a.x then
      local k = ease_out(clamp(Wipe.t / math.max(s.close, 0.01), 0, 1))
      a.x = s.actor_from.x + (s.to[1] - s.actor_from.x) * k
      a.y = s.actor_from.y + (s.to[2] - s.actor_from.y) * k
      a.alpha = 1 - 0.7 * k
    end
    if Wipe.t >= s.close then
      Wipe.state, Wipe.t = "hold", 0
      if s.dest then nova.goto_scene(s.dest) end
    end
  elseif Wipe.state == "hold" then
    if Wipe.t >= s.hold then Wipe.state, Wipe.t = "opening", 0 end
  elseif Wipe.state == "opening" then
    if Wipe.t >= s.open then
      Wipe.state, Wipe.t, Wipe.spec = "idle", 0, nil
      Wipe.done = Wipe.done + 1          -- (how many wipes have finished: the routes wait for this to change)
      Ty.fade = 1
      nova.log("wipe: open")
    end
  end
end

-- ---------------------------------------------------------------- drawing
local ROW = 3

-- The shutter: `p` 0..1 is how far it has gone. closing: the cover grows from the left, slat by slat from the top; opening (`reveal`): the cover
-- that is left sits on the right and shrinks away. Every row of the slats leans, so the edge is a diagonal; every other row is a hair lighter (scan lines).
local function shutter(p, reveal, pal)
  local F = Flow.wipe
  local n, bh = F.bands, H / F.bands
  local lean, stag = F.lean, F.stagger
  local dark = pal.dark
  local rows = math.ceil(H / ROW)
  for i = 0, rows - 1 do
    local y = i * ROW
    local b = math.min(n - 1, math.floor(y / bh))
    local pb = clamp((p * (1 + stag) - (b / (n - 1)) * stag), 0, 1)
    pb = ease_in_out(pb)
    local slant = ((y - b * bh) / bh) * lean
    local e = -lean + (W + 2 * lean) * pb + slant
    local shade = (i % 2 == 0) and 0 or 9
    local col = { dark[1] + shade, dark[2] + shade, dark[3] + shade + 4, 255 }
    local edge = (b % 2 == 0) and pal.a or pal.b
    -- (the neon edge: a coloured stripe 16 wide with a white hairline on its outer side)
    local function stripe(xa, xb, c)
      xa, xb = clamp(xa, 0, W), clamp(xb, 0, W)
      if xb > xa then nova.ui.rect(xa, y, xb - xa, ROW, c) end
    end
    if not reveal then
      stripe(0, e, col)
      if e > 0 and e < W + 24 then
        stripe(e - 16, e, { edge[1], edge[2], edge[3], 255 })
        stripe(e - 22, e - 16, { 255, 255, 255, 230 })
      end
    else
      stripe(e, W, col)
      if e > -24 and e < W then
        stripe(e, e + 16, { edge[1], edge[2], edge[3], 255 })
        stripe(e + 16, e + 22, { 255, 255, 255, 230 })
      end
    end
  end
end

-- A parallelogram (a band leaning to the right), drawn in rows of 2 units: x, y its top-left, w wide, h tall, `lean` how far the top is shifted right
-- of the bottom. Shared with the banners.
function Wipe.para(x, y, w, h, lean, color)
  local rows = math.max(1, math.floor(h / 2))
  local rh = h / rows
  for i = 0, rows - 1 do
    local t = 1 - (i + 0.5) / rows
    nova.ui.rect(x + lean * (t - 0.5), y + i * rh, w, rh + 0.4, color)
  end
end

local function draw_card(spec, a, t)
  local pal = Flow.districts[spec.district] or Flow.districts.gutter
  -- two leaning neon bars behind the name, sliding in from opposite sides
  local k = ease_out(clamp(t / 0.25, 0, 1))
  Wipe.para(-40 + (1 - k) * -900, 186, 1040, 8, 60, { pal.a[1], pal.a[2], pal.a[3], 255 * a })
  Wipe.para(-100 + (1 - k) * 900, 346, 1040, 8, 60, { pal.b[1], pal.b[2], pal.b[3], 255 * a })
  -- the slam of the name (it comes down a little big, then settles) as the banners do
  local p = clamp(t / 0.22, 0, 1)
  local scale = p < 0.7 and (2.0 - 1.1 * ease_out(p / 0.7)) or (0.9 + 0.1 * (p - 0.7) / 0.3)
  local size = math.floor(Ty.units("banner") * 1.3 * scale / 2 + 0.5) * 2
  Ty.text(0, 210 + (Ty.units("banner") * 1.3 - size) * 0.25, spec.name, "banner", { size = size, color = { 255, 255, 255, 255 * a * math.min(1, p * 2.5) }, align = "center", width = W })
  Ty.text(0, 176 - 22, spec.top, "label", { color = { pal.b[1], pal.b[2], pal.b[3], 255 * a }, align = "center", width = W, spacing = 0.35 })
  Ty.text(70, 366, spec.tag, "big", { color = { 255, 200, 230, 255 * a * clamp((t - 0.25) / 0.2, 0, 1) }, align = "center", width = 820 })
  nova.ui.rect(W / 2 - 150, 430, 300, 3, { 60, 66, 110, 255 * a })
  nova.ui.rect(W / 2 - 150, 430, 300 * clamp(t / Flow.wipe.card_hold, 0, 1), 3, { pal.a[1], pal.a[2], pal.a[3], 255 * a })
end

local function draw_line(spec, a, t)
  local pal = Flow.districts[spec.district] or Flow.districts.gutter
  local p = clamp(t / 0.2, 0, 1)
  Wipe.para(120, 232, 720, 4, 40, { pal.b[1], pal.b[2], pal.b[3], 255 * a })
  Ty.text(80, 252 + (1 - p) * 14, spec.line, "big", { color = { 255, 120, 210, 255 * a * p }, align = "center", width = 800 })
  Wipe.para(120, 322, 720, 4, 40, { pal.a[1], pal.a[2], pal.a[3], 255 * a })
end

function Wipe.draw()
  local keep = Ty.fade
  Ty.fade = 1
  Wipe.draw_cover()
  Ty.fade = keep
end

function Wipe.draw_cover()
  if Wipe.state == "idle" then return end
  local s = Wipe.spec
  local pal = Flow.districts[s.district] or Flow.districts.gutter
  if Wipe.state == "closing" then
    shutter(clamp(Wipe.t / math.max(s.close, 0.01), 0, 1), false, pal)
  elseif Wipe.state == "hold" then
    shutter(1, false, pal)
    if s.card then draw_card(s.card, 1, Wipe.t) elseif s.line then draw_line(s, 1, Wipe.t) end
  else
    local q = clamp(Wipe.t / math.max(s.open, 0.01), 0, 1)
    shutter(q, true, pal)
    local fade = 1 - clamp(q / 0.4, 0, 1)
    if fade > 0 then
      if s.card then draw_card(s.card, fade, Flow.wipe.card_hold) elseif s.line then draw_line(s, fade, 1) end
    end
  end
end

return Wipe
