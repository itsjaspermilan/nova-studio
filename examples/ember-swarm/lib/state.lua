-- What the run remembers. Plain numbers; the upgrades change them.
local state = {}

function state.new_run()
  state.hp, state.max_hp = 100, 100
  state.xp, state.level = 0, 1
  state.kills, state.time = 0, 0
  state.fire_rate = 3.0       -- shots a second
  state.damage = 1
  state.shots = 1             -- bullets a shot
  state.speed = 7             -- metres a second
  state.magnet = 4            -- how far gems are pulled from
  state.choosing = nil        -- the three upgrades on offer while the game waits
  state.view = "third"        -- "third" or "first"
  state.god = false           -- bench mode: nobody dies, the enemy count is held
  state.target = nil          -- bench mode: how many enemies to keep alive
end

function state.need() return 4 + state.level * 3 end

state.new_run()
return state
