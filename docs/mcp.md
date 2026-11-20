# The Nova MCP server

An [MCP](https://modelcontextprotocol.io) server that lets an AI assistant (or a script) make a Nova project the way the
studio does: through the same code the editors use, writing the same plain files. No dependencies, nothing outside the
project folder is touched.

```sh
scripts/env.sh cargo build --release -p nova-runtime                    # for check, screenshot and previews
scripts/env.sh cargo build --release -p nova-studio --bin nova-ogg      # for songs (otherwise they stay WAV)
NOVA_PROJECT=/path/to/game scripts/nova-mcp.sh                          # serves MCP on stdin/stdout
```

`.mcp.json` at the repo root registers it for Claude Code. From a shell, `scripts/nova-tool <tool> '<json>'` calls one tool
over the real protocol, which is how this repository's own games were made:

```sh
scripts/nova-tool --list                       # every tool: its whole description and its parameters (* required)
scripts/nova-tool --help play                  # one tool: each parameter with its type and meaning, and an example call
scripts/nova-tool --project /path/to/game check
scripts/nova-tool play @/path/to/args.json     # arguments from a file; NOVA_PROJECT names the game too
```

`scripts/nova-tool` is `scripts/env.sh node scripts/nova-mcp-call.mjs "$@"`, so it runs from any folder (plain `node` is not
set up on this machine: always go through `scripts/env.sh`, and give paths whole). A tool's name may be written with or
without its `nova_` prefix. Every tool gives one working call as the example of its schema (`inputSchema.examples`).

**Making a game with these tools, step by step, and how to check each step: `docs/agent-guide.md`.**

| Tool | Makes or shows |
| --- | --- |
| `api` | the Lua API looked up by word: signatures, options and descriptions (from `studio/src/lib/nova-api.json`); `group` lists a whole group with each entry's signature and what it does |
| `project_create`, `project_info` | `nova.json` and `main.lua`; a listing grouped like the resource tree |
| `read_file`, `write_file` | Lua and other text files |
| `model_write` | `models/<name>.model.json` (the model editor's file) and `models/<name>.glb`; `bend: true` gives free-mesh limbs automatic weights, so they bend with the parts around them. Its description gives the exact shape of `clips` (tracks, keys, absolute values) with an example, and a clip's `events`: named moments (`{ "t": 0.25, "name": "step" }`) the game is told of as the clip passes them. It also says how a free `mesh` is written (points, faces counter-clockwise from outside, a four-face example), takes two shapes it writes as meshes (`tube`: a round limb along points with radii; `lathe`: a profile turned about an axis), and a clip may place the feet instead of turning joints: `"walk": { "legs": ["foot_l", "foot_r"], "stride": 12 }` makes a whole cycle and `"ik": { "foot_l": [[t, x, y, z], ...] }` puts an ankle at points; both are solved for the thigh and shin above the foot and written as ordinary rotation keys, and the answer gives the speed at which the feet do not slide. A model's `colliders`, `capsules` and `boxes` (what it blocks on the ground) are documented there too |
| `model_preview` | a picture of a model from any angle, rendered by the game's own renderer; posed by a `clip` at a `time`; or `strip: 8`, a clip as one picture of eight moments from the front and the side on a ground line, with the heights per moment as text, every row explained: the lowest point of the whole model and of each part (a foot's sole) beside its joint (the ankle). The camera stands back as far as the whole model needs, whatever `size` says, and the answer gives the model's size in world units. `names: [...]` returns several models in one picture at one scale, each named |
| `sfx_write` | `sounds/<name>.sfx.json` and `.wav` from the sound editor's synth (`arpNotes` for a short tune), and the sound's report. The presets pass the report's own check (a test keeps it so) |
| `song_write` | `music/<name>.song.json` and the streamed `.ogg` (a drums track needs no `wave`) |
| `sound_report` | a sound, a song, several as a mix, or the recording of a run, in numbers and words (level, loudness over time, where the energy sits, strongest lines, clipping, clicks, a loop's seam) with a spectrogram. Every warning ends with the setting to change, its value and which way (it reads the `.sfx.json` or `.song.json` the sound was made from). `sounds` takes `{ "name", "volume" }` pairs, so the mix is as the game plays it, and says where the music sits. In a run's recording a click or a clip is named with its frame and the sounds that started there. A song's seam says which tracks sound at it, and a note that starts on the first step is not a fault. `file` may be any `.wav` or `.ogg` by its whole path |
| `sprite_write` | a pixel sprite or tileset drawn with text, as `sprites/<name>.png` and `.sprite.json`: in one call or several (`append`, `at`), with copied, mirrored, turned, recoloured and one-colour (`silhouette`) frames and named frames (`.tileset.json`); returns the sheet magnified. A short row is filled with transparent (the answer says which rows); the frame size is the commonest among the frames given (or `size`), so the frame that is a row short is the one named. A frame may be `shapes` (rect, line, circle, ellipse), `mirror` its left half onto the right, and `outline` what is drawn |
| `sprite_preview` | any sprite magnified on a checker background, frames numbered, one strip per animation with the durations; `frame: n` is one frame close up, every pixel a numbered square, and as rows of text to edit and write back |
| `scene_write` | `scenes/<name>.scene.json`, validated and tidied; tile layers may be rows of characters with a `legend` of tile numbers or names; returns the map |
| `scene_preview` | a scene file as a map without running the game: tiles, every object with its name and kind, hitboxes, the grid and world coordinates; the layers as text; a warning when the room is smaller than the screen. A 3D scene (one with a `camera`) is shown from above as a plan instead: every object's footprint (the box round its model, turned and sized as placed) and name, what blocks in red, a grid and a scale in metres, and the objects listed by kind with their [x, z] |
| `check` | the Problems panel's check: every problem with its file and line. As warnings it also reads the scripts for what its few frames never reach (a `nova.<name>` the API does not have; an entity that moves itself by `vx`, `vy`, `vz`, which the engine adds too) and names the rooms smaller than the screen. A common call given a literal of the wrong kind is such a warning too (`nova.music.stop({ fade = 1 })` takes a number), and an error raised inside an engine call names the call and the script's line (`entities/bell.lua:6: bad argument #1 to 'stop'`) |
| `play` | the game played headless along a `route` (holds, presses, waits, `until` a Lua condition, Lua; `tap_every` to act while walking, `repeat` and `steps` for a group, `walk_to` a point in 2D or 3D, `may_time_out`) from a `start_scene` and state, returned as one film strip with the frame under each moment, plus the scene, the entities and their positions (x, y, z in 3D), printed Lua values, the log and the sounds started with their volumes; `crop`, `zoom`, `seed`, `audio`. A step whose Lua fails is reported with its number and the run goes on. `out: "build/run1"` saves every picture as its own full-size file in the project, with the strip, `report.json` and the sound; `audio: "build/run.wav"` names the sound's file. `walk_to` finds its way round what is solid (2D: solid tiles and entities tagged `solid`, with the walker's hitbox; 3D: `nova.solid`, `nova.walls`, the scenery) and takes a thing's name, tag or kind to walk into it; `fight` beats what is tagged; `invincible` keeps the hero alive; `stop_on_fail` ends the route at the step that failed; `overlay` draws hitboxes, solid things and names on the pictures; `compare` plays the run a second time with one Lua difference and gives the share of pixels that changed in each picture, with the second strip. A 3D run's answer says what the renderer was given (shadows on or off and how many models cast one, the sun against the camera, fog, the camera's eye and target). A strip that shows fewer pictures than were taken says so and where all of them are |
| `screenshot` | the same tool under its older name: with no options, one picture after 90 frames (960x540; `size` changes it; `press` taps such as `key:Enter@30` still work) |
| `track_write`, `terrain_write`, `store_art` | a racing route with its scene and road, a heightmap for it, and the icon or box art |

Nothing is ignored in silence: a key a tool does not have is refused by name with the nearest key it has ("`captrue_at` is not
an option of the play tool; did you mean `capture_at`?"), and a key in the wrong place inside a scene, a sprite frame or a song is a
warning on the first lines of the answer ("`scale` is not an option of tile layer 0; did you mean `tileset.scale`?"). Every tool
that returns a picture takes `image_out`, a path to save it at as well (in the project: under `build/`, a dot-folder or an ignored
folder; or any path given whole); the answer's first line then says where it is. `sound_report` on a recording remarks on a peak
within 1 dB of full scale.

Every tool takes a `project` folder (or uses `NOVA_PROJECT`). Tool failures come back as readable text with `isError`; a
mistake in what was given is reported whole (every bad row of a sprite, every bad cell of a map) with the place and what
was expected. Pictures come back as MCP image items. Headless runs play no sound: `play` with `audio: true` writes it to a
file for `sound_report`. A headless run never reloads the game when files change, so a run may write into the project; the
folders it may write to are those the game does not load (`build/`, dot-folders, and what `nova.json`'s `"ignore"` lists).

## Watching it work

Every tool call adds a line to `<project>/.nova/activity.jsonl` (when, which tool, the files it wrote, the first line of its
answer, and whether it failed); the newest 200 are kept. The studio shows them in the bottom panel's **Activity** tab, checking
every few seconds and when the window gets focus: the tab shows a count of what is new, each row says what was done in words, and
the file names open in the editors. `.nova/` is a hidden folder, so the log does not show in the resource tree.

The studio has the same renders as screens: see `docs/studio-tools.md` (Store art, the speed strip, Simulate).
