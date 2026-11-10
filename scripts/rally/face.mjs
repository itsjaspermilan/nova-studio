// The nose and tail of a car, modelled into the body instead of glued on. The loft (parts.mjs) ends at a refined outline; `endFace` fills it with
// a structured grid of quads (rows at the heights that matter, columns at the lamp edges) and then works it like a modeller works a face:
// push the lamp pockets in, a shallower step round each for the housing, recess the grille, band the bumper, and crease the edges of
// every pocket so the subdivision keeps them crisp. The lamp lenses are the pockets' own cells, copied into small meshes that glow.
import { r2, add, sub, cross, dot, mul, parse, hex } from "./parts.mjs";

const EPS = 1e-6;

/// Where on a polyline of (x, y) points whose y rises, the x is at height y.
function xAtY(poly, y) {
  for (let i = 1; i < poly.length; i++) {
    const [x0, y0] = poly[i - 1], [x1, y1] = poly[i];
    if (y <= y1 + EPS) return x0 + (x1 - x0) * ((y - y0) / (y1 - y0 || 1));
  }
  return poly[poly.length - 1][0];
}
/// Where on a polyline of (x, y) points whose x falls, the y is at x.
function yAtX(poly, x) {
  for (let i = 1; i < poly.length; i++) {
    const [x0, y0] = poly[i - 1], [x1, y1] = poly[i];
    if (x >= x1 - EPS) return y0 + (y1 - y0) * ((x - x0) / (x1 - x0 || 1));
  }
  return poly[poly.length - 1][1];
}

/// A region of a rule: a box, or an octagon (a round lamp) round (cx, cy) of radius r.
function inRule(rule, x, y, grow = 0) {
  if (rule.c) {
    return Math.hypot(x - rule.c[0], y - rule.c[1]) <= rule.r + grow + EPS;
  }
  return x >= rule.x[0] - grow - EPS && x <= rule.x[1] + grow + EPS && y >= rule.y[0] - grow - EPS && y <= rule.y[1] + grow + EPS;
}
const lines = (rule, rim) => {
  if (rule.c) { const r = rule.r, k = [-1, -0.6, -0.2, 0.2, 0.6, 1]; return { xs: [rule.c[0] - r - rim, ...k.map((t) => rule.c[0] + r * t), rule.c[0] + r + rim], ys: [rule.c[1] - r - rim, ...k.map((t) => rule.c[1] + r * t), rule.c[1] + r + rim] }; }
  return { xs: [rule.x[0] - rim, rule.x[0], rule.x[1], rule.x[1] + rim], ys: [rule.y[0] - rim, rule.y[0], rule.y[1], rule.y[1] + rim] };
};

/// ring: the 10 half-section points [x, y] of the end station (j0 middle of the underside ... j9 middle of the roof). z0 the plane the face lies in, dir +1 for the
/// nose (the face looks towards +z), -1 for the tail. rake: how far the top of the face is set back. spec: { rules, paint }.
export function endFace({ ring, z0, dir, rake = 0, rules = [], paint, pivot }) {
  const yb = ring[0][1], top = ring[9][1], y7 = ring[7][1];
  const side = ring.slice(1, 8); // j1 .. j7, rising
  const topLine = [ring[7], ring[8], ring[9]]; // j7 -> j8 -> j9, falling in x
  const minGap = 0.35, merge = 0.16;
  // ---- rows and columns ----
  const corners = [];
  { let prev = yb; for (const p of side.slice(1)) { const y = Math.max(p[1], prev + 0.04); corners.push(y); prev = y; } } // the heights of j2 .. j7 are the ring's own (kept strictly rising)
  const wantY = [], wantX = [ring[8][0]];
  for (const r of rules) {
    if (r.kind === "band") { wantY.push(...r.y); continue; }
    const rim = r.rim ?? 0;
    const L = lines(r, rim);
    wantY.push(...L.ys); wantX.push(...L.xs);
    if (r.bars) for (let k = 1; k <= r.bars; k++) { const y = r.y[0] + ((r.y[1] - r.y[0]) * k) / (r.bars + 1); wantY.push(y - 0.17, y + 0.17); }
  }
  let ys = [yb, ...corners];
  for (const y of wantY) if (y > yb + merge && y < y7 - merge && !ys.some((v) => Math.abs(v - y) < merge)) ys.push(y);
  ys = [...new Set(ys.map((v) => r2(v)))].sort((a, b) => a - b);
  const xMax = Math.max(...side.map((p) => p[0])) - 0.7;
  let xs = [0];
  for (const x of wantX) if (x > merge && x < xMax && !xs.some((v) => Math.abs(v - x) < merge)) xs.push(x);
  xs = [...new Set(xs.map((v) => r2(v)))].sort((a, b) => a - b);
  const C = xs.length; // columns 0..C: the last is the row's own end
  const K = ys.length; // rows 0..K-1 plus the top row K
  const zOf = (y, d = 0) => z0 + dir * (d - rake * Math.min(1, Math.max(0, (y - yb) / (top - yb || 1))));
  // ---- the vertices: row ends, then the interior ----
  const V = []; // [x, y, z]
  const grid = Array.from({ length: K + 1 }, () => Array(C + 1).fill(-1));
  const push = (x, y, d = 0) => { V.push([r2(x), r2(y), r2(zOf(y, d))]); return V.length - 1; };
  const rowEnd = (k) => (k === 0 ? side[0][0] : k === K - 1 ? side[6][0] : xAtY(side, ys[k]));
  // the outline in order: bottom row (left to right), the side points up, the top row (right to left)
  const outline = [];
  const bottomScale = Math.min(1, (rowEnd(0) - minGap) / xs[C - 1]);
  for (let c = 0; c < C; c++) { grid[0][c] = push(xs[c] * (c === 0 ? 1 : bottomScale), yb); outline.push(grid[0][c]); }
  grid[0][C] = push(rowEnd(0), yb); outline.push(grid[0][C]);
  const ringIdx = Array(10).fill(-1);
  ringIdx[0] = grid[0][0]; ringIdx[1] = grid[0][C];
  for (let k = 1; k < K; k++) { grid[k][C] = push(rowEnd(k), ys[k]); outline.push(grid[k][C]); const j = corners.findIndex((y) => Math.abs(y - ys[k]) < 0.02); if (j >= 0) ringIdx[2 + j] = grid[k][C]; }
  const topScale = Math.min(1, (ring[7][0] - minGap) / xs[C - 1]);
  const topX = [...xs.map((x, c) => (c === 0 ? 0 : x * topScale)), ring[7][0]];
  const topIdx = [];
  for (let c = C; c >= 0; c--) { const x = topX[c]; const y = yAtX(topLine, x); grid[K][c] = push(x, y); topIdx.push(grid[K][c]); if (Math.abs(x - ring[8][0]) < 0.05) ringIdx[8] = grid[K][c]; }
  ringIdx[9] = grid[K][0];
  outline.push(...topIdx);
  if (ringIdx[8] < 0) { // the stripe edge is not a column: put it on the top row by hand
    let best = 1, d = 1e9; for (let c = 1; c < C; c++) { const dd = Math.abs(topX[c] - ring[8][0]); if (dd < d) { d = dd; best = c; } }
    ringIdx[8] = grid[K][best];
  }
  // interior: the displacement of the pockets
  const depthAt = (x, y) => {
    let d = 0;
    for (const r of rules) {
      if (r.kind === "band") continue;
      if (inRule(r, x, y, 0.22)) d = Math.min(d, -(r.depth ?? 1));
      else if (r.rim && inRule(r, x, y, r.rim + 0.22)) d = Math.min(d, -(r.rimDepth ?? (r.depth ?? 1) * 0.45));
    }
    return d;
  };
  for (let k = 1; k < K; k++) {
    const e = V[grid[k][C]][0];
    const scale = Math.min(1, (e - minGap) / xs[C - 1]);
    for (let c = 0; c < C; c++) { const x = xs[c] * (c === 0 ? 1 : scale); grid[k][c] = push(x, ys[k], depthAt(x, ys[k])); }
  }
  // ---- the cells ----
  const polys = [], creases = [], lens = new Map();
  const vx = (k, c) => V[grid[k][c]];
  const roleOf = (k, c) => {
    const pts = [vx(k, c), vx(k, c + 1), vx(k + 1, c + 1), vx(k + 1, c)];
    const mid = [pts.reduce((m, p) => m + p[0], 0) / 4, pts.reduce((m, p) => m + p[1], 0) / 4];
    for (let i = 0; i < rules.length; i++) {
      const r = rules[i];
      if (r.kind === "band") { if (mid[1] >= r.y[0] && mid[1] <= r.y[1]) continue; else continue; }
      const allIn = !r.c && pts.every((p) => inRule(r, p[0], p[1], 0.22));
      // (the end column's x moves with the row: a cell reaching it is judged by its middle)
      const midIn = inRule(r, mid[0], mid[1], r.c ? -0.05 * r.r : 0);
      if (allIn || (r.c && midIn) || (c === C - 1 && midIn)) return { i, kind: r.kind, inside: true };
    }
    for (let i = 0; i < rules.length; i++) {
      const r = rules[i];
      if (r.kind === "band" || !r.rim) continue;
      if (inRule(r, mid[0], mid[1], r.rim + 0.1)) return { i, kind: "rim", inside: false };
    }
    for (const r of rules) if (r.kind === "band" && mid[1] >= r.y[0] && mid[1] <= r.y[1]) return { i: -1, kind: "band", inside: false, color: r.color };
    return { i: -1, kind: "body", inside: false };
  };
  const roles = Array.from({ length: K }, () => Array(C));
  for (let k = 0; k < K; k++) for (let c = 0; c < C; c++) roles[k][c] = roleOf(k, c);
  if (process.env.FACE_DEBUG) {
    console.error("ys", ys.join(" "), "\nxs", xs.join(" "));
    for (let k = K - 1; k >= 0; k--) console.error(String(ys[k]).padStart(6), roles[k].map((r) => (r.kind === "lens" ? "L" : r.kind === "recess" ? "g" : r.kind === "rim" ? "r" : r.kind === "band" ? "b" : ".")).join(""));
  }
  const lensVerts = new Map();
  for (let k = 0; k < K; k++) for (let c = 0; c < C; c++) {
    const role = roles[k][c];
    const q = [grid[k][c], grid[k][c + 1], grid[k + 1][c + 1], grid[k + 1][c]];
    let color = paint;
    if (role.kind === "rim") color = rules[role.i]?.rimColor ?? "#17181d";
    else if (role.kind === "band") color = role.color;
    else if (role.inside) {
      const r = rules[role.i];
      color = r.floor ?? "#101116";
      if (r.kind === "lens") {
        let L = lens.get(role.i);
        if (!L) { L = { rule: r, verts: [], polys: [] }; lens.set(role.i, L); lensVerts.set(role.i, new Map()); }
        const map = lensVerts.get(role.i);
        const ids = q.map((id) => { if (!map.has(id)) { const p = V[id]; map.set(id, L.verts.length); L.verts.push([p[0], p[1], r2(p[2] + dir * 0.35)]); } return map.get(id); });
        L.polys.push(ids);
      } else if (r.kind === "bars") color = r.color ?? "#9aa0aa";
    }
    polys.push({ v: q, color });
  }
  // bars: cells between the bar rows inside a "recess with bars" rule
  for (let k = 0; k < K; k++) for (let c = 0; c < C; c++) {
    const role = roles[k][c];
    if (!role.inside) continue;
    const r = rules[role.i];
    if (!r.bars) continue;
    const midY = (vx(k, 0)[1] + vx(k + 1, 0)[1]) / 2;
    for (let b = 1; b <= r.bars; b++) { const y = r.y[0] + ((r.y[1] - r.y[0]) * b) / (r.bars + 1); if (Math.abs(midY - y) < 0.2) polys[k * C + c].color = r.barColor ?? "#9aa0aa"; }
  }
  // creases round every pocket: an edge between an inside cell and one that is not
  const edge = (a, b) => creases.push([a, b, 0.55]);
  for (let k = 0; k < K; k++) for (let c = 0; c < C; c++) {
    const me = roles[k][c];
    if (!me.inside) continue;
    const q = [grid[k][c], grid[k][c + 1], grid[k + 1][c + 1], grid[k + 1][c]];
    const nb = [[k - 1, c, [q[0], q[1]]], [k, c + 1, [q[1], q[2]]], [k + 1, c, [q[2], q[3]]], [k, c - 1, [q[3], q[0]]]];
    for (const [nk, nc, e] of nb) {
      const other = nk >= 0 && nk < K && nc >= 0 && nc < C ? roles[nk][nc] : null;
      if (!other || other.i !== me.i || !other.inside) { if (!(nc < 0)) edge(e[0], e[1]); }
    }
  }
  const lensOut = [...lens.values()].map((L) => ({ rule: L.rule, verts: L.verts.map((v) => [v[0], v[1] - pivot, v[2]]), polys: L.polys }));
  return { V: V.map((v) => [v[0], v[1] - pivot, v[2]]), polys, creases, ringIdx, outline, lens: lensOut };
}
void add; void sub; void cross; void dot; void mul;

export { xAtY };

/// loft with its two ends modelled as faces (see endFace) instead of closed with one polygon. `ends` is { nose: {rules, rake}, tail: {rules, rake} };
/// an end left out is closed with a single polygon. Everything else is `loft` (parts.mjs).
export function loftFaces(name, stations, { colorOf, creaseOf, subsurf = [1, 1], material, ends = {}, paint, pivot, capColors = [] }) {
  const N = stations.length, M = stations[0].pts.length;
  const verts = [], polys = [], creases = [], lensCubes = [];
  const sid = new Map();
  const first = ends.tail ? 1 : 0, last = ends.nose ? N - 2 : N - 1;
  for (let i = first; i <= last; i++) { sid.set(i, verts.length); for (const [x, y] of stations[i].pts) verts.push([r2(x), r2(y - pivot), r2(stations[i].z)]); }
  const id = (i, j) => sid.get(i) + j;
  const mid = [0, 0, 0];
  for (const v of verts) for (let a = 0; a < 3; a++) mid[a] += v[a] / verts.length;
  const orient = (loop, ref) => {
    const P = loop.map((k) => verts[k]);
    const c = [0, 1, 2].map((a) => P.reduce((m, p) => m + p[a], 0) / P.length);
    const n = [0, 1, 2].map((a) => { const b = (a + 1) % 3, d = (a + 2) % 3; let s = 0; for (let t = 0; t < P.length; t++) { const p = P[t], q = P[(t + 1) % P.length]; s += (p[b] - q[b]) * (p[d] + q[d]); } return s; });
    const r = ref ?? [c[0], c[1] - mid[1], c[2] - mid[2]];
    return n[0] * r[0] + n[1] * r[1] + n[2] * r[2] > 0 ? loop : [...loop].reverse();
  };
  for (let i = first; i < last; i++) for (let j = 0; j < M - 1; j++) {
    polys.push({ v: orient([id(i, j), id(i, j + 1), id(i + 1, j + 1), id(i + 1, j)]), color: colorOf(i, i + 1, j, (stations[i].z + stations[i + 1].z) / 2), smooth: true });
  }
  const cap = (i, color) => polys.push({ v: orient(Array.from({ length: M }, (_, j) => id(i, j)), [0, 0, i === 0 ? -1 : 1]), color, smooth: true });
  const endFaceOn = (idx, nb, dir, e) => {
    const f = endFace({ ring: stations[idx].pts, z0: stations[idx].z, dir, rake: e.rake ?? 0, rules: e.rules, paint, pivot });
    const base = verts.length;
    for (const v of f.V) verts.push(v);
    for (const p of f.polys) polys.push({ v: orient(p.v.map((k) => k + base), [0, 0, dir]), color: p.color, smooth: true });
    for (const [a, b, w] of f.creases) creases.push([a + base, b + base, w]);
    for (let j = 0; j < M - 1; j++) {
      const pa = f.outline.indexOf(f.ringIdx[j]), pb = f.outline.indexOf(f.ringIdx[j + 1]);
      const Q = f.outline.slice(pa, pb + 1).map((k) => k + base); // the face's points along this edge, from j to j + 1
      const col = colorOf(Math.min(idx, nb), Math.max(idx, nb), j, (stations[idx].z + stations[nb].z) / 2);
      const A = id(nb, j), B = id(nb, j + 1), m = Q.length;
      if (m === 2) polys.push({ v: orient([A, B, Q[1], Q[0]]), color: col, smooth: true });
      else {
        const h = Math.floor((m - 1) / 2); // fans from both ends meet in the middle: no long skinny polygon
        for (let k = 0; k < h; k++) polys.push({ v: orient([Q[k], Q[k + 1], A]), color: col, smooth: true });
        for (let k = h; k < m - 1; k++) polys.push({ v: orient([Q[k], Q[k + 1], B]), color: col, smooth: true });
        polys.push({ v: orient([A, Q[h], B]), color: col, smooth: true });
      }
    }
    for (const L of f.lens) lensCubes.push({ rule: L.rule, verts: L.verts, polys: L.polys.map((q) => orient2(q, L.verts, dir)) });
    return f;
  };
  const orient2 = (q, vs, dir) => {
    const P = q.map((k) => vs[k]);
    const n = [0, 1, 2].map((a) => { const b = (a + 1) % 3, d = (a + 2) % 3; let s = 0; for (let t = 0; t < P.length; t++) { const p = P[t], r = P[(t + 1) % P.length]; s += (p[b] - r[b]) * (p[d] + r[d]); } return s; });
    return n[2] * dir > 0 ? q : [...q].reverse();
  };
  const faces = {};
  if (ends.tail) faces.tail = endFaceOn(0, 1, -1, ends.tail); else cap(0, capColors[0] ?? colorOf(0, 1, 3, stations[0].z));
  if (ends.nose) faces.nose = endFaceOn(N - 1, N - 2, 1, ends.nose); else cap(N - 1, capColors[1] ?? colorOf(N - 2, N - 1, 3, stations[N - 1].z));
  if (creaseOf) {
    for (let i = first; i <= last; i++) for (let j = 0; j < M - 1; j++) { const w = creaseOf(i, j, "along"); if (w > 0) creases.push([id(i, j), id(i, j + 1), w]); }
    for (let i = first; i < last; i++) for (let j = 0; j < M; j++) { const w = creaseOf(i, j, "across"); if (w > 0) creases.push([id(i, j), id(i + 1, j), w]); }
  }
  const body = { name, shape: "mesh", color: polys[0].color, verts, polys, ...(creases.length ? { creases } : {}), modifiers: [{ type: "mirror", axis: "x", merge: 0.02, clip: true }, { type: "subsurf", levels: subsurf[0], renderLevels: subsurf[1], smooth: true }], ...material };
  // a lens is brighter at the top and a touch warmer at the bottom, so it reads as a curved glass, not a white square
  const shade = (r, q, vs) => {
    const base = r.lensColor ?? "#fff3cf";
    if (!r.emissive) return base;
    const ys = vs.map((v) => v[1]), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const cy = q.reduce((m, k) => m + vs[k][1], 0) / q.length;
    const t = y1 > y0 ? (cy - y0) / (y1 - y0) : 0.5;
    const hi = parse(base), lo = hi.map((c, i) => c * [0.96, 0.84, 0.62][i]);
    return hex(hi.map((c, i) => lo[i] + (c - lo[i]) * t));
  };
  const lenses = lensCubes.map((L, k) => {
    const r = L.rule;
    return { name: r.name ?? `lamp ${k + 1}`, shape: "mesh", color: r.lensColor ?? "#fff3cf", verts: L.verts, polys: L.polys.map((v) => ({ v, color: shade(r, v, L.verts), smooth: false })), modifiers: [{ type: "mirror", axis: "x", merge: 0.02, clip: true }], ...(r.emissive ? { emissive: r.emissive, metallic: 0, roughness: 0.2 } : { metallic: 0.1, roughness: 0.5 }) };
  });
  return { body, lenses, faces };
}
