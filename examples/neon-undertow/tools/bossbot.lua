-- The test player's eyes for the Mother Coil fight (inlined into the routes by tools/routes.mjs). A route calls BRAIN() between its `walk_to`
-- steps: it looks at what is dangerous RIGHT NOW (a car shadow, the magnet's locked ring, a lit lane, a Rat-drone's charge lane), scores the places
-- within reach, and moves the `spot` entity to the best one. MODE says what to do there: 'strike' (the drum is open and he stands at her cab:
-- swing) or 'dodge'. It uses only what a person sees on the screen; it is as good as the tells let it be.
BOSS = nova.named('coil'); RUNNER = nova.named('runner')
SPOT = nova.spawn('spot', RUNNER.x, RUNNER.y)
MODE = 'dodge'; HITS = 0; STRIKES = 0
local function dist(ax, ay, bx, by) return math.sqrt((ax - bx) ^ 2 + (ay - by) ^ 2) end
local function seg_dist(px, py, x1, y1, x2, y2)
  local dx, dy = x2 - x1, y2 - y1
  local l2 = dx * dx + dy * dy
  local t = l2 > 0 and math.max(0, math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2)) or 0
  return dist(px, py, x1 + t * dx, y1 + t * dy)
end
function DANGER(x, y)
  local d = 0
  for _, c in ipairs(nova.all('coil_car')) do if c.started and dist(x, y, c.x, c.y) < 72 + 16 then d = d + 1000 end end
  for _, m in ipairs(nova.all('coil_magnet')) do
    if m.state == 'lock' and dist(x, y, m.x, m.y) < 72 + 16 then d = d + 1000 end
    if m.state == 'track' and dist(x, y, m.x, m.y) < 72 + 16 then d = d + 40 end   -- (it follows: do not stand where it is going)
  end
  for _, l in ipairs(nova.all('coil_lane')) do if math.abs(y - l.y) < 42 + 16 then d = d + 1000 end end
  for _, w in ipairs(nova.all('wreckage')) do if math.abs(x - w.x) < w.w / 2 + 24 and math.abs(y - w.y) < w.h / 2 + 24 then d = d + 1000 end end
  for _, e in ipairs(nova.all('rat_drone')) do
    if e.state == 'tell' or e.state == 'charge' then
      local len = 430 * 0.85
      if seg_dist(x, y, e.x, e.y, e.x + e.dir_x * len, e.y + e.dir_y * len) < 24 + 16 then d = d + 1000 end
    end
  end
  return d
end
function BRAIN()
  local b, r = BOSS, RUNNER
  if not b:is_alive() or r.state == 'dead' then MODE = 'dodge'; return end
  local f = b.floor
  local goal_x, goal_y
  if b.open then
    goal_x, goal_y = b.x + math.max(-70, math.min(70, r.x - b.x)), b.y + 34
  else
    goal_x, goal_y = b.x + math.max(-100, math.min(100, r.x - b.x)), b.y + 130
  end
  local best, bx, by = 1e9, r.x, r.y
  local here = DANGER(r.x, r.y)
  -- in danger: keep running for the safe place already chosen (a person does not change their mind every tenth of a second)
  if here >= 1000 and LAST and DANGER(LAST.x, LAST.y) < 1000 and dist(r.x, r.y, LAST.x, LAST.y) > 12 then SPOT.x, SPOT.y = LAST.x, LAST.y; MODE = 'dodge'; return end
  for _, rad in ipairs({ 0, 50, 100, 150 }) do
    for k = 0, (rad == 0 and 0 or 15) do
      local a = k / 16 * math.pi * 2
      local x, y = r.x + math.cos(a) * rad, r.y + math.sin(a) * rad
      if x > f.x0 + 40 and x < f.x1 - 40 and y > f.y0 + 30 and y < f.y1 - 30 then
        -- the worst danger along the way there (a third, two thirds, the place itself), then how far it is from where he would like to stand
        local worst = DANGER(x, y)
        if here < 1000 then worst = math.max(worst, DANGER(r.x + (x - r.x) / 3, r.y + (y - r.y) / 3), DANGER(r.x + (x - r.x) * 2 / 3, r.y + (y - r.y) * 2 / 3)) end   -- (already in danger: the way out may cross it)
        local sc = worst + dist(x, y, goal_x, goal_y) * 1.0 + rad * 0.05
        if sc < best then best, bx, by = sc, x, y end
      end
    end
  end
  SPOT.x, SPOT.y = bx, by
  LAST = { x = bx, y = by }
  MODE = (b.open and math.abs(r.x - b.x) < B_W and r.y - b.y < 90 and r.y - b.y > 10 and DANGER(r.x, r.y) < 1000) and 'strike' or 'dodge'
end
B_W = 150
