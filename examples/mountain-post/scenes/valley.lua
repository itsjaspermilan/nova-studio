-- The valley (scenes/valley.scene.json, composed by tools/scene.mjs): Post Road with the post office and the BRIDGE OUT barrier,
-- Fern Lane up to No. 3, Kettle Creek Road over the creek to No. 7. The buttons by the letters engraved on the Retroid (the owner's
-- fourth notes: "X: Interact, continue conversation. Y: Enter/Exit vehicle. A: Confirm items in menus. B: Hold to run while walking,
-- hold for handbrake while driving."). On foot: X talks and hands over; at the van's back (its doors swing open by themselves as the
-- postmaster comes near) X loads the parcel carried, or, empty-handed, a small panel shows the parcels in the van one at a time (L1
-- and R1 go through them, A takes the one shown: the panel is a menu); Y at the van's left doorway gets in; B held runs. In the van:
-- R2 goes, L2 brakes (only), the stick steers, B held is the handbrake, X and A move the PRNDL lever (A towards L, X towards P;
-- entities/van.lua, lib/gear_hud.lua), L3 is the horn, Y gets out when stopped. Select is
-- the paper map; Start pauses. Nothing takes the stick away for a walk the player has to watch (the owner, after the second pictures: "The user should
-- just be outside."): the porch door is a short fade, getting in and out is at once. Nothing on the screen points anywhere: the
-- signposts and the mailboxes' numbers do.
local state = require("lib.state")
local world = require("lib.world")
local camera = require("lib.camera")
local cards = require("lib.cards")
local dialogue = require("lib.dialogue")
local ambience = require("lib.ambience")
local ui = require("lib.ui")
local words = require("lib.words")
local parcels = require("lib.parcels")
local music = require("lib.music")
local gear_hud = require("lib.gear_hud")

local Valley = nova.scene {}

-- Places by the van, in its own metres (+x is its left, +z its front; tools/van.mjs): outside the left doorway (the driver's
-- side), and behind the back, clear of the doors as they swing out to the sides.
Valley.DOOR = { 1.12, 0, 0.5 }   -- beside the left doorway (tools/van.mjs DOORWAY), the van's own metres
Valley.BACK = { 0, 0, -2.05 }   -- behind the rear doors
local DOOR, BACK = Valley.DOOR, Valley.BACK
local BACK_OPEN, BACK_SHUT = 2.1, 2.6  -- the rear doors open as the postmaster comes this near the back, and shut again past the other
-- near enough to load or take: once the doors are open (BACK_OPEN), all but at once (with 1.35 m the doors swung open as the
-- postmaster came near, and the panel waited until they stood right at the bumper: "if there is only one item in the van, the
-- menu should still pop up")
local AT_BACK = 2.0
local AT_DOOR = 1.0                    -- near enough to the doorway to get in
local FADE = 0.3                       -- the porch door's fade, out and in (seconds)

function Valley:enter()
  -- (lib/world.lua was filled by the scene's own objects as they were made, before this runs: the roads' lines, the water, the bridge)
  require("lib.terrain_line")()
  local bridge = nova.named("bridge")
  if bridge then bridge:settle() end
  -- late morning, clear: the sun high in the south-east, soft shadows, haze in the distance, a gentle wind in the larches
  nova.light { dir = { 0.42, -0.82, 0.38 }, color = { 255, 243, 222 }, ambient = { 120, 128, 142 } }
  nova.shadows { radius = 40, strength = 0.72, near = 6, softness = 1.4, far = 110 } -- (far: the trees keep their shadows out to 110 m)
  nova.sky { top = { 92, 150, 214 }, horizon = { 206, 226, 236 } }
  nova.fog { color = { 196, 216, 228 }, near = 90, far = 1100 }
  nova.wind { direction = 60, strength = 1.1 }
  nova.look { ao = 0.4, ao_radius = 0.8, saturation = 1.08, vignette = 0.16, bloom = 0.2, bloom_threshold = 0.82 }
  nova.scenery.range = 380
  self.p = nova.named("postmaster")
  self.van = nova.named("van")
  self.p.indoors = false
  self.p.seated = false
  nova.pause(false)
  self.paused = false
  ui.van_panel_reset()
  -- nobody is ever cut away by the see-through circle (the owner, sixth play: "We don't need to have the circle cut through other
  -- characters or the truck"): the residents, the postmaster and what they carry are drawn with see_through = false, like the van
  -- (only scenery is cut: crowns, roofs, the porch); where one hides the postmaster the camera moves instead (lib/camera.lua)
  for _, r in ipairs(nova.all("resident")) do
    if r.draw_opts then r.draw_opts.see_through = false end
    if r.parcel_opts then r.parcel_opts.see_through = false end
  end
  if self.p.draw_opts then self.p.draw_opts.see_through = false end
  if self.p.parcel_opts then self.p.parcel_opts.see_through = false end
  self.t = 0
  self.fade_in = state.came_out and 1 or 0
  self.mode = "foot"
  self.leaving = nil
  self.pick_i = 1
  -- the van where it was left
  if state.van then self.van:teleport(state.van.x, state.van.z, state.van.heading) end
  -- out of the office's door: standing at the foot of the porch, facing away from the door, free to go at once; the camera
  -- straight behind them at the default (the owner: "We can have the camera start behind the player while on foot and exiting a
  -- building"); they stand at the foot of the porch, 4 m out, the porch roof and posts cut away round the low camera (lib/camera.lua)
  local door = nova.named("office_door")
  -- (by the post office's door more is cut away round the camera, which stands in the building behind them: lib/camera.lua NEAR)
  camera.NEAR = { { door.x, door.z, r = camera.PORCH.r, near = camera.PORCH.near } }
  if state.came_out then
    local fx, fz = math.sin(door.ry or 0), math.cos(door.ry or 0)
    self.p.x, self.p.z, self.p.face = door.x + fx * 4.0, door.z + fz * 4.0, door.ry or 0
    camera.reset(door.ry or 0)
  else
    camera.reset(self.p.face)
  end
  ambience.start(nova.named("mast"))
  music.start("outdoors")
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
  nova.log("valley: entered" .. (state.came_out and " from the porch" or ""))
end

-- The window lost the focus (the Steam overlay, another app): the game pauses itself, as Start would (the owner, 2026-11-23:
-- "the game should pause on focus loss"). A card already open (the pause menu, the map, a label) stays as it is.
function Valley:focus_lost()
  if not cards.active() then cards.open("pause") end
end

function Valley:leave()
  nova.pause(false)
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

-- (for tests and pictures: leads the postmaster round the van, on the side nearer to `name`, and to within reach of it)
function Valley:lead_to(name)
  local t, p = nova.named(name), self.p
  local lx, lz = self:van_point({ 2.0, 0, -2.6 })
  local rx, rz = self:van_point({ -2.0, 0, -2.6 })
  local side = dist(t, lx, lz) < dist(t, rx, rz) and { lx, lz } or { rx, rz }
  local dx, dz = t.x - side[1], t.z - side[2]
  local d = math.sqrt(dx * dx + dz * dz)
  p.walk_path = { side, { t.x - dx / d * 1.9, t.z - dz / d * 1.9 } }
  p.walk_to = nil
end

-- The resident within reach and in front of the postmaster, if any (`loose`: in front only roughly, for handing a parcel over).
local TALK_REACH, TALK_CONE = 2.4, math.rad(65)
function Valley:resident_near(loose)
  local p = self.p
  for _, r in ipairs(nova.all("resident")) do
    local d = dist(p, r.x, r.z)
    local off = math.abs((math.atan(r.x - p.x, r.z - p.z) - p.face + math.pi) % (2 * math.pi) - math.pi)
    if d < TALK_REACH + (loose and 0.3 or 0) and (d < 0.9 or off < (loose and math.rad(100) or TALK_CONE)) then return r end
  end
  return nil
end

-- The resident whose front door the postmaster is at, if they are indoors (nobody is, in the slice: they are out at their work).
function Valley:door_near()
  for _, r in ipairs(nova.all("resident")) do
    local door = nova.named("door_" .. r.who)
    if door and not r.outside and dist(self.p, door.x, door.z) < 1.5 then return r end
  end
  return nil
end

-- How far the postmaster is from the van's back and from its left doorway.
function Valley:to_back() local x, z = self:van_point(BACK); return dist(self.p, x, z) end
function Valley:to_door() local x, z = self:van_point(DOOR); return dist(self.p, x, z) end

-- What X and Y would do now, on foot (the first answer is X's, but "pick" is A's: the van's panel is a menu): X "load" (the parcel carried into the open back), "pick" (the one the panel shows out of
-- it), "give" (a resident's own parcel to them), "talk" (to a resident out of doors, close and in front) or "knock" (at a resident's
-- front door while they are indoors), A "pick"; Y "get_in" at the left doorway. A third answer is the resident it is about. The van comes
-- first: at its open back or its doorway nobody else's prompt shows (the owner, after the second play: "If I'm close to the van trying
-- to get the package, I only get an option to 'knock'").
function Valley:actions()
  local p, v = self.p, self.van
  if not p.control or self.mode ~= "foot" then return nil, nil end
  local a, b, r
  local at_back = v:stopped() and v.back_open > 0.5 and self:to_back() < AT_BACK
  local at_door = v:stopped() and self:to_door() < AT_DOOR
  if at_back then
    -- (a full van refuses the parcel softly when X is pressed: Valley:act)
    if state.carrying then a = "load"
    elseif #state.van_load > 0 then a = "pick" end
  end
  if at_door and not state.carrying then b = "get_in" end
  if not a and not at_back and not at_door then
    -- (handing a parcel over takes a looser "in front" than talking does)
    r = state.carrying and self:resident_near(true)
    if r and state.carrying == r.who and not state.delivered[r.who] then a = "give"
    else
      r = self:resident_near()
      if r then a = "talk"
      else
        r = self:door_near()
        if r then a = "knock" end
      end
    end
  end
  return a, b, r
end

function Valley:say(r, lines, faces, on_done)
  r:begin_talk()
  self.talking_to = r
  camera.glide(0.55)
  r.talking = true
  self.p.control = false
  self.p:face_to(r.x, r.z)
  dialogue.start(r.who, words.people[r.who].name, lines, {
    -- (each line comes with its face: lib/words.lua `faces`)
    on_line = function(i) r:look(faces[i] or "neutral") end,
    on_done = function()
      r:end_talk()
      self.talking_to = nil
      -- (back behind the postmaster, at the default, gliding there from the talk's view)
      camera.reset(self.p.face)
      camera.glide(0.6)
      self.p.control = true
      if on_done then on_done() end
    end,
  })
end

function Valley:act(a, r)
  local v = self.van
  if a == "give" then
    nova.log("handed " .. r.who .. " the parcel")
    state.carrying = nil
    r.holding = true
    self.p:smile(3)
    nova.sound.play("parcel_down", { volume = 0.5 })
    self:say(r, words.people[r.who].given, words.people[r.who].faces.given, function()
      state.delivered[r.who] = true
      state.steps = state.steps + 1
      nova.log("delivered " .. r.who)
    end)
  elseif a == "talk" and not state.delivered[r.who] then
    -- (out at their work, no parcel for them yet: their line for a caller with empty hands)
    self:say(r, { words.people[r.who].without }, { words.people[r.who].faces.without })
  elseif a == "talk" then
    local n = state.after[r.who] % #words.people[r.who].after + 1
    state.after[r.who] = n
    self:say(r, { words.people[r.who].after[n] }, { words.people[r.who].faces.after[n] })
  elseif a == "knock" then
    nova.sound.play("knock", { volume = 0.6, at = { r.x, world.height(r.x, r.z) + 1, r.z }, range = 30 })
    self:say(r, { words.people[r.who].without }, { words.people[r.who].faces.without })
  elseif a == "load" then
    if #state.van_load >= state.VAN_HOLDS then
      -- full: refused, softly (the panel says so for a moment; the parcel stays in the arms)
      self.full_t = 1
      nova.sound.play("tick", { volume = 0.4, pitch = 0.72 })
      nova.log("the van is full")
      return
    end
    -- into the hold, at once: the van dips a little on its springs
    local which = state.carrying
    state.van_load[#state.van_load + 1] = which
    state.carrying = nil
    nova.sound.play("parcel_down", { volume = 0.5, vary = 0.05 })
    v:rock(0, -0.12)
    nova.log("loaded " .. which)
  elseif a == "pick" then
    local i = math.max(1, math.min(#state.van_load, self.pick_i))
    local which = table.remove(state.van_load, i)
    state.carrying = which
    parcels.show(which)
    self.pick_i = 1
    nova.sound.play("parcel_up", { volume = 0.5, vary = 0.05 })
    v:rock(0, 0.08)
    nova.log("unloaded " .. which)
  end
end

-- Getting in: into the seat at once (the van rocks as the postmaster climbs in; the view glides from behind them to behind the van).
function Valley:get_in()
  local p, v = self.p, self.van
  p.seated = true
  p.control = false
  p:stop_walking()
  v:rock(0.3, -0.18)
  v.back_want = 0
  camera.reset(v.heading)
  camera.glide(0.7)
  self.mode = "van"
  v.driven = true
  v.engine_on = true
  v:park() -- (in P each time)
  nova.sound.play("step_wood", { volume = 0.4 })
  nova.sound.play("engine_start", { volume = 0.5 })
  nova.log("in the van")
end

-- Getting out: beside the left doorway at once (or beside the right side, which has no door, when the left is against something), facing the way the van faces,
-- so the camera, which was behind the van, is behind them too, out beside the van with nothing in between.
function Valley:get_out()
  local v, p = self.van, self.p
  v.driven = false
  v.ctl.go, v.ctl.brake, v.ctl.steer, v.ctl.handbrake = 0, 0, 0, 0
  v.engine_on = false
  v:park() -- (left in P: it is only got out of stopped)
  nova.sound.play("engine_off", { volume = 0.4 })
  nova.sound.play("step_wood", { volume = 0.4 })
  local x, z = self:van_point(DOOR)
  if world.blocked(x, z, 0.35) or nova.scenery.push(x, z, 0.35) then x, z = self:van_point({ -DOOR[1], 0, DOOR[3] }) end
  p.seated = false
  p.x, p.z = x, z
  p.y = world.lift(x, z)
  p.face = v.heading
  p.speed = 0
  p.control = true
  v:rock(-0.25, 0.15)
  self.mode = "foot"
  camera.reset(v.heading)
  camera.glide(0.6)
  nova.log("got out")
end

-- The rear doors swing open by themselves as the postmaster comes near the back on foot, and shut as they walk away.
function Valley:back_doors()
  local v = self.van
  local near = self.mode == "foot" and v:stopped() and self:to_back() < (v.back_want > 0 and BACK_SHUT or BACK_OPEN)
  if near and v.back_want == 0 then
    v.back_want = 1
    nova.sound.play("van_back", { volume = 0.5, vary = 0.05 })
    nova.log("back doors open")
  elseif not near and v.back_want > 0 then
    v.back_want = 0
    nova.sound.play("van_back_shut", { volume = 0.55, vary = 0.05 })
    nova.log("back doors shut")
  end
end

-- Start (the pause menu) and Select (the paper map) stop the world (the owner, sixth play: "Pressing start should actually pause the
-- game", "Pressing Select for the map should actually pause the game"): nova.pause freezes every entity (the van, the residents, the
-- postmaster and their animations) and the engine's clock (wind, clouds, water); this scene's own clocks (`t`, the camera, the ambience's
-- timers, the music's layer timers, the doors, the fades) stand too, the stick is not read, and closing the card carries on from the
-- same moment. The music goes on, ducked (`quiet`), and the van's engine goes quiet.
function Valley:update(dt)
  self.dt = dt
  local kind = cards.kind()
  local paused = kind == "pause" or kind == "map"
  if paused ~= self.paused then
    self.paused = paused
    nova.pause(paused)
    if paused then self.van.engine:silence() end
    nova.log(paused and "paused" or "resumed")
  end
  if paused then
    cards.update(dt)
    music.update(dt, { driving = self.mode == "van", speed = self.van.speed, quiet = true })
    self.hint = nil
    return
  end
  self.t = self.t + dt
  self.full_t = math.max(0, (self.full_t or 0) - dt * 0.5)
  self.fade_in = math.max(0, self.fade_in - dt / FADE)
  local p, v = self.p, self.van
  if self.leaving then
    self.leaving = self.leaving + dt
    if self.leaving > FADE then nova.goto_scene("office") end
    camera.foot(p, dt)
    return
  end
  self:back_doors()
  self:fade_picker(dt)
  -- what is open over the game first: a card, then a conversation
  if cards.active() then
    cards.update(dt)
    if self.mode == "van" then v.ctl.go, v.ctl.brake, v.ctl.steer, v.ctl.handbrake = 0, 0.4, 0, 0 end
    p.control = false
    if not cards.active() and self.mode == "foot" and not dialogue.active() then p.control = true end
  elseif dialogue.active() then
    dialogue.update(dt)
  elseif self.mode == "van" then
    -- (B held: the handbrake, rear wheels locked)
    v.ctl.handbrake = nova.input.down("handbrake") and 1 or 0
    if v.autopilot and not v.autopilot.done then v.autopilot:steer(v, dt)
    else v.ctl.go, v.ctl.brake, v.ctl.steer = nova.input.axis("go"), nova.input.axis("brake"), nova.input.axis("steer") end
    -- the lever: A one gear towards L, X one towards P (the owner flipped it back, 2026-11-23: "flip X and A while driving again")
    if nova.input.pressed("confirm") then v:shift(1) elseif nova.input.pressed("interact") then v:shift(-1) end
    -- (L3, the left stick's click: the horn; X was, before the lever)
    if nova.input.pressed("horn") then
      nova.sound.play("horn", { volume = 0.7 })
      p:smile(1.2)
      nova.log("horn")
    end
    if nova.input.pressed("van") and v:stopped() then self:get_out()
    elseif nova.input.pressed("map") then cards.open("map")
    elseif nova.input.pressed("pause") then cards.open("pause") end
    parcels.update() -- (L1 and R1 go round the corner card's parcels)
  else
    p.control = true
    local a, b, r = self:actions()
    if a == "pick" then
      -- the panel at the open back: L1 and R1 go through the parcels in the van
      local n = #state.van_load
      self.pick_i = math.max(1, math.min(n, self.pick_i))
      if n > 1 and nova.input.pressed("next") then self.pick_i = self.pick_i % n + 1; nova.sound.play("tick", { volume = 0.35 }) end
      if n > 1 and nova.input.pressed("prev") then self.pick_i = (self.pick_i - 2) % n + 1; nova.sound.play("tick", { volume = 0.35 }) end
    else
      self.pick_i = 1
      parcels.update() -- (away from the van's panel, L1 and R1 go round the corner card's parcels)
    end
    -- X does what is at hand; A takes the parcel the van's panel shows (a menu: A confirms); Y gets in
    if a == "pick" and nova.input.pressed("confirm") then self:act(a, r)
    elseif a and a ~= "pick" and nova.input.pressed("interact") then self:act(a, r)
    elseif nova.input.pressed("van") and b == "get_in" then self:get_in()
    elseif nova.input.pressed("map") then cards.open("map")
    elseif nova.input.pressed("pause") then cards.open("pause") end
    -- into the post office: up the porch steps and through its door (a short fade; inside they stand in the doorway, free at once)
    local door = nova.named("office_door")
    -- (only once they have stepped out of the doorway: coming out of it they stand a step away, already clear of it)
    if door and dist(p, door.x, door.z) > 1.0 then self.door_armed = true end
    if door and self.door_armed and dist(p, door.x, door.z) < 0.9 then
      self.leaving = 0
      p.control = false
      nova.sound.play("door", { volume = 0.5, vary = 0.05 })
      nova.log("valley: into the office")
    end
  end
  if self.mode == "van" then camera.van(v, dt)
  elseif self.talking_to and dialogue.active() then
    p:face_to(self.talking_to.x, self.talking_to.z, dt)
    camera.talk(p, self.talking_to, dt)
  else camera.foot(p, dt) end
  local e = camera.state.eye
  ambience.update(dt, e[1], e[3], self.mode == "van")
  -- the music: the piano alone on foot; layers join as the van is driven and thin out as it slows (lib/music.lua)
  music.update(dt, { driving = self.mode == "van", speed = v.speed, quiet = cards.active() or dialogue.active() })
  self.hint = self:hints()
end

function Valley:hints()
  if cards.active() or dialogue.active() or self.leaving then return nil end
  local list = {}
  if self.mode == "van" then
    if self.van:stopped() then list[#list + 1] = { "Y", words.hint.get_out } end
    list[#list + 1] = { "SELECT", words.hint.map }
    return list
  end
  -- (at the van's open back the floating panel has its own buttons)
  if self:panel_mode() then return { { "SELECT", words.hint.map } } end
  local a, b = self:actions()
  if a then list[#list + 1] = { "X", a == "give" and words.hint.give or a == "load" and words.hint.load or a == "knock" and words.hint.knock or words.hint.talk } end
  if b then list[#list + 1] = { "Y", words.hint.get_in }
  elseif state.carrying and self.van:stopped() and self:to_door() < AT_DOOR then list[#list + 1] = { nil, words.hint.load_at_back } end
  list[#list + 1] = { "SELECT", words.hint.map }
  return list
end

-- The panel at the van's back is a light overlay, not a mode: it floats above the open rear doors (ui.van_panel) and fades up over
-- PICKER_FADE seconds while the zone wants it (standing at the open back, nothing else open) and away when they walk off. Nothing waits
-- for it: no lock on the stick or the camera, no pause, the world runs on. `picker_a` is how far up it is (0 to 1); what it shows is
-- kept while it fades out, so the last one taken does not vanish at once.
local PICKER_FADE = 0.2
function Valley:fade_picker(dt)
  local mode = (not cards.active() and not dialogue.active() and not self.leaving) and self:panel_mode() or nil
  if mode then self.pk = { mode = mode, list = { table.unpack(state.van_load) }, i = self.pick_i, count = #state.van_load } end
  local want = mode ~= nil
  local a = self.picker_a or 0
  self.picker_a = want and math.min(1, a + dt / PICKER_FADE) or math.max(0, a - dt / PICKER_FADE)
end

-- What the panel at the van's open back is for now: "pick" (parcels in the van, empty hands), "load" (a parcel in the arms) or "empty"
-- (nothing either way); nil away from the open back.
function Valley:panel_mode()
  local p, v = self.p, self.van
  if not p.control or self.mode ~= "foot" then return nil end
  if not (v:stopped() and v.back_open > 0.5 and self:to_back() < AT_BACK) then return nil end
  if state.carrying then return "load" end
  return #state.van_load > 0 and "pick" or "empty"
end

-- (what the panel at the van's back shows now, for the tests: nil when it is not open)
function Valley:picker()
  if self:panel_mode() ~= "pick" then return nil end
  return state.van_load[math.max(1, math.min(#state.van_load, self.pick_i))]
end

-- The point the panel stands on: the middle of the rear doorway, 0.3 m over the roof line at the back (the van's own metres: the roof
-- is 1.6 high, the back at z = -1.42, a little behind it), on the screen. Where it is when the camera cannot place it (behind the eye).
Valley.PANEL_AT = { 0, 1.9, -1.45 }
function Valley:panel_anchor(w, h)
  local v = self.van
  local x, y, z = v:to_world(Valley.PANEL_AT[1], Valley.PANEL_AT[2], Valley.PANEL_AT[3])
  -- (the renderer lifts the van by the hill under its middle: so does this point)
  local sx, sy = camera.project(x, y + nova.terrain_height(v.x, v.z), z, w, h)
  if not sx then return w / 2, h * 0.5 end
  -- seen from the front (the camera orbited to the other side of the van) the doors' point can land over the postmaster: the panel then
  -- stands above their head instead of on it (the owner: "The popup currently blocks the player")
  local p = self.p
  local hx, hy = camera.project(p.x, nova.terrain_height(p.x, p.z) + (p.y or 0) + 1.45, p.z, w, h)
  if hx and math.abs(sx - hx) < ui.s(150) and sy > hy - ui.s(14) then sy = hy - ui.s(14) end
  return sx, sy
end

local PUFF = { color = { 226, 226, 224, 70 } }
local BOARD = { w = 2.1, h = 0.43 }
local OUT = { w = 2.0, h = 0.73 }
function Valley:draw()
  camera.apply(self.paused and 0 or 1 / 60)
  -- chimney smoke: soft puffs rising and drifting with the wind, thinning as they go
  for _, c in ipairs(self.chimneys) do
    for i = 0, 13 do
      local ph = ((self.t * 0.08) + i / 14 + c.seed) % 1
      local x, z = c.x - ph * 5.5 + math.sin(ph * 7 + c.seed) * 0.4, c.z + ph * 2.5
      PUFF.color[4] = math.floor(70 * (1 - ph) * math.min(1, ph * 5))
      nova.billboard("puff", x, c.y + ph * 8, z, 1.2 + ph * 3.8, PUFF)
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
    -- (the board faces back down the road, the way the barrier's model faces: its front; the words just off it)
    OUT.face = { fx, 0, fz }
    nova.billboard("bridge_out", bar.x - fx * 0.36, 1.86, bar.z - fz * 0.36, 2.0, OUT)
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
    -- the one parcel card (faded back, without its L1 / R1, while the van's panel has them)
    if not dialogue.active() then parcels.draw(self:picker() ~= nil) end
    local x, z, hd = p.x, p.z, p.face
    if self.mode == "van" then x, z, hd = v.x, v.z, v.heading end
    if not dialogue.active() then ui.minimap(x, z, hd, w, h, math.atan(camera.forward())) end
    -- (driving, the prompts stand just above the van's cluster in the bottom right: lib/gear_hud.lua)
    if not dialogue.active() then ui.hints(self.hint, w, self.mode == "van" and gear_hud.hints_floor(w, h) or h) end
    if self.mode == "van" and not dialogue.active() then gear_hud.draw(v, w, h) end
    if (self.picker_a or 0) > 0 and self.pk and not dialogue.active() then
      -- the van's panel, floating over the open doors
      local pk = self.pk
      local ax, ay = self:panel_anchor(w, h)
      ui.van_panel({ mode = pk.mode, list = pk.list, i = math.max(1, math.min(#pk.list, pk.i or 1)), count = pk.count, cap = state.VAN_HOLDS,
        note = math.min(1, (self.full_t or 0) * 1.4), ax = ax, ay = ay, a = self.picker_a }, w, h, self.dt)
    else
      ui.van_panel_reset()
    end
  end
  dialogue.draw(w, h)
  cards.draw(w, h)
  ui.fade(math.max(self.fade_in, self.leaving and self.leaving / FADE or 0), w, h)
end

return Valley
