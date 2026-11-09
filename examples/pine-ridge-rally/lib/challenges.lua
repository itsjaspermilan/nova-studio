-- Speed traps and drift zones in free roam (entities/speed_trap.lua, entities/drift_zone.lua; placed by scripts/rally/roam.ts).
-- A speed trap reads the car's speed as it crosses the strip; a drift zone adds up the sliding between its two strips, if the car drives
-- it from one end to the other. Each has three stars; every star won for the first time pays STAR_COINS. The best of each is saved
-- ("trap_<road>" in km/h, "drift_<road>" in points). `challenges.update` is called each frame with where the car is on the roads.
local state = require("lib.state")
local audio = require("lib.audio")

local challenges = {}

local STAR_COINS = 100
local TRAP_STARS = { 120, 140, 160 }      -- km/h
local DRIFT_STARS = { 1.5, 3, 5 }         -- points a metre of the zone
local DRIFT_SLIP, DRIFT_SPEED = 0.35, 8   -- sliding at least this much (0 to 1) and this fast (m/s) scores

local traps, zones                        -- by road
local last                                -- { route, s } of the frame before
challenges.drift = nil                    -- the zone being driven: { zone, score, from, stars }
challenges.popup = nil                    -- what was just won: { title, big, line, stars, t }

local function index()
  traps, zones = {}, {}
  for _, t in ipairs(nova.all("speed_trap")) do
    traps[t.route] = traps[t.route] or {}
    table.insert(traps[t.route], t)
  end
  for _, z in ipairs(nova.all("drift_zone")) do
    zones[z.route] = zones[z.route] or {}
    table.insert(zones[z.route], z)
  end
end

local function stars_of(value, steps) local n = 0; for i, v in ipairs(steps) do if value >= v then n = i end end; return n end

local function won(kind, key, value, steps, title, big)
  local best = nova.save.get(key, nil)
  local before = best and stars_of(best, steps) or 0
  local now = stars_of(value, steps)
  local pay = math.max(0, now - before) * STAR_COINS
  if not best or value > best then nova.save.set(key, value) end
  if pay > 0 then state.add_coins(pay) end
  local line = best and ("Best " .. (value > best and "was " or "") .. math.floor(best + 0.5)) or "First time"
  if pay > 0 then line = line .. "   +" .. state.money(pay) end
  challenges.popup = { title = title, big = big, line = line, stars = now, t = 0 }
  audio.sfx(now > 0 and "menu_accept" or "menu_move")
  nova.log(string.format("roam: %s %s %d (%d stars, %d coins)", kind, key, math.floor(value + 0.5), now, pay))
end

function challenges.clear() traps, zones, last, challenges.drift, challenges.popup = nil, nil, nil, nil, nil end

--- `car` the player's car, `n` the nearest road (lib/roads.lua's `nearest`, or nil).
function challenges.update(car, n, dt)
  if not traps then index() end
  local p = challenges.popup
  if p then p.t = p.t + dt; if p.t > 4.5 then challenges.popup = nil end end
  if not n then last = nil; challenges.drift = nil; return end
  local route, s = n.route, n.s
  local on = n.dist < n.w + 4
  -- the traps on this road the car has just crossed
  if last and last.route == route and on and math.abs(s - last.s) < 40 then
    for _, t in ipairs(traps[route] or {}) do
      if (last.s - t.s) * (s - t.s) <= 0 and last.s ~= s then
        local kmh = math.abs(car.speed) * 3.6
        won("speed trap", "trap_" .. route, kmh, TRAP_STARS, "SPEED TRAP", string.format("%d km/h", math.floor(kmh + 0.5)))
      end
    end
  end
  -- the drift zone: in it from one end, scored, until out of the other end (or off the side or back out the way in: nothing)
  local d = challenges.drift
  if d then
    local z = d.zone
    if route ~= z.route or n.dist > n.w + 8 then
      challenges.drift = nil
    elseif s < z.s or s > z.s2 then
      local out_far = (d.from == "s" and s > z.s2) or (d.from == "s2" and s < z.s)
      challenges.drift = nil
      if out_far then
        local steps = {}
        for i, k in ipairs(DRIFT_STARS) do steps[i] = math.floor(k * (z.s2 - z.s) / 50 + 0.5) * 50 end
        won("drift zone", "drift_" .. route, d.score, steps, "DRIFT ZONE", string.format("%d", math.floor(d.score + 0.5)))
      end
    else
      if car.slip > DRIFT_SLIP and math.abs(car.speed) > DRIFT_SPEED then d.score = d.score + car.slip * math.abs(car.speed) * dt * 10 end
    end
  elseif last and last.route == route and on then
    for _, z in ipairs(zones[route] or {}) do
      local into = (last.s < z.s and s >= z.s and "s") or (last.s > z.s2 and s <= z.s2 and "s2")
      if into then
        local steps = {}
        for i, k in ipairs(DRIFT_STARS) do steps[i] = math.floor(k * (z.s2 - z.s) / 50 + 0.5) * 50 end
        challenges.drift = { zone = z, score = 0, from = into, steps = steps, best = nova.save.get("drift_" .. route, nil) }
        audio.sfx("menu_move")
        nova.log("roam: into drift zone on " .. route)
        break
      end
    end
  end
  last = last or {}
  last.route, last.s = route, s
end

challenges.stars_of = stars_of
return challenges
