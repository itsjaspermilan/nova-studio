nova.scene("2d")

local animation = nova.frames({nova.asset("awake"), nova.asset("blink")}, 0.25, true)
local chime = nova.asset("chime")
local seconds = nova.timer(1, true)
local elapsed = 0
local forward = true
local motion = nova.tween(64, 800, 3, "smooth")
local held = false

local saved = nova.save_get("activations")
local activations = saved == nil and 0 or tonumber(saved)
assert(activations and activations >= 0 and activations <= 999999
    and activations == math.floor(activations), "demo activation save must be an integer 0..999999")

function update(dt, input)
    elapsed = elapsed + nova.timer_poll(seconds)
    local x, finished = nova.tween_value(motion)
    if finished then
        nova.cancel(motion)
        forward = not forward
        motion = nova.tween(x, forward and 800 or 64, 3, "smooth")
    end

    if input.action and not held then
        assert(activations < 999999, "demo activation counter is full")
        activations = activations + 1
        nova.save_set("activations", tostring(activations))
        nova.play(chime, 0.2)
    end
    held = input.action

    nova.background(18, 24, 41)
    nova.text("NATIVE SERVICES / ORIGINAL V2 DEMO", 32, 32, 28, 235, 243, 255)
    nova.text("Fixed-step timer, smooth numeric tween and two sprite frames", 32, 82, 20, 175, 191, 219)
    nova.rectangle(48, 230, 864, 6, 43, 63, 86)
    nova.sprite(animation, x, 156, 72, 72)
    nova.text(string.format("Timer: %d seconds / Saved actions: %d", elapsed, activations),
        32, 288, 24, 77, 225, 201)
    nova.text("Space / gamepad A: save one action and play the soft original chime",
        32, 346, 20, 235, 243, 255)
    nova.text("Hold does not repeat. R resets motion/timers, but keeps your saved count.",
        32, 386, 20, 175, 191, 219)
    nova.text("No automatic save writes or audio playback without an action press.",
        32, 426, 20, 175, 191, 219)
end
