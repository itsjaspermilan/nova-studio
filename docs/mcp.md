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

| Tool | Makes |
| --- | --- |
| `project_create`, `project_info` | `nova.json` and `main.lua`; a listing grouped like the resource tree |
| `read_file`, `write_file` | Lua and other text files |
| `model_write` | `models/<name>.model.json` (the model editor's file) and `models/<name>.glb` |
| `model_preview` | a picture of a model from any angle, rendered by the game's own renderer |
| `sfx_write` | `sounds/<name>.sfx.json` and `.wav` from the sound editor's synth |
| `song_write` | `music/<name>.song.json` and the streamed `.ogg` |
| `sprite_write` | a pixel sprite drawn with text, as `sprites/<name>.png` and `.sprite.json` |
| `scene_write` | `scenes/<name>.scene.json`, validated and tidied |
| `check`, `screenshot` | the Problems panel's check, and a headless picture of the running game |

Every tool takes a `project` folder (or uses `NOVA_PROJECT`). Tool failures come back as readable text with `isError`.
