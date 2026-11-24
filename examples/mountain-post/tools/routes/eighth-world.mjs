// Writes tools/routes/eighth-world.json: the pictures of the eighth play's ponds, edges and driveways (1280x720), for judging them by eye:
// each pond from the walking camera, from the road (the driving camera) and from above; the playable area's edge from inside at a forest
// edge, a hedge, a fence, rocks, the gorge's rail by the BRIDGE OUT barrier and each secret way; each driveway from the road and from above.
//   scripts/env.sh node examples/mountain-post/tools/routes/eighth.mjs [out]
//   scripts/nova-tool --project examples/mountain-post play @examples/mountain-post/tools/routes/eighth-world.json
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)), game = join(here, "../..");
const out = process.argv[2] ?? "build/gallery/eighth";
const objects = JSON.parse(readFileSync(join(game, "scenes/valley.scene.json"), "utf8")).objects;
const named = (n) => objects.find((o) => o.name === n);
const roadPts = objects.filter((o) => o.kind === "roadline").flatMap((o) => o.props.points);
const nearestRoad = (x, z) => roadPts.reduce((b, p) => (Math.hypot(p[0] - x, p[1] - z) < Math.hypot(b[0] - x, b[1] - z) ? p : b));
const route = [{ wait: 30, lua: "nova.named('van'):teleport(300, 300, 0); nova.named('postmaster').x = 300" }];
const shot = (name, eye, at, fov = 55) => {
  // eye and at: [x, z, metres above the ground there]
  route.push({ lua: `CAM.pinned = { ${eye[0]}, nova.terrain_height(${eye[0]}, ${eye[1]}) + ${eye[2]}, ${eye[1]}, ${at[0]}, nova.terrain_height(${at[0]}, ${at[1]}) + ${at[2]}, ${at[1]}, ${fov} }` }, { wait: 3, capture: name });
};
const above = (name, x, z, w) => shot(name, [x, z - 0.5, w / 2 / Math.tan((20 * Math.PI) / 180)], [x, z, 0], 40);
// (from inside, `back` metres in towards the nearest road from (x, z), at height h, looking at it)
const fromInside = (name, x, z, back = 14, h = 1.8, look = 0.8, fov = 55) => {
  const r = nearestRoad(x, z), d = Math.hypot(r[0] - x, r[1] - z) || 1, ux = (r[0] - x) / d, uz = (r[1] - z) / d;
  shot(name, [x + ux * back, z + uz * back, h], [x, z, look], fov);
};

// the ponds
for (const p of objects.filter((o) => o.kind === "pond")) {
  const [x, z] = [p.x, p.z], r = nearestRoad(x, z), d = Math.hypot(r[0] - x, r[1] - z), ux = (x - r[0]) / d, uz = (z - r[1]) / d;
  if (p.name === "tarn_pond") {
    const from = objects.find((o) => o.kind === "playable").props.secrets.find((q) => q.id === "tarn_track").from;
    // (the walking camera, 3.5 m up and 7 m back, at the edge by the fallen tree: the tarn over the shelf's lip)
    const dx = from[0] - x, dz = from[1] - z, l = Math.hypot(dx, dz);
    shot(`${p.name} from the walking camera at the old track`, [from[0] + (dx / l) * 7, from[1] + (dz / l) * 7, 3.6], [x, z, 0.3], 50);
  } else {
    shot(`${p.name} driving`, [r[0] - ux * 2, r[1] - uz * 2, 3.4], [x, z, 0], 55);
    shot(`${p.name} walking`, [x - ux * 19, z - uz * 19, 1.9], [x, z, 0], 55);
  }
  above(`${p.name} from above`, x, z, 46);
}
{
  const j = named("jetty_end"), b = named("pond_bench");
  shot("reed_pond from the jetty's end", [j.x, j.z, 1.6], [named("reed_pond").x, named("reed_pond").z, 0], 60);
  shot("reed_pond's jetty and bench", [b.x + 3, b.z - 7, 2.2], [j.x, j.z, 0.4], 55);
}
// the edges, from inside
const first = (kind, f = () => true) => objects.find((o) => o.kind === kind && f(o));
const AREA = objects.find((o) => o.kind === "playable").props.areas[0];
const toEdge = (o) => Math.min(...AREA.map((p, i) => { const q = AREA[(i + 1) % AREA.length], dx = q[0] - p[0], dz = q[1] - p[1], t = Math.max(0, Math.min(1, ((o.x - p[0]) * dx + (o.z - p[1]) * dz) / (dx * dx + dz * dz || 1))); return Math.hypot(o.x - p[0] - dx * t, o.z - p[1] - dz * t); }));
const near = (o, x, z, r) => Math.hypot(o.x - x, o.z - z) < r;
const gate = named("south_gate_a"), log = named("tarn_track");
const views = [
  ["edge: forest", first("larch", (o) => o.z > -150 && o.z < -60 && toEdge(o) < 5)],
  ["edge: rocks", first("outcrop", (o) => o.z < 200)],
  ["edge: hedge by the post office", first("hedge", (o) => near(o, 21, -186, 50))],
  ["edge: fence by Pip's", first("fence", (o) => near(o, -192, 114, 50) && !near(o, -177, 101, 9))],
  ["edge: stone wall", objects.filter((o) => o.kind === "stone_wall").at(-1)],
];
for (const [n, o] of views) if (o) fromInside(n, o.x, o.z);
shot("edge: the gorge's rail by the BRIDGE OUT barrier", [20, 205, 1.8], [20, 230, 0.5], 60);
shot("edge: the gorge's rail, driving", [14, 196, 3.4], [22, 228, 0.3], 55);
shot("secret: the locked gates at Post Road's south end", [gate.x, gate.z + 16, 3.4], [gate.x, gate.z, 0.8], 55);
fromInside("secret: the fallen tree on the old track to Tarn Pond", log.x, log.z, 12);
// the driveways, from the road and from above
for (const d of objects.filter((o) => o.kind === "driveway")) {
  const pts = d.props.points, y = d.props.yard.at, s = pts[0], k = pts[Math.min(pts.length - 1, 4)];
  const ux = s[0] - k[0], uz = s[1] - k[1], l = Math.hypot(ux, uz) || 1;
  shot(`${d.name} from the road`, [s[0] + (ux / l) * 9, s[1] + (uz / l) * 9, 3.2], [y[0], y[1], 0.3], 55);
  above(`${d.name} from above`, (s[0] + y[0]) / 2, (s[1] + y[1]) / 2, Math.max(30, Math.hypot(y[0] - s[0], y[1] - s[1]) + 16));
}
writeFileSync(join(here, "eighth.json"), JSON.stringify({ size: "1280x720", start_scene: "valley", lua: "CAM = require('lib.camera')", route, out }, null, 1) + "\n");
console.log(`${route.filter((s) => s.capture).length} pictures`);
