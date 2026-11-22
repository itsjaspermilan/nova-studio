-- Fernhollow Post: the vertical slice of the mountain post office game (docs/games/mountain-post.md, "Slice spec").
-- You are the new postmaster. Two parcels and a letter wait on the office's shelf; the van waits outside; find the two addresses
-- by the signs and the paper map, hand the parcels over, talk, and come back.
--
--   scenes/title.lua   the title card
--   scenes/office.lua  the post office's room (scenes/office.scene.json): the letter, the shelf, the door out
--   scenes/valley.lua  the valley (scenes/valley.scene.json): the roads, the two houses, the van, getting in and out, the talks
--   entities/          the van (springs from Pine Ridge Rally's car), the postmaster, Hazel and Pip, the props
--   lib/               the words (exactly the spec's), the state, the world's lines, the cameras, the cards, the text box, the HUD
--   tools/             the recipes every model, picture, sound and the scene files are made from (not part of the game)
nova.collision { plane = "xz", cell = 4 }
require("lib.state").reset()
nova.start("title")
