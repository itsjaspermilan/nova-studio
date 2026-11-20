# The Nova MCP server

An [MCP](https://modelcontextprotocol.io) server that lets an AI assistant (or a script) make a Nova project the way the
studio does: through the same code the editors use, writing the same plain files. No dependencies, nothing outside the
project folder is touched.

```sh
scripts/env.sh cargo build --release -p nova-runtime                    # for check, screenshot and previews
scripts/env.sh cargo build --release -p nova-studio --bin nova-ogg      # for songs (otherwise they stay WAV)
NOVA_PROJECT=/path/to/game scripts/nova-mcp.sh                          # serves MCP on stdin/stdout
```

`.mcp.json` at the repo root registers it for Claude Code. `scripts/nova-mcp-call.mjs <tool> '<json>'` calls one tool over
the real protocol (`--list` shows them), which is how this repository's own games were made.

**Making a game with these tools, step by step, and how to check each step: `docs/agents.md`.**

| Tool | Makes or shows |
| --- | --- |
| `api` | the Lua API looked up by word: signatures, options and descriptions (from `studio/src/lib/nova-api.json`) |
| `project_create`, `project_info` | `nova.json` and `main.lua`; a listing grouped like the resource tree |
| `read_file`, `write_file` | Lua and other text files |
| `model_write` | `models/<name>.model.json` (the model editor's file) and `models/<name>.glb`; `bend: true` gives free-mesh limbs automatic weights, so they bend with the parts around them |
| `model_preview` | a picture of a model from any angle, rendered by the game's own renderer; posed by a `clip` at a `time`; or `strip: 8`, a clip as one picture of eight moments from the front and the side on a ground line, with each part's joint height per moment as text |
| `sfx_write` | `sounds/<name>.sfx.json` and `.wav` from the sound editor's synth (`arpNotes` for a short tune), and the sound's report |
| `song_write` | `music/<name>.song.json` and the streamed `.ogg` (a drums track needs no `wave`) |
| `sound_report` | a sound, a song, several as a mix, or the recording of a run, in numbers and words (level, loudness over time, where the energy sits, strongest lines, clipping, clicks, a loop's seam) with a spectrogram |
| `sprite_write` | a pixel sprite or tileset drawn with text, as `sprites/<name>.png` and `.sprite.json`: in one call or several (`append`, `at`), with copied, mirrored, turned and recoloured frames and named frames (`.tileset.json`); returns the sheet magnified |
| `sprite_preview` | any sprite magnified on a checker background, frames numbered, one strip per animation with the durations |
| `scene_write` | `scenes/<name>.scene.json`, validated and tidied; tile layers may be rows of characters with a `legend` of tile numbers or names; returns the map |
| `scene_preview` | a scene file as a map without running the game: tiles, every object with its name and kind, hitboxes, the grid and world coordinates; the layers as text |
| `check` | the Problems panel's check: every problem with its file and line |
| `play` | the game played headless along a `route` (holds, presses, waits, `until` a Lua condition, Lua) from a `start_scene` and state, returned as one film strip with the frame under each moment, plus the scene, the entities and their positions, printed Lua values, the log and the sounds started; `crop`, `zoom`, `seed`, `audio` |
| `screenshot` | the same tool under its older name: with no options, one picture after 90 frames (960x540; `size` changes it; `press` taps such as `key:Enter@30` still work) |
| `track_write`, `terrain_write`, `store_art` | a racing route with its scene and road, a heightmap for it, and the icon or box art |

Every tool takes a `project` folder (or uses `NOVA_PROJECT`). Tool failures come back as readable text with `isError`; a
mistake in what was given is reported whole (every bad row of a sprite, every bad cell of a map) with the place and what
was expected. Pictures come back as MCP image items. Headless runs play no sound: `play` with `audio: true` writes it to a
file for `sound_report`.

## Watching it work

Every tool call adds a line to `<project>/.nova/activity.jsonl` (when, which tool, the files it wrote, the first line of its
answer, and whether it failed); the newest 200 are kept. The studio shows them in the bottom panel's **Activity** tab, checking
every few seconds and when the window gets focus: the tab shows a count of what is new, each row says what was done in words, and
the file names open in the editors. `.nova/` is a hidden folder, so the log does not show in the resource tree.

The studio has the same renders as screens: see `docs/studio-tools.md` (Store art, the speed strip, Simulate).
