-- The sky behind a level: a gradient, drifting clouds and two layers of hills that slide past slower than the ground (parallax). One of
-- grass, sand, snow, castle (night, with stars) or meadow, from the level's `sky` prop. The layers are pictures 540 units wide made at 810
-- pixels (scripts/sunny/art.mjs), repeated across.
local Backdrop = nova.entity { depth = 1000, sky = "grass", t = 0 }

local LAYERS = {
  grass = { far = "bg/grass_far", near = "bg/grass_near", clouds = "bg/clouds" },
  meadow = { far = "bg/grass_far", near = "bg/meadow_near", clouds = "bg/clouds" },
  sand = { far = "bg/sand_far", near = "bg/sand_near", clouds = "bg/clouds" },
  snow = { far = "bg/snow_far", near = "bg/snow_near", clouds = "bg/clouds" },
  castle = { far = "bg/castle_far", near = "bg/castle_near", clouds = "bg/castle_clouds" },
}
local S = 540 / 810
local opts = { sx = S, sy = S, anchor = "topleft", color = { 255, 255, 255, 255 } }
local sky_opts = { w = 0, h = 0, anchor = "topleft" }

function Backdrop:update(dt) self.t = self.t + dt end

-- a layer repeated across the screen: `par` is how much of the camera's movement it follows, `bottom` where its foot is on the screen
local function layer(id, cx, par, bottom, drift, alpha)
  if not id then return end
  local w = nova.view()
  local iw, ih = nova.image_size(id)
  local lw, lh = iw * S, ih * S
  local off = -((cx * par + drift) % lw)
  opts.color[4] = math.floor(255 * (alpha or 1))
  local x = off
  while x < w do
    nova.sprite(id, math.floor(x * 2 + 0.5) / 2, bottom - lh, opts)
    x = x + lw - 0.5
  end
end

function Backdrop:draw()
  local w, h = nova.view()
  local L = LAYERS[self.sky] or LAYERS.grass
  sky_opts.w, sky_opts.h = w, h
  nova.sprite("bg/sky_" .. (LAYERS[self.sky] and self.sky or "grass"), 0, 0, sky_opts)
  local cx, cy = nova.cam.position()
  local low = (self.floor or 540) - h * 0.5 -- the camera's lowest place
  local lift = math.max(0, low - cy)
  if self.sky == "castle" then
    -- stars that twinkle
    for i = 1, 40 do
      local sx = ((i * 137.5 - cx * 0.03) % (w + 40)) - 20
      local sy = (i * 71) % math.floor(h * 0.55) + 12 + lift * 0.02
      local a = 0.45 + 0.55 * math.abs(math.sin(self.t * (0.8 + (i % 5) * 0.3) + i))
      local size = 5 + (i % 3) * 3
      nova.sprite("fx/sparkle", sx, sy, { w = size, h = size, color = { 255, 250, 220, math.floor(200 * a) } })
    end
  end
  layer(L.clouds, cx, 0.06, h * 0.66 + lift * 0.03, self.t * 6, self.sky == "castle" and 0.8 or 0.95)
  layer(L.far, cx, 0.16, h - 20 + lift * 0.08, 0)
  layer(L.near, cx, 0.32, h + 60 + lift * 0.16, 0)
end

return Backdrop
