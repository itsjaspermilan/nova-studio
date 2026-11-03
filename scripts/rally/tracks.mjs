// Lays out the rally game's two circuits as scene files, through the Nova MCP server's `scene_write` tool: a closed curve through
// control points, road pieces along it, waypoints for the cars to follow, a start line and grid, and scenery on both sides.
// (In the studio this is what placing objects in the 3D scene view makes; here a script does the placing.)
import { withServer } from "./mcp.mjs";

// ---- the curve ---------------------------------------------------------------------------------------------------------
const catmull = (p0, p1, p2, p3, t) => {
  const t2 = t * t, t3 = t2 * t;
  return [0, 1].map((k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3));
};

/// Points every `spacing` metres along the closed curve through `control`, from the first control point, with headings.
function centreline(control, spacing) {
  const dense = [];
  const n = control.length;
  for (let i = 0; i < n; i++) for (let s = 0; s < 80; s++) dense.push(catmull(control[(i + n - 1) % n], control[i], control[(i + 1) % n], control[(i + 2) % n], s / 80));
  const out = [dense[0]];
  let carried = 0;
  for (let i = 1; i <= dense.length; i++) {
    const a = dense[i - 1], b = dense[i % dense.length];
    let d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (carried + d >= spacing) {
      const f = (spacing - carried) / d;
      const p = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
      out.push(p);
      a[0] = p[0]; a[1] = p[1];
      d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      carried = 0;
    }
    carried += d;
  }
  // the last point may sit very close to the first: drop it
  if (Math.hypot(out.at(-1)[0] - out[0][0], out.at(-1)[1] - out[0][1]) < spacing * 0.5) out.pop();
  return out.map((p, i) => {
    const q = out[(i + 1) % out.length], r = out[(i + out.length - 1) % out.length];
    const dx = q[0] - r[0], dz = q[1] - r[1];
    const len = Math.hypot(dx, dz);
    return { x: p[0], z: p[1], tx: dx / len, tz: dz / len, ry: Math.atan2(dx, dz) };
  });
}

/// Signed turning (radians per metre) at each point; positive turns towards +x when heading +z.
const curvature = (pts, spacing) => pts.map((p, i) => {
  const a = pts[(i + pts.length - 2) % pts.length], b = pts[(i + 2) % pts.length];
  let d = b.ry - a.ry;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d / (spacing * 4);
});

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r1 = (n) => Math.round(n * 10) / 10;
const obj = (kind, x, z, ry = 0, extra = {}, y = 0) => ({ kind, x: r1(x), y, z: r1(z), ...(ry || Object.keys(extra).length ? { props: { ...(ry ? { ry: Math.round(ry * 1000) / 1000 } : {}), ...extra } } : {}) });

function layout(spec) {
  const spacing = 5;
  const line = centreline(spec.control, spacing);
  const curv = curvature(line, spacing);
  const n = line.length;
  const length = n * spacing;
  const rand = rng(spec.seed);
  const objects = [];

  // the road, with the start line on the first piece
  line.forEach((p, i) => objects.push(obj(i === 0 ? "road_start" : spec.road, p.x, p.z, p.ry)));
  objects.push(obj("start_arch", line[0].x, line[0].z, line[0].ry));
  objects.push(obj("tower", line[0].x + line[0].tz * 15, line[0].z - line[0].tx * 15, line[0].ry + Math.PI / 2));

  // waypoints every 10 m: the way the cars drive, and the order that counts laps
  const wp = [];
  for (let i = 0; i < n; i += 2) wp.push(i);
  wp.forEach((i, k) => objects.push({ kind: "waypoint", x: r1(line[i].x), y: 0, z: r1(line[i].z), props: { i: k + 1, k: Math.round(curv[i] * 10000) / 10000 } }));

  // the grid: two columns behind the line, facing the way the road goes
  for (let s = 0; s < 4; s++) {
    const back = 9 + s * 8, side = s % 2 ? 3 : -3;
    const p = line[(n - Math.ceil(back / spacing)) % n];
    objects.push({ kind: "grid_slot", x: r1(p.x + p.tz * side * -1), y: 0, z: r1(p.z + p.tx * side), props: { slot: s + 1, ry: Math.round(p.ry * 1000) / 1000 } });
  }

  // how close the nearest road is to a spot
  const near = (x, z) => {
    let best = 1e9;
    for (const p of line) best = Math.min(best, Math.hypot(p.x - x, p.z - z));
    return best;
  };
  const place = (kind, x, z, minRoad, extra = {}) => {
    if (near(x, z) < minRoad) return false;
    objects.push(obj(kind, x, z, rand() * Math.PI * 2, { sx: Math.round((0.8 + rand() * 0.6) * 100) / 100, ...extra }));
    return true;
  };

  for (let i = 0; i < n; i++) {
    const p = line[i];
    for (const side of [-1, 1]) {
      const nx = -p.tz * side, nz = p.tx * side; // outwards from the road
      // trees and bushes, fewer close to the road
      if (rand() < spec.density) {
        const d = 11 + rand() * 38;
        const kind = spec.trees[Math.floor(rand() * spec.trees.length)];
        place(kind, p.x + nx * d + (rand() - 0.5) * 6, p.z + nz * d + (rand() - 0.5) * 6, 10.5);
      }
      if (rand() < spec.density * 0.7) place(spec.small[Math.floor(rand() * spec.small.length)], p.x + nx * (8 + rand() * 12), p.z + nz * (8 + rand() * 12), 8);
      if (rand() < spec.rocks) place(spec.rock, p.x + nx * (9 + rand() * 20), p.z + nz * (9 + rand() * 20), 8.5);
      if (spec.far && rand() < spec.far.density) place(spec.far.kind, p.x + nx * (60 + rand() * 90), p.z + nz * (60 + rand() * 90), 40);
    }
    // on a bend the outside gets a barrier, tyres at the tightest part, and chevron signs before it
    const k = curv[i];
    if (Math.abs(k) > 0.0075 && i % 2 === 0) {
      const side = k > 0 ? 1 : -1; // a bend that turns towards +x (left, heading +z) has its outside on the right: (-tz, tx)
      const nx = -p.tz * side, nz = p.tx * side;
      objects.push(obj(spec.rail, p.x + nx * 8.2, p.z + nz * 8.2, p.ry));
      if (Math.abs(k) > 0.014 && i % 4 === 0) objects.push(obj("tires", p.x + nx * 9.6, p.z + nz * 9.6, 0));
    }
    if (Math.abs(k) > 0.011 && Math.abs(curv[(i + n - 4) % n]) < 0.008 && i % 3 === 0) {
      const side = k > 0 ? 1 : -1;
      objects.push(obj("sign_chevron", p.x + -p.tz * side * 8, p.z + p.tx * side * 8, p.ry + (k > 0 ? Math.PI : Math.PI)));
    }
    if (i % 17 === 5 && Math.abs(k) < 0.006) objects.push(obj("hay_bale", p.x + -p.tz * 9, p.z + p.tx * 9, p.ry));
  }

  // some tall features well away from the road
  for (let i = 0; i < spec.landmarks.count; i++) {
    const a = rand() * Math.PI * 2, d = spec.landmarks.radius + rand() * 40;
    const cx = spec.control.reduce((s, c) => s + c[0], 0) / spec.control.length, cz = spec.control.reduce((s, c) => s + c[1], 0) / spec.control.length;
    place(spec.landmarks.kind, cx + Math.cos(a) * d * 1.3, cz + Math.sin(a) * d, 50);
  }

  const s0 = line[0];
  const scene = {
    version: 1,
    background: spec.sky,
    camera: { eye: [r1(s0.x - s0.tx * 22 + 6), 9, r1(s0.z - s0.tz * 22)], target: [r1(s0.x), 1.5, r1(s0.z + 14)], fov: 62 },
    objects,
  };
  return { scene, stats: { points: n, length, objects: objects.length, minRadius: Math.round(1 / Math.max(...curv.map(Math.abs))), line, curv } };
}

// ---- a text map, to look at the shape ----------------------------------------------------------------------------------
function ascii(line, w = 90, h = 40) {
  const xs = line.map((p) => p.x), zs = line.map((p) => p.z);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const grid = Array.from({ length: h }, () => Array(w).fill(" "));
  line.forEach((p, i) => {
    const c = Math.round(((p.x - x0) / (x1 - x0)) * (w - 1)), r = Math.round((1 - (p.z - z0) / (z1 - z0)) * (h - 1));
    grid[r][c] = i === 0 ? "S" : i % 20 === 0 ? "+" : "·";
  });
  return grid.map((r) => r.join("")).join("\n");
}

/// The closest two non-neighbouring road points, to be sure the circuit does not touch itself.
function tightest(line, spacing) {
  let best = 1e9;
  for (let i = 0; i < line.length; i++) for (let j = i + 1; j < line.length; j++) {
    const around = Math.min(j - i, line.length - (j - i));
    if (around * spacing < 80) continue;
    best = Math.min(best, Math.hypot(line[i].x - line[j].x, line[i].z - line[j].z));
  }
  return Math.round(best);
}

const tracks = {
  pine_ridge: {
    seed: 7, road: "road_asphalt", rail: "guardrail", sky: [138, 182, 224],
    control: [[0, -90], [0, 0], [0, 150], [30, 250], [110, 310], [230, 330], [330, 310], [390, 240], [378, 150], [352, 92], [366, 28], [336, -52], [268, -128], [190, -210], [80, -240], [-40, -220], [-70, -150]],
    trees: ["pine", "pine", "pine_dark", "pine_dark", "autumn_tree", "birch"], small: ["bush", "bush", "rock"], rock: "rock", density: 0.5, rocks: 0.06,
    far: { kind: "pine_dark", density: 0.5 }, landmarks: { kind: "pine_dark", count: 0, radius: 0 },
  },
  dust_valley: {
    seed: 21, road: "road_dirt", rail: "guardrail", sky: [236, 190, 140],
    control: [[0, -70], [0, 0], [0, 120], [50, 200], [140, 235], [230, 200], [250, 120], [190, 60], [120, 90], [80, 20], [120, -60], [190, -110], [200, -190], [120, -240], [20, -220], [-40, -150]],
    trees: ["cactus", "cactus", "dry_bush"], small: ["dry_bush", "rock_red", "dry_bush"], rock: "rock_red", density: 0.32, rocks: 0.1,
    far: { kind: "mesa", density: 0.22 }, landmarks: { kind: "mesa", count: 14, radius: 190 },
  },
};

const only = process.argv[2];
await withServer(async (nova) => {
  for (const [name, spec] of Object.entries(tracks)) {
    if (only && only !== name) continue;
    const { scene, stats } = layout(spec);
    console.log(`\n${name}: ${stats.length} m, ${stats.points} road pieces, ${stats.objects} objects, tightest bend radius ~${stats.minRadius} m, closest approach ${tightest(stats.line, 5)} m`);
    console.log(ascii(stats.line));
    console.log(await nova.call("scene_write", { name, scene }));
  }
});
