# The track editor

A screen in the studio for laying out a racing circuit or a rally stage without a script. Open one from **Tracks** in the project tree (the
**＋** beside it makes a new one: a starting oval) or from the file `tracks/<name>.track.json`. **{ } Text** shows the file as text.

## What you do

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
- **Scenery**: tick entities from the project's `entities/` folder as Trees, Bushes and Rocks; a density slider for trees and one for rocks;
  street lamps; a seed (**Shuffle** gives different scenery on the same road).
- **Generate scene and road** writes the output (see below) and saves the track. Run it again after any change; it replaces them.
- **Pace notes**: the corners along the route as a co-driver would call them ("Left 3"): direction and grade 1 (hairpin) to 6 (gentle),
  with the metres from the start line. The thresholds are those of `pace_notes` in `examples/pine-ridge-rally/lib/race.lua`.

## Files

| File | What |
|---|---|
| `tracks/<name>.track.json` | What the editor edits: `open`, `road`, `control` ([x, z] metres), `sections`, `leadIn`, `runout`, `seed`, `trees`, `small`, `rock`, `density`, `rocks`, `lamps`. |
| `scenes/<name>.scene.json` | Generated: start line and arch, finish arch and section gates (stage), waypoints every 10 m, the grid, scenery. Open it in the scene editor. |
| `models/road_<name>.glb` | Generated: the road as one ribbon mesh. Draw it with `nova.model("road_<name>", 0, 0, 0)`. |

The scene is the output: editing it by hand is lost the next time you generate. The scene refers to entity kinds the game must have
(`road_start`, `start_arch`, `tower`, `section_gate`, `waypoint`, `grid_slot`, `flag_checkers`, `banner_green`, `guardrail`, `sign_chevron`,
`tires`, `hay_bale`, `lamp`); the editor does not make them.

## How it is built

- `scripts/lib/trackgen.mjs` is the one generator (route, curvature, scene layout, road mesh, pace notes). The studio imports it from there;
  so do the MCP server's `track_write` tool and `scripts/rally/tracks.mjs`. Nothing is copied.
- `studio/src/lib/track-doc.ts` is the editor's model (editing, statistics, the `.track.json` file, `buildTrack`); `track-write.ts`
  writes the three files. `Api.generateTrack(name, track)` runs the generator in the front end and writes through the backend's own
  confined `write_file` / `write_model` calls (the Rust backend does not need to know the layout); the browser preview's `mock.ts` does the same.
- Tests: `track-doc.test.ts` (model, statistics, round trip, generation), `TrackEditor.test.ts` (the screen), `resources.test.ts`.
