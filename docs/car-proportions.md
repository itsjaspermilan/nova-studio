# Car shapes and proportions: what the reference cars teach

> Status 2026-11-20: Pine Ridge now has only the two blueprint cars of the "second pass" section (`car_gt`, `car_offroad`, in four paints each). The earlier generators this document names (`bodies.mjs`, `body.mjs`, `face.mjs`, `parts.mjs`, `blueprint-car.mjs`, `blueprint-check.mjs`, `scripts/blender/classic_car.py`) and their cars were removed; the rest is kept as the study it was.

Written 2026-11-09 from the reference models the user added to `examples/` (not committed: `psx_style_cars_by_ggbot_august2023.zip`, eight
PSX-era OBJ cars; `04dtwkw5.glb`, a painted 1980s sedan; `89-challenger.zip` and `26-mustang-13.04.2021-compressed.zip`, Blender muscle cars).
The user's instruction: ignore the PSX resolution, study the shapes and proportions, aim for Switch 1-class graphics at 60 fps
(see TODO.md, "Art direction"). The first generator (`scripts/rally/cars.mjs`, lofted rings with no subdivision) is gone. Since 2026-11-10 every car, racer and truck is modelled
from blueprints: `scripts/rally/bodies.mjs` holds each car's profiles along its length (this document's measurements are where they came from),
`body.mjs` lofts them into a half cage of cross-section rings (edge loops at the belt, windows, pillars, door gaps and wheels) that is mirrored and
subdivided with creases, and `face.mjs` models the nose and tail into that surface (lamp pockets with housings, recessed grilles, bumper bands,
plate pockets, creased edges; the lenses are the pockets' own cells). `parts.mjs` has the shared shapes and the wheel. `scripts/blender/classic_car.py`
remains a benchmark only.

## The eight PSX cars (measured from the OBJ geometry; length L = 1)

Each is a real, recognisable design, not a generic box. Wheel and body numbers below are measured; the roofline is read from renders
(the meshes have only about 250 vertices, so a numeric profile is too sparse to trust).

| Car (what it is) | Length | Width / L | Height / L | Wheelbase / L | Front overhang | Rear overhang | Wheel radius / L |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 01 wagon (Lada 2102-like) | 6.15 | 0.42 | 0.35 | 0.60 | 0.15 | 0.26 | 0.08 |
| 02 sedan (Saab 9000 / Lancia Thema-like) | 6.53 | 0.44 | 0.34 | 0.57 | 0.21 | 0.23 | 0.08 |
| 03 hatchback (VW Golf Mk1) | 5.61 | 0.47 | 0.38 | 0.64 | 0.19 | 0.17 | 0.09 |
| 04 minivan (Chevy Astro-like) | 6.30 | 0.54 | 0.44 | 0.67 | 0.15 | 0.19 | 0.09 |
| 05 big sedan (Caprice-like) | 7.37 | 0.38 | 0.28 | 0.55 | 0.20 | 0.25 | 0.07 |
| 06 sedan shell (rusty, Alfa 164-like) | 6.36 | 0.39 | 0.26 | 0.83 | 0.03 | 0.13 | 0.06 |
| 07 vintage tourer (Model T-like) | 5.78 | 0.42 | 0.50 | 0.76 | 0.11 | 0.13 | 0.12 |
| 08 step van | 6.89 | 0.46 | 0.47 | 0.57 | 0.17 | 0.26 | 0.08 |

Real cars for comparison (Corolla sedan 4630 x 1780 x 1435, wheelbase 2700): width / L 0.38, height / L 0.31, wheelbase / L 0.58.

## Windows and doors (measured from orthographic side renders; u runs from the nose, 0, to the tail, 1; v from the ground, 0, to the roof, 1)

The glass is **30 to 40 percent of the car's height**: the belt line (the bottom of the side windows) sits at v 0.58 to 0.70, the roof at 1.0.
That is the same share as on a real car (about a third); the PSX cars only look windowy because their glass is one flat dark panel with thin pillars.

| Car | Belt line (v) | Glass height (of H) | Side windows, from the nose (u) | Door seams (u) |
| --- | ---: | ---: | --- | --- |
| wagon | 0.62 | 0.34 | one band 0.29-0.89: three panes, pillars near 0.46 and 0.63 | about 0.30, 0.46, 0.63 |
| sedan (Saab-like) | 0.60 | 0.40 | 0.36-0.52 and 0.54-0.74 | about 0.34, 0.53 |
| hatch (Golf) | 0.60 | 0.40 | front door 0.355-0.63, quarter 0.64-0.84 | 0.325 (front of the door), 0.63 (B pillar): a 3-door, the door 0.30 L long |
| minivan | 0.65 | 0.35 | 0.21-0.45, 0.47-0.72, 0.74-0.93 (the cab 0.21-0.45 is the front door) | about 0.20, 0.46, 0.73 |
| big sedan | 0.68 | 0.30 | front door 0.39-0.53, rear door 0.54-0.69, small quarter pane 0.71-0.78 | 0.33 (front door 0.20 L long), 0.535, 0.71 (rear door 0.18 L) |
| sedan shell | 0.61 | 0.39 | 0.39-0.77 | (no doors) |
| vintage | 0.70 | 0.30 | 0.41-0.58 and 0.63-0.81, one window each | |
| step van | 0.58 | 0.42 | cab only, 0.15-0.39 (windscreen side and door glass) | |

A door is about 0.18 to 0.20 of the length on a four-door and about 0.30 on a two- or three-door. The windshield rises from the bonnet at
u 0.30 to 0.46 on the sedans and the hatch (a long raked glass), the roof is flat for about 0.3 L, and the rear glass falls over about 0.10 L.
The full roofline of each car, sampled 29 times from the nose, is in `scripts/rally/psx-profiles.json` (v per sample); the car generator
reads it so each model keeps its reference's silhouette.

## What makes them read as cars

1. **A distinct silhouette per model.** The roofline, the rake of the pillars, the length of the bonnet and the cut of the tail differ
   for every car; that is most of what makes each recognisable. A generic three-box loses this.
2. **Big wheels that fill their arches** with a small, even gap round the tyre; short front overhangs on the hatch and the van, longer rear
   overhangs on the sedans and the wagon; wheel radius about 0.08 of the length (0.37 m on a 4.6 m car).
3. **Low ride height with a visible sill**, and the body sides flat with crisp edges, not rounded.
4. **Thin light trim** (white or chrome) outlining the windows and running along the belt and the sill; this carries most of the detail.
5. **Dark glass with a gradient**, thin pillars, large side windows on the wagon, hatch and vans (the glasshouse is a big share of the
   height on these cars, more than on a modern sedan).
6. **Black bumpers, a painted grille, flush lamps**, round headlamps on the older cars, rectangular on the 1980s ones.
7. **Ordinary working vehicles** (a wagon, a minivan, a step van) sit beside the sedans, so a roster feels like a street, not a showroom.

## Applying it

Archetypes to build, each from its ratios: wagon, sedan, hatchback, minivan, big sedan, vintage tourer, step van (plus the muscle
coupes from the Challenger and Mustang). Switch-class means the same shapes, with smooth subdivided panels, real wheel arches, PBR
paint and baked contact shadows, and a texture only where it earns its place (trim lines, lamps, grilles).

## The blueprint cars, second pass (2026-11-19): `scripts/rally/carkit.mjs` and `blueprint-cars.mjs`

`car_gt` (the modern coupe, 4768 x 1852 x 1383 mm) and `car_offroad` (the short 4x4 wagon, 4060 x 1690 x 1885 mm) were made again from nothing, because the
first pass (next section) came out faceted with its details laid on top. What changed:

- **One smooth surface.** `buildBody` makes a cage with the topology of a box: two flanks (rows from the sill to the shoulder), the top from shoulder to
  shoulder (eight columns that are a crowned sheet over a bonnet or boot and become side glass, roof rail and roof over the cabin), and a real front and
  rear face whose columns and rows continue the top's and the flank's (no end caps). Mirror, then one level of Subdivision, makes the body.
- **Every curve is measured.** Each view of each drawing was calibrated to its own dimension lines (they are not drawn to one scale: the 4x4's front view is
  6% larger than its side view, and its side view is 3% taller than the stated height) and its outline taken by flood fill: the top line and underside by
  length, the nose and tail by height, the half-width by length from the plan view, the section from the front view. Windows, lamps, grilles, door and boot
  lines were read off gridded enlargements.
- **Details are cut in, not laid on.** The new Cut-out modifier (`docs/project-format.md`) presses each outline onto the finished surface from the view it
  was drawn in: glass with its rubber, the lamps (flush lenses with their own glowing elements), the twin grille and intakes as pockets with a mesh behind,
  door, bonnet and boot gaps as thin matt grooves, the wheel openings with a rolled-in lip. The wheels' spokes are what is left of a lathe-turned rim after
  its windows are cut out. Only what is a separate piece on the real car is a separate shape: mirrors, bumpers, the spare, wipers, arch flares, mud flaps.
- **Paint.** The body has a clear coat (`coat`, new: `KHR_materials_clearcoat`), so it shows the sun and sky as car paint does.
- Budget: about 31,000 triangles for the coupe and 35,000 for the 4x4 (hero-car range; the cuts and the wheels are most of it). No badges or lettering.
- Not done: a numeric check against the drawings like the first pass had (the curves are the traced ones, and side renders were compared by eye), the cars
  have not been driven in the game or seen on the Retroid, and nobody has opened them in the studio's Model editor.

## The blueprint cars, first pass (2026-11-19): `scripts/rally/blueprint-car.mjs` (now only `car_coupe`)

Three cars made straight from the owner's blueprints, by a generator of their own (it shares nothing with `bodies.mjs`): `car_coupe` (a 1990s coupe),
`car_offroad` (a short 4x4 wagon) and `car_gt` (a modern coupe). Every table in a spec is traced from the drawing: the top line, nose and tail
and underside from the side view, the width by z from the plan view and the width by height from the front view (the widest point is low and the cabin
tucks in: `shoulder`, `tuck`); the wheel is as drawn (the Apex GT's six wide spokes, the 4x4's plain steel disc). Each wheel is a real arch cut through the
body (inner wall, roof, no flare: none of the drawings has one). Budget: about 10,000 to 12,500 triangles a car (the older cars are 14,000), the body drawn
from its dense cage without further smoothing (`renderLevels` 0; smoothing it once would double the cost and look the same).

**The check.** `scripts/rally/blueprint-check.mjs` compares each blueprint car with its drawing: the top line, the half-width from the plan view and the edges of
the side glass against the nearest line the draftsman drew, with pictures (the model's lines on the blueprint) in `build/blueprint-check/`. It exits 1 when
a car is off by more than 0.9 units (about 5 cm) over 95% of the points. Convert the blueprints to PNGs first (`sips -s format png drawing.gif --out coupe.png`
into one folder, `--bp folder`; the images are not in the repository). Lamps, grilles and trim lie on the body's own skin (`frontPatch`, `sidePatch`, `lamp`
in `blueprint-car.mjs`) instead of boxes pushed into it. The cars' suspension (`entities/car.lua`) takes each model's real wheel positions from
`nova.model_pose`, so the ground is sampled under each tyre and the body tips by the car's own wheelbase and track, and a model is drawn `rigid = true`
(one hill height for the whole model, not per vertex, which shears a car).
