-- Elites: a normal enemy at `size` times the size and `health` times the health, with one mark. Numbers for each mark here.
return {
  size = 2,
  health = 2,
  order = { "shielded", "splitting", "magnetic", "volatile", "linked" },
  marks = {
    shielded = { name = "Shielded", text = "Shots from the front do nothing. Use the baton, or get behind it." },
    splitting = { name = "Splitting", text = "Two small ones when it dies.", count = 2, size = 0.7, health = 0.5, spread = 56 },
    magnetic = { name = "Magnetic", text = "Pulls your shots towards it, and you a little.",
      shot_range = 360, shot_pull = 7, runner_range = 480, runner_pull = 45, gap = 110 },
    volatile = { name = "Volatile", text = "Explodes one second after it dies.", fuse = 1.0, radius = 96, runner = 3, enemy = 4 },
    linked = { name = "Linked", text = "Heals 2 a second while its partner lives.", heal = 2, partner_after = 0.3 },
  },
  -- enemies that can be an elite (the seed picks)
  kinds = { "scrapper", "bottle_thrower" },
}
