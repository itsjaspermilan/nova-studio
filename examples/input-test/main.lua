-- Input Test: shows every controller button and axis live, and logs each new input source ("input-test: ..."), so that what a
-- handheld's controller really sends can be read off the screen and out of `adb logcat`.
local BUTTONS = {
  { "south", "A (south)" }, { "east", "B (east)" }, { "west", "X (west)" }, { "north", "Y (north)" },
  { "l1", "L1" }, { "r1", "R1" }, { "l2", "L2 button" }, { "r2", "R2 button" },
  { "start", "Start" }, { "select", "Select" }, { "thumb_l", "L3" }, { "thumb_r", "R3" },
  { "dpad_up", "D-pad up" }, { "dpad_down", "D-pad down" }, { "dpad_left", "D-pad left" }, { "dpad_right", "D-pad right" },
}
local AXES = {
  { "left_x", "left stick x" }, { "left_y", "left stick y" }, { "right_x", "right stick x" }, { "right_y", "right stick y" },
  { "trigger_l", "L2 trigger" }, { "trigger_r", "R2 trigger" },
}
local seen = {} -- what has been pressed or moved at least once
local last_source = ""
local peak = {}

function update(dt)
  for _, b in ipairs(BUTTONS) do
    if nova.input.pressed(b[1]) then
      seen[b[1]] = true
      nova.log("input-test: button " .. b[1])
    end
  end
  for _, a in ipairs(AXES) do
    local v = nova.input.axis(a[1])
    if math.abs(v) > math.abs(peak[a[1]] or 0) then peak[a[1]] = v end
    if math.abs(v) > 0.5 and not seen[a[1]] then
      seen[a[1]] = true
      nova.log(string.format("input-test: axis %s reached %.2f", a[1], v))
    end
  end
  local src = nova.input.last_source()
  if src ~= last_source then
    last_source = src
    nova.log("input-test: last source " .. tostring(src))
  end
end

function draw()
  local w, h = nova.view()
  nova.ui.rect(0, 0, w, h, { 18, 20, 30 })
  nova.ui.text(24, 40, "Input Test: press every button, move every stick, pull every trigger", { size = 24, color = { 255, 255, 255 } })
  nova.ui.text(24, 74, "last source: " .. tostring(last_source) .. "      (a name turns green once it has been seen)", { size = 18, color = { 160, 200, 255 } })
  for i, b in ipairs(BUTTONS) do
    local col, row = (i - 1) % 4, (i - 1) // 4
    local x, y = 24 + col * 230, 110 + row * 56
    local down = nova.input.down(b[1])
    local color = down and { 255, 210, 60 } or (seen[b[1]] and { 40, 120, 70 } or { 50, 54, 70 })
    nova.ui.rect(x, y, 214, 44, color)
    nova.ui.text(x + 12, y + 29, b[2], { size = 20, color = down and { 20, 20, 20 } or { 235, 235, 235 } })
  end
  for i, a in ipairs(AXES) do
    local x, y = 24 + ((i - 1) % 2) * 470, 350 + ((i - 1) // 2) * 54
    local v = nova.input.axis(a[1])
    nova.ui.rect(x, y, 440, 40, seen[a[1]] and { 40, 90, 60 } or { 50, 54, 70 })
    nova.ui.rect(x + 220, y + 4, 2, 32, { 120, 120, 140 })
    if v >= 0 then nova.ui.rect(x + 220, y + 6, 214 * v, 28, { 255, 210, 60 }) else nova.ui.rect(x + 220 + 214 * v, y + 6, -214 * v, 28, { 255, 210, 60 }) end
    nova.ui.text(x + 8, y + 27, string.format("%s  %+.2f   (peak %+.2f)", a[2], v, peak[a[1]] or 0), { size = 18, color = { 245, 245, 245 } })
  end
end
