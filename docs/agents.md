# Making a game with Nova as an agent

You cannot see the screen or hear the speakers, so every step here ends with a tool that shows or tells you what you made.
The tools are the Nova MCP server's (`docs/mcp.md`; each takes `project`, the game's folder). Without an MCP client call them
from a shell: `NOVA_PROJECT=/path/to/game scripts/env.sh node scripts/nova-mcp-call.mjs nova_play '{"frames": 60}'`
(`--list` shows them; arguments may be `@file.json`; pictures are saved and their paths printed).

Build once: `scripts/env.sh cargo build --release -p nova-runtime` (the tools that run the game need it), and
`scripts/env.sh cargo build --release -p nova-studio --bin nova-ogg` for music (without it songs stay WAV files, which play).
Run Node and cargo through `scripts/env.sh`. There is no usable `python3` on this machine: write helper scripts in Node.

## Which tool for what

| You want to | Tool | It shows you |
| --- | --- | --- |
| know a Lua call's name, arguments, options | `api` (`{"query": "camera follow"}`) | signatures and descriptions; ask it before reading `docs/project-format.md` |
| start a game | `project_create`, then `project_info` | the files, grouped |
| write Lua, `nova.json` | `write_file`, `read_file` | |
| draw a sprite or a tileset | `sprite_write` | the sheet magnified, frames numbered, a strip per animation |
| look at any sprite again | `sprite_preview` | the same |
| lay out a level | `scene_write` (tile rows as characters with a `legend`) | the level as a map |
| look at any level again | `scene_preview` | the map, and the layers as text to edit and give back |
| make a sound effect | `sfx_write` | its `sound_report` |
| make music | `song_write` | check it with `sound_report` |
| "hear" a sound, a song, a mix, a run | `sound_report` | level, pitch, where the energy sits, warnings, a spectrogram |
| make a 3D model | `model_write` | check it with `model_preview` |
| look at a model, a pose, a clip | `model_preview` (`clip`, `strip: 8`) | the model, or a film strip of the clip on a ground line |
| find mistakes | `check` | every problem with file and line; "no errors" means it loaded and ran |
| play the game | `play` (a `route`) | a film strip, where everything is, the log, the sounds started |

## The shortest path to a checked 2D game

`examples/starter-topdown` is this path done once, small enough to read whole: two rooms, a walking hero, solid tiles, a
solid rock, a door each way. Read `entities/hero.lua` there before writing your own.

1. **Project.** `project_create {"name": "My Game"}`. Add your own input actions to `nova.json` if the built-in ones
   (`left right up down a b x y l1 r1 l2 r2 start select`, axes `move_x move_y look_x look_y`) are not enough:
   `"input": { "attack": ["key:KeyZ", "pad:south"] }`.
2. **Sprites.** `sprite_write` with a `palette` and `frames` as rows of characters. Look at the picture it returns. A big
   tileset goes in several calls (`append: true`); name tiles with `names` so maps can say `"wall"` instead of `3`. Frames are
   packed 16 to a row, and frame n is tile n.
3. **Entities.** One Lua file per kind in `entities/`, returning `nova.entity { sprite = "hero", ... }`.
4. **Scenes.** `scene_write`: tile layers as rows of characters, objects by `kind` with `x`, `y`, a `name` for the ones code
   needs (`self.hero` in the scene, `nova.named("hero")`, the entity's `self.name`), `props` for their settings. Levels are
   scene files, never tables in Lua. The scene's code is `scenes/<name>.lua`; `main.lua` says `nova.start("<first scene>")`.
5. **Check.** `check` after every few files. Fix the first problem first.
6. **Play a route.** `play` with steps in the game's own action names, from any scene and state:

   ```json
   { "start_scene": "cave", "lua": "nova.named('hero').hp = 1",
     "route": [ { "hold": ["right"], "until": "nova.named('hero').x > 300", "max": 300, "capture": "at the door" },
                { "press": "a" }, { "wait": 30, "capture": "after the swing" } ],
     "print": ["nova.named('hero').hp", "nova.count('enemy')"], "every": 20 }
   ```

   Prefer `until` to counted frames: the route then reacts to the game instead of walking into a tree. Runs are repeatable
   (`math.random` is seeded; `seed` changes it).
7. **Read the answer.** The film strip shows the moments in order with the frame under each: look for the thing moving, the
   animation changing, the camera following. The text gives what you asked to `print` at each picture, then every entity
   with its position at the end, the `nova.log` lines and the sounds started, each with its frame, and any Lua error. Assert
   on the text (positions, counts, the scene's name); use the pictures for what only eyes can judge. `crop` and `zoom` read
   small pixel art closely. Put `nova.log(...)` where something must happen (a door, a hit, a pickup): it costs nothing and
   proves the moment was reached.
8. **Sound.** A headless run plays nothing. `sound_report {"sounds": ["step", "hit", "music/town"]}` describes each and
   compares their loudness; `play` with `audio: true` writes what the run sounded like, and `sound_report {"file": ...}`
   describes that. Fix every WARNING: clipping, a click at the start or end, energy below 80 Hz that a handheld cannot play.

## How to verify each kind of thing

| Thing | Verified when |
| --- | --- |
| a sprite | the preview shows what you meant in every frame, and each animation's strip reads as the motion |
| a level | `scene_preview`: tiles where you meant, every object on a sensible tile, no "NO entities/x.lua", solid tiles outlined |
| movement, collisions | a `play` route with `until` reaches the place; a position you `print` stops where the wall is |
| a fight, a pickup, a door | the `nova.log` line appears at a frame, and a count or a scene name you `print` changes |
| an animation | `every: 5` over the action gives a strip in which the frames differ |
| a sound effect | `sound_report`: no warnings, a level within about 10 dB of the others it plays beside |
| music | `sound_report`: "loop seam: matches", and 6 to 10 dB under the effects in the mix table |
| a 3D clip | `model_preview` with `strip`: the pose reads in both rows, and the feet's joint heights stay near the ground |
| the whole game | `check` says "no errors", and one `play` route goes from the first screen to the last |

## The traps

- **Size.** The screen is 540 units high, always. A 16-pixel sprite is 16 units: tiny. Give pixel-art entities `sx = 3, sy = 3`
  (or more) and tile layers `"scale": 3`. `world_height` in `nova.json` is not the unit: it is how many pixels the world is
  rendered with.
- **Your own `draw()` is in screen coordinates.** The framework applies the camera to an entity's own sprite, not to what you
  draw: `nova.sprite("sword", nova.cam.to_screen(self.x + 8, self.y))`. Forget it and the thing is off the screen.
- **Facing left:** `self.flip_x = true`. A negative `sx` also mirrors the hitbox.
- **Hitboxes** are in the sprite's pixels from `x, y`, and are scaled by `sx`, `sy`.
- **Depth:** bigger is further back. For top-down sorting set `self.depth = -self.y`. A tile layer drawn in front of the
  characters (tree crowns, roofs) is a second layer with a large negative depth.
- **Solid things that are not tiles:** tag them `solid`, and in the mover undo a move that ends touching one (`hero.lua`).
- **Camera:** `nova.cam.set` stops `nova.cam.follow`. After a door call `nova.cam.follow(hero, 0.15, true)` so it snaps.
- **Names:** a scene object's `name` is `scene.<name>`, `nova.named(name)` and the entity's `self.name`.
- **Every PNG in the project is a sprite** and goes into the atlas. Keep screenshots and scratch files in `build/`, a
  dot-folder, or list them in `nova.json`: `"ignore": ["shots", "tools"]` (also kept out of `nova pack`).
- **Text** is always drawn over UI rectangles; fade the text itself. `line_spacing = 1.5` for the pixel fonts.
- **Songs:** a drums track needs only `name`, `kind`, `notes` (pitch picks the drum: 36 kick, 38 snare, 42 hat).
- **Sound effects:** one effect has one envelope; `arpNotes` gives it a short tune. For the `noise` wave `freq` is the
  colour, and under about 200 it is a rumble a handheld cannot play.
- **Sizes of pictures:** the tools' pictures are 960x540 unless you pass `size`; the CLI's `--capture` is 1280x720.
- **3D turns** (the model file's `rotation` in degrees, a clip's rotation keys, `rx ry rz` in Lua in radians; right-handed,
  y up, the model's front is +z):

  | Turn | Positive does this | For example |
  | --- | --- | --- |
  | about x | tips the top of the part towards the front | a leg hanging down swings back; an arm lifts forward with a negative x |
  | about y | turns the part's front towards the model's +x side | seen from the front, towards the viewer's right |
  | about z | tips the top of the part towards the model's -x side | a limb hanging down swings out towards +x |

## Without the MCP server

The runtime does the same from a shell (`docs/project-format.md`, "Testing helpers"):
`nova run <folder> --headless --play plan.json` (the route, pictures and `report.json`), `--start-scene`, `--run-lua`,
`--seed`, `--audio-out run.wav`, and `nova check <folder> --json`.
