-- A door to another scene. The scene file says where it leads: props { to = "house", to_x = 264, to_y = 288 }
-- (the scene to go to, and where the hero stands when he arrives).
local Door = nova.entity {
  sprite = "door",
  tags = { "door" },
  pivot = { 0.5, 1 },
  hitbox = { -5, -6, 10, 6 },
  sx = 3, sy = 3,
  settings = {
    to = { "", type = "text" },
    to_x = { 0 },
    to_y = { 0 },
  },
}

function Door:create()
  self.depth = -self.y + 24 -- a little behind whatever stands in the doorway
end

-- Runs while the hero's hitbox overlaps the door's.
function Door:on_collide_hero()
  nova.sound.play("door")
  nova.log("through " .. tostring(self.name) .. " to " .. self.to)
  nova.goto_scene(self.to, self.to_x, self.to_y)
end

return Door
