// Pine Ridge Rally's ground and road pictures (textures/*.png, means.json) and the land under its circuits (models/land_*.glb), made with Nova's
// `surface_make` and `land_make` (studio/mcp/makers/surface.mjs and land.mjs, first made here as surfaces.mjs and land.mjs). Seed 1 and no
// options are the pictures this game was first made with, so these calls write the same bytes as ever.
//
//   scripts/env.sh node scripts/rally/ground.mjs [--project folder]
import { withServer } from "./mcp.mjs";

export const LANDS = { land_grass: "grass", land_autumn: "autumn", land_sand: "sand", land_snow: "snow", land_night: "night" };

await withServer(async (nova) => {
  console.log((await nova.call("surface_make", {})).split("\n").slice(0, 1).join("\n"));
  for (const [name, ground] of Object.entries(LANDS)) console.log(await nova.call("land_make", { name, ground, preview: false }));
});
