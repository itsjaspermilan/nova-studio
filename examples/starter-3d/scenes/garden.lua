-- The garden. The level itself is scenes/garden.scene.json (scene_write): the ground, the hero, the ruins, the trees and
-- the gems, each placed by its kind. This file lights it, follows the hero with the camera and counts the gems.
local Garden = nova.scene {}

function Garden:enter()
  -- The sun stands in front of and beside the first view, so shadows fall towards the camera and can be seen.
  nova.light { dir = { -0.55, -1, 0.4 }, color = { 255, 244, 222 }, ambient = { 100, 112, 138 } }
  nova.shadows { radius = 24, strength = 0.8 }
  nova.sky { top = { 70, 140, 225 }, horizon = { 198, 226, 242 } }
  nova.fog { color = { 198, 226, 242 }, near = 30, far = 100 }
  nova.wind { direction = 30, strength = 1 }
  nova.look { ao = 0.5, saturation = 1.06, vignette = 0.15 }
  self.total = nova.count("gem")
  self.found = 0
  self.first = true
  nova.music.play("garden", { volume = 0.3, fade = 1 })
end

function Garden:gem_taken(gem)
  self.found = self.found + 1
  nova.log("gem " .. self.found .. " of " .. self.total .. " (" .. tostring(gem.name) .. ")")
  if self.found == self.total then nova.log("all gems found") end
end

function Garden:update(dt)
  -- The right stick (or L and R) turns the camera; left alone it swings round behind the way the hero walks.
  local turn = nova.input.axis("look_x")
  if nova.input.down("l1") then turn = turn - 1 end
  if nova.input.down("r1") then turn = turn + 1 end
  if turn ~= 0 then nova.cam3.look(-turn * 2.4 * dt, 0) end
  if self.hero then
    -- collide: nothing solid comes between the camera and the hero (walls, the arch, tree crowns); squeezed nearer
    -- than min_distance, the hero is hidden so the picture is the garden and not the back of a head.
    nova.cam3.follow(self.hero, { distance = 6, height = 2.9, look_height = 1.2, fov = 55, smooth = self.first and 0 or 7,
      collide = true, min_distance = 1.7, hide = true, behind = turn == 0 and 1.1 or nil, dt = dt })
    self.first = false
  end
end

function Garden:draw()
  -- the lantern's light: its lamp hangs 0.42 in front of the post (prop3d_make's answer), turned as the post is
  local lamp = self.lamp
  if lamp then
    nova.point_light(lamp.x + math.sin(lamp.ry or 0) * 0.42, 1.95, lamp.z + math.cos(lamp.ry or 0) * 0.42, { radius = 6, color = { 255, 196, 120 } })
  end
end

function Garden:draw_ui()
  local w, h = nova.view()
  nova.ui.text(24, 20, "Gems  " .. self.found .. " / " .. self.total, { size = 26, shadow = true, color = { 235, 250, 255 } })
  if self.found == self.total then
    nova.ui.text(0, h * 0.3, "All the gems are found!", { size = 44, align = "center", width = w, shadow = true, color = { 255, 236, 150 } })
  end
end

return Garden
