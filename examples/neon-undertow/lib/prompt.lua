-- Prompts for things that can be used, like Dead Cells: nothing is labelled from afar. When the runner is near something usable (about 1.6 tiles) a
-- small panel rises just above it and fades in (0.12 s): the A button, its name, one short line, and its price. ONLY THE NEAREST usable thing shows
-- one; it slides away when the runner leaves or uses it. From far away a usable thing carries only a quiet cue: a tiny bobbing chevron and a soft glint.
--
-- A scene, every frame in `update`:
--     local list = { { key = "bench", x = wx, y = wy_top, name = "WORKBENCH", line = "Spend keys on upgrades.", price = nil, near = distance_in_units }, ... }
--     Prompt.update(dt, list, enabled)       picks the nearest one within reach (the thing to use with A: `Prompt.target`)
-- and in `draw_ui`:  Prompt.draw()    (and `Prompt.cue(...)` for each usable thing that is not the target, from `Prompt.draw`).
-- An item may also have `walk = true` (a doorway: an arrow instead of the A button), `color`, `lines` (extra small lines). Numbers: data/flow.lua `prompt`.
local Flow = require("data.flow")
local Ty = require("lib.type")
local F = Flow.prompt

local W, H = 960, 540
local Prompt = { target = nil, shown = {}, items = {}, hidden = {} }

local function clamp(x, a, b) return math.max(a, math.min(b, x)) end
local function ease_out(t) return 1 - (1 - t) ^ 3 end

-- A scene calls this when it starts: no panels, and the runner whom the panels keep clear of.
function Prompt.reset(runner) Prompt.target, Prompt.shown, Prompt.items, Prompt.hidden, Prompt.runner = nil, {}, {}, {}, runner end

-- The runner used `key`: its prompt slides away and stays away for a moment.
function Prompt.used(key) Prompt.hidden[key] = F.back end

-- The distance from the point (px, py) to the box x0..x1, y0..y1 (0 inside it).
function Prompt.box_distance(px, py, x0, y0, x1, y1)
  local dx = math.max(x0 - px, 0, px - x1)
  local dy = math.max(y0 - py, 0, py - y1)
  return math.sqrt(dx * dx + dy * dy)
end

-- Picks the nearest of `list` (each with `near`, its distance from the runner, nil when it is not usable now) within reach. `enabled` false (a menu or
-- a talk is open) shows none. Returns the item (the thing the scene uses with A) or nil.
function Prompt.update(dt, list, enabled)
  Prompt.items = list or {}
  Prompt.enabled = enabled ~= false
  for k, v in pairs(Prompt.hidden) do
    Prompt.hidden[k] = v - dt
    if Prompt.hidden[k] <= 0 then Prompt.hidden[k] = nil end
  end
  local best, bd = nil, F.reach
  if enabled ~= false then
    for _, it in ipairs(Prompt.items) do
      if it.near and it.near <= bd then best, bd = it, it.near end
    end
  end
  Prompt.target = best
  -- the panels: the target fades in, every other one fades out (and is dropped when gone)
  local rate_in, rate_out = 1 / F.fade, 1 / (F.fade * 1.3)
  for key, s in pairs(Prompt.shown) do
    local want = best and best.key == key and not Prompt.hidden[key]
    if want then s.k = math.min(1, s.k + dt * rate_in) else s.k = s.k - dt * rate_out end
    if s.k <= 0 then Prompt.shown[key] = nil end
  end
  if best and not Prompt.hidden[best.key] then
    local s = Prompt.shown[best.key]
    if not s then s = { k = 0 }; Prompt.shown[best.key] = s end
    s.item = best
    if s.k == 0 then s.k = math.min(1, dt * rate_in) end
  end
  return best
end

-- The number of panels on screen and the name of the one fully up (tests ask).
function Prompt.count()
  local n = 0
  for _, s in pairs(Prompt.shown) do if s.k > 0 then n = n + 1 end end
  return n
end

function Prompt.visible_key()
  for key, s in pairs(Prompt.shown) do if s.k >= 1 then return key end end
  return nil
end

-- ---- drawing
-- The button glyph: a round-cornered square in the accent colour with the letter engraved on the pad (nova.input.prompt) on it. Returns its width.
function Prompt.badge(x, y, label, color)
  local s = 26
  nova.ui.rect(x + 3, y, s - 6, s, { 4, 5, 16, color[4] or 255 })
  nova.ui.rect(x, y + 3, s, s - 6, { 4, 5, 16, color[4] or 255 })
  nova.ui.rect(x + 4, y + 1, s - 8, s - 2, color)
  nova.ui.rect(x + 1, y + 4, s - 2, s - 8, color)
  Ty.text(x, y + 1, label, "small", { color = { 5, 8, 24, color[4] or 255 }, align = "center", width = s, outline = false })
  return s
end
local badge = Prompt.badge

local function arrow(x, y, color)
  -- a doorway: an arrow pointing right on a dark chip
  nova.ui.rect(x + 3, y, 20, 26, { 4, 5, 16, 255 })
  nova.ui.rect(x, y + 3, 26, 20, { 4, 5, 16, 255 })
  nova.ui.rect(x + 4, y + 11, 12, 4, color)
  nova.ui.line(x + 12, y + 5, x + 20, y + 13, 4, color)
  nova.ui.line(x + 12, y + 21, x + 20, y + 13, 4, color)
  return 26
end

local function panel(it, k)
  local e = ease_out(clamp(k, 0, 1))
  local col = it.color or { 53, 230, 255 }
  local name, line = it.name, it.line
  local maxw = F.width
  local pad = 12
  local nw = Ty.width(name, "name")
  local price = it.price
  local pw = price and (Ty.width(price, "small") + 14) or 0
  local lw, lh = 0, 0
  if line and line ~= "" then lw, lh = Ty.size(line, "small", { width = maxw }) end
  local extra = it.lines or {}
  local ew = 0
  for _, l in ipairs(extra) do ew = math.max(ew, Ty.width(l, "tiny")) end
  local head = 26 + 8 + nw + pw
  local w = math.max(head, lw, ew) + pad * 2
  w = math.min(w, maxw + pad * 2 + 20)
  local h = 6 + 28 + (lh > 0 and (lh + 4) or 0) + (#extra * 18) + pad
  -- above the thing, a little to rise from
  local sx, sy = nova.cam.to_screen(it.x, it.y)
  local x = clamp(sx - w / 2, 8, W - w - 8)
  local y = sy - h - 16 + (1 - e) * 14
  y = math.max(y, 58)
  -- (never over the runner: when the runner stands behind the thing, the panel goes above the runner's head instead)
  local r = Prompt.runner
  if r and r.x then
    local rx, ry = nova.cam.to_screen(r.x, r.y)
    local ax0, ax1, ay0, ay1 = rx - 44, rx + 44, ry - 140, ry + 6
    if x < ax1 and x + w > ax0 and y < ay1 and y + h > ay0 then
      if ay0 - h - 8 >= 58 then
        y = ay0 - h - 8
      else
        -- (no room above the runner's head: beside the runner, on the side with room)
        local right = ax1 + 8
        x = (right + w <= W - 8) and right or math.max(8, ax0 - w - 8)
      end
    end
  end
  local a = e
  local edge = { col[1], col[2], col[3], 255 * a }
  -- the pointer: a small triangle (three rows) under the panel towards the thing
  local px = clamp(sx, x + 16, x + w - 16)
  nova.ui.rect(x - 2, y - 2, w + 4, h + 4, edge)
  nova.ui.rect(x, y, w, h, { 6, 8, 24, 238 * a })
  if y + h + 8 < sy and sy - (y + h) < 48 then
    nova.ui.rect(px - 7, y + h + 2, 14, 2, edge)
    nova.ui.rect(px - 5, y + h + 4, 10, 2, edge)
    nova.ui.rect(px - 3, y + h + 6, 6, 2, edge)
  end
  local bx, by = x + pad, y + 6
  if it.walk then arrow(bx, by, { col[1], col[2], col[3], 255 * a }) else badge(bx, by, nova.input.prompt("interact"), { col[1], col[2], col[3], 255 * a }) end
  Ty.text(bx + 34, by - 1, name, "name", { color = { 255, 255, 255, 255 * a } })
  if price then Ty.text(x + w - pad - Ty.width(price, "small"), by + 2, price, "small", { color = { 255, 228, 94, 255 * a } }) end
  local ty = by + 28
  if lh > 0 then
    Ty.text(x + pad, ty, line, "small", { color = { 215, 224, 250, 255 * a }, width = maxw })
    ty = ty + lh + 4
  end
  for _, l in ipairs(extra) do
    Ty.text(x + pad, ty, l, "tiny", { color = { 120, 255, 200, 255 * a } })
    ty = ty + 18
  end
end

-- The quiet cue of a usable thing that is not the one in reach: a tiny chevron bobbing over it and a soft pulsing glint.
local function cue(it)
  local sx, sy = nova.cam.to_screen(it.x, it.y)
  if sx < -20 or sx > W + 20 or sy < -20 or sy > H + 20 then return end
  local col = it.color or { 53, 230, 255 }
  local t = nova.time() * 2.4 + (it.x or 0) * 0.013
  local bob = math.sin(t) * 2.5
  local glow = 0.5 + 0.5 * math.sin(t * 0.8)
  nova.circle(sx, sy - 6, 20 + 6 * glow, { col[1], col[2], col[3], 40 + 50 * glow }, { soft = true, blend = "add", lit = false })
  local y = sy - 14 + bob
  -- (a dark underlay so it reads over a bright puddle, then the chevron)
  nova.ui.line(sx - 10, y - 7, sx, y + 3, 8, { 4, 5, 16, 170 })
  nova.ui.line(sx + 10, y - 7, sx, y + 3, 8, { 4, 5, 16, 170 })
  nova.ui.line(sx - 9, y - 6, sx, y + 2, 4, { col[1], col[2], col[3], 170 + 60 * glow })
  nova.ui.line(sx + 9, y - 6, sx, y + 2, 4, { col[1], col[2], col[3], 170 + 60 * glow })
end

function Prompt.draw()
  for _, it in ipairs(Prompt.items) do
    -- (a thing is quiet-cued when it is usable now, is not the target and has no panel left)
    if Prompt.enabled and it.near and not (Prompt.shown[it.key] and Prompt.shown[it.key].k > 0.02) and not it.no_cue then cue(it) end
  end
  for _, s in pairs(Prompt.shown) do
    if s.k > 0 then panel(s.item, s.k) end
  end
end

return Prompt
