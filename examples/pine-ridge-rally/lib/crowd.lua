-- The people watching: the spectator objects of the course's scene file (groups beside the road by the start, on the outside of the hard
-- corners and here and there along the straights, placed by the track generator and editable in the scene editor), turned to the road and
-- cheering, jumping or just standing. They are Kenney's Mini Characters (CC0), each with its own clip rate and phase, drawn only when they are
-- near the camera; the engine skins them on the GPU, so a crowd costs little.
local crowd = {}

local SIZE = 2.0          -- (a spectator's `sx` when it has none: the characters are 0.67 m tall as made, this makes them about 1.35 m)
local RANGE = 125         -- metres: further than this from the camera nobody is drawn
local FADE = 40           -- ...and over the last FADE metres they grow from nothing, so that nobody pops into being
local POSE_STEP = 1 / 15 -- seconds: people at the same moment of a clip share one pose (one set of joint matrices for all of them)
local LOD_DISTANCE = 70 -- metres: further than this a person is drawn as the plain model (rest pose, no joints), crossfading over a few metres
local people, count = {}, 0

function crowd.clear() people, count = {}, 0 end

-- One person, from a spectator object of the scene (entities/spectator.lua): `o` has their turn, size, hop, clip rate and phase.
function crowd.add(kind, x, y, z, o)
  count = count + 1
  people[count] = {
    x = x, y = y or 0, z = z,
    opts = {
      ry = o.ry or 0, scale = o.sx or SIZE, clip = "idle", time = 0, shadow = false, -- (Kenney's "jump" clip is a dive that lays the person flat: the cheering hop is made here instead, by lifting them)
      pose_step = POSE_STEP, lod = kind, lod_distance = LOD_DISTANCE,
    },
    size = o.sx or SIZE,
    hop = o.hop or 0,
    kind = kind,
    rate = o.rate or 1, phase = o.phase or 0, -- (a few rates and phases, so that people share poses)
  }
end

function crowd.count() return count end

function crowd.draw(cx, cz, t)
  local r2 = RANGE * RANGE
  for i = 1, count do
    local p = people[i]
    local dx, dz = p.x - cx, p.z - cz
    if dx * dx + dz * dz < r2 then
      p.opts.time = t * p.rate + p.phase
      local d = math.sqrt(dx * dx + dz * dz)
      local grow = math.min(1, (RANGE - d) / FADE)
      grow = grow * grow * (3 - 2 * grow) -- (smooth at both ends)
      p.opts.scale = p.size * grow
      local lift = p.hop > 0 and p.hop * math.abs(math.sin(t * 3.2 * p.rate + p.phase * 2)) or 0
      nova.model(p.kind, p.x, p.y + lift, p.z, p.opts)
    end
  end
end

return crowd
