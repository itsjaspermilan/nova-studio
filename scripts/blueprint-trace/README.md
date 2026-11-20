# Tracing a car blueprint

Tools used to make `car_gt` and `car_offroad` (see `docs/car-proportions.md`, "second pass"). Plain Node, no packages.

1. Put each drawing in `build/blueprints/<car>.png` (`sips -s format png drawing.webp --out build/blueprints/gt.png`; the drawings are not in the repository).
2. Calibrate every view on its own in `cal.mjs`: `k` pixels per model unit (1/16 m) from that view's dimension line, `ox`/`oy` the pixel of (0, 0)
   (the ground row; the car's middle), `sx` -1 when the nose points left, `ky` when the vertical scale differs. Views of one sheet are often not to one scale.
3. `scripts/env.sh node scripts/blueprint-trace/v.mjs <car> <view> x0 y0 x1 y1 zoom 1 <name>` writes a gridded enlargement to `build/blueprint-trace/`
   (red numbers along, blue numbers up, in model units). Check the wheels sit on 0 and the roof at the stated height, then read windows, lamps, doors off it.
4. `scripts/env.sh node scripts/blueprint-trace/sil.mjs <car>` prints the outlines by flood fill: top line and underside by length, half-width by length
   (plan view), nose and tail by height, widths by height (front and rear views). The view rectangles are `rects` in the car's `.trace.json`.
5. Put the numbers in a spec in a file of the car's own, `scripts/rally/cars/<car>.mjs` (see the README there; calibration in `<car>.trace.json` beside it) (`buildBody` for the surface, then cut-outs for everything cut into it), run it, and look:
   `nova_model_preview` from the front, side, rear, then `scripts/rally/car-show.mjs <model>` for pictures in the game's renderer. Fix what looks wrong and repeat.
