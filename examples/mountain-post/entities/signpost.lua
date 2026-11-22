-- A wooden signpost at a junction: the post is scenery (it blocks, it is drawn with the rest); each arm points along its road
-- and carries the road's name in white letters on both faces (sprites/fx/sign_*.png, made by tools/art.mjs with image_make),
-- big enough to read from the van as it comes up to the junction.
local Signpost = nova.entity { tags = { "signpost" } }

local ARM_Y = { 2.55, 2.08 }

local function sprite_of(text) return "sign_" .. text:lower():gsub("[^a-z]+", "_"):gsub("_$", "") end

function Signpost:create()
  nova.scenery.add("signpost", self.x, 0, self.z, { ry = 0 })
  self.drawn = {}
  for i, arm in ipairs(self.arms or {}) do
    local ry = arm.ry or 0
    -- (the arm's model points along its own +x; turned by ry, +x goes to (cos ry, -sin ry) in x, z)
    local ax, az = math.cos(ry), -math.sin(ry)
    local nx, nz = math.sin(ry), math.cos(ry) -- its face
    self.drawn[i] = {
      opts = { ry = ry, shadow = true },
      y = ARM_Y[i] or (2.55 - 0.47 * (i - 1)),
      sprite = sprite_of(arm.text or ""),
      text = arm.text,
      -- the words sit on the middle of the board, 0.95 m out from the post, a hair off each face
      cx = self.x + ax * 1.0, cz = self.z + az * 1.0,
      fronts = { { nx * 0.06, nz * 0.06, { nx, 0, nz } }, { -nx * 0.06, -nz * 0.06, { -nx, 0, -nz } } },
    }
  end
end

local BOARD = { w = 1.52, h = 0.26 }
function Signpost:draw()
  for _, d in ipairs(self.drawn) do
    nova.model("sign_arm", self.x, d.y, self.z, d.opts)
    for _, f in ipairs(d.fronts) do
      BOARD.face = f[3]
      nova.billboard(d.sprite, d.cx + f[1], d.y, d.cz + f[2], BOARD.w, BOARD)
    end
  end
end

return Signpost
