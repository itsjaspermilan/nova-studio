// Pine Ridge Rally's cars: which of Nova's car types each is, and the paints the rivals wear (lib/state.lua, `paints`). The cars themselves are
// made by Nova's `car_make` maker (studio/mcp/makers/car.ts, the car kit and the thirteen cars modelled from blueprints in studio/mcp/makers/car/):
// each type with no options is exactly the car first modelled for this game, so these calls write the same bytes as ever.
//
//   scripts/env.sh node scripts/rally/cars.mjs [car_gt ...] [--project folder]
import { withServer } from "./mcp.mjs";

export const CARS = {
  car_gt: { type: "modern_coupe", paints: { red: "#a81f2a", white: "#dfe2e6", grey: "#41454d" } },
  car_offroad: { type: "short_4x4", paints: { green: "#5d6b48", white: "#e2dfd3", red: "#9c3229" } },
  car_city: { type: "city_car", paints: { blue: "#2f6fc4", red: "#c4302b", white: "#e6e8e8" } },
  car_muscle: { type: "muscle_fastback", paints: { blue: "#2b4f9c", green: "#3f6b3a", white: "#e6e2d6" } },
  car_gt2: { type: "gt_race", paints: { orange: "#e2641c", blue: "#1c4fa8", black: "#1d1f24" } },
  car_hatch: { type: "family_hatch", paints: { white: "#e4e6e8", blue: "#1f4f9c", grey: "#4a4f58" } },
  car_hatch_r: { type: "hot_hatch", paints: { red: "#b3202a", blue: "#1d4fa8", grey: "#4a4e56" } },
  car_pickup: { type: "crew_cab_pickup", paints: { white: "#e4e5e2", black: "#1d1f23", blue: "#2a4d86" } },
  car_rally: { type: "rally_coupe", paints: { blue: { paint: "#1f4fa8", accents: ["#f2f3f5", "#f0c02a"] }, yellow: { paint: "#f4c41c", accents: ["#16171b", "#f2f3f5"] }, green: { paint: "#1f5a3c", accents: ["#f2f3f5", "#d8a425"] } } },
  car_s14: { type: "coupe_90s", paints: { white: "#e2e4e7", blue: "#1f3f8f", black: "#1a1b1e" } },
  car_s15: { type: "aero_coupe", paints: { white: { paint: "#e4e6e8", rim: "#8a6a3a" }, black: { paint: "#17181c", rim: "#c9ced6" }, red: { paint: "#b3202a", rim: "#d9dbde" } } },
  car_suv: { type: "suv", paints: { white: "#e6e7e9", black: "#1b1d21", red: "#8f2a2a" } },
  car_truck: { type: "truck_6x6", paints: { sand: "#cdb788", green: "#55633f", white: "#e2e3df" } },
};

if (process.argv[1]?.endsWith("cars.mjs")) {
  const args = process.argv.slice(2), at = args.indexOf("--project"), want = args.filter((a, i) => !a.startsWith("-") && (at < 0 || i !== at + 1));
  await withServer(async (nova) => {
    for (const [name, recipe] of Object.entries(CARS)) {
      if (want.length && !want.includes(name)) continue;
      const said = await nova.call("car_make", { name, ...recipe, preview: false });
      console.log(said);
    }
  });
}
