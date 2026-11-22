-- A resident at home: busy at something near the house (Hazel at her sawhorses, Pip at the foot of his mast) until the postmaster
-- comes up the path; then they stop, turn and come a few steps to meet them, and face them while they talk (the "talk" clip on
-- their own lines). Given their parcel, they hold it while they talk and then set it down on the porch.
-- entities/hazel.lua and entities/pip.lua are this with their own model, voice and work.
local state = require("lib.state")
local world = require("lib.world")
local face = require("lib.face")
local dialogue = require("lib.dialogue")

local PARCELS = { hazel = "parcel_hazel", pip = "parcel_pip" }

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
    self.mood = face.new(who == "hazel" and 3 or 7)
    self.draw_opts = { ry = 0, parts = nil }
    self.work_sound_t = 0
    -- (the parcel set down on the porch afterwards: beside the door)
    local door = nova.named("door_" .. who)
    self.porch = door and { door.x + 0.6, door.z + 0.3 } or { self.x, self.z }
  end

  -- The postmaster is this close: stop working and come to meet them (a few steps, no further than the gate).
  function R:notice(p)
    local d = math.sqrt((p.x - self.x) ^ 2 + (p.z - self.z) ^ 2)
    return d
  end

  -- The face for what is being said (lib/face.lua): kept until the next line, back to neutral when the talk ends.
  function R:look(expr)
    face.set(self.mood, expr)
    nova.log("face " .. who .. " " .. expr)
  end

  function R:update(dt)
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
    elseif d < (spec.notice or 9) then
      self.mode = "meet"
      -- (to a spot 1.6 m short of the postmaster, never more than 5 m from home)
      local ax, az = p.x - self.x, p.z - self.z
      if d > 1.4 then
        tx, tz = self.x + ax / d * (d - 1.3), self.z + az / d * (d - 1.3)
        local hx, hz = tx - self.home[1], tz - self.home[2]
        local hd = math.sqrt(hx * hx + hz * hz)
        if hd > 5 then tx, tz = self.home[1] + hx / hd * 5, self.home[2] + hz / hd * 5 end
        local md = math.sqrt((tx - self.x) ^ 2 + (tz - self.z) ^ 2)
        if md > 0.25 then want_speed = math.min(spec.walk * 1.2, md * 2) end
      end
      local want = math.atan(p.x - self.x, p.z - self.z)
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
