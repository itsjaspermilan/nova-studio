-- The type of the game, in one place: every font name and size. Every piece of text in Neon Undertow goes through `Type.text(x, y, text, role, opts)`,
-- so the look of all of it is tuned by editing this table.
--
-- Body text, numbers, card text and menus are a bold sans ("sans": Inter, thickened); the big moments (the title, banners, boss and card names, the
-- district card) are the comic face ("comic": Bangers, which leans a little to the right by itself; Nova has no skew or rotate for text). Every role
-- has a dark outline, so it reads over the lit, rainy street.
--
-- SIZES ARE LOGICAL UNITS: the screen is 540 units high, so on the 1920x1080 handheld one unit is two pixels. The smallest text ("tiny") is 14
-- units = 28 px tall (the brief: nothing under about 22 px). The old pixel font drew 13 to 15 units; a vector sans of the same number of units
-- looks smaller (its letters do not fill the box), so these are a little bigger than the old numbers.
local T = {}

T.scale = 1.0     -- everything above, bigger or smaller at once (1.1 for a bigger handheld screen, say)
T.fade = 1        -- 0 to 1: all text is drawn this opaque (the wipe sets it, so no text shows through the shutter)

T.fonts = { body = "sans", head = "comic" }

local DARK = { 4, 5, 16, 255 }
-- role = { font, size, bold (0 plain, 1 usual bold), outline (a width in units; the colour is DARK), spacing (share of the size added after each letter) }
T.roles = {
  tiny   = { font = T.fonts.body, size = 14, bold = 0.9, outline = 1.6 },    -- fine print: set lines, key hints in panels
  small  = { font = T.fonts.body, size = 16, bold = 0.9, outline = 1.7 },    -- one-line notes, tags, plates
  body   = { font = T.fonts.body, size = 18, bold = 0.9, outline = 1.8 },    -- card text, speech, lists, menus
  label  = { font = T.fonts.body, size = 21, bold = 1.0, outline = 2.0 },    -- numbers (scrap, keys), buttons, table rows
  big    = { font = T.fonts.body, size = 26, bold = 1.0, outline = 2.4 },
  name   = { font = T.fonts.head, size = 26, bold = 0.3, outline = 2.6, spacing = 0.02 },    -- card names, speakers, panel headings
  head   = { font = T.fonts.head, size = 36, bold = 0.4, outline = 3.2, spacing = 0.02 },    -- screen titles
  banner = { font = T.fonts.head, size = 58, bold = 0.5, outline = 4.5, spacing = 0.03 },    -- the banners (lib/banner.lua)
  title  = { font = T.fonts.head, size = 92, bold = 0.6, outline = 6.5, spacing = 0.03 },    -- NEON UNDERTOW
}
T.dark = DARK

local function copy_opts(role, opts)
  local r = T.roles[role] or error("no type role called " .. tostring(role))
  local o = {
    font = r.font, size = ((opts and opts.size) or r.size) * T.scale, bold = r.bold, spacing = r.spacing,
    outline = { color = DARK, width = (r.outline or 1.5) * ((opts and opts.size) and (opts.size / r.size) or 1) * T.scale },
  }
  if opts then
    for k, v in pairs(opts) do
      if k == "outline" then
        if v == false then o.outline = nil elseif type(v) == "table" then o.outline = { color = v.color or DARK, width = (v.width or r.outline) * T.scale } end
      elseif k ~= "size" and k ~= "shadow" then      -- (the outline is the shadow now: a drop shadow would not fade with the wipe)
        o[k] = v
      end
    end
  end
  -- (an outline fades with the text: nova multiplies its alpha by the colour's)
  -- The wipe (lib/wipe.lua) fades ALL text with it: text is always drawn over UI rectangles, so a shutter cannot cover it, but its own alpha can.
  if T.fade < 1 then
    local c = o.color or { 255, 255, 255, 255 }
    o.color = { c[1], c[2], c[3], (c[4] or 255) * T.fade }
  end
  return o
end

-- Draws text. `opts` takes what nova.ui.text takes (color, width, align, line_spacing, shadow ...) plus `size` (units) to deviate from the
-- role's and `outline = false` for none. Returns the width and height drawn.
function T.text(x, y, text, role, opts)
  return nova.ui.text(x, y, text, copy_opts(role, opts))
end

-- The size of text without drawing it.
function T.size(text, role, opts)
  return nova.ui.text_size(text, copy_opts(role, opts))
end

function T.width(text, role, opts)
  local w = nova.ui.text_size(text, copy_opts(role, opts))
  return w
end

-- The size in units a role draws at (for layouts that follow it).
function T.units(role) return T.roles[role].size * T.scale end

return T
