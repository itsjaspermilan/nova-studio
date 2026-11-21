// Pine Ridge Rally's scenery: which of Nova's detailed props each of its models is. The props themselves are made by Nova's `prop3d_make`
// (studio/mcp/makers/scenery.ts, the natural and built scenery first made for this game in studio/mcp/makers/scenery/): each preset with seed 1
// is exactly the model first made here, so these calls write the same bytes as ever. The game's own entities and scenes do its collisions,
// so no colliders are added by the rule (`colliders: false`) and no entity files are written (`entity: false`).
//
//   scripts/env.sh node scripts/rally/scenery.mjs [name ...] [--project folder]
import { withServer } from "./mcp.mjs";

const items = [];
const add = (kind, species, name, season) => items.push({ kind, species, name, ...(season ? { season } : {}) });

// trees
for (const sp of ["tall_a", "tall_b", "tall_c", "tall_d", "round_a", "round_c", "round_e", "small_a", "small_c"]) add("conifer", sp, `nk_pine${sp}`);
for (const sp of ["round_a", "round_e", "small_a", "tall_a", "tall_c", "tall_d"]) add("conifer", sp, `nk_snow_pine${sp}`, "snow");
for (const sp of ["round_a", "round_e", "small_a", "tall_a", "tall_c"]) add("conifer", sp, `nk_night_pine${sp}`, "night");
add("conifer", "fir", "pine"); add("conifer", "spruce", "pine_dark"); add("conifer", "fir", "pine_snow", "snow");
for (const sp of ["default", "oak", "tall"]) { add("broadleaf", sp, `nk_${sp}`); add("broadleaf", sp, `nk_${sp}_fall`, "autumn"); }
add("broadleaf", "fat", "nk_fat"); add("broadleaf", "thin", "nk_thin"); add("broadleaf", "birch", "birch"); add("broadleaf", "maple", "autumn_tree", "autumn");
add("dead_tree", "tall", "nk_dead_tall"); add("dead_tree", "thin", "nk_dead_thin");
// bushes, grass, flowers, cacti
add("shrub", "round", "bush"); add("shrub", "round", "bush_snow", "snow"); add("shrub", "detailed", "nk_bush_detailed"); add("shrub", "large", "nk_bush_large"); add("shrub", "low", "nk_bush_tri"); add("shrub", "dry", "dry_bush");
add("grass", "tuft", "grass"); add("flowers", "meadow", "flowers");
add("cactus", "saguaro", "cactus"); add("cactus", "tall", "nk_cactus_tall"); add("cactus", "short", "nk_cactus_short");
// rocks, wood, the far landscape
add("boulder", "rock", "rock"); add("boulder", "rock", "rock_ice", "snow"); add("boulder", "rock", "rock_red", "autumn");
for (const sp of ["largeA", "largeC", "largeE", "tallB", "tallF", "tallH"]) {
  const species = sp.replace(/([A-Z])$/, (c) => `_${c.toLowerCase()}`);
  add("boulder", species, `nk_rock_${sp}`); add("boulder", species, `nk_rockice_${sp}`, "snow"); add("boulder", species, `nk_rockred_${sp}`, "autumn");
}
add("log", "fallen", "nk_log"); add("stump", "cut", "nk_stump"); add("mesa", "red", "mesa"); add("cloud", "cumulus", "cloud");
add("mountain", "range", "mountain"); add("mountain", "range", "mountain_ice", "snow"); add("mountain", "range", "mountain_night", "night"); add("mountain", "range", "mountain_red", "autumn");
// beside the road and round the start
const built = {
  guardrail: { single: "guardrail", double: "rail_double" }, barrier: { wall: "barrier_wall", red: "barrier_red", white: "barrier_white" },
  cone: { pylon: "pylon" }, tyre_stack: { stack: "tires" }, hay_bale: { bale: "hay_bale" }, fence: { mesh: "fence" }, chevron: { sign: "sign_chevron" },
  flag: { green: "flag_green", red: "flag_red", checkers: "flag_checkers" }, banner: { green: "banner_green", red: "banner_red" }, billboard: { stripes: "billboard", chequers: "billboard_low" },
  lamp: { trackside: "lamp" }, light_post: { floodlight: "light_post" }, arch: { start: "start_arch" }, gantry: { truss: "gantry", round: "gantry_round" },
  grandstand: { open: "grandstand", covered: "grandstand_covered", awning: "grandstand_awning" }, tower: { control: "tower" }, garage: { pit: "garage" },
  pit_office: { flat: "pits_office", roof: "pits_office_roof" }, tent: { open: "tent", long: "tent_long", closed: "tent_closed" },
  camera_tower: { scaffold: "camera_tower" }, radar: { dish: "radar" }, grid_box: { box: "grid_box" }, steering_wheel: { wheel: "steering_wheel" },
  spectator: { woman_a: "crowd_fa", woman_b: "crowd_fb", woman_c: "crowd_fc", woman_d: "crowd_fd", man_a: "crowd_ma", man_b: "crowd_mb", man_c: "crowd_mc", man_d: "crowd_md" },
};
for (const [kind, species] of Object.entries(built)) for (const [sp, name] of Object.entries(species)) add(kind, sp, name);

export const SCENERY = items;

if (process.argv[1]?.endsWith("scenery.mjs")) {
  const args = process.argv.slice(2), at = args.indexOf("--project"), want = args.filter((a, i) => !a.startsWith("-") && (at < 0 || i !== at + 1));
  const todo = items.filter((it) => !want.length || want.includes(it.name)).map((it) => ({ ...it, style: "detailed", colliders: false }));
  await withServer(async (nova) => {
    for (let i = 0; i < todo.length; i += 24) console.log(await nova.call("prop3d_make", { kinds: todo.slice(i, i + 24), entity: false, preview: false }));
  });
}
