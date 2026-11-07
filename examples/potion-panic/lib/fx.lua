-- Particles and lights that make the kitchen feel alive: confetti and sparkles on a serve, steam over the pots, dust under the apprentice's feet, embers over the lava, and a warm light
-- on each brewing pot. Everything is cosmetic: the rules never read it.
local data = require("lib.data")

local Fx = {}

local CONFETTI = { { 255, 90, 110 }, { 255, 210, 70 }, { 90, 200, 255 }, { 150, 240, 120 }, { 200, 130, 255 } }

local function rgba(c, a) return { c[1], c[2], c[3], a or 255 } end

function Fx.new(k)
  local self = { k = k, steam_t = 0, ember_t = 0, dust_t = 0, lava = {} }
  for z, row in pairs(k.floor) do
    for x, f in pairs(row) do if f == "lava" then self.lava[#self.lava + 1] = { x - 0.5, z - 0.5 } end end
  end
  table.sort(self.lava, function(a, b) if a[2] ~= b[2] then return a[2] < b[2] end return a[1] < b[1] end)
  return setmetatable(self, { __index = Fx })
end

function Fx:confetti(x, y, z, n)
  for i = 1, 3 do
    nova.burst(x, y, z, { sprite = "fx/confetti", count = math.floor(n / 3), life = { 0.9, 1.5 }, speed = { 2.2, 4.6 }, spread = 1.5, gravity = -9, size = 0.16, size_end = 0.6,
      color = rgba(CONFETTI[(i * 2 + math.random(0, 2)) % #CONFETTI + 1]), color_end = { 255, 255, 255, 0 }, drag = 0.6, max = 60 })
  end
end

function Fx:sparkle(x, y, z, color, n)
  nova.burst(x, y, z, { sprite = "fx/spark", count = n or 10, life = { 0.5, 1.0 }, speed = { 0.8, 2.4 }, spread = 2.4, gravity = -1.5, size = 0.28, size_end = 0.1,
    color = rgba(color or { 255, 240, 160 }), color_end = rgba(color or { 255, 240, 160 }, 0), max = 40 })
end

function Fx:puff(x, y, z, n, color)
  nova.burst(x, y, z, { sprite = "fx/puff", count = n or 5, life = { 0.4, 0.8 }, speed = { 0.4, 1.2 }, spread = 2.6, gravity = 0.4, size = 0.45, size_end = 2.6,
    color = rgba(color or { 255, 255, 255 }, 150), color_end = rgba(color or { 255, 255, 255 }, 0), drag = 3, max = 40 })
end

function Fx:splash(x, y, z, color)
  nova.burst(x, y, z, { sprite = "fx/puff", count = 12, life = { 0.4, 0.9 }, speed = { 1.5, 3.5 }, spread = 1.6, gravity = -8, size = 0.22, size_end = 0.5,
    color = rgba(color, 230), color_end = rgba(color, 0), max = 40 })
end

-- the events of a frame
function Fx:events(events)
  local k = self.k
  for _, e in ipairs(events) do
    local t = e.type
    if t == "serve" then
      for _, st in ipairs(k.stations) do
        if st.kind == "hatch" then self:confetti(st.cx, 1.3, st.cz, 30); self:sparkle(st.cx, 1.1, st.cz, { 255, 230, 120 }, 8) end
      end
    elseif t == "brew_done" and e.st then self:sparkle(e.st.cx, 1.1, e.st.cz, data.recipes[e.st.recipe] and data.recipes[e.st.recipe].color, 14); self:puff(e.st.cx, 1.0, e.st.cz, 6)
    elseif t == "burnt" and e.st then self:puff(e.st.cx, 1.0, e.st.cz, 8, { 60, 50, 50 })
    elseif t == "pot_add" and e.st then self:splash(e.st.cx, 1.0, e.st.cz, { 120, 210, 255 })
    elseif t == "fill" and e.st then self:sparkle(e.st.cx, 1.0, e.st.cz, { 255, 255, 255 }, 6)
    elseif t == "lava" then self:puff(k.chef.x, 0.4, k.chef.z, 10, { 255, 140, 60 })
    elseif t == "shatter" then self:sparkle(e.x, 0.4, e.z, { 190, 230, 255 }, 12)
    elseif t == "dash" then self:puff(k.chef.x, 0.15, k.chef.z, 6)
    elseif t == "bin" or t == "reject" then self:puff(k.chef.x, 0.9, k.chef.z, 3, { 200, 200, 200 })
    end
  end
end

-- ambient: steam over pots that brew, a puff of dust at the feet, embers off the lava
function Fx:update(dt)
  local k = self.k
  self.steam_t = self.steam_t - dt
  if self.steam_t <= 0 then
    self.steam_t = 0.14
    for _, st in ipairs(k.stations) do
      if st.kind == "cauldron" and (st.state == "brewing" or st.state == "done") then
        local c = data.recipes[st.recipe] and data.recipes[st.recipe].color or { 200, 200, 200 }
        self:puff(st.cx, 1.05, st.cz, 1, { 150 + c[1] * 0.4, 150 + c[2] * 0.4, 150 + c[3] * 0.4 })
      end
    end
  end
  self.ember_t = self.ember_t - dt
  if self.ember_t <= 0 and #self.lava > 0 then
    self.ember_t = 0.12
    local p = self.lava[math.random(#self.lava)]
    nova.burst(p[1], 0.1, p[2], { sprite = "fx/spark", count = 1, life = { 0.9, 1.6 }, speed = { 0.6, 1.4 }, spread = 0.5, gravity = 0, size = 0.26, size_end = 0.04,
      color = { 255, 170, 60, 255 }, color_end = { 255, 60, 20, 0 }, max = 24 })
  end
  local c = k.chef
  local speed = math.sqrt(c.vx * c.vx + c.vz * c.vz)
  self.dust_t = self.dust_t - dt
  if speed > 2.5 and c.dead <= 0 and self.dust_t <= 0 then
    self.dust_t = 0.14
    self:puff(c.x - c.vx * 0.05, 0.08, c.z - c.vz * 0.05, 1)
  end
end

-- lights: call in draw. A pot that brews glows its potion's colour; a few lava tiles glow orange
function Fx:lights(t)
  local k = self.k
  for _, st in ipairs(k.stations) do
    if st.kind == "cauldron" and (st.state == "brewing" or st.state == "done") then
      local c = data.recipes[st.recipe] and data.recipes[st.recipe].color or { 255, 200, 120 }
      local pulse = 0.85 + 0.15 * math.sin(t * 7 + st.cx)
      nova.point_light(st.cx, 1.6, st.cz, { radius = 3.6 * pulse, color = c })
    end
  end
  local n = 0
  for i = 1, #self.lava, 4 do
    local p = self.lava[i]
    nova.point_light(p[1], 0.6, p[2], { radius = 3.2, color = { 255, 110, 40 } })
    n = n + 1
    if n >= 6 then break end
  end
end

return Fx
