-- A way to another scene. It has no picture: the open shutter is a tile of the painted map, and this is the spot on it
-- that takes the runner through. The scene file says where to: props { to = "lab", to_x = 936, to_y = 150 }.
local Door = nova.entity {
  tags = { "door" },
  hitbox = { -16, -8, 32, 16 },
  settings = {
    to = { "", type = "text" },
    to_x = { 0 },
    to_y = { 0 },
  },
}

function Door:on_collide_hero()
  nova.log("through " .. tostring(self.name) .. " to " .. self.to)
  nova.goto_scene(self.to, self.to_x, self.to_y)
end

return Door
