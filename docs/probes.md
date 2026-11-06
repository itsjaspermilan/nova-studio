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


### Baked lighting (the second step of Probe 3)

The first version lit the level with an ambient floor turned well up and the lamps as live lights, which looked flat (and, asked
about, was not proper lighting: a lamp lit floors through walls, corners were not darker, and the nearest eight lamps popped in
and out). `nova.bake.level` fixes that the way Blockfield's blocks do, for any boxes: each face is cut into squares of a metre
and each corner is lit once, at load, by every lamp that can see it (`nova.walls` stops the light, so a lamp lights its own room
and not the next; rooms are lit by their own lamps, the arena red), softly by how the corner faces the lamp, with the corners and
the bottoms of walls darkened a little by rays that feel for walls nearby. The light is stored in the vertices as a hue and an
intensity that the mesh shader adds to the live light (box colour times ambient plus live lights plus baked light), so a muzzle
flash and a drone's lamp still light the baked walls on top. The level is one mesh and one draw.

- **Cost:** 12,264 vertices (the whole level, floor and ceiling included, cut into squares of a metre) took 6 ms to bake on an Apple
  M4, once, at load. At run time: one draw, no cost per lamp. The 16 live lights are for what moves, so they no longer pop:
  a frame wants 8 or fewer now (it wanted 13 to 16).
- **Gaps left:** a door opening does not let light through (the bake is of the doors shut; the doors themselves are live-lit), nothing
  bounces, there is no shadow from a live light, and the boxes are still flat colours.
- **Not measured:** the bake on a handheld (a few times slower, which is still well under a second), and what the one big
  mesh costs the Retroid's GPU.

## Probe 4: Sky Garden (`examples/sky-garden`), a 3D platformer

Platforms hanging in the air, stairs and ramps, platforms that slide and rise, a gem on every few, a few patrolling creatures to
stomp, a checkpoint, a flag at the end, and a third-person camera that follows. Programmer art. Blockfield got standing, falling
and stepping from `nova.voxel.move`; this is the same in a world that is *not* made of voxels, which the engine has never done.

### What it is meant to stress

| Area | What the game does | Hypothesis (written before building) |
| --- | --- | --- |
| Floors, ledges, steps | the player stands on a platform's top, walks off its edge and falls, steps up onto a low block, bumps his head under a high one | `nova.walls` pushes a body sideways only: there is nothing to stand on. Only voxels can be stood on. |
| Ramps | walks up and down slopes and stays on them | There are no slopes at all. Stairs of little boxes would need a step-up that does not exist outside voxels. |
| Moving platforms | slide and rise, and carry the player | A wall is fixed where it was added. Nothing says what a body standing on a moving thing should do. |
| The camera | follows from behind and above, and does not go through a wall or a platform | `nova.cam3.follow` ignores geometry: the camera will end up inside things. |
| Judging a jump | a shadow under the player on whatever is below, and the first jumps feel right (jump buffering, coyote time, a variable height) | There is no way to ask "what is under here?", so no shadow. The rest is script and should work: the step is a fixed sixtieth of a second. |
| Many moving parts | a dozen platforms and creatures, each asking the walls things every step | Fine, if the questions are native. |

### Results

Built 2026-11-04: `examples/sky-garden` (about 450 lines of Lua) and `crates/nova-runtime/tests/sky.rs`. Four tests: the player
stands on the island, walking off the edge falls and respawns, the camera is pulled in by a pillar (and by nothing in the open),
and a bot (F9) plays the garden to the flag (stairs, a ramp, two moving platforms, jumps across gaps, gems; it wins in about
20 seconds of game time).

| Hypothesis | What happened |
| --- | --- |
| Nothing to stand on outside voxels | **True.** Built: `nova.walls.move3` (a body with a height moves in three dimensions: up and down first so that a fall lands and a jump bumps a ceiling, then x and z, sliding, climbing anything up to `step` high, staying on a slope going down), `floor_below`, and box heights on the walls that were already there. Unit tests in `walls.rs` (14) and one Lua-level test in `framework.rs`. |
| No slopes | **True.** Built `nova.walls.add_ramp` (a slope along x or z; its sides are walls, its high end is a cliff). One kind of slope only; no turned or curved ones. |
| A wall is fixed; nothing says what to do on a moving thing | **True, and the answer is small.** `nova.walls.set_box` moves a wall; the *script* then moves what stands on it by the same amount (`move3` with the platform's delta). A platform that rises is handled by the step-up (the player is a little inside it and is lifted). The platforms must move before the player does: the scene does it in `update`, which runs before the entities (checked: the ride is smooth, 400 carried frames in the bot's run). A platform's *side* does not push a player (nothing here needed it). |
| The camera ends up inside things | **True for `cam3.follow`; fixed in the game, not in the engine.** One ray from the player's head towards the camera spot (`nova.walls.raycast` with a slope), pulled in before it, and lifted over the ground with `floor_below`. A single ray does not stop the camera's corner clipping into a wall edge; a sphere or four rays would. Left as a gap. |
| No shadow, because nothing says what is under a place | **Half true.** `floor_below` makes it a call and the jumps are readable with it. But `nova.quad3` ignored alpha at first, so the blob shadow was a solid square (grey in a desktop PNG, black on Android; fixed). |
| Jump feel works from script at a fixed step | **True.** Coyote time (0.1 s), a buffered press (0.12 s), a shorter jump when the button is let go, gravity 30 and a jump speed of 11 (a 2 m jump, 4.4 m across at a run), air control weaker than ground control. The bot jumps by the same rules through the same code path. |
| Many moving parts | **Fine.** Four patrollers, two platforms, 20 gems, a player: about 0.10 ms of Lua a frame (mean; 0.17 at the 95th percentile) and 0.9 ms to render, headless on an M4. Nothing here says anything about a Snapdragon. |

What the bot found: it first fell off the platforms over and over because it left them at the wrong moment, and because it kept
its plan after respawning: both bot bugs, not engine ones. They show what a person will find: **timing a jump onto or off a moving
platform is the whole game**, and the platforms' speed (3 m/s at most) and width (3 m) are generous. Looking ahead along the
platform's track worked for the bot, and a game can do it because the track is a function of time.

Found, not fixed (also in the TODO):

- `nova.quad3` had no transparency (shadows, decals that fade); fixed the same day, after the Android emulator showed the blob shadow as a solid black square.
- No sloped mesh to draw a ramp with: the game draws twelve slices of boxes. A turned or tilted box would do it.
- Boxes still have no textures; the garden is flat colour.
- Islands are drawn as two boxes each (rock and grass); a box with a different colour on top would halve that.
- A body cannot be pushed by a moving platform's side or squashed under one.
- Ground ids are numbers with a sign (ramps are negative): easy to misuse. A kind and a number would be kinder.
- Nothing has been felt by a person with a controller; all of the above is a bot and tests.

### Kenney's Platformer Kit (added the same day)

The player, the patrollers, the gems, the flag, the checkpoint sign, the two moving platforms and some scenery are models from Kenney's
Platformer Kit (CC0; notice in `licenses/kenney-platformer-kit.txt`; `scripts/kenney.mjs` copies the eleven that are used). The
characters are skinned and carry 25 clips; the game plays `idle`, `walk`, `sprint`, `jump` and `fall` by what the body is doing. The
engine took them without change except one thing: **a .glb that points at a texture file (`Textures/colormap.png`) does not load**
(`external reference in slice only import`), so the script embeds the texture in each .glb. (The characters also exposed that animated models were capped at 8 draws a frame and skinned on the CPU; both fixed the same day by GPU skinning, see the TODO.) A frame now has 20 draws and 10,000 triangles
(was 7 draws and 900), rendered in 1.1 ms (was 0.9) headless on an M4. The level is built from the kit's own pieces too (`lib/level.lua`): the islands are 4 m `block-grass-large` tiles (the kit's metre is
two of ours, so a block is 2 m tall and a jump is about one block up and one block across), the ramps are `block-grass-large-slope` and
`-narrow` with a ramp added to the walls under each, the pillar is three `block-grass-narrow`, and every solid piece adds a box to the
walls. Findings: (1) pieces drop in without engine changes, and the walls and the models agree if each piece's box is its nominal
size (the models overhang by 4 cm). (2) Slopes only fit if the next island is placed at the slope's rise (1.5 m, not a block's 2 m),
so heights are not on the block grid; the game places pieces at any height. (3) The bot needed re-timing for the wider platforms but
nothing else. (4) The goal became 10 of 16 gems: the bot's detours miss a few off its line, which is a bot limit, not a level one.
A frame is now about 24 draws and 12,000 triangles.

### Kenney's kits in the other two games (2026-11-04)

**Pine Ridge Rally** (`scripts/rally/kit-models.sh`): the four cars (the car kit's race car, sports sedan, sports hatchback and future racer), the pines, birch and autumn trees, bushes and rocks (platformer kit), and the guardrail, street lamp and start arch (racing kit) are kit models. The car's own code was not touched except for four numbers: the kit's wheels are separate nodes, so the converter renames them to the `wheel_fl` and so on the suspension and steering code turns, re-centres each wheel so that it spins and steers about its middle (the kit puts the node's origin on the car's side of the wheel), and centres the car on its axles. Collision circles went into each file's `extras.nova.colliders`, where the runtime reads them. The road is the racing kit's straight slab, stretched to the 12 by 6.25 m of the slabs it replaces (so the circuits did not have to be laid out again: `tracks.mjs` still puts one every 5 m along the centreline), in three colourings for asphalt, dirt and snow (the kit's road is plain material colours, so the dirt and snow versions are three colour changes), and the start line is the kit's start-positions slab. Every other slab is lifted 12 mm, because the slabs overlap and the kit's white lines flickered where two shared a level. Ground, mountains, tires, hay bales, signs, the tower and the desert and harbour props are still the editor's own models, and the red desert rocks are the kit's grey ones (the kit has no red).

**Bunker Run** (`scripts/bunker/kit-models.sh`): the guards, brutes and the boss are the platformer kit's characters (one skinned figure each, clips idle, walk and sprint picked by what the creature is doing, a red-hot tint for a moment when hit), the drones are the blaster kit's grenade, the pistol and shotgun are blasters, and the health, ammunition and key pickups are a crate, a clip and a key with a point light of their old colour. The level, the doors and the exit stay boxes. The creatures' hit boxes did not change and the bot still wins.

What it showed:
- The whole conversion is one script: size, rename, pivot, turn, centre and collide. Without it a kit's model does not drop in: its origin is a tile corner, its wheels are off-centre, its front is not the game's front, and a skinned character cannot be scaled in the file (its skeleton would not follow).
- The studio's scene view drew only models that have a `.model.json`, so the scenes' trees and cars vanished from it. It now reads a `.glb`-only model into a model for drawing and gives each face the colour its picture has under its points (`model-load.ts`, `glb-import.ts`): the kit's palette-textured models show in their own colours, as flat-shaded shapes. Tried in the browser preview on Pine Ridge Rally.
- Kit models are dull in Bunker Run's dark rooms (the old boxes were flat-lit or glowing): the creatures need a faint light of their own or the ambient raised.
- A weapon model's front, a character's front and a car's front are three different axes; each was found by looking at a frame.

### Next probes worth making

- A **first-person shooter in rooms**: rays now exist, but the walls they can hit are only circles (or voxels); rooms need
  boxes or wall segments, doors and line of sight around corners.
- **Blockfield on the device**: frame rate with a 5-chunk view, the cost of meshing on a Snapdragon, and whether the engine
  needs threads for it (see the TODO).

**Pine Ridge Rally on the Retroid Pocket 6 (2026-11-05, first play by hand).** Five things came out of it. (1) Stutters: the per-second log showed none (435 s at a mean 59.7 fps, one second under 57 at start-up), so single-frame hitches are what the average hides; the log line now carries `p95` and `max` and a frame over 25 ms logs a `hitch:` line with the update, Lua and render times of the last frame, ready for the next play. (2) The tyres bounced: the road's bumps are sampled at 60 fps while the car does 40 m/s, so each wheel's height changed by up to 1.7 cm (15 cm off the road) at random from one frame to the next; the wheels now follow the ground with a time constant of 70 ms (mean step 9.6 mm to 1.8 mm, worst 15.6 cm to 4.3 cm) and the road's own bumps are a third as big. (3) The triggers were not analogue because the Retroid reports a trigger as an axis and as a button (`pad:r2`), and the button made it all or nothing; the game now binds the axis only, the rebinding screen turns a pressed trigger into the axis, and a trigger pulled right through on the brake at speed locks the wheels (a key never does). (4) The HUD and menus were redone (one panel style, one font for numbers, readable hints, the menus on the left with the car on the right). (5) The cars are 3.7 m long instead of 4.53 (a fifth shorter), with the wheel, collision and shadow sizes to match.

**The rally's stutter was frame pacing (2026-11-05, confirmed on the Retroid).** The log showed no late frames while driving (the only long ones were the first frame after each launch), but the 95th-percentile frame time was 18 to 19 ms against a 16.67 ms display period: the moments at which the game starts its frames wander by a millisecond or two, the game moved everything by the measured time, and so motion between evenly shown pictures was uneven (7 cm of jitter a frame at 40 m/s). `pacing.rs` now gives the game exactly one display period for a step within 14% of it (or a whole number of periods for a missed frame), with the period worked out from the recent steps and snapped to the panel's nominal rate; the owner played a lap after it and the stutter was gone. A genuine long frame is passed on unchanged and the diagnostics still log the raw timings.

## Probe 5: Hill Run (2026-11-06): a character on a field of triangles

**Built to find out** whether `nova.solid` (a capsule against model triangles) is enough for a third-person game on hills: slopes, a
cliff, stairs, ledges, a climb. `examples/hill-run`: a 160 m field made by `scripts/hills/make-hills.mjs` (one 51,488-triangle model with
vertex colours by slope and height, `lib/level.lua` with the start, flag, gems and the bot's route), the Kenney character with the
animator, a camera that pulls in with `nova.solid.raycast`, a shadow blob on `nova.solid.floor_below`, gems and a flag. The field has
rolling hills (to 12 degrees), a 24 m hill with a 7 m cliff band round its top (74 degrees) and a long ramp up through it (about 39 degrees),
a staircase of 20 steps of 0.3 m, and blocks of 0.3, 0.8 and 1.6 m.

**What happened.** The capsule worked on the first run: it stands on the meadow, hops the 0.3 m steps (37 hops for the staircase and the blocks), climbs
the 37 to 39 degree slopes at a run, is stopped by the cliff and slides down it (a test walks a bot straight at the cliff for 40 s: it climbs
the hill to the foot of the cliff and no higher, with the slide counted), and the F9 bot walks the route to the flag (a test does it in
21 s of game time, with no falls). The 51,488 triangles became solid in 3 ms on the desktop and 7 ms on the Retroid. The bugs were mine, found
by the tests: the bot first walked into the platform's side (the route was backwards), and the level's notch cut the cliff but left the top
of the hill 7 m higher beyond it, so the path led into a trench under a second cliff (the notch is now a long ramp of the same 7 m).
**Found missing (to do):** nothing in the API stopped it; what a game still has to write itself is the slide (project the velocity off
`wall_normal` each frame, as `player.lua` does), the camera's ease over a hop (`stepped`), and moving ground. How it feels in the hands is
for the owner to say.

**Hill Run's character (2026-11-06): Kenney's protagonists, from FBX.** The kit ships only binary FBX (one model, one file per animation, four PNG skins), which the runtime does not read, so `scripts/fbx.mjs` (a reader for binary FBX 7.x) and `scripts/fbx2glb.mjs` (mesh, skin with 45 joints, the skeleton as nodes, the animations idle, run and jump, the skin picture embedded, the whole rig scaled to 1.8 m) turn it into `.glb` files. Things the files taught: the animation files hold two stacks, a one-frame "Targeting Pose" and the real take (the longest one is used); the cluster's own `Transform` leaves out the model's scale of 100, so the mesh is placed by the bind pose's matrix instead; the rig is 3.76 m of Blender units tall and scaled on its top-level node. The converter's result is checked by the picture (the character runs in Hill Run, textured) and by a test that the runtime reads each file as a skinned mesh with 45 joints and the three clips. Not read: cubic key tangents, blend shapes, vertex colours; the kit has no walk, fall or climb clip, so walking is a slower run and falling holds the end of the jump.

**Hill Run's buttons follow Breath of the Wild's (the owner's list, 2026-11-06), by the labels printed on the Retroid:** X jumps (pressed again in the air it opens the glider, against a wall it leaps off it), hold B to sprint, A (interact) and Y (attack) are free, the left stick moves and the right stick turns the camera; climbing needs no button. In the engine's names, which are Android's, that is `pad:west` for X and `pad:east` for B.

**Hill Run: climbing, gliding, stamina and two clips the kit does not have (2026-11-06).** The player has three modes. *Climb*: walking or jumping into a wall, or into a slope too steep for the capsule to stand on (`nova.solid.move` says `wall` and the normal), starts it by itself (it was a held button at first; the owner asked for it to start on its own), if there is some strength left and the stick is pushing at the surface; gravity is off, the stick moves along the surface (pushing at it is up), the clock runs (6 s), and when the wall under the hands ends while going up the body steps over the top (a mantle); jump leaps off the wall. *Glide*: a jump pressed in the air opens a canopy, 9 m/s along the heading and a 2.4 m/s fall, steering with the stick, at 0.7 of the climbing cost. *Stamina* comes back on the ground. Everything was done in Lua on `nova.solid`'s `wall`, `wall_normal` and `ground`: **no engine change was needed**, which is the answer to the probe's question. Bot tests: a bot climbs the 12 m tower, climbs the 74 degree cliff that walking cannot (the old test still shows walking cannot), and glides 76 m from 24 m up and lands walking. Things the climb needed that the API did not give for free: the wall must be remembered for a moment after contact (`wall_age`), because the capsule only reports `wall` on frames it pushed into one; and the top of a wall is found by the contact *ending*, not by a ledge query (a `nova.solid.ledge_above` that said "there is a floor 0.3 m above and 0.4 m ahead" would be steadier).

**The clips.** The kit has idle, run and jump only, so `scripts/hills/make-clips.mjs` writes `climb` and `glide` into the four characters: a clip is a function from time to bone turns in model space (degrees about x, y, z of a whole bone, added up down the chain, so a forearm turns with its upper arm), the script works out each bone's local rotation from the rest pose, and samples it at 30 Hz. The first try left the arms folded over the head (90 degrees is straight up, not 140) and then the palms facing sideways: the arm is turned a quarter about its own axis first, so that the palms face forward at the wall and the thumbs point inward, which is how a hand holds a wall. Checked in pictures only; the owner's eye is the test.

**Getting up over the top (2026-11-06, asked for by the owner; crude on purpose).** A `mantle` clip (1 s, key poses with straight lines between them in `make-clips.mjs`, so that the owner can tune them) and a `mantle` mode: when the hands have come to the edge, the body rises to its height for 0.45 s and then moves onto it for 0.6 s with no input, the clip playing once. Detecting "the top" by the wall ending under the hands was not enough on the 74 degree cliff (contact flickers as the body slides up it: 26 false mantles in a test): the climb now also asks for **a floor just ahead and a little above the feet** (`nova.solid.floor_below` from 1.5 m up, 0.55 m ahead, facing up, 0 to 1.35 m above the feet). That probe is the ledge query the API still lacks; as a function of its own (`nova.solid.ledge(x, y, z, dx, dz)`) it would serve every climbing game.

**After the owner played the climb (2026-11-06).** (1) The mantle sent the body 1.4 m up and 0.5 m on whatever the ledge was, then it fell back: it now rises exactly to the floor's height (from the ledge probe), smoothly over half a second, then moves onto it, and the clip bends more (the chest 58 degrees forward, a knee up to 100). A test checks that the feet never go more than 0.6 m above the tower's top and that it ends standing on it. (2) Gliding into a steep wall grabs it and climbs (the glider folds away); tested by gliding at the tower. (3) Hanging still on a wall costs no stamina (it costs only while the stick is pushing); tested by climbing for a second and then letting go of the stick for four. (4) Trees: the shader now also shakes the vertices of a crown by a small amount (they lean with the wind as before, which alone looked like a post leaning).

**More from the owner's play (2026-11-06).** (1) *A jump at the end of the getting up*: the animator took the first frames after it for a fall, because `air_time` had been running all through the climb; it now counts only while walking, and the mantle ends with the body standing on the floor. (2) *The climb clip kept moving while hanging still*: the animation speed was the body's horizontal speed, which includes the pull into the wall; it is now the stick's effort along the wall, so the clip freezes when the stick is let go. (3) *No shadows in the world*: Hill Run only had a blob under the player; `nova.shadows { radius = 42, strength = 0.55 }` is on now (trees, bushes, the terrain and the character cast; grass and flowers do not), which cost 1 ms of GPU on the Retroid (2.25 to 3.3 ms, 59.7 fps), and the blob is drawn only when shadows are off. (4) *Hands on the edge*: the getting up now starts when the ledge is 1.2 to 2.25 m above the feet, which is where the hands are with the arms up, and the body rises that far (a first version started it at the old height and found the ground at the foot of the tower: a ledge must be at least 1.2 m up, or the wall must have ended under the hands, for a low one). (5) *Another jump on landing from the glider*: the press that opened the glider was left in the jump buffer, which only runs down while walking, so it fired on landing; it is cleared when the glider opens and closes and when a climb ends. Each of these has a test, and the glider one was checked to fail without the fix.

**The getting up, again, with research (2026-11-06).** The owner found it still looked wrong, so I looked at how games do it ([a guide to climbing animation for games](https://mocaponline.com/blogs/mocap-news/climbing-animation-games-guide), [a mantle system with motion warping](https://danimtz.github.io/devpost/Mantle), and tutorials for Zelda-style climbing). What they agree on: a ledge climb is a short sequence of *phases*: grab, hang, a chin-up that brings the chest to the ledge, a leg swung over, a push up to standing, a step forward; **the hands must look as though they grip the edge the whole way**, which is done with IK that solves the arms each frame to reach the edge (without it the hands float above or sink into the ledge, which is what mine did: arms waved in the air while the body rose); **the movement is in two parts, up and then onto the ledge** (motion warping with a vertical and a horizontal section); and **a clip made for one height looks wrong on another**, so there are short, medium and tall variants, warped by about half a metre each. What `make-clips.mjs` does now: a two-bone IK for each arm (shoulder from the posed torso, the elbow found by a pole vector that points down, out and back) with the hands held to the edge in model space as the body rises and moves forward by the same two functions the game moves the body by; the IK fades into key poses at the end, when the hands let go; two clips, `mantle` (a ledge 1.5 m up) and `mantle_low` (1.15 m), the game choosing the nearer by how high the floor is when the hands reach the edge. The numbers that had to change: this character's arms are short (the shoulder is 1.13 m up and the arm 0.48 m, so the hands reach only about 1.6 m), so the getting up starts when the ledge is 1.0 to 1.55 m above the feet, not the 2.2 m I had assumed. Checked in side-view pictures of four moments of the clip against a block (the hands stay on the edge as the chest comes up) and in the game from behind. The game's feel is the owner's to judge.
