-- Choosing the controls: which key or button does what. The engine does the remapping (nova.input.bind); this keeps a
-- readable list of what can be changed, turns sources like "key:KeyW" into words, replaces the right entries of an
-- action, and saves the choices between runs.
local controls = {}

controls.rows = {
  { label = "Accelerate", action = "throttle" },
  { label = "Brake / reverse", action = "brake" },
  { label = "Handbrake", action = "handbrake" },
  { label = "Steer left", action = "steer", side = "negative" },
  { label = "Steer right", action = "steer", side = "positive" },
  { label = "Back on the road", action = "reset" },
  { label = "Change camera", action = "view" },
  { label = "Pause", action = "pause" },
}

local PADS = {
  south = "A", east = "B", west = "X", north = "Y", l1 = "L1", r1 = "R1", l2 = "L2", r2 = "R2", start = "Start", select = "Select",
  thumb_l = "Left stick press", thumb_r = "Right stick press", dpad_up = "D-pad up", dpad_down = "D-pad down", dpad_left = "D-pad left", dpad_right = "D-pad right",
}
local ARROWS = { ArrowUp = "Up", ArrowDown = "Down", ArrowLeft = "Left", ArrowRight = "Right" }
local STICKS = { left_x = "Left stick", left_y = "Left stick", right_x = "Right stick", right_y = "Right stick", l2 = "L2", r2 = "R2" }

--- A source in words: "key:KeyW" is "W", "pad:south" is "A", "axis:left_x-" is "Left stick left".
function controls.pretty(source)
  local kind, name = source:match("^(%a+):(.+)$")
  if kind == "key" then
    local plain = name:gsub("^Key", ""):gsub("^Digit", "")
    return ARROWS[plain] or plain
  elseif kind == "pad" then
    return PADS[name] or name
  elseif kind == "axis" then
    local base, sign = name:match("^(.-)([+-]?)$")
    local horizontal = base:find("_x") ~= nil
    local direction = (sign == "-" and (horizontal and " left" or " up")) or (sign == "+" and (horizontal and " right" or " down")) or ""
    return (STICKS[base] or base) .. direction
  elseif kind == "touch" then
    return "touch"
  end
  return source
end

-- Keyboard and gamepad entries are changed separately: pressing a key replaces the keys of an action and leaves its
-- buttons, and the other way round. (Touch entries are never touched.)
local function group(source)
  if source:find("^key:") then return "key" end
  if source:find("^pad:") or source:find("^axis:") then return "pad" end
  return "other"
end

local function sources_of(row)
  local b = nova.input.bindings(row.action)
  if row.side then return b[row.side] or {} end
  return b
end

--- What a row is set to, in words: "Up, W  ·  R2, A".
function controls.describe(row)
  local keys, pads, seen = {}, {}, {}
  for _, s in ipairs(sources_of(row)) do
    local g, word = group(s), controls.pretty(s)
    -- (a trigger can be bound as a button and as an axis: say it once)
    if not seen[g .. word] then
      seen[g .. word] = true
      if g == "key" then keys[#keys + 1] = word elseif g == "pad" then pads[#pads + 1] = word end
    end
  end
  local text = table.concat(keys, ", ")
  if #pads > 0 then text = text .. (#keys > 0 and "  ·  " or "") .. table.concat(pads, ", ") end
  return text
end

--- Makes `source` (as `nova.input.next_source()` reports it) what the row uses, in place of its entries of the same kind.
--- Returns false when that source cannot be used for the row (a stick for a button, a trigger for steering).
function controls.assign(row, source)
  local g = group(source)
  if g == "other" then return false end
  local kind, name = source:match("^(%a+):(.+)$")
  if kind == "axis" then
    if row.side then
      if name ~= "left_x" and name ~= "right_x" then return false end
      source = "axis:" .. name .. (row.side == "negative" and "-" or "+")
    elseif name ~= "l2" and name ~= "r2" then
      return false
    end
  elseif kind == "pad" and row.side then
    return false -- steering is a stick or keys, not a button
  end
  local kept = {}
  for _, s in ipairs(sources_of(row)) do
    if group(s) ~= g then kept[#kept + 1] = s end
  end
  kept[#kept + 1] = source
  if row.side then
    local b = nova.input.bindings(row.action)
    b[row.side] = kept
    nova.input.bind(row.action, b)
  else
    nova.input.bind(row.action, kept)
  end
  controls.save()
  return true
end

function controls.save()
  local snapshot = {}
  for _, row in ipairs(controls.rows) do snapshot[row.action] = nova.input.bindings(row.action) end
  nova.save.set("controls", snapshot)
end

--- Puts the saved choices back (called when the game starts); a damaged save is ignored.
function controls.load()
  local saved = nova.save.get("controls", nil)
  if type(saved) ~= "table" then return end
  for action, spec in pairs(saved) do
    pcall(nova.input.bind, action, spec)
  end
end

function controls.reset()
  nova.input.reset_bindings()
  nova.save.set("controls", {})
end

return controls
