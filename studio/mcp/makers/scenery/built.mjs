// Built scenery for prop3d_make's detailed kinds (first made for Pine Ridge Rally on 2026-11-20 as scripts/rally/scenery-built.mjs; moved here
// so every game has it): the trackside furniture, the stands and buildings, the flags and the spectators, every one made here from measurements
// of the real thing as a studio model document (a `.model.json` the model editor opens). Nothing is copied or converted from another asset.
// Sizes are in metres here (y up, the front of a thing looks along +z unless said). No signs carry lettering: billboards are stripes and chequers.
// Each preset's name is also the Pine Ridge Rally model it first made; `MODELS[name]()` is exactly that model.
import { mix, r2, shade } from "../car/kit.mjs";

// ---- the kit: shapes built from points in metres -----------------------------------------------------------------------------------------------------------
const U = 16; // model units in a metre (the model's scale is 1/16)
const u = (v) => r2(v * U);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp = (a, b, t) => a + (b - a) * t, lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const rad = (d) => (d * Math.PI) / 180;
function newell(P) {
  const n = [0, 0, 0];
  for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; n[0] += (p[1] - q[1]) * (p[2] + q[2]); n[1] += (p[2] - q[2]) * (p[0] + q[0]); n[2] += (p[0] - q[0]) * (p[1] + q[1]); }
  return n;
}
/// A small repeatable random source (colours a little uneven, as weathered things are).
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// materials (the numbers the game's PBR uses when the model is on nova.json's `materials` list; the colours carry the look without it)
const GALV = { metallic: 0.3, roughness: 0.5 }, PAINTED = { metallic: 0.45, roughness: 0.5 }, DARKSTEEL = { metallic: 0.6, roughness: 0.55 }, RUBBER = { metallic: 0, roughness: 0.9 };
const CONCRETE = { metallic: 0, roughness: 0.92 }, CANVAS = { metallic: 0, roughness: 0.8 }, PLASTIC = { metallic: 0, roughness: 0.45 }, GLASS = { metallic: 0.7, roughness: 0.08 }, MATT = { metallic: 0, roughness: 0.85 };
const STRAW = { metallic: 0, roughness: 1 }, CLOTH = { metallic: 0, roughness: 0.9 }, SKIN = { metallic: 0, roughness: 0.7 }, PAINTLINE = { metallic: 0, roughness: 0.7 };
const C_GALV = "#b3b8bc", C_GALV_D = "#979ca1", C_STEEL = "#5b6168", C_DARK = "#2b2e33", C_CONC = "#b9b6ae", C_CONC_D = "#9c9a93", C_WHITE = "#e6e4dc", C_CANVAS = "#e4e0d3";

/// A shape: one mesh of one material. Polygons are given counter-clockwise seen from outside (or through `face`, which turns them to look along a direction).
function shape(name, color, mat = MATT, extra = {}) { return { name, color, mat, extra, verts: [], polys: [], cuts: [], idx: new Map(), group: 0, xf: null, flip: false, weight: null, weights: [] }; }
function vtx(s, p) {
  const w = p[3] ?? s.weight, q = (s.xf ? s.xf(p) : p).slice(0, 3).map(u), k = `${s.group}:${q[0]},${q[1]},${q[2]}:${w ?? ""}`;
  let i = s.idx.get(k);
  if (i === undefined) { i = s.verts.push(q) - 1; s.idx.set(k, i); if (w !== null) s.weights.push([[w, 1]]); }
  return i;
}
function poly(s, pts, o = {}) {
  let ids = pts.map((p) => vtx(s, p)).filter((v, i, a) => v !== a[(i + a.length - 1) % a.length]);
  if (ids.length < 3) return;
  if (s.flip) ids = ids.reverse();
  const f = { v: ids };
  if (o.color && o.color !== s.color) f.color = o.color;
  if (o.smooth) f.smooth = true;
  s.polys.push(f);
}
/// A polygon turned to look along `ref`.
const face = (s, pts, ref, o) => poly(s, dot(newell(pts), ref) >= 0 ? pts : [...pts].reverse(), o);
/// Runs `fn` with every point moved by `xf` ({ move, rx, ry, rz in degrees (z, then x, then y), scale, mirror: true to reflect x }).
function placed(s, t, fn) {
  const cs = (d) => [Math.cos(rad(d ?? 0)), Math.sin(rad(d ?? 0))], [cx, sx] = cs(t.rx), [cy, sy] = cs(t.ry), [cz, sz] = cs(t.rz);
  const m = t.move ?? [0, 0, 0], k = t.scale ?? 1, outer = s.xf, wasFlip = s.flip;
  const f = (p) => {
    let [x, y, z] = [p[0] * k * (t.mirror ? -1 : 1), p[1] * k, p[2] * k];
    [x, y] = [x * cz - y * sz, x * sz + y * cz];
    [y, z] = [y * cx - z * sx, y * sx + z * cx];
    [x, z] = [x * cy + z * sy, -x * sy + z * cy];
    return [x + m[0], y + m[1], z + m[2]];
  };
  s.xf = outer ? (p) => outer(f(p)) : f;
  if (t.mirror) s.flip = !s.flip;
  fn();
  s.xf = outer; s.flip = wasFlip;
}
/// Triangles of a flat outline (ear clipping), as index triples.
function earclip(poly2) {
  const n = poly2.length, area = poly2.reduce((a, p, i) => { const q = poly2[(i + 1) % n]; return a + p[0] * q[1] - q[0] * p[1]; }, 0);
  const idx = [...Array(n).keys()], out = [];
  if (area < 0) idx.reverse();
  const cr = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let cut = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length], a = poly2[ia], b = poly2[ib], c = poly2[ic];
      if (cr(a, b, c) <= 1e-12) continue;
      if (idx.some((j) => j !== ia && j !== ib && j !== ic && cr(a, b, poly2[j]) > -1e-12 && cr(b, c, poly2[j]) > -1e-12 && cr(c, a, poly2[j]) > -1e-12)) continue;
      out.push([ia, ib, ic]); idx.splice(i, 1); cut = true; break;
    }
    if (!cut) break;
  }
  if (idx.length === 3) out.push(idx);
  return out;
}
const AX = { x: (p, q, t) => [t, q, p], y: (p, q, t) => [p, t, q], z: (p, q, t) => [p, q, t] };
/// An outline pushed along an axis. For `axis` "z" the outline is (x, y), for "x" (z, y), for "y" (x, z). `o`: caps ("ab", "a", "b" or ""), skip (edge numbers
/// left out), colors (edge number -> colour), capColor, smooth, open (a line, not a ring: then `out`, a direction in the outline's plane its faces look to,
/// and `double` for both sides).
function prism(s, outline, axis, a0, a1, o = {}) {
  s.group++;
  const P = AX[axis], n = outline.length, area = outline.reduce((a, p, i) => { const q = outline[(i + 1) % n]; return a + p[0] * q[1] - q[0] * p[1]; }, 0), sign = area >= 0 ? 1 : -1;
  for (let i = 0; i < (o.open ? n - 1 : n); i++) {
    if (o.skip?.includes(i)) continue;
    const a = outline[i], b = outline[(i + 1) % n], dp = b[0] - a[0], dq = b[1] - a[1];
    let ref = P(dq * sign, -dp * sign, 0);
    if (o.open) { ref = P(dq, -dp, 0); const want = P(o.out[0], o.out[1], 0); if (dot(ref, want) < 0) ref = mul(ref, -1); }
    const quad = [P(a[0], a[1], a0), P(b[0], b[1], a0), P(b[0], b[1], a1), P(a[0], a[1], a1)], opt = { color: o.colors?.(i) ?? o.color, smooth: o.smooth };
    face(s, quad, ref, opt);
    if (o.double) face(s, quad, mul(ref, -1), { ...opt, color: o.backColor ?? opt.color });
  }
  if (o.open) return;
  const caps = o.caps ?? "ab";
  if (caps) for (const tri of earclip(outline)) {
    if (caps.includes("a")) face(s, tri.map((i) => P(outline[i][0], outline[i][1], a0)), P(0, 0, -1), { color: o.capColor ?? o.color });
    if (caps.includes("b")) face(s, tri.map((i) => P(outline[i][0], outline[i][1], a1)), P(0, 0, 1), { color: o.capColor ?? o.color });
  }
}
/// A box from corner `lo` to corner `hi`. `o.skip`: the faces left out, of W E (x- x+), D U (y- y+), N S (z- z+); `o.colors`: { U: colour, ... }.
function box(s, lo, hi, o = {}) {
  s.group++;
  const [x0, y0, z0] = lo, [x1, y1, z1] = hi, F = { W: [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0]], E: [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0]], D: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0]], U: [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0]], N: [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [0, 0, -1]], S: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]] };
  for (const [k, f] of Object.entries(F)) if (!(o.skip ?? "").includes(k)) face(s, f.slice(0, 4), f[4], { color: o.colors?.[k] ?? o.color });
}
/// A box with its edges cut off `c` wide (a bale, a lamp housing). `o.flat`: the bottom is left open and square (it stands on the ground).
function chamferBox(s, lo, hi, c, o = {}) {
  s.group++;
  const ext = (a, sg) => (sg > 0 ? hi[a] : lo[a]), ins = (a, sg) => (o.flat && a === 1 && sg < 0 ? lo[1] : ext(a, sg) - sg * c);
  const V = (a, sg3) => [0, 1, 2].map((k) => (k === a ? ext(k, sg3[k]) : ins(k, sg3[k]))), col = (a, sg) => ({ color: o.colors?.[["WE", "DU", "NS"][a][sg > 0 ? 1 : 0]] ?? o.color, smooth: o.smooth });
  for (let a = 0; a < 3; a++) for (const sg of [-1, 1]) {
    if (o.flat && a === 1 && sg < 0) continue;
    const [b, d] = [0, 1, 2].filter((k) => k !== a), ref = [0, 0, 0]; ref[a] = sg;
    const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sb, sd]) => { const g = [0, 0, 0]; g[a] = sg; g[b] = sb; g[d] = sd; return V(a, g); });
    face(s, pts, ref, col(a, sg));
  }
  for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) for (const sa of [-1, 1]) for (const sb of [-1, 1]) {
    if (o.flat && ((a === 1 && sa < 0) || (b === 1 && sb < 0))) continue;
    const d = 3 - a - b, g1 = [0, 0, 0], g2 = [0, 0, 0], ref = [0, 0, 0]; g1[a] = g2[a] = sa; g1[b] = g2[b] = sb; g1[d] = -1; g2[d] = 1; ref[a] = sa; ref[b] = sb;
    face(s, [V(a, g1), V(a, g2), V(b, g2), V(b, g1)], ref, { color: o.edgeColor ?? o.color, smooth: o.smooth });
  }
  for (const sx of [-1, 1]) for (const sy of o.flat ? [1] : [-1, 1]) for (const sz of [-1, 1]) face(s, [0, 1, 2].map((a) => V(a, [sx, sy, sz])), [sx, sy, sz], { color: o.edgeColor ?? o.color, smooth: o.smooth });
}
function frame(d) { const ref = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], e1 = unit(cross(ref, d)); return [e1, cross(d, e1)]; }
/// A round (or `n`-sided) bar from a to b, radius r (r1 at b). `o.caps`: "a", "b", "ab"; `o.turn`: degrees round its axis; four sides or fewer are flat.
function tube(s, a, b, r, n = 6, o = {}) {
  s.group++;
  const d = unit(sub(b, a)), [e1, e2] = frame(d), r1 = o.r1 ?? r, ph = rad(o.turn ?? (n === 4 ? 45 : 0)), smooth = o.smooth ?? n > 4;
  const ring = (c, rr) => Array.from({ length: n }, (_, k) => { const t = ph + (k / n) * 2 * Math.PI; return add(c, add(mul(e1, rr * Math.cos(t)), mul(e2, rr * Math.sin(t)))); });
  const A = ring(a, r), B = ring(b, r1);
  for (let k = 0; k < n; k++) { const j = (k + 1) % n, t = ph + ((k + 0.5) / n) * 2 * Math.PI; face(s, [A[k], A[j], B[j], B[k]], add(mul(e1, Math.cos(t)), mul(e2, Math.sin(t))), { color: o.color, smooth }); }
  s.group++;
  if ((o.caps ?? "").includes("a")) face(s, A, mul(d, -1), { color: o.capColor ?? o.color });
  if ((o.caps ?? "").includes("b")) face(s, B, d, { color: o.capColor ?? o.color });
}
/// A bent bar through `pts` (a lamp's arm, an arch): rings at each point, mitred. `o.radii`: one radius per point; `o.colors`: segment -> colour.
function pipe(s, pts, r, n = 6, o = {}) {
  s.group++;
  const m = pts.length, tan = pts.map((p, i) => unit(add(i > 0 ? unit(sub(p, pts[i - 1])) : [0, 0, 0], i < m - 1 ? unit(sub(pts[i + 1], p)) : [0, 0, 0])));
  let [e1] = o.up ? [unit(cross(o.up, tan[0]))] : frame(tan[0]);
  const rings = [];
  for (let i = 0; i < m; i++) {
    e1 = unit(sub(e1, mul(tan[i], dot(e1, tan[i]))));
    const e2 = cross(tan[i], e1), rr = o.radii?.[i] ?? r;
    rings.push(Array.from({ length: n }, (_, k) => { const t = rad(o.turn ?? 0) + (k / n) * 2 * Math.PI; return add(pts[i], add(mul(e1, rr * Math.cos(t)), mul(e2, rr * Math.sin(t)))); }));
  }
  for (let i = 0; i < m - 1; i++) {
    if (o.split) s.group++;
    for (let k = 0; k < n; k++) { const j = (k + 1) % n, c = lerp3(pts[i], pts[i + 1], 0.5), mid = mul(add(add(rings[i][k], rings[i][j]), add(rings[i + 1][k], rings[i + 1][j])), 0.25); face(s, [rings[i][k], rings[i][j], rings[i + 1][j], rings[i + 1][k]], sub(mid, c), { color: o.colors?.(i) ?? o.color, smooth: o.smooth ?? n > 4 }); }
  }
  s.group++;
  if ((o.caps ?? "").includes("a")) face(s, rings[0], mul(tan[0], -1), { color: o.capColor ?? o.colors?.(0) ?? o.color });
  if ((o.caps ?? "").includes("b")) face(s, rings[m - 1], tan[m - 1], { color: o.capColor ?? o.colors?.(m - 2) ?? o.color });
}
/// A profile [[radius, y], ...] turned round an upright axis at (cx, cz), `n` sides. Walk the profile with the outside on your right (bottom to top for an
/// outer wall). `o.arc`: [from, to] degrees for part of the turn; `o.colors`: band -> colour; `o.split`: each band shades by itself; `o.rz`: the ring is an
/// ellipse, this much deeper along z.
function spin(s, profile, c, n, o = {}) {
  s.group++;
  const [a0, a1] = (o.arc ?? [0, 360]).map(rad), full = !o.arc, kz = o.rz ?? 1;
  const at = (r, y, t) => [c[0] + r * Math.cos(t), y, c[1] + r * kz * Math.sin(t)];
  for (let i = 0; i < profile.length - 1; i++) {
    if (o.split) s.group++;
    const [ra, ya] = profile[i], [rb, yb] = profile[i + 1], dr = rb - ra, dy = yb - ya;
    for (let k = 0; k < n; k++) {
      const t0 = a0 + ((a1 - a0) * k) / n, t1 = full && k === n - 1 ? a0 : a0 + ((a1 - a0) * (k + 1)) / n, tm = a0 + ((a1 - a0) * (k + 0.5)) / n;
      face(s, [at(ra, ya, t0), at(ra, ya, t1), at(rb, yb, t1), at(rb, yb, t0)], [dy * Math.cos(tm), -dr, dy * Math.sin(tm)], { color: o.colors?.(i, k) ?? o.color, smooth: o.smooth ?? true });
    }
  }
}
/// A sheet through a grid of points (rows of points); looks along `o.ref`; `o.double` for both sides; `o.color`: (row, column) -> colour.
function sheet(s, g, o = {}) {
  s.group++;
  const quads = [];
  for (let i = 0; i < g.length - 1; i++) for (let j = 0; j < g[i].length - 1; j++) quads.push([[g[i][j], g[i + 1][j], g[i + 1][j + 1], g[i][j + 1]], o.color?.(i, j), o.back?.(i, j)]);
  const put = (q, ref, opt) => { if (!o.ridge) return face(s, q, ref, opt); const d = q[0][1] + q[2][1] >= q[1][1] + q[3][1] ? [[q[0], q[1], q[2]], [q[0], q[2], q[3]]] : [[q[1], q[2], q[3]], [q[1], q[3], q[0]]]; for (const t of d) face(s, t, ref, opt); };
  for (const [q, c] of quads) put(q, o.ref, { color: c, smooth: o.smooth });
  if (o.double) { s.group++; for (const [q, c, b] of quads) put(q, mul(o.ref, -1), { color: b ?? c, smooth: o.smooth }); }
}
/// A flat plate with both faces (a flange, a strip of wire): four points.
const plate = (s, pts, ref, o = {}) => { s.group++; face(s, pts, ref, o); face(s, pts, mul(ref, -1), o); };
/// A cut-out on a shape (see the Cut-out modifier): an outline in metres, as seen from `view`.
const cut = (s, view, points, o = {}) => s.cuts.push({ view, points: points.map(([a, b]) => [u(a), u(b)]), ...o, ...(o.depth ? { depth: u(o.depth) } : {}) });
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

function cubeOf(s) {
  const c = { name: s.name, shape: "mesh", color: s.color, verts: s.verts, polys: s.polys, ...s.mat, ...s.extra };
  if (s.cuts.length) c.modifiers = [{ type: "cutout", cuts: s.cuts }];
  if (s.skin) c.skin = { bones: s.skin, weights: s.weights };
  return c;
}
/// A model of one part named `part`, made of shapes (empty ones are left out).
const model = (part, shapes, more = {}) => ({ version: 1, scale: 1 / U, parts: [{ name: part, origin: [0, 0, 0], rotation: [0, 0, 0], cubes: shapes.filter((s) => s.polys.length).map(cubeOf), children: [] }], ...more });

// ---- steel lattice (start arch, gantry, banner towers) ----------------------------------------------------------------------------------------------------
/// A box truss between a and b: four chords `w` x `h` apart (w along `side`, h along `up`), a ring of bars at every bay and a zigzag on each face.
function truss(s, a, b, w, h, side, up, bays, o = {}) {
  const rc = o.chord ?? 0.035, rl = o.lace ?? 0.022, nl = o.sides ?? 3, cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => add(mul(side, (i * w) / 2), mul(up, (j * h) / 2)));
  for (const c of cs) tube(s, add(a, c), add(b, c), rc, 4, { color: o.color });
  for (let k = 0; k <= bays; k++) {
    const p = lerp3(a, b, k / bays);
    if (!(o.noRings && k > 0 && k < bays)) for (let f = 0; f < 4; f++) tube(s, add(p, cs[f]), add(p, cs[(f + 1) % 4]), rl, nl, { color: o.color });
    if (k < bays) { const q = lerp3(a, b, (k + 1) / bays); for (let f = 0; f < 4; f++) { if (o.faces && !o.faces.includes(f)) continue; const flip = (k + f) % 2 === 0; tube(s, add(p, cs[flip ? f : (f + 1) % 4]), add(q, cs[flip ? (f + 1) % 4 : f]), rl, nl, { color: o.color }); } }
  }
}

// ================================ beside the road ==========================================================================================================
/// Armco: a W-section beam (two crests towards the road, +x) bolted to I-section posts every two metres.
function guardrail(name, centres, top) {
  const beam = shape("beam", C_GALV, GALV), posts = shape("posts", C_GALV_D, GALV);
  for (const yc of centres) {
    const w = [[0.08, yc + 0.155], [0.15, yc + 0.118], [0.15, yc + 0.058], [0.092, yc], [0.15, yc - 0.058], [0.15, yc - 0.118], [0.08, yc - 0.155]];
    prism(beam, w, "z", -3, 3, { open: true, out: [1, 0], double: true, colors: (i) => [shade(C_GALV, 1.06), C_GALV, shade(C_GALV, 0.86), shade(C_GALV, 1.06), C_GALV, shade(C_GALV, 0.86)][i], backColor: shade(C_GALV, 0.8) });
  }
  for (const z of [-2, 0, 2]) {
    plate(posts, [[0.074, -0.06, z - 0.04], [0.074, -0.06, z + 0.04], [0.074, top, z + 0.04], [0.074, top, z - 0.04]], [1, 0, 0]);
    plate(posts, [[-0.07, -0.06, z - 0.04], [-0.07, -0.06, z + 0.04], [-0.07, top, z + 0.04], [-0.07, top, z - 0.04]], [1, 0, 0]);
    plate(posts, [[-0.07, -0.06, z], [0.074, -0.06, z], [0.074, top, z], [-0.07, top, z]], [0, 0, 1], { color: shade(C_GALV_D, 0.9) });
  }
  return model(name, [beam, posts]);
}
/// A concrete barrier wall, three two-metre units of the New Jersey section.
function barrierWall() {
  const s = shape("concrete", C_CONC, CONCRETE), sec = [[0.34, -0.05], [0.34, 0.08], [0.185, 0.33], [0.118, 0.78], [-0.118, 0.78], [-0.185, 0.33], [-0.34, 0.08], [-0.34, -0.05]];
  [-3, -1, 1].forEach((z, k) => {
    const c = [C_CONC, shade(C_CONC, 0.95), shade(C_CONC, 1.03)][k];
    prism(s, sec, "z", z + 0.012, z + 1.988, { skip: [7], colors: (i) => (i === 0 || i === 6 ? shade(c, 0.8) : i === 3 ? shade(c, 1.05) : c), capColor: shade(c, 0.78) });
  });
  return model("barrier_wall", [s]);
}
/// Water-filled plastic barriers: two units pinned end to end, each with its fork-lift slots and filler cap.
function plasticBarrier(name, colours) {
  const s = shape("plastic", colours[0], PLASTIC), dark = shape("slots", "#1c1d20", MATT);
  const half = [[0.28, -0.03], [0.28, 0.14], [0.175, 0.42], [0.14, 0.9], [0.11, 0.99], [0.05, 1.03]], sec = [...half, ...[...half].reverse().map(([z, y]) => [-z, y])];
  [-1, 1].forEach((cx, k) => {
    const c = colours[k];
    prism(s, sec, "x", cx - 0.985, cx + 0.985, { skip: [11], colors: (i) => (i === 0 || i === 10 ? shade(c, 0.82) : i === 5 ? shade(c, 1.06) : c), capColor: shade(c, 0.88) });
    prism(s, Array.from({ length: 6 }, (_, i) => [cx + 0.075 * Math.cos((i / 6) * 2 * Math.PI), 0.075 * Math.sin((i / 6) * 2 * Math.PI)]), "y", 1.02, 1.065, { caps: "b", color: shade(c, 0.7) });
    for (const dx of [-0.5, 0.5]) for (const sz of [-1, 1]) face(dark, [[cx + dx - 0.16, -0.03, sz * 0.282], [cx + dx + 0.16, -0.03, sz * 0.282], [cx + dx + 0.16, 0.11, sz * 0.282], [cx + dx - 0.16, 0.11, sz * 0.282]], [0, 0, sz]);
  });
  return model(name, [s, dark]);
}
/// A traffic cone: a rubber foot, an orange cone with a reflective sleeve.
function pylon() {
  const s = shape("cone", "#e0561f", PLASTIC), foot = shape("foot", "#1f2023", RUBBER), k = 0.36, c = 0.09;
  prism(foot, [[k - c, -k], [k, -k + c], [k, k - c], [k - c, k], [-k + c, k], [-k, k - c], [-k, -k + c], [-k + c, -k]], "y", -0.06, 0.045, { caps: "b", colors: () => "#1f2023", capColor: "#292a2e" });
  spin(s, [[0.225, 0.045], [0.17, 0.4], [0.128, 0.67], [0.055, 1.0], [0, 1.02]], [0, 0], 12, { colors: (i) => (i === 1 ? "#e9e7df" : "#e0561f") });
  return model("pylon", [foot, s]);
}
/// A tyre barrier: three stacks of four wide tyres strapped together, every other tyre painted white. (The sides that face the middle are left out.)
function tires() {
  const s = shape("tyres", "#1d1e21", RUBBER), R = 0.4, h = 1.75 / 4, cols = [[-0.4, -0.36], [0.4, -0.36], [0, 0.36]];
  cols.forEach(([cx, cz], ci) => {
    const prof = [], colour = (t) => ((t + ci) % 2 === 1 ? "#d4d1c6" : "#1d1e21"), hidden = (Math.atan2(-0.12 - cz, -cx) * 180) / Math.PI;
    // (a tyre is its tread and the shoulder above it; the shoulder underneath is never seen from a car and is left out)
    for (let t = 0; t < 4; t++) spin(s, [[R, t * h + 0.03], [R, t * h + h - 0.13], [R * 0.84, t * h + h]], [cx, cz], 6, { arc: [hidden + 45, hidden + 315], split: true, colors: (i) => (i ? shade(colour(t), 1.14) : colour(t)) });
    spin(s, [[R * 0.84, 4 * h], [R * 0.5, 4 * h + 0.004]], [cx, cz], 8, { color: shade(colour(3), 0.9), smooth: false });
    spin(s, [[R * 0.5, 4 * h - 0.002], [0, 4 * h - 0.002]], [cx, cz], 8, { color: "#08080a", smooth: false });
  });
  return model("stack", [s], { colliders: [{ x: 0, z: 0, r: 24 }] });
}
/// A big square straw bale, strung three times.
function hayBale() {
  const s = shape("straw", "#cdb878", STRAW), tw = shape("twine", "#6b5830", STRAW);
  chamferBox(s, [-1.13, -0.03, -0.74], [1.13, 1.26, 0.74], 0.1, { flat: true, colors: { W: "#b59f60", E: "#b59f60", U: "#d6c285", N: "#c4ae6e", S: "#cdb878" }, edgeColor: "#c0aa6a" });
  for (const x of [-0.62, 0, 0.62]) {
    const a = x - 0.01, b = x + 0.01, y = 1.262, z = 0.742;
    face(tw, [[a, 0, z], [b, 0, z], [b, 1.16, z], [a, 1.16, z]], [0, 0, 1]);
    face(tw, [[a, 0, -z], [b, 0, -z], [b, 1.16, -z], [a, 1.16, -z]], [0, 0, -1]);
    face(tw, [[a, y, -0.64], [b, y, -0.64], [b, y, 0.64], [a, y, 0.64]], [0, 1, 0]);
  }
  return model("bale", [s, tw], { colliders: [{ x: -12.8, z: 0, r: 19.2 }, { x: 12.8, z: 0, r: 19.2 }] });
}
/// A catch fence panel: galvanised posts and rails, wire strung across in a diamond mesh.
function fence() {
  const s = shape("posts", C_GALV_D, GALV), w = shape("net", "#b9bec3", GALV);
  for (const x of [-2.44, 0, 2.44]) tube(s, [x, -0.05, 0], [x, 2.45, 0], 0.045, 6, { caps: "b" });
  for (const y of [0.08, 2.38]) tube(s, [-2.44, y, 0], [2.44, y, 0], 0.03, 4);
  const x0 = -2.4, x1 = 2.4, y0 = 0.1, y1 = 2.36, wd = 0.011, step = 0.38;
  for (const dir of [1, -1]) for (let t = -(y1 - y0); t < x1 - x0; t += step) {
    // a wire from the bottom at x0 + t rising to the top, clipped to the panel
    let ax = x0 + t, ay = y0, bx = ax + (y1 - y0), by = y1;
    if (ax < x0) { ay += x0 - ax; ax = x0; }
    if (bx > x1) { by -= bx - x1; bx = x1; }
    if (bx - ax < 0.05) continue;
    const X = (x) => (dir > 0 ? x : -x), n = wd * 0.7071;
    plate(w, [[X(ax) - n * dir, ay + n, 0], [X(ax) + n * dir, ay - n, 0], [X(bx) + n * dir, by - n, 0], [X(bx) - n * dir, by + n, 0]], [0, 0, 1]);
  }
  for (const y of [0.85, 1.6]) plate(w, [[x0, y - 0.008, 0], [x1, y - 0.008, 0], [x1, y + 0.008, 0], [x0, y + 0.008, 0]], [0, 0, 1], { color: C_GALV_D });
  return model("fence", [s, w], { colliders: [{ x: -27.2, z: 0, r: 6.4 }, { x: 0, z: 0, r: 6.4 }, { x: 27.2, z: 0, r: 6.4 }] });
}
/// A bend marker: a yellow board on a post, two chevrons cut into its face (the face looks along -z, as the old sign's did).
function signChevron() {
  const post = shape("post", C_GALV_D, GALV), board = shape("board", "#e2b21e", PAINTED);
  tube(post, [0, -0.03, 0], [0, 2.5, 0], 0.045, 5, { turn: 18 });
  box(board, [-0.81, 1.38, -0.085], [0.81, 2.63, -0.055], { colors: { S: "#8d9197", U: "#8d9197", D: "#8d9197", E: "#8d9197", W: "#8d9197" } });
  const chev = (y) => [[0, y + 0.42], [0.62, y], [0.62, y - 0.2], [0, y + 0.22], [-0.62, y - 0.2], [-0.62, y]];
  for (const y of [1.72, 2.12]) cut(board, "back", chev(y), { color: "#17181b", metallic: 0, roughness: 0.6, facing: 0.9, name: "chevron" });
  return model("sign", [post, board]);
}

// ================================ flags, banners, boards ===================================================================================================
/// A feather flag on a pole (the pole stands off the origin, where the old model's did). `paint`: (column, row) -> colour.
function flag(part, cols, rows, paint, more = {}) {
  const pole = shape("pole", "#c9ccd0", GALV), cloth = shape("cloth", paint(0, 0), CLOTH), px = -0.905, pz = -1.56;
  spin(pole, [[0.05, -0.05], [0.05, 0.25], [0.034, 0.3], [0.024, 5.86]], [px, pz], 6);
  spin(pole, [[0, 5.95], [0.045, 5.9], [0, 5.84]].reverse(), [px, pz], 6, { color: "#8d9197" });
  const x0 = px + 0.045, x1 = -0.045, y0 = 3.05, y1 = 5.66, g = [];
  for (let j = 0; j <= rows; j++) { const row = []; for (let i = 0; i <= cols; i++) { const fx = i / cols, fy = j / rows; row.push([lerp(x0, x1, fx), lerp(y1, y0, fy), pz + 0.07 * fx * Math.sin(fx * 4.2 + fy * 2.6) + 0.02 * fx * Math.sin(fy * 9)]); } g.push(row); }
  sheet(cloth, g, { ref: [0, 0, 1], double: true, color: (j, i) => paint(i, j), smooth: true });
  for (const y of [y0 + 0.05, y1 - 0.05]) tube(pole, [px, y, pz], [x0 + 0.02, y, pz], 0.012, 3, { color: "#8d9197" });
  return model(part, [pole, cloth], more);
}
/// A scaffold tower with a banner round its top (stripes only).
function bannerTower(name, colour) {
  const s = shape("scaffold", C_GALV, GALV), c = shape("banner", colour, CANVAS), k = 1.15, legs = [[-k, -k], [k, -k], [k, k], [-k, k]];
  for (const [x, z] of legs) { tube(s, [x, -0.06, z], [x, 7.9, z], 0.045, 5); box(s, [x - 0.09, -0.06, z - 0.09], [x + 0.09, -0.03, z + 0.09], { skip: "D", color: C_GALV_D }); }
  for (const y of [0.55, 2.7, 5.25, 7.75]) for (let f = 0; f < 4; f++) tube(s, [legs[f][0], y, legs[f][1]], [legs[(f + 1) % 4][0], y, legs[(f + 1) % 4][1]], 0.035, 4);
  for (let f = 0; f < 4; f++) { const a = legs[f], b = legs[(f + 1) % 4]; tube(s, [a[0], 0.55, a[1]], [b[0], 2.7, b[1]], 0.028, 3); tube(s, [b[0], 2.7, b[1]], [a[0], 5.25, a[1]], 0.028, 3); }
  // the banner: four sheets laced inside the top frame, each bellying out a little
  for (let f = 0; f < 4; f++) {
    const a = legs[f], b = legs[(f + 1) % 4], out = unit([(a[0] + b[0]) / 2, 0, (a[1] + b[1]) / 2]), g = [];
    for (let j = 0; j <= 4; j++) { const row = [], y = lerp(7.62, 5.38, j / 4); for (let i = 0; i <= 4; i++) { const t = lerp(0.06, 0.94, i / 4), bel = 0.07 * Math.sin((i / 4) * Math.PI) * Math.sin((j / 4) * Math.PI); row.push([lerp(a[0], b[0], t) * 0.985 + out[0] * bel, y, lerp(a[1], b[1], t) * 0.985 + out[2] * bel]); } g.push(row); }
    sheet(c, g, { ref: out, double: true, smooth: true, color: (j) => (j === 1 ? C_CANVAS : j === 2 ? shade(colour, 0.9) : colour), back: () => shade(colour, 0.62) });
  }
  return model(name, [s, c]);
}
/// An advertising board with nothing to sell: a steel frame and a sheet-metal face with stripes or chequers cut into it. The face looks along +z.
function billboard(name, w, y0, y1, zf, zb, art) {
  const s = shape("frame", C_STEEL, DARKSTEEL), p = shape("face", art.field, PAINTED), hw = w / 2;
  box(p, [-hw, y0, zf - 0.06], [hw, y1, zf], { colors: { N: "#7d8288", U: "#6d7278", D: "#6d7278", E: "#6d7278", W: "#6d7278" } });
  art.cuts(p, hw, y0, y1);
  for (const x of [-hw * 0.72, 0, hw * 0.72]) {
    tube(s, [x, -0.08, zf - 0.14], [x, y1 - 0.15, zf - 0.14], 0.075, 4, { turn: 45 });
    if (x) { tube(s, [x, -0.08, zb + 0.1], [x, y0 + (y1 - y0) * 0.62, zf - 0.2], 0.06, 4); tube(s, [x, 0.05, zb + 0.1], [x, 0.05, zf - 0.14], 0.06, 4); if (y0 > 2) tube(s, [x, y0 * 0.55, zf - 0.2], [x, 0.05, (zf + zb) / 2], 0.04, 4); }
  }
  for (const y of [y0 + 0.25, (y0 + y1) / 2, y1 - 0.25]) tube(s, [-hw + 0.1, y, zf - 0.1], [hw - 0.1, y, zf - 0.1], 0.045, 4);
  tube(s, [-hw * 0.72, 0.05, zb + 0.1], [hw * 0.72, 0.05, zb + 0.1], 0.06, 4);
  if (y0 > 2) { tube(s, [-hw * 0.72, y0 * 0.5, zf - 0.14], [0, 0.1, zf - 0.14], 0.035, 4); tube(s, [hw * 0.72, y0 * 0.5, zf - 0.14], [0, 0.1, zf - 0.14], 0.035, 4); }
  return model(name, [s, p]);
}
const slant = (x0, x1, y0, y1, lean) => [[x0, y0], [x1, y0], [x1 + lean, y1], [x0 + lean, y1]];
const BOARD_ART = {
  // a deep blue field, a pale band along the foot and three leaning stripes
  stripes: { field: "#22364f", cuts: (p, hw, y0, y1) => {
    const o = { facing: 0.9, metallic: 0.3, roughness: 0.5 }, h = y1 - y0;
    cut(p, "front", rect(-hw + 0.12, y0 + 0.12, hw - 0.12, y0 + h * 0.2), { ...o, color: "#d9d6cb", name: "band" });
    [["#d9d6cb", -0.2, 0.55], ["#b5402f", 0.75, 0.4], ["#d9d6cb", 1.5, 0.22]].forEach(([c, at, wd]) => cut(p, "front", slant(at * hw * 0.5, at * hw * 0.5 + wd * hw * 0.5, y0 + h * 0.27, y1 - 0.12, h * 0.3), { ...o, color: c, name: "stripe" }));
  } },
  // a pale field, a red band and a row of chequers
  chequers: { field: "#dcd9ce", cuts: (p, hw, y0, y1) => {
    const o = { facing: 0.9, metallic: 0.3, roughness: 0.5 }, h = y1 - y0, n = 8, cw = (2 * hw - 0.3) / n, ya = y0 + 0.15, ch = Math.min(cw, h * 0.22);
    for (let r = 0; r < 2; r++) for (let i = 0; i < n; i++) if ((i + r) % 2 === 0) cut(p, "front", rect(-hw + 0.15 + i * cw, ya + r * ch, -hw + 0.15 + (i + 1) * cw, ya + (r + 1) * ch), { ...o, color: "#1b1c1f", name: "chequer" });
    cut(p, "front", rect(-hw + 0.15, y0 + h * 0.62, hw - 0.15, y0 + h * 0.84), { ...o, color: "#9c4236", name: "band" });
  } },
};

// ================================ lamps ====================================================================================================================
/// A street lamp: a tapered steel column with a door section, a swept arm along +z and a lantern whose lens (1.7 m out, as entities/lamp.lua lights it) glows.
function lamp() {
  const s = shape("column", "#70767c", PAINTED), l = shape("lens", "#ffe6b0", GLASS, { emissive: 1 });
  spin(s, [[0.2, -0.08], [0.2, -0.02], [0.105, 0.0], [0.105, 1.05], [0.078, 1.2], [0.055, 5.15]], [0, 0], 8, { colors: (i) => (i < 2 ? "#5d6268" : "#70767c") });
  pipe(s, [[0, 5.15, 0], [0, 5.6, 0.07], [0, 5.83, 0.4], [0, 5.89, 0.95], [0, 5.86, 1.32]], 0.048, 6, { radii: [0.055, 0.052, 0.048, 0.044, 0.042], up: [1, 0, 0] });
  placed(s, { move: [0, 5.82, 1.66], rx: 3 }, () => {
    chamferBox(s, [-0.17, -0.07, -0.42], [0.17, 0.07, 0.4], 0.045, { color: "#5d6268", colors: { U: "#676c72" } });
  });
  placed(l, { move: [0, 5.82, 1.66], rx: 3 }, () => { box(l, [-0.115, -0.085, -0.12], [0.115, -0.068, 0.33], { skip: "U" }); });
  return model("lamp", [s, l]);
}
/// A modern lighting column: a square post (it stands 0.64 m behind the origin, as the old one did) with a flat LED head reaching forward over the origin.
function lightPost() {
  const s = shape("column", "#4a4f55", PAINTED), l = shape("lens", "#eef3ff", GLASS, { emissive: 1 }), z = -0.64;
  box(s, [-0.16, -0.09, z - 0.16], [0.16, -0.03, z + 0.16], { skip: "D", color: "#3c4046" });
  prism(s, rect(-0.085, z - 0.085, 0.085, z + 0.085), "y", -0.03, 1.3, { caps: "" });
  s.group++;
  for (const [a, b] of [[[-1, -1], [1, -1]], [[1, -1], [1, 1]], [[1, 1], [-1, 1]], [[-1, 1], [-1, -1]]]) face(s, [[a[0] * 0.085, 1.3, z + a[1] * 0.085], [b[0] * 0.085, 1.3, z + b[1] * 0.085], [b[0] * 0.06, 6.72, z + b[1] * 0.06], [a[0] * 0.06, 6.72, z + a[1] * 0.06]], [a[0] + b[0], 0, a[1] + b[1]]);
  // the head: an arm rising a little to a slim flat lantern
  prism(s, [[z - 0.06, 6.72], [z + 0.06, 6.66], [-0.18, 6.76], [0.8, 6.8], [0.8, 6.87], [-0.18, 6.9], [z - 0.06, 6.86]], "x", -0.06, 0.06, { color: "#4a4f55" });
  box(s, [-0.2, 6.79, -0.12], [0.2, 6.9, 0.8], { color: "#3c4046", colors: { U: "#565b61" } });
  box(l, [-0.16, 6.775, -0.04], [0.16, 6.79, 0.74], { skip: "U" });
  return model("light_post", [s, l]);
}

// ================================ over the road ============================================================================================================
/// The scaffold-truss portal the start arch and the gantry share: two lattice towers on ballasted outriggers and a lattice beam across.
function portal(s, ballast) {
  for (const sx of [-1, 1]) {
    truss(s, [sx * 6.95, 0.02, 0], [sx * 6.95, 6.86, 0], 0.86, 0.9, [1, 0, 0], [0, 0, 1], 7);
    for (const dx of [-0.43, 0.43]) tube(s, [sx * 6.95 + dx, 0.03, -1.08], [sx * 6.95 + dx, 0.03, 1.08], 0.045, 4);
    for (const sz of [-1, 1]) {
      tube(s, [sx * 6.95, 0.06, sz * 1.05], [sx * 6.95, 2.2, sz * 0.47], 0.03, 3);
      box(ballast, [sx * 6.95 - 0.5, -0.12, sz * 0.78 - 0.3], [sx * 6.95 + 0.5, 0.26, sz * 0.78 + 0.3], { skip: "D", colors: { U: shade(C_CONC, 1.05) } });
    }
  }
  truss(s, [-7.38, 7.3, 0], [7.38, 7.3, 0], 0.9, 0.84, [0, 0, 1], [0, 1, 0], 18);
}
/// A banner laced to the beam's two faces between x0 and x1: `paint`: (column, row) -> colour, cells `cell` wide, `rows` high.
function beamBanner(c, x0, x1, rows, cell, paint) {
  const cols = Math.round((x1 - x0) / cell), y1 = 7.3 + (rows * cell) / 2, g = (z) => Array.from({ length: rows + 1 }, (_, j) => Array.from({ length: cols + 1 }, (_, i) => [lerp(x0, x1, i / cols), y1 - j * cell, z]));
  sheet(c, g(0.5), { ref: [0, 0, 1], double: true, color: (j, i) => paint(i, j), back: () => "#8b8d8f" });
  sheet(c, g(-0.5), { ref: [0, 0, -1], double: true, color: (j, i) => paint(i, j), back: () => "#8b8d8f" });
}
function startArch() {
  const s = shape("truss", C_GALV, GALV), b = shape("ballast", C_CONC_D, CONCRETE), c = shape("banner", "#ebe9e2", CANVAS);
  portal(s, b);
  beamBanner(c, -6.3, 6.3, 2, 0.36, (i, j) => ((i + j) % 2 ? "#17181b" : "#ebe9e2"));
  return model("start_arch", [s, b, c]);
}
function gantry() {
  const s = shape("truss", C_GALV, GALV), b = shape("ballast", C_CONC_D, CONCRETE), c = shape("banner", "#22364f", CANVAS), board = shape("light board", "#1a1b1e", MATT), lights = shape("lights", "#d2281e", GLASS, { emissive: 0.7 });
  portal(s, b);
  for (const sx of [-1, 1]) beamBanner(c, sx > 0 ? 1.9 : -6.22, sx > 0 ? 6.22 : -1.9, 3, 0.24, (i, j) => (j === 1 ? "#dcd9ce" : "#22364f"));
  box(board, [-1.62, 6.33, 0.5], [1.62, 7.98, 0.7], { colors: { S: "#111214" } });
  for (const x of [-1.62, 1.62]) tube(s, [x * 0.8, 7.3, -0.45], [x * 0.8, 7.3, 0.5], 0.04, 4);
  for (let i = 0; i < 5; i++) for (let j = 0; j < 2; j++) {
    const x = (i - 2) * 0.6, y = 6.78 + j * 0.74;
    placed(lights, { move: [x, y, 0.712], rx: 90 }, () => spin(lights, [[0.19, 0], [0, 0.02]], [0, 0], 8, { smooth: false }));
    placed(board, { move: [x, y, 0.7], rx: 90 }, () => { for (const p of [[[0.24, 0], [0.24, 0.16]], [[0.24, 0.16], [0.24, 0]]]) spin(board, p, [0, 0], 4, { arc: [200, 340], color: "#0c0d0f" }); });
  }
  return model("gantry", [s, b, c, board, lights]);
}
/// An inflatable arch in red and white panels, guyed to sandbags.
function gantryRound() {
  const s = shape("arch", "#a2423a", CANVAS), r = shape("guys", "#2b2e33", MATT), n = 26, pts = [];
  for (let i = 0; i <= n; i++) { const t = (i / n) * Math.PI; pts.push([10.3 * Math.cos(t), -0.12 + 10.32 * Math.pow(Math.sin(t), 0.82), 0]); }
  pipe(s, pts, 0.7, 10, { up: [0, 0, 1], caps: "ab", colors: (i) => ((i >> 1) % 2 ? "#e3e1d9" : "#a2423a") });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    tube(r, [sx * 9.55, 5.2, sz * 0.6], [sx * 10.2, 0.1, sz * 1.75], 0.02, 3);
    chamferBox(r, [sx * 10.2 - 0.3, -0.05, sz * 1.75 - 0.2], [sx * 10.2 + 0.3, 0.2, sz * 1.75 + 0.2], 0.06, { flat: true, color: "#8a8372" });
  }
  return model("gantry_round", [s, r]);
}

// ================================ stands ===================================================================================================================
/// A grandstand: a stepped concrete deck between raked side walls, ten rows of seats either side of a stair, a rail along the front; `kind` picks what is
/// over it: "open" a short steel canopy over the back rows, "covered" a slim steel roof hung from masts, "awning" canvas slung between three raked booms.
function stand(name, kind, seat, seat2) {
  const conc = shape("deck", C_CONC, CONCRETE), wall = shape("walls", "#d3d1c9", MATT), seats = shape("seats", seat, PLASTIC), steel = shape("steel", C_STEEL, DARKSTEEL), roof = shape("roof", "#c5c8cc", PAINTED), cloth = shape("canvas", C_CANVAS, CANVAS);
  const N = 10, zf = 4.4, dz = 0.85, y0 = 1.6, dy = 0.5, o = [[5.5, -0.11], [5.5, 1.1], [zf, 1.1]];
  for (let i = 0; i < N; i++) o.push([zf - i * dz, y0 + i * dy], [zf - (i + 1) * dz, y0 + i * dy]);
  const zb = zf - N * dz, yt = y0 + (N - 1) * dy;
  o.push([-5.3, yt], [-5.3, -0.11]);
  prism(conc, o, "x", -5.25, 5.25, { caps: "", skip: [o.length - 1], colors: (i) => (i === 0 ? "#c9c7bf" : i === o.length - 2 ? C_CONC_D : o[i][0] === o[i + 1][0] ? C_CONC_D : C_CONC) });
  const sideWall = [[5.5, -0.11], [5.5, 2.2], [zf, 2.62], [zb, yt + 1.1], [-5.5, yt + 1.1], [-5.5, -0.11]];
  for (const sx of [-1, 1]) prism(wall, sideWall, "x", sx > 0 ? 5.25 : -5.5, sx > 0 ? 5.5 : -5.25, { skip: [5], colors: (i) => (i >= 1 && i <= 3 ? "#bdbbb3" : "#d3d1c9") });
  box(wall, [-5.25, yt, -5.5], [5.25, yt + 1.1, -5.3], { skip: "DWE", colors: { U: "#bdbbb3" } });
  // the front rail
  for (let k = 0; k <= 6; k++) tube(steel, [-5.2 + k * (10.4 / 6), 1.1, 5.42], [-5.2 + k * (10.4 / 6), 2.15, 5.42], 0.03, 4);
  for (const y of [1.62, 2.15]) tube(steel, [-5.25, y, 5.42], [5.25, y, 5.42], 0.03, 4);
  // seats: a pan and a back along each row, in two blocks; half steps up the middle
  for (let i = 0; i < N; i++) {
    const zr = zf - (i + 1) * dz, y = y0 + i * dy, L = [[zr + 0.5, y + 0.3], [zr + 0.5, y + 0.42], [zr + 0.13, y + 0.42], [zr + 0.1, y + 0.84], [zr + 0.03, y + 0.84], [zr + 0.03, y + 0.3]], c = i % 5 === 2 ? seat2 : seat;
    for (const [a, b] of [[-5.1, -0.55], [0.55, 5.1]]) prism(seats, L, "x", a, b, { skip: [5], colors: (e) => (e === 1 ? shade(c, 1.12) : e === 3 ? shade(c, 1.08) : c), capColor: shade(c, 0.85) });
    if (i < N - 1) box(conc, [-0.55, y, zr], [0.55, y + dy / 2, zr + 0.4], { skip: "DNWE", colors: { U: C_CONC, S: C_CONC_D } });
  }
  const cols = [-5.0, -1.68, 1.68, 5.0];
  if (kind === "open") {
    for (const x of cols) { tube(steel, [x, yt, -5.05], [x, 9.3, -5.05], 0.11, 4, { turn: 45 }); prism(steel, [[-5.2, 8.8], [-0.95, 9.48], [-0.95, 9.6], [-5.2, 9.3]], "x", x - 0.07, x + 0.07); }
    prism(roof, [[-5.5, 9.3], [-0.8, 9.61], [-0.8, 9.75], [-5.5, 9.44]], "x", -5.5, 5.5, { colors: (i) => (i === 0 ? "#4d5258" : i === 2 ? "#c5c8cc" : "#e2e0d8"), capColor: "#e2e0d8" });
  } else if (kind === "covered") {
    for (const x of cols) {
      tube(steel, [x, yt, -5.05], [x, 12.94, -5.05], 0.12, 4, { turn: 45, caps: "b" });
      prism(steel, [[-5.2, 9.55], [5.35, 11.6], [5.35, 11.74], [-5.2, 10.36]], "x", x - 0.08, x + 0.08);
      tube(steel, [x, 12.85, -5.05], [x, 11.55, 2.2], 0.03, 3);
      tube(steel, [x, 12.85, -5.05], [x, 10.6, -5.5], 0.03, 3);
    }
    prism(roof, [[-5.61, 10.34], [5.61, 11.74], [5.61, 11.92], [-5.61, 10.52]], "x", -5.5, 5.5, { colors: (i) => (i === 0 ? "#4d5258" : i === 2 ? "#c5c8cc" : "#e2e0d8"), capColor: "#e2e0d8" });
  } else {
    const booms = [-5.3, 0, 5.3], at = (x, t) => [x, lerp(8.4, 15.05, t), lerp(-5.15, 3.9, t)];
    for (const x of booms) {
      tube(steel, [x, yt, -5.15], [x, 8.5, -5.15], 0.12, 4, { turn: 45 });
      tube(steel, at(x, 0), at(x, 1), 0.15, 4, { r1: 0.09, caps: "b", turn: 45 });
      tube(steel, [x, yt + 1.1, -4.2], at(x, 0.3), 0.07, 4);
      tube(steel, [x, 8.5, -5.15], at(x, 1), 0.02, 3);
    }
    for (let k = 0; k < 2; k++) {
      const g = [];
      for (let i = 0; i <= 6; i++) { const row = [], t = lerp(0.1, 0.99, i / 6); for (let j = 0; j <= 5; j++) { const v = j / 5, p = lerp3(at(booms[k], t), at(booms[k + 1], t), v); row.push([p[0], p[1] - 0.95 * Math.sin(v * Math.PI) * (0.55 + 0.45 * t), p[2]]); } g.push(row); }
      sheet(cloth, g, { ref: [0, 1, -0.3], double: true, smooth: true, color: () => C_CANVAS, back: () => shade(C_CANVAS, 0.92) });
    }
  }
  return model(name, [conc, wall, seats, steel, roof, cloth]);
}

// ================================ buildings ================================================================================================================
const GLASS_COL = "#2b3a4a", glassCut = (o = {}) => ({ color: GLASS_COL, ...GLASS, depth: 0.07, wall: "#3b3f45", facing: 0.9, name: "glass", ...o });
/// A row of panes cut into a wall seen from `view`: from a0 to a1 across, y0 to y1, `n` panes with `gap` of frame between.
function panes(s, view, a0, a1, y0, y1, n, gap = 0.12, o = {}) {
  const w = (a1 - a0 - gap * (n - 1)) / n;
  for (let i = 0; i < n; i++) cut(s, view, rect(a0 + i * (w + gap), y0, a0 + i * (w + gap) + w, y1), glassCut(o));
}
/// Race control: a concrete stair tower, a glazed control room standing out over it, a mast with aerials and a plain flag.
function tower() {
  const base = shape("tower", "#cfcdc5", CONCRETE), deck = shape("deck", "#3b3f45", PAINTED), room = shape("control room", "#dedcd4", PAINTED), top = shape("roof", "#c5c8cc", PAINTED), mast = shape("mast", C_GALV, GALV), fl = shape("flag", "#a2423a", CLOTH);
  box(base, [-2.5, 0, -1.88], [2.5, 5.63, 1.88], { skip: "DU" });
  cut(base, "front", rect(-0.55, 0, 0.55, 2.15), { color: "#4a4f55", depth: 0.1, wall: "#3b3f45", facing: 0.9, metallic: 0.4, roughness: 0.5, name: "door" });
  for (const y of [2.75, 4.2]) { panes(base, "front", -2.0, 2.0, y, y + 0.75, 4, 0.5); panes(base, "back", -2.0, 2.0, y, y + 0.75, 4, 0.5); }
  cut(base, "side", rect(-0.35, 0.6, 0.35, 5.0), glassCut());
  box(base, [-2.56, 0, -1.94], [2.56, 0.35, 1.94], { skip: "DU", color: "#a9a79f" });
  box(deck, [-2.88, 5.63, -2.25], [2.88, 6.0, 2.25], { colors: { U: "#6a6f75" } });
  box(room, [-2.6, 6.0, -1.97], [2.6, 7.75, 1.97], { skip: "DU" });
  panes(room, "front", -2.45, 2.45, 6.45, 7.55, 5, 0.1); panes(room, "back", -2.45, 2.45, 6.45, 7.55, 5, 0.1); panes(room, "side", -1.82, 1.82, 6.45, 7.55, 4, 0.1);
  box(top, [-2.88, 7.75, -2.25], [2.88, 8.0, 2.25], { colors: { D: "#8d9197", U: "#b4b7bb" } });
  box(top, [-1.2, 8.0, -1.3], [0.2, 8.45, -0.2], { skip: "D", color: "#9a9ea3" });
  tube(mast, [0, 8.0, 0], [0, 10.56, 0], 0.05, 6, { r1: 0.03, caps: "b" });
  for (const [y, w] of [[8.9, 0.5], [9.2, 0.35]]) tube(mast, [0, y, -w], [0, y, w], 0.018, 3);
  const g = [];
  for (let j = 0; j <= 2; j++) { const row = []; for (let i = 0; i <= 4; i++) { const f = i / 4; row.push([0.06 + 1.84 * f, 10.48 - j * 0.53, 0.09 * f * Math.sin(f * 5 + j * 0.8)]); } g.push(row); }
  sheet(fl, g, { ref: [0, 0, 1], double: true, smooth: true });
  return model("tower", [base, deck, room, top, mast, fl], { colliders: [{ x: 0, z: 0, r: 52.8 }] });
}
/// A pit garage: two open bays under a glazed upper floor that stands out over the pit lane.
function garage() {
  const shell = shape("walls", "#d0cec6", CONCRETE), inside = shape("inside", "#8d9197", MATT), upper = shape("upper floor", "#dedcd4", PAINTED), trim = shape("trim", "#3b3f45", PAINTED), kit = shape("tool chest", "#8f2f2a", PAINTED), lamps = shape("strip lights", "#f2f4ff", GLASS, { emissive: 0.9 });
  const z0 = -6.54, z1 = 5.46, h = 5.1;
  box(shell, [-6, -0.12, z0], [6, h, z1], { skip: "DUS" });
  // the front: piers either side and in the middle, a lintel above the doors
  for (const [a, b] of [[-6, -5.45], [-0.3, 0.3], [5.45, 6]]) box(shell, [a, -0.12, z1 - 0.3], [b, 4.3, z1], { skip: "DUN" + (a === -6 ? "W" : "") + (b === 6 ? "E" : "") });
  box(shell, [-6, 4.3, z1 - 0.3], [6, h, z1], { skip: "UNWE", colors: { S: "#c2c0b8" } });
  for (const [a, b] of [[-5.45, -0.3], [0.3, 5.45]]) {
    // inside each bay: floor, walls, ceiling (seen from within), a rolled-up door, a tool chest and a strip light
    const P = [[a, 0.01, z0 + 0.3], [b, 4.3, z1 - 0.3]];
    face(inside, [[a, 0.01, P[0][2]], [b, 0.01, P[0][2]], [b, 0.01, z1], [a, 0.01, z1]], [0, 1, 0], { color: "#9a9da1" });
    face(inside, [[a, 0.01, P[0][2]], [b, 0.01, P[0][2]], [b, 4.3, P[0][2]], [a, 4.3, P[0][2]]], [0, 0, 1], { color: "#b9b8b2" });
    face(inside, [[a, 4.3, P[0][2]], [b, 4.3, P[0][2]], [b, 4.3, z1 - 0.3], [a, 4.3, z1 - 0.3]], [0, -1, 0], { color: "#77797c" });
    face(inside, [[a, 0.01, P[0][2]], [a, 0.01, z1 - 0.3], [a, 4.3, z1 - 0.3], [a, 4.3, P[0][2]]], [1, 0, 0], { color: "#a9a8a2" });
    face(inside, [[b, 0.01, P[0][2]], [b, 0.01, z1 - 0.3], [b, 4.3, z1 - 0.3], [b, 4.3, P[0][2]]], [-1, 0, 0], { color: "#a9a8a2" });
    box(trim, [a, 3.95, z1 - 0.28], [b, 4.3, z1 - 0.02], { skip: "UWE", color: "#55595f" });
    const m = (a + b) / 2;
    box(kit, [m + 1.1, 0.01, P[0][2] + 0.05], [m + 2.3, 1.05, P[0][2] + 0.6], { skip: "DN", colors: { U: "#2b2e33" } });
    box(lamps, [m - 1.4, 4.24, -1.2], [m + 1.4, 4.3, -1.0], { skip: "U" });
  }
  // the upper floor: a glazed front standing 1.08 m out, a dark fascia under it and a thin roof
  box(upper, [-6, h + 0.3, z0], [6, 7.95, 6.3], { skip: "DU" });
  panes(upper, "front", -5.6, 5.6, 5.95, 7.5, 8, 0.12);
  panes(upper, "side", -5.2, 5.6, 5.95, 7.5, 6, 0.6);
  box(trim, [-6, h, z0], [6, h + 0.3, 6.54], { colors: { U: "#6a6f75" } });
  box(trim, [-6, 7.95, z0], [6, 8.28, 6.54], { colors: { U: "#8d9197" } });
  return model("garage", [shell, inside, upper, trim, kit, lamps]);
}
/// The pit office: a glazed pavilion under a deep flat roof with a plant screen; `storey`: a set-back upper floor under a mono-pitch roof.
function pitsOffice(name, storey) {
  const walls = shape("walls", "#d9d7d0", MATT), roof = shape("roof", "#3b3f45", PAINTED), plant = shape("plant", "#9a9ea3", GALV), up = shape("upper floor", "#d0cec6", PAINTED);
  box(walls, [-5.9, -0.12, -6.14], [5.9, 4.0, 5.76], { skip: "DU" });
  box(walls, [-5.96, -0.12, -6.2], [5.96, 0.45, 5.82], { skip: "DU", color: "#a9a79f" });
  panes(walls, "front", -5.38, 5.38, 0.76, 3.62, 6, 0.14);
  panes(walls, "side", -5.2, 4.8, 1.2, 3.4, 5, 0.9);
  cut(walls, "back", rect(-0.6, 0.45, 0.6, 2.6), { color: "#4a4f55", depth: 0.08, wall: "#3b3f45", facing: 0.9, metallic: 0.4, roughness: 0.5, name: "door" });
  box(roof, [-6, 3.98, -6.24], [6, 4.5, 6.24], { colors: { U: "#6a6f75", D: "#c9c7bf" } });
  if (!storey) {
    box(plant, [-3.2, 4.5, -3.4], [3.2, 6.0, 2.6], { skip: "D", colors: { U: "#7d8288" } });
    for (const view of ["front", "back"]) for (let k = 0; k < 5; k++) cut(plant, view, rect(-3.0, 4.72 + k * 0.25, 3.0, 4.82 + k * 0.25), { color: "#5b6066", depth: 0.05, wall: "#4a4f55", facing: 0.9, name: "louvre" });
  } else {
    box(up, [-5.32, 4.5, -5.59], [5.32, 8.2, 5.59], { skip: "DU" });
    panes(up, "front", -4.9, 4.9, 5.1, 7.5, 6, 0.14);
    panes(up, "side", -4.9, 4.9, 5.4, 7.2, 5, 0.7);
    prism(roof, [[-6.1, 8.1], [6.1, 9.85], [6.1, 10.1], [-6.1, 8.35]], "x", -5.43, 5.43, { colors: (i) => (i === 0 ? "#c9c7bf" : i === 2 ? "#6a6f75" : "#3b3f45") });
    // the wedge of wall between the flat top of the floor and the sloping roof
    for (const sx of [-1, 1]) face(up, [[sx * 5.32, 8.2, -5.59], [sx * 5.32, 8.2, 5.59], [sx * 5.32, 9.75, 5.59], [sx * 5.32, 8.2, -5.59]], [sx, 0, 0]);
    face(up, [[-5.32, 8.2, 5.59], [5.32, 8.2, 5.59], [5.32, 9.76, 5.59], [-5.32, 9.76, 5.59]], [0, 0, 1], { color: GLASS_COL });
  }
  return model(name, [walls, roof, plant, up]);
}
/// A marquee: aluminium legs, a hipped canvas roof that sags between ridge and eave, a coloured valance; `walls`: canvas at the back and the ends.
function tent(name, w, d, eave, peak, trim, walls) {
  const al = shape("frame", "#c4c7cb", GALV), c = shape("canvas", C_CANVAS, CANVAS), hw = w / 2 - 0.05, hd = d / 2 - 0.05, nx = w > d ? 8 : 6, nz = w > d ? 4 : 6;
  const xs = w > d ? [-hw, 0, hw] : [-hw, hw];
  for (const x of xs) for (const z of [-hd, hd]) { tube(al, [x, -0.05, z], [x, eave, z], 0.04, 4, { turn: 45 }); box(al, [x - 0.1, -0.05, z - 0.1], [x + 0.1, -0.02, z + 0.1], { skip: "D" }); }
  for (const z of [-hd, hd]) tube(al, [-hw, eave - 0.03, z], [hw, eave - 0.03, z], 0.035, 4);
  for (const x of [-hw, hw]) tube(al, [x, eave - 0.03, -hd], [x, eave - 0.03, hd], 0.035, 4);
  const H = (x, z) => { const f = Math.max(0, Math.min(1 - Math.abs(z) / (d / 2), (w / 2 - Math.abs(x)) / (d / 2))); return eave + (peak - eave) * f - 0.16 * Math.sin(f * Math.PI) * (peak - eave) * 0.5; };
  const g = [];
  for (let j = 0; j <= nz; j++) { const row = []; for (let i = 0; i <= nx; i++) { const x = lerp(-w / 2, w / 2, i / nx), z = lerp(-d / 2, d / 2, j / nz); row.push([x, H(x, z), z]); } g.push(row); }
  sheet(c, g, { ref: [0, 1, 0], double: true, ridge: true, color: () => C_CANVAS, back: () => shade(C_CANVAS, 0.74) });
  // the valance, hanging a hand below the eave all round
  const ring = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
  for (let k = 0; k < 4; k++) { const a = ring[k], b = ring[(k + 1) % 4]; plate(c, [[a[0], eave - 0.28, a[1]], [b[0], eave - 0.28, b[1]], [b[0], eave, b[1]], [a[0], eave, a[1]]], [(a[0] + b[0]) / 2, 0, (a[1] + b[1]) / 2], { color: trim }); }
  if (walls) for (const [a, b] of [[ring[0], ring[1]], [ring[1], ring[2]], [ring[3], ring[0]]]) {
    const out = unit([(a[0] + b[0]) / 2, 0, (a[1] + b[1]) / 2]), wg = [], n = Math.abs(a[0] - b[0]) > 6 ? 6 : 4;
    for (let j = 0; j <= 2; j++) { const row = []; for (let i = 0; i <= n; i++) { const t = i / n, bel = 0.06 * Math.sin(t * Math.PI * (n / 2)) * Math.sin((j / 2) * Math.PI); row.push([lerp(a[0], b[0], t) * 0.99 + out[0] * bel, lerp(eave - 0.2, -0.04, j / 2), lerp(a[1], b[1], t) * 0.99 + out[2] * bel]); } wg.push(row); }
    sheet(c, wg, { ref: out, double: true, smooth: true, color: () => shade(C_CANVAS, 0.97), back: () => shade(C_CANVAS, 0.8) });
  }
  return model(name, [al, c]);
}
/// A television camera on a scaffold platform, its long lens along +z.
function cameraTower() {
  const s = shape("scaffold", C_GALV, GALV), d = shape("deck", "#5a4a36", MATT), cam = shape("camera", "#2b2e33", PLASTIC), lens = shape("lens", "#1a2430", GLASS);
  const legs = [[-0.47, -0.72], [0.47, -0.72], [0.47, 0.72], [-0.47, 0.72]];
  for (const [x, z] of legs) tube(s, [x, -0.1, z], [x, 3.2, z], 0.03, 4);
  for (const y of [0.4, 2.12, 2.7, 3.2]) for (let f = 0; f < 4; f++) if (!(y > 2.2 && f === 0)) tube(s, [legs[f][0], y, legs[f][1]], [legs[(f + 1) % 4][0], y, legs[(f + 1) % 4][1]], 0.025, 3);
  for (let f = 0; f < 4; f++) tube(s, [legs[f][0], 0.4, legs[f][1]], [legs[(f + 1) % 4][0], 2.12, legs[(f + 1) % 4][1]], 0.02, 3);
  box(d, [-0.5, 2.14, -0.75], [0.5, 2.2, 0.75], { colors: { U: "#6b5a44" } });
  for (let k = 0; k < 6; k++) tube(s, [-0.3, 0.3 + k * 0.33, -0.76], [0.3, 0.3 + k * 0.33, -0.76], 0.016, 3);
  tube(cam, [0, 2.2, 0.15], [0, 3.28, 0.15], 0.045, 6);
  for (const a of [30, 150, 270]) tube(cam, [0, 2.75, 0.15], [0.33 * Math.cos(rad(a)), 2.21, 0.15 + 0.33 * Math.sin(rad(a))], 0.02, 3);
  chamferBox(cam, [-0.15, 3.28, -0.25], [0.15, 3.62, 0.45], 0.04, { colors: { U: "#3a3d43" } });
  tube(cam, [0, 3.45, 0.45], [0, 3.45, 1.0], 0.085, 8, { color: "#1f2125" });
  tube(cam, [0, 3.45, 1.0], [0, 3.45, 1.29], 0.105, 8, { r1: 0.125, color: "#17181b" });
  placed(lens, { move: [0, 3.45, 1.24], rx: 90 }, () => spin(lens, [[0.11, 0], [0, 0]], [0, 0], 8, { smooth: false }));
  box(cam, [-0.06, 3.62, -0.2], [0.06, 3.78, 0.05], { skip: "D", color: "#1f2125" });
  tube(cam, [0, 3.36, -0.25], [0, 3.2, -0.6], 0.015, 3);
  return model("camera_tower", [s, d, cam, lens]);
}
/// A satellite uplink: a dish on a pedestal beside its equipment case, pointed up and along +z.
function radar() {
  const base = shape("case", "#9a9ea3", PAINTED), dish = shape("dish", "#e3e1d9", PAINTED), st = shape("steel", C_STEEL, DARKSTEEL);
  chamferBox(base, [-1.48, -0.05, -1.0], [-0.1, 0.95, 0.2], 0.05, { flat: true, colors: { U: "#aeb2b6" } });
  for (const view of ["front"]) for (let k = 0; k < 4; k++) cut(base, view, rect(-1.3, 0.2 + k * 0.16, -0.3, 0.27 + k * 0.16), { color: "#5b6066", depth: 0.03, wall: "#4a4f55", facing: 0.9, name: "louvre" });
  box(st, [0.0, -0.05, -0.75], [1.5, 0.08, 0.75], { skip: "D", color: "#4a4f55" });
  tube(st, [0.72, 0.08, 0], [0.72, 1.35, 0], 0.09, 6);
  tube(st, [0.72, 1.3, -0.5], [0.72, 1.55, 0.05], 0.05, 4);
  const R = 1.0, bowl = [], n = 5;
  for (let i = 0; i <= n; i++) { const r = (R * i) / n; bowl.push([r, 0.22 * (r / R) ** 2]); }
  placed(dish, { move: [0.72, 1.62, 0.02], rx: 52 }, () => {
    spin(dish, bowl, [0, 0], 14, { color: "#8d9197" });                                   // the back, seen from behind
    spin(dish, bowl.map(([r, y]) => [r, y + 0.012]).reverse(), [0, 0], 14, { color: "#e3e1d9" }); // the bowl
  });
  placed(st, { move: [0.72, 1.62, 0.02], rx: 52 }, () => {
    for (const a of [90, 210, 330]) tube(st, [0.82 * Math.cos(rad(a)), 0.16, 0.82 * Math.sin(rad(a))], [0, 0.95, 0], 0.014, 3);
    tube(st, [0, 0.85, 0], [0, 1.02, 0], 0.07, 6, { caps: "ab", color: "#3b3f45" });
  });
  return model("radar", [base, dish, st]);
}
/// A grid box painted on the road: a bar across the front and a line down each side.
function gridBox() {
  const s = shape("paint", "#e4e2da", PAINTLINE);
  box(s, [-1.3, 0, 2.21], [1.3, 0.02, 2.4], { skip: "D" }); box(s, [-1.3, 0, 0.78], [-1.11, 0.02, 2.21], { skip: "DS" }); box(s, [1.11, 0, 0.78], [1.3, 0.02, 2.21], { skip: "DS" });
  return model("box", [s]);
}
/// A steering wheel, flat in the x-y plane (the menus slide rows of them behind the cars, tinted dark).
function steeringWheel() {
  const s = shape("wheel", "#2a2c31", RUBBER), R = 0.895, a = 0.075, ring = Array.from({ length: 7 }, (_, i) => [R + a * Math.sin((i / 6) * 2 * Math.PI), -a * Math.cos((i / 6) * 2 * Math.PI)]);
  placed(s, { rx: 90 }, () => {
    spin(s, ring, [0, 0], 22);
    for (const ang of [8, 172, 270]) placed(s, { ry: -ang }, () => box(s, [0.2, -0.045, -0.1], [R - 0.03, 0.045, 0.1], { skip: "WE", colors: { U: "#34373d", D: "#34373d" } }));
    spin(s, [[0, -0.07], [0.3, -0.07], [0.3, 0.07], [0, 0.07]], [0, 0], 10, { colors: (i) => (i === 1 ? "#232529" : "#303238"), split: true });
  });
  return model("wheel", [s]);
}

// ================================ spectators ===============================================================================================================
// A person is one skinned mesh on seven bones (the names the old models had, so anything that poses them still does): hips and legs, a torso, arms that hang
// at the sides at rest, a head. The models are half life size, as the old ones were: the scenes draw spectators about twice their size (`sx` near 2).
const BONES = ["root", "root/leg-left", "root/leg-right", "root/torso", "root/torso/arm-left", "root/torso/arm-right", "root/torso/head"], [B_ROOT, B_LEGL, B_LEGR, B_TORSO, B_ARML, B_ARMR, B_HEAD] = [0, 1, 2, 3, 4, 5, 6];
/// Rings joined into a limb. A ring: { c: [x, y, z], rx, rz, w: bone, color: of the band above it }.
function limb(s, rings, n, o = {}) {
  s.group++;
  const turn = Math.PI / n, pt = (r, k) => { const t = turn + (k / n) * 2 * Math.PI; return [r.c[0] + r.rx * Math.cos(t), r.c[1], r.c[2] + r.rz * Math.sin(t), r.w]; };
  for (let i = 0; i < rings.length - 1; i++) for (let k = 0; k < n; k++) {
    const a = rings[i], b = rings[i + 1], tm = turn + ((k + 0.5) / n) * 2 * Math.PI, col = typeof a.color === "function" ? a.color(tm) : a.color;
    face(s, [pt(a, k), pt(a, k + 1), pt(b, k + 1), pt(b, k)], [Math.cos(tm), 0.001, Math.sin(tm)], { color: col, smooth: true });
  }
  const cap = (r, up, color) => face(s, Array.from({ length: n }, (_, k) => pt(r, k)), [0, up, 0], { color, smooth: o.softCaps });
  if (o.bottom) cap(rings[0], -1, o.bottom);
  if (o.top) cap(rings[rings.length - 1], 1, o.top);
}
function person(p) {
  const s = shape("body-mesh", p.top, CLOTH), k = (p.h / 1.75) * 0.5, f = p.female, W = p.build ?? 1, skin = p.skin, shoe = p.shoes ?? "#2b2b2e";
  s.skin = BONES.map((b) => `person/${b}`);
  s.weight = B_ROOT;
  placed(s, { scale: k }, () => {
    const R = (y, rx, rz, w, color, c = [0, 0]) => ({ c: [c[0], y, c[1]], rx: rx * W, rz: rz * W, w, color });
    const below = p.legs === "skirt" ? p.bottom : p.bottom, hipTop = p.dress ? p.bottom : p.top;
    // hips, torso, neck
    limb(s, [R(0.83, 0.158, 0.1, B_ROOT, below), R(0.97, f ? 0.172 : 0.165, 0.118, B_ROOT, below), R(1.05, f ? 0.15 : 0.158, 0.106, B_TORSO, hipTop), R(1.18, f ? 0.128 : 0.15, 0.098, B_TORSO, hipTop),
      R(1.32, f ? 0.16 : 0.178, f ? 0.118 : 0.112, B_TORSO, hipTop), R(1.43, f ? 0.168 : 0.19, 0.098, B_TORSO, p.collar ?? hipTop), R(1.485, 0.062, 0.06, B_TORSO, skin), R(1.535, 0.05, 0.052, B_TORSO, skin)], 8, { bottom: below });
    if (p.legs === "skirt") limb(s, [R(0.56, 0.235, 0.185, B_ROOT, p.bottom), R(1.0, 0.176, 0.124, B_ROOT, p.bottom)], 8, { bottom: shade(p.bottom, 0.55) });
    // legs and shoes
    for (const [sx, w] of [[1, B_LEGL], [-1, B_LEGR]]) {
      const c = [sx * 0.088, 0], upper = p.legs === "skirt" ? skin : p.bottom, lower = p.legs === "trousers" ? p.bottom : skin;
      limb(s, [R(0.1, 0.043, 0.05, w, lower, c), R(0.5, 0.058, 0.064, w, upper, c), R(0.86, 0.076, 0.09, w, upper, c)], 6);
      s.weight = w; chamferBox(s, [sx * 0.088 - 0.052, 0, -0.075], [sx * 0.088 + 0.052, 0.105, 0.175], 0.025, { flat: true, color: shoe }); s.weight = B_ROOT;
    }
    // arms: shoulder, elbow, wrist, hand
    for (const [sx, w] of [[1, B_ARML], [-1, B_ARMR]]) {
      const sleeve = p.sleeves === "long" ? p.top : skin;
      limb(s, [R(0.77, 0.026, 0.034, w, skin, [sx * 0.25, 0.045]), R(0.88, 0.033, 0.036, w, sleeve, [sx * 0.248, 0.03]), R(1.13, 0.043, 0.045, w, p.top, [sx * 0.24, 0]), R(1.4, 0.053, 0.056, w, p.top, [sx * 0.215, 0])], 6, { bottom: skin, top: p.top, softCaps: true });
    }
    // head and hair
    const hair = p.hair, hat = p.hat, crown = hat ?? hair, back = (t) => (Math.sin(t) < 0.35 ? hair : skin), H = [0, 0.012];
    limb(s, [R(1.53, 0.055, 0.062, B_HEAD, skin, H), R(1.58, 0.086, 0.097, B_HEAD, p.style === "bald" ? skin : back, H), R(1.66, 0.1, 0.113, B_HEAD, p.style === "bald" ? back : crown, H), R(1.735, 0.09, 0.103, B_HEAD, crown, H), R(1.782, 0.048, 0.055, B_HEAD, crown, H)], 8, { top: crown, softCaps: true });
    s.weight = B_HEAD;
    if (p.style === "long") chamferBox(s, [-0.098, 1.36, -0.125], [0.098, 1.66, -0.045], 0.03, { color: hair, smooth: true });
    if (p.style === "bun") spin(s, [[0, 1.7], [0.05, 1.735], [0.05, 1.775], [0, 1.81]], [0, -0.075], 6, { color: hair });
    if (p.style === "tail") { tube(s, [0, 1.7, -0.1], [0, 1.5, -0.17], 0.035, 5, { r1: 0.018, color: hair, caps: "b" }); }
    if (p.hat && p.brim) { s.group++; plate(s, [[-0.075, 1.668, 0.09], [0.075, 1.668, 0.09], [0.06, 1.655, 0.215], [-0.06, 1.655, 0.215]], [0, 1, 0], { color: shade(p.hat, 0.85) }); }
    s.weight = B_ROOT;
  });
  const O = (x, y, z) => [u(x * k), u(y * k), u(z * k)], part = (name, origin, children = []) => ({ name, origin, rotation: [0, 0, 0], cubes: [], children });
  const tree = { name: "person", origin: [0, 0, 0], rotation: [0, 0, 0], cubes: [], children: [
    part("root", [0, 0, 0], [part("leg-left", O(0.088, 0.93, 0)), part("leg-right", O(-0.088, 0.93, 0)), part("torso", O(0, 0.98, 0), [part("arm-left", O(0.215, 0.44, 0)), part("arm-right", O(-0.215, 0.44, 0)), part("head", O(0, 0.54, 0.005))])]),
    { name: "body-mesh", origin: [0, 0, 0], rotation: [0, 0, 0], cubes: [cubeOf(s)], children: [] },
  ] };
  return { version: 1, scale: 1 / U, parts: [tree], clips: clipsFor(p.idle) };
}
// What a spectator does: each clip turns the torso, the arms and the head (degrees; at rest the arms hang down, +z about the shoulder lifts the left arm out).
const MOVES = {
  // looking along the road and back
  watch: { duration: 2.4, torso: (a) => [1.2 * Math.sin(a), 7 * Math.sin(a), 0], head: (a) => [0, 24 * Math.sin(a), 0], left: (a) => [0, 0, 5 + 2 * Math.sin(a)], right: (a) => [0, 0, -5 - 2 * Math.sin(a)] },
  // both arms up, pumping
  cheer: { duration: 0.8, torso: (a) => [3 * Math.sin(a), 0, 0], head: () => [-8, 0, 0], left: (a) => [-12, 0, 152 + 13 * Math.sin(a)], right: (a) => [-12, 0, -152 - 13 * Math.sin(a + 0.7)] },
  // clapping, arms out in front
  clap: { duration: 0.5, torso: (a) => [2 + Math.sin(a), 0, 0], head: () => [-4, 0, 0], left: (a) => [-66, -17 - 12 * Math.sin(a), 0], right: (a) => [-66, 17 + 12 * Math.sin(a), 0] },
  // one arm waving overhead
  wave: { duration: 1.0, torso: (a) => [0, 0, 2.5 * Math.sin(a)], head: (a) => [-5, 6 * Math.sin(a), 0], left: () => [0, 0, 6], right: (a) => [-8, 0, -148 + 24 * Math.sin(a)] },
};
function clipsFor(idle) {
  const path = { torso: ["person", "root", "torso"], head: ["person", "root", "torso", "head"], left: ["person", "root", "torso", "arm-left"], right: ["person", "root", "torso", "arm-right"] }, r4 = (v) => Math.round(v * 10000) / 10000;
  const clip = (name, m, n = 8) => ({ name, duration: m.duration, loop: true, tracks: Object.entries(path).map(([k, part]) => ({ part, prop: "rotation", keys: Array.from({ length: n + 1 }, (_, i) => ({ t: r4((m.duration * i) / n), value: m[k]((i / n) * 2 * Math.PI).map(r2) })) })) });
  const still = { duration: 0.1, torso: () => [0, 0, 0], head: () => [0, 0, 0], left: () => [0, 0, 0], right: () => [0, 0, 0] };
  return [clip("static", still, 1), clip("idle", MOVES[idle]), ...Object.entries(MOVES).map(([name, m]) => clip(name, m))];
}
const PEOPLE = {
  crowd_fa: { female: true, h: 1.64, skin: "#c98f6b", hair: "#3a2a20", style: "long", top: "#9c4a41", dress: false, bottom: "#2f3a52", legs: "trousers", sleeves: "short", shoes: "#d9d6cc", idle: "cheer" },
  crowd_fb: { female: true, h: 1.6, skin: "#e3b392", hair: "#b0703a", style: "bun", top: "#c4b47a", bottom: "#4b5d7a", legs: "shorts", sleeves: "short", shoes: "#7a4b3a", idle: "clap" },
  crowd_fc: { female: true, h: 1.67, skin: "#8a5a3e", hair: "#1c1715", style: "tail", hat: "#d9d6cc", brim: true, top: "#3f6f5a", bottom: "#23262d", legs: "trousers", sleeves: "long", shoes: "#2b2b2e", idle: "watch" },
  crowd_fd: { female: true, h: 1.62, skin: "#edc4a4", hair: "#6b4a2c", style: "long", top: "#5b7fa6", dress: true, bottom: "#5b7fa6", legs: "skirt", sleeves: "short", shoes: "#3a2f2a", idle: "wave" },
  crowd_ma: { h: 1.76, skin: "#d9a57e", hair: "#2a211b", style: "short", top: "#d9d6cc", bottom: "#33456a", legs: "trousers", sleeves: "short", shoes: "#2b2b2e", idle: "clap" },
  crowd_mb: { h: 1.72, build: 1.08, skin: "#e6b99a", hair: "#4a3a2c", style: "short", hat: "#9c4236", brim: true, top: "#2f3d57", bottom: "#6f6a5e", legs: "trousers", sleeves: "long", shoes: "#4a3a2c", idle: "watch" },
  crowd_mc: { h: 1.78, skin: "#7a4d35", hair: "#17130f", style: "bald", top: "#b07a45", bottom: "#3a3d43", legs: "shorts", sleeves: "short", shoes: "#d9d6cc", idle: "cheer" },
  crowd_md: { h: 1.7, build: 0.95, skin: "#d4a07a", hair: "#8a6a3a", style: "short", hat: "#2b2e33", top: "#6a7d5a", bottom: "#2a3040", legs: "trousers", sleeves: "long", shoes: "#2b2b2e", idle: "wave" },
};

// ================================ writing them ============================================================================================================
export const MODELS = {
  guardrail: () => guardrail("guardrail", [0.62], 0.84), rail_double: () => guardrail("rail_double", [0.62, 1.36], 1.58), barrier_wall: barrierWall,
  barrier_red: () => plasticBarrier("barrier_red", ["#a8443b", "#a8443b"]), barrier_white: () => plasticBarrier("barrier_white", ["#e3e1d9", "#e3e1d9"]),
  pylon, tires, hay_bale: hayBale, fence, sign_chevron: signChevron,
  flag_green: () => flag("flag_green", 4, 8, () => "#3a6b52"), flag_red: () => flag("flag_red", 4, 8, () => "#a2423a"),
  flag_checkers: () => flag("flag_checkers", 4, 13, (i, j) => ((i + j) % 2 ? "#17181b" : "#ebe9e2"), { colliders: [{ x: 0, z: 0, r: 4.8 }] }),
  banner_green: () => bannerTower("banner_green", "#3a6b52"), banner_red: () => bannerTower("banner_red", "#a2423a"),
  billboard: () => billboard("billboard", 8, 3.92, 7.92, 1.9, -1.9, BOARD_ART.stripes), billboard_low: () => billboard("billboard_low", 6, 0.95, 4.08, 1.43, -1.43, BOARD_ART.chequers),
  lamp, light_post: lightPost,
  start_arch: startArch, gantry, gantry_round: gantryRound,
  grandstand: () => stand("grandstand", "open", "#3d5873", "#9aa7b3"), grandstand_covered: () => stand("grandstand_covered", "covered", "#35604d", "#a9b5a6"), grandstand_awning: () => stand("grandstand_awning", "awning", "#8f3a33", "#c9b9a6"),
  tower, garage, pits_office: () => pitsOffice("pits_office", false), pits_office_roof: () => pitsOffice("pits_office_roof", true),
  tent: () => tent("tent", 6, 6, 2.5, 4.14, "#3d5873", false), tent_long: () => tent("tent_long", 10, 5, 2.15, 3.45, "#9c4236", false), tent_closed: () => tent("tent_closed", 10, 5, 2.15, 3.45, "#35604d", true),
  camera_tower: cameraTower, radar, grid_box: gridBox, steering_wheel: steeringWheel,
  ...Object.fromEntries(Object.entries(PEOPLE).map(([name, p]) => [name, () => person(p)])),
};
