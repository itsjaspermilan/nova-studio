-- Every card is data: id, name, family (the icon), rarity (the colour), tags (sets), text (what the player reads), max copies and
-- `apply(run)`, which changes the run's state. Nothing else knows a card by name: entities read `run.mods` (lib/run.lua).
-- `index` is the card's place in the pool: a new player meets the first 12, and each tier of the Workbench's Deeper Deck adds six more
-- in this order (simple and build-around cards first, the district hacks next, the jinxes last).
-- The modifiers a card changes (`Run.mods`):
--   reach        multiplier on the baton's arc, length and width            (Long Reach)
--   live_wire    extra enemies the third hit chains to, 1 more than this    (Live Wire)
--   knock        multiplier on the third hit's knock-back; stun = seconds it stuns (Riot Stock)
--   burn         damage per second of the fire a baton hit sets (3 s)       (Hot Solder)
--   bounces      times a shot bounces off a wall                            (Ricochet)
--   pellets      shots per press (1, or a fan)                              (Scatter)
--   tracer       extra baton damage, as a share, on a shot enemy for 3 s    (Tracer)
--   shock        damage of the roll's zap; 0 = rolling does not zap         (Shock Wake)
--   rolls        rolls before the wait                                      (Second Wind)
--   hp, pips     extra health points and charge pips                        (Plating, Capacitor)
--   scrap        multiplier on scrap                                        (Deep Pockets)
--   metro        +damage for a baton hit that lands in the rhythm window    (Metronome)
--   skim         scrap dropped by each hit a leaking enemy takes            (Skim)
--   backhand     the swing after a roll also hits behind: a baton swing, doubled; after a dash attack too (Backhand)
--   slug         copies of the held shot (damage, how many it pierces)      (Overpressure)
--   incendiary   copies: seconds of fire a shot leaves (2 + 1 per extra)    (Incendiary)
--   siphon       a kill with a shot refunds the pips it cost                (Siphon)
--   smart        shots curve towards the enemy nearest the sight line       (Smart Round)
--   afterimage   copies: seconds the roll's copy lives (1.5 + 0.75 per extra) (Afterimage)
--   slipstream   copies: +30% walking speed for 1.5 s after a roll          (Slipstream)
--   rubber       the roll leaves a trail of fire                            (Burn Rubber)
--   phase        a perfect roll slows the enemies' time                     (Phase)
--   clot         health points healed by a room cleared without being hit   (Clot)
--   adrenal      copies: +25% damage and speed below half health            (Adrenal)
--   ghost        once a run a killing blow leaves 1 point                   (Ghost in the Shell)
--   friendly     enemy shots, pipes and bottles hurt other enemies          (Friendly Fire)
--   brownout     every `every` s of a fight the lights dip: all enemies stunned (Brownout)
--   wiring       barrels and signs reach twice as far; no damage to you     (Bad Wiring)
--   bounty       one enemy a room is marked: the first kill pays            (Bounty Board)
--   loop         the first enemy to die in a room rises as an ally          (Loop Trap)
--   open         elites come without escorts, bosses start weaker           (Open Channel)
--   overclock    copies of the jinx: extra damage dealt, extra damage taken (Overclock)
--   regen, hp_cap  charge refilled by itself; ceiling on max health         (Red Line)
--   choices, crowd  extra cards in an offer; extra share of enemies         (Crowd Pleaser)
--   debt         double keys, and a point lost at each room's start         (Debt Spiral)
-- The DASH ATTACK (attack during a roll or within 0.15 s after it; data/player.lua attack.dash) is a baton hit, and each baton and roll card says so:
--   Long Reach      its box grows by the one rule (150 x 130 -> 195 x 169), nothing else is scaled           yes
--   Hot Solder, Skim, Tracer, Metronome, Good Solder, Overclock, Adrenal (damage shares, burn, leak)         yes: every enemy it hits, as for a baton hit
--   Backhand        the hit behind is the ordinary baton swing's (hit 1, doubled: 4), the dash attack is the one in front   yes, sane
--   Live Wire, Riot Stock   the third hit's (chain 3): the dash attack is neither, no stun, its knock-back is its own 320   no
--   Shock Wake, Burn Rubber, Afterimage, Phase, Second Wind, Slipstream   work in the roll before it, exactly as they did; the lunge is not a roll (it does not pass through enemies, leaves no fire, is not untouchable); Slipstream's speed still runs after it   as before
-- (A baton hit gives back a third of a pip and the Echo set copies it: both per enemy hit, as for any swing.)
local cards = {
  -- ---------------------------------------------------------------- 1-12: the pool a new player meets
  { id = "live_wire", name = "Live Wire", family = "baton", rarity = "uncommon", tags = { "volt" }, max = 3,
    text = "The third baton hit zaps 2 more enemies near the target for 2 damage.",
    apply = function(run) run.mods.live_wire = run.mods.live_wire + 1 end },
  { id = "long_reach", name = "Long Reach", family = "baton", rarity = "common", tags = {}, max = 3,
    text = "Your baton swings 30% longer and wider.",
    apply = function(run) run.mods.reach = run.mods.reach + 0.3 end },
  { id = "riot_stock", name = "Riot Stock", family = "baton", rarity = "uncommon", tags = {}, max = 3,
    text = "The third hit also stuns for 0.6 seconds and knocks back twice as far.",
    apply = function(run) run.mods.stun = run.mods.stun + 0.6; run.mods.knock = run.mods.knock + 1 end },
  { id = "hot_solder", name = "Hot Solder", family = "baton", rarity = "uncommon", tags = { "burn" }, max = 3,
    text = "Baton hits set enemies alight: 1 damage a second for 3 seconds.",
    apply = function(run) run.mods.burn = run.mods.burn + 1 end },
  { id = "ricochet", name = "Ricochet", family = "sidearm", rarity = "uncommon", tags = {}, max = 3,
    text = "Your shots bounce once off walls.",
    apply = function(run) run.mods.bounces = run.mods.bounces + 1 end },
  -- (slice 3b made Scatter, Second Wind and Capacitor all rare so that a rare existed in the first 12; the design marks only five cards and
  -- the jinxes as rare, so Scatter and Capacitor are common now. Second Wind stays the one rare of the base pool: Mother Coil's rare
  -- guarantee needs one there, and an older test pins which common and uncommon Warm Start picks.)
  { id = "scatter", name = "Scatter", family = "sidearm", rarity = "common", tags = {}, max = 3,
    text = "Fire 3 pellets in a fan, 2 damage each.",
    apply = function(run) run.mods.pellets = run.mods.pellets + 2 end },
  { id = "tracer", name = "Tracer", family = "sidearm", rarity = "uncommon", tags = { "volt" }, max = 3,
    text = "An enemy you shot takes 50% more baton damage for 3 seconds.",
    apply = function(run) run.mods.tracer = run.mods.tracer + 0.5 end },
  { id = "shock_wake", name = "Shock Wake", family = "roll", rarity = "uncommon", tags = { "volt" }, max = 3,
    text = "Rolling through an enemy zaps it for 2, and you pass through it.",
    apply = function(run) run.mods.shock = run.mods.shock + 2 end },
  { id = "second_wind", name = "Second Wind", family = "roll", rarity = "rare", tags = {}, max = 3,
    text = "Two rolls before the wait.",
    apply = function(run) run.mods.rolls = run.mods.rolls + 1 end },
  { id = "plating", name = "Plating", family = "body", rarity = "common", tags = {}, max = 3,
    text = "+2 health points, healed.",
    apply = function(run) run.add_max_hp(2) end },
  { id = "capacitor", name = "Capacitor", family = "body", rarity = "common", tags = {}, max = 3,
    text = "+1 charge pip.",
    apply = function(run) run.add_pips(1) end },
  { id = "deep_pockets", name = "Deep Pockets", family = "body", rarity = "uncommon", tags = { "leak" }, max = 3,
    text = "+25% scrap.",
    apply = function(run) run.mods.scrap = run.mods.scrap + 0.25 end },

  -- ---------------------------------------------------------------- 13-18: Deeper Deck 1 (simple cards, and the first rare)
  { id = "metronome", name = "Metronome", family = "baton", rarity = "uncommon", tags = {}, max = 3,
    text = "Keep the beat. A baton hit within 0.5 s of your last one does +1 damage. Don't stop the music.",
    apply = function(run) run.mods.metro = run.mods.metro + 1 end },
  { id = "slipstream", name = "Slipstream", family = "roll", rarity = "common", tags = {}, max = 2,
    text = "After a roll you move 30% faster for 1.5 s. Gotta go fast. Gotta go damp.",
    apply = function(run) run.mods.slipstream = run.mods.slipstream + 1 end },
  { id = "clot", name = "Clot", family = "body", rarity = "common", tags = {}, max = 3,
    text = "Heal 1 point whenever you clear a room without being hit. Scabs: nature's armour.",
    apply = function(run) run.mods.clot = run.mods.clot + 1 end },
  { id = "skim", name = "Skim", family = "baton", rarity = "common", tags = { "leak" }, max = 3,
    text = "A little off the top: your first hit on a healthy enemy makes it leak 1 scrap for every hit it takes.",
    apply = function(run) run.mods.skim = run.mods.skim + 1 end },
  { id = "incendiary", name = "Incendiary", family = "sidearm", rarity = "uncommon", tags = { "burn" }, max = 3,
    text = "Your shots leave a fire for 2 s that sets enemies alight. It never burns you. The fire is loyal.",
    apply = function(run) run.mods.incendiary = run.mods.incendiary + 1 end },
  { id = "backhand", name = "Backhand", family = "baton", rarity = "rare", tags = {}, max = 1,
    text = "Swing within 0.4 s of a roll (a dash attack too) and you also hit behind you with a baton swing for double damage. Rude. Efficient.",
    apply = function(run) run.mods.backhand = run.mods.backhand + 1 end },

  -- ---------------------------------------------------------------- 19-24: Deeper Deck 2
  { id = "overpressure", name = "Overpressure", family = "sidearm", rarity = "uncommon", tags = {}, max = 3,
    text = "Hold aim for 0.7 s and the shot is a SLUG: 7 damage, through 2 enemies, 2 pips. Patience pays.",
    apply = function(run) run.mods.slug = run.mods.slug + 1 end },
  { id = "afterimage", name = "Afterimage", family = "roll", rarity = "uncommon", tags = { "echo" }, max = 2,
    text = "Your roll leaves a copy for 1.5 s and enemies attack it, not you. It never complains.",
    apply = function(run) run.mods.afterimage = run.mods.afterimage + 1 end },
  { id = "burn_rubber", name = "Burn Rubber", family = "roll", rarity = "uncommon", tags = { "burn" }, max = 1,
    text = "Your roll leaves a trail of fire for 1 s that sets enemies alight. Ignore the smell.",
    apply = function(run) run.mods.rubber = run.mods.rubber + 1 end },
  { id = "adrenal", name = "Adrenal", family = "body", rarity = "uncommon", tags = {}, max = 2,
    text = "Below half health: +25% damage and speed. Panic, but make it a build.",
    apply = function(run) run.mods.adrenal = run.mods.adrenal + 1 end },
  { id = "siphon", name = "Siphon", family = "sidearm", rarity = "uncommon", tags = { "leak" }, max = 1,
    text = "A kill with a shot gives its pips back. Waste not, want not, bleed not.",
    apply = function(run) run.mods.siphon = run.mods.siphon + 1 end },
  { id = "smart_round", name = "Smart Round", family = "sidearm", rarity = "rare", tags = {}, max = 1,
    text = "Shots curve towards the enemy nearest your sight line. The bullet has opinions now.",
    apply = function(run) run.mods.smart = run.mods.smart + 1 end },

  -- ---------------------------------------------------------------- 25-30: Deeper Deck 3 (the district hacks, and Phase)
  { id = "friendly_fire", name = "Friendly Fire", family = "district", rarity = "uncommon", tags = {}, max = 1,
    text = "Enemy cans, bottles and pipe swings hurt the other enemies too. Teamwork!",
    apply = function(run) run.mods.friendly = run.mods.friendly + 1 end },
  { id = "brownout", name = "Brownout", family = "district", rarity = "uncommon", tags = { "volt" }, max = 1,
    text = "Every 20 s of a fight the lights dip and every enemy is stunned for 1 s. Please remain calm.",
    apply = function(run) run.mods.brownout = run.mods.brownout + 1 end },
  { id = "bad_wiring", name = "Bad Wiring", family = "district", rarity = "uncommon", tags = { "burn" }, max = 1,
    text = "Barrels and signs blow twice as wide, and you take no damage from them. Safety is for other people.",
    apply = function(run) run.mods.wiring = run.mods.wiring + 1 end },
  { id = "bounty_board", name = "Bounty Board", family = "district", rarity = "uncommon", tags = { "leak" }, max = 1,
    text = "One enemy a room is marked. Kill it before any other for 15 scrap. Dead or dead.",
    apply = function(run) run.mods.bounty = run.mods.bounty + 1 end },
  { id = "loop_trap", name = "Loop Trap", family = "district", rarity = "uncommon", tags = { "echo" }, max = 1,
    text = "The first enemy to die in each room rises as your ally for 8 s. Recycling!",
    apply = function(run) run.mods.loop = run.mods.loop + 1 end },
  { id = "phase", name = "Phase", family = "roll", rarity = "rare", tags = {}, max = 1,
    text = "A perfect roll (an attack lands in its last 0.1 s) slows the enemies' time for 1 s. Show-off bonus.",
    apply = function(run) run.mods.phase = run.mods.phase + 1 end },

  -- ---------------------------------------------------------------- 31-36: Deeper Deck 4 (two more rares, and the four jinxes)
  { id = "ghost_in_the_shell", name = "Ghost in the Shell", family = "body", rarity = "rare", tags = { "echo" }, max = 1,
    text = "Once a run a killing blow leaves you on 1 point, untouchable for 2 s. LULLABY calls it cheating.",
    apply = function(run) run.mods.ghost = run.mods.ghost + 1 end },
  { id = "open_channel", name = "Open Channel", family = "district", rarity = "rare", tags = {}, max = 1,
    text = "Elites come without their escort; bosses start at 85% health. LULLABY has had a word with the staff.",
    apply = function(run) run.mods.open = run.mods.open + 1 end },
  { id = "overclock", name = "Overclock", family = "jinx", rarity = "rare", jinx = true, tags = {}, max = 1,
    text = "+40% damage dealt. Big numbers! Feel the big numbers!",
    cost = "COST: every hit you take does +1 damage.",
    apply = function(run) run.mods.overclock = run.mods.overclock + 1 end,
    remove = function(run) run.mods.overclock = run.mods.overclock - 1 end },
  { id = "red_line", name = "Red Line", family = "jinx", rarity = "rare", jinx = true, tags = {}, max = 1,
    text = "Your charge refills by itself: a pip every 1.4 s. Pew, pew, pew.",
    cost = "COST: your maximum health becomes 8.",
    apply = function(run) run.mods.regen = run.mods.regen + 1; run.set_hp_cap(8) end,
    remove = function(run) run.mods.regen = run.mods.regen - 1; run.set_hp_cap(nil) end },
  { id = "crowd_pleaser", name = "Crowd Pleaser", family = "jinx", rarity = "rare", jinx = true, tags = {}, max = 1,
    text = "+1 card in every offer, from now on. More choice! More freedom! More everything!",
    cost = "COST: 25% more enemies in every fight.",
    apply = function(run) run.mods.choices = run.mods.choices + 1; run.mods.crowd = run.mods.crowd + 1 end,
    remove = function(run) run.mods.choices = run.mods.choices - 1; run.mods.crowd = run.mods.crowd - 1 end },
  { id = "debt_spiral", name = "Debt Spiral", family = "jinx", rarity = "rare", jinx = true, tags = {}, max = 1,
    text = "Double keys, from every room and the bank, this run. The Spire loves a payment plan.",
    cost = "COST: you lose 1 health point at the start of every room (never the last).",
    apply = function(run) run.mods.debt = run.mods.debt + 1 end,
    remove = function(run) run.mods.debt = run.mods.debt - 1 end },
}

local by_id = {}
for i, c in ipairs(cards) do by_id[c.id] = c; c.index = i end

local M = {
  list = cards,
  by_id = by_id,
  families = {
    -- `icon` is the family's first frame (its common one) in sprites/ui.png: the rarity frames follow (common, uncommon, rare). Every family has its own picture.
    baton = { name = "Baton", icon = 8 }, sidearm = { name = "Sidearm", icon = 11 }, roll = { name = "Roll", icon = 14 }, body = { name = "Body", icon = 17 },
    district = { name = "District", icon = 20 }, jinx = { name = "Jinx", icon = 26 },
  },
  rarity = {
    common = { name = "Common", color = { 255, 255, 255 }, frame = 0 },
    uncommon = { name = "Uncommon", color = { 6, 240, 255 }, frame = 1 },
    rare = { name = "Rare", color = { 255, 43, 214 }, frame = 2 },
  },
  -- shot and fan numbers for the sidearm cards
  fan = 0.22,           -- radians between pellets
  pellet_damage = 2,

  -- the numbers of the new cards (entities read these, never a card's id)
  num = {
    metronome_window = 0.5,       -- seconds between two landed baton hits (the chain's own beat is 0.37 s)
    backhand_window = 0.4,        -- seconds after a roll ends
    backhand_mult = 2,
    slug = { hold = 0.7, cost = 2, damage = 5, per_copy = 2, pierce = 1, scale = 1.8 },   -- damage 5 + 2 a copy (7 at one); pierces copies + 1
    incendiary = { life = 2, per_copy = 1 },
    afterimage = { life = 1.5, per_copy = 0.75 },
    slipstream = { mult = 0.3, time = 1.5 },
    rubber = { life = 1.0, every = 4 },                 -- frames between patches of the trail
    phase = { last = 0.1, time = 1.0, factor = 0.4 },   -- the last 0.1 s of the roll's untouchable time; enemy time runs at 40%
    adrenal = { below = 0.5, share = 0.25 },
    ghost = { hp = 1, blink = 2.0 },
    friendly = { can = 2, swing = 2, bottle = 3 },
    brownout = { every = 20, stun = 1.0, dip = 0.6 },
    wiring = { reach = 2 },
    bounty = { pay = 15 },
    loop = { life = 8, damage = 2, every = 0.7, speed = 150, range = 56 },
    overclock = { share = 0.4, extra = 1 },
    regen = 1 / 1.4,                                    -- pips a second
    crowd = { share = 0.25 },
  },

  -- tags make sets: holding three DIFFERENT cards of one tag (copies of one card count once) switches its bonus on
  set_size = 3,
  sets = {
    volt = { name = "Volt", text = "Lightning arcs twice." },
    burn = { name = "Burn", text = "Burning enemies explode on death: 3 damage within 2 tiles." },
    leak = { name = "Leak", text = "Scrap pickups heal 1 point for every 20 scrap." },
    echo = { name = "Echo", text = "Your afterimage and risen allies copy your baton hits." },
  },
  set_order = { "volt", "burn", "leak", "echo" },
  set_numbers = {
    burn = { radius = 96, damage = 3 },
    leak = { per = 20 },
    volt = { delay = 0.15 },
    echo = { range = 144 },
  },

  -- jinxes: a seeded chance that the last card of an offer is a jinx (never in the first `skip` offers of a run, which also keeps a fresh save
  -- clear of them; they sit at the end of the Deeper Deck order as well)
  jinx = { skip = 2, base = 0.10, per_offer = 0.05, max = 0.40 },
}

-- The frame of sprites/ui.png for a card's family and rarity: the card's picture in its rarity's frame.
function M.frame_of(family, rarity)
  return M.families[family].icon + M.rarity[rarity].frame
end

return M
