-- What a baton hit or a shot does besides damage, read from the run's modifiers (lib/run.lua). The runner and the shot call these.
-- Nothing here knows a card by name: it reads `Run.mods`, `Run.sets_on` and the numbers in data/cards.lua.
local Run = require("lib.run")
local Status = require("lib.status")
local Blast = require("lib.blast")
local J = require("lib.juice")
local P = require("data.player")
local Cards = require("data.cards")
local N = Cards.num

local H = {}

-- Where the damage being dealt now comes from ("shot" while a shot hits, "ally" while a risen ally hits; nil for the baton, fire and the
-- rest): a Shielded elite and a neon sign only mind shots.
H.from = nil

local CHAIN_RANGE = 144 -- Live Wire jumps to enemies within 3 tiles of the one hit

-- The runner's own clock (it does not run in a hit-stop) and when the last baton hit landed: Metronome's rhythm.
H.clock = 0
H.last_hit = -99
H.ally_kills = 0
H.dip_t = 0                       -- Brownout: the lights are dipped for this long (the HUD darkens the screen)
function H.tick(dt)
  H.clock = H.clock + dt
  if H.dip_t > 0 then H.dip_t = math.max(0, H.dip_t - dt) end
end

-- Is the next baton hit in the rhythm? (Computed once for a swing, so two enemies hit by it get the same answer.)
function H.rhythm()
  return Run.mods.metro > 0 and (H.clock - H.last_hit) <= N.metronome_window
end

local function runner() return nova.first("player") end

-- Is the runner below half health (Adrenal)?
function H.low_health(r)
  r = r or runner()
  return r ~= nil and r.hp ~= nil and r.max_hp ~= nil and r.hp < r.max_hp * N.adrenal.below
end

-- The share of extra damage the run adds to what the runner deals: Good Solder (baton only), Overclock, Adrenal below half health.
function H.damage_share(baton)
  local m = Run.mods
  local s = baton and (m.solder or 0) or 0
  if m.overclock > 0 then s = s + N.overclock.share * m.overclock end
  if m.adrenal > 0 and H.low_health() then s = s + N.adrenal.share * m.adrenal end
  return s
end

-- The damage a baton hit does to `e`: +1 a Metronome copy when it lands in the rhythm, more when a shot marked it (Tracer), then the
-- shares above. The fractions of a point are carried to the next hit, so over many hits the share is exactly what it says.
function H.baton_damage(e, base, rhythm)
  local d = base
  if rhythm and Run.mods.metro > 0 then d = d + Run.mods.metro end
  if (e.mark_t or 0) > 0 and (e.mark_bonus or 0) > 0 then d = math.floor(d * (1 + e.mark_bonus) + 0.5) end
  local s = H.damage_share(true)
  if s > 0 then
    local total = d * (1 + s) + (Run.solder_frac or 0)
    local whole = math.floor(total + 1e-9)
    Run.solder_frac = total - whole
    d = whole
  end
  return d
end

-- The damage of a shot: the same shares (not Good Solder's).
function H.shot_damage(base)
  local s = H.damage_share(false)
  if s <= 0 then return base end
  local total = base * (1 + s) + (Run.shot_frac or 0)
  local whole = math.floor(total + 1e-9)
  Run.shot_frac = total - whole
  return whole
end

-- One lightning arc from (sx, sy) to `e` for `damage`; with the Volt set it arcs again a moment later.
local function arc_once(sx, sy, e, damage, dx, dy)
  if e.state == "dead" or not e:is_alive() then return end
  nova.spawn("zap", sx, sy, { x2 = e.x, y2 = e.y - 30 })
  e:take_hit(damage, dx or 0, dy or 0, 0)
end
function H.arc(sx, sy, e, damage, dx, dy)
  arc_once(sx, sy, e, damage, dx, dy)
  if Run.sets_on.volt then
    nova.spawn("later", 0, 0, { delay = Cards.set_numbers.volt.delay, fn = function() arc_once(sx, sy, e, damage, dx, dy) end })
  end
end

-- Live Wire: lightning from the enemy that was hit to the nearest others, 2 damage each.
function H.live_wire(runner_, target)
  local m = Run.mods.live_wire
  if m <= 0 then return end
  local others = {}
  for _, e in ipairs(nova.all("hurtable")) do
    if e ~= target and not e.prop then
      local d = target:distance_to(e)
      if d <= CHAIN_RANGE then others[#others + 1] = { e = e, d = d } end
    end
  end
  table.sort(others, function(a, b) return a.d < b.d end)
  local hit = 0
  for i = 1, math.min(1 + m, #others) do
    H.arc(target.x, target.y - 30, others[i].e, 2, 0, 0)
    hit = hit + 1
  end
  if hit > 0 then
    nova.sound.play("zap", { volume = P.sfx.zap })
    nova.log("live wire hits " .. hit)
  end
end

-- The Echo set: the afterimage and every risen ally repeat a baton hit of `damage` on the enemy nearest to them.
function H.echo(damage)
  if not Run.sets_on.echo then return end
  local range = Cards.set_numbers.echo.range
  for _, c in ipairs(nova.all("decoy")) do H.echo_from(c, damage, range) end
  for _, c in ipairs(nova.all("ally")) do H.echo_from(c, damage, range) end
end
function H.echo_from(c, damage, range)
  local best, bd = nil, range
  for _, e in ipairs(nova.all("enemy")) do
    if e.state ~= "dead" then
      local d = c:distance_to(e)
      if d <= bd then best, bd = e, d end
    end
  end
  if not best then return end
  nova.spawn("zap", c.x, c.y - 30, { x2 = best.x, y2 = best.y - 30, color = { 255, 43, 214 } })
  H.echo_hits = (H.echo_hits or 0) + 1
  local was = H.from
  H.from = "echo"
  best:take_hit(damage, 0, 0, 0)
  H.from = was
  nova.log("echo copies the baton hit: " .. damage)
end

-- A bit of scrap pops out of `e` (Skim).
local function drop_scrap(e, n)
  for i = 1, n do
    local a = math.random() * math.pi * 2
    nova.spawn("scrap", e.x, e.y - 6, { pvx = math.cos(a) * 150, pvy = math.sin(a) * 110 })
  end
  nova.log(string.format("%s leaks %d scrap", e.kind_name or "enemy", n))
end

-- Skim: the enemy leaks. Every hit it takes from now on drops `n` scrap (the hit that started it did too).
function H.leak(e, n)
  if e.leaky then e.leaky = math.max(e.leaky, n); return end
  e.leaky = n
  local take_hit = e.take_hit
  e.take_hit = function(self, damage, dx, dy, knock)
    local took = take_hit(self, damage, dx, dy, knock)
    if took and self.leaky then drop_scrap(self, self.leaky) end
    return took
  end
  drop_scrap(e, n)
end

-- After a baton hit landed on `target` (chain: 1, 2 or 3 in the combo; `fresh`: it was at full health before the hit; `damage` dealt).
function H.after_baton(runner_, target, chain, knocked, fresh, damage)
  H.echo(damage or 0)
  if not target:is_alive() then
    if chain == 3 then H.live_wire(runner_, target) end
    return
  end
  local m = Run.mods
  if m.burn > 0 then Status.burn(target, 3, m.burn) end
  if m.skim > 0 and fresh then H.leak(target, m.skim) end
  if chain == 3 then
    if m.stun > 0 then
      Status.stun(target, m.stun)
      nova.sound.play("stun", { volume = P.sfx.stun })
      nova.log("riot stock stuns " .. (target.kind_name or "target") .. " for " .. m.stun)
    end
    H.live_wire(runner_, target)
  end
end

-- After a shot hit `target`.
function H.after_shot(target)
  if Run.mods.tracer > 0 and target:is_alive() then Status.mark(target, 3, Run.mods.tracer) end
end

-- A shot killed something: Siphon gives the pips it cost back.
function H.shot_kill(shot)
  if Run.mods.siphon <= 0 then return end
  local r = runner()
  if r and r.charge then
    r.charge = math.min(r.max_charge, r.charge + (shot.cost or 1))
    nova.log(string.format("siphon refunds %s pip(s)", tostring(shot.cost or 1)))
    nova.spawn("fx", r.x, r.y - 40, { sprite = "fx_spark", anim = "spark", scale = 2 })
  end
end

-- An enemy has just died (called from its `die`): a Bounty Board mark pays if it was the room's first kill; Loop Trap raises the room's first
-- kill as an ally; the Burn set blows up a burning corpse; a risen ally's kills are counted.
function H.on_death(e)
  if not e.kind_name or e.counted_dead then return end
  e.counted_dead = true
  Run.room_kills = Run.room_kills + 1
  local first = Run.room_kills == 1
  local m = Run.mods
  if H.from == "ally" then H.ally_kills = H.ally_kills + 1 end
  if e.bounty then
    if first then
      J.scrap = J.scrap + e.bounty
      Run.scrap = J.scrap
      nova.sound.play("bounty_pay", { volume = P.sfx.bounty_pay })
      nova.spawn("fx", e.x, e.y - 40, { sprite = "fx_burst", anim = "burst", scale = 3 })
      Run.bounty_paid = (Run.bounty_paid or 0) + e.bounty
      nova.log(string.format("bounty paid: %d scrap (the first kill of the room)", e.bounty))
    else
      nova.log("bounty lost: it was not the first kill")
    end
  end
  if m.loop > 0 and first then
    nova.spawn("ally", e.x, e.y, { sprite = e.kind_name, life = N.loop.life })
    nova.sound.play("ally_rise", { volume = P.sfx.ally_rise })
    nova.log("loop trap: " .. e.kind_name .. " rises as an ally")
  end
  if Run.sets_on.burn and (e.burn_t or 0) > 0 then
    local b = Cards.set_numbers.burn
    nova.log("burn set: a burning " .. e.kind_name .. " explodes")
    Blast.at(e.x, e.y, { radius = b.radius, runner = 0, enemy = b.damage, prop = b.damage }, e)
  end
end

-- Scrap was picked up (`n` whole units): the Leak set heals 1 point for every 20.
function H.after_scrap(n)
  if not Run.sets_on.leak or n <= 0 then return end
  local per = Cards.set_numbers.leak.per
  Run.leak_acc = Run.leak_acc + n
  while Run.leak_acc >= per do
    local r = runner()
    if r and r.hp < r.max_hp then
      Run.leak_acc = Run.leak_acc - per
      r.hp = r.hp + 1
      Run.hp = r.hp
      nova.spawn("fx", r.x, r.y - 44, { sprite = "fx_spark", anim = "spark", scale = 2 })
      nova.log("leak set heals 1 point (health " .. r.hp .. ")")
    else
      Run.leak_acc = per       -- (at full health the next point waits; it is not hoarded)
      break
    end
  end
end

return H
