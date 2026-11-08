// Pine Ridge Rally's starting grids: puts each course scene's `grid_slot` objects just behind its start line, on the road, at even gaps.
// A circuit gets four boxes in two staggered columns, 6 m apart along the road (the front one 6 m behind the line); a stage, which the
// player drives alone, one box in the middle of the road. The road is followed through bends (the slots stand on the road's centreline,
// facing along it). Only the grid_slot lines change; the rest of each scene file is left as it is.
//   scripts/env.sh node scripts/rally/grid.mjs
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { centreline, stageMarks, gridSlots as slots } from "../lib/trackgen.mjs";

const DIR = join(new URL("../..", import.meta.url).pathname, "examples/pine-ridge-rally/scenes");
const r1 = (v) => Math.round(v * 10) / 10;

const slotLine = (s) => `    { "kind": "grid_slot", "x": ${r1(s.x)}, "y": 0, "z": ${r1(s.z)}, "props": { "slot": ${s.slot}, "ry": ${Math.round(s.ry * 1000) / 1000} } },`;

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const file of readdirSync(DIR).filter((f) => f.endsWith(".scene.json"))) {
    const path = join(DIR, file);
    const text = readFileSync(path, "utf8");
    const doc = JSON.parse(text);
    const objs = doc.objects ?? doc.entities ?? [];
    const start = objs.find((o) => o.kind === "road_start");
    if (!start) continue;
    // the road's own centreline, from the course's track file (5 m points, as the generator and the studio's track editor lay the grid)
    const track = JSON.parse(readFileSync(join(DIR, "..", "tracks", file.replace(".scene.json", ".track.json")), "utf8"));
    const open = !!track.open;
    const line = centreline(track.control, 5, open);
    const { L } = stageMarks(line.length, 5, open, track.leadIn, track.runout);
    const made = slots(line[L], open ? [] : line.map((p) => ({ x: p.x, z: p.z })), open);
    const lines = text.split("\n");
    const at = lines.findIndex((l) => l.includes('"kind": "grid_slot"'));
    const kept = lines.filter((l) => !l.includes('"kind": "grid_slot"'));
    kept.splice(at, 0, ...made.map(slotLine));
    writeFileSync(path, kept.join("\n"));
    JSON.parse(kept.join("\n")); // (still JSON)
    console.log(file, open ? "stage" : "circuit", made.map((s) => `${s.slot}:${r1(s.x)},${r1(s.z)}`).join(" "));
  }
}
