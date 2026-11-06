# Performance: what we can say about 60 fps, and how to find out

Written 2026-11-04 with no handheld at hand; **the first Retroid Pocket 6 run (2026-11-05) is in its own section below** and replaced the
estimates for the stress benchmark. Everything else was measured on the desktop (an Apple M4) or the Android emulator (arm64 guest on
this Mac's CPU, with the host GPU behind a virtual one); the section "What that suggests" is the old estimate, kept to show how far off it was.

## The tools

- **`nova.perf()`** (Lua) and the one-line log the runtime writes every second (`fps= upd= lua= render= gpu= draws= sprites= tris=
  culled=`; logcat tag `nova` on Android): frames a second, the 95th percentile and worst frame, milliseconds of Lua, of
  recording the frame (`render`, the CPU's cost) and of the **GPU's own time** (`gpu`, from timestamp queries, read back a
  frame late; 0 where the adapter cannot do it).
- **`examples/stress`** (Nova Stress): a benchmark, not a game: a city of Kenney's pieces (up to 48 by 48 tiles, about 2,300
  models), 300 cars, 200 skinned characters, 16 point lights and shadows, in ten phases. **`scripts/bench.sh`** builds it,
  installs it on a device or the running emulator, runs it and prints a line a phase; `scripts/bench.sh --desktop` runs it headless
  here (its per-second numbers lag, because a headless run is not paced by a display).

## What the engine does about it now

- Instancing: every draw of one mesh in a frame is one GPU draw call (a city of 2,000 buildings of six kinds is eight draws).
- **Frustum culling** of the world pass (a sphere per mesh, moved and scaled by each instance), and a far plane that follows the fog:
  nothing past where the fog has covered everything is drawn. The sun's shadow pass is culled against the sun's own box (what the camera
  cannot see can still cast a shadow into view, so it is not the camera's set).
- **Retained scenery and level of detail**: `nova.scenery` pieces live in Rust and are put into each frame without a Lua call per
  piece; a piece may name a cheaper model for when it is far (`lod`, `lod_distance`).
- **GPU skinning**: hundreds of animated characters are a few draw calls.
- Identical textures are shared (every model of a kit carries the same palette).
- The world renders at the manifest's `world_height` (540 for the handheld) and is scaled up: fill rate is small.

## Measurements (milliseconds; the frame budget at 60 fps is 16.7)

Desktop, M4, headless, worst case of the stress benchmark (48 by 48 city, 300 cars, 200 characters, 16 lights, shadows,
1.2 million triangles drawn after culling): GPU 6.8 ms, recording 6.7 ms, Lua 2.8 ms.

Emulator (`retroid-sim`, host GPU, vsynced at 60), by phase, after the retained scenery list, shadow culling and level of
detail (2026-11-04; the city is now scenery; the host GPU is shared with the desktop, so a millisecond either way is noise):

| Phase | Triangles | GPU | Lua | Recording |
| --- | --- | --- | --- | --- |
| sky only | 0 | 0.0 | 0.14 | 1.3 |
| city 12 by 12 | 78 k | 0.0 | 0.07 | 1.2 |
| city 24 by 24 | 208 k | 0.0 | 0.08 | 1.2 |
| city 48 by 48 | 577 k | 3.3 | 0.08 | 1.3 |
| city 24 + 200 cars | 572 k | 3.3 | 0.34 | 1.6 |
| city 24 + 100 characters | 318 k | 3.3 | 0.30 | 1.2 |
| city 24 + 16 lights | 216 k | 3.3 | 0.07 | 1.5 |
| city 24 + shadows | 216 k | 3.8 | 0.08 | 1.7 |
| street level, city 48 | 623 k | 3.6 | 0.09 | 1.1 |
| city 48, far buildings cheaper | 154 k | 2.9 | 0.11 | 1.3 |
| street level, city 48, cheaper far buildings | 175 k | 2.2 | 0.08 | 1.5 |
| worst case (no LOD) | 1.13 M | 7.5 | 1.14 | 1.5 |

(A GPU time of 0.0 means the timer had no fresh reading in that phase, not a free frame: the timer is read a frame late and
skips frames while a reading is outstanding. The earlier table, before these three changes, had the city 48 at GPU 4.5 and
Lua 3.0, the shadowed city 24 at 3.9 and the worst case at GPU 9.9 and Lua 3.6.)

What changed: the city's 2,300 tiles are no longer a Lua call each per frame (Lua 3.0 ms to 0.08 in the 48-by-48 city); the
shadow pass skips what the sun's box cannot see (the worst case's GPU 9.9 to 7.5, with the same triangles drawn);
and a piece of scenery can name a cheaper model beyond a distance (`lod`, `lod_distance`): triangles drawn in the 48-by-48 city fell
from 577 k to 154 k and the street-level view from 623 k to 175 k, and GPU time from 3.3 to 2.9 and 3.6 to 2.2. (The far
buildings here are Kenney's low-detail ones stretched to the full ones' size; they are not the same buildings, which is
visible in a close look at the horizon.)

Every phase held 60 fps on the emulator. That says the engine has no gross problem, and nothing about the Retroid.

## Measured on the Retroid Pocket 6 (2026-11-05, first run)

Device: Retroid Pocket 6, Android 13, Snapdragon 8 Gen 2 (`kalama`), adapter "Adreno (TM) 740 (Vulkan, IntegratedGpu)", 1080x1920
panel run in landscape, display in its 60 Hz mode (it also offers 120 Hz: not tried), on AC power at about 37 C. Debug APK,
`scripts/bench.sh`, one cold run of about 80 seconds. `gpu` is the GPU's own time from timestamp queries (they work on this
driver); the frame budget at 60 fps is 16.7.

| Phase | Triangles | GPU | Lua | Recording | fps |
| --- | --- | --- | --- | --- | --- |
| sky only | 0 | 0.26 | 0.09 | 0.74 | 59.7 |
| city 12 by 12 | 78 k | 0.95 | 0.07 | 0.82 | 59.7 |
| city 24 by 24 | 210 k | 1.73 | 0.08 | 0.83 | 59.7 |
| city 48 by 48 | 625 k | 4.05 | 0.15 | 0.89 | 59.7 |
| city 24 + 200 cars | 566 k | 3.47 | 1.03 | 1.18 | 59.6 |
| city 24 + 100 characters | 316 k | 2.46 | 0.85 | 0.86 | 59.7 |
| city 24 + 16 lights | 209 k | 4.61 | 0.11 | 0.91 | 59.7 |
| city 24 + shadows | 209 k | 4.25 | 0.06 | 1.15 | 59.7 |
| city 24 + toon, outline, grade | 209 k | 2.10 | 0.12 | 0.71 | 59.7 |
| street level, city 48 | 669 k | 3.80 | 0.09 | 1.03 | 59.6 |
| city 48, far buildings cheaper | 177 k | 1.59 | 0.16 | 0.97 | 59.7 |
| street level, city 48, cheaper far buildings | 188 k | 1.50 | 0.18 | 1.07 | 59.7 |
| worst: 48 + 300 cars + 200 characters + lights + shadows | 1.15 M | 13.30 | 2.69 | 1.12 | 59.7 |

What this says, and does not:

- **Every phase held 60 fps, including the worst case**, whose GPU time (13.3 ms) is under the 16.7 ms budget with 1.15 million
  triangles, 200 skinned characters, 16 lights and shadows. The estimate below (25 to 30 ms for that phase) was about twice too
  pessimistic: on this load the Adreno 740 took 13.3 ms against 6.8 on the M4 and 7.2 on the emulator's host GPU, so about 2 times
  slower than the M4, not the 3 to 4 times I had assumed. The CPU side is tiny (Lua 0.1 to 2.7 ms, recording about 1 ms).
- **The headroom is thin only in the worst phase**: 13.3 ms of GPU leaves about 3 ms. Lights (4.6 ms for the city of 24) and shadows
  (4.3) are the most expensive single features here; the toon, outline and grade phase cost no more than the plain city.
- **Not measured**: sustained speed after minutes of heat (this was one cold run), 120 Hz, battery use, a real game on the
  controller, and the frame-time spikes of loading. The p95 frame time of 17.6 to 18.9 ms is the 60 Hz display's own 16.7 plus
  what the log's timing adds; the longest frame was 19.5 ms, well short of the 33 ms a missed vsync would show.

### Eleven minutes of it (2026-11-05, `scripts/heat-run.sh`)

The benchmark eight times in a row (about 80 seconds each, 11 minutes in all), on AC power, display at 60 Hz, starting from a device
that was already warm (battery 30 C, hottest chip sensor 64 C after the earlier runs). Three phases per run:

| Run | city 48 by 48 (fps / GPU ms) | city 24 + shadows | worst case | hottest sensor |
| --- | --- | --- | --- | --- |
| 1 | 59.7 / 4.02 | 59.8 / 4.28 | 59.7 / 14.80 | 63.5 C |
| 2 | 59.7 / 4.03 | 59.7 / 4.28 | 59.8 / 14.74 | 64.7 C |
| 3 | 59.7 / 4.02 | 59.7 / 4.28 | 59.7 / 14.68 | 64.7 C |
| 4 | 59.7 / 4.03 | 59.6 / 4.29 | 59.8 / 13.29 | 65.1 C |
| 5 | 59.9 / 4.02 | 59.7 / 4.28 | 59.7 / 13.29 | 65.5 C |
| 6 | 59.8 / 4.02 | 59.7 / 4.29 | 59.7 / 13.28 | 65.9 C |
| 7 | 59.7 / 4.03 | 59.8 / 4.29 | 59.7 / 14.67 | 65.5 C |
| 8 | 59.7 / 4.02 | 59.7 / 4.27 | 59.7 / 13.32 | 65.5 C |

No sign of throttling: the frame rate stayed at 59.7 to 59.9 in every phase of every run, the two lighter phases' GPU times did not
move (4.02 to 4.03 and 4.27 to 4.29), and the worst case's GPU time jumped between about 13.3 and 14.7 ms with no trend (two clock
states, not a drift). The battery went from 30 to 32 C and the hottest chip sensor from 64 to 67 C. The longest frame in any run
was 19.8 ms, so no vsync was missed. What this does not show: the worst case still leaves the GPU idle for 2 to 3 ms of every
frame, so this is not a test of a GPU run flat out, a game's own load (physics, audio, loading) is on top of it, and the device was
charging, which warms the battery side. A longer run, a heavier scene and a run on battery are still worth doing.

## What I expected for the Retroid Pocket 6 (an estimate made before the run; see the measurements above)

The Snapdragon 8 Gen 2 is slower than an M4 by roughly 2 to 2.5 times on one CPU core and by roughly 3 to 4 times on the GPU
(from public benchmark comparisons; I have not measured it). Applying those:

- **CPU** (Lua plus recording, which run on the game's thread): recording is about 1.2 to 1.7 ms here, so perhaps 3 to 4 on the
  device; Lua is small once static things are scenery. Lua's cost still grows with every `nova.model` call (about 1 microsecond
  each on the M4), so draw only what moves with `nova.model` and put the rest in `nova.scenery`.
- **GPU**: the city of 24 by 24 (about 200,000 triangles) is under 4 ms here, so up to 12 to 16 ms on the device (borderline) without
  shadows and lights; the 48 by 48 city with cheaper far buildings 2 to 3 ms here, so perhaps 8 to 10 ms; the worst case
  (7.5 ms here, down from 9.9) is perhaps 25 ms on the device, still over.
- So: a game on the scale of Sky Garden (12,000 triangles, 20 draws) has several times the headroom it needs; a city of a few hundred
  buildings with a dozen cars and a few characters is plausible at 60; a dense open scene with shadows and many lights is not, without
  level of detail and a lighter shadow pass (the retained list, shadow culling and level of detail are in; the shadow pass could still be lighter, with a smaller map or fewer casters at distance). Sustained speed after minutes of heat is a separate question that
  only the device can answer.

## To do on the device

Done once (above), and an 11-minute heat run (no throttling seen). Still to do: a real game on the controller, a longer and heavier run on battery. The first line of advice stands: If `gpu` is 0, the
adapter has no timestamp queries and the log's `fps` and `p95` are all there is. Then look at the three costs in the order
above and decide what to build.

## Pop-in

Things that appear or change suddenly are the visible cost of every saving above, so each one has a rule:

- **Culling** (camera and sun) uses a bounding sphere grown by the instance's scale, never smaller than the mesh, so nothing is
  dropped while any of it is in view. A shadow can still start or stop at the edge of the sun's box (`nova.shadows` radius);
  that is the shadow map's own limit.
- **The far plane** follows the fog and stops 5% past where it is complete, so nothing is clipped that was still visible.
- **Scenery range** by default reaches where the fog has covered everything (300 m without fog), not a fixed 200, and the last
  12% fades out by a screen-door instead of vanishing. Setting `nova.scenery.range` yourself under the fog distance brings
  the edge back, so leave it alone.
- **Level of detail** is a crossfade: across `lod_fade` metres both models are drawn, the near one dropping the pixels the far
  one keeps (fixed noise per pixel, so it does not shimmer), so every pixel is drawn once and the picture changes a little
  at a time. A test measures it: the biggest step between pictures a metre apart is under a third of the whole change with the
  fade, and nearly all of it in one step without. The stipple is visible if you look for it in a screenshot; at 540p it is small.
- **Voxel chunks** fade in over 0.4 s (`nova.voxel.draw { fade }`, 0 for none) the first time a section is drawn, and the last
  tenth of the draw distance fades out; a section rebuilt by an edit keeps its age, so building does not flicker. Blockfield asks
  for the chunks ahead of the player's heading first (three chunks nearer when straight ahead), and its fog ends at the draw
  distance, so the edge is fog. A player who outruns what the workers can make still reaches the edge: the loading radius
  against walking speed is the game's to choose, and the numbers for a handheld are not measured.
- **Point lights**: a game may ask for any number; the 16 nearest the camera (by the edge of their reach) are lit, and a
  light that moves in or out of that set fades over a quarter of a second. A new light is on at once and one that is no longer
  asked for is off at once (a muzzle flash is the script's to time). The renderer has room for 20 so that fades overlap.
- **`nova.model`** takes `lod`, `lod_distance` and `lod_fade` like scenery (plain models: not with `clip` or `parts`), so a
  car or a prop that a script draws can swap to a cheaper model by the same crossfade.
- Still pops, or not covered: a level of detail for animated (skinned or `parts`) models; the far model must be made to match the
  near one (Kenney's low-detail buildings in the stress city change shape as they swap); the sun's shadow edge at the box's
  limit; and anything a script itself makes appear.

## The look (`nova.look`)

The toon ramp is arithmetic in the mesh shader. An outline or colour adjustment sends the world through the finishing pass with the
depth buffer stored (normally it is discarded, which a tiled mobile GPU likes) and read five times a pixel for an outline. On the
Retroid (2026-11-06, `scripts/bench.sh`, GPU ms of the city of 24 blocks, which is 1.73 plain): toon, outline and grade 2.1;
**bloom 3.0** (12 taps of the picture a pixel, so +1.3 ms); **ambient occlusion 2.6** (8 depth reads a pixel, +0.85 ms); bloom and
ambient occlusion with shadows 5.5 (shadows alone 3.4, so the two cost about 2.1 together). All held 59.6 to 59.7 fps. The
post pass costs by the pixel, so the cheap way to cut any of it is a smaller `world_height` (540 is the default of the
Retroid games; 405 takes about a quarter off).
