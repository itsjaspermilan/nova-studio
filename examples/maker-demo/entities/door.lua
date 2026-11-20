-- A way to another scene. It has no picture: the door itself is a tile of the painted map, and this is the spot on it
-- that takes the hero through. The scene file says where to: props { to = "room", to_x = 456, to_y = 520 }.
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
  nova.sound.play("door", { volume = 0.8 })
  nova.log("through " .. tostring(self.name) .. " to " .. self.to)
  nova.goto_scene(self.to, self.to_x, self.to_y)
end

return Door
