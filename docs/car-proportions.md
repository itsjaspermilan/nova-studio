# Car shapes and proportions: what the reference cars teach

Written 2026-11-09 from the reference models the user added to `examples/` (not committed: `psx_style_cars_by_ggbot_august2023.zip`, eight
PSX-era OBJ cars; `04dtwkw5.glb`, a painted 1980s sedan; `89-challenger.zip` and `26-mustang-13.04.2021-compressed.zip`, Blender muscle cars).
The user's instruction: ignore the PSX resolution, study the shapes and proportions, aim for Switch 1-class graphics at 60 fps
(see TODO.md, "Art direction"). The generators are `scripts/rally/cars.mjs` (Nova's own pipeline) and, as a benchmark only,
`scripts/blender/classic_car.py`.

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
