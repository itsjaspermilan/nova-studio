// Shared helpers for the car and truck scripts: vector bits, the cage/box/panel shapes, the wheel, and `loft`, which models a body the way a
// car modeller does from blueprints: a half cage of cross-section rings along the length (edge loops where the surface turns), mirrored and
// subdivided, with creases on the hard lines. Units are 1/16 m, y up, the nose along +z; shapes are written in world heights (ground = 0)
// and shifted by the pivot (the height the body leans about), see `setPivot`.
export const r2 = (v) => Math.round(v * 100) / 100;
export const parse = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
export const hex = (c) => "#" + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
export const mul = (h, f) => hex(parse(h).map((v) => v * f));
export const lerp = (a, b, t) => a + (b - a) * t;
export const add = (a, b) => a.map((v, i) => v + b[i]);
export const sub = (a, b) => a.map((v, i) => v - b[i]);
export const scale = (a, k) => a.map((v) => v * k);
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };
/// A piecewise-linear value along z from [[z, value], ...] (sorted by z).
export const along = (nodes, z) => {
  if (z <= nodes[0][0]) return nodes[0][1];
  for (let i = 1; i < nodes.length; i++) if (z <= nodes[i][0]) return lerp(nodes[i - 1][1], nodes[i][1], (z - nodes[i - 1][0]) / (nodes[i][0] - nodes[i - 1][0] || 1));
  return nodes[nodes.length - 1][1];
};

export const PAINT = { metallic: 0.4, roughness: 0.28 }, GLASS = { metallic: 0.5, roughness: 0.06 }, CHROME = { metallic: 0.95, roughness: 0.16 }, RUBBER = { metallic: 0, roughness: 0.85 };
export const GLASS_COLOR = "#16273d", DARK = "#16171c", CH = "#d4d8df";

let PIV = 6;
export const setPivot = (p) => { PIV = p; };
export const pivot = () => PIV;

const FACES = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 3, 7, 4], [1, 2, 6, 5], [0, 1, 5, 4], [3, 2, 6, 7]];
/// A box-shaped cage from eight corners (0-3 one face going round, 4-7 the opposite, i joined to i+4), faces turned outwards, bevelled to round it.
export function cage(name, c8, color, o = {}) {
  const verts = c8.map((v) => [r2(v[0]), r2(v[1] - PIV), r2(v[2])]);
  const mid = [0, 1, 2].map((a) => verts.reduce((m, v) => m + v[a], 0) / 8);
  const polys = FACES.map((f) => {
    const P = f.map((i) => verts[i]);
    const c = [0, 1, 2].map((a) => P.reduce((m, p) => m + p[a], 0) / 4);
    const n = [0, 1, 2].map((a) => { const b = (a + 1) % 3, d = (a + 2) % 3; let s = 0; for (let t = 0; t < 4; t++) { const p = P[t], q = P[(t + 1) % 4]; s += (p[b] - q[b]) * (p[d] + q[d]); } return s; });
    const out = n[0] * (c[0] - mid[0]) + n[1] * (c[1] - mid[1]) + n[2] * (c[2] - mid[2]) > 0;
    return { v: out ? f : [...f].reverse(), color, smooth: false };
  });
  const cube = { name, shape: "mesh", color, verts, polys };
  if (o.bevel) cube.modifiers = [{ type: "bevel", width: o.bevel, segments: o.segs ?? 3, angle: 30 }];
  if (o.emissive) cube.emissive = o.emissive;
  Object.assign(cube, o.material ?? { metallic: 0.2, roughness: 0.5 });
  if (o.emissive) Object.assign(cube, { metallic: 0, roughness: 0.2 });
  return cube;
}
export const box = (name, x0, x1, y0, y1, z0, z1, color, o = {}) => cage(name, [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], color, o);

// ---- the wheel: a fat tyre, a bright rim with a dark dish and five spokes, a hub ----------------------------------------------------------
export function wheel(name, side, z, s) {
  const R = s.R, tw = s.tw;
  const t = (n, r, w, color, seg, m) => Object.assign({ name: n, shape: "cylinder", from: [-r, -w / 2, -r], size: [2 * r, w, 2 * r], rotation: [0, 0, 90], color, segments: seg, smooth: true }, m);
  const rim = s.rim ?? "#e6e9ee";
  const cubes = [t("tyre", R, tw, "#202127", 24, RUBBER), t("sidewall", R * 0.84, tw + 0.5, "#30313a", 24, RUBBER), t("rim", R * 0.68, tw + 0.9, rim, 24, CHROME), t("rim dish", R * 0.5, tw + 1.3, "#1d1e24", 24, RUBBER)];
  const M = 10, W = (tw + 1.9) / 2, verts = [], polys = [];
  for (const sx of [1, -1]) for (let q = 0; q < M; q++) { const a = (q / M) * Math.PI * 2 + 0.3, r = q % 2 === 0 ? R * 0.62 : R * 0.2; verts.push([sx * W, Math.cos(a) * r, Math.sin(a) * r]); }
  polys.push({ v: Array.from({ length: M }, (_, q) => q), color: rim }, { v: Array.from({ length: M }, (_, q) => M + q).reverse(), color: rim });
  for (let q = 0; q < M; q++) polys.push({ v: [q, M + q, M + ((q + 1) % M), (q + 1) % M], color: mul(rim, 0.8) });
  const fixed = polys.map((pl) => {
    const P = pl.v.map((v) => verts[v]);
    const c = [0, 1, 2].map((a) => P.reduce((m, p) => m + p[a], 0) / P.length);
    const nrm = [0, 1, 2].map((a) => { const b = (a + 1) % 3, d = (a + 2) % 3; let sum = 0; for (let k = 0; k < P.length; k++) { const p = P[k], q = P[(k + 1) % P.length]; sum += (p[b] - q[b]) * (p[d] + q[d]); } return sum; });
    return nrm[0] * c[0] + nrm[1] * c[1] + nrm[2] * c[2] < 0 ? { ...pl, v: [...pl.v].reverse() } : pl;
  });
  cubes.push(Object.assign({ name: "spokes", shape: "mesh", color: rim, verts: verts.map((v) => v.map(r2)), polys: fixed }, CHROME));
  cubes.push(t("hub", R * 0.14, tw + 2.0, "#9aa0aa", 10, CHROME));
  return { name, origin: [side * s.track, R, z], rotation: [0, 0, 0], cubes, children: [] };
}

// ---- loft: a body modelled from cross-sections ---------------------------------------------------------------------------------------------
// `stations` is a list of rings, rear to front: { z, pts: [[x, y], ...] } with the same number of points in each, the half section (x >= 0) from
// the middle of the underside round to the middle of the roof. The faces between neighbouring rings are quads; two rings at the same z make a
// wall (a panel gap). `colorOf(ring0, ring1, j, zMid)` gives each quad's colour; `creaseOf` marks hard edges (weights 0 to 1). The ends are
// closed with one polygon each. Mirrored across x and subdivided: the cage stays low and editable.
export function loft(name, stations, { colorOf, creaseOf, capColors = [], subsurf = [1, 2], material = PAINT } = {}) {
  const N = stations.length, M = stations[0].pts.length;
  const verts = [];
  for (const st of stations) for (const [x, y] of st.pts) verts.push([r2(x), r2(y - PIV), r2(st.z)]);
  const id = (i, j) => i * M + j;
  const mid = [0, 0, 0];
  for (const v of verts) for (let a = 0; a < 3; a++) mid[a] += v[a] / verts.length;
  mid[0] = 0;
  const orient = (loop) => {
    const P = loop.map((k) => verts[k]);
    const c = [0, 1, 2].map((a) => P.reduce((m, p) => m + p[a], 0) / P.length);
    const n = [0, 1, 2].map((a) => { const b = (a + 1) % 3, d = (a + 2) % 3; let s = 0; for (let t = 0; t < P.length; t++) { const p = P[t], q = P[(t + 1) % P.length]; s += (p[b] - q[b]) * (p[d] + q[d]); } return s; });
    // the half body's solid lies towards x = 0 and the middle height; outward is away from the axis through `mid`
    const away = [c[0] - 0, c[1] - mid[1], c[2] - mid[2]];
    const ref = Math.abs(c[2] - verts[0][2]) < 1e-6 ? [0, 0, -1] : Math.abs(c[2] - verts[verts.length - 1][2]) < 1e-6 ? [0, 0, 1] : away;
    return dot(n, ref) > 0 ? loop : [...loop].reverse();
  };
  const polys = [], quads = [];
  for (let i = 0; i < N - 1; i++) for (let j = 0; j < M - 1; j++) {
    const loop = orient([id(i, j), id(i, j + 1), id(i + 1, j + 1), id(i + 1, j)]);
    const zMid = (stations[i].z + stations[i + 1].z) / 2;
    polys.push({ v: loop, color: colorOf(i, i + 1, j, zMid), smooth: true });
    quads.push([i, j]);
  }
  // the end caps
  const cap = (i, color) => polys.push({ v: orient(Array.from({ length: M }, (_, j) => id(i, j))), color, smooth: true });
  cap(0, capColors[0] ?? colorOf(0, 1, 3, stations[0].z)); cap(N - 1, capColors[1] ?? colorOf(N - 2, N - 1, 3, stations[N - 1].z));
  const creases = [];
  if (creaseOf) for (let i = 0; i < N; i++) for (let j = 0; j < M - 1; j++) { const w = creaseOf(i, j, "along"); if (w > 0) creases.push([id(i, j), id(i, j + 1), w]); }
  if (creaseOf) for (let i = 0; i < N - 1; i++) for (let j = 0; j < M; j++) { const w = creaseOf(i, j, "across"); if (w > 0) creases.push([id(i, j), id(i + 1, j), w]); }
  const cube = { name, shape: "mesh", color: polys[0].color, verts, polys, ...(creases.length ? { creases } : {}), modifiers: [{ type: "mirror", axis: "x", merge: 0.02, clip: true }, { type: "subsurf", levels: subsurf[0], renderLevels: subsurf[1], smooth: true }], ...material };
  return cube;
}
