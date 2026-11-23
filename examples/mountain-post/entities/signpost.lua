-- A wooden signpost at a junction: the post is scenery (it blocks, it is drawn with the rest); each arm is one road, its point showing
-- which way that road goes, with the road's name in bold cream capitals on the dark panel of both faces (sprites/fx/sign_*.png, made by
-- tools/art.mjs with image_make). The owner's fifth play: "The road signs are hard to see from far away. Some of the lines don't show up
-- almost like a rendering issue?" One family of boards (tools/models.mjs `SIGN`): every one 3.6 m long with letters 0.36 m high on one
-- line, 0.72 m high; a long name on two lines on a board 1.12 m high (KETTLE CREEK over ROAD, 0.29 m). The arms hang at the chase
-- camera's height, so a name reads from the van at about 25 m and the sign is plainly a sign at 60. The lettering has no hairlines and
-- is filtered with its whole chain of mipmaps (the engine gave none to a picture whose sides were not powers of two: thin strokes broke
-- up and shimmered with distance).
local Signpost = nova.entity { tags = { "signpost" } }

-- (each level's middle: the side road's board on top, higher when it is a tall one, the main road's below)
local ARM_Y = { 3.0, 2.15 }
local TALL_Y = 3.2
-- (tools/models.mjs SIGN and tools/art.mjs SIGN_PPM: the board's length, its point, the panel's front, the words' texels a metre)
local SIGN = { length = 3.6, point = 0.42, front = 0.06 + 0.014, ppm = 300 }

local function sprite_of(text) return "sign_" .. text:lower():gsub("[^a-z]+", "_"):gsub("_$", "") end
-- A name too long for one line goes on the tall board, on two lines.
function Signpost.tall(text) return #(text or "") > 12 end

function Signpost:create()
  nova.scenery.add("signpost", self.x, 0, self.z, { ry = 0, lift = "upright" }) -- (upright: it stands straight on a slope)
  self.drawn = {}
  -- (each road's arms at one height: the side road's on top, the main road's two, one each way, level below it)
  local level, levels = {}, 0
  for i, arm in ipairs(self.arms or {}) do
    if not level[arm.text or ""] then levels = levels + 1; level[arm.text or ""] = levels end
    local at = level[arm.text or ""]
    local ry = arm.ry or 0
    local sprite = sprite_of(arm.text or "")
    local tall = Signpost.tall(arm.text)
    local L = SIGN.length
    -- (the arm's model points along its own +x; turned by ry, +x goes to (cos ry, -sin ry) in x, z)
    local ax, az = math.cos(ry), -math.sin(ry)
    local nx, nz = math.sin(ry), math.cos(ry) -- its face
    -- the words: in the middle of the panel's straight part, a little towards the point, 2 cm off each face (well clear of it: no
    -- flicker between the two at any distance)
    local iw, ih = nova.image_size("fx/" .. sprite)
    local mid = (0.14 + L - SIGN.point) / 2 + 0.06
    local off = SIGN.front + 0.02
    self.drawn[i] = {
      model = tall and "sign_arm_tall" or "sign_arm",
      opts = { ry = ry, shadow = true, lift = "origin" }, -- (level, at the height of the ground under the post)
      y = (tall and at == 1) and TALL_Y or ARM_Y[at] or (2.15 - 0.85 * (at - 2)),
      sprite = sprite,
      text = arm.text,
      cx = self.x + ax * mid, cz = self.z + az * mid,
      -- (a billboard rises with the ground under it: the words keep to the level arm, which rises with the ground under the post)
      lift = nova.terrain_height(self.x, self.z) - nova.terrain_height(self.x + ax * mid, self.z + az * mid),
      board = { w = iw / SIGN.ppm, h = ih / SIGN.ppm },
      fronts = { { nx * off, nz * off, { nx, 0, nz } }, { -nx * off, -nz * off, { -nx, 0, -nz } } },
    }
  end
end

function Signpost:draw()
  for _, d in ipairs(self.drawn) do
    nova.model(d.model, self.x, d.y, self.z, d.opts)
    for _, f in ipairs(d.fronts) do
      d.board.face = f[3]
      nova.billboard(d.sprite, d.cx + f[1], d.y + d.lift, d.cz + f[2], d.board.w, d.board)
    end
  end
end

return Signpost
