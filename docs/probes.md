# Probe games

A probe game is built to find out what the engine, the studio and the performance cannot do yet, not to be good. Each one
states what it expects to break *before* it is built, records what actually broke (with numbers where there are any), and
says what was done about it. Polish is a non-goal: programmer art is fine.

Finished and polished games (`pine-ridge-rally`, `lantern-keep`) are demos; the probes are the ones listed here.

## Probe 1: Ember Swarm (`examples/ember-swarm`), a 3D survivors-style shooter

A twin-stick shooter in an arena: hundreds of enemies chase the player, a weapon fires by itself at the nearest, enemies drop
gems, gems level you up and you pick one of three upgrades. The camera is third person, with a switch to first person.

### What it is meant to stress

| Area | What the game does | Hypothesis (written before building) |
| --- | --- | --- |
| Entity count | 300 to 1000 live enemies, hundreds of bullets and gems | Lua entity update and draw is the limit; the framework's per-entity work (sorting for draw, tag lists, timers) is heavy at this size. Frame cost grows faster than linearly where enemies are compared with each other. |
| 3D collision | bullets hit enemies; enemies push each other apart | `on_collide_<tag>` and `overlaps` use the 2D `x, y` hitbox, so 3D entities (which live on `x, z`) cannot use them at all. There is no 3D broad phase, no raycast and no "entities near a point" query. |
| Drawing | one model per enemy, instanced by the renderer | The renderer batches equal meshes, but `nova.model` per entity per frame costs a table of options and a Lua-to-Rust call each. A model with several parts costs several draws per entity. |
| Particles | hit sparks and death bursts, many at once | The Lua emitter is fine for a few, not for hundreds of short bursts. |
| Camera and input | follow camera, first person look with a stick, aim at the nearest | There is no helper for a smoothed follow camera, and no ray from the screen or the camera into the world (aiming). The look stick works, but the engine has no pointer lock or mouse look for a desktop build. |
| UI | HUD, XP bar, three upgrade cards, pause | Text and rectangles are enough, but there is no layout helper (rows, centring, hit areas for touch). |
| Studio | the models, the arena and the scene are made through the MCP tools | Making a level with a few hundred random props is easy by script and not by hand; the scene editor cannot scatter *and* keep a seed. |

### What happened

Measured with `scripts/swarm/bench.sh` (headless, on a fast Mac, so absolute numbers say little about a handheld; the
shape of the curve is the result). Lua time a frame, as the number of enemies grows (the player runs in circles with god
mode on; enemies and their bullets, gems and bursts all count):

| Enemies | first version (every enemy looks at every other) | with the engine's ground plane and grid | render (both) |
| --- | --- | --- | --- |
| 100 | 0.9 ms | 0.6 ms | 0.7 ms |
| 300 | 6.7 ms | 2.0 ms | 1.0 to 1.5 ms |
| 600 | 24 ms | 4.6 ms | 1.4 to 2.4 ms |
| 1000 | 62 ms | 8.6 ms | 1.8 to 2.4 ms |

The hypotheses, one by one:

1. **Entity count (Lua update and draw is the limit): confirmed, and it was my code and the engine together.** The first,
   obvious version was quadratic. After the fix the cost is in step with the crowd, at about 8.5 µs of Lua per enemy; the
   framework's own part (calling `update`, the collision pass, drawing) is about 2.2 µs of that, measured with an empty
   update. The Rust side besides the scripts (swapping and sorting the draw lists) is 0.02 ms at 1000 enemies. Lua 5.4 has
   no JIT, so this is the number to carry to the handheld: expect a few times worse than a laptop (not measured). On a
   Retroid, 300 to 400 enemies is the realistic budget until the Lua per enemy gets smaller.
2. **3D collision (2D only): confirmed.** `on_collide_<tag>`, `overlaps`, `touching`, `distance_to`, `angle_to`,
   `move_toward`, `nova.nearest` and `nova.in_radius` all read `x, y`, which in a 3D game is height, and silently gave wrong
   answers for a game on `x, z`. There was no way to ask "who is near here" except `nova.in_radius`, a scan of every entity
   with the tag, so a crowd that pushes itself apart cost n squared. **Fixed:** `nova.collision { plane = "xz", cell = 2 }`
   makes all of those use the ground plane, and `nova.in_radius` and `nova.nearest` use a grid once a tag has about forty
   entities (checked against a plain scan on random positions). **Also fixed afterwards:** `nova.raycast` (entities) and
   `nova.scenery.raycast` / `line_clear` (scenery), and hitbox heights (`base`, `height`) so that things at different heights
   do not collide and a shot can pass over a short enemy. Still missing: floors, ramps and ledges (scenery is circles on
   the ground; that is the platformer probe) and flat-only tilemaps and `slide`.
3. **Drawing (a call per entity per frame): not a problem.** 1000 enemies draw in 13 to 17 draw calls (the renderer batches
   equal meshes) and cost 1.8 to 2.4 ms. A model with several parts would cost one draw per part per entity.
4. **Particles: fine at this size.** One short burst (a Lua emitter entity) per kill is inside the numbers above. Not
   pushed further.
5. **Camera and input: works, with gaps.** A smoothed follow camera and the first-person camera are 40 lines of Lua
   (`lib/camera.lua`); the stick-driven look and a camera-relative move are fine; there was no helper for either, no
   ray from the camera into the world, and no mouse at all (no buttons, no position, no look, no pointer lock; the desktop
   window also quit on Escape even when the game used it for pause). **Fixed:** `nova.cam3` (follow, first person, `look`,
   `ray`, `ground_point`), `mouse:` sources, `nova.input.pointer()` (mouse or first finger, each press seen by exactly one step),
   `nova.input.grab_mouse()`, and Escape only closes a game that does not use it. The probe now uses all of them.
6. **UI: works with no layout help.** The HUD, XP bar and three upgrade cards were placed by hand with coordinates. It
   needed nothing that was missing, but every position is a magic number, there are no hit areas for touch and no
   focus/selection helper for cards (`left`, `right` and `a` were handled by hand). **Fixed:** `nova.ui.row`, `column`, `hit`,
   `clicked` and `choose` (keys, d-pad, pointer); the level-up cards use them.
7. **Studio: easy by script, nothing tried by hand.** The models, the arena (a ring of pillars and some inside, with the
   collision circles made in the model editor) and the sounds came from `scripts/swarm/build.mjs` in one run.

Things found that were not on the list:

- **A bug of mine in the engine:** the scenery module declared a second `CELL`, which silently replaced the collision
  grid's cell size for the rest of the framework file. Renamed.
- **The sound mixer has 32 voices and, when full, the oldest effect gives way.** In a swarm, a flood of hits and pops would
  steal the voice from a long sound (the level-up jingle). **Fixed:** `nova.sound.play(name, { limit = n })` keeps at most
  n copies of one sound and lets the oldest copy of the same sound give way instead. Not measured: the audio cost itself
  (headless runs have no audio device).
- **The headless runner printed only the total.** It now prints where the time went (Lua, the rest of the update, drawing).
  Inside a running game they are `nova.stats()` now (the probe shows them on F3).
- **Frame-time spikes: not garbage collection.** The worst frame is 1.4 to 1.6 times the mean at 1000 enemies (16 ms against
  11.7). Lua's generational mode and two tunings of the incremental one (`NOVA_GC` experiment, since removed) gave the same
  mean, 95th percentile and worst frame to within 3%. The spread follows how crowded it is around the player (more
  neighbours to push apart), which changes as the autopilot circles. Nothing to fix there.
- `nova.pause(true)` froze the whole swarm for the level-up screen exactly as wanted.

Guarded by `crates/nova-runtime/tests/swarm.rs`, which runs the game with 100 and with 600 enemies and fails if six times the
enemies cost more than fourteen times the time (the old version was about 27 times, from the table above).

## Probe 2: Blockfield (`examples/blockfield`), a block-building survival game

Asked for as "a faithful adaptation of Minecraft, as it was ten years ago". The rules of the genre are free to use; the
name, pictures, sounds and music of the original are not, so everything here is original and generated by code
(`scripts/blockfield/`): a world of blocks, mining and placing, crafting, hunger, a day and a night, and creatures that
come out in the dark. Not a copy: a probe of an *open, editable, streamed* 3D world, which is the opposite of everything
the engine had been tested with (static scenery, fixed arenas).

### What it is meant to stress

| Area | What the game does | Hypothesis (written before building) |
| --- | --- | --- |
| Dynamic geometry | thousands of chunk meshes, rebuilt when a block changes | The renderer only knows meshes loaded from model files (and fixed-size rewrites for skinning). It cannot make a mesh at run time at all. |
| Collision | a walking body against a world of blocks: floors, walls, steps, ceilings, water | Scenery is circles on the ground, so this is not possible in Lua at all; a Lua version would also be too slow per entity. |
| Lighting | sun and torch light, soft shading, a day and night | The mesh shader has one directional light and a flat ambient: no per-vertex light, no way to light a cave. |
| World size | an endless world, chunks made and dropped as the player moves | Terrain from noise in Lua will be too slow to make a chunk in a frame (16 x 16 columns, caves, ores, trees). No noise function exists. |
| Memory and draw cost | about 110 chunks around the player at all times | Chunk meshes with every hidden face will be too many triangles for a handheld; the draw list needs culling. |
| UI | hotbar, a crafting menu, hearts, hunger, a debug screen, on a gamepad and a mouse | Text and rectangles are enough, but a sprite sheet is needed to draw block pictures in the UI. |
| Saving | the player's changes to the world | The save file is one JSON file of 1 MiB at most, written whole. |

### What happened

1. **Dynamic geometry: confirmed, built.** There was no way to make a mesh at run time. Added `MeshOp` (the game makes
   or frees meshes between frames, with ids from their own range) and `nova.voxel`, which owns the blocks, the light and
   the meshing in Rust. Chunk meshes are built a few a frame (`nova.voxel.draw { budget }`), nearest first.
2. **Collision: confirmed, built.** `nova.voxel.move` slides a box along the blocks (up and down first, then x and z, in
   pieces of at most 0.4 so a fast fall cannot tunnel, with a step height) and `nova.voxel.raycast` finds the block under
   the crosshair and the face to place against. This is also the answer for floors, ledges and jumping onto things in a
   voxel world; it is *not* an answer for scenery, which is still circles.
3. **Lighting: confirmed, built.** Sky light and torch light are a flood fill per chunk (and an incremental one when a block
   changes: removing a roof lets the sun in, placing a torch lights a room, breaking it darkens again, across chunk borders;
   all tested). Light and ambient occlusion are baked into the vertices and a branch of `mesh.wgsl` reads them, so the
   day and night is one number (`nova.voxel.daylight`) and torch light does not dim at night. Cut-out textures (leaves,
   glass, plants) needed `discard` in the shader: every mesh has it now.
4. **World size: the hypothesis was wrong.** Terrain, caves, ores, trees and lighting for 113 chunks are made in 220 ms
   (1.9 ms a chunk, about half of it the light) on an Apple M4, with the terrain written in Lua. Noise was the missing
   piece (`nova.noise2`, `noise3`, `hash`, and `nova.voxel.carve` for caves, which does the per-block noise in Rust: doing
   it from Lua would have been a call per block). A handheld will be several times slower; the chunk budget per frame
   (`nova.clock`, a real-time stopwatch, added because `nova.time` is game time) is what keeps the frame steady, not the
   speed. Not measured on a device.
5. **Memory and draw cost: fine on a laptop, open for a handheld.** 113 chunks in a 5-chunk view are 50 to 60 draws and
   110 to 140 thousand triangles. Chunks are whole 128-high columns, culled by the box around what is actually in them. Not
   measured on a device; the TODO lists the things to try (sections of 16, a smaller view, a worker pool for meshing).
6. **UI: nothing missing but a way to draw one block picture.** A sprite sheet (`blocks.sprite.json`) over the same atlas
   gives `nova.ui.sprite(sheet, x, y, { frame = tile })`, which draws any block or item. Blocks are drawn flat, not as
   isometric cubes. Crafting is a list of what you can make with what you carry (the console way: a handheld has no
   mouse), not a grid you arrange.
7. **Saving: the limit is real but far away.** Only what the player changed is saved (three bytes a changed block, as text,
   per chunk), regenerating the rest from the seed. A save would hold about 150 thousand edits before it reaches 1 MiB; a
   world file separate from the save is the real answer. Not tried with a big edited world.

Things found that were not on the list:

- **`Escape`, the mouse and the sprite options** all worked as documented; `--hold` takes actions (`move_y=-1`), not keys,
  and the first place the headless walk got stuck was a two-block ledge, not a bug.
- **A creeper's explosion edits about 120 blocks at once**, each with its own light update. It was not slow enough to see
  in a run on a laptop; it is the first thing to measure on a device.
- **Lua cannot see the clock.** The reduced standard library has no `os`, so a frame budget needs `nova.clock`.
- **No sun, moon, stars or clouds** are drawn: the sky is the two gradient colours the engine already had. A sky box with
  a sun and a moon is the first missing piece of the look.
- **Left out on purpose:** water that flows, lava that spreads, fire, redstone, chests, a nether, farming, a second player.
  Skeletons, spiders, cows, sheep, enchanting and the ender dragon are not here either; the three creatures there (zombie,
  creeper, pig) carry the genre's loop. No music yet (a song could be made through `song_write`).

### The follow-up round (the same day)

Everything the first round left open that an engine can fix, in the order it was done:

1. **A world file** (`nova.voxel.save_world`, `load_world`, `apply_saved`): the player's changes go to a binary file beside the save,
   three bytes a changed block, up to 256 MiB instead of the save's 1 MiB; the engine also keeps the changes of chunks
   that were dropped and puts them back when the chunk is made again, so the game no longer tracks them.
2. **Smaller things:** mipmaps for the block atlas (five levels: a 16-pixel tile stays whole down to the last, so blocks do not
   bleed into each other; far terrain stopped shimmering), water chunks drawn far to near, `nova.line3` and `nova.box3` (a line
   always turned to the camera; the block outline), and a sky that draws a sun, a moon, stars and drifting clouds
   (`nova.sky { sun, stars, clouds }`).
3. **Threads and sections.** Meshing was about 1.2 ms a chunk and lighting 0.9 ms on the M4. Meshing now runs on a pool of
   worker threads, in 16-high sections, on snapshots of the chunk and its eight neighbours that share the data (copy on
   write, so an edit while a worker holds a chunk copies 32 KB, not the world). A change rebuilds only the sections it can
   touch: its own, the one above or below when it is on an edge, and the neighbouring chunk's when it is on a border (a
   test checks each case). The cost is more draw calls: about 8 sections a chunk at most.
4. **Terrain as a recipe.** Lua could make a chunk in about 1.9 ms on a laptop, but Lua cannot be threaded, and a handheld
   will be several times slower. `nova.voxel.terrain { ... }` takes the land as data (noise layers, rivers, biomes, caves,
   ores, trees) and the engine makes the chunks on the workers: a chunk depends only on the recipe and where it is, so
   they can be made in any order and trees across a border are found by asking the neighbours where their trees are.
   Blockfield's generator went from 150 lines of Lua to a 60-line recipe. Anything a recipe cannot say can still be built
   by hand with `create_chunk`, `set`, `fill` and `carve`, on the game's own thread. **Result on the M4 (release):** 113 chunks
   in 133 ms of real time instead of 287 ms, and while they load the mean frame is 3.2 ms and the worst 9.3 ms, where it
   was a 12 to 14 ms spike for every chunk. Lighting stays on the game thread (it spreads into neighbouring chunks); a
   few chunks are lit and taken in each frame.
5. **Headless runs and tests use no threads** (`Game::set_deterministic`): a run does the same thing every time. The one
   test that wants real threads waits for them.

Two of the seven things asked for were measured and **not done**, on purpose:

- **A render thread.** At 1000 enemies in Ember Swarm a frame is 10.1 ms: 8.2 ms of Lua and 1.9 ms of drawing (on the M4,
  headless; at 300 enemies 2.0 and 1.0). Drawing on its own thread overlaps at most the smaller of the two, so about a fifth
  of the frame, and costs a frame more of input delay and a render thread that has to follow the Android surface being
  lost and found. Not worth it until a device shows drawing on the CPU at a quarter of the frame or more with the GPU not
  the limit.
- **Collision, neighbour queries and raycasts for entities in Rust.** The framework's own part is 2.2 of the 8.2 microseconds
  an enemy costs, so a port saves at most a quarter, and only if entity positions live in Rust, which is a redesign of
  what an entity is. The voxel world's own queries (the ray, the walking box) are Rust already.

### The third round: the gaps the game showed

Twelve things Blockfield ran into that an engine can fix, done in order (details in `TODO.md`):

1. **Recorded input** (`--input play.json`, `--record play.json`, `inputscript.rs`): frames of held sources, the pointer and typed
   text, played back the same every time in headless runs and tests, and written from a real session. It exists because the
   bug that stopped Blockfield's first window (the held item drawn before the eye had a place, only with items saved) got
   past every test: the tests could not move a pointer or hold a key for a frame.
2. **Positional sound** (`nova.sound.play(name, { at = {x, y, z} })`): volume falls to nothing at `range` metres, pan from the
   camera's right.
3. **A Lua profiler** (`nova.profile`, `nova.profile_report`, `--profile`): its first run on Blockfield named a loop over 169 chunks
   with string keys (about 80% of the game's script time) that is now skipped while the ring is whole. It first blamed engine
   calls on whatever Lua function ran next; it now times calls into the engine by name (`(engine) pump_chunks`).
4. **UI:** text aligned around a point without a width box; `nova.ui.list` (a scrolling list or grid for keys, wheel and
   pointer); `nova.input.cursor` (a stick as the pointer, so every pointer menu works with a controller); `nova.ui.cube` (a block as
   an isometric icon through a new UI mesh pass); text entry (`nova.input.typed`, `nova.ui.text_field`, an on-screen
   `nova.ui.keyboard`). Blockfield's make menu lost its hand-written scrolling and now names the world from the pause screen.
5. **Draw cost:** lone cubes (dropped items, particles) sort by kind so equal ones are instanced; the GPU buffers of script-made
   meshes are reused instead of recreated for every rebuilt piece (a GPU test counts them).
6. **Lighting and saves off the game thread.** The surprise was that the thread was not the point. A chunk's light made on a
   worker costs 0.07 ms; the rest, on the game thread, was a border pass that flooded every neighbour that was present but not
   lit yet (4 ms a chunk in a flat test world). Skipping unlit neighbours (each does its own border when it is lit) made the light of
   a chunk 20 times cheaper on any thread (0.2 ms), and the workers now take most of the rest. The result is checked against the first
   implementation, kept as a test-only oracle, for a lone chunk and for a patch of bumpy ground lit in the opposite order.
   **Loading 113 chunks (release, M4): 40 ms of real time, a mean frame of 0.2 ms and a worst of 1.7 ms**, from 133 ms and 9.3 ms
   before this round (287 ms and a 12 to 14 ms spike for each chunk before the first). Saves (the periodic `save.json` flush and
   the world file) are written by another thread.
7. **A build flake:** the first `cargo test --release` after every edit failed to link, because the release profile's
   `panic = "abort"` made cargo build the library in two flavours that wrote the same unhashed cdylib file. `panic = "abort"` now
   applies to the Android targets only (`.cargo/config.toml`; the Android build still gets it).

Guarded by `crates/nova-runtime/tests/blockfield.rs` (the world makes itself, on threads and without; a player lands on it; digging changes a
chunk; a long walk streams chunks and stays in a band; a recorded session; a saved game with items; icons; naming the world) and the
unit tests in `voxel.rs` (light against its first implementation, meshes on workers and not, sections, ray, box, saving, noise), `terrain.rs`,
`save.rs` and `inputscript.rs`.

## Probe 3: Bunker Run (`examples/bunker-run`), a first-person shooter in rooms

A small level of rooms, corridors and doors, three kinds of enemy that find their way round walls and see (or do not see) the
player, two weapons with hit scan and a spread, pickups, a key and a boss room. The level is box geometry made by code, so the
whole thing is about what an engine needs for *indoor* 3D that is not made of voxels. Programmer art; the game is not the point.

### What it is meant to stress

| Area | What the game does | Hypothesis (written before building) |
| --- | --- | --- |
| Wall collision | the player and enemies slide along walls; doors open and close | Scenery is circles on the ground, so none of this works: no boxes, no walls, no doors. |
| Rays | hit scan stops at a wall; enemies check line of sight; bullets leave holes | `nova.raycast` finds entities and `nova.scenery.raycast` finds circles. Neither stops at a wall, and nothing can mark one. |
| Finding a way | enemies chase round corners and through open doors | There is no path finder: enemies will walk into walls and stay there. |
| Drawing a level | rooms of walls, floors, ceilings, lamps | `nova.model` scales evenly, so a wall of any length needs a model per length; levels would have to be authored model by model. |
| Lights | lamps in every room, muzzle flashes, explosions | Eight point lights a frame is too few for a lit corridor: lights will pop on and off as the nearest eight change. |
| Sound | shots, steps, doors, the boss | Positional sound exists now; the voice limit (32) will be hit by a firefight. |
| Speed | a dozen enemies, each with a path and a ray to the player | Lua will carry the AI; paths and rays must be native or the frame will go over budget. |

### What happened

Built in a day: the engine pieces first (`walls.rs`, `game/walls_api.rs`), then the game (about 700 lines of Lua in
`examples/bunker-run`: the level is a 25 by 17 map drawn in text, three metres a character; five kinds of creature; two weapons;
doors, a key, a boss). The game ships with a bot (F9; F6 for god mode) that plays it, and a test lets the bot win it.

1. **Wall collision: confirmed, built.** There were no boxes. `nova.walls` adds boxes with a height range; `push` and `move` slide a
   round body along them (in steps shorter than the body, so a thin wall is not skipped); a door is a wall that is switched off
   while it is open. Scenery's circles stay for what is round.
2. **Rays: confirmed, built.** `nova.walls.raycast` stops at a wall (a ray rising over a low wall passes it; one coming down onto a
   wall's top hits the top), `line_clear` is line of sight. The game puts a floor and a ceiling under and over that itself, and asks
   `nova.raycast` for creatures; the nearest of the four wins. Holes are `nova.quad3` (a flat mark on a surface), tracers `nova.line3`.
3. **Finding a way: confirmed, built, with a lesson.** `nova.nav` builds a grid from the walls and finds paths over it (A*, pulled
   tight so a path has few corners). The first version left every creature (and the bot) stuck in its room, because a shut door
   is a wall, so there was no way out of a room to a door that something would have opened. Fix: `nova.nav.build { ignore = {...} }`
   leaves out the walls of doors that can be opened (not the red one before the key). A path costs 0.27 ms (worst 0.40) and the grid
   0.4 ms to rebuild when a door changes (about 100 by 68 cells of 0.75 m), on an Apple M4.
4. **Drawing a level: confirmed, built.** `nova.cuboid` and `cuboid_at` draw a box between two corners or by its middle: every box is
   an instance of one mesh, so the level (about eighty boxes), the doors, lamps, pickups and every creature's parts (a man is ten
   boxes) cost 0.55 ms of drawing. No textures: walls are flat colours, and tiling a picture along a stretched box is the
   obvious next gap.
5. **Lights: confirmed.** A frame wanted 13 to 16 lights (every lamp in sight, the pickups, drones, muzzle flashes) and the
   engine took 8, so lamps popped as the nearest eight changed. The limit is 16 now. Using 15 instead of 8 cost 0.64 ms of drawing
   against 0.55 (about 16% more, on a laptop GPU); the game uses 12. What a handheld's fragment shader makes of a loop over
   twelve lights is the thing to measure on the device; the way out if it hurts is a light list for each object or tile.
6. **Sound: not stressed.** Positional sound (the creatures, the doors) worked; whether a firefight reaches the 32 voices was not
   measured.
7. **Speed: fine here.** A whole playthrough with ten creatures, each with a path every half second and a ray to the player,
   runs at 0.18 ms of Lua a frame (0.46 at the 95th percentile) and 0.77 ms for the frame. Not measured on a device.

Things found that were not on the list:

- **The framework moves entities that have a `vx` or `vz`.** The player kept his own velocity in `vx`, `vz` and also slid himself
  with `nova.walls.move`; the engine added `vx * dt` to his position again after his update, past the walls. Found because the bot
  kept drifting after the level was won. Not a bug (a built-in velocity is a feature), but a trap: the fields are now `walk_x` and
  `walk_z`, and the TODO lists a warning or an opt-out.
- **A hitbox's `base` is measured from the entity's `y`**, not from the ground: a drone that floats at 1 m with `base = 1` could not be
  hit by a shot at its own height.
- **Two games drew a weapon in the hand the same way** (Blockfield's block, Bunker Run's pistol): the camera's right, up and forward
  worked out by hand. An engine helper for camera-relative placement would remove it.
- **A bot is the best test the game has.** It found the door problem, the velocity trap and two bugs in its own aim in a few runs.


### Next probes worth making

- A **3D platformer**: height for things that are not voxels. Scenery collision is circles on the ground, so there are no
  floors, ramps or ledges outside a voxel world.
- A **first-person shooter in rooms**: rays now exist, but the walls they can hit are only circles (or voxels); rooms need
  boxes or wall segments, doors and line of sight around corners.
- **Blockfield on the device**: frame rate with a 5-chunk view, the cost of meshing on a Snapdragon, and whether the engine
  needs threads for it (see the TODO).
