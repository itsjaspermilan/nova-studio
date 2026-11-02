-- Shared game state. require() returns the same table everywhere, so this is a simple
-- place for things that outlive a scene. The best score is kept between runs with nova.save.
local state = { score = 0, best = nova.save.get("best", 0), lives = 3 }

-- Call when a score might be a new best; it is written to the save file right away.
function state.submit_score()
  if state.score > state.best then
    state.best = state.score
    nova.save.set("best", state.best)
  end
end

return state
