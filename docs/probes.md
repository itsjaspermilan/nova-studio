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

Guarded by `crates/nova-runtime/tests/blockfield.rs` (the world makes itself, a player lands on it, digging changes a
chunk, a long walk streams chunks and stays in a band) and 13 unit tests in `voxel.rs` (light, meshes, ray, box, saving,
noise).

### Next probes worth making

- A **3D platformer**: height for things that are not voxels. Scenery collision is circles on the ground, so there are no
  floors, ramps or ledges outside a voxel world.
- A **first-person shooter in rooms**: rays now exist, but the walls they can hit are only circles (or voxels); rooms need
  boxes or wall segments, doors and line of sight around corners.
- **Blockfield on the device**: frame rate with a 5-chunk view, the cost of meshing on a Snapdragon, and whether the engine
  needs threads for it (see the TODO).
