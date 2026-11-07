// Lays out the rally game's two circuits as scene files, through the Nova MCP server's `scene_write` tool: a closed curve through
// control points, road pieces along it, waypoints for the cars to follow, a start line and grid, and scenery on both sides.
// (In the studio this is what placing objects in the 3D scene view makes; here a script does the placing.)
import fs from "node:fs";
import path from "node:path";
import { withServer, GAME } from "./mcp.mjs";
import { layout, roadGlb, ascii, tightest } from "../lib/trackgen.mjs";

const tracks = {
  pine_ridge: {
    seed: 7, road: "road_asphalt", rail: "guardrail", sky: [138, 182, 224],
    control: [[0, -90], [0, 0], [0, 150], [25, 240], [95, 285], [170, 265], [215, 320], [290, 348], [362, 300], [378, 225], [335, 170], [365, 112], [425, 72], [405, -8], [335, -30], [300, -98], [342, -165], [290, -232], [205, -250], [150, -192], [88, -242], [0, -262], [-82, -212], [-80, -140]],
    trees: ["nk_pinetall_a", "nk_pinetall_b", "nk_pinetall_c", "nk_pinetall_d", "nk_pineround_a", "nk_pineround_c", "nk_pineround_e", "nk_pinesmall_a", "nk_pinesmall_c", "nk_oak", "nk_default", "nk_tall", "nk_fat", "nk_thin", "nk_oak_fall", "pine", "pine_dark", "birch"],
    small: ["nk_bush_large", "nk_bush_detailed", "nk_bush_tri", "bush", "nk_stump", "nk_log", "nk_rock_largeC"], rock: ["nk_rock_largeA", "nk_rock_largeC", "nk_rock_largeE", "nk_rock_tallB", "nk_rock_tallF", "nk_rock_tallH"], density: 0.5, rocks: 0.08,
    far: { kind: ["nk_pinetall_a", "nk_pinetall_d", "nk_pineround_e", "pine_dark"], density: 0.5 }, landmarks: { kind: "pine_dark", count: 0, radius: 0 },
  },
  dust_valley: {
    seed: 21, road: "road_dirt", rail: "guardrail", sky: [236, 190, 140],
    control: [[0, -70], [0, 0], [0, 120], [45, 195], [120, 225], [190, 190], [235, 235], [300, 215], [318, 150], [290, 88], [225, 72], [180, 25], [190, -40], [250, -85], [272, -150], [240, -205], [170, -215], [135, -160], [75, -195], [10, -235], [-50, -180], [-40, -120]],
    trees: ["nk_cactus_tall", "nk_cactus_tall", "nk_cactus_short", "nk_cactus_short", "cactus", "nk_dead_thin", "nk_dead_tall", "dry_bush"], small: ["dry_bush", "nk_rockred_largeC", "dry_bush", "nk_stump", "nk_rockred_tallF"], rock: ["nk_rockred_largeA", "nk_rockred_largeC", "nk_rockred_largeE", "nk_rockred_tallB", "nk_rockred_tallF", "nk_rockred_tallH"], density: 0.34, rocks: 0.12,
    far: { kind: "mesa", density: 0.22 }, landmarks: { kind: "mesa", count: 14, radius: 190 },
  },
};

const only = process.argv[2];
tracks.frost_pass = {
  seed: 33, road: "road_snow", rail: "guardrail", sky: [196, 216, 236],
  control: [[0, -80], [0, 0], [0, 110], [-45, 185], [-120, 205], [-185, 250], [-270, 222], [-288, 150], [-255, 90], [-195, 74], [-172, 14], [-105, 0], [-72, -48], [-105, -95], [-180, -108], [-205, -170], [-140, -215], [-75, -170], [-20, -215], [50, -190], [60, -125]],
  trees: ["nk_snow_pinetall_a", "nk_snow_pinetall_c", "nk_snow_pinetall_d", "nk_snow_pineround_a", "nk_snow_pineround_e", "nk_snow_pinesmall_a", "pine_snow", "pine_snow", "nk_pinetall_a", "nk_pineround_c"], small: ["bush_snow", "nk_rockice_largeC", "bush_snow", "nk_stump"], rock: ["nk_rockice_largeA", "nk_rockice_largeC", "nk_rockice_largeE", "nk_rockice_tallB", "nk_rockice_tallF", "nk_rockice_tallH"], density: 0.55, rocks: 0.1,
  far: { kind: ["pine_snow", "nk_snow_pinetall_d", "nk_snow_pineround_e"], density: 0.6 }, landmarks: { kind: "pine_snow", count: 0, radius: 0 },
};
tracks.harbour_lights = {
  seed: 45, road: "road_asphalt", rail: "guardrail", sky: [12, 18, 34], lamps: true,
  control: [[0, -80], [0, 0], [0, 130], [55, 205], [130, 235], [190, 290], [270, 270], [285, 195], [225, 150], [260, 90], [330, 60], [320, -20], [255, -50], [275, -120], [215, -175], [140, -150], [95, -205], [20, -190], [5, -135]],
  trees: ["nk_night_pinetall_a", "nk_night_pinetall_c", "nk_night_pineround_a", "nk_night_pineround_e", "nk_night_pinesmall_a", "pine_dark", "bush"], small: ["bush", "nk_rock_largeC", "bush", "nk_stump"], rock: ["nk_rock_largeA", "nk_rock_largeC", "nk_rock_tallB", "nk_rock_tallF"], density: 0.32, rocks: 0.06,
  far: { kind: ["pine_dark", "nk_night_pinetall_a", "nk_night_pineround_e"], density: 0.3 }, landmarks: { kind: "pine_dark", count: 0, radius: 0 },
};
// DRY=1 only draws the maps and prints the numbers (nothing is written)
// ---- the rally stages: open routes, one in each circuit's country (each has the same scenery, sky and hills as its circuit)
const stageControl = {
  stage_pine_ridge: [[0, -140], [0, -60], [0, 60], [20, 160], [90, 215], [170, 200], [215, 255], [300, 285], [385, 250], [400, 170], [350, 115], [380, 45], [455, 5], [478, -70], [425, -112], [385, -85], [365, -150], [435, -185], [360, -250], [430, -285], [520, -260], [575, -195], [560, -115], [620, -60], [690, -75], [735, -30], [700, 10], [740, 70], [690, 120], [620, 130], [610, 225], [650, 300], [735, 330]],
  stage_dust_valley: [[0, -140], [0, -60], [0, 70], [-40, 150], [-130, 175], [-190, 235], [-170, 320], [-90, 360], [0, 330], [60, 270], [150, 255], [220, 300], [300, 290], [340, 220], [305, 160], [228, 148], [205, 100], [260, 78], [320, 90], [350, 40], [310, -10], [240, -5], [250, -75], [330, -100], [350, -180], [270, -215], [200, -270], [215, -350], [300, -390], [390, -370], [450, -310], [520, -290], [590, -330], [640, -400]],
  stage_frost_pass: [[0, -140], [0, -50], [0, 60], [60, 140], [160, 150], [230, 100], [300, 120], [330, 200], [280, 270], [190, 300], [120, 320], [100, 380], [160, 410], [240, 395], [270, 450], [330, 470], [380, 390], [470, 380], [520, 440], [510, 520], [440, 570], [370, 590], [350, 640], [410, 670], [470, 650], [490, 710], [430, 760], [350, 745]],
  stage_harbour_lights: [[0, -140], [0, -50], [0, 90], [50, 190], [140, 230], [240, 210], [300, 270], [290, 360], [220, 420], [150, 430], [92, 482], [165, 530], [95, 585], [120, 640], [190, 660], [270, 630], [340, 570], [420, 550], [490, 600], [500, 690], [450, 745], [380, 770], [380, 825], [320, 850], [270, 920]],
};
const stageOf = { stage_pine_ridge: "pine_ridge", stage_dust_valley: "dust_valley", stage_frost_pass: "frost_pass", stage_harbour_lights: "harbour_lights" };
const stages = {};
for (const [name, control] of Object.entries(stageControl)) {
  const base = tracks[stageOf[name]];
  // a stage is loose underfoot: gravel in the forest, sand in the desert, snow on the pass; the harbour's is tarmac
  const road = { stage_pine_ridge: "road_gravel", stage_dust_valley: "road_sand" }[name] ?? base.road;
  stages[name] = { ...base, road, open: true, control, seed: base.seed + 100, sections: 5, leadIn: 40, runout: 90, landmarks: { ...base.landmarks, count: base.landmarks.count } };
}
const dry = !!process.env.DRY;
const run = async (nova) => {
  for (const [name, spec] of Object.entries({ ...tracks, ...stages })) {
    if (only && only !== name) continue;
    const { scene, stats } = layout(spec);
    console.log(`\n${name}: ${stats.length} m, ${stats.points} road pieces, ${stats.objects} objects, tightest bend radius ~${stats.minRadius} m at ${stats.tightest}, ${stats.bends} sharp bends, closest approach ${tightest(stats.line, 5)} m`);
    console.log(ascii(stats.line));
    if (!dry) {
      fs.writeFileSync(path.join(GAME, "models", `road_${name}.glb`), roadGlb(spec.control, spec.road, !!spec.open));
      console.log(await nova.call("scene_write", { name, scene }));
    }
  }
};
if (dry) await run(null);
else await withServer(run);
