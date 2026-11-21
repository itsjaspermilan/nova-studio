-- The Workbench: ten permanent upgrades bought with keys (the bank turns scrap into keys 4 to 1). `costs` has one key price per tier;
-- `per` is what each tier is worth (read by lib/workbench.lua, nowhere else); `text` is the sales pitch in LULLABY's voice and `tier_text`
-- says exactly what the tier you would buy does. `locked` means it cannot be bought yet, and says why.
return {
  deck_base = 12,        -- a new player's card pool; Deeper Deck adds `deck_step` per tier
  deck_step = 6,
  list = {
    { id = "thicker_print", name = "Thicker Print", costs = { 12, 24, 40 }, per = { hp = 1 },
      text = "More ink in the print. Don't tell me where it comes from.",
      tier_text = { "13 health points", "14 health points", "15 health points" } },
    { id = "warm_start", name = "Warm Start", costs = { 14, 36, 70 },
      text = "I pre-heat the print with a card. Like a toaster, but it costs me.",
      tier_text = { "start with a common card", "plus an uncommon card", "plus a card you choose" } },
    { id = "good_solder", name = "Good Solder", costs = { 15, 40, 80 }, per = { share = 0.05 },
      text = "I re-tin your baton. It was held together with spite.",
      tier_text = { "+5% baton damage", "+10% baton damage", "+15% baton damage" } },
    { id = "bigger_magazine", name = "Bigger Magazine", costs = { 18, 50 }, per = { pips = 1 },
      text = "Another pip of charge. Do not point it at me.",
      tier_text = { "4 charge pips", "5 charge pips" } },
    { id = "loose_change", name = "Loose Change", costs = { 10, 30, 60 }, per = { share = 0.10 },
      text = "I go through your pockets while you are dead. For your own good.",
      tier_text = { "keep 10% of unbanked scrap as keys", "keep 20% of unbanked scrap as keys", "keep 30% of unbanked scrap as keys" } },
    { id = "familiar_streets", name = "Familiar Streets", costs = { 24, 50, 90 }, per = { rerolls = 1 },
      text = "You've seen these cards. Shuffle them. They won't mind.",
      tier_text = { "1 card reroll a run", "2 card rerolls a run", "3 card rerolls a run" } },
    { id = "fast_print", name = "Fast Print", costs = { 150 }, locked = "after the second district",
      text = "Skip the queue. There is no queue. I just like the sound of it.",
      tier_text = { "start from a checkpoint with 2 cards per district skipped" } },
    { id = "lullaby_eye", name = "LULLABY's Eye", costs = { 12, 40 },
      text = "I peek through the next door for you. Yes, I can see through doors. No, don't ask.",
      tier_text = { "see the next room's kind", "and the elite's mark" } },
    { id = "deeper_deck", name = "Deeper Deck", costs = { 20, 45, 80, 130 },
      text = "Six more cards a tier. The warehouse finished unpacking. Mostly. Some of it is ticking.",
      tier_text = { "+6 cards in the pool (18 of 36)", "+12 cards in the pool (24 of 36)", "+18 cards in the pool (30 of 36)", "+24 cards in the pool (all 36, jinxes too)" } },
    { id = "second_chance", name = "Second Chance", costs = { 70 },
      text = "I reprint you mid-death. It is as undignified as it sounds.",
      tier_text = { "once a run, a killing blow leaves you on half health" } },
  },
}
