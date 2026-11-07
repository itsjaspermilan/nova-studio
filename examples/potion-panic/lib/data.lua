-- What the game is made of: the ingredients, the potions (recipes), the four biomes, the twelve campaign levels as text maps, and the story.
local data = {}

-- ---- ingredients ---------------------------------------------------------------------------------------------------------------
-- `model` is in models/ (from Kenney's Food Kit), the picture in sprites/ui/ is the kit's own preview.
data.ingredients = {
  glowcap = { name = "Glowcap", model = "ing_glowcap", icon = "ui/ing_glowcap" },
  embergourd = { name = "Embergourd", model = "ing_embergourd", icon = "ui/ing_embergourd" },
  frostroot = { name = "Frostroot", model = "ing_frostroot", icon = "ui/ing_frostroot" },
  moonberry = { name = "Moonberry", model = "ing_moonberry", icon = "ui/ing_moonberry" },
  sunpetal = { name = "Sunpetal", model = "ing_sunpetal", icon = "ui/ing_sunpetal" },
  bogbulb = { name = "Bogbulb", model = "ing_bogbulb", icon = "ui/ing_bogbulb" },
}

-- ---- potions ------------------------------------------------------------------------------------------------------------------
-- items: { ingredient, ground } (ground: it must be ground in the mortar first). Put the items in the cauldron in any order; it starts on its own
-- once they are one of the level's potions. Within a level no potion's items may be a part of another's (the self-test checks every level).
data.recipes = {
  heal = { name = "Healing Draught", items = { { "glowcap", true }, { "sunpetal", false } }, brew = 6, value = 40, color = { 232, 70, 96 } },
  night = { name = "Night Sight", items = { { "moonberry", true }, { "glowcap", false } }, brew = 6, value = 40, color = { 150, 96, 236 } },
  swift = { name = "Swiftfoot Brew", items = { { "sunpetal", true }, { "moonberry", false } }, brew = 6, value = 40, color = { 250, 210, 60 } },
  frost = { name = "Frost Tonic", items = { { "frostroot", true }, { "moonberry", false } }, brew = 7, value = 45, color = { 96, 214, 244 } },
  fire = { name = "Fireward Elixir", items = { { "embergourd", true }, { "embergourd", true } }, brew = 7, value = 50, color = { 250, 140, 44 } },
  ember = { name = "Ember Salve", items = { { "embergourd", true }, { "sunpetal", true }, { "glowcap", false } }, brew = 9, value = 85, color = { 255, 96, 60 } },
  bog = { name = "Bog Antidote", items = { { "bogbulb", true }, { "glowcap", true } }, brew = 7, value = 50, color = { 96, 200, 104 } },
  mire = { name = "Mire Draught", items = { { "bogbulb", true }, { "moonberry", true }, { "sunpetal", false } }, brew = 9, value = 85, color = { 118, 70, 150 } },
  glacier = { name = "Glacier Brew", items = { { "frostroot", true }, { "glowcap", true }, { "moonberry", true } }, brew = 9, value = 85, color = { 176, 230, 255 } },
  panacea = { name = "Grand Panacea", items = { { "glowcap", true }, { "sunpetal", true }, { "moonberry", true } }, brew = 10, value = 100, color = { 244, 244, 255 } },
}

-- ---- biomes --------------------------------------------------------------------------------------------------------------------
-- floor and wall are tints for the Mini Dungeon floor and wall models; counter is the colour of the worktops; sky and fog are the colours behind
-- and in the distance; music is in music/. `decor` lists models scattered round the outside (from Kenney's Nature, Graveyard and Fantasy Town kits).
data.biomes = {
  { id = "meadow", name = "Greenhollow Meadow", short = "Meadow", floor = { 240, 230, 206 }, floor2 = { 224, 212, 184 }, ground = { 112, 168, 118 }, wall = { 104, 132, 150 }, counter = { 150, 98, 76 }, top = { 236, 206, 168 },
    sky = { 150, 206, 240 }, fog = { 176, 214, 226 }, sun = { 255, 246, 224 }, ambient = { 136, 140, 150 }, music = "meadow", banner = { 96, 168, 84 }, cauldron = { brew = 1, burn = 1 }, quirk = "Ordinary cauldrons.",
    decor = { "tree_default", "tree_oak", "flower_redA", "flower_yellowA", "flower_purpleA", "mushroom_redGroup", "plant_bush" }, fence = "fence_simple" },
  { id = "frost", name = "Frostpeak Hollow", short = "Frost", floor = { 214, 232, 246 }, floor2 = { 190, 214, 234 }, ground = { 226, 238, 248 }, wall = { 84, 112, 170 }, counter = { 70, 98, 156 }, top = { 176, 200, 232 },
    sky = { 170, 196, 230 }, fog = { 214, 228, 244 }, sun = { 232, 240, 255 }, ambient = { 134, 146, 172 }, music = "frost", banner = { 110, 170, 220 }, cauldron = { brew = 1.3, burn = 1.7 }, quirk = "Slow, forgiving cauldrons.",
    decor = { "tree_pineTallA", "tree_pineRoundA", "rock_largeA", "rock_tallA", "campfire_logs", "tent_smallClosed" }, fence = "fence_simple", snow = true },
  { id = "ember", name = "Emberdeep Caverns", short = "Ember", floor = { 96, 76, 84 }, floor2 = { 82, 64, 72 }, ground = { 44, 30, 38 }, wall = { 70, 48, 58 }, counter = { 132, 66, 56 }, top = { 196, 112, 86 },
    sky = { 52, 28, 28 }, fog = { 70, 36, 34 }, sun = { 255, 190, 140 }, ambient = { 150, 110, 110 }, music = "ember", banner = { 220, 108, 52 }, cauldron = { brew = 0.75, burn = 0.65 }, quirk = "Fast, fierce cauldrons.",
    decor = { "rock_tallA", "stone_tallB", "rock_largeA", "cactus_tall", "campfire_logs" }, fence = "fence_simple" },
  { id = "mire", name = "Gloomwater Mire", short = "Mire", floor = { 110, 126, 124 }, floor2 = { 96, 110, 110 }, ground = { 44, 58, 66 }, wall = { 50, 64, 74 }, counter = { 96, 76, 120 }, top = { 150, 126, 176 },
    sky = { 40, 44, 70 }, fog = { 58, 70, 88 }, sun = { 186, 200, 240 }, ambient = { 110, 120, 156 }, music = "mire", banner = { 130, 100, 190 }, cauldron = { brew = 1, burn = 1 }, quirk = "Mud and conveyor belts.",
    decor = { "pine", "gravestone-cross", "candle-multiple", "lantern-candle", "fire-basket", "pumpkin-carved", "crypt-small" }, fence = "iron-fence" },
}

-- ---- levels ----------------------------------------------------------------------------------------------------------------------
-- The levels are scene files, not code: scenes/levels/1.scene.json to 12 and primer.scene.json (the tutorial), each a kitchen painted as a tilemap
-- and a "level" object whose props are its settings. Stars are 0.6, 0.95 and 1.3 times what the computer apprentice (lib/bot.lua, F9 on the title
-- screen) scores, so three stars means beating it. See lib/levels.lua.
data.levels, data.tutorial = require("lib.levels").load()

-- ---- the story ----------------------------------------------------------------------------------------------------------------------
-- Cards shown before a biome's first level ("biome1".."biome4") and after the last one ("end"). Each is { who, text }.
data.story = {
  intro = {
    { "NARRATOR", "The Cauldron & Crow was the finest apothecary in the valley, until Old Marrow set out after a rare berry and never came back." },
    { "GUILDMASTER VEX", "The guild is owed four seals, apprentice. Fill the orders in every region by winter, or your shop is mine." },
    { "WREN", "Then I had better start brewing." },
  },
  biome1 = {
    { "NARRATOR", "Greenhollow Meadow. Marrow's last letter was posted from here: a market, a crowd, and a great many sniffles." },
    { "WREN", "Glowcap, sunpetal, a quick grind and a patient pot. Bottle it, serve it, repeat." },
  },
  biome2 = {
    { "NARRATOR", "Frostpeak Hollow. The first seal is hung on the door. The ice here is as slippery as Vex's smile." },
    { "WREN", "Plan the route, and brake early. Frost tonics wait for no one." },
  },
  biome3 = {
    { "NARRATOR", "Emberdeep Caverns. The second seal glows in the dark, and so does the floor." },
    { "WREN", "Stay off the lava. Whatever Marrow was looking for, he did not come this way on foot." },
  },
  biome4 = {
    { "NARRATOR", "Gloomwater Mire. Three seals in hand, and the orders get longer. Candles flicker over the bog." },
    { "WREN", "One more region. Mud, belts and a very long queue." },
  },
  ["end"] = {
    { "GUILDMASTER VEX", "Four seals. I did not think it possible. The shop is yours, apprentice, and the guild's thanks." },
    { "OLD MARROW", "Wren! I found the moonberry bush. It was behind the shop all along." },
    { "WREN", "Of course it was. Welcome home. The pot is already on." },
    { "NARRATOR", "The Cauldron & Crow was open again, and the queue went out of the door. THE END. In Free Brew you can set your own rules on every level you have beaten." },
  },
}

return data
