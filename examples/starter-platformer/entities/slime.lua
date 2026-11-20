-- A moving hazard: a slime that hops to and fro. The scene says how far: props { range = 150 } is 150 units each way
-- from where it was placed. Touching it sends the hero back to the start of the scene.
local Slime = nova.entity {
  sprite = "slime", anim = "move",
  tags = { "hazard" },
  pivot = { 0.5, 0.875 },
  hitbox = { -5, -8, 10, 8 },
  sx = 3, sy = 3,
  velocity = false,
  speed = 70,
  settings = {
    range = { 120, min = 0, max = 2000, help = "How far it goes each way from where it stands" },
  },
}

function Slime:create()
  self.home = self.x
  self.way = 1
  self.depth = -5
end

function Slime:update(dt)
  self.x = self.x + self.way * self.speed * dt
  if math.abs(self.x - self.home) >= self.range then
    self.way = -self.way
    self.x = self.home - self.way * self.range
  end
  self.flip_x = self.way < 0
end

function Slime:on_collide_hero(hero) hero:hurt() end

return Slime
