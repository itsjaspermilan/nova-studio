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

# Friction log, slice 3b (Mother Coil, the Den, the Workbench, saving)

Same form. Most costly first.

1. **A step cannot be conditional, so a test player that reacts to the game needs a Lua "brain" and a dummy entity to walk to.** The fair-fight
   route has to dodge three kinds of attack and strike only when the drum is open. `walk_to` takes a literal point or an entity; `press` is
   unconditional; `until` ends a group, never gates a step. Worked round (4 attempts, the first two bots died or oscillated): a `spot`
   entity (`entities/spot.lua`) that a `lua` step moves to the best place each tenth of a second (`tools/bossbot.lua`), `walk_to: "spot"`,
   and `{ repeat: 1, until: "MODE ~= 'strike'", steps: [press] }` as an "if". One step: `{ "walk_to": { "lua": "return x, y" } }` and
   `{ "press": "attack", "if": "<lua>" }`; or expose `lua_each_frame` and let a route drive input from Lua (`nova.testing.press`).

2. **A `repeat` with `until` that is already true at its start (or never true) warns, so "skip this unless" needs `may_time_out` on a group that
   is meant to be skipped.** It reads like a mistake in the answer ("`MODE ~= 'strike'` never held in 1 rounds of the group") and buried the
   one real warning in 400 identical lines until I added `may_time_out` everywhere. One step: `"if"`/`"unless"` on a step (see 1), or no
   warning for a one-round group.

3. **`play`'s plan has no save folder, but the runtime has `--save-dir`**; the brief said `play` takes one. The "run twice on one save" proof is
   therefore a Rust test (`play_saved`, `Game::load_with`) and not a `play` call. 1 attempt to find out, 0 to work round. One step: `"save_dir"`
   in the `play` tool (the Plan already runs against a `Game`).

4. **The `lua` of a plan runs after the start scene is built, so a route that sets what a scene's `enter` reads (the save, the run) must send
   the scene on again** (`... nova.goto_scene('den')`). My first look at "the Den after a win" showed the first-boot line because `Meta.last` was
   set one frame too late (2 attempts, found in the picture). Same family as slice 3a #3. One step: `"start_lua"`, run before the start scene.

5. **A scene's own text is always over rectangles, so labels drawn in the world layer's `draw_ui` show through every panel** (the stalls' name
   plates through the Workbench). Second time (slice 2 #6). Fixed by drawing the labels only in the state with no panel; one step:
   `over_text = true` on `nova.ui.rect`, as asked then.

6. **No `entity:tag()`: an entity cannot become solid or stop being solid**, so every Den fixture is tagged `solid` and the ones you can walk over
   (the bed, the door) have an empty hitbox. Same as slice 2 #8; the wreckage that is soft until nobody stands in it needs the same trick
   (and a box test of its own, because `touching` would not say which of several things is inside).

7. **A shot stops at a solid tile before it can touch a hitbox that ends at the tile's edge**: Mother Coil's box ended at the floor's top
   edge, and every shot died in the wall above it (3 attempts; the baton was fine, which hid it). I let her box reach 28 units below her base.
   A line in the guide ("a target against a wall: let its box overlap the wall's first tile") would have saved the hunt.

8. `nova.save.get` returns numbers that may come back as floats (`12.0`): `lib/meta.lua` turns them back with `math.tointeger`. A note under
   `save.get` would do.

9. `scene_write`'s `paint` made the stone floor look like wall bricks in the boss arena (a large `=` block): not a bug, but a "paved" terrain
   that is visibly floor would help a map read at a glance. (Left: the art is being replaced.)

Top five by cost: 1, 2, 4, 7, 5 (then 3, 6).

# Friction log, slice 4 (the other 24 cards, sets, jinxes, keys, the codex)

Same form. Most costly first.

1. **`slide` resolves an entity that starts inside a solid thing by pushing it out in ONE LEAP, through walls and off the map.** Found only by the
   30-seed soak (an enemy spawned in a stall; a runner that ended a Shock Wake roll inside a vending machine): 3 attempts to find (the log is silent;
   the run just never ends), fixed by "a step is never longer than it was asked to be" in `Runner:move`, `Foe:move`, `Scrapper:move` and a
   nudge-out-of-solid in `Warn`. One step: `slide` should refuse a depenetration longer than the move (or return that it did one), and
   `nova.spawn` could warn "spawned inside a solid thing".
2. **No time scale.** Phase's "slow the enemies' time" cannot be `nova.time_scale(0.4)` (the runner must stay fast): every hostile entity now asks
   `J.frozen(self)` and skips 3 frames in 5. It works but touches 11 files. One step: a per-tag or per-entity `time_scale`.
3. **`play`'s `invincible` restores health after the frame, so one blow bigger than what is left (a tram's 6 and Overclock's +1) still kills.**
   The soak wraps `Runner:take_damage` to heal just before a blow. One step: `nova.testing.invincible` honoured by the engine's damage path, or
   `invincible: "block"`.
4. **A step cannot run Lua every frame**, so the soak wraps the juice tick (`J.tick`) to watch health, charge and enemy positions and to make the
   runner roll and shoot now and then. Same as slice 1 #2; a `"each_frame": "<lua>"` on the plan would remove the wrapping.
5. **A spawn prop can be a Lua function** (the second arc of lightning: `nova.spawn("later", 0, 0, { fn = function() ... end })`): it worked first
   time, but nothing says it may; a one-line note in the guide ("props are plain Lua values, functions included") would save a doubt.
6. `print` expressions still print errors until the value exists (slice 3a #5): every strip of the new routes has `nil`s and a format error in
   its early captions.
7. The play plan has no "start with this save" for a first boot: the codex and the keys-after-a-reboot proofs need two boots, so they go through
   the Rust test's `play_saved` and two route files each (as slice 3b's save test did).

Top five by cost: 1, 4, 3, 2, 6.

# Art swap (the whole game onto the detailed city style, 2D light, worn terrain and bold characters)

What I wanted, what I tried, what would have made it one step. Most costly first. Everything below was worked round; nothing was left out.

1. **A prop or a line of tiles painted with no base terrain gets a WALL under it, silently.** Wanted: `"r": "tram_rail"` (and `manhole`, `vent`,
   `cables`) in a `paint` map to lie on the street like the demo's. Tried: the demo's plain names; the room came out with solid wall tiles along every
   rail (the solid check caught 42 and 72 cells in two rooms; the maker's answer said nothing). Worked round with `"tram_rail on asphalt"` for every
   non-terrain name. One step: `scene_write` should take the base from the neighbours (or the first terrain used) and warn "x has no ground; used y".
2. **The wear maker's "two roads cross" hatching covers a whole plaza or yard.** Wanted a worn plaza; got diagonal hatching over every paved
   rectangle and the whole scrapyard, which reads as a pattern, not as wear. Found only by looking at the frames. Worked round with
   `"features": ["no hatch"]` on every room. One step: hatching only where two painted streets really cross, or `hatch` off by default.
3. **No scrapyard, flood or machinery parts.** Wanted wreck piles, tyres, a junk heap, a crane cab and gantry, a print bed, a tram, a roll-up door
   that is locked / unlocked / open, a training dummy, a bottle and a can that spin, fire. `creature_make crane_arm` gives the drum and the magnet
   but not the cab. Worked round with `sprite_write` shapes (tools/art_hd.mjs: 13 pieces, about 300 lines of shapes). One step: a `props_make` (or more
   `tileset_make` props) for junk: wreck, tyre pile, scrap heap, cab, gantry, tram car, roll-up door with states, dummy, bed.
4. **`sx` and `hitbox` are coupled, and the old art was drawn at 3 and the new at 1.5.** Every hit box in the game was written in sprite pixels at
   scale 3 (the swings' boxes are derived in `lib/combat.lua`), so the swap had to halve `sx` and double 30 hitboxes by hand, and two measuring routes
   (`e.sx / 3` in `r_elite_splitting`, `FIRE_SCALE` in `r_thrower`) read the scale. One step: a `hitbox_units = "world"` spec flag (or a sheet-level
   `scale` so a picture can be redrawn at another density without touching the entity).
5. **`creature_make rat_drone` is a side view; the game turns the drone to face its charge (`angle`).** A side-view sprite turned 90 degrees lies on
   its back. Worked round with `flip_x` and no rotation (the drone now faces left or right only). One step: a top-down variant (`view = "top"`) for
   creatures that move in four directions, or four-way frames like `character_make`.
6. **Frames of a sheet are numbers.** Every draw call names `frame = 8` for a baton card; re-making `ui` (items_make) could move them. Worked round with
   `data/art.lua` and `Cards.frame_of`. One step: `frame = "card_baton_rare"` (the sheet already has the name).
7. **`items_make` has a district card icon but no jinx.** Appended three frames with `sprite_write { append }` (art_hd.mjs, 26 to 28), which is
   fine, but a sixth family should be one option (`families = [...]`).
8. **A puddle entity and a puddle tile are two things.** The game's live puddle is an object (132 x 80 units, a gameplay box), the maker's puddle is a
   terrain; I paint three reflective cells under each object (`tools/paint.mjs`) so they agree. One step: `scene_write` `pools: [{ x, y, w, h }]`.
9. **`sprite_write` rejects `"outline": null`** (a frame with no outline had to leave the key out) and the film strip `play` cannot take an `out`
   from the command line, so `tools/look/shoot.mjs` rewrites each route file. Small.

# Friction log, the feel pass (a runner that runs, a bigger baton, a longer roll, real explosions)

1. **`character_make` (detailed) had no run clip.** Idle, walk (6 frames, a stroll), attack, hurt, roll and tell only; a walk at 235 units a second skates
   and looks like a march. Drawing a run on top of the maker's pixels (shifting the coat, the legs) is not possible: the legs and the coat are one blob
   of pixels. What worked: the maker draws its figure from a rig (`rigOf` in `studio/mcp/makers/character-hd.ts`), so I added a `run` animation there (8
   frames of 45 ms: a 10 degree lean, a 15 pixel stride each way, a frame in the air with both feet off the ground and the legs split, hands up to the
   chest and back past the hip, the baton trailing, the coat's hem streaming out behind) and appended it to `HD_ANIMS`. Every detailed character now
   gets `run_<dir>` the next time it is made (the enemies' sheets are untouched until `art.mjs` is run for them). One step: `character_make { "anims": ["run"] }`
   or a `speed` that makes the clip's stride match the speed the game moves at, as `character3d_make` answers.
2. **The roll's frame time cannot be set per game.** The maker's roll is 5 frames of 56 ms (0.28 s); the game's roll is 0.34 s now. `art.mjs` rewrites the
   `durations_ms` of the runner's `roll_*` tags after the maker runs. One step: `character_make { "roll_ms": 68 }`.
3. **`sprite_write` has no soft edges.** Glows, afterimages and smoke want alpha and blurred edges; `sprite_write` takes characters from a palette. I wrote
   the effects' pictures with a PNG writer of my own (`tools/pnglib.mjs`, `tools/fxkit.mjs`: seeded noise, discs, lines, an outline, a blur) and their
   `.sprite.json` by hand. One step: `sprite_write { "pixels": "<base64 rgba>" }` or a `png` field, and the sprite maker's shapes with `soft`.
4. **`nova.sprite`'s description does not list `flip_x` / `flip_y`** (the game already passes `flip_x`; I found it by grep). Unsure how a flip combines with `rotation`, a crescent that sweeps the other way for the next hit has its mirrored frames drawn into the sheet (`flip_y` exists on
   an entity). One step: list the flip options under `nova.sprite` and say which comes first, the flip or the turn.
5. **`nova.ui.line` is the UI layer and has no `blend`.** Lightning drawn in the world with additive glow needed a stretched, turned square (`sprites/solid`) per
   segment (`V.line`, as `D.lane` did). One step: `nova.line(x1, y1, x2, y2, w, color, { blend = "add" })` in the world layer.
6. **A world-space hit box is not a thing the code can ask for.** The swing's box is its `hitbox` in sprite pixels times `sx`; every effect that must be
   exactly that big recomputes it (`V.rect_of`). One step: `entity:hitbox_world()` returning x, y, w, h.
7. **Long Reach's double scale (not fixed, it is not in this assignment).** The runner multiplies the area by the card's 1.3 and `entities/swing.lua`
   multiplies `sx` by it again, so the box is 1.69 times as long, not 1.3 (the drawn crescent is made from the real box, so it is right either way).
8. **`play`'s `crop_to` needs an entity that is still alive.** An explosion's middle is where something just died, so the gallery (`tools/feel.mjs`) spawns a
   `spot` there and crops to it. One step: `crop_to: [x, y]` in world units.
