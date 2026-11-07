-- The tutorial: a level with no clock, one order that never runs out, and a list of steps. Each step says what to do in a line, points at the places that matter (the
-- kitchen draws a bright frame on them: `k.marks`), and is done when the kitchen says it happened. It teaches everything: walking, taking, grinding, brewing, stirring, bottling,
-- serving, throwing and dashing.
local Tutorial = {}
Tutorial.__index = Tutorial

local function station(k, kind, pred)
  for _, st in ipairs(k.stations) do
    if st.kind == kind and (not pred or pred(st)) then return st end
  end
end

local function crate(k, ing) return station(k, "crate", function(st) return st.ing == ing end) end

-- each step: text, marks (a function giving the stations to point at), done (a function of the kitchen and this step's own memory)
local STEPS = {
  { text = "Walk around with the stick.", marks = function() return {} end, done = function(k, m) m.dist = (m.dist or 0) + math.sqrt(k.chef.vx ^ 2 + k.chef.vz ^ 2) / 60; return m.dist > 4 end },
  { text = "Face the Glowcap crate and press A to take one.", marks = function(k) return { crate(k, "glowcap") } end, done = function(k) local h = k.chef.held; return h and h.k == "ing" and h.id == "glowcap" end },
  { text = "Press A at the mortar to put it in.", marks = function(k) return { station(k, "mortar") } end, done = function(k) return station(k, "mortar").item ~= nil end },
  { text = "Hold B to grind it into powder.", marks = function(k) return { station(k, "mortar") } end, done = function(k) local i = station(k, "mortar").item; return i and i.ground end },
  { text = "Take the powder out with A.", marks = function(k) return { station(k, "mortar") } end, done = function(k) local h = k.chef.held; return h and h.ground end },
  { text = "Carry it to the cauldron and press A.", marks = function(k) return { station(k, "cauldron") } end, done = function(k) return #station(k, "cauldron").items >= 1 end },
  { text = "Now take a Sunpetal (it stays raw) and add it too.", marks = function(k) return { crate(k, "sunpetal"), station(k, "cauldron") } end, done = function(k) local c = station(k, "cauldron"); return c.state ~= "idle" end },
  { text = "It brews on its own. Hold B at the pot to stir it faster.", marks = function(k) return { station(k, "cauldron") } end, done = function(k) local c = station(k, "cauldron"); return c.state == "done" end },
  { text = "Take a bottle from the bottle shelf.", marks = function(k) return { station(k, "bottles") } end, done = function(k) local h = k.chef.held; return h and h.k == "bottle" end },
  { text = "Press A at the ready pot to fill the bottle. Do not wait: it burns!", marks = function(k) return { station(k, "cauldron") } end, done = function(k) local h = k.chef.held; return h and h.k == "potion" end },
  { text = "Serve it at the hatch with A.", marks = function(k) return { station(k, "hatch") } end, done = function(k) return k.stats.served >= 1 end },
  { text = "Take anything and press Y to throw it straight ahead. Try the bin.", marks = function(k) return { station(k, "bin") } end, done = function(k, m, events) for _, e in ipairs(events) do if e.type == "throw" then m.thrown = true end end; return m.thrown end },
  { text = "Press X to dash.", marks = function() return {} end, done = function(k, m, events) for _, e in ipairs(events) do if e.type == "dash" then m.dashed = true end end; return m.dashed end },
  { text = "That is the whole craft. In real levels the orders run out of time. Good luck!", marks = function() return {} end, done = function(k, m) m.t = (m.t or 0) + 1 / 60; return m.t > 4 end },
}
Tutorial.COUNT = #STEPS

function Tutorial.new(k)
  local t = setmetatable({ k = k, i = 1, mem = {}, done = false }, Tutorial)
  t:mark()
  return t
end

function Tutorial:mark()
  self.k.marks = {}
  local step = STEPS[self.i]
  if not step then return end
  for _, st in ipairs(step.marks(self.k)) do self.k.marks[st] = true end
end

-- the text of the step now (and its number)
function Tutorial:text() return STEPS[self.i] and STEPS[self.i].text or "", self.i end

-- `events` are what the kitchen said this step (taken before they were handled)
function Tutorial:update(events)
  if self.done then return end
  local step = STEPS[self.i]
  if step.done(self.k, self.mem, events or {}) then
    self.i = self.i + 1
    self.mem = {}
    if self.i > #STEPS then
      self.done = true
      self.k.marks = {}
      return true
    end
    -- (a potion thrown away or a pot that burnt mid-lesson: the apprentice can always start the step over, the orders never run out)
    self:mark()
  end
  -- keep the pointers right when stations change hands (a mortar emptied, say)
  self:mark()
  return false
end

return Tutorial
