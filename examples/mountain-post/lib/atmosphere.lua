-- The valley's floating life (the owner, seventh play: "nothing floating around the area, like leaves or wind strokes"): leaves
-- drifting down from the trees near you, soft wind curls in the open (more on the hills), pollen glinting in the sun, butterflies over the flowers
-- and bushes, and a few small birds that fly over or come down by a tree to peck about (they fly off when you come near). The engine
-- keeps and draws all of it round the camera (nova.ambient, docs/project-format.md "Floating life"); this only says where the trees,
-- flowers and good spots for birds are, from the scene file.
local atmosphere = {}

-- how high a tree's crown is (metres), by kind, for where its leaves start falling
local CROWN = { pine = 5.5, pine2 = 5, pine3 = 4.5, larch = 7, larch_small = 3.6, birch = 5 }
local BIRDS_BY = { birch = true, larch = true, larch_small = true }

function atmosphere.start(bird_every) -- (a picture or a test can call birds sooner: every so many seconds)
  local trees, flowers, perches = {}, {}, {}
  for _, o in ipairs(nova.scene_data("valley").objects) do
    local crown = CROWN[o.kind]
    local s = (o.props and o.props.sx) or o.sx or 1
    if crown then
      trees[#trees + 1] = { o.x, o.z, crown * s }
      -- a bird comes down on the grass a couple of metres out from a broadleaf or a larch
      if BIRDS_BY[o.kind] and #trees % 3 == 0 then
        local a = (#trees * 2.39) % (2 * math.pi)
        perches[#perches + 1] = { o.x + math.sin(a) * 2.6, o.z + math.cos(a) * 2.6 }
      end
    elseif o.kind == "flowers" or o.kind == "bush" or o.kind == "bush2" then
      flowers[#flowers + 1] = { o.x, o.z }
    elseif o.kind == "post_office" or o.kind == "cabin_hazel" or o.kind == "cabin_pip" or o.kind == "fence" or o.kind == "bench"
        or o.kind == "mailbox" or o.kind == "picnic_table" then
      -- gardens and verges: the flowers round a house, along a fence, by a bench or a mailbox
      for k = 0, 2 do
        local a = k * 2.1 + o.x * 0.1
        flowers[#flowers + 1] = { o.x + math.sin(a) * 5, o.z + math.cos(a) * 5 }
      end
    elseif o.kind == "picnic_table" or o.kind == "bench" then
      perches[#perches + 1] = { o.x + 1.5, o.z + 1.2 }
    end
  end
  nova.ambient {
    radius = 30,
    leaves = { count = 22, trees = trees, colors = { { 196, 204, 92 }, { 226, 190, 74 }, { 150, 186, 84 }, { 214, 150, 64 } } },
    streaks = { count = 5, every = 0.9, hills = 22 }, -- (soft, see-through curls, several at a time in the open; more on the hills)
    motes = { count = 36 },
    butterflies = { count = 5, flowers = flowers, colors = { { 255, 236, 170 }, { 255, 255, 236 }, { 170, 205, 255 }, { 255, 196, 150 } } },
    birds = { count = 5, every = bird_every or 28, perches = perches },
  }
end

function atmosphere.stop() nova.ambient() end

return atmosphere
