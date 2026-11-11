-- A wall: a box that stops the hero, the shots and (later) enemies. Its x and z are the middle; w, d and h are its size in metres.
local Wall = nova.entity {
  tags = { "wall" },
  settings = {
    w = { 4, min = 0.2, max = 60, step = 0.5, help = "Width across (metres)" },
    d = { 0.5, min = 0.2, max = 60, step = 0.5, help = "Depth towards the viewer (metres)" },
    h = { 3, min = 0.2, max = 20, step = 0.5, help = "Height (metres)" },
    shade = { "#8a90a8", type = "colour", help = "Colour" },
  },
}

function Wall:create()
  self.id_wall = nova.walls.add(self.x - self.w / 2, self.z - self.d / 2, self.x + self.w / 2, self.z + self.d / 2, 0, self.h)
end

function Wall:draw()
  local c = self.shade
  nova.cuboid(self.x - self.w / 2, 0, self.z - self.d / 2, self.x + self.w / 2, self.h, self.z + self.d / 2, { color = { c[1], c[2], c[3] } })
end

return Wall
