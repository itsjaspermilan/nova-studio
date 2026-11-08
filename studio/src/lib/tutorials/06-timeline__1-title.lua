-- file: scenes/title.lua
-- The title drops in when the scene starts: animations/title_in.anim.json moves the text named "title".
local Title = nova.scene {}

function Title:enter()
  self.score = 0
  self:play_anim("title_in", {
    on_finish = function() nova.log("the title is in") end,
  })
end

-- An event key in the animation can call this (Call: title_landed)
function Title:title_landed()
  nova.log("bump!")
end

return Title
