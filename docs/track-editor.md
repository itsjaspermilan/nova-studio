# The track editor

A screen in the studio for laying out a racing circuit or a rally stage without a script. Open one from **Tracks** in the project tree (the
**＋** beside it makes a new one: a starting oval) or from the file `tracks/<name>.track.json`. **{ } Text** shows the file as text.

## What you do

- **Generate** (top of the side panel): **New random route** makes a whole route for you, a circuit or a stage as set under Route, from a
  random seed, a length (metres) and a Curves slider (gentle to twisty); undo brings the old route back. **Redo this seed** makes it again
  after you change the length or curves; the same seed, length and curves always give the same route. Every route passes the editor's own
  checks (no bend tighter than 28 m, no two parts of the road closer than 60 m), starts on a straight heading along +z, and drops any zones
  (they were metres along the old route). **Look** sets the road, sky and scenery to a ready-made set (forest, desert or snow: the sets of
  Pine Ridge Rally's courses); **Apply look** keeps the route. Then press *Generate scene and road*. The route is only a starting point:
  drag its points like any other.
- **Click the ground** to add a point. Near the route the point goes in between its neighbours; elsewhere it goes on the end.
  **Drag** a point to move it; select it and press **Delete** (or **Delete point**) to remove it. A route keeps at least two points
  (four to generate). Scroll zooms, dragging the ground pans, **Fit** frames the route, **Undo/Redo** step through the edits (⌘Z, ⇧⌘Z).
- The smooth road is drawn live through the points, 12 m wide, in the colour of the chosen road. A thin line along it is coloured by how
  sharp the bend is (green gentle, red tight). The route starts at point 1 heading for point 2 (the white **Start** line).
- **Circuit (a loop)** or **Stage (start to finish)**. A stage also has a **Finish** line, its **Sections** (equally spaced gates, numbered
  on the map; the last gate is the finish), and the road **before the start** and **after the finish** (40 m and 90 m by default).
- **Road**: asphalt, dirt, snow, gravel or sand (the colours of the generated road mesh).
- **How it drives**: length, tightest bend, and how close two far-apart parts of the road come. A bend tighter than 15 m across, or road
  parts closer than 40 m, show a warning (and the tightest bend is ringed in red on the map).
- **Scenery**: tick entities from the project's `entities/` folder as Trees, Bushes, Rocks, Far (distant scenery 60 to 150 m out) and
  Landmarks (a few tall features well away from the road); a slider each for trees, rocks and the distant scenery, and how many landmarks at
  how many metres from the route's middle; the barrier on the outside of the bends; street lamps; the sky colour (the scene's background); a
  seed (**Shuffle** gives different scenery on the same road). A kind listed twice (in the file) is picked twice as often.
- **Crowd**: tick the spectator kinds (the Crowd group) and their size: groups of people by the start, on the outside of the hard bends and
  along the straights, turned to the road, each with its own size, hop, clip speed and phase as props (the crowd has its own random sequence,
  so the same road always gets the same crowd).
- **Stands, flags and billboards**: a stand each side of the start straight, long tents and banners there, flags along it, billboards on the
  straights (two kinds, taking turns) and pylons on the outside of the hard bends, each kept clear of the road. Pick the kind of each part;
  optionally a row of pit garages behind the start line with an office at its end, a gantry over the road after the line, and light posts
  along the straights.
- **Zones**: stretches of the route (metres from point 1, a stage's lead-in included) with another road kind (gravel into tarmac), another
  width (a narrow section: 8 or 9 m instead of 12) and a wall entity along both edges. The road mesh narrows (easing over 15 m) and changes
  colour, the barriers, tyres, chevrons and lamps follow the edge, and the waypoints carry `w` (half the width) and `road` where they differ,
  for a game to read (Pine Ridge Rally's cars feel the surface and the edge from them). Zones are drawn on the map.
- **Generate scene and road** writes the output (see below) and saves the track. Run it again after any change; it replaces them.
- **Pace notes**: the corners along the route as a co-driver would call them ("Left 3"): direction and grade 1 (hairpin) to 6 (gentle),
  with the metres from the start line. The thresholds are those of `pace_notes` in `examples/pine-ridge-rally/lib/race.lua`.

## Files

| File | What |
|---|---|
| `tracks/<name>.track.json` | What the editor edits: `open`, `road`, `control` ([x, z] metres), `sections`, `leadIn`, `runout`, `seed`, `trees`, `small`, `rock`, `density`, `rocks`, `lamps`, `rail` (the barrier's kind), `sky` ([r, g, b]), `far` (`{ kind: [...], density }`), `landmarks` (`{ kind: [...], count, radius }`), `roadside` (`{ stand, tent, banner, flag, boards: [two kinds], pylon, garage?, garages?, office?, gantry?, post? }` or null), `crowd` (`{ kind: [...], size }`), `zones` (`[{ from, to, road?, width?, wall? }]`, written only when there are any), `textured` (`true`: see "A textured road" below; written only when set, and not yet a control in the editor: set it in the file or with `track_write`). Pine Ridge Rally's courses are examples. |
| `scenes/<name>.scene.json` | Generated: start line and arch, finish arch and section gates (stage), waypoints every 10 m, the grid, scenery. Open it in the scene editor. |
| `models/road_<name>.glb` | Generated: the road as one ribbon mesh. Draw it with `nova.model("road_<name>", 0, 0, 0)`. |

The scene is the output: editing it by hand is lost the next time you generate, except for its **named** objects (an object with a `name`),
which are kept, first in the new scene: that is where a game keeps a course's settings (Pine Ridge Rally's `race` and `foliage` objects).
The generator names nothing it places. The scene refers to entity kinds the game must have
(`road_start`, `start_arch`, `tower`, `section_gate`, `waypoint`, `grid_slot`, `flag_checkers`, `banner_green`, `guardrail`, `sign_chevron`,
`tires`, `hay_bale`, `lamp`, and the roadside and crowd kinds chosen); the editor does not make them.

## A textured road

With `"textured": true` in the track file the ribbon gets texture coordinates and names two pictures of the project by `uri`
(`docs/project-format.md`, "Tiling pictures and detail"), which every road of the project shares:

- `textures/road.png`, the sheet (1024 x 1024). Along it is 64 m of road, repeating. Across it there is a column 192 texels wide for
  each kind of road, in the order asphalt, dirt, gravel, snow, sand: the whole 12 m from edge to edge. Then two strips 32 texels wide
  of paint: a solid line and a broken one. The sheet multiplies the road's colours (which stay the vertex colours, `ROAD_COLOURS`),
  so white changes nothing, and its alpha cuts the outer metre ragged, so the road straggles out over the ground instead of ending on
  a ruled line.
- `textures/road_grain.png`, the detail picture: fine grain every 4 m.

The cross-section changes too: the verge slopes down into the ground (no skirt), a loose road's colours run into one another
instead of stepping, and asphalt gets a narrow painted line at each edge, a broken one down the middle and a shoulder of gravel.
The project must have the two pictures (without them the road is drawn in its colours, with a warning): copy Pine Ridge Rally's,
or make your own to the same layout (`scripts/rally/surfaces.mjs` draws them from noise; `ROAD_SHEET` in
`scripts/lib/trackgen.mjs` is the layout). `scripts/rally/roads.mjs` makes every road of a project again from its track files.
Without `textured` the road is what it always was: flat colours, no pictures needed.

## How it is built

- The MCP tool `track_write` writes the same three files; given only a `name` it makes the scene and road again from the saved track file.
- `scripts/lib/trackrandom.mjs` proposes the control points (`randomRoute({ open, length, curviness, seed })`): a circuit is a wobbly ring
  (it cannot cross itself), a stage a walk whose heading drifts and swings into hairpins; up to 300 candidates are checked with the same
  measures as the editor's warnings. `withRandomRoute` and `withTheme` in `track-doc.ts` wrap it for the editor. Tracks are flat: no hills yet.
- `scripts/lib/trackgen.mjs` is the one generator (route, curvature, scene layout, road mesh, pace notes). The studio imports it from there;
  so does the MCP server's `track_write` tool. Nothing is copied.
- `studio/src/lib/track-doc.ts` is the editor's model (editing, statistics, the `.track.json` file, `buildTrack`); `track-write.ts`
  writes the three files. `Api.generateTrack(name, track)` runs the generator in the front end and writes through the backend's own
  confined `write_file` / `write_model` calls (the Rust backend does not need to know the layout); the browser preview's `mock.ts` does the same.
- Tests: `track-doc.test.ts` (model, statistics, round trip, generation), `TrackEditor.test.ts` (the screen), `resources.test.ts`.
