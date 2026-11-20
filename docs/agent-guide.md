# Making a game with Nova as an agent

You cannot see the screen or hear the speakers, so every step here ends with a tool that shows or tells you what you made.
The tools are the Nova MCP server's (`docs/mcp.md`; each takes `project`, the game's folder). Without an MCP client call them
from a shell:

```sh
scripts/nova-tool --list                                  # every tool: its whole description and its parameters
scripts/nova-tool --help play                             # one tool: each parameter with its type, and an example call
scripts/nova-tool --project /abs/path/to/game play '{"frames": 60}'      # or NOVA_PROJECT=...; arguments may be @/abs/args.json
```

(`scripts/nova-tool` is `scripts/env.sh node scripts/nova-mcp-call.mjs`; pictures are saved and their paths printed.)

**Running Node and cargo.** Plain `node` does not work on this machine (it is a version manager's shim with no version
chosen), in the repository or outside it. Always run `scripts/env.sh node your-script.mjs` (and `scripts/env.sh cargo ...`):
`env.sh` picks the versions for that one command (it also works from another folder when called by its whole path). Run it from the repository folder and give your script, and every file it
reads or writes, by absolute path: a relative path means "from the folder the command was run in", which is the repository,
not your game. There is no usable `python3`: write helper scripts in Node.

Build once: `scripts/env.sh cargo build --release -p nova-runtime` (the tools that run the game need it), and
`scripts/env.sh cargo build --release -p nova-studio --bin nova-ogg` for music (without it songs stay WAV files, which play).

## Which tool for what

| You want to | Tool | It shows you |
| --- | --- | --- |
| know a Lua call's name, arguments, options | `api` (`{"query": "camera follow"}`, `{"group": "Entity methods"}`) | signatures and descriptions, one call or a whole group; ask it before reading `docs/project-format.md` |
| start a game | `project_create` (`template: "topdown"`, `"platformer"` or `"3d"` copies a working starter), then `project_info` | the files, grouped |
| write Lua, `nova.json` | `write_file`, `read_file` | |
| **get art fast: the makers** | `tileset_make`, `character_make`, `creature_make`, `items_make` (one `palette` for all) | the same picture as `sprite_preview`; ordinary sprites you can then change |
| **get 3D art fast: the 3D makers** | `character3d_make` (a rigged person with seven clips), `prop3d_make` (trees, rocks, ruins, a house, gems: 26 kinds), `ground3d_make` (ground from a character map), `creature3d_make` | the same picture as `model_preview` (a clip strip for the animated ones); ordinary models and one-line entity files |
| lay out a map from terrains | `scene_write` with `"paint"` | the map; edges and corners chosen for you |
| get sound fast | `sfx_write { "purpose": "hit" }`, `song_make { "mood": "dungeon" }` | the `sound_report`, free of warnings |
| draw or change a sprite by hand | `sprite_write` | the sheet magnified, frames numbered, a strip per animation |
| look at any sprite again | `sprite_preview` (`frame: n` for one frame close up) | the same; a frame with every pixel a numbered square, and as rows of text to edit |
| lay out a level | `scene_write` (tile rows as characters with a `legend`) | the level as a map |
| look at any level again | `scene_preview` | the map, and the layers as text to edit and give back |
| make a sound effect | `sfx_write` | its `sound_report` |
| make music | `song_write` | check it with `sound_report` |
| "hear" a sound, a song, a mix, a run | `sound_report` | level, pitch, where the energy sits, warnings that say which setting to change, a spectrogram |
| make a 3D model by hand | `model_write` (`"shape": "tube"` and `"lathe"` for round limbs and turned shapes; a clip's `walk` or `ik` places the feet and says the speed at which they do not slide; `bend: true` skins tubes and meshes, not lathes) | check it with `model_preview` |
| look at a model, a pose, a clip | `model_preview` (`clip`, `strip: 8`; `names: [...]` for several at one scale, or `fit: "each"`) | the model whole (never cropped) with its size, a film strip of the clip on a ground line, or a contact sheet |
| plan a 3D level | `scene_preview` on a scene with a `camera` | the scene from above: every object's footprint and name, what blocks in red, a grid in metres |
| find mistakes | `check` | every problem with file and line; "no errors" means it loaded and ran. Also, as warnings: a `nova.<name>` that does not exist or a common call given the wrong kind of argument (`nova.music.stop({ fade = 1 })`) on a line that never ran, a sound, song, scene, sprite or model named by a literal that matches no file (with the nearest name), an entity whose own `draw()` hides its sprite, an entity moved twice, a room smaller than the screen |
| play the game | `play` (a `route`) | a film strip, where everything is, the log, the sounds started; with `out`, each picture as a file |

## The shortest path to a checked 2D game

`examples/starter-topdown` is this path done once, small enough to read whole: two rooms, a walking hero, solid tiles, a
solid rock, a door each way. Read `entities/hero.lua` there before writing your own. `examples/starter-platformer` is the
same for a side view (coyote time, one-way planks, a hazard, a pickup), and `examples/maker-demo` is a game whose art,
sound and maps all came from the makers: its `main.lua` lists the calls.

**Reach for the makers first; type pixels only to customise.** Pick one palette (`"bright meadow"`, `"autumn"`,
`"desert"`, `"snow"`, `"dungeon"`, `"night"`) and give it to every maker:

```json
tileset_make   { "name": "tiles", "palette": "autumn" }
character_make { "name": "hero", "palette": "autumn", "hair": "long", "hair_color": "red", "outfit": "tunic", "outfit_color": "blue", "item": "sword" }
creature_make  { "name": "slime", "palette": "autumn", "kind": "slime", "color": "purple" }
items_make     { "name": "items", "palette": "autumn" }
scene_write    { "name": "meadow", "scene": { "version": 1, "objects": [ { "kind": "hero", "name": "hero", "x": 120, "y": 120 } ],
                 "tilemaps": [ { "tileset": "tiles", "scale": 3, "paint": { "g": "grass", "p": "path", "w": "water", "h": "hedge", "T": "tree" },
                                 "scatter": { "flowers": 0.04 }, "tiles": ["hhhhhhh", "hgTgggh", "hgpppgh", "hgpwwgh", "hhhhhhh"] } ] } }
sfx_write      { "name": "hit", "purpose": "hit" }
song_make      { "name": "field", "mood": "adventure field" }
```

Each answer says what to put in the entity (`character_make`: `pivot = { 0.5, 0.875 }, hitbox = { -4, -5, 8, 5 }`, then
`self:play("walk_" .. dir)`; the frame is bigger than the body, so the pivot is not the bottom edge). A room indoors is
the same `paint` with `"#": "brick_wall", "w": "wood_floor", "D": "door"`. What the makers do not have, draw with
`sprite_write` in the same palette (`sprite_preview { "frame": n }` gives any made frame back as rows to edit), or add
tiles to the made tileset with `append`. To change a painted map, take the rows `scene_preview` prints and paint again.

1. **Project.** `project_create {"name": "My Game"}` (or `"template": "topdown"` / `"platformer"` to start from a working
   game). Add your own input actions to `nova.json` if the built-in ones
   (`left right up down a b x y l1 r1 l2 r2 start select`, axes `move_x move_y look_x look_y`) are not enough:
   `"input": { "attack": ["key:KeyZ", "pad:south"] }`.
2. **Sprites by hand.** `sprite_write` with a `palette` and `frames` as rows of characters. Look at the picture it returns. A big
   tileset goes in several calls (`append: true`); name tiles with `names` so maps can say `"wall"` instead of `3`. Frames are
   packed 16 to a row, and frame n is tile n. Less typing: a row that is short is filled with transparent (the answer says
   which); a frame can be shapes, half a frame mirrored, and outlined:
   `{ "shapes": [{ "circle": [7.5, 9, 6], "color": "g" }, { "rect": [5, 8, 2, 2], "color": "w" }], "mirror": "x", "outline": "k" }`
   (with `"size": [16, 16]`); `{ "copy": 0, "flip": "x" }` and `{ "copy": 0, "silhouette": true }` (a white copy, for a hit
   flash) reuse a frame. `sprite_preview { "name", "frame": 3 }` shows one frame big, pixels numbered, to fix a face or a foot.
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
   (`math.random` is seeded; `seed` changes it). More steps, so that a route plays like a person:

   | Step | Does |
   | --- | --- |
   | `{ "hold": ["right"], "frames": 6 }` | holds for a fixed time. A direction button also sets the axis that shares its keys and the other way round (`up` and `move_y` = -1), so it moves a hero whichever the code reads; a hold nothing read is reported |
   | `{ "walk_to": [300, 200], "who": "hero" }` | walks to a point (`[x, z]` in 3D) round what is solid: solid tiles and entities tagged `solid` in 2D; `nova.solid`, `nova.walls` and the scenery in 3D. The answer says whether it found a way or walked straight |
   | `{ "walk_to": "chest" }` | walks into a thing (a name, a tag or a kind) until the hitboxes overlap (a door, a pickup) or it stands against it (a solid chest), and says how far apart they ended: do this before a press that needs the hero beside something. A thing that changes the scene (a door) ends the step there, as a success, in the new scene |
   | `{ "fight": "enemy", "attack": "a", "max": 600 }` | goes to the nearest one with that tag, taps `attack` in `range`, then the next, until none is left; says how many were beaten and what it cost |
   | `{ "hold": ["right"], "tap": "a", "tap_every": 30, "until": "..." }` | walks and swings at once |
   | `{ "repeat": 5, "until": "...", "steps": [ ... ] }` | a group of steps again and again, until something holds |
   | `"may_time_out": true` | on an `until`, `walk_to` or `fight` that is allowed to run out: no warning |

   For the whole call: `"invincible": true` (the hero's `hp`, `health`, `hearts` or `lives` is put back after every frame,
   so a clumsy route still reaches the end; `nova.testing.invincible` is true for damage code that is not a plain field),
   `"stop_on_fail": true` (the route ends at the first step that fails, with a picture, instead of playing the rest from
   the wrong place), `"overlay": ["hitboxes", "solids", "names"]` (drawn on the pictures: why a press beside a chest did
   nothing), `"compare": "nova.shadows(nil)"` (the run again with that one difference: the share of pixels that changed
   in each picture, and where: is an effect drawn at all?), `"image_out": "build/look.png"` (the picture also saved there;
   every picture tool takes it), `"crop_to": "hero"` (every picture cut to the hero with `crop_margin` pixels round it,
   moved with it, 2D and 3D: no pixel rectangles to guess) and, in 3D, `"view": { "follow": "hero", "from": "side",
   "distance": 4 }` (the pictures from beside the hero, the game playing on with its own camera: with `every`, a side view
   of a walk). The first line of every answer with a picture is its path (`picture: /tmp/...png`, or `picture saved:`
   with `image_out`), so filtering a long answer never loses it.

   A `lua` or `until` that fails is reported as `ERROR in step 3 ...` and the run goes on. The picture of a step that ends
   on a condition is of the frame after, when the game has drawn the change. `"out": "build/run1"` also saves
   every picture full size in the project (a folder the game ignores: `build/`, or one in `nova.json`'s `"ignore"`), with the
   strip, `report.json` and, with `audio: true`, `run.wav`. A run never reloads the game when files change.
7. **Read the answer.** The film strip shows the moments in order with the frame under each: look for the thing moving, the
   animation changing, the camera following. The text gives what you asked to `print` at each picture, then every entity
   with its position at the end, the `nova.log` lines and the sounds started, each with its frame, and any Lua error. Assert
   on the text (positions, counts, the scene's name); use the pictures for what only eyes can judge. `crop` and `zoom` read
   small pixel art closely. Put `nova.log(...)` where something must happen (a door, a hit, a pickup): it costs nothing and
   proves the moment was reached.
8. **Sound.** A headless run plays nothing. `sound_report {"sounds": [{"name": "hit", "volume": 0.7}, "step", {"name":
   "music/town", "volume": 0.3}]}` describes each and compares them at the volumes the game plays them at (it says how far
   the music sits under the effects and the volume that would put it 8 dB under); `play` with `audio: true` writes what the run
   sounded like, and `sound_report {"file": ...}` describes that, naming the frame and the sounds that started at any click or
   clip. Fix every WARNING (clipping, a click at the start or end, energy below 80 Hz that a handheld cannot play): each ends
   with the setting to change, its value now and which way to move it. The presets of `sfx_write` pass the check as they are.

## The shortest path to a checked 3D game

`examples/starter-3d` is this path done once (`project_create { "name": "My Game", "template": "3d" }` copies it): a hero
that walks, runs and jumps, a follow camera, a garden of ruins, four gems, footsteps, a song. Read `entities/hero.lua`
(80 lines) and `scenes/garden.lua` (60) before writing your own; its `main.lua` lists the calls that made the rest.

```json
character3d_make { "name": "hero", "hair": "short", "outfit": "tunic", "outfit_color": "teal", "pack": "backpack", "entity": "hero" }
prop3d_make      { "kinds": ["tree", "pine", "rock", "bush", "flowers", "grass", "arch", "pillar", "broken_wall", "crate", "lantern", "gem"], "palette": "bright meadow" }
ground3d_make    { "name": "ground", "map": ["........", "..pppp..", "..psspp.", "...pp..."], "legend": { ".": "grass", "p": "path", "s": "paved" } }
scene_write      { "name": "garden", "scene": { "version": 1, "camera": { "eye": [0, 3, 12], "target": [0, 1, 6], "fov": 55 }, "objects": [
                   { "kind": "ground", "x": 0, "y": 0, "z": 0 }, { "kind": "hero", "name": "hero", "x": 0, "y": 0, "z": 6 },
                   { "kind": "arch", "x": 0, "y": 0, "z": -6 }, { "kind": "tree", "x": -7, "y": 0, "z": -3, "props": { "ry": 1.2, "sx": 1.1 } },
                   { "kind": "gem", "name": "gem1", "x": 0, "y": 0.85, "z": -8 } ] } }
sfx_write        { "name": "step", "purpose": "step_grass" }
song_make        { "name": "garden", "mood": "calm village" }
```

1. **Project.** `project_create` (`"template": "3d"` to start from the working game). The built-in actions are enough to
   start: axes `move_x move_y look_x look_y`, buttons `a b x y l1 r1 ...`; input sources are `pad:south`, `pad:l1`, `key:Space`.
2. **Character.** `character3d_make`: its answer gives the part names, the clips (idle, walk, run, jump, wave, attack,
   hurt) with their lengths and events, **the speeds at which walk and run do not slide**, the capsule for the mover, and
   the Lua for an animator. `"entity": "hero"` writes `entities/hero.lua`, a third-person walker to change.
3. **Props.** `prop3d_make` with `kinds`: models and their entity files in one call, in the same palette as everything
   else. The answer says how each blocks: scenery is `static = true`; what you bump into is `solid = true` as well (its
   own shape blocks); a tree blocks with its trunk; `steps` and `dais` are walked up; a `lantern` says where its light goes.
   Each has `on_ground = true`: placed by a scene it stands on the ground under its x, z, so its `y` there is the height
   above the grass (0 for a tree, 0.85 for a gem that floats); `"props": { "on_ground": false }` keeps one at its `y`.
4. **Ground.** `ground3d_make` from rows of characters (each a square of `cell` metres, the first row furthest away). Its
   middle is the origin; paths and paved places are at height 0, grass rolls up to `hills` around them.
5. **Scene.** `scene_write` with a `camera` (that makes it a 3D scene) and objects by kind at `x`, `y` (up), `z`; turn
   and size them with `"props": { "ry": radians, "sx": scale }`. `scene_preview` shows the plan from above with what
   blocks in red. The scene's Lua (`scenes/<name>.lua`) sets the light in `enter`: copy the starter's six lines (sun in
   front of or beside the first view, `nova.shadows { strength = 0.8 }`, sky, fog).
6. **Mover and camera.** One call moves a body against everything the scene made solid:
   `local m = nova.solid.move(x, y, z, radius, height, dx, dy, dz)` (the ground, every `solid = true` entity, tree
   trunks); `m.ground` says it stands. The camera, in the scene's `update`:
   `nova.cam3.follow(hero, { distance = 6, height = 2.9, look_height = 1.2, collide = true, min_distance = 1.7, hide = true, behind = 1.1, dt = dt })`:
   `collide` keeps walls and tree crowns out of the view with no more code, `behind` swings it round behind the hero.
   The stick as the camera sees it: `nova.cam3.forward()` and `nova.cam3.right()` (the starter's `hero.lua`).
7. **Clips and events.** `nova.animator` with a blend state mixes idle, walk and run by speed so the feet keep step:
   `move = { blend = "speed", points = { { 0, "idle" }, { 1.16, "walk" }, { 3.97, "run" } } }`, then `anim:set("speed", v)`.
   Its `on_event` gets `"step"` as each foot lands: play the footstep there.
8. **Sound.** As in 2D: `sfx_write` with a `purpose`, `song_make`, then `sound_report` on the mix.
9. **Check, then play with `walk_to`.** `check`, then a route by names: `{ "walk_to": "gem1" }` finds its way round what
   is solid, follows a camera that turns, and says what it is against if it cannot get there ("blocked by 'arch' (model
   arch) at x 0, z -6"). `"size": "1280x720"` and `"out": "build/run1"` for pictures to look at closely.
10. **Look.** The strip shows the route; `model_preview { "name": "hero", "clip": "walk", "strip": 8 }` shows a clip from
    the front and side with the feet's heights; `"compare": "nova.shadows(nil)"` measures what a setting changes. More
    than 24 pictures come back as several strips, none left out.

What the makers do not have, make with `model_write` in the same style (flat faces, one palette), or read a made
`.model.json`, change it and write it back. A walk for a model of your own: a clip with
`"walk": { "legs": ["foot_l", "foot_r"], "stride": 10, "arms": ["arm_l", "arm_r"], "event": "step" }`.

## How to verify each kind of thing

| Thing | Verified when |
| --- | --- |
| a sprite | the preview shows what you meant in every frame, and each animation's strip reads as the motion |
| a level | `scene_preview`: tiles where you meant, every object on a sensible tile, no "NO entities/x.lua", solid tiles outlined |
| movement, collisions | a `play` route with `until` reaches the place; a position you `print` stops where the wall is |
| a fight, a pickup, a door | the `nova.log` line appears at a frame, and a count or a scene name you `print` changes; `walk_to` the thing and `fight` the tag get there without waypoints |
| a walk clip | made with `walk` (or by `character3d_make`): move the entity at the speed the answer gives; the strip's standing foot reads 0.000, the hips rise over the standing leg |
| a 3D level | `scene_preview` (the plan: what blocks is red), then a `play` route of `walk_to` steps by name ends with no warning |
| an animation | `every: 5` over the action gives a strip in which the frames differ |
| a sound effect | `sound_report`: no warnings, a level within about 10 dB of the others it plays beside |
| music | `sound_report`: "loop seam: matches", and 6 to 10 dB under the effects in the mix table |
| a 3D clip | `model_preview` with `strip`: the pose reads in both rows, and the standing foot's "lowest" row reads about 0.000 (its sole on the ground; the "joint" row is its ankle) |
| the whole game | `check` says "no errors", and one `play` route goes from the first screen to the last |

## The traps

- **Size.** The screen is 540 units high, always. A 16-pixel sprite is 16 units: tiny. Give pixel-art entities `sx = 3, sy = 3`
  (or more) and tile layers `"scale": 3`. `world_height` in `nova.json` is not the unit: it is how many pixels the world is
  rendered with.
- **Your own `draw()` is in screen coordinates.** The framework applies the camera to an entity's own sprite, not to what you
  draw: `nova.sprite("sword", nova.cam.to_screen(self.x + 8, self.y))`. Forget it and the thing is off the screen.
  A `draw()` of your own replaces the drawing of the entity's `sprite` or `model`: put `nova.Entity.draw(self)` in it
  where the picture should go, or the entity vanishes (`check` warns).
- **Facing left:** `self.flip_x = true`. A negative `sx` also mirrors the hitbox.
- **Hitboxes** are in the sprite's pixels from `x, y`, and are scaled by `sx`, `sy`.
- **Depth:** bigger is further back. For top-down sorting set `self.depth = -self.y`. A tile layer drawn in front of the
  characters (tree crowns, roofs) is a second layer with a large negative depth.
- **Solid things that are not tiles:** tag them `solid`, and in the mover undo a move that ends touching one (`hero.lua`).
  Such a thing is then never overlapped, so its `on_collide_hero` never runs: notice the hero with `self:near("hero", 6)`.
- **Tags are not kinds.** `nova.first`, `nova.all`, `nova.count` and `on_collide_<tag>` take a tag (`tags = { "enemy" }`), not
  the entity's file name; `nova.named("hero")` takes the name a scene object was given.
- **`tint` multiplies:** it darkens or colours and cannot flash a sprite white. Blink `alpha`, or show a white copy of the
  frame (`{ "copy": 0, "silhouette": true }`).
- **The engine's fields:** `vx vy vz` are added to the position every step. `self.y = self.y + self.vy * dt` moves twice as far:
  set the velocity only, or put `velocity = false` in the entity. Do not reuse `x y z sx sy angle alpha frame depth tint name`.
- **Angles** are radians, positive clockwise on the screen (y points down); 0 is to the right for `angle_to` and `set_velocity`.
- **A room smaller than the screen** (960 x 540 units) sits in the middle with the background colour around it:
  `scene_preview` and `check` say when one is.
- **Camera:** `nova.cam.set` stops `nova.cam.follow`. After a door call `nova.cam.follow(hero, 0.15, true)` so it snaps.
- **Names:** a scene object's `name` is `scene.<name>`, `nova.named(name)` and the entity's `self.name`. Inside an entity's
  `create()` its `name` and props are set and `nova.current_scene()` is already the scene being built.
- **Nothing is ignored in silence.** A tool refuses a key it does not have and names the nearest one it has; a key in the
  wrong place inside a scene, a frame or a song (`scale` beside `tileset` instead of in it) is a warning at the top of the
  answer. Read the first lines of every answer.
- **The UI layer** (`nova.ui.*`, `draw_ui`) is always over the world, whatever the depths. Open the full-size picture
  (`out`, `image_out`) before judging draw order from a small strip tile.
- **Every PNG in the project is a sprite** and goes into the atlas. Keep screenshots and scratch files in `build/`, a
  dot-folder, or list them in `nova.json`: `"ignore": ["shots", "tools"]` (also kept out of `nova pack`).
- **Text** is always drawn over UI rectangles; fade the text itself. `line_spacing = 1.5` for the pixel fonts. The
  `pixel` font is monospaced: every letter is `size` units wide (16 by default, so 10 letters are 160 units); other fonts
  vary. Measure before placing: `nova.ui.text_width(text, { font = "pixel", size = 24 })` (`nova.ui.text_size` gives width and height).
- **Colours** are `{ r, g, b [, a] }` from 0 to 255, never 0 to 1 (`{ 255, 255, 255, 128 }` is half-transparent white).
- **`nova.ui.sprite` is centred on x, y; `nova.ui.rect` (like `nova.rect`) starts at its top-left corner.** A frame round
  an icon at `x, y` is `nova.ui.rect(x - w / 2, y - h / 2, w, h, ...)`.
- **A scene is built again every time it is entered.** Leaving and coming back puts every enemy, chest and pickup back as
  the scene file has them; only what the game keeps in its own state survives. For "stays beaten" or "stays taken" keep a
  table in a module (`lib/state.lua`: `return { taken = {} }`), and in the entity:
  `local state = require("lib.state")`, in `create()`: `if state.taken[self.name] then self:destroy() end`, and where it
  is taken or beaten: `state.taken[self.name] = true` (give each such object a `name` in the scene; prefix it with
  `nova.current_scene()` if two scenes reuse a name).
- **Songs:** a drums track needs only `name`, `kind`, `notes` (pitch picks the drum: 36 kick, 38 snare, 42 hat).
- **Sound effects:** one effect has one envelope; `arpNotes` gives it a short tune. For the `noise` wave `freq` is the
  colour, and under about 200 it is a rumble a handheld cannot play.
- **Sizes of pictures:** the tools' pictures are 960x540 unless you pass `size`; the CLI's `--capture` is 1280x720.
- **3D: are the shadows drawn?** A 3D `play` answer has a `render:` line: shadows on or off, how many models cast one,
  which way the sun travels against the camera, the ambient light, fog, the camera's eye and target. Shadows from a sun
  behind the camera hide behind what casts them, and a bright ambient with a strength under 0.8 makes them faint: put the
  sun in front of or beside the first view. `"compare": "nova.shadows(nil)"` measures what they change.
- **3D, the things that cost a retry:** `nova.cam3.follow(target, { collide = true })` keeps walls, hills, `solid = true`
  entities and the crowns of scenery trees from coming between the camera and the hero, with nothing added by hand; add
  `min_distance = 1.7, hide = true` so that a camera squeezed under an arch shows the scene and not the back of a head
  (it first looks for room above). An entity is solid with `solid = true` beside its `model`; do not call
  `nova.solid.clear()` in a scene's `enter` (the entities were added before it runs; the framework forgets them when the
  scene ends). A base lower than the mover's `step` (0.35) is climbed: make plinths 0.4 high or more, steps 0.3 or less. A model clip can carry `"events": [{ "t": 0,
  "name": "step" }]`: the entity gets `on_clip_event(event, clip)` (the animator `on_event`), which is how footsteps keep time.
  `nova.scene_now()` is the running scene, for an entity that must tell it something. A clip's position keys are absolute (the
  part's origin in its parent), and a track's `part` is the chain of names from the top (`model_write`'s description has an
  example). `nova.solid.raycast`'s distances are metres. A cylinder stands along y: size it standing, then turn it.
- **3D turns** (the model file's `rotation` in degrees, a clip's rotation keys, `rx ry rz` in Lua in radians; right-handed,
  y up, the model's front is +z):

  | Turn | Positive does this | For example |
  | --- | --- | --- |
  | about x | tips the top of the part towards the front | a leg hanging down swings back; an arm lifts forward with a negative x |
  | about y | turns the part's front towards the model's +x side | seen from the front, towards the viewer's right |
  | about z | tips the top of the part towards the model's -x side | a limb hanging down swings out towards +x |

  **Sides:** the model's own left is +x. A part named `_l` (`arm_l`, `leg_l`, `foot_l`, as `character3d_make` makes them)
  sits at +x, `_r` at -x; seen from the front (the camera at +z) the `_l` side is on the viewer's right (checked in the
  renderer with `model_preview`). So lifting `arm_l` out sideways is a positive turn about z and `arm_r` a negative one
  (the made figure's arms rest at 7 and -7 degrees about z).

## Without the MCP server

The runtime does the same from a shell (`docs/project-format.md`, "Testing helpers"):
`nova run <folder> --headless --play plan.json` (the route with the same steps, pictures and `report.json`), `--start-scene`,
`--run-lua`, `--seed`, `--audio-out run.wav`, and `nova check <folder> --json`. `sound_report {"file": "/abs/run.wav"}` reads
a sound from anywhere.
