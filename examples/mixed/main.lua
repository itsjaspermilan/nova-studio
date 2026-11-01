nova.scene("mixed")
local x, z, elapsed = 0, 0, 0

function update(dt, input)
    elapsed = elapsed + dt
    x = math.max(-4, math.min(4, x + input.horizontal * 3 * dt))
    z = math.max(-4, math.min(4, z + input.vertical * 3 * dt))
    nova.background(19, 27, 44)
    nova.camera(8, 7, 10, 0, 0, 0, 48)
    nova.cube(0, -0.3, 0, 11, 0.4, 11, 45, 61, 84)
    nova.cube(-3, 0.6, -2, 1.3, 1.5, 1.3, 111, 136, 213)
    nova.cube(2.8, 1, -2.5, 1.4, 2.3, 1.4, 185, 128, 221)
    nova.cube(3, 0.3, 2.5, 2, 0.9, 1.3, 242, 183, 77)
    local height = input.action and (0.9 + math.abs(math.sin(elapsed * 5))) or 0.65
    nova.cube(x, height, z, 0.85, 1.3, 0.85, 77, 225, 201)
    nova.cube(x, height + 0.8, z, 0.6, 0.3, 0.6, 221, 250, 242)
    nova.rectangle(0, 0, 960, 95, 29, 40, 61)
    nova.text("NOVA / 3D WORLD + 2D HUD", 28, 18, 28, 235, 243, 255)
    nova.text("Move: WASD / arrows / left stick   |   Bounce: space / gamepad A", 28, 57, 20, 175, 191, 219)
    nova.rectangle(28, 460, 225, 48, 29, 40, 61)
    nova.text(string.format("Position %.1f, %.1f", x, z), 42, 474, 20, 77, 225, 201)
end
