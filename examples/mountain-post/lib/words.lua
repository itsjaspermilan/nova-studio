-- Every word the slice says, exactly as the agreed spec has them (docs/games/mountain-post.md, "Slice spec"). The tests check
-- them against the spec (crates/nova-runtime/tests/mountain_post.rs), so change them there first.
local words = {}

words.title = "Fernhollow Post"
words.press = "Start" -- (on the title, beside the A button's cap)

-- The labels: name and street, nothing else.
words.labels = {
  letter = "The Postmaster, Post Road",
  hazel = "Hazel Brock, 3 Fern Lane",
  pip = "Pip Tansy, 7 Kettle Creek Road",
}

-- The Mayor's letter (a heron, Odette Marsh, unseen in the slice).
words.letter = {
  "Welcome to Fernhollow. The post office is yours, such as it is. Mr. Pemberton left two winters ago and nobody has had a letter since. Take your time. We have waited this long.",
  "P.S. The van pulls a little to the left. So did Mr. Pemberton.",
}
words.letter_from = "Odette Marsh, Mayor"

-- The talks are short (the owner's seventh play: "Too much text", "pacing", "tone of the words"): three lines when a parcel is handed
-- over, one when talked to again, one at the door without it. The braces are the engine's text markup (nova.ui.rich_text): {wave}
-- letters bob, {big} larger and bolder, {shake} jitter, {slow} typed slowly, {pop} letters pop in, {pause=s} a wait. Used where a
-- line has a feeling to carry, not on every line.
words.people = {
  hazel = {
    name = "Hazel",
    given = {
      "Hm. So there {slow}IS{/slow} a postmaster.",
      "My chisels. Ordered them the winter Pemberton shut up shop and the lake bridge went.",
      "I'd fix that bridge, if the Mayor and I were speaking. We're not.{pause=0.3} {slow}...{/slow}Thank you.",
    },
    after = {
      "Still here? Mind my wall on Fern Lane. Everybody clips it.",
      "Tell Pip his aerial {shake}hums{/shake} through my teeth.",
    },
    without = "Unless that's my chisels, I'm busy.",
    -- the face for each line (lib/face.lua): gruff, a flicker of sadness for Pemberton, a small smile at the end
    faces = { given = { "gruff", "sad", "smile" }, after = { "dry", "gruff" }, without = "gruff" },
  },
  pip = {
    name = "Pip",
    given = {
      "{big}{wave}IT CAME!{/wave}{/big} It actually came! You're {pop}real!{/pop}",
      "A whole year I told the radio the mail was coming back. Nobody believed me!",
      "This valve gets Fernhollow Radio past the creek. The lake side too, once there's a bridge!",
    },
    after = {
      "Tonight I say your name on the radio. {shake}Live.{/shake} No pressure!",
      "If Hazel asks, the aerial {wave}sings{/wave}. It does {big}not{/big} hum.",
    },
    without = "Is it here? Is it?{pause=0.3} ...Oh. Hello anyway!",
    -- delighted and wide-eyed; indignant that nobody believed him, and about the aerial; a gulp at going live
    faces = { given = { "delighted", "indignant", "happy" }, after = { "surprised", "indignant" }, without = "surprised" },
  },
}

words.ending = "Two delivered. A few hundred to go."

-- The few words of the controls' hints (beside a button glyph), and the pause menu.
words.hint = {
  take = "Take", read = "Read", talk = "Talk", give = "Hand over", knock = "Knock", get_in = "Get in", get_out = "Get out",
  map = "Map", close = "Close", next = "Next", put_back = "Put back", go_in = "Go in", go_out = "Go out",
  load = "Load package", load_at_back = "Load it at the back", choose = "Choose",
}
-- the small tip floating over a parcel (or the letter) that can be taken (lib/ui.lua ui.tip)
words.tip = { letter = "Letter from the Mayor" }
-- the panel floating over the van's open back doors (lib/ui.lua ui.van_panel)
words.van = { tag = "Van", empty = "The van is empty", full = "The van is full" }
words.pause = { title = "Paused", resume = "Resume", quit = "Quit" }
-- the card in the corner: where the parcel it shows is
words.card = { hands = "carrying", van = "in the van" }
-- on the strip over the label held up to read
words.parcel = "Parcel"

return words
