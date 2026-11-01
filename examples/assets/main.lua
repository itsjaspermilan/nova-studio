nova.scene("mixed")
local badge = nova.asset("badge")
local gem = nova.asset("gem")
local x, z = 0, 0

function update(dt, input)
    x = math.max(-3, math.min(3, x + input.horizontal * 2 * dt))
    z = math.max(-3, math.min(3, z + input.vertical * 2 * dt))
    nova.background(18, 24, 41)
    nova.camera(6, 5, 8, 0, 1, 0, 48)
    nova.cube(0, -0.6, 0, 8, 0.2, 8, 43, 63, 86)
    nova.model(gem, x, input.action and 0.5 or 0, z, 1.5)
    nova.sprite(badge, 24, 100, 96, 96)
    nova.text("Native project / imported PNG + static GLB", 24, 24, 26, 235, 243, 255)
    nova.text("WASD / stick: move   Space / A: lift   R: reload project", 24, 490, 20, 175, 191, 219)
end
