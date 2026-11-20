// Makes a rally stage for Pine Ridge Rally from a seed (the same files the studio's track editor makes with "New random route" and
// "Generate scene and road"): tracks/<id>.track.json, scenes/<id>.scene.json and models/road_<id>.glb. The scenery and the game settings
// (the scene's named `race` and `foliage` objects) come from a template stage, so the new stage looks and plays like it.
//
//   node scripts/rally/random-stage.mjs <id> [--seed N] [--length m] [--curves 0..1] [--like stage_pine_ridge] [--project folder]
import fs from "node:fs";
import path from "node:path";
import { layout, roadGlb } from "../lib/trackgen.mjs";
import { randomRoute } from "../lib/trackrandom.mjs";

const args = process.argv.slice(2);
const id = args[0];
if (!id || id.startsWith("--")) { console.error("usage: random-stage.mjs <id> [--seed N] [--length m] [--curves 0..1] [--like stage_id] [--project folder]"); process.exit(2); }
const opt = (name, d) => { const i = args.indexOf(`--${name}`); return i < 0 ? d : args[i + 1]; };
const project = opt("project", "examples/pine-ridge-rally");
const like = opt("like", "stage_pine_ridge");
const seed = Number(opt("seed", 1)), length = Number(opt("length", 2800)), curviness = Number(opt("curves", 0.55));

const track = JSON.parse(fs.readFileSync(path.join(project, "tracks", `${like}.track.json`), "utf8"));
const route = randomRoute({ open: true, length, curviness, seed });
if (!route.ok) { console.error(`no route passed the checks for seed ${seed}; try another seed`); process.exit(1); }
Object.assign(track, { control: route.control, seed, zones: undefined, sections: Math.max(3, Math.round(route.length / 450)) });
delete track.zones;

const template = JSON.parse(fs.readFileSync(path.join(project, "scenes", `${like}.scene.json`), "utf8"));
const keep = template.objects.filter((o) => typeof o.name === "string");
const { scene, stats } = layout({
  seed, control: track.control, open: true, road: track.road, rail: track.rail, sky: track.sky, sections: track.sections, leadIn: track.leadIn,
  runout: track.runout, lamps: track.lamps, trees: track.trees, small: track.small, rock: track.rock, density: track.trees.length ? track.density : 0,
  rocks: track.rocks, far: track.far, landmarks: track.landmarks?.kind?.length ? track.landmarks : { kind: [], count: 0, radius: 0 },
  roadside: track.roadside, crowd: track.crowd, zones: [], keep,
});
scene.objects.splice(keep.length, 0, { kind: "road", x: 0, y: 0, z: 0, props: { model: `road_${id}` } });

fs.writeFileSync(path.join(project, "tracks", `${id}.track.json`), JSON.stringify(track, null, 2) + "\n");
fs.writeFileSync(path.join(project, "scenes", `${id}.scene.json`), JSON.stringify(scene, null, 2) + "\n");
fs.writeFileSync(path.join(project, "scenes", `${id}.lua`), `-- A course: everything about it (road, scenery, crowd, and its settings in the race object) is in ${id}.scene.json.\nreturn require("lib.race").scene()\n`);
fs.writeFileSync(path.join(project, "models", `road_${id}.glb`), roadGlb(track.control, track.road, true, []));
console.log(`${id}: ${route.length} m, tightest bend ${route.minRadius} m, ${track.sections} sections, ${stats.objects} objects (seed ${seed}, like ${like})`);
