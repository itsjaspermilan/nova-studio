-- Assessment game: uses only Nova's existing rectangle/text/input/overlap API.
-- Controls: W/up throttle, S/down brake/reverse, A/D steer, Space start/recover.
nova.scene("2d")

local race = {best = nil}
local action_down = false
local bales = {
    {302, 268, 40, 26}, {568, 294, 44, 26}, {664, 242, 40, 26}
}
local trees = {
    {216, 248}, {248, 318}, {360, 342}, {458, 242},
    {520, 346}, {714, 326}, {706, 286}, {218, 350}
}
local colors = {
    grass = {26, 58, 48}, grass_light = {34, 69, 53},
    panel = {18, 27, 42}, text = {235, 243, 255},
    muted = {175, 193, 214}, gold = {242, 197, 100},
    mint = {115, 224, 193}
}

local function clamp(value, low, high)
    return math.max(low, math.min(high, value))
end

local function rectangle(x, y, w, h, color)
    nova.rectangle(x, y, w, h, color[1], color[2], color[3])
end

local function text(value, x, y, size, color)
    nova.text(value, x, y, size, color[1], color[2], color[3])
end

local function time_text(seconds)
    local hundredths = math.floor(seconds * 100 + 0.00001)
    return string.format("%d:%02d.%02d",
        math.floor(hundredths / 6000), math.floor(hundredths / 100) % 60,
        hundredths % 100)
end

local function reset_race(phase)
    race.phase = phase or "ready"
    race.x, race.y, race.heading = 218, 424, 0
    race.speed, race.vx, race.vy = 0, 0, 0
    race.elapsed, race.lap_started = 0, 0
    race.laps, race.next_gate = 0, 1
    race.last_lap, race.best_lap = nil, nil
    race.recoveries, race.bumps = 0, 0
    race.countdown, race.message_time, race.bump_cooldown = 3, 0, 0
    race.message = ""
    race.checkpoint = {218, 424, 0}
    action_down = false
end

local function on_road(x, y)
    local inside = nova.overlap(x - 6, y - 6, 12, 12, 64, 120, 832, 352)
    local island = nova.overlap(x - 6, y - 6, 12, 12, 184, 216, 592, 160)
    return inside and not island
end

local function recover()
    race.x, race.y, race.heading = table.unpack(race.checkpoint)
    race.speed, race.vx, race.vy = 0, 0, 0
    race.elapsed = race.elapsed + 3
    race.recoveries = race.recoveries + 1
    race.message, race.message_time = "RECOVERED / +3.00 SECONDS", 2
end

local function checkpoints(old_x, old_y)
    local passed = false
    if race.next_gate == 1 and old_y > 288 and race.y <= 288
        and race.x >= 776 and race.x <= 896 then
        race.checkpoint = {836, 250, -math.pi / 2}
        passed = true
    elseif race.next_gate == 2 and old_x > 480 and race.x <= 480
        and race.y >= 120 and race.y <= 216 then
        race.checkpoint = {438, 168, math.pi}
        passed = true
    elseif race.next_gate == 3 and old_y < 288 and race.y >= 288
        and race.x >= 64 and race.x <= 184 then
        race.checkpoint = {124, 328, math.pi / 2}
        passed = true
    elseif race.next_gate == 4 and old_x < 250 and race.x >= 250
        and race.y >= 376 and race.y <= 472 then
        race.laps = race.laps + 1
        race.last_lap = race.elapsed - race.lap_started
        race.best_lap = math.min(race.best_lap or race.last_lap, race.last_lap)
        race.lap_started = race.elapsed
        race.next_gate = 1
        race.checkpoint = {282, 424, 0}
        race.message = "LAP " .. race.laps .. " / " .. time_text(race.last_lap)
        race.message_time = 2.5
        if race.laps == 3 then
            race.phase = "finished"
            race.best = math.min(race.best or race.elapsed, race.elapsed)
            race.speed, race.vx, race.vy = 0, 0, 0
        end
        return
    end
    if passed then
        race.next_gate = race.next_gate + 1
        race.message, race.message_time = "CHECKPOINT", 0.8
    end
end

local function simulate(dt, input)
    local pressed = input.action and not action_down
    action_down = input.action
    if pressed and (race.phase == "ready" or race.phase == "finished") then
        reset_race("countdown")
        action_down = true
    elseif pressed and race.phase == "racing" then
        recover()
    end
    race.message_time = math.max(0, race.message_time - dt)
    race.bump_cooldown = math.max(0, race.bump_cooldown - dt)
    if race.phase == "countdown" then
        race.countdown = race.countdown - dt
        if race.countdown <= 0 then race.phase = "racing" end
        return
    end
    if race.phase ~= "racing" then return end

    race.elapsed = race.elapsed + dt
    local road = on_road(race.x, race.y)
    local throttle = -input.vertical
    local acceleration = throttle >= 0 and 240 or 320
    race.speed = race.speed + throttle * acceleration * dt
    race.speed = race.speed * math.max(0, 1 - (road and 0.7 or 3.8) * dt)
    race.speed = clamp(race.speed, -65, road and 240 or 85)
    local steering = input.horizontal * 2.65 * math.min(math.abs(race.speed) / 65, 1)
    if race.speed < 0 then steering = -steering end
    race.heading = race.heading + steering * dt
    race.heading = math.atan(math.sin(race.heading), math.cos(race.heading))
    local grip = math.min(1, (road and 9 or 3.2) * dt)
    race.vx = race.vx + (math.cos(race.heading) * race.speed - race.vx) * grip
    race.vy = race.vy + (math.sin(race.heading) * race.speed - race.vy) * grip
    local old_x, old_y = race.x, race.y
    race.x = clamp(race.x + race.vx * dt, 28, 932)
    race.y = clamp(race.y + race.vy * dt, 106, 490)

    for _, bale in ipairs(bales) do
        if nova.overlap(race.x - 8, race.y - 8, 16, 16,
            bale[1], bale[2], bale[3], bale[4]) then
            race.x, race.y = old_x, old_y
            race.speed, race.vx, race.vy = -race.speed * 0.15, 0, 0
            if race.bump_cooldown == 0 then
                race.bumps = race.bumps + 1
                race.bump_cooldown = 0.5
                race.message, race.message_time = "BALE IMPACT / KEEP TO THE TRACK", 1.5
            end
        end
    end
    checkpoints(old_x, old_y)
end

local function draw_track()
    nova.background(26, 58, 48)
    rectangle(52, 108, 856, 376, {63, 74, 66})
    rectangle(64, 120, 832, 352, {126, 111, 80})
    rectangle(76, 132, 808, 328, {138, 123, 90})
    rectangle(174, 206, 612, 180, {71, 83, 62})
    rectangle(184, 216, 592, 160, colors.grass)
    for i = 0, 25 do
        local color = i % 2 == 0 and colors.gold or colors.panel
        rectangle(64 + i * 32, 113, 24, 5, color)
        rectangle(64 + i * 32, 475, 24, 5, color)
    end
    for i = 0, 10 do
        local color = i % 2 == 0 and colors.gold or colors.panel
        rectangle(57, 120 + i * 32, 5, 24, color)
        rectangle(898, 120 + i * 32, 5, 24, color)
    end
    for row = 0, 7 do
        for column = 0, 1 do
            local color = (row + column) % 2 == 0 and colors.text or colors.panel
            rectangle(248 + column * 12, 376 + row * 12, 12, 12, color)
        end
    end
    for _, tree in ipairs(trees) do
        rectangle(tree[1] - 3, tree[2] + 8, 6, 15, {101, 80, 52})
        rectangle(tree[1] - 12, tree[2], 24, 16, {28, 80, 60})
        rectangle(tree[1] - 8, tree[2] - 8, 16, 14, {48, 108, 74})
        rectangle(tree[1] - 4, tree[2] - 14, 8, 10, {85, 140, 92})
    end
    for _, bale in ipairs(bales) do
        rectangle(bale[1] + 2, bale[2] + 3, bale[3], bale[4], {15, 39, 36})
        rectangle(bale[1], bale[2], bale[3], bale[4], {190, 151, 77})
        rectangle(bale[1] + 8, bale[2], 4, bale[4], {109, 91, 56})
        rectangle(bale[1] + bale[3] - 12, bale[2], 4, bale[4], {109, 91, 56})
    end
    text("PINE RIDGE", 367, 266, 28, {129, 165, 133})
    text("GRAVEL TIME TRIAL", 363, 303, 18, {129, 165, 133})
    text(">", 492, 412, 22, {208, 192, 151})
    text("^", 828, 332, 22, {208, 192, 151})
    text("<", 387, 157, 22, {208, 192, 151})
    text("v", 116, 240, 22, {208, 192, 151})
    if race.phase == "racing" then
        if race.next_gate == 1 or race.next_gate == 3 then
            local x = race.next_gate == 1 and 780 or 68
            for i = 0, 6 do rectangle(x + i * 16, 286, 10, 4, colors.mint) end
        elseif race.next_gate == 2 then
            for i = 0, 5 do rectangle(478, 123 + i * 16, 4, 10, colors.mint) end
        else
            rectangle(242, 376, 4, 96, colors.mint)
        end
    end
end

local function draw_car()
    local forward_x, forward_y = math.cos(race.heading), math.sin(race.heading)
    local function part(forward, side, size, color)
        local x = race.x + forward_x * forward - forward_y * side
        local y = race.y + forward_y * forward + forward_x * side
        rectangle(x - size / 2, y - size / 2, size, size, color)
    end
    rectangle(race.x - 11, race.y - 8, 25, 23, {34, 43, 42})
    for _, forward in ipairs({-8, 8}) do
        part(forward, -9, 7, colors.panel)
        part(forward, 9, 7, colors.panel)
    end
    -- Existing commands cannot rotate a sprite: arrange native quads instead.
    for forward = -10, 10, 5 do
        for side = -5, 5, 5 do
            local color = forward == 0 and colors.panel or colors.gold
            part(forward, side, 6, color)
        end
    end
    part(12, -4, 3, colors.text)
    part(12, 4, 3, colors.text)
end

local function draw_interface()
    rectangle(0, 0, 960, 96, colors.panel)
    text("NOVA / PINE RIDGE RALLY", 24, 18, 26, colors.text)
    text("3 laps. Follow the arrows. Grass slows you down.", 24, 57, 18, colors.muted)
    text("LAP " .. math.min(race.laps + 1, 3) .. "/3", 712, 17, 24, colors.gold)
    text(time_text(race.elapsed), 712, 52, 25, colors.mint)
    rectangle(0, 506, 960, 34, colors.panel)
    if race.phase == "racing" then
        text("W/UP gas   S/DOWN brake   A-D steer   SPACE recover (+3s)", 23, 516, 16, colors.muted)
        text(string.format("%.0f px/s", math.abs(race.speed)), 795, 516, 16, colors.gold)
        if not on_road(race.x, race.y) then
            text("OFF TRACK / LOW GRIP", 352, 104, 18, colors.gold)
        end
        if race.message_time > 0 then text(race.message, 302, 487, 16, colors.mint) end
    elseif race.phase == "ready" then
        text("WASD / arrow keys / controller stick supported", 24, 516, 16, colors.muted)
        rectangle(228, 188, 504, 200, colors.panel)
        text("PINE RIDGE RALLY", 282, 211, 32, colors.gold)
        text("A native, Lua-only assessment game", 282, 257, 19, colors.muted)
        text("SPACE / GAMEPAD A TO START", 276, 300, 22, colors.mint)
        text("W/UP accelerate   A-D steer   S/DOWN brake", 258, 345, 16, colors.text)
    elseif race.phase == "countdown" then
        rectangle(424, 236, 112, 90, colors.panel)
        text(tostring(math.max(1, math.ceil(race.countdown))), 460, 254, 44, colors.gold)
        text("READY / W OR UP TO ACCELERATE", 290, 516, 18, colors.muted)
    else
        rectangle(228, 175, 504, 262, colors.panel)
        text("RALLY COMPLETE", 308, 193, 30, colors.gold)
        text("TOTAL " .. time_text(race.elapsed), 318, 239, 28, colors.mint)
        text("Best lap: " .. time_text(race.best_lap), 288, 284, 21, colors.text)
        text("Recoveries: " .. race.recoveries .. "    Impacts: " .. race.bumps, 288, 318, 19, colors.muted)
        text("Session best: " .. time_text(race.best), 288, 351, 19, colors.muted)
        text("SPACE / GAMEPAD A TO RACE AGAIN", 270, 397, 20, colors.mint)
        text("Session best resets on script reload. Audio/export APIs are not implemented.", 24, 516, 15, colors.muted)
    end
end

reset_race("ready")

function update(dt, input)
    simulate(dt, input)
    draw_track()
    draw_car()
    draw_interface()
end
