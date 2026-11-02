# Nova project format v1 and Lua API v1

Status: implemented in `crates/nova-runtime` (`vfs.rs`, `project.rs`, `assets.rs`, `game.rs`).
Run a project with `nova run <folder>`. The example is `examples/rally-demo/`.
This is the first slice of M2: an immediate-mode API over real project files. Scenes,
entities, tilemaps, animation, audio and saves come later and will be added to this
document as they land.

## A project is a folder

```
my-game/
  nova.json        required: names the game
  main.lua         the entry script (the name is configurable)
  sprites/*.png    any PNGs, anywhere in the folder
  models/*.glb     static glTF models
  lib/util.lua     modules, loaded with require("lib.util")
  anything else    ignored for now (audio, scenes and fonts are recognised by extension but not used yet)
```

Hidden files and folders (starting with `.`), symbolic links and the top-level folders
`build`, `target`, `node_modules` and `dist` are never part of a project. At most 20,000
files, 64 MiB per file and 1 GiB in total.

### `nova.json`

```json
{ "format": 1, "name": "Rally Demo", "entry": "main.lua", "world_height": 540, "version": "0.1.0" }
```

| Key | Required | Meaning |
| --- | --- | --- |
| `format` | yes | Must be `1`. Other values are rejected with a message. |
| `name` | yes | Game title, 1 to 80 characters. |
| `entry` | no | Entry script, default `main.lua`. Must be a project-relative `.lua` path that exists. |
| `world_height` | no | Height in pixels of the world render target, default `540`; `0` means native screen resolution; at most 4320. The width follows the screen's aspect. UI always renders at native resolution. |
| `version` | no | Free-form version string. |

Unknown keys produce a warning and are ignored. Malformed manifests are rejected with an
explanation (invalid JSON with line and column, wrong types, paths that escape the project,
a missing entry file).

### Paths and asset IDs

All paths are project-relative with forward slashes. Absolute paths, `..`, backslashes and
empty names are rejected everywhere (manifest, `require`, asset reads), and a file that
resolves outside the project through a link is refused. **An asset's ID is its
project-relative path**, for example `sprites/car.png`; nothing is declared by hand. Two
files whose names differ only by letter case are an error, so projects behave the same on
case-insensitive systems.

### Supported assets today

- **Images:** PNG, 8 or 16 bit, any colour type (indexed, grey, RGB, RGBA). All images are
  packed once into a single atlas (at most 4096x4096) when the project loads; nothing is
  decoded or uploaded per frame. JPEG, GIF and BMP are not supported yet and are warned
  about.
- **Models:** static GLB/glTF: triangle meshes in the default scene, positions, normals,
  UV set 0, COLOR_0, a base colour factor and one base colour texture. Animations, skins,
  morph targets and extensions are reported as warnings in the log, not silently dropped.
- **Scripts:** Lua 5.4.

## Lua API v1

Scripts define `init()` (once, at load), `update(dt)` and `draw()` (every frame, in that
order). Anything may be drawn from `update` or `draw`. Each frame starts with empty draw
lists; draw what you want to see.

The Lua environment has `math`, `string`, `table`, `utf8` and `coroutine` only. `io`, `os`,
`package`, `debug`, `dofile`, `loadfile` and `collectgarbage` do not exist. This is a
stability boundary for hand-written games, not a hostile-code sandbox: there are no
time or memory limits yet.

### Drawing

Coordinates are *logical units*, 540 high on any screen (the width follows the aspect
ratio). `nova.view()` returns the current width and height.

| Call | Layer | Meaning |
| --- | --- | --- |
| `nova.sprite(id, x, y [, opts])` | world | Draw a PNG, centred on `x, y`. |
| `nova.rect(x, y, w, h [, {r,g,b,a}])` | world | Solid rectangle, top-left `x, y`. |
| `nova.model(id, x, y, z [, opts])` | world | Draw a GLB model. |
| `nova.camera(ex,ey,ez, tx,ty,tz [, fov])` | world | 3D camera (eye, target, vertical field of view in degrees, default 60). |
| `nova.clear(r, g, b)` | world | Background colour, 0 to 255. |
| `nova.ui.sprite(id, x, y [, opts])` | UI | Same as `nova.sprite`, at native resolution. |
| `nova.ui.rect(x, y, w, h [, color])` | UI | Same as `nova.rect`, at native resolution. |
| `nova.ui.text(x, y, text [, opts])` | UI | Debug pixel font, top-left `x, y`. `opts.scale` (default 2), `opts.color`. Uppercase letters, digits and basic punctuation only. |
| `nova.ui.text_width(text [, scale])` | | Width in logical units. |

**Layers.** Draw order within a frame is: world sprites (behind), then 3D models (depth
tested), then the UI layer. World sprites and models render into the world target
(`world_height`) and are upscaled with a sharp-bilinear filter; the UI layer draws on top at
native resolution.

**Sprite options:** `scale`, `sx`, `sy` (multipliers on the image size), `w` and/or `h`
(explicit logical size; one alone keeps the aspect), `rotation` (radians), `color`
`{r,g,b[,a]}` (0 to 255, multiplies the image), `anchor` (`"center"` default, or
`"topleft"`).

**Model options:** `scale`, `rx`, `ry`, `rz` (radians), `tint` `{r,g,b[,a]}`. Models are
instanced: draws of the same model in a frame become one GPU draw call.

### Input, time, log

| Call | Meaning |
| --- | --- |
| `nova.input.axis(name)` | `"steer"` (-1..1), `"throttle"`, `"brake"` (0..1), `"action"` (0 or 1). |
| `nova.input.down(name)` | True while the action is active. |
| `nova.input.pressed("action")` | True on the frame the action button goes down. |
| `nova.time()` | Seconds since the game started. |
| `nova.log(text)` | Write to the log. |

The actions come from the keyboard (WASD or arrows, Space), a gamepad (desktop: left stick,
triggers, South/East/West buttons; Android: D-pad and A/B/X buttons only for now) and touch
(drag the left half to steer, hold the right half to accelerate). Named, remappable
actions are planned for the rest of M2.

### require

`require("lib.util")` loads `lib/util.lua` from the project, once, and returns what it
returns. Circular requires and missing modules raise clear errors. Nothing outside the
project can be loaded.

## Errors and reloading

- A bad project (missing or invalid `nova.json`, unreadable image or model, atlas overflow)
  stops `nova run` with a message naming the file.
- A Lua error, in the entry script or at runtime, shows a red banner with the message and
  stops script updates until the file is fixed; the last frame's drawing is replaced by
  the banner. Saving the file reloads the project.
- With `nova run`, saving any file in the folder reloads the whole project (a restart of
  the Lua state, not state-preserving hot reload). If the reload fails, the previous game
  keeps running with the error banner.
- `F3` toggles a stats overlay (frame time, draw calls, sprites, triangles, audio).

## Not yet

Scenes and scene files (`*.scene.json`), entities, timers/tweens/coroutines helpers,
tilemaps, sprite animation, real fonts and text layout, collision queries, audio
and save-data APIs, input remapping, Android loading of project files (the APK still embeds
the benchmark scene), and the studio itself.
