# Pine Ridge Rally

A 3D rally game for Nova: two circuits, three rivals, a chase camera, menus, music and sound. Play it with
`nova run examples/pine-ridge-rally`, or open it in the studio (Examples in the project hub).

**Controls** (keyboard, gamepad and touch): steer with the arrows, A/D or the left stick; accelerate with Up, W or the
right trigger; brake or reverse with Down, S or the left trigger; Space is the handbrake (slides); R puts you back on
the road; C changes camera; Esc or P pauses. F9 lets the computer drive for you (for demos and tests).

## How it is put together

Like any Nova project it is plain files, and most of them are what the studio's editors write:

| Folder | What is in it |
| --- | --- |
| `models/` | 31 models made in the model editor's format: four cars (a body, and four wheels that spin, steer and ride the bumps on their own), pines, rocks, cacti, mesas, barriers, the start arch, road pieces, mountains. Each is a `.model.json` and the `.glb` the game loads. |
| `sprites/` | Pixel sprites: the flag, the medals, the menu cursor. |
| `sounds/`, `music/` | 14 sound effects (the sound editor's synth; the engine, gravel and tyre squeal are loops the game steers while they play with `nova.sound.set`) and four songs (the music editor's sequencer, streamed as Ogg): menu, a theme for each circuit, and the results fanfare. |
| `scenes/` | `pine_ridge`, `dust_valley` (a circuit each), `title` and `results`: each is a layout (`.scene.json`: road pieces, scenery, waypoints, the start grid, a camera) and the code that runs it. |
| `entities/` | One small file per kind of thing a layout can hold (`pine.lua`, `road_dirt.lua`, `waypoint.lua`...), and the cars. |
| `lib/` | `race.lua` (countdown, laps, places, camera, HUD, pause), `track.lua`, `world.lua`, `ui.lua`, `audio.lua`, `state.lua` (options and best times, saved). |

Thousands of fixed things (road pieces, trees, barriers) would be slow as live entities, so each one hands itself to
`lib/world.lua` when the scene is built; the world draws only what is near the camera and tells cars what they hit.

## How it was made

The models, sounds, songs, sprites and layouts were made through the Nova MCP server (`docs/mcp.md`), the way an
assistant (or a script) drives the studio's own code: see `scripts/rally/` (`models.mjs`, `audio.mjs`, `sprites.mjs`,
`tracks.mjs`, `showroom.mjs`). Each script is a list of tool calls whose results are the files in this folder. Running
`node scripts/rally/models.mjs` (and the others) writes them again; the Lua is hand-written.

`crates/nova-runtime/tests/rally.rs` plays the game through its menus and a full race on both circuits.

## Not done

Nothing has been played on a real device or by a person yet: the handling, the sounds and the music were tuned by
numbers, headless pictures and a computer driver, not by ear or by hand. There is one time-trial-less race mode, no
split screen, no pit stops, and no tyre or damage model.
