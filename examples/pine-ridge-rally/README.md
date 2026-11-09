# Pine Ridge Rally

A 3D rally game for Nova: four circuits, three rivals, a chase camera, tyre wear and damage, controls you can remap, menus, music and sound. Play it with
`nova run examples/pine-ridge-rally`, or open it in the studio (Examples in the project hub).

**Modes:** a race against three rivals, or a time trial: alone on the circuit against a blue ghost of your best lap (kept in the save file).

**Controls** (keyboard and gamepad): steer with the arrows, A/D or the left stick; accelerate with Up, W or the
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
| `tracks/` | The eight courses as track files (control points, road, seed, scenery, roadside, crowd): what the studio's track editor opens and makes the scenes and roads from. |
| `scenes/` | `pine_ridge`, `dust_valley`, `frost_pass`, `harbour_lights` (a circuit each), the four `stage_*` rally stages, `title` and `results`: each course is a layout (`.scene.json`: waypoints, the start grid, gates, scenery, roadside, crowd, and the `race` object with its settings) and a one-line script. |
| `entities/` | One small file per kind of thing a layout can hold (`pine.lua`, `road_dirt.lua`, `waypoint.lua`...), and the cars. |
| `lib/` | `race.lua` (countdown, laps, places, camera, HUD, pause), `course.lua` (a course's settings from its race object), `track.lua`, `crowd.lua`, `foliage.lua`, `ui.lua`, `audio.lua`, `state.lua` (options and best times, saved). |

Thousands of fixed things (road pieces, trees, barriers) would be slow as live entities, so each one hands itself to
`lib/world.lua` when the scene is built; the world draws only what is near the camera and tells cars what they hit.

## How it was made

The models, sounds, songs, sprites and layouts were made through the Nova MCP server (`docs/mcp.md`), the way an
assistant (or a script) drives the studio's own code: see `scripts/rally/` (`models.mjs`, `audio.mjs`, `sprites.mjs`,
`showroom.mjs`, `props-models.mjs`). Each script is a list of tool calls whose results are the files in this folder. Running
`node scripts/rally/models.mjs` (and the others) writes them again; the Lua is hand-written.

**Courses (2026-11-07).** Everything about a course is in its files, none of it in code: its scene, `scenes/<course>.scene.json`, holds the
waypoints, the grid, the gates, the scenery, the roadside and the crowd, and a `race` object whose props are the course's settings:
`stage`, `surface`, `grip`, `loose`, `dust`, `music`, `weather`, `horizon`, `night`, `sun_to`, `tint`, `clouds`, `sun`, `terrain`,
`wind`, `look` and, for a circuit, `menu` (the menus' backdrop dressing); see `entities/race.lua`. A `foliage` object's `plants` say
what grass and flowers are scattered along the verges. `lib/course.lua` reads the race object (the menus read the chosen circuit's with
`nova.scene_data`), and each `scenes/<course>.lua` is one line, `return require("lib.race").scene()`. Change a course in the studio's
scene editor (select the race object; lists and tables are typed as JSON) and the game follows.

The eight courses are track files, `tracks/<course>.track.json` (control points, road, seed, scenery kinds and densities, barrier, sky,
distant scenery and landmarks): open one in the studio's track editor and press **Generate scene and road**, or call the MCP tool
`track_write` with just the course's `name`, to make `scenes/<course>.scene.json` and `models/road_<course>.glb` again. The same file and seed
give the same layout; the scene's named objects (the `race` and `foliage` objects) are kept when it is made again.

`crates/nova-runtime/tests/rally.rs` plays the game through its menus and a full race on every circuit.

**Roadside and skids (2026-11-06).** Grandstands, long tents, banner towers and flags at the start line, billboards on the straights and pylons on the outside of the hard corners (racing-kit models, `scripts/rally/kit-models.sh`), and the spectators (`entities/spectator.lua`, one `crowd_*` kind per character), are objects in each course's scene file, placed by the track generator from the course's waypoints (`roadside` and `crowd` in its track file; until 2026-11-07 `lib/roadside.lua` and `lib/crowd.lua` placed them in code at the start of a race, in the same places). The grass and flowers are still a scatter planted at the start, from the `plants` of the scene's `foliage` object. Tyres that slide on the road leave dark skid marks (`lib/fx.lua`, the last 360 are kept).

**Cars and drifting (2026-11-06).** The four cars are the kit's own sizes at one scale (3.5 to 3.9 m) with 0.6 m wheels. Steering at low speed follows the wheels' angle (a parking-speed turn is slow, not a spin). The sedan and the hatchback drift: with power on in a bend their rear tyres let go (`oversteer` in `lib/state.lua`: 0.6 and 0.7; the formula cars 0.35 and 0.45, and the rivals none), and the handbrake still flicks any car sideways. Lifting off the accelerator in a bend turns the player's car in sharper (up to 30%, eased in over a quarter of a second). The menus' backdrop is dressed like the chosen circuit (`lib/looks.lua`, `lib/backdrop.lua`), with the car standing on the road.

**Menus on the engine's layout, in the mockup's look (2026-11-08).** Every menu screen (title, main menu, the chooser, the circuit and stage list, the modes, the garage, options, controls, how to play, pause and results) is a `nova.ui.menu` tree (`docs/menus.md`), and they and the HUD follow the user's UI mockup (eight boards at 1280x720, drawn at three quarters of their numbers in the game's 960x540 units): a dark slate ground, panels in #171E26, an orange accent, a teal for good and ahead, yellow pace notes, slanted panels and focus bars, a footer of pad glyphs, and Barlow and Barlow Condensed type (SIL OFL, `fonts/barlow*.ttf`, notice in `licenses/fonts/`). Only the game's real data is shown: no career, credits, upgrades or multiplayer. Where the mockup had a career the main menu has Race, Time trial and Rally stages; its rounds are the Circuits and Stages tabs (L and R); its garage is the car page (classes as tabs, the real Power, Top speed, Grip and Drift); the results' cards are the best lap, the best race and records or the stage score and stars. The pace notes use the mockup's icon set (drawn as strokes with `nova.ui.line`), on the side the road turns, with no distance, sliding and fading as before. The look is a theme with draw hooks in `lib/ui.lua`.

**Career, garage and a new menu flow (2026-11-08).** The game opens on the main menu (no PRESS START card): Rally, Circuit, Time trial, Garage, How to play, Options. A mode leads to its tracks, then the garage to pick the car, then (a circuit) the laps, then a page with everything chosen and a big RACE button; B goes back a step. A course's level is its difficulty (Easy, Medium, Hard, Expert: how hard the rivals drive and how tight a stage's times are), and the courses open one after another, the stages and the circuits each with their own progress (a circuit finished in the top three, a stage with a star; a time trial goes round the circuits already open). Every finish pays coins (`state.reward`); a new player starts with 1,000, enough for one of three starter cars (Commuter, Green Machine, Oobi), and the garage sells the rest, cheapest first. The garage is a grid of every car: each card has the car's 3D model behind it (`lib/menu_bg.lua` places the models under the cards' rectangles), the one under the focus turning under a spot light and the rest grey and still. The menus' back is plain: checkered flags drifting on the diagonal, and in the garage rows of steering wheels (`models/steering_wheel`) sliding sideways; the live circuit and car are only used for the store pictures (F12, F11). The results offer Restart and Return. Cars have brake lights, and tail lights after dark (`Car:draw_tail_lights`, placed per model from the red at the back of each). The Retroid's Select and Start buttons are shown as a square and a right-pointing triangle (`sprites/ui/pad_select.png`, `pad_start.png`).

**Free roam (2026-11-08).** FREE ROAM on the main menu drives the Pine Ridge circuit and the Pine Ridge stage as one map, the stage 1.2 km east of the circuit with a gravel road between them (`scenes/roam.scene.json`, made from the two courses' scenes by `scripts/rally/roam.ts`). The roads are `roam_point` objects (`lib/roads.lua` joins them and finds the nearest road in 32 m squares), each road model is a placed object (`entities/road_piece.lua`), and the events are `event` objects: drive up to one and press Y for its details (course, mode, difficulty, prize, your car), then A to start it. The race is the course's own scene; Return on the results, or Quit in its pause menu, comes back to the map at the marker. Far from every road (40 m) the screen fades and the car is put back; Select does it on request. The pause menu has a map. F9 drives along the road for testing, logging `roam: perf` every five seconds. Controls changed with it: Y is the event button, Select is "back on the road" (in races too), and A and X are no longer accelerate and brake (ZR and ZL are), left free for a manual gearbox.

**A town on the free-roam map (2026-11-08).** Halfway between the circuit and the stage the gravel road runs through a small town: a 200 m main street of Kenney's City Kit Roads tiles with a crossroads, a side street ending in a turning circle each way, houses (City Kit Suburban) and shops (City Kit Commercial) facing the streets, street lights, traffic lights at the crossing, signs at the way in and power poles along the roads out (all CC0, at 14 times the kits' size: `scripts/rally/town-models.sh`; laid out by `scripts/rally/roam.ts`). The streets are road points too (tarmac), and the buildings have collision circles. The rivals no longer cut across the grass (they steer for a nearer point, slide it along the road, dodge scenery only off the road, and brake for the sideways grip the cars really have).

**Kenney UI art and sounds (2026-11-06).** The menus' buttons and the panels are Kenney's UI Pack and Adventure pack drawn as nine-slices (`nova.ui.panel`), the How to play screen shows the handheld's buttons from the Input Prompts pack (Nintendo-style labels), and the menu, pause and bump sounds are Kenney's Interface and Impact sounds (CC0, `licenses/kenney-ui.txt`, copied by `scripts/rally/kenney-ui.sh` from the bundle). Each car has its own engine note, made by `scripts/rally/engines.mjs` (combustion pulses through exhaust resonators: a ten-cylinder scream for Redline, a four-cylinder growl, a lumpy three-cylinder, a six with a turbo whine), five loops per car crossfaded by the revs; the tachometer segments in the HUD show the revs per gear. (The first try, six recorded loops from OpenGameArt, turned out to be almost all sub-bass a handheld speaker cannot play, and the second a drone: both dropped.) The music has two styles in Options > Music style: Kenney's loops (the default; chosen by title, not yet listened to) and the songs made with the music editor.

**Engine features (2026-11-06).** Each course has a `look` (now in its scene's `race` object, see Courses below): bloom and ambient occlusion (`nova.look`), wind that bends the trees, bushes and flags (`nova.wind`, `sway` on the entity classes) and grass and flowers along the verges (`lib/foliage.lua`, planted over the first moments of the countdown). The night circuit's headlights are spot lights, cones on the road (`nova.point_light` with `dir` and `angle`). **Options > Effects** switches the look, the wind and the grass off. On the Retroid, racing with the effects on (200 roadside props, 3,500 to 7,700 tufts, shadows, and at night two spot lights), it held 59.68 fps on average over a 35-minute soak (and Options > Effects costs about 2.5 ms of GPU: 3.5 ms on, 1.0 ms off) with the GPU at 3.2 to 3.9 ms a frame (`docs/performance.md`).

**Sound (2026-11-06).** The music is voiced with the studio's fuller instruments (detuned unison saws, filters that open with each note, a sub, vibrato, a shared reverb and the studio drum kit, arranged in four sections: the theme, the theme with the lead doubled, a breakdown, and the theme with a fifth above and a fill; 52 to 80 seconds before a loop repeats; see `docs/project-format.md`, "Songs"), by song and track in `scripts/rally/audio.mjs`. The engine is a low filtered rumble with a soft body above it. None of it has been listened to on the Retroid yet.

## Not done

Nothing has been played on a real device or by a person yet: the handling, the sounds and the music were tuned by
numbers, headless pictures and a computer driver, not by ear or by hand. There is no split screen, no pit stops, and no tyre or damage model.
