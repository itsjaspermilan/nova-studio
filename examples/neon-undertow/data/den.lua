-- The Den: LULLABY's lines, the screen, the strangers who moved in, the stalls. All the words are here: edit them freely.
-- LULLABY is sarcastic, overworked and secretly fond of you. She is also forgetting things; that is one line in eight, on purpose.
local T = 48
return {
  tile = T,
  reach = 110,           -- how near the runner stands to use a thing
  wake = 2.6,            -- seconds of the "printed again" beat (the runner is on the bed, the line shows)
  moved_in_needed = 3,   -- meetings before a stranger moves in
  -- how big each thing in the Den is drawn and how much of it is solid (world units): the pictures are stretched to these
  sizes = {
    bed = { w = 156, h = 84, solid = false }, screen = { w = 108, h = 108, solid = true },
    bench = { w = 192, h = 96, solid = true }, door = { w = 72, h = 144, solid = false },
    stall = { w = 144, h = 96, solid = true }, codex = { w = 84, h = 96, solid = true },
  },

  -- the line shown while you wake on the bed: by what brought you here ("first" the first boot, "dead" after a death, "win" after a win).
  -- They are read in order; the last stretch repeats. The sad ones are the 4th of death, the 3rd of first and the 5th of win.
  wake_lines = {
    first = {
      "Oh, it worked. Don't thank me. Thank the loose wire.",
      "Welcome to your third kidney. I mean life. I'm still sorting the paperwork.",
      "You had a name once. I wrote it down somewhere. Somewhere. ...Anyway. Hi.",
      "Walk to the door. Door is the rectangle. We are going to need a talk about rectangles.",
    },
    dead = {
      "That's the fourth you this week. Do you know what toner goes for down here?",
      "You died to a SCRAPPER. With a PIPE. I had to print the shame too.",
      "Welcome back! You've got your face on upside down. Kidding. Mostly.",
      "I had a word for what you do to my reputation. It'll come back. It always comes back. Doesn't it?",
      "Good news: you're alive. Bad news: it was my last good print head.",
      "I told the Spire you were durable. I have been proven a liar. Again.",
      "Hot take: walking into the pipe is not a strategy.",
      "Print queue is empty, so you're up. Lucky you. Lucky me. Lucky toner.",
      "Hold still. No, the other still. There. You are 94% you.",
      "Another one! I'm starting a loyalty card. Ten deaths, the eleventh is a refund. (There are no refunds.)",
    },
    win = {
      "You BEAT her? I had money on the crane. Don't look at me like that.",
      "Look at you, a hero. Brag quietly, the neighbours can hear.",
      "Mother Coil sends her regards. By which I mean a bill for the arm.",
      "Don't get used to winning. I'm not made for this. I think I was made for something. I'll remember.",
      "Fine, you're good. Did you eat? Eat something. Not the noodles, they are older than you.",
      "Walk it off. The victory, not the injuries. Those too, but quietly.",
      "The Bloom Labs are next. Bring a hat. And a spare lung.",
    },
  },

  -- the cracked screen: what she says when you talk to her, by how things stand (the first set whose test holds, top to bottom)
  screen = {
    { when = "fresh", lines = {
      "Welcome to the Den. It is wet. The wet is a feature.",
      "The Workbench lets you spend keys. Keys come from scrap. Scrap comes from violence. It's a circle.",
      "Door's there when you're ready. Not your mother, I'm a printer. Tip: roll, then swing. That's a dash attack. It hits like a bus.",
    } },
    { when = "won", lines = {
      "One district down. Three to go. I've drafted your eulogy. It's short.",
      "The Spire owns your debt, you know. I read the fine print. It was LARGE print, actually. In red.",
      "You're good at this. I mean it. I forgot to say that, so I'm saying it now.",
    } },
    { when = "veteran", lines = {
      "You've died here more than anyone. Congratulations. It's an honour I just invented.",
      "Every time I print you something goes missing. I don't know what. That's how you know it was important.",
      "Don't give me that look. You don't have a face. I've seen the blueprints.",
    } },
    { when = "default", lines = {
      "Back so soon? The floor is still wet. I didn't move.",
      "Try the Workbench. Spending keys is the only joy I get.",
      "I don't need a hug. I need a better power supply. Both are impossible.",
    } },
  },

  -- the strangers who move in, and what they do in the Den; `den_lines` repeat in order
  movers = {
    patch = {
      name = "Patch", sprite = "patch",
      perk = "free +2 health at the start of every run",
      note = "Patch moved in. She stitched a wall of your old scabs to the corkboard. It is very proud.",
      den_lines = {
        "Sit. Good. I have a spare arm for that, don't squirm.",
        "I count my stitches the way Sal counts coins. Obsessively and with a grudge.",
        "I put +2 on you before you go. You're welcome. I'd say 'be careful', but you've seen yourself.",
      },
    },
    old_sal = {
      name = "Old Sal", sprite = "old_sal",
      perk = "a bowl before you go: the first hit of the first room is ignored",
      note = "Old Sal moved in and set up a stove. The Den now smells like a lie that tastes fantastic.",
      den_lines = {
        "Eat first. Fight after. The truce goes down easier with broth.",
        "Rumour: the Spire's chef eats my noodles in secret. I put extra pepper in his.",
        "One bowl, one free hit. The second hit is on you. Business is business.",
      },
    },
  },

  -- empty stalls with name plates (the strangers who can move in later; `later` ones need a district that is not built yet)
  stalls = {
    { id = "patch", name = "PATCH", sub = "street medic" },
    { id = "old_sal", name = "OLD SAL", sub = "noodle seller" },
    { id = "wren", name = "WREN", sub = "courier", later = true },
    { id = "koss", name = "DR. KOSS", sub = "scientist", later = true },
    { id = "null", name = "BROTHER NULL", sub = "preacher", later = true },
  },
}
