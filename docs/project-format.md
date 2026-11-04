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
  sprites/*.sprite.json   sprite sheets: frames, durations and animation tags for a PNG
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
  UV set 0, COLOR_0, a base colour factor and one base colour texture. Skins (JOINTS_0 and
  WEIGHTS_0, up to four joints per point) are read when a model is drawn with `parts` or a `clip`. Morph
  targets and extensions are reported as warnings in the log, not silently dropped.
- **Scripts:** Lua 5.4.

## Lua API v1

Scripts define `init()` (once, at load), `update(dt)` and `draw()` (every frame, in that
order). Anything may be drawn from `update` or `draw`. Each frame starts with empty draw
lists; draw what you want to see.

The Lua environment has `math`, `string`, `table`, `utf8` and `coroutine` only. `io`, `os`,
`package`, `debug`, `dofile`, `loadfile` and `collectgarbage` do not exist. This is a
stability boundary for hand-written games, not a hostile-code sandbox (see "Script limits").

### Drawing

Coordinates are *logical units*, 540 high on any screen (the width follows the aspect
ratio). `nova.view()` returns the current width and height as whole numbers (rounded down on screens that are not 16:9).

| Call | Layer | Meaning |
| --- | --- | --- |
| `nova.sprite(id, x, y [, opts])` | world | Draw a PNG, centred on `x, y`. |
| `nova.rect(x, y, w, h [, {r,g,b,a}])` | world | Solid rectangle, top-left `x, y`. |
| `nova.model(id, x, y, z [, opts])` | world | Draw a GLB model. |
| `nova.camera(ex,ey,ez, tx,ty,tz [, fov])` | world | 3D camera (eye, target, vertical field of view in degrees, default 60). |
| `nova.clear(r, g, b)` | world | Background colour, 0 to 255. |
| `nova.ui.sprite(id, x, y [, opts])` | UI | Same as `nova.sprite`, at native resolution. |
| `nova.ui.rect(x, y, w, h [, color])` | UI | Same as `nova.rect`, at native resolution. |
| `nova.ui.text(x, y, text [, opts])` | UI | Vector text, top-left `x, y` (see "Text and fonts"). |
| `nova.ui.text_size(text [, opts])`, `nova.ui.text_width(text [, opts_or_scale])` | | Measure text in logical units. |

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

**Model options:** `scale`, `rx`, `ry`, `rz` (radians), `tint` `{r,g,b[,a]}`, `parts`. Models are
instanced: draws of the same model in a frame become one GPU draw call. A model with see-through colours (a vertex alpha
below 255: `#rrggbbaa` in the model editor) is drawn after the solid ones, blended and without writing depth, so a puff of
dust or a window shows what is behind it; it does not sort against other see-through models.

**Lights.** Models are lit by one sun, an ambient floor and up to eight point lights:

```lua
nova.light { dir = { -0.4, -1, -0.3 }, color = { 255, 240, 220 }, ambient = { 97, 102, 117 } }   -- stays until changed
nova.point_light(x, y, z, { radius = 8, color = { 255, 160, 60 } })    -- one frame: call it every frame you want it
```

`dir` is the way the light travels; colours are 0 to 255 multipliers (255 = full, no gamma). Every
field of `nova.light` is optional. A ninth point light in a frame is ignored. Sprites and text are not lit.

**A 3D game on the ground.** Collisions, distances and neighbour queries use `x, y` by default, which is right for a flat game
and wrong for a 3D one, where `y` is height. Say once (in `main.lua`) which plane the ground is:

```lua
nova.collision { plane = "xz", cell = 2 }    -- cell: the size of the broad phase's squares, about the size of what collides
```

In `"xz"`, `on_collide_<tag>`, `overlaps`, `touching`, `distance_to`, `angle_to`, `move_toward`, `nova.nearest` and `nova.in_radius` use
`x` and `z`; a hitbox `{ r = 0.6 }` is a circle on the ground (scaled by the entity's `sx`, as a model's size is); height is ignored.
Tilemaps and `slide` stay flat.

Height: give a hitbox a `base` and a `height` (`{ r = 0.5, base = 0, height = 2 }`, in the model's own size) and two things only
collide when their heights meet; a hitbox with no `height` reaches every height. `nova.raycast(x, z, dx, dz, length, tag, { ignore, height, slope })`
shoots a ray at the entities with that tag and returns `entity, distance, hit_x, hit_z` for the nearest (`height` and `slope` say
where the ray starts and how it rises, so a shot can pass over a short thing); `nova.scenery.raycast` does the same against the
static scenery's circles and `nova.scenery.line_clear(x1, z1, x2, z2 [, radius])` answers "can they see each other?".
There are still no floors, ramps or ledges: scenery is circles on the ground.

**The 3D camera.** `nova.cam3` is a smoothed follow camera, a first-person camera and the way from a point of the screen into the world:

```lua
nova.cam3.look(-stick_x * dt, -stick_y * dt)                       -- yaw and pitch in radians (a mouse: pointer.dx * 0.0025)
nova.cam3.follow(player, { distance = 9, height = 8, smooth = 6, dt = dt })      -- behind and above, easing after it
nova.cam3.first_person(player, { height = 1.6 })                    -- at its head, looking where cam3.yaw / pitch say
local fx, fz = nova.cam3.forward()                                  -- "forward" on a stick, relative to the camera
local gx, gz = nova.cam3.ground_point(pointer.x, pointer.y, 1)      -- the ground under the mouse or a finger
local ox, oy, oz, dx, dy, dz = nova.cam3.ray(x, y)                  -- or the whole ray, for your own tests
```

**Seeing how the game is doing.** `nova.stats()` returns the last frame's `fps`, `lua_ms`, `render_ms`, `draws`, `triangles`, `sprites`,
`memory_kb` (the scripts' memory), `entities` and `scenery`: enough for an on-screen profiler (Ember Swarm shows it on F3).
`nova run --headless` prints the same split (scripts, the rest of the update, drawing) at the end.

**Interface layout and hit areas.** Rectangles are `{ x, y, w, h }`. `nova.ui.row { count, w, h, gap, y }` and `nova.ui.column { ... }` lay a
list of them out (centred in the view unless told where); `nova.ui.hit(rect)` and `nova.ui.clicked(rect)` ask about the pointer (the mouse, or the
first finger); `nova.ui.choose { rects, current }` runs a whole selection (keys and d-pad, pointer hover, click or A to accept) and returns
`chosen, accepted, moved`.

**Static scenery.** A level has thousands of trees, road pieces and barriers that never move. Do not make them live
entities: give the entity class `static = true` and a model, and a scene file's objects of that kind go into
`nova.scenery`, a grid of squares drawn only near the camera (out to `nova.scenery.range` metres, 200 by default):

```lua
-- entities/pine.lua
return nova.entity { model = "pine", static = true }
```

A scene object can set `ry` (turn, radians) and `sx` (size) as usual. The collision circles made for the model in the model
editor (the Collision section, green rings in the view) stop whatever asks `nova.scenery.push(x, z, radius)`, which
returns how far to move out of them (or nothing):

```lua
local dx, dz = nova.scenery.push(self.x, self.z, 1.3)   -- a car-sized circle
if dx then self.x, self.z = self.x + dx, self.z + dz end
```

`nova.scenery.ahead(x, z, dx, dz, length, radius)` looks along a line, as wide as a circle of `radius`, and returns how far away the nearest solid circle is and
where it is (`distance, cx, cz, cr`), or nothing: how a car or a character sees what is coming to steer round it.

`nova.scenery.add(model, x, y, z, opts)` adds a piece from a script; the scenery is emptied when a scene ends. A static
entity runs no code, so for a piece that also needs to do something (a lamp that gives a light), use an ordinary entity
whose `create` calls `nova.scenery.add` and destroys itself.

**Sky, fog and shadows.** Three more things set the scene's look; each stays until changed and `(nil)` turns it off:

```lua
nova.sky { top = { 40, 90, 200 }, horizon = { 200, 220, 240 } }       -- a gradient behind everything in 3D
nova.fog { color = { 200, 220, 240 }, near = 40, far = 250 }          -- models fade into the colour with distance
nova.shadows { radius = 45, strength = 0.6 }                          -- the sun's shadows around what the camera looks at
```

Sky and fog colours are as you pick them on screen. Fog the colour of the sky's horizon hides the place where far scenery
stops being drawn. Shadows are cast and received by every model unless it is drawn with `shadow = false` (do that for
the ground, far mountains and clouds); a model with see-through colours never casts one. A smaller `radius` gives sharper
shadows; they cost an extra drawing pass, so let players switch them off. A model shape can glow by itself in the dark
(`emissive`, see the model format). Scene files can set `sky` and `fog` too.

**Parts.** A model is a tree of named parts (the nodes of its `.glb`; the studio's model editor makes
one per part). `nova.model_parts("car")` lists their names. To move pieces on their own, give `parts`
a table of changes; each turns about the part's own pivot, inside its parent, so a wheel stays on its axle
and a door swings on its hinge:

```lua
nova.model("car", x, y, z, { ry = heading, parts = {
  wheel_fl = { rx = spin, ry = steer },     -- rx, ry, rz in radians
  door     = { ry = open * 1.2, x = 0.1 },  -- x, y, z shift in the part's own space
} })
-- entities do the same with a field:  self.parts = { wheel_fl = { rx = self.spin } }
```

Without `parts` a model is one instanced draw; with it each piece is drawn separately (more draw calls,
so use it for the few things that move). A mesh with a skin bends with the parts it is weighted to: the runtime poses its points on
the CPU every frame it is drawn this way (a part can be drawn up to 8 times in one frame). Without `parts` or a `clip` it shows at rest.

**Studio model files.** The model editor keeps `models/<name>.model.json` and writes the `.glb` from it on save;
the game only needs the `.glb`. The file is a tree: `parts` (each with `name`, `origin`, `rotation` in degrees,
`cubes` and `children`), optional `clips` and optional `colliders` (circles on the ground that the model blocks,
`{ "x": across, "z": forward, "r": radius }` in the same units as the cubes; the glb carries them in metres in the scene's
`extras.nova.colliders` and a game reads them with `nova.model_colliders(id)`). The `cubes` list holds solids, all in the part's own space (1 unit
is 1/16 of a world unit unless `scale` says otherwise):

| `shape` | Notes |
|---|---|
| `box` (default, omitted) | `from` (smallest corner) and `size`, colours per face (`faces`: east, west, up, down, south, north). |
| *(any shape)* | `emissive` (0 to 1, default 0, written only when above 0): how much the shape lights itself. At 1 its colour shows at full brightness even in a dark scene (lamp heads, windows, tail lights). In the exported glTF it is its own material with `emissiveFactor` set to that number in all three channels; the runtime draws the glow as the shape's colour times (scene light + glow). |
| `wedge`, `pyramid`, `cylinder`, `cone`, `sphere` | The same `from`/`size` box. A wedge is full height at its north side sloping to nothing at the south; the rest stand on y. `segments` (3 to 64, default 16) sets the sides of round shapes and `smooth: false` makes them faceted. Face colours: wedge up/down/north/east/west, pyramid down and the four sides, cylinder up/down, cone down; everything else takes `color`. |
| `mesh` | `verts` (points in the part's space) and `polys` (each `{ "v": [point numbers], "color"?, "smooth"? }`, counter-clockwise seen from outside, three to 64 points). `from` and `size` are worked out from the points and are not written. Optional `skin`: `{ "bones": [part paths such as "body/arm"], "weights": [[[bone number, weight], ...] for each point] }`, at most four bones per point, weights adding up to one. The studio works the weights out from the parts around the shape and lets you set them by hand. A renamed part is followed; a removed part's weight is shared among the rest. |

Animation keys (`clips[].tracks[].keys[]`: `t`, `value`) may carry `"ease"`: `step`, `in`, `out` or `inout` (straight when absent) for how the
value blends into the next key. The exported `.glb` bakes an eased segment into extra keys (glTF samplers are straight), so the runtime
needs nothing new.

Every shape but a mesh may carry `rotation` (degrees, X then Y then Z, about its box's centre). A polygon's colour
is its own `color`, else the shape's `color`; shapes are drawn with flat colours baked into the `.glb` as vertex
colours.

**Textures.** A model can carry one painted picture, saved as `models/<name>.texture.png` beside the `.model.json`
and embedded in the `.glb`. The model file says `"texture": { "size": [64, 64] }` (8 to 1024 texels each way) and
each shape painted with it has `"texture": { "at": [x, y], "scale": 1 }`: `at` is the top-left of its block of the
picture and `scale` the texels per model unit (default 1). Inside its block a shape unwraps by itself: a box as the
usual cross of six faces, a wedge or pyramid the same way, cylinders, cones and spheres as a strip round the middle
plus caps, and a mesh as one flat patch per polygon. The layout follows the shape's size and points, never its
position or turn, so resizing a shape changes its block (use "Pack blocks" in the editor to lay them out again;
painted pixels do not move with it). A shape's `color` is a tint multiplied with its texels (white after texturing is
turned on, which also paints the shape's old colours into its block). `"mirror"` on a mirrored box's texture
(bits 1, 2, 4 for x, y, z) makes it show the same texels reflected. `"faces": { "up": [x, y, width, height] }` places a single face
of a box, wedge or pyramid anywhere in the picture (texels), instead of its place in the automatic layout; faces may share texels. In the `.glb` the picture gets one extra white
row at the bottom that unpainted shapes sample, so a model's flat-coloured shapes show exactly their colour; the
sampler is nearest-neighbour and clamped. The runtime needs nothing new: it reads one base-colour texture with UVs.

**Animation clips.** A `.glb` can carry named clips (the model editor's Animations panel makes them): keyframes
for the position, rotation and scale of parts. `nova.model_clips("car")` lists `{ name, duration }`.

```lua
nova.model("car", x, y, z, { clip = "spin", time = t })            -- pose it at t seconds (loops by default)
nova.model("car", x, y, z, { clip = "open", time = t, loop = false }) -- holds the last pose past the end

-- entities play clips and keep their own time:
self:play_clip("spin")                       -- loops; { loop = false } plays once and calls on_clip_end("spin")
self.clip_speed = 2                          -- twice as fast (field; default 1)
self:stop_clip()                             -- back to the authored pose
```

A clip replaces whatever it keys (position, rotation or scale) of a part; everything else stays as authored,
and `parts = {...}` turns still apply on top. Blending is linear, rotations blend as quaternions, and a clip
holds its first and last values outside its keys. glTF cubic-spline keys are read as their values only.
Playing a clip draws each part separately, like `parts`.

### Input, time, log

Games ask about named **actions**, never about devices: `nova.input.down("jump")` works the same
with a keyboard, a gamepad or a touch screen, because the project (not the script) says which
inputs drive which action.

| Call | Meaning |
| --- | --- |
| `nova.input.down(name)` | True while the action is held (axes count as down past half way in either direction). |
| `nova.input.pressed(name)` | True in the one game step after the action went down. |
| `nova.input.released(name)` | True in the one game step after it was let go. |
| `nova.input.axis(name)` | `-1` to `1` for axes (`move_x`), `0` to `1` for buttons. |
| `nova.input.actions()` | Every action name. |
| `nova.input.bind(name, spec)` | Rebind at run time (see below); `nova.input.reset_bindings()` undoes it. |
| `nova.input.bindings(name)` | The sources an action uses (a list, or `{ negative, positive }` for axes). |
| `nova.input.last_source()` | The most recently pressed source id (`"key:KeyZ"`), for "press a button to bind it" screens. |
| `nova.input.pointer()` | The mouse, or the first finger: `{ present, x, y, dx, dy, down, right, middle, pressed, released, wheel }`, in the game's units; `pressed` and `released` are seen by exactly one step each. |
| `nova.input.grab_mouse(on)` | Lock and hide the cursor so the mouse can turn a camera without end (`dx`, `dy` are then pushes); `false` frees it. |
| `nova.input.next_source()` | The source pressed since you last asked (each press once, then `nil`): call it once to drop the press that opened your screen, then every frame until it returns something. |
| `nova.input.rumble(strength, seconds)` | Shake a gamepad (`nova.input.rumble{ strong, weak, seconds, pad }` for the two motors and one pad). Pads that cannot rumble ignore it. |
| `nova.time()` | Seconds since the game started. |
| `nova.log(text)` | Write to the log. |

**The desktop window closes on Escape** unless the game uses `key:Escape` in an action (a pause, say).

**Edges are exact.** `pressed` and `released` are latched to game steps: the framework steps at 60 Hz
whatever the frame rate, and a press that lands on a frame with no step (a 120 Hz screen) is held for
the next step instead of being lost, and a press is never seen by two steps. A tap that starts and
ends between two steps still reports both edges.

**Built-in actions** (all can be replaced): `left right up down`, `a b x y`, `l1 r1 l2 r2`, `start
select` (buttons), `move_x move_y look_x look_y` (axes: right and down are positive, `look_*` is the
right stick), and the older `steer throttle brake action`. Defaults: arrows or WASD or the D-pad or the
left stick for movement; `a` is Z, Space, the gamepad's south button or a touch on the right half of the
screen; `b x y` are X, C, V and east, west, north; `start` is Enter; `select` is Tab. Dragging a finger
on the left half of the screen moves `move_x`/`move_y`.

**Project bindings.** Add an `"input"` section to `nova.json`. A list is a button; an object with
`negative` and `positive` lists is an axis. A name that already exists is replaced (not merged); a new
name is added:

```json
{ "format": 1, "name": "My Game",
  "input": {
    "jump": ["key:Space", "pad:south", "touch:right"],
    "fire": ["key:KeyZ", "pad:west"],
    "move_x": { "negative": ["key:KeyJ", "axis:left_x"], "positive": ["key:KeyL", "axis:left_x"] }
  } }
```

**Sources** are `key:<Name>` (a keyboard key: `KeyA`, `Digit1`, `ArrowLeft`, `Space`, `Enter`,
`ShiftLeft`, `F5`...), `pad:<button>` (`south east west north l1 r1 l2 r2 start select thumb_l thumb_r
dpad_up dpad_down dpad_left dpad_right`), `axis:<name>` (`left_x left_y right_x right_y l2 r2`; add `+`
or `-` to take only one direction), `mouse:<button>` (`left right middle`) and `touch:<zone>` (`left`, `right`, `drag_x`, `drag_y`). **Several gamepads:** `pad:south` is held on any pad and `axis:left_x` follows the stick that moves most, which is what a
one-player game wants; `pad2:south` and `axis2:left_x` (up to `pad4`/`axis4`) are only the second pad, counting in the
order the pads were plugged in (`pad1:` is the first), for a game with several players. Numbered pads work on desktop;
Android reports every controller as one pad for now. Analogue
sources have a 20% dead zone. A mistake in `nova.json` stops the project from loading and names the
exact place, for example `nova.json.input.fire[0]: 'Nope' is not a key name`. At run time,
`nova.input.bind("jump", { "key:KeyM", "pad:east" })` changes an action for the rest of the run; save
the player's choice with `nova.save` and bind again at start-up.

Android: gamepad *buttons* and the D-pad work (as key events). Analogue sticks and triggers do not
reach the game on Android yet.

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

- A spec's `sprite`, `model`, `tags`, `depth`, `hitbox`, `pivot` and `screen` are read by the engine; every
  other field is a default value for new instances (tables are copied per instance).
- Inherited methods, defaults and tags come from the parent; a child can override any of them.
- Built-in fields: `x`, `y`, `z`, `vx`, `vy`, `vz` (velocity moves the entity each step), `sx`,
  `sy` (scale), `angle` (radians), `alpha`, `visible`, `tint` (`{r,g,b}`), `depth`, `id`.
  Do not keep your own velocity in `vx`/`vy`/`vz` if your code also moves the entity: the engine adds it again
  (use `velx`, `velz`...). A field with the same name as a method of the same class (`place = 3` and
  `function Car:place()`) is an error, because the field would hide the method.
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
`nova.nearest(x, y, tag [, max_distance])`, `nova.in_radius(x, y, r, tag [, list_to_refill])` (both use a grid of the tag's entities once there are about forty, so they stay cheap with hundreds; they compare where entities are *now*, so an entity that jumped further than one square within a single step may be missed until the next),
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
  "sky": { "top": [40, 90, 200], "horizon": [200, 220, 240] },
  "fog": { "color": [200, 220, 240], "near": 40, "far": 250 },
  "width": 2000, "height": 540,
  "camera": { "eye": [0, 6, 12], "target": [0, 1, 0], "fov": 60 },
  "objects": [ { "kind": "player", "name": "hero", "x": 480, "y": 440, "z": 0, "props": { "hp": 5 } } ],
  "images":  [ { "image": "sprites/star.png", "x": 24, "y": 24, "scale": 1, "depth": 0, "layer": "ui", "color": [255, 255, 255, 255] } ],
  "texts":   [ { "text": "SCORE", "name": "label", "x": 8, "y": 8, "scale": 2, "depth": -10, "color": [255, 255, 255] } ]
}
```

`objects` spawn `entities/<kind>.lua` with `props` as field values. `images` are pictures
(`"layer"`: `"world"`, the default, or `"ui"`). `texts` are UI text. `width` and `height` set the
camera's limits. `camera` (optional) is the 3D camera the scene starts with, the same as calling
`nova.camera(eye, target, fov)` when the scene is built; each part is optional (eye `[0, 5, 10]`, target
`[0, 0, 0]`, `fov` 60, allowed 10 to 150). `sky` and `fog` (optional) do what `nova.sky{...}` and `nova.fog{...}` do when
the scene is built: a gradient behind the 3D view (`horizon` defaults to `top`), and models fading into a colour between `near`
(default 40) and `far` (default 250) metres. In a 3D scene an object's `x` goes across, `y` up and `z` towards the
viewer, and the props `ry`, `rx`, `rz` (radians) and `sx` (size) turn and scale a model entity. **A `name` becomes a field of the scene** (`self.hero`); names must be unique,
start with a letter and not collide with the scene's own methods. Errors are reported with the file
and the exact place, for example `scenes/play.scene.json.objects[2]: missing "kind"`.

### Pivot

A sprite is centred on the entity's `x, y` by default. `pivot = { 0.5, 1 }` (fractions of its
size, left/top is `0, 0`) puts that point there instead, here the bottom centre, so a character
stands on its position. Rotation (`angle`) turns the picture about the pivot, and the default hitbox
(the sprite's size) moves with it.

### Particles

```lua
-- a puff that cleans itself up
nova.burst(self.x, self.y, { count = 14, speed = { 60, 160 }, life = { 0.3, 0.7 }, size = 5, size_end = 0,
                             color = { 255, 200, 80, 255 }, color_end = { 255, 60, 0, 0 }, gravity = 200 })

-- a continuous emitter you keep (sparks, smoke, rain); move it with fx.x, fx.y
local fx = nova.particles(self.x, self.y, { rate = 40, image = "spark", life = 0.8, angle = -math.pi / 2, spread = 0.6, speed = { 30, 80 } })
fx:burst(10)   -- an extra puff
fx:stop()      -- stop making new ones
```

Spec fields: `rate` (per second), `count` (for `burst`), `life`, `speed`, `size`, `spin` (each a number or
`{ min, max }`), `size_end` (a multiplier reached at the end of life), `color` and `color_end` (RGBA,
blended over life), `gravity`, `drag`, `angle` (direction in radians, default up) and `spread` (the
cone's full width, default all directions), `area` (`{ w, h }` to spawn across), `image` (a sprite
instead of a square), `max` (default 1000), `screen` (UI layer) and `depth`. Particles are drawn by
the emitter, an ordinary entity, so they obey the camera and depth ordering.

**In 3D** give the spec a `model` (drawn instead of a square) and a third coordinate: `nova.particles(x, y, z, spec)`
and `nova.burst(x, y, z, spec)`. Then `y` is up, `dir = { x, y, z }` is the direction (default straight up) and `spread` the
cone's full width in radians (default a quarter turn); `speed` and `size` are in metres, `gravity` pulls along `y` (use a
negative number to fall), `area = { w, h, d }` spawns across a box and `color` tints the model (its alpha fades it).
`image`, `angle` and `screen` are for flat games. `spin` turns the model about the vertical.

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

## Sprite sheets and animation

`sprites/hero.sprite.json` cuts one PNG into equal frames and names animations. The model
follows Pixelorama: frames in a grid, a duration per frame, and *tags* (named frame ranges with a
play direction). The studio's sprite editor writes these files; hand edits are fine. Beside the sheet it may keep
`<name>.layers.json`, its own editable layers (and which cels of a layer are linked, so that drawing on one draws on all); the game
ignores it (only the flat PNG is used).

```json
{
  "version": 1,
  "image": "hero_sheet.png",
  "frame_width": 32, "frame_height": 32,
  "columns": 6, "frames": 6,
  "durations_ms": [320, 320, 90, 90, 90, 90],
  "tags": [
    { "name": "idle", "from": 0, "to": 1 },
    { "name": "run",  "from": 2, "to": 5, "direction": "forward" },
    { "name": "hit",  "from": 6, "to": 7, "loop": false }
  ]
}
```

In the studio each animation owns its frames: the sprite editor shows one animation's frames at a time, and
adding, removing or moving a frame changes only that animation. It saves the animations as tags that are
consecutive blocks of the frame list (no overlaps, no gaps), so a file the studio wrote never has two tags
sharing a frame. A file written elsewhere with overlapping tags is split on opening: a shared frame is copied into
each animation, and frames in no tag go into an animation called `unused`. The game reads tags exactly as before,
so nothing here changes the runtime.

**Importing a sheet.** In the sprite editor, "Import sheet…" cuts any PNG in the project into tiles (tile size is
guessed and can be set, with an optional gap between tiles and border around them) and adds them as one new
animation, or as one animation per row, or onto the end of the current animation. Empty tiles can be left out. Tiles can be cut by size, by how many there are across and down, or by "Smart slice", which
finds tiles separated by empty gaps of equal width.
Tiles take the sprite's frame size (bottom centre kept); a sprite that is still empty takes the tile size. The
imported pictures are copied into the sprite: the sheet itself is not referenced afterwards.

`image` is relative to the JSON file. `columns` and `frames` default to what fits in the image.
Durations: `frame_duration_ms` (one value for all frames, default 100) or `durations_ms` (one per
frame), in milliseconds. Tag `direction`: `forward` (default), `reverse` or `pingpong` (forward and
back without repeating the end frames). `loop` defaults to true. Errors name the file and place.

A short name like `"hero"` refers to the sheet (it wins over a plain `hero.png`). Drawing a sheet
draws one frame: `nova.sprite("hero", x, y, { frame = 3 })`, sized as a frame, not the whole PNG.

On an entity with `sprite = "hero"`:

```lua
local Hero = nova.entity { sprite = "hero", anim = "idle" }   -- anim: the tag that plays from the start
self:play("run")                    -- same tag again keeps going; { restart = true } starts over
self:set_frame(4)                   -- stop animating and show frame 4
self:stop_animation()
function Hero:on_animation_end(tag) end     -- when a non-looping tag finishes
self.anim_speed = 2                 -- playback speed multiplier (default 1)
```

`self.frame` is the frame being shown. A default hitbox uses the frame size.

## Tilemaps

A tilemap is a grid of tiles cut from a tileset PNG (row-major from 0; `-1` is empty). The tile
data lives in native code, so drawing is culled to the view and big maps are cheap.

```lua
local ground = nova.tilemap {
  image = "tiles", tile_width = 16, tile_height = 16,      -- the tileset (a short name or a path)
  tiles = { { 0, 0, 0 }, { 1, 1, 1 } },                    -- rows, top first
  solid = { 0, 1 },                                        -- tile numbers that block slide()
  x = 0, y = 456, depth = 90,
}
ground:get(col, row)   ground:set(col, row, tile)   ground:size()        -- columns, rows, tile w, tile h
ground:cell_at(x, y)   ground:tile_at(x, y)         ground:is_solid_at(x, y)    -- world points
nova.solid_at(x, y)                                                       -- any tilemap
local hit_x, hit_y = self:slide(dx, dy)                                   -- entity moves, stopping at solid tiles
```

In a scene file, add `"tilemaps": [ { "name": "ground", "tileset": { "image": "sprites/tiles.png",
"tile_width": 16, "tile_height": 16 }, "x": 0, "y": 456, "depth": 90, "solid": [0, 1], "tiles":
[[0, 0], [1, 1]] } ]`; the tilemap becomes `self.ground`. `slide` moves one axis at a time (so
entities glide along walls) in sub-steps no bigger than half a tile, so a fast entity cannot jump a
thin wall. It uses the entity's hitbox box. Tile numbers outside the tileset, ragged rows and
unknown tilesets are errors that say which cell.

## Text and fonts

Text is real vector text, rasterised at the screen's own pixel size so letters stay sharp, with
kerning, wrapping and alignment. It is drawn in the UI layer (native resolution), after UI sprites.

```lua
local w, h = nova.ui.text(x, y, "Hello", {
  font = "serif",            -- a built-in name or a project font (below); default "sans"
  size = 24,                 -- logical units tall (default 16); the older `scale` is 8 units per step
  color = { 255, 220, 120 },
  width = 300,               -- wrap lines at this width
  align = "center",          -- "left" (default), "center" or "right": inside `width` when there is one; without it,
                             -- around x (x is the middle, or the right edge) so no box is needed to centre a title
  shadow = true,             -- or a colour such as { 0, 0, 0, 200 }
})                           -- returns the size it took
local w, h = nova.ui.text_size("Hello", { font = "mono", size = 20, width = 200 })   -- measure only
local w = nova.ui.text_width("Hello", 2)                                              -- older form
```

Built-in fonts (SIL Open Font License; see `licenses/fonts/`): `sans` (Inter), `rounded` (Fredoka),
`pixel` (Press Start 2P), `terminal` (VT323), `mono` (JetBrains Mono), `serif` (Lora), `comic`
(Bangers), `display` (Cinzel), `script` (Pacifico). `examples/font-gallery` shows all of them.

Your own: put a `.ttf` or `.otf` in the project (for example `fonts/title.ttf`) and use `font = "title"`
or `font = "fonts/title.ttf"`. A file that is not a usable font stops the project from loading, naming
it. Notes: variable fonts draw at their default weight; pixel fonts look best at multiples of their
design size (Press Start 2P at 8, 16, 24...); `\n` starts a new line; text beyond 20,000 characters in one
call is cut. Letters are rasterised once per (font, character, pixel size) into a 2048x2048 coverage
atlas; if it ever fills it is cleared and rebuilt. The engine's own overlays (the error banner, the F3
stats) still use a small built-in pixel font.

## Sound

Put WAV or Ogg Vorbis files anywhere in the project (`sounds/` and `music/` are where short names
are looked up, `.wav` before `.ogg`). WAV files of 8, 16, 24 or 32-bit integer or 32-bit float PCM and
Ogg Vorbis files, mono or stereo, 8 to 192 kHz, up to 10 minutes each and 256 MiB decoded in total, are
decoded once when the project loads. **Ogg files in `music/` are streamed instead:** only the compressed file is
kept in memory (a minute of music is about a megabyte, not ten) and a background thread decodes a second or so
ahead while `nova.music.play` runs, looping without a gap. Their header is checked at load, so a broken file still
stops the project with an error naming it, but a streamed file cannot be played with `nova.sound.play`. WAV music,
and Ogg in `sounds/`, is decoded at load as before, so ship long music as Ogg. The studio does this for you: songs save as `.ogg`, and a WAV in `music/` has a **Convert to Ogg** button. If the decoder ever falls behind
(a very slow device) that moment is silence and playback carries on; the F3 overlay's audio line shows
`underruns N` (frames of music that were silence for that reason; it should stay 0). `nova.music.seek` on a
streamed track restarts its decoder at the new time: the spot is found through the file's page index, so it is
heard within a few tens of milliseconds wherever it lands in the track.

```lua
local id = nova.sound.play("jump", { volume = 0.6, pan = -0.5, pitch = 1.2, loop = false })
nova.sound.set(id, { volume = 0.4, pitch = 1.5, pan = 0 })   -- change a playing sound (any of the three)
nova.sound.stop(id, 0.25)            -- optional fade-out in seconds
nova.sound.stop_all()
nova.sound.volume(0.8)               -- master volume for effects (0 to 2)

nova.music.play("theme", { volume = 0.4, fade = 1.0 })   -- loops by default; one track at a time
nova.music.stop(0.5)                 -- optional fade-out
nova.music.volume(0.5)               -- master volume for music (0 to 2)
nova.music.position()                -- seconds into the track (nil when no music plays; wraps on loops)
nova.music.seek(30)                  -- jump to 30 s; true, or false when nothing is playing
```

`volume` 0 to 4 (default 1), `pan` -1 (left) to 1 (right) with an equal-power law, `pitch` 0.05 to 16
(2 is an octave up; it also changes speed). `nova.sound.set` glides to the new values over about 10 ms, so a looping sound can be steered every frame: an engine's pitch
following the revs, wind following speed. A sound that has ended ignores it, and so does `pitch` on streamed music. Starting new music fades the old track out over 0.3
seconds. Up to 32 effects play at once; past that the oldest gives way. Output is soft-clipped, so a
loud mix cannot distort harshly. Names resolve as the exact path, then `sounds/<name>.wav`, then
`music/<name>.wav`. The mixer runs on the audio thread and costs about 0.1 ms per callback on the
Android emulator. Sound calls are queued and sent to the audio thread each frame; with no audio
device (headless runs) they are discarded.

## Save data

```lua
nova.save.set("best", 120)                        -- numbers, strings, booleans and tables of those
nova.save.set("settings", { volume = 0.5, names = { "a", "b" } })
local best = nova.save.get("best", 0)             -- the second argument is the default
nova.save.delete("best")        nova.save.keys()  -- sorted list of keys
nova.save.flush()                                 -- write now (it is also written every 3 seconds and on exit)
```

One JSON file per game, `save.json`, in the platform's data folder: `~/Library/Application
Support/Nova/<game-name>/` on macOS, `$XDG_DATA_HOME/Nova/...` on Linux, the app's private storage on
Android. `--save-dir <folder>` chooses another place. **Headless runs keep saves in memory** unless
`--save-dir` is given, so tests and captures never touch real saves. The file is written atomically
(a temporary file, then a rename); if it cannot be read it is kept as `save.json.corrupt-<time>`, the
game starts with an empty save and a warning is logged. Limits: 1 MiB in total, keys of 1 to 128
characters. A value that cannot be saved (a function, say) or would break the limit is an error that
names the key. The save is opened before any script runs, so a script can read it at load time.

## Script limits

Lua may use at most 256 MiB. One frame of `update` + `draw` may run for at most 1 second and loading
(the entry script and `init`) for 5 seconds; after that the script is stopped with "the script ran for
too long in one frame; is there an endless loop?" and the error banner shows. Coroutines started with
`go` are covered too. These are guard rails for hand-written games, not a security boundary.

## Packing and Android

`nova pack <folder> <out.npk>` validates a project and packs it into one file (`NPK1`: a file table
and the data, using the same path rules as everywhere; a damaged or hostile file is rejected, never
trusted). `nova run --pak game.npk` plays it, exactly like the folder minus hot reload.

`scripts/build-apk.sh --project <folder>` builds a debug-signed APK of a game without Gradle: the
runtime library, a manifest filled from `nova.json` (package `com.nova.games.<id>`, the game's name
as the label), and the packed project as `assets/project.npk`. On Android the runtime loads that
file; an APK without one runs the benchmark scene. Save data goes to the app's private storage.
`nova info <folder>` prints the name, version and id for scripts.

Verified: Crate Dash built this way installs and plays on the Android emulator (touch input,
animation, collisions, tilemap) at 60 fps. Not verified: any physical device.

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

World-space text, paths, streamed music (Ogg is decoded fully into memory), synthesised music and a sound editor (M6), input remapping and named actions, rigid-bone model animation, and the studio itself.

## Testing helpers

`nova run <folder> --headless --frames N --capture out.png` renders without a window, and
`--hold jump,move_x=0.5` holds actions down for the whole run, so a screenshot can show
real gameplay. `--press key:Enter@30,pad:south@120` taps sources (held for two frames from the frame given), to get
past menus and into the game before the picture is taken.

**Recorded input.** `--input play.json` plays back what was held and where the pointer was, frame by frame, and
`--record play.json` writes the input of a run (headless or in a window) in the same format, so a real session can be
replayed exactly. The file is a list of events, each with `at` (the frame it starts), `for` (how many frames it lasts, 1 if
left out), `hold` (source id to value, like `{"key:KeyW": 1}`) and, if it has one, `pointer` (`x`, `y`, `dx`, `dy`, `down`,
`right`, `middle`, `pressed`, `released`, `wheel`; `absent` for no pointer). Everything in an event applies on every frame it
covers, a pointer's `dx`, `dy` and `pressed` too, so a mouse pushed along for ten frames is one event with `for: 10` and a
`dx`. Overlapping events add up: a source takes the biggest value and the pointer comes from the latest event that has
one. Tests use the same format (`nova_runtime::inputscript::InputScript`): see `tests/data/blockfield-dig.json`.

**Profiling the scripts.** `nova run <folder> --headless --profile` lists, at the end of the run, the script functions and the
engine calls (`(engine) draw`, `(engine) pump_chunks`) that took the most time. Inside a game, `nova.profile(true)` starts the
same profiler, and `nova.profile_report(15)` gives the list for an on-screen display. It looks at which function is running
every couple of thousand VM instructions and charges it the time since the last look, and it times calls into the engine
by name, so a slow `nova.*` call is not blamed on the Lua function around it. The scripts run somewhat slower while it is on.
