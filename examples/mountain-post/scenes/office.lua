-- The post office's room (scenes/office.scene.json): dusty, half the pigeonholes empty, the Mayor's letter on the counter and the
-- day's two parcels on the shelf by the window. A reads the letter, takes a parcel (one at a time; its label is held up to read)
-- or puts it back; the doorway leads out to the porch (a short fade, and they stand outside, free at once). Coming back in with both
-- delivered, the slice ends on its quiet card. The room is seen from one fixed view high over its cut-away front wall, like a
-- diorama ("when in a building, we should just have a simple top down view like Animal Crossing"); the stick moves the postmaster
-- as the screen shows the room.
local state = require("lib.state")
local world = require("lib.world")
local camera = require("lib.camera")
local cards = require("lib.cards")
local ui = require("lib.ui")
local words = require("lib.words")

local Office = nova.scene {}

local LETTER_AT = { 1.0, -0.45 }
local FADE = 0.3

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
  nova.music.play("fernhollow", { volume = 0.3, fade = 1.0 })
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
  local best, bd
  for _, it in ipairs(nova.all("item")) do
    if it.item ~= "letter" then
      local d = (p.x - it.x) ^ 2 + (p.z - it.z) ^ 2
      if d < 1.7 * 1.7 and (not bd or d < bd) then best, bd = it, d end
    end
  end
  if best then
    if state.carrying == nil and state.on_shelf[best.item] then return "take", best end
    if state.carrying ~= nil then
      -- put back what is carried (on its own place on the shelf)
      for _, it in ipairs(nova.all("item")) do if it.item == state.carrying then return "put_back", it end end
    end
  end
  return nil
end

function Office:update(dt)
  self.t = self.t + dt
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
        nova.music.play("fernhollow", { volume = 0.42, fade = 2 })
      end
    end
    local what, it = self:action()
    if nova.input.pressed("act") and what then
      if what == "read" then
        state.letter_read = true
        p:face_to(LETTER_AT[1], LETTER_AT[2])
        cards.open("letter")
      elseif what == "take" then
        state.carrying, state.on_shelf[it.item] = it.item, false
        state.steps = state.steps + 1
        p:face_to(it.x, it.z)
        nova.log("took " .. it.item)
        nova.sound.play("parcel_up", { volume = 0.55, vary = 0.05 })
        cards.open("label", { which = it.item })
      elseif what == "put_back" then
        nova.log("put back " .. state.carrying)
        state.on_shelf[state.carrying] = true
        state.carrying = nil
        nova.sound.play("parcel_down", { volume = 0.5, vary = 0.05 })
      end
    elseif nova.input.pressed("map") then
      cards.open("map")
    elseif nova.input.pressed("pause") then
      cards.open("pause")
    end
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
  if cards.active() or self.leaving then return nil end
  local what = self:action()
  local list = {}
  if what == "read" then list[#list + 1] = { "A", words.hint.read }
  elseif what == "take" then list[#list + 1] = { "A", words.hint.take }
  elseif what == "put_back" then list[#list + 1] = { "A", words.hint.put_back } end
  list[#list + 1] = { "Y", words.hint.map }
  return list
end

-- the sunlight through the window: a few warm motes turning slowly in the beam
local MOTE = { color = { 255, 244, 214, 150 } }
function Office:draw()
  camera.apply(1 / 60)
  nova.point_light(-2.6, 1.8, 0, { radius = 6, color = { 255, 214, 160 } })
  nova.point_light(0.9, 1.8, 2.0, { radius = 4, color = { 255, 226, 180 } })
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
  ui.parcel_cards(state.carrying, state.van_load, w)
  if not cards.active() then ui.hints(self.hint, w, h) end
  cards.draw(w, h)
  ui.fade(math.max(self.fade_in, self.leaving and self.leaving / FADE or 0), w, h)
end

return Office
