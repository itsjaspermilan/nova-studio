-- The valley (scenes/valley.scene.json, composed by tools/scene.mjs): Post Road with the post office and the BRIDGE OUT barrier,
-- Fern Lane up to No. 3, Kettle Creek Road over the creek to No. 7. On foot: A talks, hands over, takes a parcel out of the van's
-- back; B gets in beside the van. In the van: R2 goes, L2 brakes then reverses, the stick steers, B gets out when stopped, X is
-- the horn. Y is the paper map; Start pauses. Nothing on the screen points anywhere: the signposts and the mailboxes' numbers do.
local state = require("lib.state")
local world = require("lib.world")
local camera = require("lib.camera")
local cards = require("lib.cards")
local dialogue = require("lib.dialogue")
local ambience = require("lib.ambience")
local ui = require("lib.ui")
local words = require("lib.words")

local Valley = nova.scene {}

-- Where the postmaster stands to get in (by the driver's door, on the van's left: its +x side) and at the back doors.
local DOOR = { 1.35, 0, 0.55 }
local BACK = { 0, 0, -2.75 }

function Valley:enter()
  -- (lib/world.lua was filled by the scene's own objects as they were made, before this runs: the roads' lines, the water, the bridge)
  require("lib.terrain_line")()
  local bridge = nova.named("bridge")
  if bridge then bridge:settle() end
  -- late morning, clear: the sun high in the south-east, soft shadows, haze in the distance, a gentle wind in the larches
  nova.light { dir = { 0.42, -0.82, 0.38 }, color = { 255, 243, 222 }, ambient = { 120, 128, 142 } }
  nova.shadows { radius = 40, strength = 0.72, near = 6, softness = 1.4 }
  nova.sky { top = { 92, 150, 214 }, horizon = { 206, 226, 236 } }
  nova.fog { color = { 196, 216, 228 }, near = 90, far = 1100 }
  nova.wind { direction = 60, strength = 1.1 }
  nova.look { ao = 0.4, ao_radius = 0.8, saturation = 1.08, vignette = 0.16, bloom = 0.2, bloom_threshold = 0.82 }
  nova.scenery.range = 380
  self.p = nova.named("postmaster")
  self.van = nova.named("van")
  self.p.indoors = false
  self.t = 0
  self.fade_in = 1
  self.mode = "foot"
  self.seq = nil
  self.leaving = nil
  -- the van where it was left
  if state.van then self.van:teleport(state.van.x, state.van.z, state.van.heading) end
  -- out of the office's door onto the porch
  local door = nova.named("office_door")
  if state.came_out then
    local fx, fz = math.sin(door.ry or 0), math.cos(door.ry or 0)
    self.p.x, self.p.z, self.p.face = door.x + fx * 0.25, door.z + fz * 0.25, door.ry or 0
    self.p.walk_to = { door.x + fx * 3.6, door.z + fz * 3.6 }
  end
  camera.reset(self.p.face)
  ambience.start(nova.named("mast"))
  nova.music.play("fernhollow", { volume = 0.3, fade = 1.0 })
  nova.sound.play("door", { volume = state.came_out and 0.5 or 0, vary = 0.05 })
  self.chimneys = {}
  for _, name in ipairs({ "post_office", "cabin_hazel", "cabin_pip" }) do
    local b = nova.named(name)
    if b then
      local off = name == "post_office" and { -2.6, 6.5, -1.4 } or name == "cabin_hazel" and { -4.1, 5.8, -0.8 } or { -2.4, 4.9, -1.0 }
      -- (a model's own +x is its left: the chimney's x, turned with the house)
      local ry = b.ry or 0
      local x = b.x + math.cos(ry) * -off[1] + math.sin(ry) * off[3]
      local z = b.z - math.sin(ry) * -off[1] + math.cos(ry) * off[3]
      self.chimneys[#self.chimneys + 1] = { x = x, y = off[2], z = z, seed = #self.chimneys * 1.7 }
    end
  end
  nova.log("valley: entered")
end

function Valley:leave()
  ambience.stop()
  state.van = { x = self.van.x, z = self.van.z, heading = self.van.heading }
  self.van.engine:stop()
  world.clear()
end

-- A point beside the van in the world, from the van's own metres.
function Valley:van_point(p)
  local v = self.van
  local s, c = math.sin(v.heading), math.cos(v.heading)
  return v.x + s * p[3] + c * p[1], v.z + c * p[3] - s * p[1]
end

local function dist(a, x, z) return math.sqrt((a.x - x) ^ 2 + (a.z - z) ^ 2) end

-- The resident within reach, if any.
function Valley:resident_near()
  for _, r in ipairs(nova.all("resident")) do
    if dist(self.p, r.x, r.z) < 2.6 then return r end
  end
  return nil
end

-- What A and B would do now, on foot.
function Valley:actions()
  local p, v = self.p, self.van
  if not p.control or self.seq then return nil, nil end
  local a, b
  local r = self:resident_near()
  if r then
    if state.delivered[r.who] then a = "talk"
    elseif state.carrying == r.who then a = "give"
    else a = "knock" end
  end
  local bx, bz = self:van_point(BACK)
  if not a and state.in_van and not state.carrying and dist(p, bx, bz) < 1.6 then a = "unload" end
  local dx, dz = self:van_point(DOOR)
  if (dist(p, dx, dz) < 2.4 or dist(p, v.x, v.z) < 2.8) and v:stopped() then b = "get_in" end
  return a, b, r
end

function Valley:say(r, lines, on_done)
  r:begin_talk()
  r.talking = true
  self.p.control = false
  self.p:face_to(r.x, r.z)
  dialogue.start(r.who, words.people[r.who].name, lines, {
    on_done = function()
      r:end_talk()
      self.p.control = true
      if on_done then on_done() end
    end,
  })
end

function Valley:act(a, r)
  local p = self.p
  if a == "give" then
    nova.log("handed " .. r.who .. " the parcel")
    state.carrying = nil
    r.holding = true
    nova.sound.play("parcel_down", { volume = 0.5 })
    self:say(r, words.people[r.who].given, function()
      state.delivered[r.who] = true
      state.steps = state.steps + 1
      nova.log("delivered " .. r.who)
    end)
  elseif a == "talk" then
    local n = state.after[r.who] % #words.people[r.who].after + 1
    state.after[r.who] = n
    self:say(r, { words.people[r.who].after[n] })
  elseif a == "knock" then
    nova.sound.play("knock", { volume = 0.6, at = { r.x, world.height(r.x, r.z) + 1, r.z }, range = 30 })
    self:say(r, { words.people[r.who].without })
  elseif a == "unload" then
    -- out of the back: the doors open, the parcel comes into the arms, the doors shut
    self.seq = { kind = "unload", t = 0 }
    p.control = false
    self.van.back_want = 1
    nova.sound.play("van_back", { volume = 0.5, vary = 0.05 })
    local bx, bz = self:van_point(BACK)
    p:face_to(self.van.x, self.van.z)
  end
end

-- Getting in: with a parcel, round to the back first (the doors open, it goes in, they shut), then to the driver's door; the door
-- opens and shuts, the van rocks as the postmaster climbs in, and the view glides from behind them to behind the van.
function Valley:start_boarding()
  local p = self.p
  p.control = false
  if state.carrying then
    local bx, bz = self:van_point(BACK)
    self.seq = { kind = "load", t = 0, stage = "to_back" }
    p.walk_to = { bx, bz }
  else
    local dx, dz = self:van_point(DOOR)
    self.seq = { kind = "board", t = 0, stage = "to_door" }
    p.walk_to = { dx, dz }
  end
  nova.log("getting in")
end

function Valley:get_out()
  local v, p = self.van, self.p
  v.driven = false
  v.ctl.go, v.ctl.brake, v.ctl.steer = 0, 0, 0
  v.engine_on = false
  nova.sound.play("van_door", { volume = 0.55, vary = 0.05 })
  nova.sound.play("engine_off", { volume = 0.4 })
  local dx, dz = self:van_point(DOOR)
  -- (if the door is against something, out on the other side)
  if world.blocked(dx, dz, 0.35) or nova.scenery.push(dx, dz, 0.35) then dx, dz = self:van_point({ -DOOR[1], 0, DOOR[3] }) end
  p.x, p.z = self:van_point({ DOOR[1] * 0.55, 0, DOOR[3] })
  if world.blocked(p.x, p.z, 0.3) then p.x, p.z = dx, dz end
  p.face = v.heading + math.pi / 2
  p.hidden = false
  p.walk_to = { dx, dz }
  p.control = false
  v:rock(-0.25, 0.15)
  self.mode = "foot"
  self.seq = { kind = "alight", t = 0 }
  camera.glide(0.8)
  nova.log("got out")
end

function Valley:update(dt)
  self.t = self.t + dt
  self.fade_in = math.max(0, self.fade_in - dt * 1.5)
  local p, v = self.p, self.van
  if self.leaving then
    self.leaving = self.leaving + dt
    if self.leaving > 0.55 then nova.goto_scene("office") end
    camera.foot(p, dt)
    return
  end
  -- what is open over the game first: a card, then a conversation
  if cards.active() then
    cards.update(dt)
    if self.mode == "van" then v.ctl.go, v.ctl.brake, v.ctl.steer = 0, 0.4, 0 end
    p.control = false
    if not cards.active() and not self.seq and self.mode == "foot" and not dialogue.active() then p.control = true end
  elseif dialogue.active() then
    dialogue.update(dt)
  elseif self.seq then
    self:sequence(dt)
  elseif self.mode == "van" then
    if v.autopilot and not v.autopilot.done then v.autopilot:steer(v, dt)
    else v.ctl.go, v.ctl.brake, v.ctl.steer = nova.input.axis("go"), nova.input.axis("brake"), nova.input.axis("steer") end
    if nova.input.pressed("horn") then nova.sound.play("horn", { volume = 0.7 }) end
    if nova.input.pressed("van") and v:stopped() then self:get_out()
    elseif nova.input.pressed("map") then cards.open("map")
    elseif nova.input.pressed("pause") then cards.open("pause") end
  else
    p.control = true
    local a, b, r = self:actions()
    if nova.input.pressed("act") and a then self:act(a, r)
    elseif nova.input.pressed("van") and b == "get_in" then self:start_boarding()
    elseif nova.input.pressed("map") then cards.open("map")
    elseif nova.input.pressed("pause") then cards.open("pause") end
    -- into the post office: up the porch steps and through its door
    local door = nova.named("office_door")
    -- (only once they have been out in the yard: coming out of the door they stand in it)
    if door and dist(p, door.x, door.z) > 2.2 then self.door_armed = true end
    if door and self.door_armed and dist(p, door.x, door.z) < 0.9 and not self.seq then
      self.leaving = 0
      p.control = false
      nova.sound.play("door", { volume = 0.5, vary = 0.05 })
      nova.log("valley: into the office")
    end
  end
  if self.mode == "van" then camera.van(v, dt) else camera.foot(p, dt) end
  local e = camera.state.eye
  ambience.update(dt, e[1], e[3], self.mode == "van")
  nova.music.volume(self.mode == "van" and 0.72 or 1)
  self.hint = self:hints()
end

-- The steps of getting in and out, loading and unloading, played over a second or two.
function Valley:sequence(dt)
  local s, p, v = self.seq, self.p, self.van
  s.t = s.t + dt
  if s.kind == "load" then
    if s.stage == "to_back" then
      p:face_to(v.x, v.z, dt)
      if not p.walk_to or s.t > 3 then s.stage, s.t = "open", 0; v.back_want = 1; nova.sound.play("van_back", { volume = 0.5, vary = 0.05 }); p.walk_to = nil end
    elseif s.stage == "open" then
      p:face_to(v.x, v.z, dt)
      if s.t > 0.45 then
        state.in_van, state.carrying = state.carrying, nil
        nova.sound.play("parcel_down", { volume = 0.5, vary = 0.05 })
        nova.log("loaded " .. state.in_van)
        v:rock(0, -0.12)
        s.stage, s.t = "shut", 0
      end
    elseif s.stage == "shut" then
      if s.t > 0.3 then
        v.back_want = 0
        nova.sound.play("van_back_shut", { volume = 0.55, vary = 0.05 })
        local dx, dz = self:van_point(DOOR)
        p.walk_to = { dx, dz }
        self.seq = { kind = "board", t = 0, stage = "to_door" }
      end
    end
  elseif s.kind == "board" then
    if s.stage == "to_door" then
      if not p.walk_to or s.t > 3 then
        s.stage, s.t = "door", 0
        p.walk_to = nil
        nova.sound.play("van_door", { volume = 0.55, vary = 0.05 })
      end
    elseif s.stage == "door" then
      -- a step up into the cab: the postmaster goes in, the van dips on its left springs
      p:face_to(v.x, v.z, dt)
      if s.t > 0.25 and not p.hidden then
        p.hidden = true
        v:rock(0.35, -0.2)
        camera.glide(0.9)
        self.mode = "van"
        v.driven = true
        v.engine_on = true
        nova.sound.play("engine_start", { volume = 0.5 })
        nova.log("in the van")
      end
      if s.t > 0.45 then self.seq = nil end
    end
  elseif s.kind == "alight" then
    if not p.walk_to or s.t > 1 then
      p.walk_to = nil
      self.seq = nil
      p.control = true
    end
  elseif s.kind == "unload" then
    if s.t > 0.45 and state.in_van then
      state.carrying, state.in_van = state.in_van, nil
      nova.sound.play("parcel_up", { volume = 0.5, vary = 0.05 })
      nova.log("unloaded " .. state.carrying)
      v:rock(0, 0.08)
    end
    if s.t > 0.75 then
      v.back_want = 0
      nova.sound.play("van_back_shut", { volume = 0.55, vary = 0.05 })
      cards.open("label", { which = state.carrying })
      self.seq = nil
    end
  end
end

function Valley:hints()
  if cards.active() or dialogue.active() or self.seq or self.leaving then return nil end
  local list = {}
  if self.mode == "van" then
    if self.van:stopped() then list[#list + 1] = { "B", words.hint.get_out } end
    list[#list + 1] = { "Y", words.hint.map }
    return list
  end
  local a, b = self:actions()
  if a then list[#list + 1] = { "A", a == "give" and words.hint.give or a == "unload" and words.hint.take or a == "knock" and words.hint.knock or words.hint.talk } end
  if b then list[#list + 1] = { "B", words.hint.get_in } end
  list[#list + 1] = { "Y", words.hint.map }
  return list
end

local PUFF = { color = { 240, 240, 238, 150 } }
local BOARD = { w = 2.1, h = 0.43 }
local OUT = { w = 2.0, h = 0.73 }
function Valley:draw()
  camera.apply(1 / 60)
  -- chimney smoke: soft puffs rising and drifting with the wind, thinning as they go
  for _, c in ipairs(self.chimneys) do
    for i = 0, 7 do
      local ph = ((self.t * 0.11) + i / 8 + c.seed) % 1
      local x, z = c.x - ph * 5.5 + math.sin(ph * 7 + c.seed) * 0.4, c.z + ph * 2.5
      PUFF.color[4] = math.floor(150 * (1 - ph) * math.min(1, ph * 6))
      nova.billboard("puff", x, c.y + ph * 7, z, 0.9 + ph * 2.6, PUFF)
    end
  end
  -- the post office's faded sign and the BRIDGE OUT board, painted on their boards
  local po = nova.named("post_office")
  if po then
    local ry = po.ry or 0
    local fx, fz = math.sin(ry), math.cos(ry)
    BOARD.face = { fx, 0, fz }
    nova.billboard("po_sign", po.x + fx * 3.42, 3.8, po.z + fz * 3.42, 2.1, BOARD)
  end
  local bar = nova.named("barrier")
  if bar then
    local ry = bar.ry or 0
    local fx, fz = math.sin(ry), math.cos(ry)
    -- (the board faces back down the road, the way the barrier's model faces)
    OUT.face = { -fx, 0, -fz }
    nova.billboard("bridge_out", bar.x - fx * 0.52, 1.86, bar.z - fz * 0.52, 2.0, OUT)
  end
  -- the mast's guy wires, from its top down to three pegs
  local m = nova.named("mast")
  if m then
    local h0 = nova.terrain_height(m.x, m.z)
    for k = 0, 2 do
      local a = k * 2.094 + 0.3
      local px, pz = m.x + math.sin(a) * 6.5, m.z + math.cos(a) * 6.5
      nova.line3(m.x, h0 + 12, m.z, px, nova.terrain_height(px, pz) + 0.1, pz, { color = { 70, 70, 74 }, width = 1 })
    end
  end
end

function Valley:draw_ui()
  local w, h = nova.view("exact")
  local p, v = self.p, self.van
  if not cards.active() then
    if state.carrying then ui.parcel_card(state.carrying, "hands", w)
    elseif state.in_van then ui.parcel_card(state.in_van, "van", w) end
    local x, z, hd = p.x, p.z, p.face
    if self.mode == "van" then x, z, hd = v.x, v.z, v.heading end
    ui.minimap(x, z, hd, w, h)
    if not dialogue.active() then ui.hints(self.hint, w, h) end
  end
  dialogue.draw(w, h)
  cards.draw(w, h)
  ui.fade(math.max(self.fade_in, self.leaving and self.leaving / 0.55 or 0), w, h)
end

return Valley
