# Performance: what we can say about 60 fps, and how to find out

Written 2026-11-04, with no handheld at hand yet. **Nothing here is measured on the Retroid Pocket 6.** What is measured is the
desktop (an Apple M4) and the Android emulator (arm64 guest, which on this Mac runs on the host CPU, with the host GPU behind
a virtual one). The device numbers are estimates from stated factors and are marked as such.

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
  nothing past where the fog has covered everything is drawn. The sun's shadow pass still takes everything, because something
  out of view can cast a shadow into it.
- **GPU skinning**: hundreds of animated characters are a few draw calls.
- Identical textures are shared (every model of a kit carries the same palette).
- The world renders at the manifest's `world_height` (540 for the handheld) and is scaled up: fill rate is small.

## Measurements (milliseconds; the frame budget at 60 fps is 16.7)

Desktop, M4, headless, worst case of the stress benchmark (48 by 48 city, 300 cars, 200 characters, 16 lights, shadows,
1.2 million triangles drawn after culling): GPU 6.8 ms, recording 6.7 ms, Lua 2.8 ms.

Emulator (`retroid-sim`, host GPU, vsynced at 60), by phase:

| Phase | Triangles | GPU | Lua | Recording |
| --- | --- | --- | --- | --- |
| sky only | 0 | 0.2 | 0.06 | 1.2 |
| city 12 by 12 | 78 k | 1.0 | 0.3 | 1.2 |
| city 24 by 24 | 211 k | 1.1 | 0.7 | 1.0 |
| city 48 by 48 | 682 k | 4.5 | 3.0 | 1.0 |
| city 24 + 200 cars | 547 k | 4.5 | 1.1 | 1.1 |
| city 24 + 100 characters | 322 k | 2.0 | 1.4 | 1.4 |
| city 24 + 16 lights | 215 k | 3.9 | 1.2 | 1.2 |
| city 24 + shadows | 215 k | 3.9 | 0.8 | 1.3 |
| street level, city 48 | 805 k | 3.0 | 2.7 | 1.0 |
| worst case | 1.24 M | 9.9 | 3.6 | 1.4 |

Every phase held 60 fps on the emulator. That says the engine has no gross problem, and nothing about the Retroid.

## What that suggests for the Retroid Pocket 6 (an estimate, not a measurement)

The Snapdragon 8 Gen 2 is slower than an M4 by roughly 2 to 2.5 times on one CPU core and by roughly 3 to 4 times on the GPU
(from public benchmark comparisons; I have not measured it). Applying those:

- **CPU** (Lua plus recording, which run on the game's thread): about 7 to 9 ms in the city-24 range, over 12 ms in the worst
  case. Lua's cost grows with every `nova.model` call (about 1 microsecond each on the M4), so a scene of 3,000 drawn things
  spends 3 ms there, perhaps 8 ms on the device, and is better served by a draw list that Rust keeps between frames (a TODO).
- **GPU**: city 24 (200,000 triangles, 1 ms here) should be comfortable, 2 to 5 ms; the shadowed and lit city 24 about 4 ms here, so
  perhaps 12 to 16 ms on the device (borderline); the worst case (10 ms here) probably 30 ms or more.
- So: a game on the scale of Sky Garden (12,000 triangles, 20 draws) has several times the headroom it needs; a city of a few hundred
  buildings with a dozen cars and a few characters is plausible at 60; a dense open scene with shadows and many lights is not, without
  level of detail, a retained draw list and a lighter shadow pass. Sustained speed after minutes of heat is a separate question that
  only the device can answer.

## To do on the device

Run `scripts/bench.sh`, then replace the estimates above with the `gpu=`, `lua=` and `fps=` columns. If `gpu` is 0, the
adapter has no timestamp queries and the log's `fps` and `p95` are all there is. Then look at the three costs in the order
above and decide what to build.
