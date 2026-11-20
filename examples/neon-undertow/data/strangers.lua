-- The strangers of the Gutter Market: room 6, no fight. Each has three sets of lines; the set read is how many times you have met
-- them (lib/meta.lua keeps the count across runs), the third set repeating after that. Then a choice, made with interact.
-- `apply(run)` changes the run; the room puts the health and charge back in the runner afterwards.
return {
  patch = {
    name = "Patch", title = "street medic", sprite = "patch",
    sets = {
      {
        "Hold still. Mm. Nice print. Tight lines.",
        "Don't look so surprised. I had my hands in you before the printer did.",
        "Pick one: a little more of you, or all of you back.",
      },
      {
        "You again. New coat. Same face. I'd know it anywhere.",
        "Funny thing: whoever wrote you out left the freckles off. I'd have kept the freckles.",
        "Same offer. I don't do discounts, I do stitches.",
      },
      {
        "One thing, and then I say nothing. You came to my table years back, cold and bleeding, alone.",
        "You asked me to remember you. So I wrote it on my arm. There, under the oil. I can't read my own handwriting.",
        "Sew yourself up. I'll keep remembering for you.",
      },
    },
    choices = {
      { label = "+2 health", note = "Two more health points, healed.", apply = function(run) run.add_max_hp(2) end },
      { label = "Heal to full", note = "Every point back, now.", apply = function(run) run.hp = run.max_hp() end },
    },
    after = "Go on. Keep your head down.",
  },

  old_sal = {
    name = "Old Sal", title = "noodle seller", sprite = "old_sal",
    sets = {
      {
        "Sit. Eat. Rain tastes better in broth.",
        "Gangs eat here. Cops eat here. Nobody bleeds on my floor. That is the whole city's secret, runner.",
        "Take a bowl, and for today nobody hits you first.",
      },
      {
        "I remember blue sky. Wide as the Spire, wider. You would not believe the colour.",
        "Your printer's paperwork came through my stall once, wrapped round a fish. Spire stamp. DEBT, it said. The name was blank.",
        "Eat. The first blow is on the house.",
      },
      {
        "The truce is not kindness, runner. It is bookkeeping. I feed every side so every side owes me a dinner.",
        "A girl used to sit on that stool. Extra pepper, no talking. Then she stopped coming, and the Spire started buying my scrap.",
        "Same terms. Eat.",
      },
    },
    choices = {
      { label = "Take a bowl", note = "The first hit in each room is ignored, for the rest of the run.", apply = function(run) run.perks.truce = true end },
      { label = "Not hungry", note = "Walk on.", apply = function(run) end },
    },
    after = "Mind the puddles. They bite.",
  },
}
