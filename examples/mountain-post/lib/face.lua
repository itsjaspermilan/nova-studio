-- The faces of the cast (character3d_make's animal people): the eyes, the brows and the mouth are painted on the head, each in a
-- few drawings, every drawing a part of the head of which one of each set is shown (the model hides all but the first of each at
-- rest; `visible` shows and hides them). An expression is one drawing of each set; on top of it the eyes blink now and then, and
-- while a line is being said the mouth goes back and forth with its open partner. `face.parts(f)` gives the `parts` table for
-- nova.model / anim:draw.
local face = {}

local SETS = {
  { "eye_open", "eye_happy", "eye_wide", "eye_half", "eye_shut" },
  { "brow_flat", "brow_frown", "brow_up", "brow_sad" },
  { "mouth_closed", "mouth_smile", "mouth_open", "mouth_grin", "mouth_frown", "mouth_o" },
}

-- each expression as the eyes, brows and mouth it shows (the maker's EXPRESSIONS)
face.EXPRESSIONS = {
  neutral = { "eye_open", "brow_flat", "mouth_closed" },
  smile = { "eye_open", "brow_flat", "mouth_smile" },
  happy = { "eye_happy", "brow_up", "mouth_smile" },
  delighted = { "eye_happy", "brow_up", "mouth_grin" },
  gruff = { "eye_half", "brow_frown", "mouth_frown" },
  dry = { "eye_half", "brow_flat", "mouth_closed" },
  sad = { "eye_open", "brow_sad", "mouth_frown" },
  surprised = { "eye_wide", "brow_up", "mouth_o" },
  indignant = { "eye_open", "brow_frown", "mouth_open" },
}

-- while talking, each mouth goes back and forth with this one (the maker's TALK)
face.TALK = {
  mouth_closed = "mouth_open", mouth_smile = "mouth_grin", mouth_open = "mouth_closed",
  mouth_grin = "mouth_smile", mouth_frown = "mouth_open", mouth_o = "mouth_closed",
}

-- A face's state; `seed` spreads the blinks of different characters apart; `rest` is the face they wear when nothing in particular
-- is on their mind ("neutral" when left out: Hazel's is "dry", half-lidded).
function face.new(seed, rest)
  return { expr = "neutral", rest = rest or "neutral", blink = 0, wait = 1.5 + (seed or 0) % 1.7, seed = seed or 1, talking = false, open = false, flap = 0, hold = 0, table = {} }
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

-- The expression's drawings, as shown now: eyes, brows, mouth (with the blink and the talking mouth).
function face.showing(f)
  local e = face.EXPRESSIONS[f.expr == "neutral" and f.rest or f.expr] or face.EXPRESSIONS.neutral
  local eyes, brows, mouth = e[1], e[2], e[3]
  if f.blink > 0 then eyes = "eye_shut" end
  if f.open then mouth = face.TALK[mouth] or "mouth_open" end
  return eyes, brows, mouth
end

function face.parts(f, into)
  local t = into or f.table
  local want = { face.showing(f) }
  for i, set in ipairs(SETS) do
    for _, name in ipairs(set) do
      local p = t[name]
      if not p then p = {}; t[name] = p end
      p.visible = name == want[i]
    end
  end
  return t
end

return face
