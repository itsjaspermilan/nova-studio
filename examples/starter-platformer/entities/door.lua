-- A door to another scene: stand in it and press up. The scene file says where it leads: props { to = "cave" }.
-- Its picture is the door tile of the tileset (made with tileset_make), so `frame` is that tile's number.
local Door = nova.entity {
  sprite = "tiles", frame = 66,
  tags = { "door" },
  pivot = { 0.5, 1 },
  hitbox = { -6, -16, 12, 16 },
  sx = 3, sy = 3,
  settings = {
    to = { "", type = "text" },
  },
}

function Door:create() self.depth = 20 end

function Door:update()
  if self:touching("hero") and nova.input.pressed("up") then
    nova.sound.play("door", { volume = 0.8 })
    nova.log("through " .. tostring(self.name) .. " to " .. self.to)
    nova.goto_scene(self.to)
  end
end

return Door
