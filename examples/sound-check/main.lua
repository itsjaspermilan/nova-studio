-- Sound Check: listen for crackle, lag, balance and drop-outs. Everything is a short test with a flash on the screen at the moment
-- the sound is asked for, so that any delay between the picture and the sound can be heard and seen.
local flash = 0
local music_on, music_name = false, nil
local metro_on, metro_t, metro_beats = false, 0, 0
local volume = 0.8
local tone_id
local notes = {}
local last = "press a button"

local function ping(msg) last = msg; flash = 1 end

function update(dt)
  flash = math.max(0, flash - dt * 6)
  if nova.input.pressed("click") then nova.sound.play("beep", { volume = volume }); ping("click (A)") end
  if nova.input.pressed("music") then
    music_on = not music_on
    if music_on then
      music_name = music_name == "menu" and "race_forest" or "menu"
      nova.music.play(music_name, { volume = volume * 0.7, fade = 0.3 })
    else
      nova.music.stop(0.3)
    end
    ping(music_on and ("music: " .. music_name) or "music stopped")
  end
  if nova.input.pressed("metronome") then metro_on = not metro_on; metro_t, metro_beats = 0, 0; ping(metro_on and "metronome: 120 per minute" or "metronome off") end
  if metro_on then
    metro_t = metro_t + dt
    if metro_t >= 0.5 then metro_t = metro_t - 0.5; metro_beats = metro_beats + 1; nova.sound.play("menu_move", { volume = volume }); flash = 1 end
  end
  if nova.input.pressed("burst") then
    -- twelve sounds at once at different pitches: a chord, to hear whether many voices crackle or drop
    for i = 1, 12 do nova.sound.play("lap", { volume = volume * 0.35, pitch = 0.5 + i * 0.12 }) end
    ping("12 sounds at once (Y)")
  end
  if nova.input.pressed("louder") then volume = math.min(1, volume + 0.1) end
  if nova.input.pressed("quieter") then volume = math.max(0, volume - 0.1) end
  -- the right trigger plays a continuous tone as loud and as high as it is pulled: how fast the sound follows the hand
  local t = nova.input.axis("tone")
  if not tone_id then tone_id = nova.sound.play("engine_loop", { loop = true, volume = 0, pitch = 0.6 }) end
  nova.sound.set(tone_id, { volume = volume * 0.7 * t, pitch = 0.6 + 2.2 * t })
end

function draw()
  local w, h = nova.view()
  nova.ui.rect(0, 0, w, h, { 18 + 220 * flash, 20 + 220 * flash, 30 + 220 * flash })
  local dark = flash < 0.5
  local c = dark and { 255, 255, 255 } or { 20, 20, 30 }
  nova.ui.text(40, 70, "Sound Check", { size = 40, color = c })
  local lines = {
    "A: a click (the screen flashes as it plays)",
    "X: music on and off (a different song each time)",
    "B: a metronome, two beats a second, flash and beep together",
    "Y: twelve sounds at once (a chord)",
    "R2: pull it: a tone that follows the trigger in loudness and pitch",
    "L1 / R1: quieter / louder        volume " .. string.format("%.0f%%", volume * 100),
  }
  for i, line in ipairs(lines) do nova.ui.text(40, 130 + (i - 1) * 40, line, { size = 24, color = c }) end
  nova.ui.text(40, 440, "last: " .. last, { size = 22, color = { 255, 210, 60 } })
  nova.ui.text(40, 480, "Listen for: crackle, clicks between sounds, the beep arriving after the flash, music cutting out, one side quieter.", { size = 16, color = { 160, 174, 192 } })
end
