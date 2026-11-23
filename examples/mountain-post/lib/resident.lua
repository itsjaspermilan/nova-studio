-- A resident at home: busy at something near the house (Hazel at her sawhorses, Pip at the foot of his mast) until the postmaster
-- comes up the path; then they stop, come a couple of steps towards their gate (a fixed place: they never follow the postmaster
-- about), turn to look at them and stay there, and face them while they talk (the "talk" clip on their own lines). Given their
-- parcel, they hold it while they talk and then set it down on the porch. When the postmaster has gone they go back to work.
-- entities/hazel.lua and entities/pip.lua are this with their own model, voice and work.
local state = require("lib.state")
local world = require("lib.world")
local face = require("lib.face")
local dialogue = require("lib.dialogue")

local PARCELS = { hazel = "parcel_hazel", pip = "parcel_pip" }
local MEET_STEP = 2.0 -- metres from their work towards the gate that they come to meet the postmaster

return function(who, spec)
  local R = nova.entity { model = who, tags = { "resident" }, velocity = false, who = who }

  function R:create()
    self.face = self.ry or 0
    self.home = { self.x, self.z }
    self.work_at = self.work or { self.x + 1, self.z }
    self.speed = 0
    self.mode = "work"      -- work, meet, talk
    self.talking = false    -- their own line is on the screen
    self.holding = false
    self.anim = nova.animator(who, {
      start = "work", fade = 0.25,
      states = {
        move = { blend = "speed", points = { { 0, "idle" }, { spec.walk, "walk" } } },
        work = { clip = "work", loop = true },
        talk = { clip = "talk", loop = true },
        wave = { clip = "wave", loop = false, next = "move" },
      },
    })
    self.carry_layer = { { clip = "carry", time = 0, weight = 1, mask = { "arm_l", "arm_r" } } }
    self.parcel_opts = { ry = 0 }
    self.mood = face.new(who == "hazel" and 3 or 7, spec.rest)
    self.draw_opts = { ry = 0, parts = nil }
    self.work_sound_t = 0
    -- (the parcel set down on the porch afterwards: beside the door)
    local door = nova.named("door_" .. who)
    self.porch = door and { door.x + 0.6, door.z + 0.3 } or { self.x, self.z }
    -- where they come to meet the postmaster: a couple of steps from their work towards their gate (the mailbox), and no further. They
    -- never follow anyone about (the owner, after the second play: "they keep following me"). (Found on the first update: the
    -- mailbox may be made after them.)
    self.meet = nil
    -- they are out of doors, at their work: the prompt beside them is "Talk"; "Knock" is only for a door with someone behind it
    self.outside = true
  end

  -- How far the postmaster is from them.
  function R:notice(p)
    return math.sqrt((p.x - self.x) ^ 2 + (p.z - self.z) ^ 2)
  end

  -- The face for what is being said (lib/face.lua): kept until the next line, back to neutral when the talk ends.
  function R:look(expr)
    face.set(self.mood, expr)
    nova.log("face " .. who .. " " .. expr)
  end

  function R:update(dt)
    if not self.meet then
      local box = nova.named(spec.mailbox or "")
      self.meet = { self.home[1], self.home[2] }
      if box then
        local dx, dz = box.x - self.home[1], box.z - self.home[2]
        local d = math.sqrt(dx * dx + dz * dz)
        if d > 0.1 then local k = math.min(MEET_STEP, d * 0.5) / d; self.meet = { self.home[1] + dx * k, self.home[2] + dz * k } end
      end
    end
    self.mood.talking = self.talking and dialogue.typing()
    face.update(self.mood, dt)
    local p = nova.named("postmaster")
    local d = p and not p.hidden and self:notice(p) or 99
    local tx, tz, want_speed = self.x, self.z, 0
    if self.mode == "talk" then
      if p then
        local want = math.atan(p.x - self.x, p.z - self.z)
        self.face = self.face + ((want - self.face + math.pi) % (2 * math.pi) - math.pi) * math.min(1, dt * 6)
      end
    elseif d < (spec.notice or 9) or (self.mode == "meet" and d < (spec.notice or 9) + 3) then
      -- the postmaster has come up the path: down tools, a few steps to the meeting place (fixed: never after them), and stand there
      -- turned towards them while they are within a few metres
      self.mode = "meet"
      local mx, mz = self.meet[1] - self.x, self.meet[2] - self.z
      local md = math.sqrt(mx * mx + mz * mz)
      local want
      if md > 0.15 then
        tx, tz, want_speed = self.meet[1], self.meet[2], math.min(spec.walk, md * 2)
        want = math.atan(mx, mz)
      else
        want = math.atan(p.x - self.x, p.z - self.z)
      end
      self.face = self.face + ((want - self.face + math.pi) % (2 * math.pi) - math.pi) * math.min(1, dt * 5)
    else
      -- back to work: walk home, then face the work and get on with it
      self.mode = "work"
      local hx, hz = self.home[1] - self.x, self.home[2] - self.z
      local hd = math.sqrt(hx * hx + hz * hz)
      if hd > 0.3 then
        tx, tz, want_speed = self.home[1], self.home[2], math.min(spec.walk, hd * 2)
        local want = math.atan(hx, hz)
        self.face = self.face + ((want - self.face + math.pi) % (2 * math.pi) - math.pi) * math.min(1, dt * 5)
      else
        local want = math.atan(self.work_at[1] - self.x, self.work_at[2] - self.z)
        self.face = self.face + ((want - self.face + math.pi) % (2 * math.pi) - math.pi) * math.min(1, dt * 3)
      end
    end
    self.speed = self.speed + (want_speed - self.speed) * math.min(1, dt * 6)
    if self.speed > 0.02 then
      local dx, dz = tx - self.x, tz - self.z
      local l = math.sqrt(dx * dx + dz * dz)
      if l > 1e-3 then self.x, self.z = world.move(self.x, self.z, dx / l * self.speed * dt, dz / l * self.speed * dt, 0.3) end
    end
    self.y = world.lift(self.x, self.z)
    -- which clip: walking, working (at home, nobody near), talking (on their own line), or standing
    local want_state
    if self.speed > 0.08 then want_state = "move"
    elseif self.mode == "work" then want_state = "work"
    elseif self.mode == "talk" and self.talking then want_state = "talk"
    else want_state = "move" end
    if self.anim:state() ~= want_state and self.anim:state() ~= "wave" then self.anim:play(want_state) end
    self.anim:set("speed", self.speed)
    self.anim:update(dt)
    -- the sound of the work, by where it is (the saw, the radio's crackle is the mast's own: lib/ambience.lua)
    if spec.work_sound and self.mode == "work" and self.speed < 0.05 then
      self.work_sound_t = self.work_sound_t - dt
      if self.work_sound_t <= 0 then
        self.work_sound_t = spec.work_every or 0.8
        nova.sound.play(spec.work_sound, { at = { self.x, world.height(self.x, self.z) + 1, self.z }, range = spec.work_range or 45, volume = spec.work_volume or 0.5, vary = 0.08 })
      end
    end
  end

  -- What they say when they get their parcel, and afterwards: the scene runs the conversation; these keep the body in step.
  function R:begin_talk() self.mode = "talk"; self.speed = 0 end
  function R:end_talk()
    self.mode = "meet"
    self.talking = false
    face.set(self.mood, "neutral")
    if self.holding then self.holding = false; self.set_down = true end
  end
  function R:wave() self.anim:play("wave", { restart = true }) end

  function R:draw()
    local extra = self.holding and self.carry_layer or nil
    local o = self.draw_opts
    o.ry, o.extra, o.parts = self.face, extra, face.parts(self.mood)
    self.anim:draw(self.x, self.y, self.z, o)
    if self.holding then
      local s, c = math.sin(self.face), math.cos(self.face)
      self.parcel_opts.ry = self.face + math.pi / 2
      nova.model(PARCELS[who], self.x + s * 0.36, self.y + spec.chest, self.z + c * 0.36, self.parcel_opts)
    elseif state.delivered[who] then
      self.parcel_opts.ry = 0.4
      nova.model(PARCELS[who], self.porch[1], world.lift(self.porch[1], self.porch[2]) + (spec.porch_y or 0.35), self.porch[2], self.parcel_opts)
    end
  end

  return R
end
