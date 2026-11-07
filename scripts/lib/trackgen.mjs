// Lays out a racing route as a scene: a closed circuit or an open rally stage, from a list of control points. Used by Pine Ridge Rally's script
// (scripts/rally/tracks.mjs) and by the studio's MCP server (the `track_write` tool). `layout(spec)` returns the scene (road start, arches, section
// gates, waypoints, grid, scenery along the route) and its statistics; `roadGlb(control, kind, open)` is the road as one ribbon mesh.
// Lays out the rally game's two circuits as scene files, through the Nova MCP server's `scene_write` tool: a closed curve through
// control points, road pieces along it, waypoints for the cars to follow, a start line and grid, and scenery on both sides.
// (In the studio this is what placing objects in the 3D scene view makes; here a script does the placing.)

// ---- the curve ---------------------------------------------------------------------------------------------------------
const catmull = (p0, p1, p2, p3, t) => {
  const t2 = t * t, t3 = t2 * t;
  return [0, 1].map((k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3));
};

/// Points every `spacing` metres along the closed curve through `control`, from the first control point, with headings.
export function centreline(control, spacing, open = false) {
  const dense = [];
  const n = control.length;
  // (an open route, a rally stage, is not a loop: its ends repeat the first and last control points, and it stops at the last one)
  const at = (i) => control[open ? Math.max(0, Math.min(n - 1, i)) : (i + n) % n];
  for (let i = 0; i < (open ? n - 1 : n); i++) for (let s = 0; s < 80; s++) dense.push(catmull(at(i - 1), at(i), at(i + 1), at(i + 2), s / 80));
  if (open) dense.push([...control[n - 1]]);
  const out = [dense[0]];
  let carried = 0;
  for (let i = 1; i <= (open ? dense.length - 1 : dense.length); i++) {
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
  if (!open && Math.hypot(out.at(-1)[0] - out[0][0], out.at(-1)[1] - out[0][1]) < spacing * 0.5) out.pop();
  return out.map((p, i) => {
    const q = out[open ? Math.min(i + 1, out.length - 1) : (i + 1) % out.length], r = out[open ? Math.max(i - 1, 0) : (i + out.length - 1) % out.length];
    const dx = q[0] - r[0], dz = q[1] - r[1];
    const len = Math.hypot(dx, dz);
    return { x: p[0], z: p[1], tx: dx / len, tz: dz / len, ry: Math.atan2(dx, dz) };
  });
}

/// Signed turning (radians per metre) at each point; positive turns towards +x when heading +z.
export const curvature = (pts, spacing, open = false) => pts.map((p, i) => {
  const a = pts[open ? Math.max(0, i - 2) : (i + pts.length - 2) % pts.length], b = pts[open ? Math.min(pts.length - 1, i + 2) : (i + 2) % pts.length];
  let d = b.ry - a.ry;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d / (spacing * 4);
});

export function rng(seed) {
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

export function layout(spec) {
  const spacing = 5;
  const open = !!spec.open;
  const line = centreline(spec.control, spacing, open);
  const curv = curvature(line, spacing, open);
  const n = line.length;
  const length = n * spacing;
  // an open stage: the road starts `leadIn` metres before the start line (index L), and runs on `runout` metres past the finish line (index F)
  const L = open ? Math.round((spec.leadIn ?? 40) / spacing) : 0;
  const F = open ? n - 1 - Math.round((spec.runout ?? 90) / spacing) : n;
  const rand = rng(spec.seed);
  const pick = (v) => (Array.isArray(v) ? v[Math.floor(rand() * v.length)] : v);
  const objects = [];

  // the road, with the start line on the first piece
  // (every other slab a hair higher: they overlap, and the kit's road has lines that would flicker where two slabs share a level)
  // (the road itself is one ribbon mesh, models/road_<circuit>.glb, drawn by lib/race.lua; only the start line is a piece, laid on it)
  objects.push(obj("road_start", line[L].x, line[L].z, line[L].ry, {}, 0.03));
  objects.push(obj("start_arch", line[L].x, line[L].z, line[L].ry));
  objects.push(obj("tower", line[L].x + line[L].tz * 15, line[L].z - line[L].tx * 15, line[L].ry + Math.PI / 2));
  if (open) {
    // the finish: an arch, with the flags of the finish on both sides; and the section gates between: two banners and a flag each side
    objects.push(obj("start_arch", line[F].x, line[F].z, line[F].ry));
    for (const side of [-1, 1]) objects.push(obj("flag_checkers", line[F].x + line[F].tz * side * 8, line[F].z - line[F].tx * side * 8, 0));
    const sections = spec.sections ?? 5;
    for (let k = 1; k <= sections; k++) {
      const g = line[L + Math.round(((F - L) * k) / sections)];
      objects.push({ kind: "section_gate", x: r1(g.x), y: 0, z: r1(g.z), props: { i: k, ry: Math.round(g.ry * 1000) / 1000 } });
      if (k === sections) continue; // (the last gate is the finish, which has its arch)
      for (const side of [-1, 1]) {
        objects.push(obj(spec.gateBanner ?? "banner_green", g.x + g.tz * side * 9.5, g.z - g.tx * side * 9.5, g.ry));
        objects.push(obj("flag_checkers", g.x + g.tz * side * 8, g.z - g.tx * side * 8, 0));
      }
    }
  }

  // waypoints every 10 m: the way the cars drive, and the order that counts laps
  const wp = [];
  for (let i = open ? L : 0; i < n; i += 2) wp.push(i);
  wp.forEach((i, k) => objects.push({ kind: "waypoint", x: r1(line[i].x), y: 0, z: r1(line[i].z), props: { i: k + 1, k: Math.round(curv[i] * 10000) / 10000 } }));

  // the grid: two columns behind the line, facing the way the road goes
  for (let s = 0; s < 4; s++) {
    const back = open ? 5 : 9 + s * 8, side = open ? 0 : s % 2 ? 3 : -3;
    const p = open ? line[L - Math.ceil(back / spacing)] : line[(n - Math.ceil(back / spacing)) % n];
    objects.push({ kind: "grid_slot", x: r1(p.x + p.tz * side * -1), y: 0, z: r1(p.z + p.tx * side), props: { slot: s + 1, ry: Math.round(p.ry * 1000) / 1000 } });
  }

  // how close the nearest road is to a spot
  const near = (x, z) => {
    let best = 1e9;
    for (const p of line) best = Math.min(best, Math.hypot(p.x - x, p.z - z));
    return best;
  };
  const place = (kind, x, z, minRoad, extra = {}) => {
    if (!kind) return false;
    if (near(x, z) < minRoad) return false;
    // every piece gets its own size and a slight tint (the scene object's `tint`: sRGB multipliers), so that two of one model are never quite alike
    const v = 218 + Math.floor(rand() * 37), warm = Math.floor(rand() * 18);
    objects.push(obj(kind, x, z, rand() * Math.PI * 2, { sx: Math.round((0.8 + rand() * 0.6) * 100) / 100, tint: [v, v - warm / 2, v - warm], ...extra }));
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
      if (rand() < spec.density * 0.7) place(spec.small[Math.floor(rand() * spec.small.length)], p.x + nx * (8 + rand() * 12), p.z + nz * (8 + rand() * 12), 11);
      if (rand() < spec.rocks) place(pick(spec.rock), p.x + nx * (9 + rand() * 20), p.z + nz * (9 + rand() * 20), 8.5);
      if (spec.far && rand() < spec.far.density) place(pick(spec.far.kind), p.x + nx * (60 + rand() * 90), p.z + nz * (60 + rand() * 90), 40);
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
    // street lamps along the outer edge every 40 m, turned to face the road (the lamp's arm points along its +z)
    if (spec.lamps && i % 8 === 3) {
      const side = i % 16 === 3 ? 1 : -1, nx = -p.tz * side, nz = p.tx * side;
      objects.push(obj("lamp", p.x + nx * 9.4, p.z + nz * 9.4, Math.atan2(-nx, -nz)));
    }
    if (i % 17 === 5 && Math.abs(k) < 0.006) objects.push(obj("hay_bale", p.x + -p.tz * 11.5, p.z + p.tx * 11.5, p.ry));
  }

  // some tall features well away from the road
  for (let i = 0; i < spec.landmarks.count; i++) {
    const a = rand() * Math.PI * 2, d = spec.landmarks.radius + rand() * 40;
    const cx = spec.control.reduce((s, c) => s + c[0], 0) / spec.control.length, cz = spec.control.reduce((s, c) => s + c[1], 0) / spec.control.length;
    place(pick(spec.landmarks.kind), cx + Math.cos(a) * d * 1.3, cz + Math.sin(a) * d, 50);
  }

  const s0 = line[0];
  const scene = {
    version: 1,
    background: spec.sky,
    camera: { eye: [r1(s0.x - s0.tx * 22 + 6), 9, r1(s0.z - s0.tz * 22)], target: [r1(s0.x), 1.5, r1(s0.z + 14)], fov: 62 },
    objects,
  };
  return { scene, stats: { points: n, length, objects: objects.length, minRadius: Math.round(1 / Math.max(...curv.map(Math.abs))), tightest: (() => { const i = curv.map(Math.abs).indexOf(Math.max(...curv.map(Math.abs))); return [Math.round(line[i].x), Math.round(line[i].z)]; })(), bends: curv.filter((k, i) => Math.abs(k) > 0.04 && Math.abs(curv[(i + 1) % curv.length]) <= 0.04).length, line, curv } };
}

// ---- the road as one ribbon ------------------------------------------------------------------------------------------------------
// The road is not laid slab by slab (a straight slab on a bend leaves wedges on the outside and overlaps on the inside, and slabs that
// overlap flicker unless one is raised a hair): it is one mesh along the curve, a row of quads every 2 m, with the cross-section of the
// Kenney Racing Kit's `roadStraight` (12 m across: a 1 m verge, a 0.9 m line, then the asphalt) and its colours. The renderer lifts every
// vertex by the hills (nova.terrain), which is why a row every 2 m is made, and a skirt hangs from each edge so that no gap shows under it.
export const ROAD_COLOURS = {
  road_asphalt: { road: [0.2667, 0.2667, 0.2667], line: [0.9451, 0.949, 0.9647], verge: [0.302, 0.5608, 0.4314] },
  road_dirt: { road: [0.5, 0.37, 0.24], line: [0.78, 0.66, 0.48], verge: [0.66, 0.48, 0.28] },
  road_snow: { road: [0.6, 0.66, 0.74], line: [0.93, 0.96, 0.99], verge: [0.92, 0.95, 1.0] },
  // the rally stages: gravel (a grey-brown road with pale edges) and sand
  road_gravel: { road: [0.3, 0.26, 0.21], line: [0.5, 0.45, 0.38], verge: [0.2, 0.28, 0.12] },
  road_sand: { road: [0.82, 0.66, 0.42], line: [0.92, 0.8, 0.56], verge: [0.7, 0.54, 0.31] },
};
const CROSS = [[-6, -5.02, "verge"], [-5.02, -4.14, "line"], [-4.14, 4.14, "road"], [4.14, 5.02, "line"], [5.02, 6, "verge"]];

export function roadGlb(control, kind, open = false) {
  const colours = ROAD_COLOURS[kind];
  const rows = centreline(control, 2, open);
  const n = rows.length;
  const positions = [], normals = [], colors = [], indices = [];
  const TOP = 0.02, SKIRT = -0.3;
  const quad = (a, b, c, d, rgb, wantUp) => {
    // a, b, c, d go round the quad; flip them if they face the wrong way
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let nrm = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const len = Math.hypot(...nrm) || 1;
    nrm = nrm.map((x) => x / len);
    const flip = nrm[0] * wantUp[0] + nrm[1] * wantUp[1] + nrm[2] * wantUp[2] < 0;
    const pts = flip ? [a, d, c, b] : [a, b, c, d];
    if (flip) nrm = nrm.map((x) => -x);
    const base = positions.length / 3;
    for (const q of pts) { positions.push(...q); normals.push(...nrm); colors.push(...rgb, 1); }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const at = (i, off, y) => { const p = rows[i % n]; return [p.x + p.tz * off, y, p.z - p.tx * off]; };
  for (let i = 0; i < (open ? n - 1 : n); i++) {
    const j = i + 1;
    for (const [from, to, name] of CROSS) quad(at(i, from, TOP), at(i, to, TOP), at(j, to, TOP), at(j, from, TOP), colours[name], [0, 1, 0]);
    // the skirts: down from each outer edge, in the dark of the verge
    const dark = colours.verge.map((x) => x * 0.55);
    for (const side of [-6, 6]) quad(at(i, side, TOP), at(j, side, TOP), at(j, side, SKIRT), at(i, side, SKIRT), dark, [side < 0 ? -rows[i].tz : rows[i].tz, 0, side < 0 ? rows[i].tx : -rows[i].tx]);
  }
  const P = new Float32Array(positions), N = new Float32Array(normals), C = new Float32Array(colors), I = new Uint32Array(indices);
  const parts = [P, N, C, I].map((a) => Buffer.from(a.buffer));
  const offsets = []; let atb = 0;
  for (const b of parts) { offsets.push(atb); atb += b.length; }
  const bin = Buffer.concat(parts);
  const xs = [], ys = [], zs = [];
  for (let k = 0; k < positions.length; k += 3) { xs.push(positions[k]); ys.push(positions[k + 1]); zs.push(positions[k + 2]); }
  const json = {
    asset: { version: "2.0", generator: "nova scripts/rally/tracks.mjs" },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: "road", mesh: 0 }],
    meshes: [{ name: "road", primitives: [{ attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 }, indices: 3, mode: 4 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: positions.length / 3, type: "VEC3", min: [Math.min(...xs), Math.min(...ys), Math.min(...zs)], max: [Math.max(...xs), Math.max(...ys), Math.max(...zs)] },
      { bufferView: 1, componentType: 5126, count: positions.length / 3, type: "VEC3" },
      { bufferView: 2, componentType: 5126, count: positions.length / 3, type: "VEC4" },
      { bufferView: 3, componentType: 5125, count: indices.length, type: "SCALAR" },
    ],
    bufferViews: parts.map((b, k) => ({ buffer: 0, byteOffset: offsets[k], byteLength: b.length, target: k === 3 ? 34963 : 34962 })),
    buffers: [{ byteLength: bin.length }],
  };
  let js = Buffer.from(JSON.stringify(json));
  js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const head = Buffer.alloc(12);
  head.write("glTF", 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8);
  const c1 = Buffer.alloc(8); c1.writeUInt32LE(js.length, 0); c1.write("JSON", 4);
  const c2 = Buffer.alloc(8); c2.writeUInt32LE(bin.length, 0); c2.write("BIN\0", 4);
  return Buffer.concat([head, c1, js, c2, bin]);
}

// ---- a text map, to look at the shape ----------------------------------------------------------------------------------
export function ascii(line, w = 90, h = 40) {
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
export function tightest(line, spacing) {
  let best = 1e9;
  for (let i = 0; i < line.length; i++) for (let j = i + 1; j < line.length; j++) {
    const around = Math.min(j - i, line.length - (j - i));
    if (around * spacing < 80) continue;
    best = Math.min(best, Math.hypot(line[i].x - line[j].x, line[i].z - line[j].z));
  }
  return Math.round(best);
}

