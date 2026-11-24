-- A pond (the scene file's `pond`, tools/scene.mjs from tools/layout.mjs PONDS): still water at `level` inside its `shore`, in the bowl the
-- terrain recipe carved for it. The water is painted as still water (`nova.mesh.make { paint = "water", still = true }`: round ripples
-- that only shimmer, the sky in them at a slant, the sun's glint; its colour's alpha is how deep it is, so the shallows by the bank are
-- lighter and a soft line of foam lies where it meets the bank). Round it lies finer ground (1 m cells instead of the valley's 4 m
-- squares, which entities/valley_ground.lua leaves out there: world.POND_ZONE), so the waterline is a smooth curve, and the bank darkens
-- where it is wet. A walker is kept out of it (lib/world.lua), except on the jetty's boards.
local world = require("lib.world")

local Pond = nova.entity { tags = { "pond" } }

local MESH = { shadow = false }
local DEEP, SHALLOW = { 58, 108, 128 }, { 114, 170, 172 }

function Pond:create()
  self.built = false
  local shore = {}
  for _, q in ipairs(self.shore or {}) do shore[#shore + 1] = { q[1], q[2] } end
  self.pond = { id = self.key, label = self.label, level = self.level or 0, shore = shore, x = self.x, z = self.z, reach = self.reach }
  world.add_pond(self.pond)
end

-- (the 4 m squares of the valley's ground, as entities/valley_ground.lua lays them, that it leaves out round this pond)
local function squares(p)
  local L = world.limits or { x0 = -250, z0 = -265 }
  local b, M = p.box, world.POND_ZONE
  local out = {}
  local i0, i1 = math.floor((b[1] - M - 4 - L.x0) / 4), math.ceil((b[3] + M + 4 - L.x0) / 4)
  local j0, j1 = math.floor((b[2] - M - 4 - L.z0) / 4), math.ceil((b[4] + M + 4 - L.z0) / 4)
  for j = j0, j1 do
    for i = i0, i1 do
      local x, z = L.x0 + i * 4, L.z0 + j * 4
      if world.pond_zone(x, z) or world.pond_zone(x + 4, z) or world.pond_zone(x, z + 4) or world.pond_zone(x + 4, z + 4) then
        out[#out + 1] = { x, z }
      end
    end
  end
  return out
end

function Pond:build()
  self.built = true
  local p = self.pond
  local level = p.level
  local h = nova.terrain_height
  -- the bank: each left-out square as 4 x 4 cells of a metre, coloured as the valley's ground and darker where wet
  local bpos, bcol, bidx = {}, {}, {}
  local wpos, wcol, wuv, widx = {}, {}, {}, {}
  for _, sq in ipairs(squares(p)) do
    local base = #bpos / 3
    for b = 0, 4 do
      for a = 0, 4 do
        local x, z = sq[1] + a, sq[2] + b
        local g = h(x, z)
        bpos[#bpos + 1] = x; bpos[#bpos + 1] = 0.02; bpos[#bpos + 1] = z
        local r, gg, bb = world.ground_color(x, z, math.floor(x), math.floor(z))
        local above = g - level
        if above < 0.45 then
          local k = 1 - math.max(0, above) / 0.45
          r, gg, bb = r * (1 - 0.32 * k), gg * (1 - 0.26 * k), bb * (1 - 0.12 * k)
          if above < 0 then r, gg, bb = r * 0.82 + 10, gg * 0.84 + 8, bb * 0.85 end
        end
        bcol[#bcol + 1] = math.floor(r); bcol[#bcol + 1] = math.floor(gg); bcol[#bcol + 1] = math.floor(bb); bcol[#bcol + 1] = 255
      end
    end
    for b = 0, 3 do
      for a = 0, 3 do
        local i = base + b * 5 + a + 1
        bidx[#bidx + 1] = i; bidx[#bidx + 1] = i + 6; bidx[#bidx + 1] = i + 1
        bidx[#bidx + 1] = i; bidx[#bidx + 1] = i + 5; bidx[#bidx + 1] = i + 6
      end
    end
    -- the water over the same square, where any of its cells dips under the level (it runs on a little under the bank)
    local wet = false
    for b = 0, 4 do for a = 0, 4 do if h(sq[1] + a, sq[2] + b) < level + 0.25 then wet = true end end end
    if wet then
      local wbase = #wpos / 3
      for b = 0, 4 do
        for a = 0, 4 do
          local x, z = sq[1] + a, sq[2] + b
          local deep = level - h(x, z)
          wpos[#wpos + 1] = x; wpos[#wpos + 1] = level - h(x, z); wpos[#wpos + 1] = z
          local m = math.max(0, math.min(1, 1 - deep / 0.9))
          wcol[#wcol + 1] = DEEP[1] + (SHALLOW[1] - DEEP[1]) * m
          wcol[#wcol + 1] = DEEP[2] + (SHALLOW[2] - DEEP[2]) * m
          wcol[#wcol + 1] = DEEP[3] + (SHALLOW[3] - DEEP[3]) * m
          wcol[#wcol + 1] = math.floor(math.max(0, math.min(1, (deep + 0.2) / 0.8)) * 255 + 0.5)
          wuv[#wuv + 1] = x; wuv[#wuv + 1] = z
        end
      end
      for b = 0, 3 do
        for a = 0, 3 do
          local i = wbase + b * 5 + a + 1
          widx[#widx + 1] = i; widx[#widx + 1] = i + 6; widx[#widx + 1] = i + 1
          widx[#widx + 1] = i; widx[#widx + 1] = i + 5; widx[#widx + 1] = i + 6
        end
      end
    end
  end
  if #bidx > 0 then self.bank = nova.mesh.make { positions = bpos, indices = bidx, colors = bcol, paint = "ground" } end
  if #widx > 0 then self.mesh = nova.mesh.make { positions = wpos, indices = widx, colors = wcol, uvs = wuv, paint = "water", still = true } end
  self.cells = #bidx // 6
end

function Pond:draw()
  if not self.built then self:build() end
  if self.bank then nova.mesh.draw(self.bank, MESH) end
  if self.mesh then nova.mesh.draw(self.mesh, MESH) end
end

function Pond:on_destroy()
  if self.mesh then nova.mesh.free(self.mesh); self.mesh = nil end
  if self.bank then nova.mesh.free(self.bank); self.bank = nil end
end

return Pond
