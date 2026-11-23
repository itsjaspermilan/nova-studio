// Pine Ridge Rally's engines, one for each car (car_s14 plays car_s15's loops with its own mix: lib/audio.lua), made by Nova's `engine_make`
// (studio/mcp/makers/engine-make.ts and engine.mjs, the engine model first made here). Each recipe is one of the twelve engines that model
// was built from, with nothing changed, so these calls write the same loops as ever. The game keeps its profiles in lib/audio.lua, so no
// engines/<name>.lua is written (`profile: false`).
//
//   scripts/env.sh node scripts/rally/engines.mjs [car_gt ...] [--project folder]
import { withServer } from "./mcp.mjs";

export const ENGINES = {
  car_gt: { layout: "six", fuel: "petrol", aspiration: "turbo", character: "smooth" }, // 3.0 turbo straight six
  car_offroad: { layout: "six", fuel: "diesel", aspiration: "none" }, // 4.2 straight-six diesel
  car_s15: { layout: "four", fuel: "petrol", aspiration: "turbo", character: "smooth" }, // 2.0 turbo four
  car_hatch_r: { layout: "four", fuel: "petrol", aspiration: "turbo", character: "raspy" }, // 2.0 turbo four, hard-edged
  car_hatch: { layout: "four", fuel: "petrol", aspiration: "none", character: "smooth" }, // 2.0 four, quiet
  car_city: { layout: "three", fuel: "petrol", aspiration: "none" }, // 0.8 three
  car_rally: { layout: "four", fuel: "petrol", aspiration: "none", character: "raspy", displacement: 2.4 }, // 2.4 four on open carburettors
  car_gt2: { layout: "five", fuel: "petrol", aspiration: "turbo" }, // 2.5 turbo five, racing exhaust
  car_muscle: { layout: "v8", fuel: "petrol", aspiration: "none" }, // 5.6 cross-plane V8
  car_suv: { layout: "four", fuel: "diesel", aspiration: "turbo" }, // 2.8 turbo-diesel four
  car_truck: { layout: "six", fuel: "diesel", aspiration: "turbo" }, // 7.2 turbo-diesel six
  car_pickup: { layout: "v6", fuel: "petrol", aspiration: "twin" }, // 3.4 twin-turbo V6
};

// (only when run: the studio's tests import ENGINES, and an import wrote all twelve engines' loops into the game again, half a
// minute, while other tests were reading them)
if (process.argv[1]?.endsWith("engines.mjs")) {
  const args = process.argv.slice(2), at = args.indexOf("--project"), want = args.filter((a, i) => !a.startsWith("-") && (at < 0 || i !== at + 1));
  await withServer(async (nova) => {
    for (const [name, recipe] of Object.entries(ENGINES)) {
      if (want.length && !want.includes(name)) continue;
      console.log((await nova.call("engine_make", { name, ...recipe, report: false, profile: false })).split("\n")[0]);
    }
  });
}
