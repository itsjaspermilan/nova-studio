-- The start of a district run: a new run (a new seed) and its first room. Death and the summary come back here.
local Run = require("lib.run")

local Start = nova.scene {}

function Start:enter()
  Run.begin_chain()
  nova.goto_scene(Run.chain[1].scene)
end

return Start
