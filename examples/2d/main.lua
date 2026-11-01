nova.scene("2d")
local x, y, elapsed, hits = 220, 260, 0, 0
local was_touching = false

function update(dt, input)
    elapsed = elapsed + dt
    x = math.max(0, math.min(nova.width - 36, x + input.horizontal * 230 * dt))
    y = math.max(105, math.min(nova.height - 36, y + input.vertical * 230 * dt))
    local target_x = 650 + math.sin(elapsed) * 70
    local touching = nova.overlap(x, y, 36, 36, target_x, 270, 48, 48)
    if touching and not was_touching then hits = hits + 1 end
    was_touching = touching

    nova.background(18, 24, 41)
    for column = 0, 29 do
        for row = 0, 11 do
            if (column + row) % 2 == 0 then
                nova.rectangle(column * 32, 156 + row * 32, 32, 32, 23, 32, 51)
            end
        end
    end
    nova.rectangle(target_x, 270, 48, 48, 252, 190, 69)
    if touching then nova.rectangle(x - 4, y - 4, 44, 44, 252, 190, 69) end
    nova.rectangle(x, y, 36, 36, 77, 225, 201)
    nova.rectangle(x + 22, y + 6, 7, 7, 18, 24, 41)
    nova.rectangle(0, 0, 960, 95, 29, 40, 61)
    nova.text("NOVA / 2D PLAYGROUND", 28, 18, 28, 235, 243, 255)
    nova.text("Move: WASD / arrows / left stick   |   Find the gold square", 28, 57, 20, 175, 191, 219)
    nova.text("Native AABB contacts: " .. hits, 28, 115, 20, 252, 190, 69)
end
