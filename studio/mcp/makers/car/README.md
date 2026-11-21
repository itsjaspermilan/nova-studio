# The car kit and the thirteen cars

`kit.mjs` is the car kit (moved here from `scripts/rally/carkit.mjs` on 2026-11-20): one smooth body from `buildBody` (a cage with the
topology of a box, every curve read from a drawing, mirrored and subdivided), everything a real car has cut into its skin made with the
Cut-out modifier, and only the real separate pieces as shapes. `cars/<key>.mjs` are the cars modelled from blueprints with it, first for
Pine Ridge Rally; each exports its maker (`s14(paint)` and so on), which returns `{ model, tail, at, R, track, wheelZ }`. Beside each is
`<key>.trace.json`, the calibration of its drawing (read by the `blueprint_trace` tool with `car: "<key>"`); the drawings themselves are
not in the repository.

`../car.ts` is the `car_make` maker: each car is a body type there (`modern_coupe` is `gt.mjs`, `coupe_90s` is `s14.mjs`, ...), and the
options reshape and restyle it. With no options it is exactly the car in the file, which is how Pine Ridge Rally makes its cars
(`scripts/rally/cars.mjs`). `spec.ts` builds a car from a `spec` written as data, the same steps as a car file.

A new car traced from a drawing can be written as a `spec` (no code; see docs/mcp.md, `car_make`), or as a file here like the others
when it needs code of its own (a facetted body: `gt2.mjs`; a hollow load bed: `pickup.mjs`), added to `TYPES` in `../car.ts`:

```js
import { PAINT, GLASS, archOutline, assemble, box, buildBody, glassOf, wheel /* ... */ } from "../kit.mjs";
export function car(paint = "#b8232c") { /* spec -> buildBody -> cut-outs -> separate pieces -> assemble */ return { at, R, track, wheelZ, model, tail }; }
```

Look at it with `car_make` (its picture: front three-quarter, rear three-quarter, side) and `model_preview`, and in the game's renderer
with `scripts/rally/car-show.mjs <model>` for a model in Pine Ridge Rally.
