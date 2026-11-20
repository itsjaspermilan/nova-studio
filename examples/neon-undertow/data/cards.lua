-- Every card is data: id, name, family (the icon), rarity (the colour), tags (sets), text (what the player reads), max copies and
-- `apply(run)`, which changes the run's state. Nothing else knows a card by name: entities read `run.mods` (lib/run.lua).
-- The modifiers a card changes:
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
local cards = {
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
  { id = "scatter", name = "Scatter", family = "sidearm", rarity = "common", tags = {}, max = 3,
    text = "Fire 3 pellets in a fan, 2 damage each.",
    apply = function(run) run.mods.pellets = run.mods.pellets + 2 end },
  { id = "tracer", name = "Tracer", family = "sidearm", rarity = "uncommon", tags = { "volt" }, max = 3,
    text = "An enemy you shot takes 50% more baton damage for 3 seconds.",
    apply = function(run) run.mods.tracer = run.mods.tracer + 0.5 end },
  { id = "shock_wake", name = "Shock Wake", family = "roll", rarity = "uncommon", tags = { "volt" }, max = 3,
    text = "Rolling through an enemy zaps it for 2, and you pass through it.",
    apply = function(run) run.mods.shock = run.mods.shock + 2 end },
  { id = "second_wind", name = "Second Wind", family = "roll", rarity = "common", tags = {}, max = 3,
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
}

local by_id = {}
for i, c in ipairs(cards) do by_id[c.id] = c; c.index = i end

return {
  list = cards,
  by_id = by_id,
  families = { baton = { name = "Baton", icon = 0 }, sidearm = { name = "Sidearm", icon = 1 }, roll = { name = "Roll", icon = 2 }, body = { name = "Body", icon = 3 } },
  rarity = {
    common = { name = "Common", color = { 255, 255, 255 }, frame = 0 },
    uncommon = { name = "Uncommon", color = { 6, 240, 255 }, frame = 1 },
    rare = { name = "Rare", color = { 255, 43, 214 }, frame = 2 },
  },
  -- shot and fan numbers for the sidearm cards
  fan = 0.22,           -- radians between pellets
  pellet_damage = 2,
}
