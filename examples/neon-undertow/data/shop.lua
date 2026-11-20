-- The walk-through room's shop and bank (scrap, health points, keys).
return {
  heal = { price = 20, points = 4, name = "Patch-up", text = "Heal 4 points" },
  reroll = { price = 15, name = "Reroll", text = "Reroll the next card offer" },
  jinx = { price = 30, name = "Jinx removal", text = "Remove a jinx", shut = "Shut: no jinxes yet." },
  bank = { rate = 4, name = "The bank", text = "Turn scrap into keys, 4 to 1" },
}
