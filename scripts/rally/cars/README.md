# One car per file

Each car modelled from a blueprint lives here as `<key>.mjs` (exports `CARS`: model name -> a function returning `{ model, tail }`) beside its
tracing numbers `<key>.trace.json` (read by `scripts/blueprint-trace/cal.mjs`). The drawing itself is `build/blueprints/<key>.png` (not in the repository).

A car file starts like this (the two worked examples, `gt()` and `offroad()`, are in `../blueprint-cars.mjs`):

```js
import { PAINT, GLASS, archOutline, assemble, box, buildBody, glassOf, wheel /* ... */ } from "../carkit.mjs";
function car(paint = "#b8232c") { /* spec -> buildBody -> cut-outs -> separate pieces -> assemble */ return { model, tail }; }
export const CARS = { car_x: () => car(), car_x_white: () => car("#e4e6e8") };
```

Build:  `scripts/env.sh node scripts/rally/blueprint-cars.mjs car_x`
Look:   `scripts/env.sh node scripts/rally/car-show.mjs car_x --len 4.5`  -> `build/car-show/car_x/{front34,rear34,side,front,rear,top,low}.png`
