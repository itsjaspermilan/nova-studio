-- The title scene's pages for the made-up courses (2026-11-21): CUSTOM STAGE (the settings, a live map of the route, the share code, new
-- seed, enter a code, the codes played lately and the favourites) and DAILY RACE (today's course, its car, your best and medal, the time
-- to the next one, and a calendar of the days). They are methods of scenes/title.lua's scene, added by `install`, and draw like its other
-- pages (lib/ui.lua's look: the dark panel down the left, the orange focus, the hint bar along the bottom).
local state = require("lib.state")
local audio = require("lib.audio")
local ui = require("lib.ui")
local generate = require("lib.generate")
local daily = require("lib.daily")
local targets = require("lib.targets")
local menu_bg = require("lib.menu_bg")

local C, F = ui.color, ui.font

return function(Title, h)
  local route, line, cell = h.route, h.line, h.cell

  -- ---- shared pieces ---------------------------------------------------------------------------------------------------------------
  local function car_of(id) return state.cars[state.index_of(id)] end
  local function short(t) return (ui.time(t):gsub("%.%d%d$", function(cs) return "." .. cs:sub(2, 2) end)) end
  -- "2.4 km x 3 laps" or "3.6 km"
  local function length_text(entry)
    if entry.km then return string.format("%.1f km", entry.km) end
    return string.format("%.1f km  x  %d laps", entry.lap_km, entry.laps)
  end
  local function surface_name(s)
    local loc = generate.LOCATIONS[s.location]
    if s.surface == 2 then return "Tarmac" end
    local own = loc.road == "road_asphalt" and "Tarmac" or loc.loose_name
    if s.surface == 3 then return own .. " and " .. (own == "Tarmac" and "gravel" or "tarmac") end
    return own
  end
  -- what the settings make, in a few words: "Forest stage · Mixed · Rolling"
  local function summary(s)
    return generate.LOCATIONS[s.location].name .. " " .. (s.type == 1 and "stage" or "circuit") .. "  ·  " .. generate.COMPLEXITY[s.complexity].name
      .. "  ·  " .. generate.HILLS[s.hills].name
  end
  local function medal_box(medal, size)
    return { "box", w = size, h = size, draw = function(r)
      nova.ui.rect(r.x, r.y, r.w, r.h, targets.COLORS[medal])
      ui.say(r.x + r.w / 2, r.y + r.h / 2, medal == 3 and "G" or medal == 2 and "S" or medal == 1 and "B" or "-", F.heavy, size * 0.62, C.ink, { align = "center", valign = "middle" })
    end }
  end
  -- the three targets in a row of small cells, for car `car`
  local function target_cells(entry, car, mine)
    local t = targets.of(entry, car)
    local row = { "row", gap = 6 }
    for i, medal in ipairs({ "gold", "silver", "bronze" }) do
      local won = mine and mine >= 4 - i
      row[#row + 1] = { "panel", grow = 1, panel = { color = C.panel2 }, pad = { 10, 6 }, gap = 0,
        { "box", h = 3, draw = function(r) nova.ui.rect(r.x - 10, r.y - 6, r.w + 20, 3, targets.COLORS[4 - i]) end },
        { "text", (won and "* " or "") .. targets.NAMES[4 - i], font = F.body, size = 14, color = C.dim },
        { "text", short(t[medal]), font = F.heavy, size = 21 } }
    end
    return row, t
  end

  -- ---- CUSTOM STAGE -----------------------------------------------------------------------------------------------------------------
  function Title:open_custom()
    state.custom = nil
    if not self.cs then
      local saved = nova.save.get("custom_settings", nil)
      local s = saved and generate.decode(saved) or nil
      self.cs = s or generate.settings_default()
    end
    nova.ui.forget("custom")
    self.custom_note = nil
    self:go("custom")
  end

  local ROWS = {
    { "location", "LOCATION", function(s) return generate.LOCATIONS[s.location].name end },
    { "type", "TYPE", function(s) return generate.TYPES[s.type].name end },
    { "length", "LENGTH", function(s, e) return generate.LENGTHS[s.length].name .. "  ·  " .. length_text(e) end },
    { "complexity", "BENDS", function(s) return generate.COMPLEXITY[s.complexity].name end },
    { "hills", "HILLS", function(s) return generate.HILLS[s.hills].name end },
    { "surface", "SURFACE", function(s) return surface_name(s) end },
    { "time", "TIME OF DAY", function(s) return generate.TIMES[s.time].name end },
    { "weather", "WEATHER", function(s) return generate.WEATHERS[s.weather].name end },
  }

  function Title:custom_menu()
    local s = self.cs
    local entry = generate.entry(s)
    local rt = generate.route(s)
    ui.side_panel(470)
    nova.ui.layout { anchor = "topleft", margin = 0, x = 48, y = 22, ui.header("Custom  ·  " .. generate.TYPES[s.type].name, "Make a course", 42) }
    local root = { id = "custom", anchor = "topleft", margin = 0, x = 48, y = 100, w = 372, gap = 0, enter = self.entered }
    for _, row in ipairs(ROWS) do
      local fixed = (row[1] == "time" and generate.LOCATIONS[s.location].night_only) or (row[1] == "weather" and generate.LOCATIONS[s.location].id ~= "snow")
      root[#root + 1] = { "button", row[2], value = fixed and row[3](s, entry) or ("< " .. row[3](s, entry) .. " >"), id = row[1], adjust = true, h = 31 }
    end
    root[#root + 1] = { "space", h = 6 }
    root[#root + 1] = { "button", "ENTER A CODE", id = "code", h = 31 }
    root[#root + 1] = { "button", "SAVED CODES", id = "saved", h = 31 }
    root[#root + 1] = { "button", "CHOOSE A CAR", id = "go", h = 40, size = 27 }
    local r = nova.ui.menu(root)

    -- the right: the route, its code (and a star when it is a favourite), its facts and its targets for the car last chosen
    local car = state.current_car()
    local fav = state.is_favourite(entry.code)
    local cells, t = target_cells(entry, car)
    local right = { "panel", anchor = "topright", margin = 36, y = -6, w = 418, pad = { 18, 12 }, gap = 6, id = "cside",
      { "row", gap = 10, align = "center",
        { "text", "SHARE CODE", style = "kicker", grow = 1 },
        { "text", fav and "FAVOURITE" or "", font = F.bold, size = 15, color = C.gold, spacing = 0.12 } },
      { "text", entry.code, font = F.heavy, size = 46, color = C.white, spacing = 0.08, h = 46 },
      { "box", h = 170, draw = function(rr) route(generate.preview(rt), rr, 14) end },
      { "row", gap = 6, cell("Length", entry.km and (entry.km .. " km") or (entry.lap_km .. " km lap"), 120), cell("Bends", tostring(rt.corners), 120),
        cell("Hairpins", tostring(rt.hairpins), 120) },
      { "text", "TARGETS IN THE " .. string.upper(car.name), style = "label", size = 14 },
      cells }
    local rects = nova.ui.layout(right)
    nova.ui.rect(rects.cside.x, rects.cside.y, 6, rects.cside.h, C.orange)
    if self.custom_note then ui.hint(self.custom_note)
    else ui.hints({ { "pad_dpad", "Change" }, { "pad_x", "New seed" }, { "pad_y", fav and "Unfavourite" or "Favourite" }, { "pad_a", "Select" }, { "pad_b", "Back" } }) end

    local changed = false
    if r.changed and r.step then
      generate.step(s, r.changed, r.step)
      changed = true
    end
    if nova.input.pressed("x") then
      -- a new seed: a jump through the seeds from the one before (the same series on every machine), and a little of the clock
      s.seed = (generate.mix64(s.seed + 1 + math.floor(nova.time() * 1000)) >> 20) % generate.SEEDS
      audio.sfx("menu_move")
      changed = true
    end
    if nova.input.pressed("y") then
      local now = state.toggle_favourite(entry.code)
      audio.sfx(now and "menu_accept" or "menu_back")
      self.custom_note = now and ("Saved " .. entry.code .. " to your favourites.") or nil
    end
    if changed then
      self.custom_note = nil
      nova.save.set("custom_settings", generate.encode(s))
      nova.log("custom: " .. generate.encode(s) .. " " .. summary(s))
    end
    if r.back then self:go("menu") return end
    if r.pressed == "code" then audio.sfx("menu_accept"); self:open_code()
    elseif r.pressed == "saved" then audio.sfx("menu_accept"); nova.ui.forget("saved"); self:go("saved")
    elseif r.pressed == "go" then
      audio.sfx("menu_accept")
      state.custom = generate.entry(s)
      state.mode = s.type == 1 and "rally" or "race"
      state.laps = state.custom.laps
      nova.log(string.format("custom: chose %s (%s), %.0f m, %d bends, ideal %.1f s for %s", entry.code, summary(s), rt.length, rt.corners, t.ideal, car.id))
      self:open_garage("flow")
    elseif r.pressed then audio.sfx("menu_move") end
  end

  -- ---- ENTER A CODE: a grid of the code's letters ------------------------------------------------------------------------------------
  function Title:open_code()
    self.code_text, self.code_error = "", nil
    nova.ui.forget("code")
    nova.input.typed() -- (drop what was typed before)
    self:go("code")
  end

  function Title:code_menu()
    ui.side_panel(560)
    nova.ui.layout { anchor = "topleft", margin = 0, x = 48, y = 30, ui.header("Custom", "Enter a code", 48) }
    local text = self.code_text
    -- the eight places, four and four, the next one lit
    local slots = { "row", gap = 6, align = "center" }
    for i = 1, 8 do
      local ch = text:sub(i, i)
      slots[#slots + 1] = { "panel", w = 40, h = 52, pad = 0, panel = { color = i == #text + 1 and C.orange or C.panel2 },
        { "text", ch ~= "" and ch or "", font = F.heavy, size = 36, color = i == #text + 1 and C.ink or C.white, align = "center", h = 52 } }
      if i == 4 then slots[#slots + 1] = { "text", "-", font = F.heavy, size = 30, color = C.dim } end
    end
    nova.ui.layout { anchor = "topleft", margin = 0, x = 48, y = 112, slots }
    local grid = { "grid", columns = 8, gap = 5, cell_w = 44, cell_h = 38 }
    local letters = generate.ALPHABET
    for i = 1, #letters do
      local ch = letters:sub(i, i)
      grid[#grid + 1] = { "button", ch, id = ch, look = "tab", h = 38 }
    end
    grid[#grid + 1] = { "button", "DEL", id = "del", look = "tab", h = 38 }
    grid[#grid + 1] = { "button", "CLEAR", id = "clear", look = "tab", h = 38 }
    grid[#grid + 1] = { "button", "OK", id = "ok", look = "tab", h = 38, on = #text == 8 }
    local r = nova.ui.menu { id = "code", anchor = "topleft", margin = 0, x = 48, y = 186, w = 390, enter = false, grid }
    local msg = self.code_error and { "text", self.code_error, font = F.semi, size = 17, color = C.red, wrap = true, w = 420 }
      or { "text", "Codes are eight letters and numbers (no 0, 1, O or I). Ask a friend for theirs, or find yours on the custom page.", style = "muted", wrap = true, w = 420 }
    nova.ui.layout { anchor = "topright", margin = 36, y = 112, w = 420, msg }
    ui.hints({ { "pad_dpad", "Move" }, { "pad_a", "Type" }, { "pad_start", "Done" }, { "pad_b", "Delete" } })
    -- (a keyboard works too: its letters and backspace, enter for done)
    local typed = nova.input.typed()
    for ch in typed:gmatch(".") do
      if ch == "\b" then self.code_text = self.code_text:sub(1, -2)
      elseif ch == "\n" then r.pressed = "ok"
      else
        local up = ch:upper()
        if #self.code_text < 8 and generate.ALPHABET:find(up, 1, true) then self.code_text = self.code_text .. up end
      end
    end
    local function done()
      local s, why = generate.decode(self.code_text)
      if s then
        audio.sfx("menu_accept")
        self.cs = s
        nova.save.set("custom_settings", generate.encode(s))
        nova.log("code: entered " .. generate.encode(s))
        nova.ui.forget("custom")
        self.custom_note = "Code " .. generate.encode(s) .. ": " .. summary(s) .. "."
        self:go("custom")
      else
        audio.sfx("menu_back")
        self.code_error = why
        nova.log("code: refused " .. self.code_text .. ": " .. why)
      end
    end
    if r.back then
      if #self.code_text > 0 then self.code_text = self.code_text:sub(1, -2); self.code_error = nil
      else self:go("custom") end
      return
    end
    -- (start is done wherever the focus is; the menu also takes start as A, so its press is not typed)
    if nova.input.pressed("start") then done() return end
    if r.pressed == "ok" then done()
    elseif r.pressed == "del" then self.code_text = self.code_text:sub(1, -2); self.code_error = nil; audio.sfx("menu_back")
    elseif r.pressed == "clear" then self.code_text = ""; self.code_error = nil; audio.sfx("menu_back")
    elseif r.pressed then
      if #self.code_text < 8 then self.code_text = self.code_text .. r.pressed; audio.sfx("menu_move") else audio.sfx("menu_back") end
      self.code_error = nil
      if #self.code_text == 8 then nova.ui.focus("code", "ok") end
    end
  end

  -- ---- SAVED CODES: the favourites, then the codes played lately --------------------------------------------------------------------
  function Title:saved_menu()
    ui.side_panel(620)
    nova.ui.layout { anchor = "topleft", margin = 0, x = 48, y = 30, ui.header("Custom", "Saved codes", 48) }
    local list = { "column", gap = 4, visible = 7 }
    local seen, codes = {}, {}
    for _, c in ipairs(state.favourite_codes()) do codes[#codes + 1] = { c, true }; seen[c] = true end
    for _, c in ipairs(state.recent_codes()) do if not seen[c] then codes[#codes + 1] = { c, false } end end
    for i, it in ipairs(codes) do
      local s = generate.decode(it[1])
      list[#list + 1] = { "button", (it[2] and "* " or "") .. it[1], id = it[1], look = "row", number = i, h = 44,
        value = s and summary(s) or "made with an older version", locked = not s }
    end
    if #codes == 0 then
      list[#list + 1] = { "text", "No codes yet. Drive a custom course, or press Y on the custom page to keep one here.", style = "muted", wrap = true, w = 520 }
    end
    local r = nova.ui.menu { id = "saved", anchor = "topleft", margin = 0, x = 48, y = 130, w = 540, enter = self.entered, list }
    ui.hints({ { "pad_y", "Favourite" }, { "pad_a", "Load" }, { "pad_b", "Back" } })
    if r.back then self:go("custom") return end
    if nova.input.pressed("y") and r.focus then state.toggle_favourite(r.focus); audio.sfx("menu_move") end
    if r.pressed then
      local s, why = generate.decode(r.pressed)
      if s then
        audio.sfx("menu_accept")
        self.cs = s
        nova.save.set("custom_settings", generate.encode(s))
        nova.ui.forget("custom")
        self:go("custom")
      else
        audio.sfx("menu_back")
        self.custom_note = why
      end
    end
  end

  -- ---- DAILY RACE ---------------------------------------------------------------------------------------------------------------------
  local entries = {}
  local function daily_entry(z)
    if not entries[z] then entries[z] = daily.entry(z) end
    return entries[z]
  end

  -- `z`: the day to show (today when left out)
  function Title:open_daily(z)
    state.custom = nil
    self.daily_z = z or daily.day_at()
    self.daily_today = daily.day_at()
    nova.ui.forget("daily")
    self:go("daily")
  end

  function Title:daily_menu()
    local today = daily.day_at()
    -- at midnight in Toronto the page rolls over to the new day (if it was showing the day that ended)
    if self.daily_today and today ~= self.daily_today then
      if self.daily_z == self.daily_today then self.daily_z = today end
      nova.log("daily: a new day, " .. daily.key(today))
      self.daily_today = today
    end
    local z = self.daily_z
    local entry = daily_entry(z)
    local s = entry.generated
    local rt = generate.route(s)
    local car = car_of(entry.car)
    local res = daily.result(z)
    ui.side_panel(470)
    nova.ui.layout { anchor = "topleft", margin = 0, x = 48, y = 22, ui.header("Daily Race  ·  #" .. daily.number(z), daily.long_date(z), 34) }
    local loc = generate.LOCATIONS[s.location]
    local rows = { "column", gap = 0, w = 372,
      line("Course", loc.name .. " " .. (s.type == 1 and "stage" or "circuit") .. ", " .. length_text(entry)),
      line("Bends", generate.COMPLEXITY[s.complexity].name .. ", " .. rt.corners .. " bends"),
      line("Hills and road", generate.HILLS[s.hills].name .. ", " .. surface_name(s)),
      line("Time and weather", generate.TIMES[s.time].name .. ", " .. generate.WEATHERS[s.weather].name),
      line("Today's car", car.name .. " (" .. state.class_of(car).name .. ")", C.gold),
      line("Your best", res and res.time and (ui.time(res.time) .. "  ·  " .. targets.NAMES[res.medal]) or "Not driven yet", res and targets.COLORS[res.medal] or C.dim) }
    nova.ui.layout { anchor = "topleft", margin = 0, x = 48, y = 84, rows }
    -- the time to the next race (or which day this is)
    local now = daily.now()
    local count = { "column", gap = 0 }
    if z == today then
      count[#count + 1] = { "text", "NEXT RACE IN", style = "kicker" }
      count[#count + 1] = { "text", daily.clock_text(daily.until_next(now)), font = F.heavy, size = 42, h = 44 }
    else
      count[#count + 1] = { "text", "A PAST DAY", style = "kicker" }
      count[#count + 1] = { "text", "Today is #" .. daily.number(today), font = F.heavy, size = 30, h = 36 }
    end
    nova.ui.layout { anchor = "topleft", margin = 0, x = 48, y = 262, count }
    local r = nova.ui.menu {
      id = "daily", anchor = "topleft", margin = 0, x = 48, y = 352, w = 372, enter = self.entered,
      { "button", "DRIVE", id = "go", h = 48, size = 30 },
      { "button", "CALENDAR", id = "calendar", h = 34 },
    }
    local cells = target_cells(entry, car, res and res.medal)
    local right = { "panel", anchor = "topright", margin = 36, y = -6, w = 418, pad = { 18, 12 }, gap = 6, id = "dside",
      { "row", gap = 10, align = "center", { "text", "THE DAY'S CODE", style = "kicker", grow = 1 },
        res and medal_box(res.medal, 26) or { "space", w = 0 } },
      { "text", entry.code, font = F.heavy, size = 40, h = 42, spacing = 0.08 },
      { "box", h = 188, draw = function(rr) route(generate.preview(rt), rr, 14) end },
      { "text", "TARGETS IN THE " .. string.upper(car.name), style = "label", size = 14 },
      cells }
    local rects = nova.ui.layout(right)
    nova.ui.rect(rects.dside.x, rects.dside.y, 6, rects.dside.h, C.orange)
    ui.hints({ { "pad_a", "Select" }, { "pad_b", "Back" } })
    if r.back then self:go("menu") return end
    if r.pressed == "calendar" then
      audio.sfx("menu_accept")
      self.cal_z = z
      self:go("calendar")
    elseif r.pressed == "go" then
      audio.sfx("menu_accept")
      state.custom = entry
      state.mode = s.type == 1 and "rally" or "race"
      state.laps = entry.laps
      state.car = state.index_of(entry.car)
      nova.log(string.format("daily: chose #%d %s %s in %s", daily.number(z), daily.key(z), entry.code, entry.car))
      self:open_confirm()
    end
  end

  -- ---- the calendar ---------------------------------------------------------------------------------------------------------------
  function Title:calendar_menu()
    local today = daily.day_at()
    local first = daily.first_day()
    local z = self.cal_z or today
    -- the pad: a day at a time left and right, a week up and down, a month with L and R
    local step = (nova.input.pressed("right") and 1 or 0) - (nova.input.pressed("left") and 1 or 0)
      + 7 * ((nova.input.pressed("down") and 1 or 0) - (nova.input.pressed("up") and 1 or 0))
    local y, m, d = daily.date(z)
    local month = (nova.input.pressed("r1") and 1 or 0) - (nova.input.pressed("l1") and 1 or 0)
    if month ~= 0 then
      m = m + month
      if m > 12 then m, y = 1, y + 1 elseif m < 1 then m, y = 12, y - 1 end
      local last = daily.days(m == 12 and y + 1 or y, m == 12 and 1 or m + 1, 1) - 1
      local _, _, last_d = daily.date(last)
      z = daily.days(y, m, math.min(d, last_d))
    end
    z = z + step
    -- (not before the first race, nor more than a year on)
    z = math.max(first, math.min(today + 366, z))
    if z ~= self.cal_z then
      if self.cal_z then audio.sfx("menu_move") end
      self.cal_z = z
    end
    y, m, d = daily.date(z)
    local month_first = daily.days(y, m, 1)
    local month_last = daily.days(m == 12 and y + 1 or y, m == 12 and 1 or m + 1, 1) - 1
    local all = nova.save.get("daily", {})

    ui.side_panel(330)
    nova.ui.layout { anchor = "topleft", margin = 0, x = 48, y = 22, ui.header("Daily Race  ·  Calendar", daily.MONTHS[m] .. " " .. y, 40) }
    -- the chosen day, on the left
    local entry = daily_entry(z)
    local res = all[daily.key(z)]
    local locked = z > today
    local info = { "column", gap = 2, w = 250,
      { "text", daily.long_date(z), font = F.semi, size = 18 },
      { "text", "Daily #" .. daily.number(z), font = F.heavy, size = 30 },
      { "text", locked and "Opens on the day." or summary(entry.generated), style = "muted", wrap = true },
      { "space", h = 6 },
      { "text", res and res.time and (ui.time(res.time) .. "  " .. targets.NAMES[res.medal]) or (locked and "" or "Not driven yet"), font = F.heavy, size = 22,
        color = res and targets.COLORS[res.medal] or C.dim } }
    nova.ui.layout { anchor = "topleft", margin = 0, x = 48, y = 92, info }
    -- the month: Sunday first, a cell a day
    local x0, y0, cw, ch = 360, 70, 80, 54
    local w = nova.view()
    x0 = w - 36 - cw * 7
    for i, name in ipairs({ "SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT" }) do
      ui.say(x0 + (i - 1) * cw + cw / 2, y0 + 10, name, F.bold, 15, C.dim, { align = "center", valign = "middle", spacing = 0.12 })
    end
    local lead = daily.weekday(month_first)
    local weeks = (month_last - month_first + lead) // 7 + 1
    nova.ui.rect(x0 - 12, y0 - 8, cw * 7 + 24, 24 + weeks * ch + 20, { C.ground[1], C.ground[2], C.ground[3], 235 })
    for day = month_first, month_last do
      local k = day - month_first + lead
      local cx, cy = x0 + (k % 7) * cw, y0 + 24 + (k // 7) * ch
      local _, _, dd = daily.date(day)
      local r2 = all[daily.key(day)]
      local closed = day > today or day < first
      -- (days before the first race have no race: an outline only; days to come are locked)
      if day < first then
        nova.ui.rect(cx + 2, cy + ch - 4, cw - 4, 1.5, C.divider)
      else
        nova.ui.rect(cx + 2, cy + 2, cw - 4, ch - 4, closed and C.panel or C.panel2)
      end
      if day == today then nova.ui.rect(cx + 2, cy + ch - 6, cw - 4, 4, C.orange) end
      ui.say(cx + 10, cy + 8, tostring(dd), F.heavy, 20, closed and C.dim or C.white)
      if day > today then ui.lock(cx + cw - 24, cy + 9, 14, C.dim)
      elseif r2 and r2.time then
        nova.ui.rect(cx + cw - 26, cy + 8, 18, 18, targets.COLORS[r2.medal or 0])
        ui.say(cx + 10, cy + ch - 18, (ui.time(r2.time):gsub("%.%d%d$", "")), F.medium, 13.5, C.dim)
      elseif day >= first then
        ui.say(cx + 10, cy + ch - 18, "not driven", F.medium, 12, C.dim)
      end
      if day == z then
        local c = C.orange
        nova.ui.rect(cx, cy, cw, 3, c); nova.ui.rect(cx, cy + ch - 3, cw, 3, c); nova.ui.rect(cx, cy, 3, ch, c); nova.ui.rect(cx + cw - 3, cy, 3, ch, c)
      end
    end
    if self.cal_note then ui.hint(self.cal_note)
    else ui.hints({ { "pad_dpad", "Day" }, { "pad_l", "" }, { "pad_r", "Month" }, { "pad_a", locked and "Locked" or "Open" }, { "pad_b", "Back" } }) end
    if step ~= 0 or month ~= 0 then self.cal_note = nil end
    if nova.input.pressed("a") or nova.input.pressed("start") then
      if locked then
        audio.sfx("menu_back")
        self.cal_note = "That day's race opens at midnight in Toronto on the day."
      else
        audio.sfx("menu_accept")
        self.daily_z = z
        nova.ui.forget("daily")
        self:go("daily")
      end
    elseif nova.input.pressed("b") or nova.input.pressed("menu_back") then
      audio.sfx("menu_back")
      self:go("daily")
    end
  end
end
