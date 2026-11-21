-- Banners for the big moments, used everywhere: LET'S GO!, ROOM 3 / 8, CLEARED!, ELITE!, the boss's name card, DISTRICT CLEARED!, the death line.
-- A banner slams in with a little overshoot (it comes down big, dips under its size and settles), holds, and is whipped off to the right. It never
-- pauses play and sits in the upper screen, above the runner. Two lanes: "big" (a band with a headline and an optional line under it) and "tag" (a small
-- tab below it, for the room counter); a second big banner waits for the first. Looks, holds and sounds: data/flow.lua. Text: lib/type.lua.
--
--   Banner.show("clear", { text = "CLEARED!", sub = "+12 scrap  +1 key" })
--   Banner.tick(dt)    in a scene's update (a paused menu stops it, play does not)
--   Banner.draw()      last in a scene's draw_ui (before the wipe)
local Flow = require("data.flow")
local Ty = require("lib.type")
local Wipe = require("lib.wipe")

local W = 960
local B = { list = {} }

local function clamp(x, a, b) return math.max(a, math.min(b, x)) end
local function ease_out(t) return 1 - (1 - t) ^ 3 end

function B.clear() B.list = {} end

-- Shows a banner of `kind` (data/flow.lua `banners`). `text` the headline; `sub` a line under it; `color` overrides the headline's colour; `hold`
-- overrides the time. Returns the banner.
function B.show(kind, o)
  local def = Flow.banners[kind] or error("no banner kind " .. tostring(kind))
  local b = { kind = kind, def = def, text = o.text, sub = o.sub, sub2 = o.sub2, color = o.color or def.color, t = 0, hold = o.hold or def.hold, started = false }
  -- a big banner waits while another big one is up (at most one waits: the newest replaces an older waiting one)
  if def.lane == "big" then
    for i = #B.list, 1, -1 do
      local o2 = B.list[i]
      if o2.def.lane == "big" and (def.cut or not o2.started) then table.remove(B.list, i) end   -- (`cut`: this one takes the screen at once)
    end
  else
    for i = #B.list, 1, -1 do if B.list[i].def.lane == "tag" then table.remove(B.list, i) end end
  end
  B.list[#B.list + 1] = b
  nova.log(string.format("banner: %s %s", kind, o.text or ""))
  return b
end

local function total(b) return Flow.slam + b.hold + Flow.whip end

function B.tick(dt)
  for i = #B.list, 1, -1 do
    local b = B.list[i]
    if b.started then
      b.t = b.t + dt
      if b.t >= total(b) then table.remove(B.list, i) end
    end
  end
  -- a banner starts when no other of its lane is on screen (the oldest waiting one first)
  local busy = {}
  for _, b in ipairs(B.list) do if b.started then busy[b.def.lane] = true end end
  for _, b in ipairs(B.list) do
    if not b.started and not busy[b.def.lane] then
      b.started, busy[b.def.lane] = true, true
      -- (never over the runner: a runner in the upper half of the screen gets the banners in the lower half)
      local r = B.runner
      if r and r.x then local _, sy = nova.cam.to_screen(r.x, r.y); b.flip = sy < 300 end
      if b.def.sfx then nova.sound.play(b.def.sfx, { volume = Flow.sfx[b.def.sfx] or 0.6 }) end
    end
  end
end

-- The words of the visible banners (tests ask).
function B.visible()
  local out = {}
  for _, b in ipairs(B.list) do if b.started then out[#out + 1] = b.kind .. ":" .. (b.text or "") end end
  return table.concat(out, "|")
end

-- ---- drawing
-- the slam: scale 2.1 -> 0.9 -> 1; the whip: slides right and fades
local function pose(b)
  local t, slam, whip = b.t, Flow.slam, Flow.whip
  if t < slam then
    local p = t / slam
    local scale = p < 0.7 and (2.1 - 1.2 * ease_out(p / 0.7)) or (0.9 + 0.1 * (p - 0.7) / 0.3)
    return scale, clamp(p * 2.5, 0, 1), 0
  end
  local out = t - slam - b.hold
  if out > 0 then
    local q = clamp(out / whip, 0, 1)
    return 1, 1 - q * q, q * q * q * (W + 200)
  end
  return 1, 1, 0
end

local function draw_big(b)
  local def = b.def
  local scale, a, dx = pose(b)
  local role = def.role
  local base = Ty.units(role) * (def.size or 1)
  local size = math.floor(base * scale / 2 + 0.5) * 2         -- (whole even sizes: the glyphs are cached by size)
  local top = b.flip and 312 or 92
  local bh = 84 + ((b.sub and b.sub ~= "") and 24 or 0)
  local col = b.color
  local edge = def.edge
  -- the band: dark, leaning, with a neon edge above and below; it grows from the middle while the text slams in
  local grow = clamp(b.t / (Flow.slam * 0.8), 0, 1)
  local h = bh * ease_out(grow)
  local y0 = top + (bh - h) / 2
  local ax = dx
  local Wp = Wipe.para
  Wp(-60 + ax, y0, W + 160, h, 56, { 5, 6, 18, 215 * a })
  if h > 12 then
    Wp(-60 + ax, y0 - 5, W + 160, 5, 56, { edge[1], edge[2], edge[3], 255 * a })
    Wp(-60 + ax, y0 + h, W + 160, 5, 56, { edge[1], edge[2], edge[3], 255 * a })
  end
  local ty = top + 6 + (base - size) * 0.1
  Ty.text(ax, ty, b.text, role, { size = size / Ty.scale, color = { col[1], col[2], col[3], 255 * a }, align = "center", width = W })
  if b.sub and b.sub ~= "" then
    local sa = a
    if def.delay_sub then sa = a * clamp((b.t - Flow.slam - def.delay_sub) / 0.2, 0, 1) end
    local role2 = "body"
    Ty.text(ax, top + bh - 34, b.sub, role2, { color = { 235, 240, 255, 255 * sa }, align = "center", width = W })
  end
end

local function draw_tag(b)
  local scale, a, dx = pose(b)
  local ease = ease_out(clamp(b.t / Flow.slam, 0, 1))
  local text = b.text
  local role = b.def.role
  local w = Ty.width(text, role, { spacing = 0.06 }) + 56
  local x = (W - w) / 2 - (1 - ease) * 420 - dx
  local y = b.flip and 432 or 190
  local edge = b.def.edge
  local Wp = Wipe.para
  Wp(x, y, w, 38, 22, { 5, 6, 18, 220 * a })
  Wp(x, y + 38, w, 4, 22, { edge[1], edge[2], edge[3], 255 * a })
  Ty.text(x, y + 6, text, role, { color = { b.color[1], b.color[2], b.color[3], 255 * a }, align = "center", width = w, spacing = 0.06 })
end

function B.draw()
  for _, b in ipairs(B.list) do
    if b.started then
      if b.def.lane == "big" then draw_big(b) else draw_tag(b) end
    end
  end
end

return B
