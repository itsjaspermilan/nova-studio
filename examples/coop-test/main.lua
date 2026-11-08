-- Coop Test: two (up to four) players collect stars, on one device with several controllers or on two devices on the same
-- wifi (one hosts, the other joins). It shows the engine's player support: seats (nova.input.players), each player's
-- actions (nova.input.down("dash", 2)), rumble, button prompts, remapping that is saved, and local co-op (nova.net).
local A = require("lib.arena")

local screen = "title"
local menu = { i = 1 }
local game          -- the rules' state, on this device or on the host
local mode          -- "local", "host" or "guest"
local toasts = {}   -- short messages at the bottom
local found = {}    -- games found on the network
local listening     -- the player whose dash is being changed (controls screen)
local frame = 0

local ui = nova.ui
local WHITE, DIM, ACCENT = { 240, 242, 250 }, { 150, 156, 180 }, { 255, 214, 90 }

local function toast(text)
  toasts[#toasts + 1] = { text = text, t = 3 }
  nova.log("coop: " .. text)
end

-- "A Choose   B Back": the buttons as this player's pad prints them
local function hints(items)
  local w, h = nova.view()
  local x = w - 30
  for i = #items, 1, -1 do
    local action, words = items[i][1], items[i][2]
    local label = nova.input.prompt(action) or action
    local tw = ui.text(x, h - 44, words, { size = 18, align = "right", color = WHITE })
    x = x - tw - 10
    local bw = math.max(30, ui.text_width(label, { size = 18 }) + 16)
    ui.rect(x - bw, h - 48, bw, 30, { 255, 255, 255 })
    ui.text(x - bw / 2, h - 44, label, { size = 18, align = "center", color = { 20, 22, 30 } })
    x = x - bw - 28
  end
end

local function choose(items)
  if nova.input.pressed("up") then menu.i = (menu.i - 2) % #items + 1 end
  if nova.input.pressed("down") then menu.i = menu.i % #items + 1 end
  if menu.i > #items then menu.i = #items end
  return nova.input.pressed("ok") and items[menu.i]
end

local function draw_menu(items, x, y)
  for i, it in ipairs(items) do
    local on = i == menu.i
    if on then ui.rect(x - 16, y + (i - 1) * 52 - 8, 520, 44, { 60, 70, 110 }) end
    ui.text(x, y + (i - 1) * 52, it.text, { size = 26, color = on and ACCENT or WHITE })
  end
end

local function go(name)
  screen, menu.i = name, 1
  nova.log("coop: screen " .. name)
end

local function start(m)
  mode, game = m, A.new()
  A.join(game, 1, mode == "local" and "Player 1" or nova.net.name())
  go("play")
end

-- the players seated now (pads here, and players on other devices) are in the game; those who left are "away"
local function seat_players()
  for _, p in ipairs(nova.input.players()) do
    if p.connected then
      local name = p.remote and p.name or ("Player " .. p.player)
      if p.player == 1 and mode == "host" then name = nova.net.name() end
      A.join(game, p.player, name)
    else
      A.leave(game, p.player)
    end
  end
  for _, e in ipairs(nova.input.player_events()) do
    if e.kind == "joined" then toast(string.format("Player %d joined (%s)", e.player, e.name))
    elseif e.kind == "left" then toast(string.format("Player %d left", e.player))
    elseif e.kind == "back" then toast(string.format("Player %d is back", e.player)) end
  end
end

local function read(n)
  return { x = nova.input.axis("move_x", n), y = nova.input.axis("move_y", n), dash = nova.input.pressed("dash", n) }
end

-- --- screens ---

local TITLE = {
  { text = "Play here (every controller is a player)", go = "local" },
  { text = "Host a game on this wifi", go = "host" },
  { text = "Join a game on this wifi", go = "find" },
  { text = "Controls", go = "controls" },
}

local function title_update()
  local it = choose(TITLE)
  if not it then return end
  if it.go == "local" then
    start("local")
  elseif it.go == "host" then
    local ok, err = nova.net.host({ players = 4 })
    if ok then
      toast("Hosting as " .. nova.net.name())
      start("host")
    else
      toast(err)
    end
  elseif it.go == "find" then
    found = {}
    go("find")
  else
    go("controls")
  end
end

local function title_draw()
  ui.text(80, 70, "Coop Test", { size = 54, color = ACCENT, shadow = true })
  ui.text(80, 140, "Collect stars. Dash into the others to push them away.", { size = 20, color = DIM })
  draw_menu(TITLE, 96, 210)
  -- who is here
  local y = 440
  ui.text(80, y - 36, "Players", { size = 18, color = DIM })
  local x = 80
  for _, p in ipairs(nova.input.players()) do
    if not p.remote then
      local c = A.COLORS[p.player] or WHITE
      local w = ui.text(x, y, string.format("%d: %s%s", p.player, p.name, p.connected and "" or " (gone)"), { size = 18, color = c })
      x = x + w + 30
    end
  end
  hints({ { "ok", "Choose" } })
end

local function find_update()
  local before = #found
  found = nova.net.find()
  if #found ~= before then nova.log("coop: found " .. #found .. (found[1] and (" " .. found[1].name) or "")) end
  if nova.input.pressed("back") then
    nova.net.leave()
    go("title")
    return
  end
  local items = {}
  for _, f in ipairs(found) do
    items[#items + 1] = { text = string.format("Join %s  (%d of %d)", f.name, f.players, f.max), id = f.id, full = f.full }
  end
  local it = #items > 0 and choose(items)
  if it then
    if it.full then
      toast("That game is full")
    else
      nova.net.join(it.id)
      go("joining")
    end
  end
end

local function find_draw()
  ui.text(80, 70, "Join a game", { size = 44, color = ACCENT })
  local _, status = nova.net.status()
  ui.text(80, 130, status, { size = 20, color = DIM })
  if #found == 0 then
    ui.text(96, 210, "No games yet. On the other device, choose \"Host a game on this wifi\".", { size = 20, color = WHITE, width = 760 })
  else
    local items = {}
    for _, f in ipairs(found) do items[#items + 1] = { text = string.format("Join %s  (%d of %d)", f.name, f.players, f.max) } end
    draw_menu(items, 96, 210)
  end
  hints({ { "ok", "Join" }, { "back", "Back" } })
end

local function joining_update()
  local role = nova.net.status()
  if role == "joined" then
    mode = "guest"
    toast("Joined as player " .. nova.net.me())
    go("play")
  elseif role == "lost" then
    go("lost")
    nova.log("coop: lost: " .. select(2, nova.net.status()))
  elseif nova.input.pressed("back") then
    nova.net.leave()
    go("title")
  end
end

local function joining_draw()
  local _, status = nova.net.status()
  ui.text(80, 200, status .. "...", { size = 32, color = WHITE })
  hints({ { "back", "Stop" } })
end

local function lost_draw()
  local _, status = nova.net.status()
  ui.text(80, 200, status, { size = 32, color = WHITE, width = 800 })
  hints({ { "ok", "Back to the title" } })
end

local function lost_update()
  if nova.input.pressed("ok") or nova.input.pressed("back") then
    nova.net.leave()
    go("title")
  end
end

local paused = false

local function play_update(dt)
  for _, e in ipairs(nova.net.events()) do
    if e.kind == "lost" then
      go("lost")
      nova.log("coop: lost: " .. select(2, nova.net.status()))
      return
    end
  end
  if nova.input.pressed("menu") then paused = not paused end
  if paused then
    if nova.input.pressed("ok") then
      paused = false
      nova.net.leave()
      go("title")
    elseif nova.input.pressed("back") then
      paused = false
    end
    return
  end
  if mode == "guest" then return end -- the host runs the game; this device draws what it sends
  seat_players()
  for _, e in ipairs(A.step(game, dt, read)) do
    if e.kind == "star" then
      nova.input.rumble(0.5, 0.12, e.player) -- a player on another device feels it too: the host sends it on
    elseif e.kind == "bump" then
      nova.input.rumble(1, 0.25, e.other)
      nova.input.rumble(0.3, 0.1, e.player)
    elseif e.kind == "win" then
      toast(game.players[e.player].name .. " wins!")
    end
  end
  if game.winner and nova.input.pressed("ok") then
    local players = game.players
    game = A.new()
    for n, p in pairs(players) do if p.here then A.join(game, n, p.name) end end
  end
  if mode == "host" then nova.net.state(A.snapshot(game)) end
end

local function play_draw()
  local snap, me
  if mode == "guest" then
    snap, me = nova.net.state(), nova.net.me()
    if not snap then
      ui.text(80, 200, "Waiting for the host's picture...", { size = 28, color = WHITE })
      return
    end
  else
    snap, me = A.snapshot(game), (mode == "host" and 1 or nil)
  end
  A.draw(snap, me)
  if snap.w then
    local p
    for _, q in ipairs(snap.p) do if q.n == snap.w then p = q end end
    ui.text(480, 230, (p and p.name or "?") .. " wins!", { size = 48, align = "center", color = A.COLORS[snap.w], shadow = true })
    if mode ~= "guest" then ui.text(480, 300, "Press " .. (nova.input.prompt("ok") or "A") .. " to play again", { size = 22, align = "center", color = WHITE }) end
  end
  if mode == "host" then
    local _, status = nova.net.status()
    local addr = nova.net.address()
    ui.text(940, 506, status .. (addr and ("   " .. addr) or ""), { size = 14, align = "right", color = DIM })
  end
  if paused then
    ui.rect(0, 0, 960, 540, { 0, 0, 0, 160 })
    ui.text(480, 200, "Paused", { size = 44, align = "center", color = WHITE })
    hints({ { "ok", mode == "local" and "Back to the title" or "Leave the game" }, { "back", "Carry on" } })
  else
    hints({ { "dash", "Dash" }, { "menu", "Pause" } })
  end
end

-- Controls: each player can change their own dash button; the choice is saved for the next time.
local function controls_items()
  local items = {}
  for _, p in ipairs(nova.input.players()) do
    if not p.remote and p.connected then
      items[#items + 1] = { text = string.format("Player %d dash: %s", p.player, nova.input.prompt("dash", p.player) or "?"), player = p.player }
    end
  end
  items[#items + 1] = { text = "Back to the defaults", reset = true }
  items[#items + 1] = { text = "Done", done = true }
  return items
end

local function controls_update()
  if listening then
    local source, player = nova.input.next_source()
    if source and (source:match("^pad:") or source:match("^key:")) then
      if source == "key:Escape" then
        listening = nil
      elseif (player or 1) == listening then
        nova.input.bind("dash", { source }, listening)
        nova.input.save_controls()
        toast(string.format("Player %d dashes with %s", listening, nova.input.glyph(source) or source))
        listening = nil
      end
    end
    return
  end
  if nova.input.pressed("back") then go("title") return end
  local it = choose(controls_items())
  if not it then return end
  if it.done then go("title")
  elseif it.reset then
    nova.input.reset_bindings()
    nova.input.save_controls()
    toast("Controls are back to the defaults")
  else
    listening = it.player
    nova.input.next_source() -- forget the press that chose the row
  end
end

local function controls_draw()
  ui.text(80, 70, "Controls", { size = 44, color = ACCENT })
  draw_menu(controls_items(), 96, 170)
  if listening then
    ui.rect(0, 0, 960, 540, { 0, 0, 0, 170 })
    ui.text(480, 230, string.format("Player %d: press the button to dash with", listening), { size = 28, align = "center", color = WHITE })
    ui.text(480, 280, "(Esc to keep it as it is)", { size = 18, align = "center", color = DIM })
  else
    hints({ { "ok", "Change" }, { "back", "Back" } })
  end
end

local SCREENS = {
  title = { title_update, title_draw },
  find = { find_update, find_draw },
  joining = { joining_update, joining_draw },
  lost = { lost_update, lost_draw },
  play = { play_update, play_draw },
  controls = { controls_update, controls_draw },
}

function update(dt)
  frame = frame + 1
  SCREENS[screen][1](dt)
  for i = #toasts, 1, -1 do
    toasts[i].t = toasts[i].t - dt
    if toasts[i].t <= 0 then table.remove(toasts, i) end
  end
  -- a line for tests and for reading a run off `adb logcat`
  if frame % 60 == 0 and screen == "play" then
    local snap = mode == "guest" and nova.net.state() or (game and A.snapshot(game))
    local parts = {}
    for _, p in ipairs(snap and snap.p or {}) do parts[#parts + 1] = string.format("p%d=%.0f,%.0f,%d", p.n, p.x, p.y, p.s) end
    local role, status = nova.net.status()
    nova.log(string.format("coop: mode=%s net=%s me=%s %s (%s)", mode, role, tostring(nova.net.me()), table.concat(parts, " "), status))
  end
end

function draw()
  local w, h = nova.view()
  ui.rect(0, 0, w, h, { 24, 28, 44 })
  SCREENS[screen][2]()
  for i, t in ipairs(toasts) do
    ui.text(40, h - 60 - (#toasts - i) * 28, t.text, { size = 18, color = ACCENT, shadow = true })
  end
end
