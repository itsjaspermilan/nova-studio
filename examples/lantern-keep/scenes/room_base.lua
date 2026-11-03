-- What every room of the keep does: find the key, open the door at the east wall, go through. The rooms themselves
-- (tiles, enemies, where the key lies) are in room1.scene.json, room2.scene.json and room3.scene.json.
local state = require("lib.state")

local Room = nova.scene { index = 1 }

local DOOR_COL, DOOR_ROW, DOORWAY = 29, 8, 6

function Room:enter()
  state.new_room()
  state.room = self.index
  self.opened = false
  nova.music.play("keep", { volume = 0.4 })
  nova.log(string.format("room %d: %d enemies", self.index, nova.count("enemy")))
end

function Room:update(dt)
  state.time = state.time + dt
  -- the key was picked up: the door becomes a doorway
  if state.has_key and not self.opened then
    self.opened = true
    self.map:set(DOOR_COL, DOOR_ROW, DOORWAY)
    nova.log(string.format("room %d: door open after %.1f s, %d hearts", self.index, state.time, state.hearts))
    nova.sound.play("door")
  end
  -- through the doorway: the next room, or the end
  if self.opened and self.hero.x > DOOR_COL * 32 + 6 then
    if state.rooms[self.index + 1] then
      nova.goto_scene(state.rooms[self.index + 1])
    else
      nova.goto_scene("win")
    end
  end
end

function Room:draw_ui()
  for i = 1, state.max_hearts do
    nova.ui.sprite("heart", 28 + (i - 1) * 30, 28, { frame = i <= state.hearts and 0 or 1, sx = 0.9, sy = 0.9 })
  end
  nova.ui.text(28, 54, string.format("Room %d of %d", state.room, #state.rooms), { size = 15, color = { 200, 195, 225 }, shadow = true })
  nova.ui.text(870, 18, state.format_time(state.time), { size = 18, align = "right", width = 70, shadow = true })
  if state.has_key then
    nova.ui.sprite("key", 925, 66, { sx = 0.9, sy = 0.9 })
    if self.opened then nova.ui.text(280, 504, "The door is open ->", { size = 20, color = { 255, 230, 140 }, shadow = true }) end
  elseif state.room == 1 then
    nova.ui.text(280, 504, "Move: arrows or WASD     Sword: Z or Space     Find the key", { size = 16, color = { 200, 195, 225 }, shadow = true })
  end
end

return Room
