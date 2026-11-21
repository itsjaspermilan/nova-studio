-- The title screen: Continue (or Start on a fresh save) and New game, which wipes the save after a confirm. The save is read at boot (main.lua).
local P = require("data.player")
local Ty = require("lib.type")
local Meta = require("lib.meta")
local HUD = require("lib.hud")

local Title = nova.scene {}
local W = 960

function Title:enter()
  nova.cam.set(480, 270)
  nova.pause(false)
  self.t, self.sel, self.mode, self.last_dir, self.confirm = 0, 1, "menu", 0, 1
  nova.music.play(P.music.den, { volume = P.music.den_volume })
  nova.log("title")
  require("lib.look").enter("outdoors")   -- (the backdrop is scenes/title.scene.json, a rainy corner of the market)
end

function Title:leave() require("lib.look").leave() end

function Title:items()
  if Meta.started then return { "Continue", "New game" } end
  return { "Start" }
end

function Title:update(dt)
  self.t = self.t + dt
  local pressed = nova.input.pressed("interact")
  local dir = function(axis)
    local a = nova.input.axis(axis)
    return a > 0.6 and 1 or (a < -0.6 and -1 or 0)
  end
  if self.mode == "menu" then
    local items = self:items()
    local d = dir("move_y")
    if d ~= 0 and d ~= self.last_dir then
      self.sel = (self.sel - 1 + d) % #items + 1
      nova.sound.play("menu_move", { volume = P.sfx.menu_move })
    end
    self.last_dir = d
    if pressed and self.t > 0.3 then
      nova.sound.play("menu_select", { volume = P.sfx.menu_select })
      if items[self.sel] == "New game" then
        self.mode, self.confirm = "confirm", 1
      else
        nova.goto_scene("den")
      end
    end
  else
    local d = dir("move_x")
    if d ~= 0 and d ~= self.last_dir then
      self.confirm = (self.confirm - 1 + d) % 2 + 1
      nova.sound.play("menu_move", { volume = P.sfx.menu_move })
    end
    self.last_dir = d
    if nova.input.pressed("dash") then self.mode = "menu" end
    if pressed then
      nova.sound.play("menu_select", { volume = P.sfx.menu_select })
      if self.confirm == 2 then
        Meta.wipe()
        nova.log("new game")
        nova.goto_scene("den")
      else
        self.mode = "menu"
      end
    end
  end
end

function Title:draw_ui()
  nova.ui.rect(0, 0, W, 540, { 5, 6, 15, 120 })          -- (the street shows through, dimmed)
  nova.ui.rect(0, 84, W, 210, { 5, 6, 15, 150 })         -- (a band behind the name and the tagline)
  local glow = 0.75 + 0.25 * math.sin(self.t * 3)
  Ty.text(0, 100, "NEON", "title", { color = { 255 * glow, 43, 214, 255 }, align = "center", width = W, shadow = true })
  Ty.text(0, 170, "UNDERTOW", "title", { color = { 6, 240 * glow, 255, 255 }, align = "center", width = W, shadow = true })
  Ty.text(0, 244, "Low Meridian floods a little more every year.\nSomebody has to deliver the mail.", "small", { color = { 190, 200, 230, 255 }, align = "center", width = W })
  if self.mode == "menu" then
    for i, name in ipairs(self:items()) do
      local on = i == self.sel
      local y = 320 + (i - 1) * 50
      nova.ui.rect(340, y, 280, 40, on and { 6, 240, 255, 255 } or { 70, 80, 120, 255 })
      nova.ui.rect(343, y + 3, 274, 34, { 12, 14, 34, 255 })
      Ty.text(340, y + 10, name, "label", { color = on and { 255, 255, 255, 255 } or { 150, 160, 190, 255 }, align = "center", width = 280 })
    end
    HUD.prompt(380, 470, "interact", "choose")
  else
    nova.ui.rect(180, 300, 600, 150, { 255, 43, 214, 255 })
    nova.ui.rect(183, 303, 594, 144, { 8, 10, 26, 255 })
    Ty.text(180, 318, "Erase everything? Keys, upgrades, friends, wins.", "body", { color = { 255, 255, 255, 255 }, align = "center", width = 600 })
    Ty.text(180, 342, "LULLABY will not remember you. She says that is fine.", "small", { color = { 190, 200, 230, 255 }, align = "center", width = 600 })
    for i, name in ipairs({ "Keep my save", "Erase it all" }) do
      local on = i == self.confirm
      local x = 220 + (i - 1) * 270
      nova.ui.rect(x, 380, 240, 40, on and { 6, 240, 255, 255 } or { 70, 80, 120, 255 })
      nova.ui.rect(x + 3, 383, 234, 34, { 12, 14, 34, 255 })
      Ty.text(x, 391, name, "body", { color = on and { 255, 255, 255, 255 } or { 150, 160, 190, 255 }, align = "center", width = 240 })
    end
  end
end

return Title
