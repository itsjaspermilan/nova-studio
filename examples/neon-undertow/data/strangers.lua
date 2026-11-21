-- The strangers of the Gutter Market: room 6, no fight. Each has three sets of lines; the set read is how many times you have met
-- them (lib/meta.lua keeps the count across runs), the third set repeating after that. Then a choice, made with interact.
-- `apply(run)` changes the run; the room puts the health and charge back in the runner afterwards.
-- Tone: pulpy and funny, everyone with a hustle. Patch: deadpan medic, proud of her stitching, has seen you unprinted.
-- Old Sal: feeds everyone, runs the truce like a ledger, gossip queen. Three meetings and they move into the Den (data/den.lua).
return {
  patch = {
    name = "Patch", title = "street medic", sprite = "patch",
    sets = {
      {
        "Hold still. Mm. Nice print. Tight lines. Not mine, but tight.",
        "I had my hands in you before the printer did. Twice. Different hands.",
        "Pick: a little more of you, or all of you back. No refunds on the stitching.",
      },
      {
        "You again. New coat, same face. I'd know those ears anywhere.",
        "Whoever wrote you out left the freckles off. Sloppy. I'd have kept the freckles.",
        "Same menu. I don't do discounts, I do stitches. Pick one.",
      },
      {
        "One serious thing, then I go back to being rude. You came to my table years ago. Cold, bleeding, alone.",
        "You asked me to remember you. I wrote it on my arm. There, under the oil. I cannot read my own handwriting.",
        "Pick one. I'll keep remembering for both of us.",
      },
    },
    choices = {
      { label = "+2 health", note = "Two more health points, healed.", apply = function(run) run.add_max_hp(2) end },
      { label = "Heal to full", note = "Every point back, now.", apply = function(run) run.hp = run.max_hp() end },
    },
    after = "Go on. Keep your head down. It is the only one you've got.",
  },

  old_sal = {
    name = "Old Sal", title = "noodle seller", sprite = "old_sal",
    sets = {
      {
        "Sit! Eat! Rain tastes better in broth. Everything does.",
        "Gangs eat here. Cops eat here. Nobody bleeds on my floor. That is the whole city's secret, honey.",
        "Take a bowl, and for today nobody hits you first. I have connections. Mostly with noodles.",
      },
      {
        "I remember blue sky. Wide as the Spire, wider. You would not believe the colour. I would not either.",
        "Your printer's paperwork came through my stall once, wrapped round a fish. Spire stamp. DEBT. The name was blank. Gossip!",
        "Eat. The first blow is on the house. The second is on you. I am a businesswoman.",
      },
      {
        "The truce is not kindness, runner. It is bookkeeping. I feed every side, so every side owes me dinner.",
        "A girl used to sit on that stool. Extra pepper, no talking. Then she stopped coming, and the Spire started buying my scrap.",
        "Same terms. Eat. And tell the printer she still owes me a bowl.",
      },
    },
    choices = {
      { label = "Take a bowl", note = "The first hit in each room is ignored, for the rest of the run.", apply = function(run) run.perks.truce = true end },
      { label = "Not hungry", note = "Walk on.", apply = function(run) end },
    },
    after = "Mind the puddles. They bite. I have seen it.",
  },
}
