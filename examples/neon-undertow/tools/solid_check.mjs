// The solid-map check for the art swap. `snapshot` writes tools/solid_maps.json from the scenes as they are (done once, on the old art);
// `check` compares every scene's solid cells with that snapshot and fails on any difference.
// Run: scripts/env.sh node examples/neon-undertow/tools/solid_check.mjs [snapshot|check]
import fs from "node:fs";
import path from "node:path";
const root = new URL("../", import.meta.url).pathname;
const SNAP = root + "tools/solid_maps.json";

export function solidMap(scene) {
  const rows = scene.height ? Math.round(scene.height / 48) : 0, cols = scene.width ? Math.round(scene.width / 48) : 0;
  const map = Array.from({ length: rows }, () => Array.from({ length: cols }, () => "."));
  for (const t of scene.tilemaps || []) {
    const solid = new Set(t.solid || []);
    t.tiles.forEach((row, y) => row.forEach((id, x) => { if (solid.has(id) && map[y]?.[x] !== undefined) map[y][x] = "#"; }));
  }
  return map.map((r) => r.join(""));
}

export function allScenes() {
  const out = {};
  const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    if (f.isDirectory()) walk(path.join(d, f.name));
    else if (f.name.endsWith(".scene.json")) out[path.relative(root + "scenes", path.join(d, f.name))] = JSON.parse(fs.readFileSync(path.join(d, f.name), "utf8"));
  } };
  walk(root + "scenes");
  return out;
}

export function compare(names) {
  const snap = JSON.parse(fs.readFileSync(SNAP, "utf8"));
  const scenes = allScenes();
  let bad = 0;
  for (const name of names || Object.keys(snap)) {
    if (!scenes[name]) { console.log(`MISSING ${name}`); bad++; continue; }
    const now = solidMap(scenes[name]), was = snap[name];
    let diff = 0; const where = [];
    for (let y = 0; y < Math.max(now.length, was.length); y++) for (let x = 0; x < Math.max(now[y]?.length ?? 0, was[y]?.length ?? 0); x++) {
      if (now[y]?.[x] !== was[y]?.[x]) { diff++; if (where.length < 6) where.push(`${x},${y}`); }
    }
    if (diff) { bad++; console.log(`SOLID MISMATCH ${name}: ${diff} cells (${where.join(" ")}...)`); } else console.log(`ok ${name}`);
  }
  return bad;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv[2] === "snapshot") {
    const snap = {}; for (const [n, s] of Object.entries(allScenes())) snap[n] = solidMap(s);
    fs.writeFileSync(SNAP, JSON.stringify(snap)); console.log(`snapshot of ${Object.keys(snap).length} scenes`);
  } else process.exitCode = compare() ? 1 : 0;
}
