local S = nova.scene {}
-- (the order and the cameras are the ones scripts/moving-day/hd-ui.mjs cuts the pictures out by)
local ICONS = { "sofa", "armchair", "tv", "bed", "plant", "bookcase", "lamp", "fridge", "stove", "desk", "desk_chair", "table", "chair", "box",
  "bathtub", "washer", "side_table", "coffee_table", "wall", "window", "rug", "floor_wood", "floor_carpet", "floor_tile", "floor_bath" }
local FACES = { "character-female-a", "character-female-b", "character-female-c", "character-female-d", "character-female-e", "character-female-f",
  "character-male-a", "character-male-b", "character-male-c", "character-male-d", "character-male-e", "character-male-f" }
local WIDE = { sofa = 2, tv = 2, bed = 2, bookcase = 2, desk = 2, table = 2, bathtub = 2, rug = 3 }
local DEEP = { bed = 2, rug = 2 }
function S:enter()
  nova.light { dir = { -0.4, -1, -0.7 }, color = { 255, 246, 230 }, ambient = { 160, 150, 160 } }
  nova.look { toon = 4, outline = { color = { 60, 44, 52 }, strength = 0.9, width = 3 }, saturation = 1.12 }
end
function S:draw()
  local bg = nova.input.down("white") and 255 or 0
  nova.sky { top = { bg, bg, bg }, horizon = { bg, bg, bg } }
  if nova.input.down("faces") then
    -- four across and three down (one above another in the air), 1.9 m and 2 m apart: heads and shoulders, from the front
    nova.camera(2.85, 2.35, 37, 2.85, -0.65, 0, 10)
    for i, who in ipairs(FACES) do
      local c, r = (i - 1) % 4, (i - 1) // 4
      nova.model(who, c * 1.9, -r * 2, 0, { scale = 2.2, ry = 0.3, clip = "idle", time = 0.2 })
    end
    return
  end
  -- seven across and four down, 3.2 m apart, seen from far away (a narrow lens), from the front and above; each turned a little
  nova.camera(9.6, 50, 54.3, 9.6, 0.5, 4.8, 10)
  for i, id in ipairs(ICONS) do
    local c, r = (i - 1) % 7, (i - 1) // 7
    -- (a piece stands from its first cell to +x and -z: move it so its middle is the cell's, then turn it about that middle)
    local w, d = WIDE[id] or 1, DEEP[id] or 1
    local a = 0.5
    local mx, mz = (w - 1) / 2, -(d - 1) / 2
    local ox, oz = mx * math.cos(a) + mz * math.sin(a), -mx * math.sin(a) + mz * math.cos(a)
    nova.model(id, c * 3.2 - ox, 0, r * 3.2 - oz, { ry = a, scale = id == "rug" and 0.6 or ((w > 1 or d > 1) and 0.85 or 1) })
  end
end
return S
