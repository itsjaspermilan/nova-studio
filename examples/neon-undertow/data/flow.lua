-- How the game moves from one screen to the next and what it announces: the wipes (lib/wipe.lua), the banners (lib/banner.lua) and the prompts
-- over things that can be used (lib/prompt.lua). Numbers in seconds and screen units (a screen is 960 x 540). All the words are here: edit them freely.
local ACCENT = { magenta = { 255, 63, 164 }, cyan = { 53, 230, 255 }, amber = { 255, 200, 70 } }

return {
  -- ---------------------------------------------------------------- wipes
  wipe = {
    close = 0.35,       -- leaving the Den for a run: the screen closes this fast
    open = 0.35,        -- ...and opens on room 1
    room_close = 0.25,  -- between rooms: a quick wipe each way, no card
    room_open = 0.25,
    card_hold = 1.2,    -- the district card holds this long
    line_hold = 1.0,    -- back to the Den: the wipe holds this long with LULLABY's line
    bands = 9,          -- the shutter's slats
    lean = 150,         -- how far each slat's edge leans (units): the diagonal
    stagger = 0.55,     -- how much of the time the slats are staggered over
  },
  -- the colours of the wipe by district (a district's two accents and its dark)
  districts = {
    gutter = { top = "LOW MERIDIAN", name = "GUTTER MARKET", a = ACCENT.magenta, b = ACCENT.cyan, dark = { 5, 6, 15 } },
  },
  -- the card's one-line tagline: a different one each run (the run's seed picks; never the same twice running)
  taglines = {
    "Everything is for sale. Especially you.",
    "Mind the puddles. They bite.",
    "Fresh noodles, fresh scars, no refunds.",
    "Eight rooms. Zero tips.",
    "Smells like deep fry and bad decisions.",
    "The mail must go through. Sadly.",
    "Knees on special! Yours, mostly.",
    "Please keep all limbs inside the runner.",
    "Free samples! Of violence.",
  },
  -- LULLABY's line on the way back to the Den (after a death, after the boss)
  den_lines = {
    dead = {
      "LULLABY: Printing. Don't touch anything wet.",
      "LULLABY: Again? I only just cleaned the bed.",
      "LULLABY: Hold still. This will sting my feelings.",
      "LULLABY: Warming up the toner. You owe me.",
      "LULLABY: One runner, slightly used. Coming up.",
    },
    win = {
      "LULLABY: Look at you. Hold still while I count the change.",
      "LULLABY: You won? I mean. Of course you won.",
      "LULLABY: Brag in the Den. The wet is a feature.",
    },
  },

  -- ---------------------------------------------------------------- banners
  -- kind -> look. `lane` "big" (a band across the upper screen) or "tag" (a small tab under it); `role` is the text's role (lib/type.lua);
  -- `color` the text, `edge` the band's neon edge; `hold` seconds on screen after the slam. `sfx` is played when it slams in.
  banners = {
    go     = { lane = "big", role = "banner", color = { 255, 228, 94 },  edge = ACCENT.magenta, hold = 0.9,  sfx = "banner_go" },
    clear  = { lane = "big", role = "banner", color = { 53, 230, 255 },  edge = ACCENT.cyan,    hold = 1.4,  sfx = "banner_clear" },
    elite  = { lane = "big", role = "banner", color = { 255, 228, 94 },  edge = ACCENT.amber,   hold = 1.3,  sfx = "banner_elite" },
    boss   = { lane = "big", role = "banner", color = { 255, 255, 255 }, edge = ACCENT.magenta, hold = 1.7,  sfx = "banner_boss", size = 1.25 },
    win    = { lane = "big", role = "banner", color = { 53, 230, 255 },  edge = ACCENT.magenta, hold = 2.2,  sfx = "banner_win", cut = true },
    death  = { lane = "big", role = "banner", color = { 255, 63, 164 },  edge = ACCENT.magenta, hold = 1.5,  sfx = "banner_death", delay_sub = 0.45, cut = true },
    room   = { lane = "tag", role = "label",  color = { 235, 240, 255 }, edge = ACCENT.cyan,    hold = 1.5,  sfx = "banner_room" },
  },
  slam = 0.2,           -- seconds a banner takes to slam in (it overshoots a little)
  whip = 0.18,          -- and to be whipped off
  -- the room tab: "ROOM 3 / 8" and this word for the kind of room
  room_kinds = { fight = "FIGHT", elite = "ELITE", gauntlet = "GAUNTLET", stranger = "STRANGER", boss = "BOSS", walk = "SHOP AND BANK" },
  boss_delay = 1.9,     -- seconds the boss's name card is up before the doors shut and she wakes
  boss_subtitles = { mother_coil = "Queen of the scrapyard. Allergic to visitors." },
  death_lines = {
    "LULLABY: Hold still. I have you. Mostly.",
    "LULLABY: You walked into the pipe. The PIPE.",
    "LULLABY: Don't worry, I only lose a little of you each time.",
    "LULLABY: Great news: this one is a free reprint. (It is not.)",
    "LULLABY: I'd say 'try dodging' but I know you.",
  },
  win_line = "Mother Coil sends her regards. And a bill.",

  -- ---------------------------------------------------------------- prompts
  prompt = {
    reach = 78,         -- how near the runner stands for a prompt to rise: about 1.6 tiles (units; a tile is 48), the cards' own reach
    fade = 0.12,        -- seconds to fade in (and about the same to slide away)
    back = 0.6,         -- seconds a used thing's prompt stays away
    width = 300,        -- the widest the one-line text goes before it wraps
  },

  -- volumes of the sounds above (data/player.lua's `sfx` belongs to the runner; these are this file's own)
  sfx = { banner_go = 0.7, banner_room = 0.5, banner_clear = 0.7, banner_elite = 0.7, banner_boss = 0.8, banner_death = 0.7, banner_win = 0.8, wipe = 0.6 },
}
