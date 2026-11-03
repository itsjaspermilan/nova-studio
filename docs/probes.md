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
   entities (checked against a plain scan on random positions). Still missing: a raycast (against scenery circles or
   entities) and 3D (height) overlap; tilemaps and `slide` are flat only.
3. **Drawing (a call per entity per frame): not a problem.** 1000 enemies draw in 13 to 17 draw calls (the renderer batches
   equal meshes) and cost 1.8 to 2.4 ms. A model with several parts would cost one draw per part per entity.
4. **Particles: fine at this size.** One short burst (a Lua emitter entity) per kill is inside the numbers above. Not
   pushed further.
5. **Camera and input: works, with gaps.** A smoothed follow camera and the first-person camera are 40 lines of Lua
   (`lib/camera.lua`); the stick-driven look and a camera-relative move are fine; there is no helper for either, no
   ray from the camera into the world (aiming at things the player points at, rather than the nearest), and no mouse look
   or pointer lock for a desktop build. Not fixed.
6. **UI: works with no layout help.** The HUD, XP bar and three upgrade cards were placed by hand with coordinates. It
   needed nothing that was missing, but every position is a magic number, there are no hit areas for touch and no
   focus/selection helper for cards (`left`, `right` and `a` were handled by hand). Not fixed.
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
  The same numbers are still not available inside a running game: there is no `nova.stats()` for an on-screen profiler.
  Not fixed.
- **Frame-time spikes: not garbage collection.** The worst frame is 1.4 to 1.6 times the mean at 1000 enemies (16 ms against
  11.7). Lua's generational mode and two tunings of the incremental one (`NOVA_GC` experiment, since removed) gave the same
  mean, 95th percentile and worst frame to within 3%. The spread follows how crowded it is around the player (more
  neighbours to push apart), which changes as the autopilot circles. Nothing to fix there.
- `nova.pause(true)` froze the whole swarm for the level-up screen exactly as wanted.

Guarded by `crates/nova-runtime/tests/swarm.rs`, which runs the game with 100 and with 600 enemies and fails if six times the
enemies cost more than fourteen times the time (the old version was about 27 times, from the table above).

### Next probes worth making

- A **3D platformer**: height. Scenery collision is circles on the ground, so there are no floors, ramps, ledges or
  jumping onto things; this will show how much of "3D" the engine does not do.
- A **first-person shooter in rooms**: raycasts (hit scan, line of sight), walls that are not circles, doors, pickups.
- A **big open world**: streaming and culling of far more scenery than the rally's 1,500 pieces, and memory.
