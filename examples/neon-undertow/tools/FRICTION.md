# Friction log, slice 1 (the runner)

What I wanted, what I tried, attempts, and what would have made it one step. Most costly first.

1. **A step's `until` with `tap`/`hold` presses at the start, not when the condition turns true.**
   Wanted: "press dash when the Scrapper's tell reaches 0.46 s". `{ hold, tap, until: cond }` taps at frame 0 of the step and
   then waits, so the roll happened 30 frames early and the whole route proved nothing (it passed quietly: no hit, no warning).
   Two attempts. Worked round with two steps (`{ until: cond }` then `{ hold, tap, until: state == 'roll' }`).
   One step: `{ "when": "<lua>", "press": "dash" }`, or say in `--help play` that `tap` fires on the step's first frame.

2. **No way to record a value every frame.** The hit-stop proof needs the runner's x for each frame around a hit. `every: 1`
   makes a picture per frame; the tool has no `lua_each_frame` although the Rust `Plan` does. 2 attempts. Worked round by
   wrapping `R.update` in a `lua` step (a probe that appends to a global string, printed at the end).
   One step: expose `lua_each_frame` in the `play` tool, or a `"record": ["expr", ...]` that prints a per-frame table.

3. **`self.sprite` is nil on an entity whose class gave the sprite** (`nova.entity { sprite = "runner" }`), so a
   `nova.spawn("ghost", ..., { sprite = self.sprite })` made an invisible entity, with no warning. 3 attempts to find
   (the report listed the ghost at the right place with "frame 22", so it looked fine). One step: `self.sprite` should read
   the class value (or `check` should warn "an entity with a frame and no sprite is drawn as nothing").

4. **`nova.count` / `nova.all` only take tags** (documented, but a debugging print `nova.count('ghost')` said 0 for a live
   `ghost` entity, which cost a detour). `nova.count_kind` or a `kind` match would help; the end-of-run entity list was what
   showed it.

5. **`character_make` with `item: "none"` still bakes a grey arc into the attack frames** (frames 7/8, 17/18...). Over my
   own arc it shows as a stray grey line by the feet. Not removable without repainting 12 frames by hand; I left it.
   One step: `item: "none"` draws no swing, or `swing: false`.

6. **Design says X/A/B/Y by Nintendo position; the engine's prompts print the engraved Retroid letters.**
   `nova.input.prompt("attack")` for `pad:north` is `Y` (the RP6 engraves Y on top, A at the bottom), so the HUD reads
   "Y baton, A roll, X shoot, B use" while the design table says X, B, Y, A. The HUD follows the engine (right for the device
   in the hand). The design doc's letters need a note or a different table. (A decision, not a bug.)

7. **No built-in hit-stop or screen shake.** Written in `lib/juice.lua` (a freeze counter every entity checks, and a scene
   camera that follows by itself and adds the shake, because `nova.cam.follow` cannot be offset). 1 attempt, but every
   game of this kind will need it. One step: `nova.time_hold(frames)` and `nova.cam.shake(px, frames)`.

8. **Entity hitboxes are axis-aligned, not turned with `angle`.** Fine once known; I give each swing a box per facing
   direction (`lib/combat.lua`). A note under `angle` in the docs would have saved a look.

9. **`scene_write`'s `background` wants `[r,g,b]`**, while the sprite palettes want `"#rrggbb"`: the error was clear and
   fixed in one go, but the mixed styles invite it.

10. **Puddles cannot be water terrain**: `tileset_make`'s `water` is solid, so puddles are `puddle` entities (a picture
    with depth 85 over the street layer at 100) and not painted cells. A `walkable` flag on a terrain, or a `water_shallow`
    terrain, would let them be painted in the scene like everything else.

11. `scene_write` painted "crate on path" correctly in one go (good); the `route` file format of the tools (`route`) differs
    from the Rust plan (`steps`), so the Rust test converts it (a 12-line shim in `neon_undertow.rs`).

12. The `sprite_write` hand-drawn art needed a Node generator (`art_args.mjs`) for the crescent and hearts (a crescent from
    shapes is not possible: no clip or arc primitive; a heart half needs a mask). A `{ "arc": [cx, cy, r0, r1, a0, a1] }`
    shape would remove the script.

Top five by cost: 1, 2, 3, 5, 6/7.

# Friction log, slice 2 (a room that plays)

Same form. Most costly first.

1. **A step's `lua` runs at the start of the step, before its `wait`.** Wanted: "wait 70 frames, then read the dummy's total"
   (Hot Solder's ticks). `{ "wait": 70, "lua": "T1 = ..." }` read the value 70 frames too early and printed the previous second's
   number, so the burn looked a tick late. 2 attempts (the first read the numbers as a bug in the card). Worked round with two steps,
   `{ wait }` then `{ lua }`, everywhere. One step: say so in `--help play` next to `lua`, or give a step `"then": "<lua>"` that runs when
   the step ends.

2. **`hold: ["ranged","up","right"]` lets go of the stick on the same frame as the button, so the shot goes along the facing, not
   the aim.** Wanted: an aimed shot up and right (Ricochet's bounce off the top wall). The `look_aim` route showed the sight line
   fine (it is drawn while held), so I trusted it; the shot went straight right. 3 attempts, found by wrapping `Shot.update` in a probe
   and printing `dx, dy`. Worked round with a second step that keeps only the stick held for 2 frames. One step: `{ "hold": [...],
   "frames": 6, "release": ["ranged"] }` (the others stay held a frame longer), or a line in the guide: "a release frame has no stick".

3. **`check` warns "its own draw() replaces the drawing of it" for an entity that has no sprite**, because a spawn call
   `nova.spawn("fx", x, y, { sprite = "fx_burst", ... })` inside the file looks like a `sprite = "` in the class. 1 attempt to
   understand, 1 to work round (`lib/fx.lua` does the spawn). One step: only look inside the `nova.entity { ... }` table.

4. **`walk_to` a door whose scene has no such walker is an ERROR step; the same step into a scene that has the runner is a success
   ("the scene changed: a door").** The end banner scene has no entities, so the last `walk_to door_e` of the whole-slice route was
   reported as "the walker is gone". The Rust test (rightly) refuses step errors. Worked round: `walk_to` a point beside the door and
   `hold right until nova.current_scene() == 'slice_end'`. One step: a scene change during `walk_to` is always the success the note describes.

5. **No translucent rotated rectangle for the ground.** The tell lanes (Rat-drone's charge, the Mimic's three can lanes) need a
   see-through band at any angle, under the characters. `nova.rect` has no rotation; squares laid side by side add their alpha up to
   solid (my first lane was a magenta wall); `nova.ui.line` draws over everything. Worked round with `sprites/solid` (a 4x4 white
   picture) drawn by `nova.sprite` with `w`, `h`, `rotation` and a colour (`lib/draw.lua`, 3 attempts). One step: `rotation` for
   `nova.rect`, or `nova.line(x1, y1, x2, y2, w, color)` in the world layer.

6. **Text is always over UI rectangles, so a dimming page cannot cover the HUD's text.** The pause page showed "WAVE 1 / 3" and the
   prompt row through its dark panel. 2 attempts (the guide has the trap, but only a picture shows it). Worked round by not drawing
   the HUD at all while paused. One step: `nova.ui.rect(..., { over_text = true })`.

7. **`slide` only knows solid tiles, so every mover repeats "move, and undo if touching a solid thing".** Now in `Foe:move` and the
   runner's `move`; the Rat-drone also needs to know *that* it was stopped (a wall or cover) to crash. One step: `self:slide(dx, dy, { solid = true })`
   that counts entities tagged `solid` and says which axis was blocked.

8. **A door cannot change whether it is solid.** Tags are fixed by the class, so a door that is open, shut or unlocked uses a
   zero-size `hitbox` when open and a full one when shut (the same trick the baton's arc uses). It works, but a reader would not
   guess it. One step: `self:set_solid(false)` or tags that can change.

9. **The runner is built from the scene file before the scene's `enter` runs**, so what a run carries over (health, the maximums
   cards changed) cannot be given to it in `create` unless the entity reads a module; I let `create` read `lib/run.lua` and have
   `enter` call `Run.give_to(runner)` again after a new run began (death restarts the run: it read the old one first; found by a
   route, 1 wasted run). One step: a scene hook that runs before the objects are built, or `create` getting the scene's `enter` arguments.

10. **Same as slice 1 #4: `nova.count` / `nova.all` only take tags**, so every enemy carries a `kind_name` field to say what it is in
    logs and wave checks (`KINDS()` in the room route lists them).

11. **`play`'s `invincible` puts health back every frame**, so "7 of 12 health carries into room B" cannot be shown in an invincible
    run (the whole-slice route is invincible; the carry proof is its own route with a forced state and no invincibility).

12. The test harness had a bug of my own: two tests running the same route in parallel shared one scratch folder (a pid-named
    directory) and one deleted the other's report. Fixed with a counter in `scratch()`; worth copying into any later test file.

Top five by cost: 2, 1, 5, 3, 4 (then 6, 9).

# Friction log, slice 3a (one run of the Gutter Market, room 1 to the boss door)

Same form. Most costly first.

1. **`scene_write` cannot write a scene into a folder.** The design (and `nova.scene_data("levels.3")`, and the guide) keep levels in
   `scenes/<district>/<name>.scene.json`, but `scene_write` answers "Scene names use letters, numbers, - and _" to `gutter/s1_square`
   and to `gutter.s1_square`; `scene_preview` takes both. 2 attempts. Worked round in `tools/gutter.mjs`: write each room under a
   temporary name (`tmp_gutter_s1_square`), then rename the file into `scenes/gutter/` (19 times, in the script). One step:
   `scene_write { "name": "gutter/s1_square" }` (and the scene's Lua file beside it).

2. **`scene_preview` draws an entity with no sprite in its class as a 1-tile orange box, wherever its real size is set in `create`.**
   The district's stalls (3 to 5 tiles long), rails and trams (a whole room wide) were all boxes the size of one tile, so a map of
   a room could not show where the cover or the tram's lane runs; I judged them from the painted tiles and the plan in the script, and
   from `play` pictures after. (I give them their size in `create` from data/hazards.lua on purpose: the art is about to change.)
   One step: a class-level `size = { w, h }` in world units (the sprite is stretched to it, the hitbox and the preview follow), which is
   also how an entity says "this big, whatever the picture is" without `sx = 1`, a hitbox worked out in `create` and a hand-written
   `draw()`.

3. **A `play` plan has no way to start a scene with arguments or after setting a seed in Lua.** `lua` runs after the start scene was
   built; `seed` only seeds `math.random`. A whole run that must be repeatable needs the chain's seed before room 1 builds, so the route
   starts in a `run_start` scene that draws the seed with `math.random` (the plan's seed 3 gives run seed 578954) and the Rust test
   asserts the chain it printed, not a seed it chose. 2 attempts (the first built the chain after room 1, which was another room). One
   step: `"start_lua": "<lua>"` run before the start scene is built, or `"args": [...]` for `goto_scene`.

4. **Same as slice 2 #4, still there: `walk_to` a door whose next scene has no walker is reported as an ERROR step** ("the walker is gone"),
   here at the summary. Worked round as then (walk beside the door, `hold right until` the scene changes). It was 1 attempt this time
   because the log already said so; the fix is still one step: a scene change during `walk_to` is always the success the note describes.

5. **`print` expressions are evaluated at every picture, so a strip's caption lines are full of errors and `nil`s until the value exists**
   (`string.format ... number expected, got nil` at the first captions of every route that prints a measurement). Harmless but it
   buries the one real error in a long answer; I filtered with `grep` every time. One step: print only at the end unless a step says
   `"print": true`, or say "nil" quietly.

6. **A painted `paint` prop is always solid or always scenery for the whole layer (`solid_props`).** Rails want to be painted tiles that can be
   walked over beside crates that cannot; there is no way to say it in one layer, so the rail is an entity drawn from a one-tile
   picture (`entities/rail.lua`), not part of the painted map. One step: a `walkable` flag on a prop (the same wish as slice 1 #10 for
   puddles).

7. **A `repeat ... until` followed at once by `press` lost the press** (the talk's last line advanced to the choice on the frame the loop
   ended, and the next press, 1 frame later, was read as the same press: the choice was not made, and the route went on with nothing
   chosen, 3 attempts, found by printing the stage each step). Worked round with a `wait: 6` before the press that chooses. The guide could
   say how many frames a tap needs after another.

8. A hit does not say what hit it. `take_hit(damage, dx, dy, knock)` is the game's own, so this is not Nova's, but a Shielded elite
   and a sign both need "was it a shot?"; I added `Hits.from = "shot"` set round the shot's call. Worth copying into the next slice's
   enemies (Shieldbearer, Mirror Drone) rather than reading `knock == 0`.

Top five by cost: 1, 3, 7, 2, 5 (then 4, 6).
