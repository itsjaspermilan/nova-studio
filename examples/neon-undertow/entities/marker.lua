-- An invisible named point in a room's scene file: `sp_*` are spawn points (data/waves.lua names them), `cards` is the middle of the
-- floor where the cards rise. Not drawn, not solid.
local Marker = nova.entity { tags = { "marker" }, velocity = false }
return Marker
