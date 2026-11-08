-- The self-test (F10 on the title screen): checks every level the way a player would meet it, and the rules themselves. For each level: the start is
-- a legal arrangement (every piece on the floor, none overlapping, the mover on a free cell), the card's wishes name pieces that are there, the start
-- is not already solved, and the solver's solution (props.solution, scripts/moving-day/solve.mjs) replayed through these rules ends solved in exactly
-- props.par moves, with star limits at or above par. Logs "selftest: ok" or "selftest: FAIL ..." lines.
local Rules = require("lib.rules")
local levels = require("lib.levels")

local selftest = {}

function selftest.run()
  local fails, checks = {}, 0
  local function check(ok, what)
    checks = checks + 1
    if not ok then fails[#fails + 1] = what end
  end
  -- the rules: a two-cell piece turns about the cell the mover faces
  do
    local L = { name = "test", floor = {}, edges = {}, rug = {}, props = { wishes = {} } }
    for x = 0, 4 do for z = 0, 4 do L.floor[Rules.ckey(x, z)] = "living" end end
    local R = Rules.new(L)
    local s = { px = 2, pz = 3, f = 4, pieces = { { kind = "sofa", x = 1, z = 2, q = 0 } } } -- sofa on (1,2),(2,2); mover below (2,2) facing north
    local n = R:rotate(s, -1) -- clockwise about (2,2): (1,2) swings to (2,1)
    check(n and #Rules.cells("sofa", n.pieces[1].x, n.pieces[1].z, n.pieces[1].q) == 2, "rules: the sofa turns")
    if n then
      local cs = Rules.cells("sofa", n.pieces[1].x, n.pieces[1].z, n.pieces[1].q)
      local has = {}
      for _, c in ipairs(cs) do has[c[1] .. "," .. c[2]] = true end
      check(has["2,2"] and has["2,1"], "rules: a clockwise turn about the faced cell")
    end
    local pushed, what = R:step(s, 4)
    check(what.pushed == 1 and pushed.pieces[1].z == 1 and pushed.pz == 2, "rules: walking into a piece pushes it one cell")
    L.edges[Rules.ekey(1, 1, 1, 2)] = "wall"
    local _, blocked = R:step(s, 4)
    check(blocked.bump == "piece", "rules: a wall stops a push")
  end
  -- the levels
  local count = levels.count()
  check(count >= 20, "there are at least 20 levels (" .. count .. ")")
  for i = 1, count do
    local L = levels.get(i)
    local R = Rules.new(L)
    local s = R:start()
    local name = "level " .. i .. " (" .. tostring(L.props.name) .. ")"
    local taken = {}
    for k, p in ipairs(s.pieces) do
      for _, c in ipairs(Rules.cells(p.kind, p.x, p.z, p.q)) do
        local key = Rules.ckey(c[1], c[2])
        check(R:floor(c[1], c[2]), name .. ": " .. p.kind .. " " .. k .. " is off the floor")
        check(not taken[key], name .. ": two pieces on one cell")
        taken[key] = true
      end
    end
    check(R:floor(s.px, s.pz) and not taken[Rules.ckey(s.px, s.pz)], name .. ": the mover starts on a free cell")
    check(#L.props.wishes > 0, name .. ": the card has wishes")
    for _, w in ipairs(L.props.wishes) do
      check(R:find(s, w.piece) ~= nil, name .. ": a wish names a " .. tostring(w.piece) .. " that is not there")
      if w.wish == "faces" or w.wish == "next" then check(R:find(s, w.target) ~= nil, name .. ": a wish names a " .. tostring(w.target) .. " that is not there") end
    end
    local _, all = R:granted(s)
    check(not all, name .. ": already solved at the start")
    check(type(L.props.solution) == "string" and type(L.props.par) == "number", name .. ": no solution from the solver")
    if L.props.solution then
      local e, moves = R:replay(L.props.solution)
      local _, done = R:granted(e)
      check(done, name .. ": the solution does not solve it")
      check(moves == L.props.par, name .. ": the solution takes " .. moves .. " moves, par is " .. tostring(L.props.par))
      local st = L.props.stars or {}
      check(st[1] and st[2] and st[1] >= L.props.par and st[2] >= st[1], name .. ": star limits")
      check(R:stars_for(moves) == 3, name .. ": the solution earns three stars")
    end
    check(L.client ~= nil and not R:floor(L.client.x, L.client.z), name .. ": the client waits outside")
  end
  for _, f in ipairs(fails) do nova.log("selftest: FAIL " .. f) end
  if #fails == 0 then nova.log("selftest: ok, " .. checks .. " checks over " .. count .. " levels") end
  return #fails == 0, checks
end

return selftest
