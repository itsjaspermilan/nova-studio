-- The post office's room (scenes/office.scene.json): dusty, half the pigeonholes empty, the Mayor's letter on the front counter's desk
-- mat and the day's parcels on the tiles of the package counter along the back wall (one parcel to a tile; the picture frame above it says
-- how many are still to deliver; a belt comes in through a hatch from the backroom). X reads the letter, takes a parcel from its tile
-- (one at a time; its label is held up to read) or puts it back on the first free tile; the doorway leads out to the porch (a short fade, and they stand outside, free at once). Coming back in with both
-- delivered, the slice ends on its quiet card. The room is seen from one fixed view high over its cut-away front wall, like a
-- diorama ("when in a building, we should just have a simple top down view like Animal Crossing"); the stick moves the postmaster
-- as the screen shows the room.
local state = require("lib.state")
local world = require("lib.world")
local camera = require("lib.camera")
local cards = require("lib.cards")
local ui = require("lib.ui")
local words = require("lib.words")
local parcels = require("lib.parcels")
local music = require("lib.music")

local Office = nova.scene {}

local LETTER_AT = { 0.75, -0.45 }
local FADE = 0.3
local REACH = 1.1 -- how far from a tile's middle X still reaches it (the postmaster stands in the aisle between the counters)

-- The picture frame on the back wall (tools/office-layout.mjs FRAME) and the conveyor window's belt (WINDOW, the belt in models.mjs):
-- the numerals are pictures lying on the frame's plate, the belt's slats are drawn moving.
local FRAME = { x = 0, y = 1.8, z = -2.6 + 0.065 }
local BELT = { x = 3.0, y = 0.868, z0 = -2.6 - 4.0, z1 = -2.6 + 0.55, pitch = 0.14, speed = 0.05 }
local COMPUTER = { x = -1.15, y = 0.8, z = -0.75 } -- (the old computer on the front counter: its screen glows, nothing more yet)

function Office:enter()
  world.clear()
  nova.terrain() -- (no hills indoors)
  nova.sky { top = { 60, 48, 40 }, horizon = { 60, 48, 40 } }
  nova.fog(nil)
  -- the light from the window (the sun is low through it, from the right) and a warm, dim room
  nova.light { dir = { 0.75, -0.45, -0.25 }, color = { 255, 232, 196 }, ambient = { 92, 80, 72 } }
  nova.shadows { radius = 7, strength = 0.75, softness = 1.2 }
  nova.look { ao = 0.6, ao_radius = 0.6, saturation = 1.05, vignette = 0.3, bloom = 0.25, bloom_threshold = 0.8 }
  nova.wind()
  nova.pause(false)
  self.paused = false
  self.p = nova.named("postmaster")
  self.p.indoors = true
  self.t = 0
  self.fade_in = state.came_out and 1 or 0
  self.leaving = nil
  camera.reset(math.pi)
  if state.came_out then
    -- in through the door: standing just inside it, facing into the room, free at once
    local d = nova.named("office_exit")
    self.p.x, self.p.z, self.p.face = d.x, d.z - 0.75, math.pi
  end
  camera.room(0)
  music.start("indoors")
  nova.sound.play("door", { volume = state.came_out and 0.5 or 0, vary = 0.05 })
  self.ending_at = (state.all_delivered() and not state.ended) and 1.4 or nil
  nova.log("office: entered" .. (state.came_out and " from the porch" or ""))
end

-- What A would do here: read the letter, take or put back a parcel.
function Office:action()
  local p = self.p
  if not p.control then return nil end
  local function near(x, z, r) return (p.x - x) ^ 2 + (p.z - z) ^ 2 < r * r end
  if near(LETTER_AT[1], LETTER_AT[2] + 0.8, 1.15) then return "read" end
  -- the nearest tile in reach: with empty arms, the nearest with a parcel on it; with a parcel in the arms, any tile of the counter
  local best, bd
  for _, it in ipairs(nova.all("item")) do
    if it.item ~= "letter" and state.on_shelf[it.item] then
      local d = (p.x - it.x) ^ 2 + (p.z - it.z) ^ 2
      if d < REACH * REACH and (not bd or d < bd) then best, bd = it, d end
    end
  end
  if state.carrying == nil then
    if best then return "take", best end
  else
    local at_counter = best ~= nil
    for _, t in ipairs(nova.all("tile")) do
      if (p.x - t.x) ^ 2 + (p.z - t.z) ^ 2 < REACH * REACH then at_counter = true end
    end
    if at_counter then
      for _, it in ipairs(nova.all("item")) do if it.item == state.carrying then return "put_back", it end end
    end
  end
  return nil
end

-- Where the prompt floats: over the parcel X would take, or over the tile it would go back on (the first free one).
function Office:prompt_at(what, it)
  if what == "take" then return it.x, it.y, it.z end
  if what == "put_back" then
    local tiles = state.settle()
    for i = 1, state.TILES do
      if not tiles[i] then
        local t = nova.named("tile_" .. i)
        if t then return t.x, t.y, t.z end
      end
    end
  end
end

function Office:leave() nova.pause(false) end

-- Start and Select stop the room too (as in the valley, scenes/valley.lua): the postmaster, the shelf and the dust stand still, the
-- music goes on ducked, and closing the card carries on from the same moment.
function Office:update(dt)
  local kind = cards.kind()
  local paused = kind == "pause" or kind == "map"
  if paused ~= self.paused then
    self.paused = paused
    nova.pause(paused)
    nova.log(paused and "paused" or "resumed")
  end
  if paused then
    cards.update(dt)
    music.update(dt, { quiet = true })
    self.hint = nil
    return
  end
  self.t = self.t + dt
  music.update(dt, { quiet = cards.active() and not state.ended })
  self.fade_in = math.max(0, self.fade_in - dt / FADE)
  local p = self.p
  if cards.active() then
    p.control = false
    cards.update(dt)
    if not cards.active() then p.control = true end
  elseif self.leaving then
    self.leaving = self.leaving + dt
    if self.leaving > FADE then
      state.came_out = true
      nova.goto_scene("valley")
    end
  else
    p.control = true
    if self.ending_at then
      self.ending_at = self.ending_at - dt
      if self.ending_at <= 0 then
        self.ending_at = nil
        state.ended = true
        nova.log("the end card")
        cards.open("ending")
        music.start("ending")
      end
    end
    local what, it = self:action()
    if nova.input.pressed("interact") and what then
      if what == "read" then
        state.letter_read = true
        p:face_to(LETTER_AT[1], LETTER_AT[2])
        cards.open("letter")
      elseif what == "take" then
        state.carrying, state.on_shelf[it.item] = it.item, false -- (its tile is empty at once: state.settle)
        state.steps = state.steps + 1
        p:face_to(it.x, it.z)
        nova.log("took " .. it.item)
        nova.sound.play("parcel_up", { volume = 0.55, vary = 0.05 })
        parcels.show(it.item)
        cards.open("label", { which = it.item })
      elseif what == "put_back" then
        nova.log("put back " .. state.carrying)
        state.on_shelf[state.carrying] = true
        state.carrying = nil
        state.settle() -- (it takes the first free tile)
        nova.sound.play("parcel_down", { volume = 0.5, vary = 0.05 })
      end
    elseif nova.input.pressed("map") then
      cards.open("map")
    elseif nova.input.pressed("pause") then
      cards.open("pause")
    end
    parcels.update() -- (L1 and R1 go round the corner card's parcels)
    -- out of the door: the doorway's spot
    local d = nova.named("office_exit")
    if d and p.z > d.z - 0.45 and math.abs(p.x - d.x) < 0.6 then
      self.leaving = 0
      p.control = false
      nova.sound.play("door", { volume = 0.55, vary = 0.05 })
      nova.log("office: out of the door")
    end
  end
  camera.room(dt)
  self.hint = self:hints()
end

function Office:hints()
  self.target = nil
  if cards.active() or self.leaving then return nil end
  local what, it = self:action()
  local list = {}
  self.target = nil
  local tx, ty, tz = self:prompt_at(what, it)
  if tx then self.target = { tx, ty, tz } end
  if what == "read" then list[#list + 1] = { "X", words.hint.read }
  elseif what == "take" then list[#list + 1] = { "X", words.hint.take }
  elseif what == "put_back" then list[#list + 1] = { "X", words.hint.put_back } end
  list[#list + 1] = { "SELECT", words.hint.map }
  return list
end

-- the sunlight through the window: a few warm motes turning slowly in the beam
local MOTE = { color = { 255, 244, 214, 150 } }
local UP = { 0, 1, 0 }
local FACE = { 0, 0, 1 }
local NUMERAL = { face = FACE, w = 0.36, h = 0.5 }
local CAPTION = { face = FACE, w = 0.9, h = 0.2 }
local SCREEN = { face = { 0, 0.05, 1 }, w = 0.44, h = 0.34, color = { 255, 255, 255, 240 } }
local READY = { color = { 255, 240, 190, 70 } }

-- The picture frame's number: how many parcels are still to deliver (in the room, in the arms, in the van), as pictures of numerals lying
-- on the frame's plate, a caption under them. Two figures when there are ten or more.
function Office:draw_tally()
  local text = tostring(state.remaining())
  self.tally = text -- (what the frame shows: the tests read it)
  local step, n = 0.3, #text
  for i = 1, n do
    local d = text:sub(i, i)
    nova.billboard("tally_" .. d, FRAME.x + (i - (n + 1) / 2) * step, FRAME.y + 0.08, FRAME.z, 0.36, NUMERAL)
  end
  nova.billboard("tally_caption", FRAME.x, FRAME.y - 0.31, FRAME.z, 0.9, CAPTION)
end

-- The belt through the hatch: slats creeping in from the backroom, round the end roller (they shrink out of sight there).
local SLAT = { sx = 1 }
function Office:draw_belt()
  local len = BELT.z1 - BELT.z0
  local n = math.floor(len / BELT.pitch)
  for i = 0, n - 1 do
    local z = BELT.z0 + (i * BELT.pitch + self.t * BELT.speed) % len
    local over = math.max(0, z - (BELT.z1 - 0.06)) / 0.06
    nova.model("belt_slat", BELT.x, BELT.y - 0.05 * over, z, { scale = 1 - 0.5 * over })
  end
end

function Office:draw()
  camera.apply(self.paused and 0 or 1 / 60)
  nova.point_light(-2.6, 1.8, 0, { radius = 6, color = { 255, 214, 160 } })
  nova.point_light(0.9, 1.8, 2.0, { radius = 4, color = { 255, 226, 180 } })
  -- the backroom's lamp (the standing lamp by the hatch, tools/models.mjs): a warm light behind the wall, over the belt and the rack
  nova.point_light(BELT.x + 0.7, 1.2, -2.6 - 1.5, { radius = 2.6, color = { 255, 196, 120 } })
  -- the old computer's faint green glow, and the words on its screen
  nova.point_light(COMPUTER.x, COMPUTER.y + 0.45, COMPUTER.z + 0.5, { radius = 1.4, color = { 70, 150, 90 } })
  nova.billboard("crt_screen", COMPUTER.x, COMPUTER.y + 0.35, COMPUTER.z + 0.19, 0.44, SCREEN)
  self:draw_tally()
  self:draw_belt()
  if self.target then nova.quad3(self.target[1], self.target[2] + 0.004, self.target[3], 0, 1, 0, 0.5, READY) end
  for i = 1, 26 do
    local ph = (i * 0.618) % 1
    local t = self.t * 0.05 + ph
    local x = -3.2 + ((i * 0.37) % 1) * 3.4 + math.sin(t * 6.28 + i) * 0.15
    local y = 0.6 + ((t + i * 0.13) % 1) * 1.9
    local z = -0.7 + ((i * 0.71) % 1) * 1.4
    MOTE.color[4] = math.floor(90 + 80 * math.sin(t * 9 + i))
    nova.billboard("mote", x, y, z, 0.035, MOTE)
  end
end

function Office:draw_ui()
  local w, h = nova.view("exact")
  if not cards.active() then
    parcels.draw()
    ui.hints(self.hint, w, h)
    -- the prompt at the tile: the interact button floating over it
    local t = self.target
    if t and not self.leaving then
      local sx, sy = camera.project(t[1], t[2] + 0.5 + 0.03 * math.sin(self.t * 4), t[3], w, h)
      if sx then ui.glyph(sx, sy, "X", ui.s(26)) end
    end
  end
  cards.draw(w, h)
  ui.fade(math.max(self.fade_in, self.leaving and self.leaving / FADE or 0), w, h)
end

return Office
