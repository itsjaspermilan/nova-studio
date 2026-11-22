-- The faces of the cast (character3d_make's animal people): eyes, brows and a mouth, each a set of parts of the head of which one is
-- shown. An expression is one of each; on top of it the eyes blink now and then, and while a line is being said the mouth opens and
-- shuts. `face.parts(f)` gives the `parts` table for nova.model / anim:draw.
local face = {}

local HIDE = 0.12 -- (how far back inside the head the parts that are not shown wait: FACE_HIDE in the maker)
local SETS = {
  { "eye_open", "eye_happy", "eye_wide", "eye_shut" },
  { "brow_flat", "brow_frown", "brow_up", "brow_sad" },
  { "mouth_closed", "mouth_open", "mouth_smile", "mouth_frown" },
}
local FIRST = { eye_open = true, brow_flat = true, mouth_closed = true }

-- each expression as the eyes, brows and mouth it shows (the maker's EXPRESSIONS)
face.EXPRESSIONS = {
  neutral = { "eye_open", "brow_flat", "mouth_closed" },
  smile = { "eye_open", "brow_flat", "mouth_smile" },
  happy = { "eye_happy", "brow_up", "mouth_smile" },
  delighted = { "eye_wide", "brow_up", "mouth_open" },
  gruff = { "eye_open", "brow_frown", "mouth_frown" },
  sad = { "eye_open", "brow_sad", "mouth_frown" },
  surprised = { "eye_wide", "brow_up", "mouth_open" },
  indignant = { "eye_open", "brow_frown", "mouth_open" },
}

-- A face's state; `seed` spreads the blinks of different characters apart.
function face.new(seed)
  return { expr = "neutral", blink = 0, wait = 1.5 + (seed or 0) % 1.7, seed = seed or 1, talking = false, open = false, flap = 0, hold = 0, table = {} }
end

-- Shows an expression (for `seconds`, then back to neutral; for good when left out).
function face.set(f, expr, seconds)
  if not face.EXPRESSIONS[expr] then error("no expression '" .. tostring(expr) .. "'", 2) end
  f.expr, f.hold = expr, seconds or 0
end

function face.update(f, dt)
  -- a blink every few seconds (a little irregular, the same every run)
  f.wait = f.wait - dt
  if f.wait <= 0 then
    f.blink, f.seed = 0.13, (f.seed * 16807) % 2147483647
    f.wait = 2.4 + (f.seed % 1000) / 1000 * 2.6
  end
  f.blink = math.max(0, f.blink - dt)
  -- the mouth while talking: open and shut a few times a second
  if f.talking then
    f.flap = f.flap - dt
    if f.flap <= 0 then f.open, f.flap = not f.open, f.open and 0.07 or 0.11 end
  else
    f.open = false
  end
  if f.hold > 0 then
    f.hold = f.hold - dt
    if f.hold <= 0 then f.expr = "neutral" end
  end
end

function face.parts(f, into)
  local t = into or f.table
  local e = face.EXPRESSIONS[f.expr] or face.EXPRESSIONS.neutral
  for i, set in ipairs(SETS) do
    local want = e[i]
    if i == 1 and f.blink > 0 then want = "eye_shut" end
    if i == 3 and f.open then want = want == "mouth_open" and "mouth_smile" or "mouth_open" end
    for _, name in ipairs(set) do
      local p = t[name]
      if not p then p = {}; t[name] = p end
      local shown = name == want
      if FIRST[name] then p.z = shown and 0 or -HIDE else p.z = shown and HIDE or 0 end
    end
  end
  return t
end

-- Which parts show now (for tests and the log): eyes, brows, mouth.
function face.showing(f)
  local e = face.EXPRESSIONS[f.expr] or face.EXPRESSIONS.neutral
  return e[1], e[2], e[3]
end

return face
