-- The look of the game, in one place: every number of the light, the weather and the glow. Nothing here changes how the game plays.
-- (lib/look.lua applies it; the rooms call Look.enter("outdoors" | "indoors" | "yard") and Look.leave().)
--
-- Ambient is "what a white wall shows where no lamp reaches" (nova.ambient2d). The first review of the kit's demo found its { 92, 100, 150 }
-- too dark to read the road away from the signs, so the streets here are lifted to { 208, 212, 246 }: the worn asphalt and the kerbs read
-- everywhere, the neon pools still glow on top. Indoors is warmer and brighter.
--
-- COST: on the handheld, BLOOM is the costly one (about 1.3 ms of GPU a frame, docs/project-format.md); the reflections and the rain are
-- cheap, the lights are one small light map. The pause screen's "Effects" option switches the whole look between "high" and "low"
-- (nova.effects: no reflections or bloom, a smaller light map, half the rain); a build for the Retroid can set `quality = "low"` here.
return {
  quality = "high",      -- "high" | "low" | "off": the starting value (the pause screen changes it and the save remembers it)

  -- one entry per kind of room
  rooms = {
    outdoors = {
      ambient = { 208, 212, 246 },
      reflections = { strength = 0.6, ripple = 1.2 },
      rain = { rain = 0.3, wind = 0.25 },
      look = { bloom = 0.35, bloom_threshold = 0.62, vignette = 0.22, grade = { shadows = { 215, 222, 255 }, highlights = { 255, 246, 236 } } },
    },
    -- the scrapyard: the same night, warmer and dustier, no puddles to speak of
    yard = {
      ambient = { 200, 192, 225 },
      reflections = { strength = 0.5, ripple = 1.0 },
      rain = { rain = 0.2, wind = 0.35 },
      look = { bloom = 0.4, bloom_threshold = 0.62, vignette = 0.25, grade = { shadows = { 225, 215, 245 }, highlights = { 255, 240, 225 } } },
    },
    -- the Den, the stranger's room and the shop: a flooded server room, a noodle stand, a hall of stalls: warm, bright, no rain
    indoors = {
      ambient = { 232, 215, 205 },
      reflections = { strength = 0.45, ripple = 0.8 },
      look = { bloom = 0.3, bloom_threshold = 0.65, vignette = 0.15, grade = { shadows = { 235, 225, 245 }, highlights = { 255, 245, 232 } } },
    },
  },

  -- lights (radius and squash in world units; intensity 1 is a plain lamp). Colours are the district's two accents and warm window light.
  accent = { magenta = { 255, 63, 164 }, cyan = { 53, 230, 255 }, warm = { 255, 190, 120 } },
  lamp = { color = { 150, 215, 255 }, radius = 190, squash = 0.65, intensity = 1.6, glow = 22, glow_y = 84 },
  sign = { radius = 170, squash = 0.6, intensity = 2.2, glow = 34, glow_y = 50 },
  vending = { color = { 53, 230, 255 }, radius = 120, squash = 0.7, intensity = 1.7 },
  fuse = { color = { 255, 138, 43 }, radius = 150, intensity = 2.4 },
  fire = { color = { 255, 138, 43 }, radius = 130, intensity = 2.0 },
  puddle_live = { color = { 6, 240, 255 }, radius = 150, intensity = 2.6 },
  tram = { color = { 255, 235, 180 }, radius = 190, intensity = 2.4 },
  card = { radius = 120, intensity = 1.8 },
  door = { locked = { 255, 63, 164 }, open = { 53, 230, 255 }, radius = 110, intensity = 1.6 },

  -- people: the runner's visor, and every enemy's own small light so it reads anywhere in a room; a tell lights up much brighter
  runner = { radius = 90, radius_y = 62, color = { 150, 230, 255 }, intensity = 0.9, y = -40 },
  enemy = { radius = 80, radius_y = 56, color = { 255, 63, 164 }, intensity = 1.0, y = -32 },
  tell = { radius = 150, radius_y = 105, color = { 255, 170, 230 }, intensity = 3.2, y = -32 },
  tell_halo = { 255, 120, 220 },      -- the additive halo drawn at an enemy during its wind-up (alpha is set where it is drawn)

  -- ground marks (the tells): additive, so they glow instead of covering the floor
  zone = { color = { 255, 43, 214 }, alpha_low = 90, alpha_high = 190 },
}
