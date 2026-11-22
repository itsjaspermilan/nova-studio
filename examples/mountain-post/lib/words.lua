-- Every word the slice says, exactly as the agreed spec has them (docs/games/mountain-post.md, "Slice spec"). The tests check
-- them against the spec (crates/nova-runtime/tests/mountain_post.rs), so change them there first.
local words = {}

words.title = "Fernhollow Post"
words.press = "Press A"

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

words.people = {
  hazel = {
    name = "Hazel",
    given = {
      "Hm. So there IS a postmaster.",
      "Chisels. I ordered these two winters back. Built a whole porch without them.",
      "Pemberton never lost a parcel in forty years, then one morning he just didn't open up. Same winter the lake bridge went.",
      "I'd have rebuilt that bridge myself, if the Mayor and I were speaking. We're not. Don't ask.",
      "...Thank you. Mind the left on Fern Lane. Everybody clips my wall.",
    },
    after = {
      "Still here? The wall's fine. Mostly.",
      "If you see Pip, tell him his aerial hums through my teeth.",
    },
    without = "Unless that's my chisels, I'm busy.",
    -- the face for each line (lib/face.lua): gruff, then dry, a flicker of sadness for Pemberton, gruff again, a small smile at the end
    faces = { given = { "gruff", "neutral", "sad", "gruff", "smile" }, after = { "neutral", "gruff" }, without = "gruff" },
  },
  pip = {
    name = "Pip",
    given = {
      "IT CAME! It actually came! You're real!",
      "I've been telling everyone on the radio the mail's coming back. Every morning. For a year. Nobody believed me!",
      "This valve means Fernhollow Radio can reach past the creek again. Maybe even the lake side, when there's a bridge.",
      "Hazel says my aerial hums. It does not hum. It SINGS.",
      "Tune in tonight. I'm going to say your name. What IS your name? Never mind, I'll say 'the Postmaster'. Sounds grander.",
    },
    after = {
      "Testing, testing. Can you hear that? No? Good, it's not plugged in yet.",
      "If Hazel asks, the aerial is staying.",
    },
    without = "Is it here? Is it? ...Oh. Hello anyway!",
    -- delighted and wide-eyed throughout; indignant about the aerial
    faces = { given = { "delighted", "delighted", "happy", "indignant", "delighted" }, after = { "happy", "indignant" }, without = "surprised" },
  },
}

words.ending = "Two delivered. A few hundred to go."

-- The few words of the controls' hints (beside a button glyph), and the pause menu.
words.hint = {
  take = "Take", read = "Read", talk = "Talk", give = "Hand over", knock = "Knock", get_in = "Get in", get_out = "Get out",
  map = "Map", close = "Close", next = "Next", put_back = "Put back", go_in = "Go in", go_out = "Go out",
}
words.pause = { title = "Paused", resume = "Resume", quit = "Quit" }

return words
