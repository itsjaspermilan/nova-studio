# Pine Ridge Rally

A 3D rally game for Nova: four circuits, three rivals, a chase camera, tyre wear and damage, controls you can remap, menus, music and sound. Play it with
`nova run examples/pine-ridge-rally`, or open it in the studio (Examples in the project hub).

**Modes:** a race against three rivals, or a time trial: alone on the circuit against a blue ghost of your best lap (kept in the save file).

**Controls** (keyboard, gamepad and touch): steer with the arrows, A/D or the left stick; accelerate with Up, W or the
right trigger; brake or reverse with Down, S or the left trigger; Space is the handbrake (slides); R puts you back on
the road; C changes camera; the right stick points the camera: wherever the stick points (left, right, behind, any angle between) the camera goes round the car and stays there, easing back when let go (press the stick to look back; Q and E on a keyboard); Esc or P pauses. F9 lets the computer drive for you (for demos and tests).

**The triggers are analogue**: how far you pull the right trigger is how hard the engine pulls, and the left trigger brakes by how far it is pulled. Pull it right through at speed and the wheels lock: the front stops biting, the rear lets go and the car slides (it takes about two thirds of the pull to be safe). A key or a button is all or nothing and never locks the wheels. (The Retroid's triggers report both an analogue axis and a button; the game binds only the axis, and the controls screen turns a pressed trigger into the axis.)

## How it is put together

Like any Nova project it is plain files, and most of them are what the studio's editors write:

| Folder | What is in it |
| --- | --- |
| `models/` | 37 models made in the model editor's format: four cars (a body, and four wheels that spin, steer and ride the bumps on their own), pines, rocks, cacti, mesas, barriers, the start arch, road pieces, mountains. Each is a `.model.json` and the `.glb` the game loads. |
| `sprites/` | Pixel sprites: the flag, the medals, the menu cursor. |
| `sounds/`, `music/` | 14 sound effects (the sound editor's synth; the engine, gravel and tyre squeal are loops the game steers while they play with `nova.sound.set`) and five songs (the music editor's sequencer, streamed as Ogg): menu, a theme for each circuit, and the results fanfare. |
| `scenes/` | `pine_ridge`, `dust_valley`, `frost_pass`, `harbour_lights` (a circuit each), `title` and `results`: each is a layout (`.scene.json`: road pieces, scenery, waypoints, the start grid, a camera) and the code that runs it. |
| `entities/` | One small file per kind of thing a layout can hold (`pine.lua`, `road_dirt.lua`, `waypoint.lua`...), and the cars. |
| `lib/` | `race.lua` (countdown, laps, places, camera, HUD, pause), `track.lua`, `world.lua`, `ui.lua`, `audio.lua`, `state.lua` (options and best times, saved). |

Thousands of fixed things (road pieces, trees, barriers) would be slow as live entities, so each one hands itself to
`lib/world.lua` when the scene is built; the world draws only what is near the camera and tells cars what they hit.

## How it was made

The models, sounds, songs, sprites and layouts were made through the Nova MCP server (`docs/mcp.md`), the way an
assistant (or a script) drives the studio's own code: see `scripts/rally/` (`models.mjs`, `audio.mjs`, `sprites.mjs`,
`tracks.mjs`, `showroom.mjs`). Each script is a list of tool calls whose results are the files in this folder. Running
`node scripts/rally/models.mjs` (and the others) writes them again; the Lua is hand-written.

`crates/nova-runtime/tests/rally.rs` plays the game through its menus and a full race on every circuit.

**Roadside and skids (2026-11-06).** `lib/roadside.lua` lays out grandstands, long tents, banner towers and flags at the start line, billboards on the straights and pylons on the outside of the hard corners, from each circuit's own waypoints (the props are racing-kit models, `scripts/rally/kit-models.sh`). Tyres that slide on the road leave dark skid marks (`lib/fx.lua`, the last 360 are kept).

**Cars and drifting (2026-11-06).** The four cars are the kit's own sizes at one scale (3.5 to 3.9 m) with 0.6 m wheels. Steering at low speed follows the wheels' angle (a parking-speed turn is slow, not a spin). The sedan and the hatchback drift: with power on in a bend their rear tyres let go (`oversteer` in `lib/state.lua`: 0.6 and 0.7; the formula cars 0.35 and 0.45, and the rivals none), and the handbrake still flicks any car sideways. Lifting off the accelerator in a bend turns the player's car in sharper (up to 30%, eased in over a quarter of a second). The menus' backdrop is dressed like the chosen circuit (`lib/looks.lua`, `lib/backdrop.lua`), with the car standing on the road.

**Engine features (2026-11-06).** Each circuit has a `look` in `lib/looks.lua`: bloom and ambient occlusion (`nova.look`), wind that bends the trees, bushes and flags (`nova.wind`, `sway` on the entity classes) and grass and flowers along the verges (`lib/foliage.lua`, planted over the first moments of the countdown). The night circuit's headlights are spot lights, cones on the road (`nova.point_light` with `dir` and `angle`). **Options > Effects** switches the look, the wind and the grass off. On the Retroid the night circuit ran at 59.7 fps with the effects on and the GPU at about 3.5 ms a frame (the car, 200 roadside props, 4,000 tufts, shadows and two spot lights).

**Sound (2026-11-06).** The music is voiced with the studio's fuller instruments (detuned unison saws, filters that open with each note, a sub, vibrato, a shared reverb and the studio drum kit; see `docs/project-format.md`, "Songs"), by song and track in `scripts/rally/audio.mjs`. The engine is a low filtered rumble with a soft body above it. None of it has been listened to on the Retroid yet.

## Not done

Nothing has been played on a real device or by a person yet: the handling, the sounds and the music were tuned by
numbers, headless pictures and a computer driver, not by ear or by hand. There is no split screen, no pit stops, and no tyre or damage model.
