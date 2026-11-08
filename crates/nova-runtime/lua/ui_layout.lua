-- Menus and HUDs: a menu or HUD is a tree of plain tables (rows, columns, grids, panels, text, buttons, pictures), laid out from the
-- screen's edges and centre every frame, so nothing is placed by hand and nothing runs off its box. `nova.ui.menu` also moves a focus
-- between the buttons with the d-pad or the left stick (to the nearest button that way), presses with A, goes back with B, scrolls
-- a long list to keep the focus in view and remembers the focus of each menu. `nova.ui.theme` sets the look for the whole game.
-- The same tree can be a file (`menus/<name>.menu.json`, read by `nova.ui.load`), so the studio can edit menus later.
local ui = nova.ui
local input = nova.input
local raw = nova.raw

-- ------------------------------------------------------------------ theme

local function is_array(t) return type(t) == "table" and (#t > 0 or next(t) == nil) end

-- a copy of `base` with `over` laid on top (tables are merged key by key; lists such as colours are replaced whole)
local function merged(base, over)
  local out = {}
  for k, v in pairs(base) do
    if type(v) == "table" and not is_array(v) then out[k] = merged(v, {}) else out[k] = v end
  end
  if over then
    for k, v in pairs(over) do
      if type(v) == "table" and type(out[k]) == "table" and not is_array(v) and not is_array(out[k]) then out[k] = merged(out[k], v)
      else out[k] = v end
    end
  end
  return out
end

local DEFAULT_THEME = {
  font = "rounded",
  size = 20,
  color = { 240, 244, 250 },          -- text
  dim = { 148, 160, 178 },            -- quieter text (labels, things that cannot be chosen)
  accent = { 252, 211, 77 },          -- titles and the focus
  ink = { 15, 23, 42 },               -- text on the focus
  shadow = true,
  gap = 10,                           -- between the things in a row, column or grid
  margin = 24,                        -- kept clear round the edge of the screen
  styles = {                          -- `style = "title"` on a text (sizes are logical units, the screen is 540 high)
    title = { size = 44, color = "accent", align = "center", font = "rounded" },
    heading = { size = 28, color = "accent" },
    body = { size = 18 },
    small = { size = 14, color = "dim" },
    label = { size = 13, color = "dim" },
  },
  panel = { color = { 15, 22, 38, 220 }, border = { 255, 255, 255, 36 }, pad = 16 }, -- or sprite = "ui/panel", slice, scale
  button = { h = 44, pad = { 16, 6 }, color = { 32, 44, 66, 235 }, text = { 236, 241, 248 }, align = "left", size = 22 },
  focus = { color = "accent", text = "ink", slide = 18, grow = 4 },  -- slide: how fast the highlight follows (0 jumps); grow: a card's frame
  disabled = { text = { 112, 122, 140 } },
  scroll = { color = "accent", off = { 255, 255, 255, 50 } },        -- the arrows on a list that scrolls
  enter = { dx = -50, time = 0.28, stagger = 0.045 },                -- buttons slide in when a menu opens (false: they do not)
  glyphs = {},                        -- pictures of the pad's buttons for prompts: { a = "ui/pad_a", ... }
  prompt = { size = 15, color = { 236, 241, 248 } },
  sounds = {},                        -- { move = "menu_move", accept = "menu_accept", back = "menu_back" } (or a function(kind))
  actions = { accept = { "a", "start" }, back = { "b" } },
  hold = { delay = 0.35, every = 0.09 },  -- holding a direction moves again after `delay`, then every `every` seconds
  draw = {},                          -- your own drawing: draw.panel(r, node, ctx), draw.button(r, node, ctx), draw.focus(r, node, ctx)
}

local theme = merged(DEFAULT_THEME, nil)

--- Sets the look of every menu: the parts you give replace the default's (so calling it twice does not pile up). Gives the theme.
function ui.theme(t)
  if t ~= nil then theme = merged(DEFAULT_THEME, t) end
  return theme
end

-- a colour: a list, or the name of one of the theme's colours ("accent", "ink", "dim", "color")
local function colour(T, c, fallback)
  if type(c) == "string" then c = T[c] end
  if type(c) ~= "table" then c = fallback end
  return c
end
local function fade(c, a)
  if a >= 1 then return c end
  return { c[1], c[2], c[3], math.floor((c[4] or 255) * math.max(0, a) + 0.5) }
end
local function mix(a, b, t)
  if t <= 0 then return a end
  if t >= 1 then return b end
  return { a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t, (a[4] or 255) + ((b[4] or 255) - (a[4] or 255)) * t }
end

-- ------------------------------------------------------------------ the tree

local CONTAINERS = { column = true, row = true, grid = true, stack = true, panel = true, button = true, hints = true }
local KINDS = { column = true, row = true, grid = true, stack = true, panel = true, button = true, text = true, image = true,
                space = true, box = true, prompt = true, hints = true }

local function text_of(n)
  if n.text ~= nil then return tostring(n.text) end
  local t = n[2]
  if type(t) == "string" or type(t) == "number" then return tostring(t) end
  return nil
end

local function children_of(n)
  if n.children then return n.children end
  local out = {}
  for _, v in ipairs(n) do if type(v) == "table" then out[#out + 1] = v end end
  return out
end

-- Walks the tree once a frame: the kind, a key (its `id`, or where it is), its parent and place, and the list of focusable things.
local function build(n, parent, index, key, out, default_kind)
  if type(n) ~= "table" then error("nova.ui: a menu item is a table such as { \"button\", \"Play\" }, not " .. type(n), 4) end
  local kind = n.kind or (type(n[1]) == "string" and n[1]) or default_kind
  if not KINDS[kind] then
    error("nova.ui: unknown kind '" .. tostring(kind) .. "' (column, row, grid, stack, panel, button, text, image, space, box, prompt, hints)", 4)
  end
  n._kind, n._parent, n._index, n._key = kind, parent, index, n.id and tostring(n.id) or key
  n._text = text_of(n)
  n._hidden, n._focused = false, false
  n._focusable = (kind == "button" or n.focusable == true) and not n.disabled and n.focusable ~= false
  if n._focusable then out.focusables[#out.focusables + 1] = n; n._order = #out.focusables end
  local kids = {}
  if kind == "hints" then
    for i, it in ipairs(n.items or {}) do
      kids[i] = { "prompt", it[2] or it.text, button = it[1] or it.button }
    end
    for _, c in ipairs(children_of(n)) do kids[#kids + 1] = c end
  elseif CONTAINERS[kind] then
    kids = children_of(n)
  end
  n._kids = kids
  for i, c in ipairs(kids) do build(c, n, i, key .. "." .. i, out, "text") end
end

-- ------------------------------------------------------------------ sizes

local function resolve(v, avail)
  if type(v) == "number" then return v end
  if v == "fill" then return avail end
  if type(v) == "string" then
    local p = v:match("^%s*([%d%.]+)%s*%%%s*$")
    if p then return avail * tonumber(p) / 100 end
    error("nova.ui: a size is a number, \"50%\" or \"fill\", not '" .. v .. "'", 5)
  end
  return nil
end

local function pads(n, T)
  local p = n.pad
  if p == nil then
    if n._kind == "panel" or n.panel then p = (type(n.panel) == "table" and n.panel.pad) or T.panel.pad
    elseif n._kind == "button" then p = T.button.pad
    else p = 0 end
  end
  if type(p) == "number" then return p, p, p, p end
  if #p == 2 then return p[1], p[2], p[1], p[2] end
  return p[1] or 0, p[2] or 0, p[3] or 0, p[4] or 0
end

local function gap_of(n, T)
  if n.gap then return n.gap end
  if n._kind == "hints" then return 18 end
  return T.gap
end

-- the look of a text: its style (by name), then what the node itself says
local function text_style(n, T, base)
  -- (most texts say only their style: those share one table per style and theme, made once)
  local plain = n.font == nil and n.size == nil and n.color == nil and n.align == nil and n.shadow == nil and n.bold == nil
    and n.outline == nil and n.fallback == nil and n.spacing == nil
  local cache, ckey
  if plain then
    cache = rawget(T, "_styles")
    if not cache then cache = {}; rawset(T, "_styles", cache) end
    ckey = base or (n.style or "body")
    local hit = cache[ckey]
    if hit then return hit end
  end
  local st = base or T.styles[n.style or "body"] or T.styles.body or {}
  local font = n.font or st.font or T.font
  local size = n.size or st.size or T.size
  local col = colour(T, n.color or st.color, T.color)
  local align = n.align or st.align or "left"
  local shadow = n.shadow
  if shadow == nil then shadow = st.shadow end
  if shadow == nil then shadow = T.shadow end
  local out = { font = font, size = size, color = col, align = align, shadow = shadow, bold = n.bold or st.bold, outline = n.outline or st.outline,
                fallback = n.fallback or st.fallback or T.fallback, spacing = n.spacing or st.spacing }
  if cache then cache[ckey] = out end
  return out
end

-- Menus are laid out every frame, mostly with the same words: what a text measures is kept (by its words, font, size and wrap
-- width), and the store is emptied when it grows large (a clock or a score changes its words every frame).
local sizes, sizes_count = {}, 0
local function measure_text(text, st, wrap_w)
  local fb = st.fallback
  if type(fb) == "table" then fb = table.concat(fb, ",") end
  local face = st.font or ""
  if fb or st.bold or st.spacing then face = face .. "|" .. tostring(fb) .. "|" .. tostring(st.bold) .. "|" .. tostring(st.spacing) end
  local by_face = sizes[face]
  if not by_face then by_face = {}; sizes[face] = by_face end
  local wrap_key = st.size * 100000 + (wrap_w and math.floor(wrap_w * 4) + 1 or 0)
  local by_size = by_face[wrap_key]
  if not by_size then by_size = {}; by_face[wrap_key] = by_size end
  local hit = by_size[text]
  if hit then return hit[1], hit[2] end
  local o = { font = st.font, size = st.size, fallback = st.fallback, bold = st.bold, spacing = st.spacing }
  if wrap_w then o.width = math.max(1, wrap_w) end
  local w, h = ui.text_size(text, o)
  if sizes_count >= 4000 then sizes, sizes_count = {}, 0; return w, h end
  by_size[text], sizes_count = { w, h }, sizes_count + 1
  return w, h
end

-- (the base is made once per theme, so that the style cache knows it again)
local function button_style(n, T)
  local base = rawget(T, "_button_base")
  if not base then
    base = { size = T.button.size, font = T.button.font, align = T.button.align, shadow = false }
    rawset(T, "_button_base", base)
  end
  return text_style(n, T, base)
end

local measure

local function measure_line(n, T, iw, ih, vertical)
  local gap = gap_of(n, T)
  local cw, ch = 0, 0
  for i, c in ipairs(n._kids) do
    local w, h = measure(c, iw, ih, T)
    if vertical then
      cw = math.max(cw, w); ch = ch + h + (i > 1 and gap or 0)
    else
      ch = math.max(ch, h); cw = cw + w + (i > 1 and gap or 0)
    end
  end
  if vertical and n.visible and #n._kids > n.visible then
    local tallest = 0
    for _, c in ipairs(n._kids) do tallest = math.max(tallest, c._mh) end
    ch = n.visible * tallest + (n.visible - 1) * gap
  end
  return cw, ch
end

function measure(n, aw, ah, T)
  local k = n._kind
  local pl, pt, pr, pb = pads(n, T)
  local ew, eh = resolve(n.w, aw), resolve(n.h, ah)
  local iw = math.max(0, (ew or aw) - pl - pr)
  local ih = math.max(0, (eh or ah) - pt - pb)
  local cw, ch = 0, 0
  if k == "text" then
    local st = text_style(n, T)
    n._style = st
    cw, ch = measure_text(n._text or "", st, n.wrap and iw or nil)
  elseif k == "prompt" then
    local st = text_style(n, T, T.prompt)
    n._style = st
    local tw, th = measure_text(n._text or "", st)
    local g = T.prompt.glyph or st.size * 1.7
    cw, ch = g + 6 + tw, math.max(g, th)
  elseif k == "image" then
    local w, h = nova.image_size(n.sprite or n._text)
    local s = n.scale or 1
    cw, ch = w * s, h * s
    if ew and not eh then ch = ch * ew / math.max(1, cw); cw = ew end
    if eh and not ew then cw = cw * eh / math.max(1, ch); ch = eh end
  elseif k == "space" then
    cw, ch = 0, 0
  elseif k == "box" then
    cw, ch = 0, 0
  elseif k == "button" and #n._kids == 0 then
    local st = button_style(n, T)
    n._style = st
    local tw, th = measure_text(n._text or "", st)
    if n.value ~= nil then
      local vw = measure_text(tostring(n.value), st)
      tw = tw + 24 + vw
    end
    cw, ch = tw, th
  elseif k == "row" or k == "hints" then
    cw, ch = measure_line(n, T, iw, ih, false)
  elseif k == "grid" then
    local cols = math.max(1, n.columns or 2)
    local gap = gap_of(n, T)
    local cell_w = n.cell_w or (iw - gap * (cols - 1)) / cols
    local tallest, widest = 0, 0
    for _, c in ipairs(n._kids) do
      local w, h = measure(c, cell_w, n.cell_h or ih, T)
      tallest, widest = math.max(tallest, h), math.max(widest, w)
    end
    local cell_h = n.cell_h or tallest
    local rows = math.ceil(#n._kids / cols)
    if n.visible then rows = math.min(rows, n.visible) end
    n._cell_w, n._cell_h = cell_w, cell_h
    cw = n.cell_w and (cols * cell_w + gap * (cols - 1)) or iw
    ch = rows * cell_h + math.max(0, rows - 1) * gap
  elseif k == "stack" then
    for _, c in ipairs(n._kids) do
      local w, h = measure(c, iw, ih, T)
      cw, ch = math.max(cw, w), math.max(ch, h)
    end
  else -- column, panel, a button with things inside
    cw, ch = measure_line(n, T, iw, ih, true)
  end
  local w = ew or math.min(cw + pl + pr, aw)
  local h = eh or (ch + pt + pb)
  if k == "button" and not eh then h = math.max(h, n.min_h or T.button.h) end
  if n.min_w then w = math.max(w, n.min_w) end
  if n.max_w then w = math.min(w, n.max_w) end
  if n.min_h then h = math.max(h, n.min_h) end
  if n.max_h then h = math.min(h, n.max_h) end
  n._mw, n._mh = w, h
  return w, h
end

-- ------------------------------------------------------------------ places

local arrange

local function anchor_place(anchor, bx, by, bw, bh, w, h)
  anchor = anchor or "center"
  local x, y = bx + (bw - w) / 2, by + (bh - h) / 2
  if anchor:find("left") then x = bx elseif anchor:find("right") then x = bx + bw - w end
  if anchor:find("top") then y = by elseif anchor:find("bottom") then y = by + bh - h end
  return x, y
end

local function cross(align, start, room, size)
  if align == "center" then return start + (room - size) / 2 end
  if align == "end" then return start + room - size end
  return start
end

local function grows(c) return c.grow or ((c.w == "fill" or c.h == "fill") and 1) or (c._kind == "space" and not c.w and not c.h and 1) or 0 end

local function arrange_line(n, T, x, y, w, h, vertical, st)
  local gap = gap_of(n, T)
  local kids = n._kids
  local main_room = vertical and h or w
  local sizes, total, weight = {}, 0, 0
  for i, c in ipairs(kids) do
    sizes[i] = vertical and c._mh or c._mw
    total = total + sizes[i] + (i > 1 and gap or 0)
    weight = weight + grows(c)
  end
  local scroll = n.visible and #kids > n.visible
  local left = main_room - total
  if not scroll then
    if left > 0 and weight > 0 then
      for i, c in ipairs(kids) do
        local g = grows(c)
        if g > 0 then sizes[i] = sizes[i] + left * g / weight end
      end
      left = 0
    elseif left < 0 and not vertical then
      -- a row that does not fit: what has no size of its own gives up room (its text shrinks to fit)
      local flexible = 0
      for i, c in ipairs(kids) do if not c.w then flexible = flexible + sizes[i] end end
      if flexible > 0 then
        local k = math.max(0, (flexible + left) / flexible)
        for i, c in ipairs(kids) do if not c.w then sizes[i] = sizes[i] * k end end
      end
      left = 0
    end
  end
  local justify = n.justify or "start"
  local pos, between = vertical and y or x, gap
  if left > 0 then
    if justify == "center" then pos = pos + left / 2
    elseif justify == "end" then pos = pos + left
    elseif justify == "between" and #kids > 1 then between = gap + left / (#kids - 1) end
  end
  local first = 1
  if scroll then
    first = math.max(1, math.min(st.scroll[n._key] or 1, #kids - n.visible + 1))
    st.scroll[n._key] = first
    for i = 1, first - 1 do pos = pos - sizes[i] - gap end
    n._first, n._last = first, first + n.visible - 1
  end
  local align = n.align or (vertical and "stretch" or "center")
  for i, c in ipairs(kids) do
    local cw, ch
    if vertical then
      ch = sizes[i]
      cw = resolve(c.w, w) or ((c.align_self or align) == "stretch" and w or math.min(c._mw, w))
      local cx = cross(c.align_self or align, x, w, cw)
      arrange(c, cx, pos, cw, ch, T, st)
    else
      cw = sizes[i]
      ch = resolve(c.h, h) or ((c.align_self or align) == "stretch" and h or math.min(c._mh, h))
      local cy = cross(c.align_self or align, y, h, ch)
      arrange(c, pos, cy, cw, ch, T, st)
    end
    if scroll and (i < first or i > first + n.visible - 1) then c._hidden = true end
    pos = pos + sizes[i] + between
  end
end

function arrange(n, x, y, w, h, T, st)
  n._x, n._y, n._w, n._h = x, y, w, h
  local k = n._kind
  local pl, pt, pr, pb = pads(n, T)
  local ix, iy, iw, ih = x + pl, y + pt, math.max(0, w - pl - pr), math.max(0, h - pt - pb)
  if k == "row" or k == "hints" then
    arrange_line(n, T, ix, iy, iw, ih, false, st)
  elseif k == "column" or k == "panel" or (k == "button" and #n._kids > 0) then
    arrange_line(n, T, ix, iy, iw, ih, true, st)
  elseif k == "grid" then
    local cols = math.max(1, n.columns or 2)
    local gap = gap_of(n, T)
    local cell_w = n.cell_w or (iw - gap * (cols - 1)) / cols
    local cell_h = n._cell_h
    local rows = math.ceil(#n._kids / cols)
    local first = 1
    if n.visible and rows > n.visible then
      first = math.max(1, math.min(st.scroll[n._key] or 1, rows - n.visible + 1))
      st.scroll[n._key] = first
      n._first, n._last = first, first + n.visible - 1
    end
    local gx = cross(n.justify or "start", ix, iw, cols * cell_w + gap * (cols - 1))
    for i, c in ipairs(n._kids) do
      local col, row = (i - 1) % cols, (i - 1) // cols + 1
      arrange(c, gx + col * (cell_w + gap), iy + (row - first) * (cell_h + gap), cell_w, cell_h, T, st)
      if n._first and (row < n._first or row > n._last) then c._hidden = true end
    end
  elseif k == "stack" then
    for _, c in ipairs(n._kids) do
      local cw = resolve(c.w, iw) or math.min(c._mw, iw)
      local ch = resolve(c.h, ih) or math.min(c._mh, ih)
      local cx, cy = anchor_place(c.anchor, ix, iy, iw, ih, cw, ch)
      arrange(c, cx + (c.x or 0), cy + (c.y or 0), cw, ch, T, st)
    end
  end
end

-- hidden things hide what is inside them too
local function hide_inside(n, hidden)
  hidden = hidden or n._hidden
  n._hidden = hidden
  for _, c in ipairs(n._kids) do hide_inside(c, hidden) end
end

-- ------------------------------------------------------------------ menus' memory

local states = {}
local held = { t = {}, last = nil }

local function state_of(id)
  local st = states[id]
  if not st then
    st = { scroll = {}, focus = nil, hl = nil, last = -1, opened = 0 }
    states[id] = st
  end
  return st
end

--- Moves a menu's focus to the item with this `id` (the next time it is drawn), or gives the id of the item it is on.
function ui.focus(menu_id, item_id)
  local st = state_of(menu_id or "menu")
  if item_id ~= nil then st.focus = tostring(item_id); st.want = true end
  return st.focus
end

--- Forgets a menu's focus, scrolling and highlight (it opens as if for the first time).
function ui.forget(menu_id)
  states[menu_id or "menu"] = nil
end

local function play(T, kind)
  local s = T.sounds
  if type(s) == "function" then s(kind)
  elseif type(s) == "table" and s[kind] then nova.sound.play(s[kind]) end
end

local function any_pressed(list)
  if type(list) == "string" then return input.pressed(list) end
  for _, a in ipairs(list or {}) do if input.pressed(a) then return true end end
  return false
end

-- a direction pressed this frame, or held long enough to repeat
local DIRS = { "up", "down", "left", "right" }
local function direction(T, now)
  local dt = held.last and math.max(0, math.min(0.1, now - held.last)) or 0
  if held.last == now then dt = 0 end
  held.last = now
  local got
  for _, d in ipairs(DIRS) do
    if input.pressed(d) then
      held.t[d] = 0
      got = got or d
    elseif input.down(d) then
      local before = held.t[d] or 0
      local after = before + dt
      held.t[d] = after
      local delay, every = T.hold.delay, T.hold.every
      if after >= delay and math.floor((after - delay) / every) > math.floor(math.max(-1, before - delay) / every) then got = got or d end
      if before < delay and after >= delay then got = got or d end
    else
      held.t[d] = nil
    end
  end
  return got
end

-- the nearest focusable thing from `cur` in direction `d` (the one most in line, then nearest); with nothing that way, the one at the
-- far end in line (the focus wraps round)
local function nearest(list, cur, d, wrap)
  -- in a grid or column with `flow`, left and right go to the one before or after in reading order (round from the last to the first)
  local p = cur._parent
  if p and (p._kind == "grid" or p._kind == "column" or p._kind == "panel") and p.flow and (d == "left" or d == "right") then
    local mine = {}
    for _, c in ipairs(list) do if c._parent == p then mine[#mine + 1] = c end end
    for i, c in ipairs(mine) do
      if c == cur then
        local j = (d == "right") and (i % #mine + 1) or ((i - 2) % #mine + 1)
        return mine[j] ~= cur and mine[j] or nil
      end
    end
  end
  local cx, cy = cur._x + cur._w / 2, cur._y + cur._h / 2
  local best, best_score, far, far_d
  for _, c in ipairs(list) do
    if c ~= cur then
      local px, py = c._x + c._w / 2, c._y + c._h / 2
      local main, gap
      if d == "up" or d == "down" then
        main = (d == "down") and (py - cy) or (cy - py)
        gap = math.max(0, math.max(c._x, cur._x) - math.min(c._x + c._w, cur._x + cur._w))
        if gap == 0 then gap = math.abs(px - cx) * 0.1 end
      else
        main = (d == "right") and (px - cx) or (cx - px)
        gap = math.max(0, math.max(c._y, cur._y) - math.min(c._y + c._h, cur._y + cur._h))
        if gap == 0 then gap = math.abs(py - cy) * 0.1 end
      end
      if main > 1 then
        local score = main + gap * 3
        if not best_score or score < best_score then best, best_score = c, score end
      elseif main < -1 and gap < 2 then
        local back = -main + gap * 3
        if not far_d or back > far_d then far, far_d = c, back end
      end
    end
  end
  if best then return best end
  if wrap then return far end
  return nil
end

-- ------------------------------------------------------------------ drawing

-- `over` (a node's own `panel = { ... }`) wins over `look` (the theme's), field by field; `sprite = false` there means none
local function draw_panel(T, look, x, y, w, h, a, over)
  local function get(k)
    local v = over and over[k]
    if v == nil then v = look[k] end
    return v
  end
  local sprite = get("sprite")
  if sprite then
    local o = { slice = get("slice"), scale = get("scale"), color = fade(colour(T, get("tint"), { 255, 255, 255, 255 }), a) }
    ui.panel(sprite, x, y, w, h, o)
    return
  end
  local c = colour(T, get("color"), { 15, 22, 38, 220 })
  local slant = get("slant")
  if slant and slant ~= 0 then ui.slant(x, y, w, h, slant, fade(c, a)) else ui.rect(x, y, w, h, fade(c, a)) end
  local border = get("border")
  if border then
    local b = fade(colour(T, border, { 255, 255, 255, 36 }), a)
    ui.rect(x, y, w, 1, b); ui.rect(x, y + h - 1, w, 1, b)
    ui.rect(x, y + 1, 1, h - 2, b); ui.rect(x + w - 1, y + 1, 1, h - 2, b)
  end
end

local function draw_text_in(text, st, x, y, w, h, a, col, wrap)
  local o = { font = st.font, size = st.size, color = fade(col or st.color, a), shadow = st.shadow and (a >= 1 or nil) and st.shadow,
              bold = st.bold, outline = st.outline, fallback = st.fallback, align = st.align, width = math.max(1, w), spacing = st.spacing }
  if wrap then
    o.fit, o.height = "wrap", h
    ui.text(x, y, text, o)
  else
    o.fit, o.height, o.valign = "shrink", h * 1.25, "middle"
    ui.text(x, y + h / 2, text, o)
  end
end

local function glyph(T, name, x, y, size, a)
  local sprite = T.glyphs[name]
  if sprite then
    ui.sprite(sprite, x, y, { anchor = "topleft", w = size, h = size, color = fade({ 255, 255, 255, 255 }, a) })
    return
  end
  -- no picture given: a round-cornered key with the button's letter
  local c = fade({ 236, 241, 248, 235 }, a)
  local r = math.floor(size / 5)
  ui.rect(x + r, y, size - 2 * r, size, c)
  ui.rect(x, y + r, size, size - 2 * r, c)
  ui.rect(x + r / 2, y + r / 2, size - r, size - r, c)
  local label = ({ a = "A", b = "B", x = "X", y = "Y", l1 = "L", r1 = "R", l2 = "ZL", r2 = "ZR", start = "+", select = "-",
                   dpad = "+", up = "^", down = "v", left = "<", right = ">" })[name] or tostring(name):upper()
  ui.text(x + size / 2, y + size / 2, label, { size = size * (#label > 1 and 0.48 or 0.62), color = fade(T.ink, a), align = "center", valign = "middle", font = "sans", bold = true })
end

local draw

local function public_ctx(n, ctx, T)
  return { text = n._text, kind = n._kind, card = not (n._kind == "button" and #n._kids == 0), focused = n._focused, alpha = ctx.a, near = n._near or 0, theme = T, id = n._key, disabled = n.disabled == true,
           highlight = ctx.hl, dx = ctx.dx, dy = ctx.dy }
end

local function draw_focus(n, T, ctx)
  local hl = ctx.hl or { x = n._x, y = n._y, w = n._w, h = n._h }
  local r = { x = hl.x + ctx.dx, y = hl.y + ctx.dy, w = hl.w, h = hl.h }
  if T.draw.focus then return T.draw.focus(r, n, public_ctx(n, ctx, T)) end
  local look = T.focus
  local card = not (n._kind == "button" and #n._kids == 0)
  if card then
    local g = look.grow or 4
    r = { x = r.x - g, y = r.y - g, w = r.w + 2 * g, h = r.h + 2 * g }
    if not look.sprite then
      -- a card keeps its own look: a ring round it, `grow` thick
      local c = fade(colour(T, look.color, T.accent), ctx.a)
      ui.rect(r.x, r.y, r.w, g, c); ui.rect(r.x, r.y + r.h - g, r.w, g, c)
      ui.rect(r.x, r.y + g, g, r.h - 2 * g, c); ui.rect(r.x + r.w - g, r.y + g, g, r.h - 2 * g, c)
      return
    end
  end
  if look.sprite then
    ui.panel(look.sprite, r.x, r.y, r.w, r.h, { slice = look.slice, scale = look.scale, color = fade({ 255, 255, 255, 255 }, ctx.a) })
  elseif look.slant and look.slant ~= 0 then
    ui.slant(r.x, r.y, r.w, r.h, look.slant, fade(colour(T, look.color, T.accent), ctx.a))
  else
    ui.rect(r.x, r.y, r.w, r.h, fade(colour(T, look.color, T.accent), ctx.a))
  end
end

function draw(n, T, ctx)
  if n._hidden then return end
  local a = ctx.a * (n.alpha or 1)
  local dx, dy = ctx.dx + (n.dx or 0), ctx.dy + (n.dy or 0)
  -- buttons slide in, one after another, when the menu opens
  if n._enter then
    local e = n._enter
    a = a * e
    dx = dx + (1 - e) * (T.enter.dx or 0)
  end
  local sub = { a = a, dx = dx, dy = dy, hl = ctx.hl, hl_node = ctx.hl_node }
  if a <= 0.003 then return end
  local x, y, w, h = n._x + dx, n._y + dy, n._w, n._h
  local k = n._kind
  local r = { x = x, y = y, w = w, h = h }
  -- a card's focus is a frame behind it; a button's is drawn over its row (below), so that it slides over the rows next to it
  local fill = n._kind == "button" and #n._kids == 0
  if n._focused and ctx.hl_node == n and not fill then draw_focus(n, T, sub) end
  if n.panel or k == "panel" then
    local over = type(n.panel) == "table" and n.panel or nil
    if T.draw.panel then T.draw.panel(r, n, public_ctx(n, sub, T)) else draw_panel(T, T.panel, x, y, w, h, a, over) end
  end
  if k == "text" then
    local pl, pt, pr, pb = pads(n, T)
    draw_text_in(n._text or "", n._style, x + pl, y + pt, w - pl - pr, h - pt - pb, a, nil, n.wrap)
  elseif k == "prompt" then
    local st = n._style
    local g = T.prompt.glyph or st.size * 1.7
    glyph(T, n.button or "a", x, y + (h - g) / 2, g, a)
    draw_text_in(n._text or "", st, x + g + 6, y, w - g - 6, h, a)
  elseif k == "image" then
    ui.sprite(n.sprite or n._text, x + w / 2, y + h / 2, { w = w, h = h, frame = n.frame, color = fade(colour(T, n.color, { 255, 255, 255, 255 }), a) })
  elseif k == "box" then
    if n.draw then n.draw(r, n, public_ctx(n, sub, T)) end
  elseif k == "button" then
    if T.draw.button then
      T.draw.button(r, n, public_ctx(n, sub, T))
    else
      -- (a focused row is the highlight itself; a focused card keeps its background inside its ring)
      if not n._focused or #n._kids > 0 then draw_panel(T, T.button, x, y, w, h, a) end
      if #n._kids == 0 then
        local st = n._style
        local pl, pt, pr, pb = pads(n, T)
        local base = n.disabled and colour(T, T.disabled.text, T.dim) or colour(T, st.color ~= T.color and st.color or T.button.text, T.color)
        local col = mix(base, colour(T, T.focus.text, T.ink), n.disabled and 0 or (n._near or 0))
        local tx, tw = x + pl, w - pl - pr
        if n.value ~= nil then
          local vst = { font = st.font, size = st.size, align = "right", shadow = st.shadow, fallback = st.fallback }
          local vw = math.min(tw * 0.6, (measure_text(tostring(n.value), vst)))
          draw_text_in(tostring(n.value), vst, tx + tw - vw, y + pt, vw, h - pt - pb, a, col)
          tw = tw - vw - 16
        end
        draw_text_in(n._text or "", st, tx, y + pt, tw, h - pt - pb, a, col)
      end
    end
  end
  for _, c in ipairs(n._kids) do draw(c, T, sub) end
  local f = ctx.hl_node
  if f and f._parent == n and not f._hidden and f._kind == "button" and #f._kids == 0 then
    local e = f._enter or 1
    local fa = a * (f.alpha or 1) * e
    if fa > 0.003 then
      draw_focus(f, T, { a = fa, dx = dx + (f.dx or 0) + (1 - e) * (T.enter and T.enter.dx or 0), dy = dy + (f.dy or 0), hl = ctx.hl })
    end
  end
  -- a list or grid that scrolls: a small arrow at its top and bottom right, bright when there is more that way
  if n._first then
    local count = n._kind == "grid" and math.ceil(#n._kids / math.max(1, n.columns or 2)) or #n._kids
    local up, down = n._first > 1, n._last < count
    local on, off = colour(T, T.scroll.color, T.accent), colour(T, T.scroll.off, { 255, 255, 255, 50 })
    local mx = x + w - 10
    for i = 0, 5 do
      ui.rect(mx - i, y - 12 + i, i * 2 + 1, 1, fade(up and on or off, a))
      ui.rect(mx - (5 - i), y + h + 6 + i, (5 - i) * 2 + 1, 1, fade(down and on or off, a))
    end
  end
end

-- ------------------------------------------------------------------ the calls

local function lay(root, T, st)
  local out = { focusables = {} }
  build(root, nil, 1, "#", out, "column")
  local vw, vh = nova.view()
  local margin = root.margin
  if margin == nil then margin = (root.x or root.y) and not root.anchor and 0 or T.margin end
  local bw, bh = vw - 2 * margin, vh - 2 * margin
  measure(root, bw, bh, T)
  local w, h = root._mw, root._mh
  local anchor = root.anchor or ((root.x or root.y) and "topleft") or "center"
  local x, y = anchor_place(anchor, margin, margin, bw, bh, w, h)
  arrange(root, x + (root.x or 0), y + (root.y or 0), w, h, T, st)
  hide_inside(root, false)
  return out.focusables
end

-- the scrolling containers round `n` move so that it shows; true when one moved
local function reveal(n, st)
  local moved = false
  local child, p = n, n._parent
  while p do
    if p.visible then
      local index = child._index
      local at = p._kind == "grid" and ((index - 1) // math.max(1, p.columns or 2) + 1) or index
      local first = st.scroll[p._key] or 1
      if at < first then st.scroll[p._key] = at; moved = true end
      if at > first + p.visible - 1 then st.scroll[p._key] = at - p.visible + 1; moved = true end
    end
    child, p = p, p._parent
  end
  return moved
end

local function theme_for(root)
  if root.theme then return merged(theme, root.theme) end
  return theme
end

local function rects_of(list)
  local rects = {}
  for _, n in ipairs(list) do rects[n._key] = { x = n._x, y = n._y, w = n._w, h = n._h } end
  return rects
end

--- Lays out and draws a tree with no focus (a HUD, a score table, a heading). Gives the rectangle of each thing with an `id`.
function ui.layout(root)
  local T = theme_for(root)
  local st = state_of(root.id or "layout")
  lay(root, T, st)
  draw(root, T, { a = 1, dx = 0, dy = 0 })
  local rects = {}
  local function collect(n)
    if n.id then rects[tostring(n.id)] = { x = n._x, y = n._y, w = n._w, h = n._h } end
    for _, c in ipairs(n._kids) do collect(c) end
  end
  collect(root)
  return rects
end

--- A menu: lays out the tree, moves the focus (d-pad, left stick, arrow keys, the pointer), draws it in the theme's look and says what
--- happened: { pressed = id of the button pressed with A, back = B was pressed, step = -1 or 1 when left or right was pressed on a button
--- with `adjust`, changed = that button's id, focus = the id of the focused button, moved = the focus moved, rects }.
function ui.menu(root)
  if type(root) == "string" then root = ui.load(root) end
  local T = theme_for(root)
  local id = root.id or "menu"
  local st = state_of(id)
  -- (the clock nova.pause does not stop: a pause menu still moves)
  local now = raw.real_time and raw.real_time() or nova.time()
  local frame_dt = math.max(0, math.min(0.1, now - (st.last or now)))
  -- (it was not on screen: it opens again, and takes no input in the frame it opens, so the press that opened it does not
  -- press its first button too)
  local opening = st.last < 0 or now - st.last > 0.25
  if opening then st.opened = now; st.hl = nil end
  st.last = now
  local list = lay(root, T, st)
  local by_key = {}
  for _, n in ipairs(list) do by_key[n._key] = n end
  local cur = st.focus and by_key[st.focus]
  if not cur then
    for _, n in ipairs(list) do if n.focus then cur = n; break end end
    cur = cur or list[1]
  end
  local r = { moved = false, back = false }
  local active = root.active ~= false and not opening
  local before = cur
  if st.want and cur then
    st.want = nil
    if reveal(cur, st) then list = lay(root, T, st); by_key = {}; for _, n in ipairs(list) do by_key[n._key] = n end; cur = by_key[cur._key] end
  end
  if active then
    local d = direction(T, now)
    if d and cur then
      if (d == "left" or d == "right") and cur.adjust then
        r.step, r.changed = d == "left" and -1 or 1, cur._key
        play(T, "move")
      else
        local wrap = root.wrap
        if wrap == nil then wrap = true end
        local nxt = nearest(list, cur, d, wrap)
        if nxt then cur = nxt; play(T, "move") end
      end
    end
    local p = input.pointer()
    if p.present and (p.dx ~= 0 or p.dy ~= 0 or p.pressed) then
      for _, n in ipairs(list) do
        if not n._hidden and p.x >= n._x and p.x < n._x + n._w and p.y >= n._y and p.y < n._y + n._h then
          cur = n
          if p.pressed then r.pressed = n._key end
        end
      end
      if p.wheel and p.wheel ~= 0 and cur then
        local nxt = nearest(list, cur, p.wheel > 0 and "up" or "down", false)
        if nxt then cur = nxt end
      end
    end
    if cur and any_pressed(T.actions.accept) then r.pressed = cur._key end
    if any_pressed(T.actions.back) then r.back = true; play(T, "back") end
    if r.pressed then
      play(T, "accept")
      if by_key[r.pressed] and by_key[r.pressed].on_press then by_key[r.pressed].on_press(by_key[r.pressed]) end
    end
  end
  if cur ~= before then
    r.moved = true
    if reveal(cur, st) then
      local key = cur._key
      list = lay(root, T, st)
      by_key = {}
      for _, n in ipairs(list) do by_key[n._key] = n end
      cur = by_key[key]
    end
  end
  st.focus = cur and cur._key or nil
  -- the highlight follows the focus (sliding, as the theme says)
  local hl_node
  if cur then
    cur._focused = true
    hl_node = cur
    local target = { x = cur._x, y = cur._y, w = cur._w, h = cur._h }
    local k = (T.focus.slide or 0) > 0 and math.min(1, frame_dt * T.focus.slide) or 1
    if not st.hl then st.hl = target
    else
      local hl = st.hl
      st.hl = { x = hl.x + (target.x - hl.x) * k, y = hl.y + (target.y - hl.y) * k, w = hl.w + (target.w - hl.w) * k, h = hl.h + (target.h - hl.h) * k }
    end
    -- how near the highlight is to each button (its words change colour as it arrives)
    for _, n in ipairs(list) do
      local dyy = math.abs((n._y + n._h / 2) - (st.hl.y + st.hl.h / 2)) / math.max(1, n._h)
      local dxx = math.abs((n._x + n._w / 2) - (st.hl.x + st.hl.w / 2)) / math.max(1, n._w)
      n._near = math.max(0, 1 - math.max(dxx, dyy))
    end
  else
    st.hl = nil
  end
  if T.enter and root.enter ~= false then
    local since = now - st.opened
    if root.enter then since = root.enter end
    local time, stagger = T.enter.time or 0.28, T.enter.stagger or 0
    for i, n in ipairs(list) do
      local e = math.max(0, math.min(1, (since - (i - 1) * stagger) / time))
      e = 1 - (1 - e) ^ 3
      n._enter = e < 1 and e or nil
    end
  end
  draw(root, T, { a = 1, dx = 0, dy = 0, hl = st.hl, hl_node = hl_node })
  for _, n in ipairs(list) do n._enter = nil end
  r.focus = st.focus
  r.rects = rects_of(list)
  return r
end

local loaded = {}
--- A menu or HUD from a file: `menus/<name>.menu.json` (dots are folders), the same tree as in Lua with `kind`, `text` and `children`
--- written out. Give it to nova.ui.menu or nova.ui.layout (a fresh copy each call, so a game can fill in values).
function ui.load(name)
  local data = loaded[name]
  if data == nil then
    data = raw.menu_data(name)
    if data == nil then error("nova.ui.load: there is no menus/" .. name:gsub("%.", "/") .. ".menu.json", 2) end
    loaded[name] = data
  end
  local function copy(t)
    if type(t) ~= "table" then return t end
    local o = {}
    for k, v in pairs(t) do o[k] = copy(v) end
    return o
  end
  return copy(data)
end
