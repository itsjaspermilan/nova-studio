nova.scene("2d")
local token = nova.asset("token")
local copy = nova.asset("token-copy")
local tile = nova.asset("tile")
local x, y = 240, 240

function update(dt, input)
    x = math.max(0, math.min(nova.width - 64, x + input.horizontal * 180 * dt))
    y = math.max(0, math.min(nova.height - 64, y + input.vertical * 180 * dt))
    nova.background(18, 24, 41)
    for row = 0, 5 do
        for column = 0, 9 do
            nova.sprite(tile, column * 96, row * 96, 96, 96)
        end
    end
    nova.sprite(copy, 640, 240, 64, 64)
    nova.sprite(token, x, y, 64, 64)
end
