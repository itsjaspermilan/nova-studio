-- How the hero moves: one 60th of a second at a time, from the stick and the jump button, against lib/world.lua. A pure step on a plain table,
-- so that the hero entity and the computer player's look-ahead (lib/bot.lua) move exactly alike.
--
-- Forgiving on purpose: a jump pressed a little before landing still happens (the buffer), a jump a moment after running off a ledge still
-- happens (coyote time), letting go of the button early makes a small hop (variable height), the top of a jump floats a little while the
-- button is held, the air steers almost as well as the ground, and a head that clips the corner of a ledge is slid round it.
local world = require("lib.world")

local hero = {}

local H = {
  run = 270, acc = 2100, dec = 2600, turn = 3800, air_acc = 1500, air_dec = 420,
  ice_acc = 620, ice_dec = 230, ice_turn = 1150,
  jump = 950, jump_run = 0.1, grav_up = 2200, grav = 3400, apex = 0.55, apex_speed = 150, max_fall = 960, cut = 0.42,
  coyote = 0.1, buffer = 0.13, climb = 170,
  spring = 1380, spring_hold = 1540, stomp = 640, stomp_hold = 940,
  w = 34, h = 62, duck_h = 44,
}
hero.H = H

function hero.new(x, y)
  return { x = x, y = y, vx = 0, vy = 0, w = H.w, h = H.h, ground = false, coyote = 0, buffer = 0, rising = false, climbing = false, face = 1,
    duck = false, drop = 0, ev = {}, nev = 0, air = 0 }
end

function hero.copy(b, into)
  into = into or { ev = {} }
  for k, v in pairs(b) do if k ~= "ev" then into[k] = v end end
  into.nev = 0
  return into
end

local function event(b, name, a)
  b.nev = b.nev + 1
  local e = b.ev[b.nev]
  if not e then e = {}; b.ev[b.nev] = e end
  e.name, e.a = name, a
end

local function approach(v, target, rate, dt)
  if v < target then return math.min(target, v + rate * dt) end
  return math.max(target, v - rate * dt)
end

local LADDER, HAZARD, LIQUID = world.LADDER, world.HAZARD, world.LIQUID

local function ladder_at(x, y) return world.flags_at(x, y) & LADDER ~= 0 end

-- inp: { x, y (-1..1), jump (held), jump_pressed }
function hero.step(b, inp, dt)
  b.nev = 0
  local T = world.T
  -- carried by a moving platform
  local gb = b.ground_box
  if b.ground and gb and gb.dx then b.x, b.y = b.x + gb.dx, gb.y0 end

  b.buffer = inp.jump_pressed and H.buffer or math.max(0, b.buffer - dt)
  b.drop = math.max(0, b.drop - dt)

  -- ---- ladders
  local mid = b.y - b.h * 0.5
  if not b.climbing then
    local want_up = inp.y < -0.5 and ladder_at(b.x, mid)
    local want_down = inp.y > 0.5 and b.ground and ladder_at(b.x, b.y + 4)
    if (want_up or want_down) and b.vy >= -200 then
      b.climbing, b.vx, b.vy, b.rising = true, 0, 0, false
      b.x = math.floor(b.x / T) * T + T * 0.5
      if want_down then b.y = b.y + 6 end
    end
  end
  if b.climbing then
    if inp.jump_pressed then
      b.climbing = false
      b.vy, b.rising, b.buffer = -H.jump * 0.82, true, 0
      b.vx = inp.x * H.run * 0.7
      event(b, "jump")
    else
      b.vy = inp.y * H.climb
      b.vx = 0
      local was_y = b.y
      world.move(b, 0, b.vy * dt, true, false, false)
      local on = ladder_at(b.x, b.y - b.h * 0.5) or ladder_at(b.x, b.y - 2)
      if not on then
        b.climbing = false
        if b.vy < 0 then
          -- climbed out of the top: stand on the ladder's top
          local r = math.floor((was_y - 2) / T)
          if world.flags(math.floor(b.x / T), r) & LADDER ~= 0 then b.y = r * T end
          b.vy, b.ground = 0, true
        end
      elseif b.ground and inp.y > 0.5 then
        b.climbing = false
      elseif math.abs(inp.x) > 0.6 and (b.ground or b.hit_y == "down") then
        b.climbing = false
      end
      b.coyote = 0.06
      b.air = 0
      return b
    end
  end

  -- ---- across
  b.duck = b.ground and inp.y > 0.6 and math.abs(inp.x) < 0.5
  local target = b.duck and 0 or inp.x * H.run
  local ice = world.slippery and b.ground
  local rate
  if b.ground then
    if target == 0 then rate = ice and H.ice_dec or H.dec
    elseif b.vx * target < 0 then rate = ice and H.ice_turn or H.turn
    else rate = ice and H.ice_acc or H.acc end
  else
    rate = target == 0 and H.air_dec or H.air_acc
  end
  b.vx = approach(b.vx, target, rate, dt)
  if inp.x > 0.2 then b.face = 1 elseif inp.x < -0.2 then b.face = -1 end

  -- ---- jumping and falling
  b.coyote = b.ground and H.coyote or math.max(0, b.coyote - dt)
  local dropping = false
  if b.buffer > 0 and b.ground and inp.y > 0.6 and b.ground_kind == "platform" then
    -- down and jump on a platform: drop through it
    b.drop, b.buffer, dropping = 0.22, 0, true
  elseif b.buffer > 0 and b.coyote > 0 then
    b.vy = -(H.jump + H.jump_run * math.abs(b.vx))
    b.rising, b.buffer, b.coyote, b.ground = true, 0, 0, false
    event(b, "jump")
  end
  if b.rising and (not inp.jump or b.vy >= 0) then
    if b.vy < 0 then b.vy = b.vy * H.cut end
    b.rising = false
  end
  local g = H.grav
  if b.vy < 0 and inp.jump then g = H.grav_up end
  if inp.jump and math.abs(b.vy) < H.apex_speed and not b.ground then g = g * H.apex end
  b.vy = math.min(H.max_fall, b.vy + g * dt)

  local was_ground = b.ground
  local fall_speed = b.vy
  world.move(b, b.vx * dt, b.vy * dt, b.drop > 0 or dropping, inp.y < 0.5, true)
  if b.hit_x then b.vx = 0 end
  if b.hit_y == "up" then
    b.vy = math.max(b.vy, 40)
    b.rising = false
    event(b, "bump", b.bumped)
  end
  if b.ground then
    if not was_ground then event(b, "land", fall_speed) end
    if b.vy > 0 then b.vy = 0 end
    b.air = 0
    -- what kind of ground: a platform can be dropped through
    local hw = b.w * 0.5
    local f = world.area_flags(b.x - hw, b.y + 1, b.x + hw, b.y + 2)
    b.ground_kind = (f & world.SOLID == 0 and not (b.ground_box and not b.ground_box.oneway)) and "platform" or "solid"
  else
    b.air = b.air + dt
  end

  -- ---- springs
  if b.vy >= 0 then
    local hw = b.w * 0.5
    for _, s in ipairs(world.springs) do
      if b.x + hw > s.x0 and b.x - hw < s.x1 and b.y >= s.y0 and b.y <= s.y1 then
        b.vy = -(inp.jump and H.spring_hold or H.spring)
        b.rising, b.ground = inp.jump, false
        b.y = s.y0
        event(b, "spring", s.owner)
        break
      end
    end
  end

  -- ---- what hurts
  local hw = b.w * 0.5
  local f = world.area_flags(b.x - hw + 5, b.y - b.h + 8, b.x + hw - 5, b.y - 3)
  if f & HAZARD ~= 0 then event(b, "hurt") end
  local feet = world.flags_at(b.x, b.y - 14)
  if feet & LIQUID ~= 0 then event(b, "drown", feet & world.LAVA ~= 0) end
  if b.y > world.height + 140 then event(b, "fall") end
  return b
end

function hero.has(b, name)
  for i = 1, b.nev do if b.ev[i].name == name then return true end end
  return false
end

return hero
