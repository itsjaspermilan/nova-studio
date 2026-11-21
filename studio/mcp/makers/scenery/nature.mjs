// Natural scenery for prop3d_make's detailed kinds (first made for Pine Ridge Rally on 2026-11-20 as scripts/rally/scenery-nature.mjs; moved
// here so every game has it): every tree, bush, cactus, rock, log, stump, tuft of grass, mesa, mountain and cloud, made by this code as studio
// model documents. Nothing is copied or converted from another asset: every shape below is worked out here.
//
// Each preset (a name below, which is also the Pine Ridge Rally model it first made) has a box in metres (BEFORE: the kit model the game
// started from measured that), and a shape is built near that size and then stretched to it exactly, each side of the origin on its own, so
// the trunk stays where it was. The nk_ presets reach a little under y = 0 (their feet are buried, which hides the base on a slope).
// Every random choice comes from a seed made of the preset's name (and, for prop3d_make's seed other than 1, a salt added to it): the same
// call writes the same bytes. Units: 16 = 1 m; y is up. buildPreset(preset, { part, salt, scale }) is the way in (makers/scenery.ts).
import { lerp, mix, r2, shade, smoothstep } from "../car/kit.mjs";

// ---- what the kit models measured (metres, triangles), read from their .glb files before they were replaced ---------------------------------
const B = (x0, y0, z0, x1, y1, z1, tris) => ({ lo: [x0, y0, z0], hi: [x1, y1, z1], tris });
export const BEFORE = {
  autumn_tree: B(-1.53, 0, -1.57, 1.57, 5.5, 1.59, 408), birch: B(-1.53, 0, -1.57, 1.57, 5.5, 1.59, 408),
  bush: B(-0.98, 0, -1.1, 0.98, 0.66, 0.59, 108), bush_snow: B(-0.98, 0, -1.1, 0.98, 0.66, 0.59, 108),
  cactus: B(-1.38, 0, -0.38, 1.38, 5, 0.38, 108), cloud: B(-7.5, 0, -3.13, 10.63, 4.38, 3.13, 144),
  dry_bush: B(-0.76, 0, -0.66, 0.79, 1.25, 0.66, 48), flowers: B(-0.15, 0, -0.15, 0.17, 0.66, 0.14, 60), grass: B(-0.11, 0, -0.12, 0.14, 0.54, 0.13, 48),
  mesa: B(-5.63, 0, -4.38, 5.63, 7.75, 4.38, 36),
  mountain: B(-93.75, 0, -81.25, 93.75, 93.75, 81.25, 12), mountain_ice: B(-93.75, 0, -81.25, 93.75, 93.75, 81.25, 12),
  mountain_night: B(-93.75, 0, -81.25, 93.75, 93.75, 81.25, 12), mountain_red: B(-93.75, 0, -81.25, 93.75, 93.75, 81.25, 12),
  nk_bush_detailed: B(-1, -0.17, -1, 1, 1.03, 1, 104), nk_bush_large: B(-1.2, -0.32, -1.08, 1.2, 1.24, 1.08, 60), nk_bush_tri: B(-1.23, -0.25, -1.15, 0.77, 0.59, 1.15, 39),
  nk_cactus_short: B(-0.76, -0.23, -0.53, 0.78, 2.17, 0.81, 116), nk_cactus_tall: B(-1.12, -0.28, -0.74, 1.1, 3.92, 1.16, 122),
  nk_dead_tall: B(-0.89, -0.22, -1.03, 0.89, 7.28, 1.03, 72), nk_dead_thin: B(-1.04, -0.2, -1.01, 1.7, 5.8, 1.47, 228),
  nk_default: B(-1.66, -0.22, -1.44, 1.66, 7.28, 1.44, 114), nk_default_fall: B(-1.66, -0.22, -1.44, 1.66, 7.28, 1.44, 228),
  nk_fat: B(-1.97, -0.26, -1.71, 1.97, 5.74, 1.71, 50), nk_log: B(-0.4, -0.18, -1.3, 0.46, 0.45, 1.3, 200),
  nk_night_pineround_a: B(-1.58, -0.26, -1.82, 1.58, 6.74, 1.82, 204), nk_night_pineround_e: B(-1.59, -0.3, -1.59, 1.59, 7.2, 1.59, 198),
  nk_night_pinesmall_a: B(-1.16, -0.23, -1.16, 1.16, 4.27, 1.16, 164), nk_night_pinetall_a: B(-1.11, -0.31, -1.2, 1.29, 9.19, 1.23, 78),
  nk_night_pinetall_c: B(-1.22, -0.25, -1.41, 1.22, 8.25, 1.41, 98), nk_oak: B(-1.83, -0.29, -2.11, 1.83, 6.71, 2.11, 196), nk_oak_fall: B(-1.83, -0.29, -2.11, 1.83, 6.71, 2.11, 196),
  nk_pineround_a: B(-1.58, -0.26, -1.82, 1.58, 6.74, 1.82, 204), nk_pineround_c: B(-1.25, -0.26, -1.44, 1.25, 6.24, 1.44, 206), nk_pineround_e: B(-1.59, -0.3, -1.59, 1.59, 7.2, 1.59, 198),
  nk_pinesmall_a: B(-1.16, -0.23, -1.16, 1.16, 4.27, 1.16, 164), nk_pinesmall_c: B(-0.79, -0.22, -0.79, 0.93, 4.78, 0.95, 54),
  nk_pinetall_a: B(-1.11, -0.31, -1.2, 1.29, 9.19, 1.23, 78), nk_pinetall_b: B(-0.97, -0.27, -1.05, 1.12, 10.23, 1.07, 78),
  nk_pinetall_c: B(-1.22, -0.25, -1.41, 1.22, 8.25, 1.41, 98), nk_pinetall_d: B(-1.27, -0.27, -1.47, 1.27, 10.73, 1.47, 98),
  nk_rock_largeA: B(-1.7, -0.22, -2.2, 1.7, 0.91, 2.2, 80), nk_rock_largeC: B(-1.5, -0.14, -1.43, 1.5, 0.76, 1.43, 72), nk_rock_largeE: B(-1.8, -0.16, -1.51, 1.8, 0.8, 1.51, 64),
  nk_rock_tallB: B(-1.2, -0.16, -1.21, 1.2, 2.62, 1.21, 172), nk_rock_tallF: B(-1.1, -0.25, -1.27, 1.1, 2.6, 1.27, 46), nk_rock_tallH: B(-1.4, -0.24, -1.62, 1.4, 3.22, 1.62, 78),
  nk_rockice_largeA: B(-1.7, -0.22, -2.2, 1.7, 0.91, 2.2, 80), nk_rockice_largeC: B(-1.5, -0.14, -1.43, 1.5, 0.76, 1.43, 72), nk_rockice_largeE: B(-1.8, -0.16, -1.51, 1.8, 0.8, 1.51, 64),
  nk_rockice_tallB: B(-1.2, -0.16, -1.21, 1.2, 2.62, 1.21, 172), nk_rockice_tallF: B(-1.1, -0.25, -1.27, 1.1, 2.6, 1.27, 46), nk_rockice_tallH: B(-1.4, -0.24, -1.62, 1.4, 3.22, 1.62, 78),
  nk_rockred_largeA: B(-1.7, -0.22, -2.2, 1.7, 0.91, 2.2, 80), nk_rockred_largeC: B(-1.5, -0.14, -1.43, 1.5, 0.76, 1.43, 72), nk_rockred_largeE: B(-1.8, -0.16, -1.51, 1.8, 0.8, 1.51, 64),
  nk_rockred_tallB: B(-1.2, -0.16, -1.21, 1.2, 2.62, 1.21, 172), nk_rockred_tallF: B(-1.1, -0.25, -1.27, 1.1, 2.6, 1.27, 46), nk_rockred_tallH: B(-1.4, -0.24, -1.62, 1.4, 3.22, 1.62, 78),
  nk_snow_pineround_a: B(-1.58, -0.26, -1.82, 1.58, 6.74, 1.82, 204), nk_snow_pineround_e: B(-1.59, -0.3, -1.59, 1.59, 7.2, 1.59, 198),
  nk_snow_pinesmall_a: B(-1.16, -0.23, -1.16, 1.16, 4.27, 1.16, 164), nk_snow_pinetall_a: B(-1.11, -0.31, -1.2, 1.29, 9.19, 1.23, 78),
  nk_snow_pinetall_c: B(-1.22, -0.25, -1.41, 1.22, 8.25, 1.41, 98), nk_snow_pinetall_d: B(-1.27, -0.27, -1.47, 1.27, 10.73, 1.47, 98),
  nk_stump: B(-0.5, -0.15, -0.57, 0.6, 0.67, 0.57, 120), nk_tall: B(-1.01, -0.25, -1.16, 1.01, 8.25, 1.16, 72), nk_tall_fall: B(-1.01, -0.25, -1.16, 1.01, 8.25, 1.16, 144),
  nk_thin: B(-1.21, -0.23, -1.18, 1.99, 6.77, 1.71, 228),
  pine: B(-1.72, 0, -1.72, 1.72, 7.25, 1.72, 204), pine_dark: B(-1.72, 0, -1.72, 1.72, 7.25, 1.72, 204), pine_snow: B(-1.72, 0, -1.72, 1.72, 7.25, 1.72, 204),
  rock: B(-1.71, 0, -1.73, 1.71, 2.09, 1.73, 100), rock_ice: B(-1.71, 0, -1.73, 1.71, 2.09, 1.73, 100), rock_red: B(-1.71, 0, -1.73, 1.71, 2.09, 1.73, 100),
};
/// What the kit models block (collision circles, model units), kept as they were.
const COLLIDERS = { cactus: [{ x: 0, z: 0, r: 11.2 }], mesa: [{ x: -48, z: 0, r: 80 }, { x: 48, z: 0, r: 80 }] };

// ---- numbers ----------------------------------------------------------------------------------------------------------------------------
const TAU = Math.PI * 2;
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const clamp01 = (t) => Math.max(0, Math.min(1, t));
const mean = (P) => mul(P.reduce(add, [0, 0, 0]), 1 / P.length);
function newell(P) {
  const n = [0, 0, 0];
  for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; n[0] += (p[1] - q[1]) * (p[2] + q[2]); n[1] += (p[2] - q[2]) * (p[0] + q[0]); n[2] += (p[0] - q[0]) * (p[1] + q[1]); }
  return n;
}
/// A seeded random number source (mulberry32): the same numbers every run.
function rng(seed) {
  let a = seed >>> 0;
  const f = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  f.range = (lo, hi) => lo + (hi - lo) * f();
  f.pick = (list) => list[Math.floor(f() * list.length)];
  return f;
}
/// Added to every seed while a preset is built for a seed other than 1 (buildPreset): 0 is the preset itself.
let SALT = 0;
const seedOf = (text) => { let h = 2166136261; for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return (h + SALT) >>> 0; };
/// A smooth bumpy field over space, about -1 to 1 (a few waves in random directions).
function field(rnd, freq = 1, waves = 4) {
  const w = Array.from({ length: waves }, (_, i) => ({ k: [rnd.range(-1, 1), rnd.range(-1, 1), rnd.range(-1, 1)].map((v) => v * freq * (1 + i * 0.55)), p: rnd() * TAU, a: 1 / (1 + i * 0.6) }));
  const total = w.reduce((s, v) => s + v.a, 0);
  return (p) => w.reduce((s, v) => s + v.a * Math.sin(dot(v.k, p) + v.p), 0) / total;
}
const jit = (color, rnd, amount = 0.08) => shade(color, 1 + (rnd() - 0.5) * 2 * amount);

// ---- a mesh being built ------------------------------------------------------------------------------------------------------------------
const ROUGH = { metallic: 0, roughness: 0.92 };
class Shape {
  constructor(name, color, material = ROUGH) { this.name = name; this.color = color; this.material = material; this.verts = []; this.polys = []; }
  v(p) { this.verts.push([p[0], p[1], p[2]]); return this.verts.length - 1; }
  /// A polygon, turned so that it faces `want` (a direction). Returns its unit normal.
  f(loop, color, want, smooth = false) {
    const n = unit(newell(loop.map((i) => this.verts[i]))), flip = dot(n, want) < 0;
    this.polys.push({ v: flip ? [...loop].reverse() : loop, color, smooth });
    return flip ? mul(n, -1) : n;
  }
  /// The normal a polygon would have facing `want`, before it is added (to pick its colour).
  normal(loop, want) { const n = unit(newell(loop.map((i) => this.verts[i]))); return dot(n, want) < 0 ? mul(n, -1) : n; }
  cube() {
    return { name: this.name, shape: "mesh", color: this.color, verts: this.verts.map((p) => p.map(r2)), polys: this.polys.map((p) => ({ v: p.v, ...(p.color && p.color !== this.color ? { color: p.color } : {}), ...(p.smooth ? { smooth: true } : {}) })), ...this.material };
  }
}

// unit spheres made of triangles: an eight- or twenty-sided solid, each triangle split in four `level` times
const SPHERES = new Map();
function sphere(base, level) {
  const key = base + level;
  if (SPHERES.has(key)) return SPHERES.get(key);
  let verts, tris;
  if (base === "octa") { verts = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]; tris = [[0, 2, 4], [4, 2, 1], [1, 2, 5], [5, 2, 0], [4, 3, 0], [1, 3, 4], [5, 3, 1], [0, 3, 5]]; }
  else {
    const t = (1 + Math.sqrt(5)) / 2;
    verts = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(unit);
    tris = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  }
  for (let l = 0; l < level; l++) {
    const cache = new Map(), next = [];
    const midpoint = (a, b) => { const k = a < b ? `${a},${b}` : `${b},${a}`; if (!cache.has(k)) cache.set(k, verts.push(unit(add(verts[a], verts[b]))) - 1); return cache.get(k); };
    for (const [a, b, c] of tris) { const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a); next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
    tris = next;
  }
  tris = tris.map((t) => (dot(newell(t.map((i) => verts[i])), mean(t.map((i) => verts[i]))) >= 0 ? t : [t[0], t[2], t[1]]));
  const made = { verts, tris };
  SPHERES.set(key, made);
  return made;
}

/// A lumpy rounded mass: a sphere pushed in and out by a bumpy field, cut flat by `planes` (a rock's facets), stretched to radii `r`, turned by `yaw`
/// and put at `c`. `floor` flattens what is under that height (and `drop` leaves out the triangles lying wholly on it: what the ground hides).
/// `color(normal, where, localWhere)` gives each triangle its colour (`localWhere` in the mass's own space, about -1 to 1).
function blob(S, o) {
  const m = sphere(o.base ?? "octa", o.level ?? 1), rnd = o.rnd, bump = field(rnd, o.freq ?? 1.5, 3), amp = o.lump ?? 0.15, yaw = o.yaw ?? rnd() * TAU, cs = Math.cos(yaw), sn = Math.sin(yaw);
  const pts = m.verts.map((u) => {
    let p = mul(u, 1 + amp * bump(u));
    for (const pl of o.planes ?? []) { const e = dot(p, pl.n) - pl.h; if (e > 0) p = sub(p, mul(pl.n, e)); }
    if (o.warp) p = o.warp(p);
    const s = [p[0] * o.r[0], p[1] * o.r[1], p[2] * o.r[2]];
    const local = p;
    const q = [o.c[0] + s[0] * cs + s[2] * sn, o.c[1] + s[1], o.c[2] - s[0] * sn + s[2] * cs];
    const under = o.floor !== undefined && q[1] < o.floor;
    if (under) q[1] = o.floor;
    return { q, under, local };
  });
  const index = new Map(), at = (i) => { if (!index.has(i)) index.set(i, S.v(pts[i].q)); return index.get(i); };
  for (const t of m.tris) {
    if (o.drop && t.every((i) => pts[i].under)) continue;
    const P = t.map((i) => pts[i].q), n = unit(newell(P));
    if (!(Math.abs(n[0]) + Math.abs(n[1]) + Math.abs(n[2]) > 0.5)) continue; // (a triangle squashed to nothing)
    S.polys.push({ v: t.map(at), color: o.color(n, mean(P), mean(t.map((i) => pts[i].local))), smooth: o.smooth ?? true });
  }
}

/// A tube along a line of points: `radii` one for each point (0 ends it in a point), `sides` round it. `o.shape(k, i)` scales the radius of side k
/// at point i (a ribbed cactus, a flared root), `o.capStart` / `o.capEnd` close an end with a flat face of that colour.
function tube(S, pts, radii, sides, color, o = {}) {
  const n = pts.length, rings = [];
  let u = null;
  for (let i = 0; i < n; i++) {
    const t = unit(sub(pts[Math.min(i + 1, n - 1)], pts[Math.max(i - 1, 0)]));
    u = u ? unit(sub(u, mul(t, dot(u, t)))) : unit(cross(Math.abs(t[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0], t));
    const w = cross(t, u);
    if (radii[i] < 1e-6) { rings.push([S.v(pts[i])]); continue; }
    const bend = i > 0 && i < n - 1 ? Math.min(1.5, 1 / Math.sqrt(Math.max(0.2, (1 + dot(unit(sub(pts[i], pts[i - 1])), unit(sub(pts[i + 1], pts[i])))) / 2))) : 1; // (a ring across a corner is wider)
    const ring = [];
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * TAU + (o.turn ?? 0) * i, r = radii[i] * bend * (o.shape ? o.shape(k, i) : 1);
      ring.push(S.v(add(pts[i], add(mul(u, Math.cos(a) * r), mul(w, Math.sin(a) * r)))));
    }
    rings.push(ring);
  }
  const smooth = o.smooth ?? true;
  for (let i = 0; i < n - 1; i++) {
    const a = rings[i], b = rings[i + 1], axis = mul(add(pts[i], pts[i + 1]), 0.5);
    if (a.length === 1 && b.length === 1) continue;
    for (let k = 0; k < sides; k++) {
      const k1 = (k + 1) % sides, loop = a.length === 1 ? [a[0], b[k1], b[k]] : b.length === 1 ? [a[k], a[k1], b[0]] : [a[k], a[k1], b[k1], b[k]];
      const want = sub(mean(loop.map((j) => S.verts[j])), axis);
      S.f(loop, color(i, k, S.normal(loop, want)), want, smooth);
    }
  }
  if (o.capStart && rings[0].length > 1) S.f(rings[0], o.capStart, sub(pts[0], pts[1]));
  if (o.capEnd && rings[n - 1].length > 1) S.f(rings[n - 1], o.capEnd, sub(pts[n - 1], pts[n - 2]));
  return rings;
}

/// Stretches the shapes to the box the kit model had: each side of the origin on its own, so what stands on the origin stays there.
function fit(shapes, T, name) {
  const lo = [0, 0, 0], hi = [0, 0, 0];
  for (const s of shapes) for (const p of s.verts) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p[i]); hi[i] = Math.max(hi[i], p[i]); }
  const kHi = hi.map((v, i) => (v > 1e-6 ? (T.hi[i] * 16) / v : 1)), kLo = lo.map((v, i) => (v < -1e-6 ? (T.lo[i] * 16) / v : 1));
  for (const s of shapes) for (const p of s.verts) for (let i = 0; i < 3; i++) p[i] *= p[i] >= 0 ? kHi[i] : kLo[i];
  const worst = [...kHi, ...kLo].reduce((m, k) => Math.max(m, k, 1 / Math.max(k, 1e-6)), 1);
  if (worst > 1.3 && process.env.FIT_LOG) console.error(`fit ${name}: stretched ${[...kLo, ...kHi].map((k) => k.toFixed(2)).join(" ")}`);
}

// ---- colours ----------------------------------------------------------------------------------------------------------------------------
// needles and leaves: `dark` in the shade and underneath, `mid`, `light` where the sky lights them, `alt` a second hue some clumps lean to
const NEEDLES = {
  pine: { dark: "#26392a", mid: "#3d5936", light: "#5c7646", alt: "#4a6230", under: "#1c2a20", bark: "#4b3b2e", barkLight: "#65513f" },
  dark: { dark: "#1d3026", mid: "#2f4a34", light: "#48633f", alt: "#2c4a3c", under: "#162219", bark: "#3d3027", barkLight: "#544336" },
  night: { dark: "#14272a", mid: "#203b3b", light: "#31524b", alt: "#1d3a44", under: "#0f1c1f", bark: "#2e2622", barkLight: "#40352f" },
  snow: { dark: "#243a2e", mid: "#36503a", light: "#4d6846", alt: "#3b5a48", under: "#1a2921", bark: "#46392f", barkLight: "#5f4f42", snow: "#e9eef3", snowShade: "#c2cfdc" },
};
const LEAVES = {
  green: { dark: "#33492a", mid: "#4f6b35", light: "#738c47", alt: "#5d7030", bark: "#52412f", barkLight: "#6d5942" },
  oak: { dark: "#2c4226", mid: "#45602f", light: "#667f3e", alt: "#3f5a3a", bark: "#463829", barkLight: "#5f4d3a" },
  birch: { dark: "#4a6230", mid: "#6c8640", light: "#93a857", alt: "#8a9a45", bark: "#d6d2c6", barkLight: "#e6e3da", barkMark: "#3b372f" },
  fall: { dark: "#683a22", mid: "#9a5e2e", light: "#be8d45", alt: "#8a3c2c", bark: "#4a3a2b", barkLight: "#64503c" },
  fallGold: { dark: "#74582a", mid: "#ab8739", light: "#c9ad5c", alt: "#9c6030", bark: "#d2cec2", barkLight: "#e2dfd6", barkMark: "#3b372f" },
  bush: { dark: "#2f4428", mid: "#48622f", light: "#6a8142", alt: "#56683a" },
  bushSnow: { dark: "#2e4330", mid: "#445c38", light: "#5f7846", alt: "#4b6248", snow: "#e9eef3", snowShade: "#c6d2de" },
};
const ROCKS = {
  grey: { dark: "#55534f", mid: "#757168", light: "#96918a", band: "#676057", top: "#8d8a7c", moss: "#5f6b46" },
  ice: { dark: "#6c7f92", mid: "#93a6b8", light: "#b9c8d6", band: "#8196ab", top: "#eaf0f5", snow: "#eef3f7" },
  red: { dark: "#7c4735", mid: "#a8684a", light: "#c48d66", band: "#8f553f", top: "#cba27a" },
};

// (in the game's light, under its sky and fog, leaves and stone show darker than these read on their own: lifted here, once, for every model)
const lift = (set, gain, keys) => { for (const pal of Object.values(set)) for (const k of keys) if (pal[k]) pal[k] = shade(pal[k], gain); };
lift(NEEDLES, 1.24, ["dark", "mid", "light", "alt", "under"]);
lift(LEAVES, 1.16, ["dark", "mid", "light", "alt"]);
lift({ grey: ROCKS.grey }, 1.12, ["dark", "mid", "light", "band", "top", "moss"]);
/// The colour of one triangle of foliage: darker underneath and low in the crown, lighter on top, leaning to the clump's own tint; snow lies on
/// what faces the sky.
function leafColor(pal, rnd, tint, y0, y1) {
  return (n, q) => {
    const up = n[1] * 0.5 + 0.5, high = clamp01((q[1] - y0) / Math.max(y1 - y0, 1e-6));
    if (pal.snow && n[1] > 0.38 + rnd() * 0.2) return jit(mix(pal.snowShade, pal.snow, clamp01((n[1] - 0.4) / 0.4)), rnd, 0.025);
    let c = mix(pal.dark, pal.mid, smoothstep(up * 1.2));
    if (n[1] > 0.3) c = mix(c, pal.light, ((n[1] - 0.3) / 0.7) * 0.85);
    return jit(shade(mix(c, pal.alt, tint), 0.82 + 0.24 * high), rnd, 0.04);
  };
}
/// The colour of one face of bark.
const barkColor = (pal, rnd) => (i, k, n) => jit(mix(pal.bark, pal.barkLight, clamp01(0.5 + n[0] * 0.3 + n[1] * 0.5)), rnd, 0.08);

// ---- conifers ---------------------------------------------------------------------------------------------------------------------------
/// One whorl of boughs: a ragged star of `n` boughs round the trunk at `C`, arching out from the trunk and drooping at the tips, with a dark underside.
function whorl(S, C, R, o) {
  const { n, rise, droop, rnd, pal, glow } = o, rot = rnd() * TAU, out = [], mid = [];
  for (let k = 0; k < 2 * n; k++) {
    const tip = k % 2 === 0, a = rot + (k + (rnd() - 0.5) * 0.55) * (Math.PI / n);
    const rad = R * (tip ? rnd.range(0.84, 1.1) * (rnd() < 0.14 ? 0.72 : 1) : rnd.range(0.5, 0.66)), y = C[1] - droop * R * (tip ? rnd.range(0.8, 1.2) : rnd.range(0.25, 0.45));
    out.push(S.v([C[0] + Math.cos(a) * rad, y, C[2] + Math.sin(a) * rad]));
    if (o.arch) mid.push(S.v([C[0] + Math.cos(a) * rad * 0.5, lerp(C[1] + rise, y, 0.5) + 0.15 * R, C[2] + Math.sin(a) * rad * 0.5]));
  }
  const apex = S.v([C[0], C[1] + rise, C[2]]), under = S.v([C[0], C[1] - droop * R * 0.12, C[2]]);
  const laden = Array.from({ length: 2 * n }, () => rnd() < 0.72), tone = Array.from({ length: 2 * n }, () => rnd.range(0.15, 0.6)); // (by bough: its snow, its own green)
  const top = (loop, outer, bough) => {
    const P = loop.map((i) => S.verts[i]), c = mean(P), want = [c[0] - C[0], R * 1.5, c[2] - C[2]], nrm = S.normal(loop, want);
    let col;
    if (pal.snow && (outer ? laden[bough] : rnd() > 0.06)) col = jit(mix(pal.snowShade, pal.snow, clamp01(nrm[1] * 1.3)), rnd, 0.025);
    else col = jit(shade(mix(mix(pal.dark, pal.mid, outer ? 0.75 : 0.3), outer ? pal.light : pal.alt, outer ? tone[bough] : rnd.range(0, 0.4)), glow), rnd, 0.05);
    S.f(loop, col, want);
  };
  for (let k = 0; k < 2 * n; k++) {
    const k1 = (k + 1) % (2 * n);
    const bough = k % 2 === 0 ? k : k1;
    if (o.arch) { top([apex, mid[k], mid[k1]], false, bough); top([mid[k], out[k], out[k1], mid[k1]], true, bough); } else top([apex, out[k], out[k1]], true, bough);
    S.f([under, out[k1], out[k]], jit(shade(pal.under, glow), rnd, 0.1), [0, -1, 0]);
  }
}

/// A conifer: a tapering trunk with whorls of boughs up it. `shape(t)` is how wide the crown is from its foot (0) to its tip (1).
function conifer(name, T, o) {
  const rnd = rng(seedOf(name) + (o.seed ?? 0)), pal = NEEDLES[o.palette ?? "pine"], H = T.hi[1] * 16, base = T.lo[1] * 16;
  const R = Math.min(-T.lo[0], T.hi[0], -T.lo[2], T.hi[2]) * 16, lean = [rnd.range(-1, 1) * (o.lean ?? 0.02) * H, rnd.range(-1, 1) * (o.lean ?? 0.02) * H];
  const axis = (y) => { const t = clamp01(y / H); return [lean[0] * t * t, y, lean[1] * t * t]; };
  const trunk = new Shape("trunk", pal.bark), boughs = new Shape("boughs", pal.mid), r0 = Math.max(1.7, H * 0.016 + 0.9);
  const y0 = H * (o.bare ?? 0.14), N = o.tiers, pow = o.spacing ?? 1.25, level = (i) => lerp(y0, H * 0.985, 1 - Math.pow(1 - i / (N - 1), pow));
  for (let i = 0; i < N; i++) {
    const y = level(i), frac = (y - y0) / (H - y0), rad = Math.max(R * o.shape(frac) * rnd.range(0.9, 1.08), H * 0.012), big = rad > R * 0.42, c = axis(y), wob = rad * 0.1;
    if (i === N - 1) { // the leader: a thin spire
      const s = H - (o.spire ?? 0.085) * H;
      whorl(boughs, axis(s), Math.max(R * 0.13, 1.6), { n: 4, rise: H - s, droop: 0.5, rnd, pal, glow: 1.06, arch: false });
      continue;
    }
    whorl(boughs, [c[0] + rnd.range(-wob, wob), y, c[2] + rnd.range(-wob, wob)], rad, { n: big ? (o.lobes ?? 7) : 5, rise: Math.max((level(i + 1) - y) * (o.riseK ?? 0.8), rad * 0.4), droop: (o.droop ?? 0.42) * rnd.range(0.85, 1.2), rnd, pal, glow: 0.8 + 0.28 * frac, arch: big });
  }
  // the boughs reach the box the kit tree had; the trunk keeps its own girth
  const reach = boughs.verts.reduce((m, p) => Math.max(m, Math.hypot(p[0], p[2])), 1), k = (R * 1.1) / reach;
  for (const p of boughs.verts) { p[0] *= k; p[2] *= k; }
  const stem = (y) => { const p = axis(y); return [p[0] * k, p[1], p[2] * k]; };
  tube(trunk, [[0, base, 0], [0, 1.5, 0], stem(H * 0.4), stem(H * 0.93)], [r0 * 1.45, r0, r0 * 0.6, r0 * 0.12], 6, barkColor(pal, rnd), { shape: (kk, i) => (i === 0 ? 1 + 0.25 * Math.sin(kk * 2.4 + o.tiers) : 1) });
  return [trunk, boughs];
}
const spire = (t) => 0.1 + 0.9 * Math.pow(1 - t, 0.85); // a spruce: widest at the foot, a straight taper
const fir = (t) => 0.08 + 0.92 * Math.pow(1 - t, 0.62) * (0.72 + 0.28 * smoothstep(t / 0.18)); // fuller, rounded in at the foot
const round = (t) => (t < 0.3 ? lerp(0.62, 1, smoothstep(t / 0.3)) : 0.06 + 0.94 * Math.pow(Math.cos(((t - 0.3) / 0.7) * (Math.PI / 2)), 0.8)); // a broad crown, widest a third of the way up

// ---- broadleaf trees --------------------------------------------------------------------------------------------------------------------
/// A broadleaf tree: a trunk that forks into limbs, each limb carrying a lumpy mass of leaves, with more masses overlapping round and above them.
function broadleaf(name, T, o) {
  const rnd = rng(seedOf(o.like ?? name) + (o.seed ?? 0)), pal = LEAVES[o.palette ?? "green"], H = T.hi[1] * 16, base = T.lo[1] * 16;
  const rx = ((T.hi[0] - T.lo[0]) / 2) * 16, rz = ((T.hi[2] - T.lo[2]) / 2) * 16, off = [((T.hi[0] + T.lo[0]) / 2) * 16 * 0.8, ((T.hi[2] + T.lo[2]) / 2) * 16 * 0.8];
  const foot = H * (o.trunk ?? 0.34), ry = (H - foot) / 2, yc = foot + ry, r0 = (o.girth ?? 1) * (H * 0.018 + 1.1);
  const wood = new Shape("trunk", pal.bark), crown = new Shape("crown", pal.mid), bark = barkColor(pal, rnd);
  const marks = pal.barkMark ? (i, k, n) => (rnd() < 0.13 ? jit(pal.barkMark, rnd, 0.1) : bark(i, k, n)) : bark;
  // the masses of leaves: the big one in the middle, lower ones on the limbs round it, higher ones between them, one on top
  const lobes = [], k = o.lobes ?? 6, fill = o.fill ?? 1, col = o.columnar;
  const main = { c: [off[0], yc + ry * (col ? 0 : 0.1), off[1]], r: [rx * (col ? 0.74 : 0.7), ry * (col ? 0.96 : 0.78), rz * (col ? 0.74 : 0.7)], base: "icosa" };
  lobes.push(main);
  for (let j = 0; j < k; j++) {
    const a = (j / k) * TAU + rnd.range(-0.3, 0.3), lowish = j % 2 === 0, e = col ? lerp(-0.75, 0.7, (j + 0.5) / k) : lowish ? rnd.range(-0.52, -0.25) : rnd.range(0, 0.45);
    const reach = (col ? 0.3 : lowish ? 0.54 : 0.44) * rnd.range(0.85, 1.1), s = (col ? 0.52 : lowish ? 0.52 : 0.5) * rnd.range(0.85, 1.15) * fill;
    lobes.push({ c: [off[0] + Math.cos(a) * rx * reach, yc + e * ry, off[1] + Math.sin(a) * rz * reach], r: [rx * s, ry * s * (col ? 0.7 : 0.8), rz * s], limb: lowish || col });
  }
  if (!col) lobes.push({ c: [off[0] + rnd.range(-0.15, 0.15) * rx, yc + ry * 0.6, off[1] + rnd.range(-0.15, 0.15) * rz], r: [rx * 0.45 * fill, ry * 0.42, rz * 0.45 * fill] });
  // the trunk, bending a little, up into the main mass; limbs from the fork out into the low masses
  const fork = [off[0] * 0.45 + rnd.range(-1, 1) * r0 * 0.5, foot * (o.fork ?? 0.82), off[1] * 0.45 + rnd.range(-1, 1) * r0 * 0.5], topAt = [main.c[0], yc + ry * (o.bare ? 0.75 : 0.25), main.c[2]];
  tube(wood, [[0, base, 0], [0, 1.2, 0], [fork[0] * 0.5 + rnd.range(-1, 1) * r0 * 0.4, fork[1] * 0.5, fork[2] * 0.5 + rnd.range(-1, 1) * r0 * 0.4], fork, topAt], [r0 * 1.5, r0, r0 * 0.84, r0 * 0.72, r0 * 0.12], 6, marks, { shape: (kk, i) => (i === 0 ? 1 + 0.3 * Math.sin(kk * 2.1 + k) : 1) });
  for (const l of lobes) if (l.limb) {
    const start = [lerp(fork[0], topAt[0], 0.12), lerp(fork[1], topAt[1], col ? rnd.range(0, 0.6) : 0.12), lerp(fork[2], topAt[2], 0.12)], end = [lerp(start[0], l.c[0], 0.8), l.c[1] - l.r[1] * 0.1, lerp(start[2], l.c[2], 0.8)];
    tube(wood, [start, [lerp(start[0], end[0], 0.55), lerp(start[1], end[1], 0.4), lerp(start[2], end[2], 0.55)], end], [r0 * 0.5, r0 * 0.36, r0 * 0.1], 4, bark);
  }
  // (each mass is fuller above than below: leaves hang as a dome over their limb)
  const dome = col ? undefined : (p) => [p[0], p[1] < 0 ? p[1] * 0.62 : p[1], p[2]];
  for (const l of lobes) blob(crown, { c: l.c, r: l.r, rnd, base: l.base ?? "octa", level: 1, lump: o.lump ?? 0.26, freq: 2.1, warp: dome, color: leafColor(pal, rnd, rnd.range(0, 0.45), foot, H) });
  return [wood, crown];
}

/// A dead tree: a bare trunk with crooked branches that fork.
function deadTree(name, T, o) {
  const rnd = rng(seedOf(name)), H = T.hi[1] * 16, base = T.lo[1] * 16, pal = { bark: "#6b5f50", barkLight: "#93856f" }, wood = new Shape("wood", pal.bark), bark = barkColor(pal, rnd);
  const rx = Math.min(-T.lo[0], T.hi[0]) * 16, rz = Math.min(-T.lo[2], T.hi[2]) * 16, r0 = H * 0.017 + 1.2, bend = () => rnd.range(-1, 1) * r0 * 0.9;
  const spine = [[0, base, 0], [0, 1.2, 0], [bend(), H * 0.3, bend()], [bend() * 1.5, H * 0.58, bend() * 1.5], [bend() * 2, H * 0.82, bend() * 2], [bend() * 2.5, H, bend() * 2.5]];
  tube(wood, spine, [r0 * 1.5, r0, r0 * 0.8, r0 * 0.58, r0 * 0.34, 0], 5, bark, { shape: (k, i) => (i === 0 ? 1 + 0.3 * Math.sin(k * 2.3) : 1) });
  const at = (t) => { const f = t * (spine.length - 3) + 2, i = Math.min(spine.length - 2, Math.floor(f)), u = f - i; return [0, 1, 2].map((a) => lerp(spine[i][a], spine[i + 1][a], u)); };
  const branch = (from, a, len, r, depth) => {
    const dir = [Math.cos(a), rnd.range(0.35, 0.8), Math.sin(a)], midp = add(from, [dir[0] * len * 0.5 * rx, dir[1] * len * 0.35 * rx, dir[2] * len * 0.5 * rz]);
    const end = add(from, [dir[0] * len * rx, (dir[1] + 0.5) * len * rx * 0.75, dir[2] * len * rz]);
    tube(wood, [from, midp, end], [r, r * 0.62, 0], depth ? 3 : 4, bark);
    if (depth < o.forks) branch(midp, a + rnd.pick([-1, 1]) * rnd.range(0.6, 1.1), len * 0.55, r * 0.55, depth + 1);
  };
  for (let j = 0; j < o.branches; j++) { const t = lerp(0.18, 0.86, (j + rnd.range(0.2, 0.8)) / o.branches); branch(at(t), (j * 2.4 + rnd.range(-0.4, 0.4)) % TAU, lerp(1.5, 0.7, t) * rnd.range(0.85, 1.05), r0 * lerp(0.5, 0.26, t), 0); }
  return [wood];
}

// ---- bushes, grass, flowers -------------------------------------------------------------------------------------------------------------
/// A bush: a few leafy mounds grown into each other, on the ground.
function bush(name, T, o) {
  const rnd = rng(seedOf(o.like ?? name)), pal = LEAVES[o.palette ?? "bush"], S = new Shape("leaves", pal.mid), h = T.hi[1] * 16, base = T.lo[1] * 16, rx = ((T.hi[0] - T.lo[0]) / 2) * 16, rz = ((T.hi[2] - T.lo[2]) / 2) * 16;
  const cx = ((T.hi[0] + T.lo[0]) / 2) * 16, cz = ((T.hi[2] + T.lo[2]) / 2) * 16;
  for (let j = 0; j < o.mounds; j++) {
    const first = j === 0, a = (j / Math.max(1, o.mounds - 1)) * TAU + rnd.range(-0.4, 0.4), reach = first ? 0 : rnd.range(0.42, 0.6), s = first ? 0.62 : rnd.range(0.4, 0.55), top = first ? 1 : rnd.range(0.5, 0.85);
    blob(S, { c: [cx + Math.cos(a) * rx * reach, h * top * 0.4, cz + Math.sin(a) * rz * reach], r: [rx * s, h * top * 0.62, rz * s], rnd, lump: 0.3, freq: 2.2, floor: base, drop: true, color: leafColor(pal, rnd, rnd.range(0, 0.5), 0, h) });
  }
  return [S];
}
/// A dry desert bush: bare straw-coloured twigs fanning up and out from one root, over a low heart of dead stems.
function dryBush(name, T) {
  const rnd = rng(seedOf(name)), S = new Shape("twigs", "#a39468"), h = T.hi[1] * 16, rx = T.hi[0] * 16, rz = T.hi[2] * 16;
  blob(S, { c: [0, h * 0.08, 0], r: [rx * 0.42, h * 0.3, rz * 0.42], rnd, base: "octa", level: 0, lump: 0.2, floor: 0, drop: true, color: () => jit("#7b6c49", rnd, 0.08), smooth: false });
  for (let j = 0; j < 15; j++) {
    const a = j * 2.4 + rnd.range(-0.3, 0.3), up = j < 5 ? rnd.range(0.85, 1) : rnd.range(0.4, 0.8), out = j < 5 ? rnd.range(0.2, 0.5) : rnd.range(0.7, 1);
    tube(S, [[Math.cos(a) * rx * 0.1, 0, Math.sin(a) * rz * 0.1], [Math.cos(a) * rx * out, h * up, Math.sin(a) * rz * out]], [0.62, 0], 3, () => jit(mix("#85754e", "#c0b081", rnd()), rnd, 0.06), { smooth: false });
  }
  return [S];
}
/// A tuft of grass: a few bent three-sided blades (they show from every side, with no faces back to back).
function grass(name, T) {
  const rnd = rng(seedOf(name)), S = new Shape("blades", "#93aa62"), h = T.hi[1] * 16, r = T.hi[0] * 16;
  for (let j = 0; j < 7; j++) {
    const bent = j < 4, a = (j / 7) * TAU + rnd.range(-0.3, 0.3), tall = (bent ? rnd.range(0.75, 1) : rnd.range(0.4, 0.62)) * h, lean = rnd.range(0.7, 1) * r * 1.3, from = [Math.cos(a) * r * 0.22, 0, Math.sin(a) * r * 0.22];
    const tip = [Math.cos(a) * lean, tall, Math.sin(a) * lean], col = (i) => jit(i === 0 && bent ? "#71894a" : mix("#93aa62", "#bcc983", rnd()), rnd, 0.06);
    if (bent) tube(S, [from, [lerp(from[0], tip[0], 0.3), tall * 0.55, lerp(from[2], tip[2], 0.3)], tip], [0.34, 0.26, 0], 3, col, { smooth: false });
    else tube(S, [from, tip], [0.32, 0], 3, col, { smooth: false });
  }
  return [S];
}
/// A few wild flowers: thin stems with a small five-sided head each, and a couple of leaves.
function flowers(name, T) {
  const rnd = rng(seedOf(name)), S = new Shape("flowers", "#6f8a4c"), h = T.hi[1] * 16, r = T.hi[0] * 16, heads = ["#e9e6d8", "#d9bd55", "#c98a9a"];
  for (let j = 0; j < 3; j++) {
    const a = (j / 3) * TAU + rnd.range(-0.3, 0.3), tall = rnd.range(0.7, 0.96) * h, at = [Math.cos(a) * r * 0.55, tall, Math.sin(a) * r * 0.55], tilt = [Math.cos(a) * 0.35, 1, Math.sin(a) * 0.35], hr = r * 0.42;
    tube(S, [[Math.cos(a) * r * 0.15, 0, Math.sin(a) * r * 0.15], at], [0.2, 0.12], 3, () => jit("#647f45", rnd, 0.08), { smooth: false });
    const u = unit(cross(tilt, [0, 0, 1])), w = unit(cross(tilt, u)), ring = [];
    for (let k = 0; k < 5; k++) { const b = (k / 5) * TAU; ring.push(S.v(add(add(at, mul(unit(tilt), 0.25)), add(mul(u, Math.cos(b) * hr), mul(w, Math.sin(b) * hr))))); }
    const eye = S.v(add(at, mul(unit(tilt), 0.55))), neck = S.v(add(at, mul(unit(tilt), -0.5)));
    for (let k = 0; k < 5; k++) { S.f([eye, ring[k], ring[(k + 1) % 5]], jit(k % 2 ? heads[j] : shade(heads[j], 0.93), rnd, 0.03), tilt); S.f([neck, ring[(k + 1) % 5], ring[k]], jit(shade(heads[j], 0.7), rnd, 0.04), mul(tilt, -1)); }
  }
  for (let j = 0; j < 3; j++) { const a = (j / 3) * TAU + 1 + rnd.range(-0.3, 0.3); tube(S, [[Math.cos(a) * r * 0.2, 0, Math.sin(a) * r * 0.2], [Math.cos(a) * r * 0.9, h * rnd.range(0.3, 0.45), Math.sin(a) * r * 0.9]], [0.34, 0], 3, () => jit("#7d9655", rnd, 0.08), { smooth: false }); }
  return [S];
}

// ---- cacti ------------------------------------------------------------------------------------------------------------------------------
/// A ribbed cactus column along `pts` (rounded over at its end): `ribs` ridges with dark grooves between them.
function column(S, pts, r, ribs, rnd, glow = 1) {
  const n = pts.length, last = pts[n - 1], dir = unit(sub(last, pts[n - 2])), line = [...pts.slice(0, n - 1), add(last, mul(dir, -r * 0.75)), add(last, mul(dir, -r * 0.22)), last];
  const radii = [...pts.slice(0, n - 1).map((_, i) => r * (i === 0 ? 0.9 : 1)), r * 0.98, r * 0.62, 0];
  tube(S, line, radii, ribs * 2, (i, k, nrm) => jit(shade(mix("#4b6648", "#7e9769", clamp01(0.4 + nrm[1] * 0.5 + (i >= n - 1 ? 0.25 : 0) + (k % 2 ? 0.12 : -0.12))), glow), rnd, 0.05), { shape: (k) => (k % 2 ? 0.74 : 1), smooth: false });
}
/// A saguaro: a ribbed column with arms that leave it sideways and turn up. `arms`: [side angle in degrees, height share where it leaves, how far out
/// (metres), top share].
function cactus(name, T, o) {
  const rnd = rng(seedOf(name)), S = new Shape("cactus", "#5d7a4a"), H = T.hi[1] * 16, base = T.lo[1] * 16, r = o.r * 16;
  column(S, [[0, base, 0], [0, H, 0]], r, o.ribs ?? 5, rnd);
  for (const [deg, leave, reach, top] of o.arms) {
    const a = (deg * Math.PI) / 180, d = [Math.cos(a), 0, Math.sin(a)], ar = r * 0.68, y = H * leave, out = reach * 16;
    const up = add([0, H * top, 0], mul(d, out)), elbow = out - r > ar * 1.6 ? [add([0, y + ar * 0.45, 0], mul(d, out * 0.78)), add([0, y + ar * 1.8, 0], mul(d, out))] : [add([0, y + ar * 0.9, 0], mul(d, out))];
    column(S, [add([0, y, 0], mul(d, r * 0.4)), ...elbow, up], ar, 3, rnd, 0.96);
  }
  return [S];
}

// ---- rocks ------------------------------------------------------------------------------------------------------------------------------
/// A boulder or a group of them: blocky masses split along flat facets, in beds of strata that dip to one side (each bed stands a little proud of
/// or behind the next, and has its own tone), with a lighter weathered top (moss in the forest, snow on the ice rocks) and their feet in the ground.
function rock(name, T, o) {
  const rnd = rng(seedOf(o.like ?? name)), tones = rng(seedOf(name) + 7), pal = ROCKS[o.palette ?? "grey"], S = new Shape("rock", pal.mid), h = T.hi[1] * 16, base = T.lo[1] * 16;
  const rx = ((T.hi[0] - T.lo[0]) / 2) * 16, rz = ((T.hi[2] - T.lo[2]) / 2) * 16;
  for (const [x, z, s, tall, big] of o.parts) {
    const hh = h * tall, dip = [rnd.range(-0.3, 0.3), rnd.range(-0.3, 0.3)], beds = big ? (o.stand ? 2.6 : 1.8) : 1.6, shift = rnd();
    const facets = [{ n: unit([rnd.range(-0.3, 0.3), 1, rnd.range(-0.3, 0.3)]), h: rnd.range(0.6, 0.72) }, ...Array.from({ length: big ? 6 : 4 }, () => ({ n: unit([rnd.range(-1, 1), rnd.range(-0.2, 0.5), rnd.range(-1, 1)]), h: rnd.range(0.6, 0.85) }))];
    const bed = (p) => (p[1] + dip[0] * p[0] + dip[1] * p[2]) * beds + shift;
    const warp = (p) => {
      const q = p.map((v) => Math.sign(v) * Math.pow(Math.abs(v), 0.55)); // (blockier than a ball)
      if (o.stand && q[1] > 0) { q[0] *= 1 - 0.14 * q[1]; q[2] *= 1 - 0.14 * q[1]; }
      const b = bed(q);
      q[1] += ((Math.round(b) - b) / beds) * 0.78; // its points drawn onto the bedding planes: ledges and walls
      return q;
    };
    const color = (n, q, local) => {
      const layer = Math.floor(bed(local) + 0.2), up = n[1];
      let c = mix(pal.dark, pal.mid, clamp01(0.5 + up * 0.7));
      if ((layer & 1) === 0) c = mix(c, pal.band, 0.85);
      if (((layer % 3) + 3) % 3 === 0) c = mix(c, pal.light, 0.5);
      if (up > 0.5) c = mix(c, pal.snow ? pal.snow : pal.moss && tones() < 0.4 ? pal.moss : pal.top, pal.snow ? 0.94 : 0.35 + clamp01((up - 0.5) / 0.3) * 0.4);
      return jit(shade(c, 0.88 + 0.18 * clamp01(q[1] / h)), tones, 0.045);
    };
    blob(S, { c: [x * rx, o.stand ? hh * 0.4 : hh * 0.3, z * rz], r: [rx * s, o.stand ? hh * 0.64 : hh * 0.74, rz * s], rnd, base: big ? "icosa" : "octa", level: 1, lump: 0.12, freq: 1.3, planes: facets, warp, floor: base, drop: true, color, smooth: false });
  }
  return [S];
}

/// A mesa: a flat-topped rock with sheer walls in bands of hard and soft beds, standing out in buttresses and cut back in alcoves, under a dark cap
/// rock that has fallen away at one end, on a skirt of fallen rock that climbs higher in the alcoves.
function mesa(name, T) {
  const rnd = rng(seedOf(name)), S = new Shape("mesa", "#a8623f"), H = T.hi[1] * 16, rx = T.hi[0] * 16, rz = T.hi[2] * 16, sides = 32, ph = [rnd() * TAU, rnd() * TAU, rnd() * TAU];
  const plan = (a) => 1 + 0.11 * Math.cos(2 * a + ph[0]) + 0.1 * Math.cos(3 * a + ph[1]) + 0.05 * Math.cos(5 * a + ph[2]);
  const stand = Array.from({ length: sides }, () => rnd.range(-0.05, 0.05)); // each buttress stands out or back, all the way up
  const fallen = (a) => 1 - 0.24 * smoothstep((Math.cos(a - ph[1]) - 0.45) / 0.3);
  const scree = (a) => 1 + 0.3 * Math.cos(3 * a + ph[1] + 3.1);
  // rings from the foot up: [share of the footprint, share of the height, how much the buttresses show, the colour of the band below it]
  const rings = [[1, 0, 0, null], [0.88, 0.12, 0.25, "#b89872"], [0.77, 0.27, 0.6, "#a5835f"], [0.72, 0.31, 1, "#8c5139"], [0.705, 0.48, 1, "#a66444"], [0.68, 0.51, 1, "#bf9069"], [0.67, 0.67, 1, "#b06d4b"],
    [0.64, 0.7, 1, "#93563b"], [0.63, 0.885, 1, "#b87854"], [0.655, 0.915, 1, "#874c35"], [0.645, 0.985, 1, "#9c5b3d"], [0.57, 1, 0.8, "#c19a72"]];
  const idx = rings.map(([share, y, show], j) => Array.from({ length: sides }, (_, k) => {
    const a = (k / sides) * TAU, rr = share * plan(a) * (1 + show * stand[k]), yy = j === 0 ? 0 : j < 3 ? y * scree(a) : 0.31 * (1 + (scree(a) - 1) * 0.35) + (y - 0.31) * fallen(a);
    return S.v([Math.cos(a) * rr * rx, yy * H, Math.sin(a) * rr * rz]);
  }));
  for (let j = 0; j < rings.length - 1; j++) for (let k = 0; k < sides; k++) {
    const k1 = (k + 1) % sides, loop = [idx[j][k], idx[j][k1], idx[j + 1][k1], idx[j + 1][k]], c = mean(loop.map((i) => S.verts[i])), want = [c[0], H * 0.3, c[2]], n = S.normal(loop, want);
    const out = clamp01(0.5 + 0.9 * ((n[0] * c[0]) / rx + (n[2] * c[2]) / rz)); // (faces turned into a gully are darker)
    S.f(loop, jit(shade(rings[j + 1][3], 0.8 + 0.24 * out), rnd, 0.05), want);
  }
  const top = idx[rings.length - 1], cap = S.v(mean(top.map((i) => S.verts[i])));
  for (let k = 0; k < sides; k++) S.f([cap, top[k], top[(k + 1) % sides]], jit("#c39c74", rnd, 0.02), [0, 1, 0], true);
  return [S];
}

/// A mountain for the far distance: a main peak with shoulders, sharp ridges running down between gullies, scree at its foot and (where the range
/// has it) snow on what is high and not too steep.
function mountain(name, T, o) {
  const rnd = rng(seedOf("mountain") + (o.seed ?? 0)), S = new Shape("mountain", o.rock), H = T.hi[1] * 16, rx = T.hi[0] * 16, rz = T.hi[2] * 16, sectors = 36, rings = 15;
  const peaks = [{ x: 0, z: 0, h: 1, r: 1.05 }, ...Array.from({ length: 3 }, (_, i) => { const a = i * 2.2 + rnd.range(0, 1), d = rnd.range(0.34, 0.52); return { x: Math.cos(a) * d, z: Math.sin(a) * d, h: rnd.range(0.5, 0.78), r: rnd.range(0.55, 0.7) }; })];
  for (const p of peaks) p.ridges = Array.from({ length: 6 }, (_, i) => ({ a: (i / 6) * TAU + rnd.range(-0.3, 0.3), w: rnd.range(0.13, 0.24), k: rnd.range(0.6, 1) }));
  const rough = field(rnd, 5, 4);
  const height = (x, z) => {
    let best = 0;
    for (const p of peaks) {
      const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz), a = Math.atan2(dz, dx);
      let ridge = 0;
      for (const g of p.ridges) { let da = Math.abs(a - g.a) % TAU; if (da > Math.PI) da = TAU - da; ridge = Math.max(ridge, g.k * Math.exp(-(da * da) / (g.w * g.w))); }
      const steep = 1.3 - 0.52 * ridge * smoothstep(d / (p.r * 0.2)), v = p.h * Math.pow(Math.max(0, 1 - (d * steep) / p.r), 0.95);
      best = Math.max(best, v);
    }
    const edge = Math.hypot(x, z);
    return Math.max(0, best * (1 + 0.1 * rough([x, 0, z]))) * (1 - Math.pow(clamp01(edge), 6));
  };
  const top = S.v([0, H, 0]), grid = [];
  for (let j = 1; j <= rings; j++) {
    const row = [], rho = Math.pow(j / rings, 0.85);
    for (let k = 0; k < sectors; k++) {
      const a = ((k + (j % 2) * 0.5 + (j < rings ? rnd.range(-0.18, 0.18) : 0)) / sectors) * TAU, rr = j === rings ? 1 : rho * rnd.range(0.96, 1.04), x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      row.push(S.v([x * rx, j === rings ? 0 : height(x, z) * H, z * rz]));
    }
    grid.push(row);
  }
  const snowNoise = field(rnd, 3, 3);
  const face = (loop) => {
    const P = loop.map((i) => S.verts[i]), c = mean(P), n = S.normal(loop, [c[0] / rx, 2, c[2] / rz]), alt = c[1] / H, wob = 0.07 * snowNoise([c[0] / rx, alt, c[2] / rz]);
    let col = mix(o.dark, o.rock, clamp01(n[1] * 1.5 - 0.1));
    if (alt < 0.3) col = mix(o.foot, col, smoothstep(alt / 0.3) * 0.8);
    if (o.snow && alt + wob > o.line && n[1] > 0.42) col = mix(o.snowShade, o.snow, clamp01((n[1] - 0.42) / 0.3));
    else if (o.snow && alt + wob > o.line - 0.14 && n[1] > 0.6) col = mix(col, o.snow, 0.45);
    S.f(loop, jit(col, rnd, 0.045), [c[0] / rx, 2, c[2] / rz]);
  };
  for (let k = 0; k < sectors; k++) face([top, grid[0][k], grid[0][(k + 1) % sectors]]);
  for (let j = 0; j < rings - 1; j++) for (let k = 0; k < sectors; k++) {
    const k1 = (k + 1) % sectors, a = grid[j][k], b = grid[j][k1], c = grid[j + 1][k], d = grid[j + 1][k1];
    if (j % 2 === 0) { face([a, b, d]); face([a, d, c]); } else { face([a, b, c]); face([b, d, c]); }
  }
  return [S];
}

/// A cloud: soft heaps run together, flat and grey underneath.
function cloud(name, T) {
  const rnd = rng(seedOf(name)), S = new Shape("cloud", "#f3f5f7"), h = T.hi[1] * 16, rx = ((T.hi[0] - T.lo[0]) / 2) * 16, rz = T.hi[2] * 16, flat = h * 0.16;
  const color = (n, q) => jit(mix("#b9c3cf", "#f6f8fa", clamp01(0.42 + n[1] * 0.7 + (q[1] / h) * 0.25)), rnd, 0.015);
  const heaps = [[-0.62, 0, 0.36, 0.55], [-0.28, 0.25, 0.42, 0.78], [0.08, -0.15, 0.5, 1], [0.42, 0.2, 0.4, 0.7], [0.7, -0.1, 0.3, 0.48], [0.1, 0.5, 0.3, 0.5]];
  for (const [x, z, s, tall] of heaps) blob(S, { c: [x * rx, flat + h * tall * 0.36, z * rz], r: [rx * s, h * tall * 0.56, rz * s * 1.35], rnd, lump: 0.16, freq: 1.6, floor: flat * rnd.range(0.4, 1), color });
  return [S];
}

// ---- fallen wood ------------------------------------------------------------------------------------------------------------------------
const WOOD = { bark: "#4c3d2f", barkLight: "#67543f", cut: "#b3966b", heart: "#8c7150", moss: "#5c6a42" };
/// The sawn end of a log or a stump's top: a ring of bark, pale wood and a darker heart. `ring` is the outer points, `c` the middle, `want` where it faces.
function sawn(S, ring, c, want, rnd) {
  const n = ring.length, inner = (share) => ring.map((i) => S.v([0, 1, 2].map((a) => lerp(c[a], S.verts[i][a], share) + want[a] * (1 - share) * 0.3)));
  const a = inner(0.86), b = inner(0.4), mid = S.v(add(c, mul(want, 0.25)));
  for (let k = 0; k < n; k++) {
    const k1 = (k + 1) % n;
    S.f([ring[k], ring[k1], a[k1], a[k]], jit(WOOD.bark, rnd, 0.08), want);
    S.f([a[k], a[k1], b[k1], b[k]], jit(WOOD.cut, rnd, 0.05), want);
    S.f([b[k], b[k1], mid], jit(WOOD.heart, rnd, 0.05), want);
  }
}
/// A fallen log lying along z, half sunk, with sawn ends, a broken branch stub and moss along its top.
function log(name, T) {
  const rnd = rng(seedOf(name)), S = new Shape("log", WOOD.bark), r = ((T.hi[1] - T.lo[1]) / 2) * 16, cy = ((T.hi[1] + T.lo[1]) / 2) * 16, z0 = T.lo[2] * 16, z1 = T.hi[2] * 16;
  const line = [[0, cy, z0], [r * 0.08, cy, lerp(z0, z1, 0.35)], [-r * 0.06, cy, lerp(z0, z1, 0.7)], [0, cy, z1]], bark = barkColor(WOOD, rnd);
  const rings = tube(S, line, [r, r * 0.96, r * 0.9, r * 0.84], 8, (i, k, n) => (n[1] > 0.55 && rnd() < 0.6 ? jit(WOOD.moss, rnd, 0.08) : bark(i, k, n)), { shape: (k, i) => 1 + 0.07 * Math.sin(k * 1.9 + i * 1.3) });
  sawn(S, rings[0], line[0], [0, 0, -1], rnd);
  sawn(S, rings[3], line[3], [0, 0, 1], rnd);
  const at = [0, cy, lerp(z0, z1, 0.42)];
  tube(S, [add(at, [r * 0.5, r * 0.5, 0]), add(at, [r * 1.05, r * 1.25, r * 0.3])], [r * 0.3, r * 0.2], 4, bark, { capEnd: WOOD.cut });
  return [S];
}
/// A tree stump: roots spreading into the ground, rough bark, a sawn top.
function stump(name, T) {
  const rnd = rng(seedOf(name)), S = new Shape("stump", WOOD.bark), h = T.hi[1] * 16, base = T.lo[1] * 16, r = Math.min(-T.lo[0], T.hi[0], -T.lo[2], T.hi[2]) * 16, bark = barkColor(WOOD, rnd);
  const roots = (k) => 1 + 0.42 * Math.max(0, Math.sin(k * 2.36 + 0.4)) ** 2;
  const rings = tube(S, [[0, base, 0], [0, h * 0.18, 0], [0, h * 0.62, 0], [r * 0.03, h * 0.97, 0]], [r * 0.82, r * 0.66, r * 0.56, r * 0.55], 8, (i, k, n) => (i === 0 && rnd() < 0.3 ? jit(WOOD.moss, rnd, 0.08) : bark(i, k, n)), { shape: (k, i) => (i === 0 ? roots(k) : i === 1 ? 1 + 0.35 * (roots(k) - 1) : 1 + 0.05 * Math.sin(k * 2.7)) });
  sawn(S, rings[3], [r * 0.03, h * 0.97, 0], [0, 1, 0], rnd);
  return [S];
}

// ---- the models -------------------------------------------------------------------------------------------------------------------------
const MOUNTAINS = {
  mountain: { rock: "#77797a", dark: "#4f5356", foot: "#5d6652", snow: "#eef2f6", snowShade: "#c3cfdb", line: 0.6 },
  mountain_ice: { rock: "#8fa0b0", dark: "#66788b", foot: "#c9d6e1", snow: "#f3f6f9", snowShade: "#c8d5e2", line: 0.3, seed: 1 },
  mountain_night: { rock: "#4a566b", dark: "#313b4e", foot: "#3a4558", snow: "#93a1b8", snowShade: "#74839b", line: 0.62, seed: 2 },
  mountain_red: { rock: "#b0714f", dark: "#864f3a", foot: "#c59a72", seed: 3 },
};
// the pines of a wood: [kind, tiers, bare trunk, droop, extra]
const tall = (tiers, o = {}) => ({ shape: spire, tiers, bare: 0.17, droop: 0.5, spacing: 1.2, lobes: 6, ...o });
const wide = (tiers, o = {}) => ({ shape: round, tiers, bare: 0.13, droop: 0.36, spacing: 1.3, lobes: 7, riseK: 0.95, ...o });
const small = (tiers, o = {}) => ({ shape: fir, tiers, bare: 0.08, droop: 0.4, spacing: 1.25, lobes: 6, ...o });
const PINES = {
  pinetall_a: tall(8), pinetall_b: tall(9, { bare: 0.24, droop: 0.58 }), pinetall_c: tall(7, { bare: 0.12, droop: 0.42, shape: fir }), pinetall_d: tall(9, { bare: 0.2, shape: fir, droop: 0.5 }),
  pineround_a: wide(6), pineround_c: wide(6, { bare: 0.2, droop: 0.3 }), pineround_e: wide(7, { bare: 0.1, droop: 0.42 }),
  pinesmall_a: small(5), pinesmall_c: small(6, { bare: 0.14, shape: spire }),
};
const ROCK_PARTS = {
  // [x, z (shares of the half box), size, height, the big one]
  largeA: { parts: [[-0.1, -0.15, 0.82, 1, true], [0.45, 0.5, 0.48, 0.62, false], [-0.5, 0.55, 0.36, 0.45, false]] },
  largeC: { parts: [[0.1, 0.05, 0.86, 1, true], [-0.55, -0.4, 0.4, 0.6, false]] },
  largeE: { parts: [[-0.25, 0, 0.7, 1, true], [0.48, -0.2, 0.5, 0.75, false], [0.3, 0.55, 0.34, 0.5, false]] },
  tallB: { stand: true, parts: [[0, 0, 0.84, 1, true], [0.5, 0.45, 0.42, 0.42, false], [-0.5, -0.4, 0.36, 0.3, false]] },
  tallF: { stand: true, parts: [[-0.1, 0.1, 0.8, 1, true], [0.5, -0.45, 0.42, 0.5, false]] },
  tallH: { stand: true, parts: [[0.15, -0.1, 0.72, 1, true], [-0.45, 0.3, 0.5, 0.66, false], [0.3, 0.6, 0.32, 0.3, false]] },
};
const ROCK = { stand: true, parts: [[-0.12, -0.08, 0.8, 1, true], [0.52, 0.42, 0.44, 0.55, false], [-0.45, 0.55, 0.34, 0.4, false]] };

export const MODELS = {};
const def = (name, make) => { if (!BEFORE[name]) throw new Error(`no size recorded for ${name}`); MODELS[name] = (T = BEFORE[name]) => make(name, T); };
for (const [kind, spec] of Object.entries(PINES)) {
  def(`nk_${kind}`, (n, T) => conifer(n, T, { ...spec, like: kind }));
  for (const [prefix, palette] of [["snow", "snow"], ["night", "night"]]) if (BEFORE[`nk_${prefix}_${kind}`]) def(`nk_${prefix}_${kind}`, (n, T) => conifer(`nk_${kind}`, T, { ...spec, palette, droop: spec.droop * (palette === "snow" ? 1.25 : 1) }));
}
def("pine", (n, T) => conifer(n, T, { shape: fir, tiers: 7, bare: 0.12, droop: 0.42 }));
def("pine_dark", (n, T) => conifer(n, T, { shape: spire, tiers: 7, bare: 0.16, droop: 0.5, palette: "dark" }));
def("pine_snow", (n, T) => conifer(n, T, { shape: fir, tiers: 7, bare: 0.1, droop: 0.55, palette: "snow" }));
def("nk_default", (n, T) => broadleaf(n, T, { trunk: 0.36, lobes: 5 }));
def("nk_default_fall", (n, T) => broadleaf(n, T, { like: "nk_default", trunk: 0.36, lobes: 5, palette: "fall", fill: 0.9 }));
def("nk_fat", (n, T) => broadleaf(n, T, { trunk: 0.3, lobes: 6, girth: 1.25, palette: "oak" }));
def("nk_tall", (n, T) => broadleaf(n, T, { trunk: 0.22, lobes: 5, columnar: true, girth: 0.9 }));
def("nk_tall_fall", (n, T) => broadleaf(n, T, { like: "nk_tall", trunk: 0.22, lobes: 5, columnar: true, girth: 0.9, palette: "fallGold", fill: 0.92 }));
def("nk_thin", (n, T) => broadleaf(n, T, { trunk: 0.44, lobes: 4, girth: 0.8, fill: 0.9 }));
def("nk_oak", (n, T) => broadleaf(n, T, { trunk: 0.3, lobes: 6, girth: 1.35, palette: "oak", fork: 0.7 }));
def("nk_oak_fall", (n, T) => broadleaf(n, T, { like: "nk_oak", trunk: 0.3, lobes: 6, girth: 1.35, palette: "fall", fork: 0.7, fill: 0.92 }));
def("birch", (n, T) => broadleaf(n, T, { trunk: 0.4, lobes: 5, girth: 0.7, palette: "birch", fill: 0.88, bare: true, lump: 0.24 }));
def("autumn_tree", (n, T) => broadleaf(n, T, { trunk: 0.36, lobes: 6, girth: 0.95, palette: "fall", lump: 0.22 }));
def("nk_dead_tall", (n, T) => deadTree(n, T, { branches: 5, forks: 1 }));
def("nk_dead_thin", (n, T) => deadTree(n, T, { branches: 7, forks: 2 }));
def("bush", (n, T) => bush(n, T, { mounds: 5 }));
def("bush_snow", (n, T) => bush(n, T, { like: "bush", mounds: 5, palette: "bushSnow" }));
def("nk_bush_detailed", (n, T) => bush(n, T, { mounds: 5 }));
def("nk_bush_large", (n, T) => bush(n, T, { mounds: 4 }));
def("nk_bush_tri", (n, T) => bush(n, T, { mounds: 3 }));
def("dry_bush", dryBush);
def("grass", grass);
def("flowers", flowers);
def("cactus", (n, T) => cactus(n, T, { r: 0.36, ribs: 6, arms: [[0, 0.36, 1.13, 0.74], [180, 0.5, 1.13, 0.88]] }));
def("nk_cactus_tall", (n, T) => cactus(n, T, { r: 0.33, arms: [[90, 0.34, 0.93, 0.78], [210, 0.5, 1.0, 0.9], [330, 0.42, 1.0, 0.66]] }));
def("nk_cactus_short", (n, T) => cactus(n, T, { r: 0.3, arms: [[60, 0.3, 0.6, 0.8], [180, 0.42, 0.55, 0.66], [300, 0.22, 0.34, 0.5]] }));
for (const [kind, spec] of Object.entries(ROCK_PARTS)) for (const [prefix, palette] of [["rock", "grey"], ["rockice", "ice"], ["rockred", "red"]]) def(`nk_${prefix}_${kind}`, (n, T) => rock(n, T, { ...spec, like: `nk_rock_${kind}`, palette }));
def("rock", (n, T) => rock(n, T, { ...ROCK, palette: "grey" }));
def("rock_ice", (n, T) => rock(n, T, { ...ROCK, like: "rock", palette: "ice" }));
def("rock_red", (n, T) => rock(n, T, { ...ROCK, like: "rock", palette: "red" }));
def("nk_log", log);
def("nk_stump", stump);
def("mesa", mesa);
for (const [name, spec] of Object.entries(MOUNTAINS)) def(name, (n, T) => mountain(n, T, spec));
def("cloud", cloud);

/// The studio model document of one preset (Pine Ridge Rally's model of that name: `build(name)` is exactly it).
export function build(name) {
  return buildPreset(name, { part: name });
}

/// A preset as a model: its one part named `part`; `salt` added to its seeds (0: the preset itself); `scale` on its box (1: as measured).
export function buildPreset(name, { part = name, salt = 0, scale = 1 } = {}) {
  if (!MODELS[name]) throw new Error(`no natural scenery preset "${name}"`);
  const T = scale === 1 ? BEFORE[name] : { lo: BEFORE[name].lo.map((v) => v * scale), hi: BEFORE[name].hi.map((v) => v * scale), tris: BEFORE[name].tris };
  SALT = salt;
  let shapes;
  try {
    shapes = MODELS[name](T);
  } finally {
    SALT = 0;
  }
  fit(shapes, T, name);
  const colliders = COLLIDERS[name]?.map((c) => (scale === 1 ? c : { x: r2(c.x * scale), z: r2(c.z * scale), r: r2(c.r * scale) }));
  return { version: 1, scale: 0.0625, parts: [{ name: part, origin: [0, 0, 0], rotation: [0, 0, 0], cubes: shapes.map((s) => s.cube()), children: [] }], ...(colliders ? { colliders } : {}) };
}
export const PRESETS = () => Object.keys(MODELS);
