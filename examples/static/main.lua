nova.scene("mixed")
local assembly = nova.asset("assembly")
local copy = nova.asset("assembly-copy")
local x = 0

function update(dt, input)
    x = math.max(-1, math.min(1, x + input.horizontal * dt))
    nova.background(18, 24, 41)
    nova.camera(8, 5, 10, 0, 0.7, 0, 45)
    nova.model(assembly, x, 0, 0, 1)
    nova.model(copy, 0, 0, -3, 0.5)
    nova.text("Original static cubes and pyramids / R reloads", 24, 24, 24, 235, 243, 255)
end
