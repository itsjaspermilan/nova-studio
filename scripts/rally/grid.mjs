// Pine Ridge Rally's starting grids: puts each course scene's `grid_slot` objects just behind its start line, on the road, at even gaps.
// A circuit gets four boxes in two staggered columns, 6 m apart along the road (the front one 6 m behind the line); a stage, which the
// player drives alone, one box in the middle of the road. The road is followed through bends (the slots stand on the waypoints' line,
// facing along it). Only the grid_slot lines change; the rest of each scene file is left as it is.
//   scripts/env.sh node scripts/rally/grid.mjs
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = join(new URL("../..", import.meta.url).pathname, "examples/pine-ridge-rally/scenes");
export const GAP = 6, FIRST = 6, SIDE = 2.2;
const r1 = (v) => Math.round(v * 10) / 10;

/// The point `back` metres behind the start of `pts` (a closed loop that starts at the line, in driving order), with the road's heading there.
export function behind(pts, back) {
  let left = back;
  for (let k = 0; k < pts.length; k++) {
    const a = pts[(pts.length - k) % pts.length], b = pts[pts.length - k - 1];
    const len = Math.hypot(a.x - b.x, a.z - b.z);
    if (left <= len) {
      const t = left / len;
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, ry: Math.atan2(a.x - b.x, a.z - b.z) };
    }
    left -= len;
  }
  throw new Error("the loop is shorter than the grid");
}

/// The grid_slot objects for a course: `line` is the start line ({x, z, ry}), `pts` the waypoints in order (a circuit's loop), `open` a stage.
export function slots(line, pts, open) {
  const out = [];
  if (open) {
    const x = line.x - Math.sin(line.ry) * FIRST, z = line.z - Math.cos(line.ry) * FIRST;
    out.push({ slot: 1, x, z, ry: line.ry });
    return out;
  }
  for (let s = 0; s < 4; s++) {
    const p = behind(pts, FIRST + s * GAP);
    const side = s % 2 ? SIDE : -SIDE;
    // (sideways: the same side trackgen has always used, -tz/+tx)
    out.push({ slot: s + 1, x: p.x - Math.cos(p.ry) * side, z: p.z + Math.sin(p.ry) * side, ry: p.ry });
  }
  return out;
}

const line = (s) => `    { "kind": "grid_slot", "x": ${r1(s.x)}, "y": 0, "z": ${r1(s.z)}, "props": { "slot": ${s.slot}, "ry": ${Math.round(s.ry * 1000) / 1000} } },`;

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const file of readdirSync(DIR).filter((f) => f.endsWith(".scene.json"))) {
    const path = join(DIR, file);
    const text = readFileSync(path, "utf8");
    const doc = JSON.parse(text);
    const objs = doc.objects ?? doc.entities ?? [];
    const start = objs.find((o) => o.kind === "road_start");
    if (!start) continue;
    const pts = objs.filter((o) => o.kind === "waypoint").sort((a, b) => a.props.i - b.props.i).map((o) => ({ x: o.x, z: o.z }));
    const open = objs.some((o) => o.kind === "section_gate");
    const made = slots({ x: start.x, z: start.z, ry: start.props?.ry ?? 0 }, pts, open);
    const lines = text.split("\n");
    const at = lines.findIndex((l) => l.includes('"kind": "grid_slot"'));
    const kept = lines.filter((l) => !l.includes('"kind": "grid_slot"'));
    kept.splice(at, 0, ...made.map(line));
    writeFileSync(path, kept.join("\n"));
    JSON.parse(kept.join("\n")); // (still JSON)
    console.log(file, open ? "stage" : "circuit", made.map((s) => `${s.slot}:${r1(s.x)},${r1(s.z)}`).join(" "));
  }
}
