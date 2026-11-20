-- What outlives a run: the save stub. The next slice writes this table to disk (nova.save) and reads it back at start; until then it
-- lives as long as the game does. Plain numbers and tables only, so it can be saved as it is.
-- `keys` is the permanent money (scrap banked 4 to 1), `met` counts the meetings with each stranger (their lines advance by it).
local Meta = {
  keys = 0,
  met = { patch = 0, old_sal = 0 },
  runs = 0,        -- runs begun
  wins = 0,        -- runs that got to the boss door
}
return Meta
