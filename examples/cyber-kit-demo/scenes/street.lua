-- The Gutter Market: one painted street (scenes/street.scene.json, from tools/street.json) with a Scrapper, a rat-drone,
-- a hover drone and a vending machine that is not one. The open shutter leads to the lab.
-- At night in the rain: a dark blue street lit by its lamps and signs (the `light` objects in the scene file), wet
-- puddles that mirror what stands over them, rain, and a little glow on what is bright.
local game = require("lib.game")
local Street = nova.scene {}

function Street:enter(x, y)
  game.enter(self, x, y)
  nova.ambient2d({ 92, 100, 150 })                                   -- what a white wall shows where no lamp reaches
  nova.reflections { strength = 0.6, ripple = 1.2 }                  -- the puddles (tileset_make marks them) mirror what stands over them
  nova.weather { rain = 0.45, wind = 0.25 }
  nova.look { bloom = 0.55, bloom_threshold = 0.6, vignette = 0.35,
              grade = { shadows = { 205, 215, 255 }, highlights = { 255, 246, 236 } } }
end

function Street:leave()
  nova.ambient2d(nil)
  nova.reflections(nil)
  nova.weather()
  nova.look()
end

function Street:draw_ui()
  game.draw_ui()
  nova.ui.text(16, 506, "Walk: stick or arrows   Baton: X or J   The open shutter leads to the lab", { font = "pixel", size = 16, shadow = true })
end

return Street
