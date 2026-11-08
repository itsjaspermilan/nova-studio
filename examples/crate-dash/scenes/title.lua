local state = require("lib.state")

local Title = nova.scene {}

function Title:enter()
  state.score, state.lives = 0, 3
  self.hero.floor = 440
  -- The opening is a keyframe animation (animations/title_in.anim.json, made in the studio's
  -- timeline editor): the name drops in, the stars spin up, the tagline fades in. Its last key
  -- calls ready() below. The prompt stays hidden until then.
  self.prompt.visible = false
  self:play_anim("title_in")
  -- A script that can wait: pause briefly, then wait for a button (pressing it early skips the opening).
  self:go(function()
    nova.wait(0.4)
    nova.wait_until(function() return nova.input.pressed("jump") end)
    nova.goto_scene("play")
  end)
end

function Title:ready()
  -- The prompt blinks, using a repeating timer.
  self.prompt.visible = true
  self:every(0.5, function() self.prompt.visible = not self.prompt.visible end)
end

return Title
