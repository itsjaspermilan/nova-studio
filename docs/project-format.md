# Nova project format v1 and Lua API v1

Status: implemented in `crates/nova-runtime` (`vfs.rs`, `project.rs`, `assets.rs`, `game.rs`).
Run a project with `nova run <folder>`. The example is `examples/rally-demo/`.
Two layers: an **immediate-mode API** (draw whatever you like from `update`/`draw`) and,
on top of it, a **scene and entity framework** you opt into with `nova.start("scene")`.
Tilemaps, sprite animation, audio and saves come later and will be added here as they land.

## A project is a folder

```
my-game/
  nova.json        required: names the game
  main.lua         the entry script (the name is configurable)
  sprites/*.png    PNG images (any folder works; sprites/ is where short names are looked up)
  models/*.glb     static glTF models (models/ is where short names are looked up)
  entities/*.lua   one entity class per file (entities/enemies/grub.lua is "enemies.grub")
  scenes/*.lua     one scene class per file, with an optional scenes/<name>.scene.json
  lib/util.lua     modules, loaded with require("lib.util")
  anything else    ignored for now (audio and fonts are recognised by extension but not used yet)
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

**Short names.** Anywhere an image or model is named, the full project path
(`sprites/car.png`) or a short name (`car`, looked up as `sprites/car.png` and
`models/car.glb`) works, in the raw calls and in the framework alike.

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

## Scenes and entities (the framework)

Call `nova.start("title")` from `main.lua` and the framework runs the game: it loads
`scenes/title.lua`, steps the world at a fixed 60 Hz, and draws everything. (It replaces
the global `update`/`draw` functions, so a game uses either those or the framework.)
Everything the framework does is plain Lua over the API above; you can mix both.

### Entities

```lua
-- entities/player.lua
local Player = nova.entity { sprite = "player", tags = { "player" }, speed = 220, hp = 3 }

function Player:create() end                       -- once, after the fields are set
function Player:update(dt)                         -- every step
  self.x = self.x + nova.input.axis("steer") * self.speed * dt
end
function Player:on_collide_enemy(enemy) enemy:destroy() end   -- when touching anything tagged "enemy"
function Player:on_destroy() end
return Player                                      -- the file must return the class

-- entities/boss.lua: builds on another entity
return nova.entity(require("entities.enemy"), { hp = 500, tags = { "boss" } })
```

- A spec's `sprite`, `model`, `tags`, `depth`, `hitbox` and `screen` are read by the engine; every
  other field is a default value for new instances (tables are copied per instance).
- Inherited methods, defaults and tags come from the parent; a child can override any of them.
- Built-in fields: `x`, `y`, `z`, `vx`, `vy`, `vz` (velocity moves the entity each step), `sx`,
  `sy` (scale), `angle` (radians), `alpha`, `visible`, `tint` (`{r,g,b}`), `depth`, `id`.
- Sprites draw centred on `x, y`. A `model` draws at `x, y, z` (y up) turned by `ry`
  (or `angle`). `screen = true` draws a sprite in the UI layer, ignoring the camera.
- `depth`: bigger is further back (default 0). Equal depths draw in creation order.
- **Hitboxes** are offsets from the position: `{ x, y, w, h }` is a box, `{ r = 8 }` a circle
  (with optional `x`, `y` offsets). Without one, the sprite's size, centred, is used. A circle
  against a box is tested as the circle's bounding box.
- `on_collide_<tag>(self, other)` methods run once per overlapping pair per step. A broad phase
  keeps this fast with many entities. If either entity is destroyed in a handler, later handlers
  for it are skipped.
- A custom `draw(self)` replaces the default drawing (call `nova.Entity.draw(self)` to keep it).

**Methods:** `destroy()`, `is_alive()`, `distance_to(x, y | entity)`, `angle_to(...)`,
`move_toward(x, y, step | entity, step)` (true on arrival), `set_velocity(angle, speed)`,
`speed()`, `overlaps(other)`, `touching(tag)` (first overlapping entity with the tag),
and the timer methods below.

**World functions:** `nova.spawn(kind_or_class, x, y [, props])`, `nova.each(tag, fn)`,
`nova.all(tag)` (a fresh list of living entities), `nova.first(tag)`, `nova.count(tag)`,
`nova.nearest(x, y, tag [, max_distance])`, `nova.in_radius(x, y, r, tag [, list_to_refill])`,
`nova.send(entity_or_tag, "method", ...)`, `nova.pause(on)` (freezes entities, timers keep going and
the scene keeps updating, for pause menus).

### Scenes

```lua
-- scenes/play.lua
local Play = nova.scene {}
function Play:enter(level)  end      -- after scenes/play.scene.json is built; gets goto_scene's extra arguments
function Play:update(dt)    end      -- every step, after the entities
function Play:draw()        end      -- world drawing, after the entities
function Play:draw_ui()     end      -- UI drawing, last
function Play:leave()       end      -- before the next scene replaces this one
return Play
```

`nova.goto_scene("over", ...)` replaces the scene at the start of the next frame (every entity is
destroyed and every timer cancelled); `nova.restart_scene()` rebuilds the current one from its
file; `nova.current_scene()` names it. Scenes have `self:after/every/go/tween` too.

### `scenes/<name>.scene.json` (version 1)

Data only: loading it never runs code. Defaults are shown; unknown keys are errors.

```json
{
  "version": 1,
  "background": [92, 150, 214],
  "width": 2000, "height": 540,
  "objects": [ { "kind": "player", "name": "hero", "x": 480, "y": 440, "z": 0, "props": { "hp": 5 } } ],
  "images":  [ { "image": "sprites/star.png", "x": 24, "y": 24, "scale": 1, "depth": 0, "layer": "ui", "color": [255, 255, 255, 255] } ],
  "texts":   [ { "text": "SCORE", "name": "label", "x": 8, "y": 8, "scale": 2, "depth": -10, "color": [255, 255, 255] } ]
}
```

`objects` spawn `entities/<kind>.lua` with `props` as field values. `images` are pictures
(`"layer"`: `"world"`, the default, or `"ui"`). `texts` are UI text. `width` and `height` set the
camera's limits. **A `name` becomes a field of the scene** (`self.hero`); names must be unique,
start with a letter and not collide with the scene's own methods. Errors are reported with the file
and the exact place, for example `scenes/play.scene.json.objects[2]: missing "kind"`.

### Timers, tweens and scripts that wait

On any entity or scene (they stop when it is destroyed or the scene changes), each returning a
handle with `:cancel()`:

```lua
self:after(1.5, function() ... end)                 -- once
self:every(2, function() ... end)                   -- until cancelled (the interval must be > 0)
self:go(function() nova.wait(0.5) ... nova.wait_until(function() return ready end) end)
self:tween({ x = 100, alpha = 0 }, 0.4, "out_quad", function() ... end)   -- glide fields; optional done callback
```

Easings: `linear`, `in_quad`, `out_quad`, `in_out_quad`, `in_cubic`, `out_cubic`, `in_out_cubic`,
`out_back`, `out_bounce`. All of it runs in game time.

### Camera (2D)

World sprites and entities are drawn relative to a camera: `nova.cam.set(x, y)` (the centre),
`nova.cam.follow(entity [, lerp])` (1 locks on, smaller trails), `nova.cam.limit(x0, y0, x1, y1)`,
`nova.cam.position()`. UI drawing ignores it. For 3D, call `nova.camera(...)` yourself.

### Timing

The framework always advances in 60 Hz steps, however fast frames come: a slow frame runs
several steps (at most five, then it lets go instead of spiralling).

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

Tilemaps, sprite sheets and animation, real fonts and text layout, paths, audio and
save-data APIs, input remapping and named actions, rigid-bone model animation, Android loading
of project files (the APK still embeds the benchmark scene), and the studio itself.

## Testing helpers

`nova run <folder> --headless --frames N --capture out.png` renders without a window, and
`--hold throttle,steer=0.5` holds actions down for the whole run, so a screenshot can show
real gameplay.
