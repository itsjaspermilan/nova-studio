-- The space behind everything: a Kenney skybox that drifts, planets that turn slowly, and stars that twinkle.
local backdrop = {}

local STARS = {}
do
  local s = 12345
  local function r() s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648 end
  for i = 1, 46 do STARS[i] = { x = r() * 1100 - 70, y = r() * 540, size = 4 + r() * 8, phase = r() * 6.28, speed = 1 + r() * 2 } end
end

local SKY = { endless = "bg/nebula", puzzle = "bg/nebula", versus = "bg/galaxy", menu = "bg/nebula" }
local TINT = { endless = { 255, 255, 255 }, puzzle = { 215, 190, 255 }, versus = { 255, 225, 235 }, menu = { 255, 255, 255 } }

-- t: seconds; mode: "menu" | "endless" | "puzzle" | "versus"; dim: 0 to 1 (darker, behind a pause or a result)
function backdrop.draw(t, mode, dim)
  local w, h = nova.view()
  local sky = SKY[mode] or SKY.menu
  local tint = TINT[mode] or TINT.menu
  local d = 1 - 0.55 * (dim or 0)
  local drift = math.sin(t * 0.05) * 60
  local sw = math.max(w + 140, h * 2 + 80)
  nova.sprite(sky, w / 2 + drift, h / 2, { w = sw, h = sw / 2, color = { tint[1] * d, tint[2] * d, tint[3] * d, 255 } })
  for i, s in ipairs(STARS) do
    local a = 0.35 + 0.65 * (0.5 + 0.5 * math.sin(t * s.speed + s.phase))
    local x = (s.x - t * (3 + s.size * 0.8)) % (w + 140) - 70
    nova.sprite(i % 3 == 0 and "bg/star_medium" or "bg/star_small", x, s.y, { w = s.size, h = s.size, color = { 255, 255, 255, math.floor(190 * a * d) } })
  end
  -- planets, turning slowly, further ones smaller and dimmer
  nova.sprite("bg/planet00", 120 - drift * 0.3, 130, { w = 170, h = 170, rotation = t * 0.04, color = { 255 * d, 255 * d, 255 * d, 255 } })
  nova.sprite("bg/planet06", w - 110 + drift * 0.4, h - 120, { w = 210, h = 210, rotation = -t * 0.03, color = { 255 * d, 255 * d, 255 * d, 255 } })
  nova.sprite("bg/planet09", w - 150 - drift * 0.2, 90, { w = 80, h = 80, rotation = t * 0.06, color = { 200 * d, 200 * d, 220 * d, 230 } })
end

return backdrop
