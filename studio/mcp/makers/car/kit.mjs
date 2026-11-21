// A kit for modelling a car from its blueprint with the studio's own modeller (2026-11-19). The body is ONE smooth surface: a cage with the topology of a box
// (two flanks, the top from shoulder to shoulder, a front face and a rear face, every curve read from the drawing), mirrored and subdivided by the modifier stack.
// Everything that is cut into a real car's skin is cut into this one with the Cut-out modifier (studio/src/lib/mesh-cutout.ts): glass, lamps, grilles, intakes,
// panel gaps, wheel openings. Only what is a separate piece on the real car is a separate shape (mirrors, bumpers, wheels, wipers).
// Units are 1/16 m; y is up from the ground; the nose points along +z; x = 0 is the middle.

export const r2 = (v) => Math.round(v * 100) / 100;
export const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (t) => Math.max(0, Math.min(1, t));
export const smoothstep = (t) => { const u = clamp01(t); return u * u * (3 - 2 * u); };
const parse = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
export const hex = (c) => "#" + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
export const shade = (h, f) => hex(parse(h).map((v) => v * f));
export const mix = (a, b, t) => hex(parse(a).map((v, i) => lerp(v, parse(b)[i], t)));

/// A smooth curve through points [t, value] (monotone cubic: it never overshoots a traced point); flat beyond its ends.
export function curve(pts) {
  if (typeof pts === "number") return () => pts;
  if (typeof pts === "function") return pts;
  const p = [...pts].sort((a, b) => a[0] - b[0]), n = p.length;
  if (n === 1) return () => p[0][1];
  const h = [], d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) { h.push(p[i + 1][0] - p[i][0]); d.push((p[i + 1][1] - p[i][1]) / (h[i] || 1e-9)); }
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (3 * (h[i - 1] + h[i])) / ((2 * h[i] + h[i - 1]) / d[i - 1] + (h[i] + 2 * h[i - 1]) / d[i]);
  return (t) => {
    if (t <= p[0][0]) return p[0][1];
    if (t >= p[n - 1][0]) return p[n - 1][1];
    let i = 0;
    while (t > p[i + 1][0]) i++;
    const u = (t - p[i][0]) / h[i], u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * p[i][1] + (u3 - 2 * u2 + u) * h[i] * m[i] + (-2 * u3 + 3 * u2) * p[i + 1][1] + (u3 - u2) * h[i] * m[i + 1];
  };
}

// ---- outlines for cut-outs ---------------------------------------------------------------------------------------------------------------
/// Rounds a closed outline (corner cutting, `times` rounds). A point written [x, y, 1] stays a sharp corner.
export function rounded(pts, times = 2) {
  let p = pts.map(([x, y, s]) => [x, y, s ? 1 : 0]);
  for (let k = 0; k < times; k++) {
    const out = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[(i + p.length - 1) % p.length], b = p[i], c = p[(i + 1) % p.length];
      if (b[2]) { out.push(b); continue; }
      out.push([lerp(b[0], a[0], 0.25), lerp(b[1], a[1], 0.25), 0], [lerp(b[0], c[0], 0.25), lerp(b[1], c[1], 0.25), 0]);
    }
    p = out;
  }
  return p.map(([x, y]) => [r2(x), r2(y)]);
}
const area2 = (p) => p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0);
/// The outline moved inwards by d (outwards when negative).
export function inset(pts, d) {
  const ccw = area2(pts) > 0 ? 1 : -1, n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    const a = pts[(i + n - 1) % n], b = pts[i], c = pts[(i + 1) % n];
    const e1 = [b[0] - a[0], b[1] - a[1]], e2 = [c[0] - b[0], c[1] - b[1]];
    const l1 = Math.hypot(...e1) || 1, l2 = Math.hypot(...e2) || 1;
    const n1 = [(-e1[1] / l1) * ccw, (e1[0] / l1) * ccw], n2 = [(-e2[1] / l2) * ccw, (e2[0] / l2) * ccw];
    const bx = n1[0] + n2[0], by = n1[1] + n2[1], k = d / Math.max(0.35, (bx * n1[0] + by * n1[1]));
    out.push([r2(b[0] + bx * k), r2(b[1] + by * k)]);
  }
  return out;
}
/// A line of points made into a thin closed outline `w` wide (a panel gap, a slat).
export function stroke(line, w) {
  const left = [], right = [], n = line.length;
  for (let i = 0; i < n; i++) {
    const a = line[Math.max(0, i - 1)], b = line[Math.min(n - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    left.push([r2(line[i][0] - (dy / l) * w / 2), r2(line[i][1] + (dx / l) * w / 2)]);
    right.push([r2(line[i][0] + (dy / l) * w / 2), r2(line[i][1] - (dx / l) * w / 2)]);
  }
  return [...left, ...right.reverse()];
}
export const ellipse = (cx, cy, rx, ry, n = 20) => Array.from({ length: n }, (_, i) => [r2(cx + rx * Math.cos((i / n) * 2 * Math.PI)), r2(cy + ry * Math.sin((i / n) * 2 * Math.PI))]);
export const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
/// Rounds every corner of a closed outline with a fillet of radius r (a point written [x, y, 1] stays sharp); `n` steps round each corner.
export function fillet(pts, r, n = 3) {
  const out = [], m = pts.length;
  for (let i = 0; i < m; i++) {
    const a = pts[(i + m - 1) % m], b = pts[i], c = pts[(i + 1) % m];
    const la = Math.hypot(a[0] - b[0], a[1] - b[1]), lc = Math.hypot(c[0] - b[0], c[1] - b[1]), d = Math.min(r, la * 0.45, lc * 0.45);
    if (b[2] || d < 1e-6) { out.push([b[0], b[1]]); continue; }
    const p = [b[0] + ((a[0] - b[0]) / la) * d, b[1] + ((a[1] - b[1]) / la) * d], q = [b[0] + ((c[0] - b[0]) / lc) * d, b[1] + ((c[1] - b[1]) / lc) * d];
    for (let k = 0; k <= n; k++) { const t = k / n, u = 1 - t; out.push([r2(u * u * p[0] + 2 * u * t * b[0] + t * t * q[0]), r2(u * u * p[1] + 2 * u * t * b[1] + t * t * q[1])]); }
  }
  return out;
}
/// A rectangle with corners of radius r.
export const rrect = (x0, y0, x1, y1, r = 0.3) => fillet(rect(x0, y0, x1, y1), r);
/// A smooth open line through a few points, as `n` points (for strokes that curve).
export function path(pts, n = 12) {
  const fx = curve(pts.map((p, i) => [i, p[0]])), fy = curve(pts.map((p, i) => [i, p[1]]));
  return Array.from({ length: n + 1 }, (_, i) => [r2(fx((i / n) * (pts.length - 1))), r2(fy((i / n) * (pts.length - 1)))]);
}
function insidePoly(o, x, y) {
  let c = false;
  for (let i = 0, j = o.length - 1; i < o.length; j = i++) { const [xi, yi] = o[i], [xj, yj] = o[j]; if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; }
  return c;
}
/// The part of the segment a..b inside the outline (sampled), or null.
function clipSeg(o, a, b, steps = 40) {
  let t0 = null, t1 = null;
  for (let i = 0; i <= steps; i++) { const t = i / steps; if (insidePoly(o, lerp(a[0], b[0], t), lerp(a[1], b[1], t))) { if (t0 === null) t0 = t; t1 = t; } }
  return t0 === null || t1 - t0 < 1e-6 ? null : [[lerp(a[0], b[0], t0), lerp(a[1], b[1], t0)], [lerp(a[0], b[0], t1), lerp(a[1], b[1], t1)]];
}

// ---- shapes ------------------------------------------------------------------------------------------------------------------------------
export const PAINT = { metallic: 0.45, roughness: 0.32, coat: 1 }, GLASS = { metallic: 0.7, roughness: 0.06, glass: 1 }, RUBBER = { metallic: 0, roughness: 0.85 }, STEEL = { metallic: 0.9, roughness: 0.3 }, CHROME = { metallic: 1, roughness: 0.12 }, PLASTIC = { metallic: 0, roughness: 0.6 };
const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function newell(P) {
  const n = [0, 0, 0];
  for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; n[0] += (p[1] - q[1]) * (p[2] + q[2]); n[1] += (p[2] - q[2]) * (p[0] + q[0]); n[2] += (p[0] - q[0]) * (p[1] + q[1]); }
  return n;
}
/// A free mesh; every polygon is turned to face away from the shape's middle (or from `inside`).
export function mesh(name, verts, loops, color, o = {}) {
  const centre = o.inside ?? verts.reduce((m, v) => m.map((x, i) => x + v[i] / verts.length), [0, 0, 0]);
  const polys = loops.map((lp) => {
    const loop = Array.isArray(lp) ? lp : lp.v, P = loop.map((i) => verts[i]);
    const c = P.reduce((m, v) => m.map((x, i) => x + v[i] / P.length), [0, 0, 0]);
    const ref = lp.want ?? sub(c, centre);
    const f = { v: dot(newell(P), ref) >= 0 ? loop : [...loop].reverse() };
    if (lp.color) f.color = lp.color;
    if (o.smooth) f.smooth = true;
    return f;
  });
  const cube = { name, shape: "mesh", color, verts: verts.map((v) => v.map(r2)), polys, ...(o.material ?? PLASTIC) };
  if (o.modifiers) cube.modifiers = o.modifiers;
  if (o.creases) cube.creases = o.creases;
  if (o.emissive) cube.emissive = o.emissive;
  return cube;
}
const BOX = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
/// A solid between two quads: `a` the four points of one end, `b` those of the other (same order).
export const hexa = (name, a, b, color, o) => mesh(name, [...a, ...b], BOX, color, o);
/// A box with rounded edges (bevel `round` wide).
export const box = (name, x0, x1, y0, y1, z0, z1, color, o = {}) =>
  hexa(name, [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], color, { ...o, modifiers: o.round ? [{ type: "bevel", width: o.round, segments: o.segs ?? 2, angle: 30 }] : undefined });
/// A soft pebble: a box cage made round by subdivision (a mirror housing). `ends` may taper it: [a, b] quads as for hexa.
export const pebble = (name, a, b, color, o = {}) => hexa(name, a, b, color, { ...o, smooth: true, modifiers: [{ type: "subsurf", levels: 1, renderLevels: o.levels ?? 2, smooth: true }], creases: o.creases });
/// A cylinder: centre, radius, length along `axis` ("x", "y" or "z").
export const cyl = (name, cx, cy, cz, r, len, axis, color, o = {}) => ({ name, shape: "cylinder", from: [r2(cx - r), r2(cy - len / 2), r2(cz - r)], size: [r2(2 * r), r2(len), r2(2 * r)], rotation: axis === "z" ? [90, 0, 0] : axis === "x" ? [0, 0, 90] : [0, 0, 0], color, segments: o.segments ?? 20, smooth: true, ...(o.material ?? PLASTIC), ...(o.emissive ? { emissive: o.emissive } : {}) });
/// A shape turned on a lathe round the x axis: `profile` is [[radius, x], ...].
export const lathe = (name, profile, color, o = {}) => ({ name, shape: "mesh", color, verts: profile.map(([r, x]) => [r2(x), r2(r), 0]), polys: [], ...(o.material ?? PLASTIC), modifiers: [{ type: "revolve", axis: "x", segments: o.segments ?? 32, sharp: o.sharp ?? 35, ...(o.flip ? { flip: true } : {}) }, ...(o.cuts ? [{ type: "cutout", cuts: o.cuts }] : [])] });
/// A flat strip between two points on a surface (a wiper arm, a trim bar): `up` is the surface's outward direction.
export function bar(name, p0, p1, wid, thick, color, o = {}, up = [0, 1, 0]) {
  const d = sub(p1, p0), s = [d[1] * up[2] - d[2] * up[1], d[2] * up[0] - d[0] * up[2], d[0] * up[1] - d[1] * up[0]], sl = Math.hypot(...s) || 1, off = s.map((v) => (v * wid) / 2 / sl), u = up.map((v) => v * thick);
  const base = [p0.map((v, i) => v - off[i]), p1.map((v, i) => v - off[i]), p1.map((v, i) => v + off[i]), p0.map((v, i) => v + off[i])];
  return hexa(name, base, base.map((p) => p.map((v, i) => v + u[i])), color, o);
}

// ---- the body ----------------------------------------------------------------------------------------------------------------------------
const HX = [1, 0.955, 0.89, 0.8, 0.68, 0.54, 0.36, 0.18, 0]; // where the top's columns sit across a bonnet or a boot lid, from the shoulder to the middle
const NT = HX.length - 1;

/// The body's cage from the blueprint's curves. Returns the mesh (with its Mirror and Subdivision modifiers; add the Cut-out after them) and `at`, which finds
/// the skin from a view: at.side(z, y) -> x, at.top(x, z) -> y, at.front(x, y) -> z, at.back(x, y) -> z.
export function buildBody(s) {
  const W = curve(s.w), YB = curve(s.yb), YS = curve(s.ys), TOP = curve(s.top), RW = curve(s.rw), CROWN = curve(s.crown ?? 0.5), DROP = curve(s.drop ?? 1.6), LEDGE = curve(s.ledge ?? 0.5), RAIL = curve(s.rail ?? 0.8);
  const prof = curve(s.profile), kTop = prof(1), TAU = s.rows ?? [0, 0.12, 0.3, 0.5, 0.7, 0.88, 1], NS = TAU.length - 1, P = s.hoodP ?? 2.4, tuck = s.tuck ?? 1.4;
  /// The top's column c at z: [x, y]. A blend of the bonnet form (a crowned sheet) and the cabin form (side glass, roof rail, roof) by how tall the top is there.
  const topCol = (c, z) => {
    const ys = YS(z), top = TOP(z), xs = W(z) * kTop, h = top - ys, g = smoothstep((h - (s.h0 ?? 1.2)) / ((s.h1 ?? 4) - (s.h0 ?? 1.2)));
    const hood = [xs * HX[c], ys + h * (1 - Math.pow(HX[c], P))];
    if (g <= 0) return hood;
    const rw = Math.min(RW(z), xs - 0.6), crown = CROWN(z), g0 = [xs - LEDGE(z), ys + Math.min(0.3, h * 0.1)], g1 = [rw + RAIL(z), top - DROP(z)], r1 = [rw, top - crown];
    const roof = (k) => [rw * k, top - crown * k * k];
    const cab = [[xs, ys], g0, [lerp(g0[0], g1[0], 0.5), lerp(g0[1], g1[1], 0.5)], g1, [lerp(g1[0], r1[0], 0.5) + 0.14 * RAIL(z), lerp(g1[1], r1[1], 0.5) + 0.14 * (DROP(z) - crown)], r1, roof(2 / 3), roof(1 / 3), roof(0)][c];
    return [lerp(hood[0], cab[0], g), lerp(hood[1], cab[1], g)];
  };
  const ends = [s.rear, s.front].map((e, k) => {
    const dir = k ? 1 : -1, plan = curve(e.plan), sideZ = curve(e.side), back = curve(e.edgeBack ?? 0), xc = W(e.zc), tip = plan(0), L = e.L ?? 8;
    const planC = (x) => (x >= xc ? e.zc : dir * Math.max(dir * plan(x), dir * e.zc));
    return { ...e, dir, back, planC, tip, L, fade: (zn) => smoothstep((dir * (zn - e.zc) + L) / L), dSide: (y) => Math.max(0, dir * (tip - sideZ(y))) };
  });
  const [rear, front] = ends;
  // stations: the ones asked for, both corners, and enough between that no gap is long
  let zs = [...new Set([rear.zc, front.zc, ...(s.stations ?? []).filter((z) => z > rear.zc + 0.3 && z < front.zc - 0.3)].map(r2))].sort((a, b) => a - b);
  const filled = [];
  for (let i = 0; i < zs.length; i++) { if (i) { const g = zs[i] - zs[i - 1], n = Math.ceil(g / (s.maxGap ?? 3.2)); for (let k = 1; k < n; k++) filled.push(r2(zs[i - 1] + (g * k) / n)); } filled.push(zs[i]); }
  zs = filled;
  const N = zs.length, verts = [], S = [], T = [];
  const push = (p) => verts.push(p.map(r2)) - 1;
  const endOf = (zn) => (front.fade(zn) > 0 ? front : rear.fade(zn) > 0 ? rear : null);
  /// How far behind the foremost outline the skin is at height y of a column whose top is yTop and whose own set-back there is dTop.
  const recess = (e, y, yb, yTop, dTop) => { const t = clamp01((y - yb) / Math.max(yTop - yb, 1e-6)); return e.dSide(y) + (dTop - e.dSide(yTop)) * t * t; };
  for (let i = 0; i < N; i++) {
    const zn = zs[i], w = W(zn), yb = YB(zn), ys = YS(zn), e = endOf(zn), f = e ? e.fade(zn) : 0;
    const row = [];
    const sidePoint = (x, y) => [x, y, e ? zn + f * (e.planC(x) - e.zc - e.dir * recess(e, y, yb, ys, e.back(w * kTop))) : zn];
    const low = sidePoint(w * prof(0), yb);
    row.push(push([low[0] - tuck, low[1] - 0.25, low[2]]));
    for (const t of TAU) row.push(push(sidePoint(w * prof(t), lerp(yb, ys, t))));
    S.push(row);
    const cols = [row[NS + 1]];
    for (let c = 1; c <= NT; c++) {
      const [x] = topCol(c, zn);
      const ze = e && e.hood !== false ? zn + f * (e.planC(x) - e.zc - e.dir * e.back(x)) : zn;
      const y = topCol(c, e && e.hood !== false ? lerp(zn, ze, 1) : zn)[1];
      cols.push(push([x, y, e ? (e.hood !== false ? ze : zn + f * (e.planC(x) - e.zc - e.dir * recess(e, y, yb, y, e.back(x)))) : zn]));
    }
    T.push(cols);
  }
  // the two faces: columns across (matching the top's), rows up (matching the flank's)
  const face = (e, i) => {
    const G = [S[i]];
    for (let c = 1; c <= NT; c++) {
      const top = verts[T[i][c]], xcol = top[0], yTop = top[1], zb = e.planC(xcol), yb = YB(e.dir > 0 ? Math.min(zb, e.tip) : Math.max(zb, e.tip)) + (e.lift ? curve(e.lift)(xcol) : 0);
      const col = [];
      const at = (t) => {
        const x = xcol * (c === NT ? 0 : lerp(1, prof(t) / kTop, xcol / (W(e.zc) * kTop))), y = lerp(yb, yTop, t);
        return [x, y, e.planC(x) - e.dir * recess(e, y, yb, yTop, e.dir * (e.planC(xcol) - top[2]))];
      };
      const low = at(TAU[0]), k = xcol / (W(e.zc) * kTop);
      col.push(push([Math.max(0, low[0] - tuck * k), low[1] - 0.25, low[2] - e.dir * tuck * (1 - k)]));
      for (let r = 0; r < NS; r++) col.push(push(at(TAU[r])));
      col.push(T[i][c]);
      G.push(col);
    }
    return G;
  };
  const GF = face(front, N - 1), GR = face(rear, 0);
  const quads = [];
  for (let i = 0; i < N - 1; i++) {
    for (let r = 0; r <= NS; r++) quads.push([S[i][r], S[i][r + 1], S[i + 1][r + 1], S[i + 1][r]]);
    for (let c = 0; c < NT; c++) quads.push([T[i][c], T[i][c + 1], T[i + 1][c + 1], T[i + 1][c]]);
  }
  for (const G of [GF, GR]) for (let c = 0; c < NT; c++) for (let r = 0; r <= NS; r++) quads.push([G[c][r], G[c][r + 1], G[c + 1][r + 1], G[c + 1][r]]);
  // every face looks away from the car's middle line
  const yMid = (s.midY ?? 9), polys = quads.map((q) => {
    const Pn = q.map((i) => verts[i]), c = Pn.reduce((m, v) => m.map((x, a) => x + v[a] / 4), [0, 0, 0]);
    const ref = [c[0], c[1] - yMid, c[2] - Math.max(rear.zc + 6, Math.min(front.zc - 6, c[2]))];
    return { v: dot(newell(Pn), ref) >= 0 ? q : [...q].reverse(), smooth: true };
  });
  const creases = [], cr = s.crease ?? {};
  for (const [r, wgt] of Object.entries(cr.rows ?? {})) {
    for (let i = 0; i < N - 1; i++) creases.push([S[i][+r], S[i + 1][+r], wgt]);
    for (const G of [GF, GR]) for (let c = 0; c < NT; c++) if (+r <= NS) creases.push([G[c][+r], G[c + 1][+r], wgt]);
  }
  for (const [c, wgt] of Object.entries(cr.cols ?? {})) for (let i = 0; i < N - 1; i++) creases.push([T[i][+c], T[i + 1][+c], wgt]);
  for (const [e, i, G] of [[front, N - 1, GF], [rear, 0, GR]]) if (e.rim) {
    for (let r = 0; r <= NS; r++) creases.push([S[i][r], S[i][r + 1], e.rim]);
    for (let c = 0; c < NT; c++) creases.push([T[i][c], T[i][c + 1], e.rimTop ?? e.rim]);
    void G;
  }
  const body = { name: "body", shape: "mesh", color: s.paint, verts, polys, creases, ...PAINT, ...(s.material ?? {}), modifiers: [{ type: "mirror", axis: "x", merge: 0.02, clip: true }, { type: "subsurf", levels: 1, renderLevels: s.levels ?? 1, smooth: true }] };
  // finding the skin: rays against the cage's triangles
  const tris = [];
  for (const q of quads) { const [a, b, c, d] = q.map((i) => verts[i]); tris.push([a, b, c], [a, c, d]); }
  const cast = (ia, ib, id, a, b, pick) => {
    let best = null;
    for (const t of tris) {
      const [p, q, r] = t, d1 = (q[ib] - r[ib]) * (p[ia] - r[ia]) + (r[ia] - q[ia]) * (p[ib] - r[ib]);
      if (Math.abs(d1) < 1e-9) continue;
      const u = ((q[ib] - r[ib]) * (a - r[ia]) + (r[ia] - q[ia]) * (b - r[ib])) / d1, v = ((r[ib] - p[ib]) * (a - r[ia]) + (p[ia] - r[ia]) * (b - r[ib])) / d1;
      if (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6) continue;
      const depth = u * p[id] + v * q[id] + (1 - u - v) * r[id];
      if (best === null || pick(depth, best)) best = depth;
    }
    return best;
  };
  const max = (a, b) => a > b, min = (a, b) => a < b;
  const at = {
    side: (z, y) => cast(2, 1, 0, z, y, max) ?? W(z),
    top: (x, z) => cast(0, 2, 1, Math.abs(x), z, max) ?? TOP(z),
    front: (x, y) => cast(0, 1, 2, Math.abs(x), y, max) ?? front.tip,
    back: (x, y) => cast(0, 1, 2, Math.abs(x), y, min) ?? rear.tip,
  };
  return { body, at, zs, quads: quads.length };
}

// ---- wheels ------------------------------------------------------------------------------------------------------------------------------
/// A wheel round the x axis at the origin: a lathe-turned tyre, a lathe-turned rim whose windows are cut out of its face, a dark barrel, a brake disc and
/// caliper behind, a hub cap and nuts. `w` = { R, width, rimR, windows: [outline in (z, y)...], rim, ... }.
export function wheel(w, out = 0) {
  const { R, width: T, rimR } = w, h = T / 2, sw = R - rimR, cubes = [];
  const tyre = [[rimR - 0.05, -h * 0.86], [rimR + sw * 0.2, -h * 0.97], [rimR + sw * 0.62, -h], [R - sw * 0.18, -h * 0.93], [R - 0.06, -h * 0.74], [R, -h * 0.4], [R, h * 0.4], [R - 0.06, h * 0.74], [R - sw * 0.18, h * 0.93], [rimR + sw * 0.62, h], [rimR + sw * 0.2, h * 0.97], [rimR - 0.05, h * 0.86]];
  cubes.push(lathe("tyre", tyre, "#1b1c20", { material: RUBBER, segments: 30, sharp: 50 }));
  if (w.tread) { // tread blocks round the tyre
    const kv = [], kl = [], n = w.tread;
    for (let k = 0; k < n; k++) for (const side of [-1, 1]) {
      const a = ((k + (side > 0 ? 0.5 : 0)) / n) * Math.PI * 2, da = (Math.PI / n) * 0.6, base = kv.length;
      for (const rr of [R - 0.2, R + 0.2]) for (const [aa, ax] of [[a - da, side * h * 0.08], [a + da, side * h * 0.08], [a + da, side * h * 0.9], [a - da, side * h * 0.9]]) kv.push([ax, Math.cos(aa) * rr, Math.sin(aa) * rr]);
      for (const f of BOX) kl.push(f.map((i) => base + i));
    }
    cubes.push(mesh("tread", kv, kl, "#1b1c20", { material: RUBBER, inside: [0, 0, 0] }));
  }
  const face = h * (w.faceAt ?? 0.72), dish = w.dish ?? 0.25, hubR = (w.hubR ?? 0.2) * rimR;
  const rim = [[0, -face + dish], [hubR * 1.6, -face + dish], [rimR * 0.9, -face], [rimR - 0.12, -h * 0.9], [rimR + 0.1, -h * 0.9], [rimR + 0.1, -h * 0.8], [rimR + 0.1, h * 0.8], [rimR + 0.1, h * 0.9], [rimR - 0.12, h * 0.9], [rimR * 0.9, face], [hubR * 1.6, face - dish], [0, face - dish]];
  cubes.push(lathe("rim", rim, w.rim ?? "#c9ced6", { material: w.rimMaterial ?? STEEL, segments: 30, sharp: 28, cuts: (w.windows ?? []).map((points) => ({ view: "side", points, ...(out ? { only: out > 0 ? "+x" : "-x" } : {}), remove: true, depth: w.spokeDepth ?? 0.5, wall: shade(w.rim ?? "#c9ced6", 0.62), facing: 0.5 })) }));
  cubes.push(cyl("barrel", 0, 0, 0, rimR - 0.3, 2 * (face - Math.max(dish, 0.2) - 0.12), "x", "#070708", { segments: 24, material: { metallic: 0, roughness: 1 } }));
  cubes.push(cyl("brake disc", 0, 0, 0, rimR * (w.discR ?? 0.7), 2 * (face - Math.max(dish, 0.2) - 0.3), "x", "#7d838d", { segments: 24, material: STEEL }));
  if (w.caliper) for (const side of out ? [out] : [-1, 1]) cubes.push(box("caliper", Math.min(side * h * 0.2, side * h * 0.5), Math.max(side * h * 0.2, side * h * 0.5), rimR * 0.22, rimR * 0.74, -rimR * 0.42, rimR * 0.16, w.caliper, { round: 0.15, segs: 1 }));
  cubes.push(cyl("hub cap", 0, 0, 0, hubR, 2 * (face - dish) + 0.5, "x", w.cap ?? "#9aa0aa", { segments: 16, material: STEEL }));
  for (const side of out ? [out] : [-1, 1]) for (let k = 0; k < (w.nuts ?? 5); k++) {
    const a = (k / (w.nuts ?? 5)) * Math.PI * 2 + 0.3, rr = hubR * (w.nutAt ?? 1.5);
    cubes.push(cyl("nut", side * (face - dish + 0.12), Math.cos(a) * rr, Math.sin(a) * rr, 0.045 * R, 0.3, "x", w.nut ?? "#b9bec7", { segments: 6, material: STEEL }));
  }
  return cubes;
}
/// Windows between `n` spokes: each from radius r0 to r1, `a0` and `a1` the half-angles (as a share of the gap between spokes) it spans at r0 and at r1.
export function spokeWindows(n, r0, r1, a0, a1, turn = 0) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const mid = ((k + 0.5) / n) * Math.PI * 2 + turn, gap = Math.PI / n, pts = [];
    for (let i = 0; i <= 6; i++) { const a = mid - gap * a1 + (2 * gap * a1 * i) / 6; pts.push([Math.sin(a) * r1, Math.cos(a) * r1]); }
    for (let i = 0; i <= 3; i++) { const a = mid + gap * a0 - (2 * gap * a0 * i) / 3; pts.push([Math.sin(a) * r0, Math.cos(a) * r0]); }
    out.push(rounded(pts, 1));
  }
  return out;
}

// ---- pieces that sit in or on the body ---------------------------------------------------------------------------------------------------------
/// A lattice of thin bars inside an outline on the nose (a grille's mesh): two sets of slanted bars `pitch` apart, `back` behind the skin.
export function lattice(name, outline, at, dirZ, back, pitch, wid, color, o = {}) {
  const verts = [], loops = [];
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of outline) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const span = x1 - x0 + (y1 - y0), slope = o.slope ?? 1;
  const z = (x, y) => at(x, y) - dirZ * back;
  const segs = [];
  for (const sgn of o.straight ? [0] : [1, -1]) for (let t = -span; t <= span; t += pitch) {
    const a = sgn === 0 ? [x0, y0 + t] : [x0, sgn > 0 ? y0 + t : y1 - t], b = sgn === 0 ? [x1, y0 + t] : [x1, sgn > 0 ? y0 + t + (x1 - x0) * slope : y1 - t - (x1 - x0) * slope];
    const c = clipSeg(outline, a, b, 60);
    if (c) segs.push(c);
  }
  for (const xv of o.posts ?? []) { const c = clipSeg(outline, [xv, y0], [xv, y1], 60); if (c) segs.push(c); }
  for (const [a, b] of segs) {
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy);
    if (l < 0.2) continue;
    const nx = (-dy / l) * wid / 2, ny = (dx / l) * wid / 2, base = verts.length, parts = Math.max(1, Math.ceil(l / 2.5));
    for (let i = 0; i <= parts; i++) { const x = lerp(a[0], b[0], i / parts), y = lerp(a[1], b[1], i / parts); verts.push([x - nx, y - ny, z(x, y)], [x + nx, y + ny, z(x, y)]); }
    for (let i = 0; i < parts; i++) loops.push({ v: [base + i * 2, base + i * 2 + 1, base + i * 2 + 3, base + i * 2 + 2], want: [0, 0, dirZ] });
  }
  return mesh(name, verts, loops, color, { material: o.material ?? PLASTIC });
}
/// The dark inside of a wheel opening: an arch-shaped tunnel from the flank inwards and its inner wall.
export function archLiner(name, outline, xOut, xIn, sx, color = "#0c0d10") {
  const n = outline.length, verts = [], loops = [];
  for (const [z, y] of outline) verts.push([sx * xOut, y, z], [sx * xIn, y, z]);
  for (let i = 0; i < n - 1; i++) loops.push({ v: [i * 2, i * 2 + 1, i * 2 + 3, i * 2 + 2] });
  const mid = [sx * (xOut + xIn) / 2, outline.reduce((m, p) => m + p[1] / n, 0) - 2, outline.reduce((m, p) => m + p[0] / n, 0)];
  loops.push({ v: Array.from({ length: n }, (_, i) => i * 2 + 1), want: [sx, 0, 0] });
  const m = mesh(name, verts, loops.map((l) => (l.want ? l : { ...l, want: null })), color, { material: { metallic: 0, roughness: 1 } });
  // the tunnel is seen from inside: turn its strips to face its own middle
  m.polys = loops.map((l) => {
    const Pn = l.v.map((i) => verts[i]), c = Pn.reduce((a, v) => a.map((x, k) => x + v[k] / Pn.length), [0, 0, 0]);
    const ref = l.want ?? sub(mid, c);
    return { v: dot(newell(Pn), ref) >= 0 ? l.v : [...l.v].reverse() };
  });
  return m;
}

/// Puts the pieces together: the body part (its shapes are written with the ground at y = 0 and moved to the part's pivot here) and four wheels.
export function assemble({ cubes, pivot, wheelZ, track, wheelOf, R }) {
  for (const c of cubes) { if (c.verts) { if (!c.modifiers?.some((m) => m.type === "revolve")) for (const v of c.verts) v[1] = r2(v[1] - pivot); } else if (c.from) c.from[1] = r2(c.from[1] - pivot); }
  for (const c of cubes) for (const m of c.modifiers ?? []) if (m.type === "cutout") for (const cut of m.cuts) {
    if (cut.view !== "top" && cut.view !== "bottom") cut.points = cut.points.map(([a, b]) => [a, r2(b - pivot)]);
    else for (const lim of ["near", "far"]) if (typeof cut[lim] === "number") cut[lim] = r2(cut[lim] - pivot); // (a top or bottom cut's limits are heights)
  }
  const wr = (name, sx, z) => ({ name, origin: [sx * track, R, z], rotation: [0, 0, 0], cubes: wheelOf(sx), children: [] });
  return { version: 1, scale: 0.0625, parts: [{ name: "body", origin: [0, pivot, 0], rotation: [0, 0, 0], cubes, children: [] }, wr("wheel_fl", -1, wheelZ[0]), wr("wheel_fr", 1, wheelZ[0]), wr("wheel_rl", -1, wheelZ[1]), wr("wheel_rr", 1, wheelZ[1])] };
}

// ---- shared by the car files (cars/*.mjs, spec.ts)
export const DARK = "#131418", GLASS_COL = "#1a2633", TRIM = "#0e0f12";
export const glassOf = (o) => ({ color: GLASS_COL, ...GLASS, depth: 0.07, wall: TRIM, ...o });
/// The upper part of a circle as an outline for a wheel opening, carried down below the sill.
export const archOutline = (zc, yc, r, n = 22, y0 = -1, a0 = -0.2, a1 = Math.PI + 0.2) => [[r2(zc + r * Math.cos(a0)), y0], ...Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [r2(zc + r * Math.cos(a)), r2(yc + r * Math.sin(a))]; }), [r2(zc + r * Math.cos(a1)), y0]];
export const mirrorX = (pts) => [...pts, ...[...pts].reverse().filter(([x]) => x > 1e-6).map(([x, y]) => [-x, y])];
/// A flare standing proud round a wheel opening: `outline` runs over the opening from its front foot to its rear foot.
export function flare(name, outline, at, sx, out, proud, color) {
  const n = outline.length, cz = (outline[0][0] + outline[n - 1][0]) / 2, cy = outline[0][1], verts = [], loops = [];
  for (const [z, y] of outline) {
    const dz = z - cz, dy = Math.max(y - cy, 0), l = Math.hypot(dz, dy) || 1, qz = z + (dz / l) * out, qy = y + (dy / l) * out, x0 = at.side(z, Math.max(y, cy + 1.2)), x1 = at.side(qz, Math.max(qy, cy + 1.2));
    verts.push([sx * (x0 - 0.3), y, z], [sx * (x0 + proud), y, z], [sx * (x1 + proud * 0.55), qy, qz], [sx * (x1 - 0.15), qy, qz]);
  }
  for (let i = 0; i < n - 1; i++) { const a = i * 4, b = a + 4; loops.push({ v: [a, a + 1, b + 1, b], want: [0, -1, 0] }, { v: [a + 1, a + 2, b + 2, b + 1], want: [sx, 0, 0] }, { v: [a + 2, a + 3, b + 3, b + 2], want: [0, 1, 0] }); }
  const m = mesh(name, verts, loops, color, { material: PLASTIC, smooth: true });
  // (the inner return looks at the wheel, the outer chamfer away from it)
  m.polys = loops.map((l, k) => {
    const P = l.v.map((i) => verts[i]), c = P.reduce((s, v) => s.map((x, j) => x + v[j] / 4), [0, 0, 0]);
    const ref = k % 3 === 1 ? [sx, 0, 0] : k % 3 === 0 ? [0, cy - c[1], cz - c[2]] : [0, c[1] - cy, c[2] - cz];
    const nn = [0, 0, 0];
    for (let i = 0; i < 4; i++) { const p = P[i], q = P[(i + 1) % 4]; nn[0] += (p[1] - q[1]) * (p[2] + q[2]); nn[1] += (p[2] - q[2]) * (p[0] + q[0]); nn[2] += (p[0] - q[0]) * (p[1] + q[1]); }
    return { v: nn[0] * ref[0] + nn[1] * ref[1] + nn[2] * ref[2] >= 0 ? l.v : [...l.v].reverse(), smooth: true };
  });
  return m;
}

// ---- helpers the second set of cars needed (2026-11-20), moved here from their car files
/// A round tube along a line of points (a snorkel, a pipe, a mirror arm): `n` sides, closed at both ends.
export function tube(name, pts, r, color, o = {}, n = 10) {
  const verts = [], loops = [], m = pts.length, nrm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); }, cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  for (let i = 0; i < m; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(m - 1, i + 1)], t = nrm(b.map((v, k) => v - a[k])), ref = Math.abs(t[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1], u = nrm(cross(t, ref)), v = cross(t, u), rr = Array.isArray(r) ? r[i] : r;
    for (let k = 0; k < n; k++) { const an = (k / n) * 2 * Math.PI, c = Math.cos(an) * rr, s = Math.sin(an) * rr; verts.push(pts[i].map((p, j) => p + u[j] * c + v[j] * s)); }
  }
  for (let i = 0; i < m - 1; i++) for (let k = 0; k < n; k++) {
    const q = [i * n + k, i * n + ((k + 1) % n), (i + 1) * n + ((k + 1) % n), (i + 1) * n + k], c = q.reduce((s, j) => s.map((x, a) => x + verts[j][a] / 4), [0, 0, 0]), mid = pts[i].map((p, j) => (p + pts[i + 1][j]) / 2);
    loops.push({ v: q, want: c.map((x, j) => x - mid[j]) });
  }
  loops.push({ v: Array.from({ length: n }, (_, k) => k), want: pts[0].map((p, j) => p - pts[1][j]) }, { v: Array.from({ length: n }, (_, k) => (m - 1) * n + k), want: pts[m - 1].map((p, j) => p - pts[m - 2][j]) });
  return mesh(name, verts, loops, color, { material: o.material ?? PLASTIC, smooth: true });
}
/// A wing blade: the section [[z, y], ...] (a closed aerofoil outline) carried from x0 to x1.
export function loft(name, section, x0, x1, color, o = {}) {
  const n = section.length, verts = [], loops = [];
  for (const x of [x0, x1]) for (const [z, y] of section) verts.push([x, y, z]);
  for (let i = 0; i < n; i++) loops.push([i, (i + 1) % n, n + ((i + 1) % n), n + i]);
  loops.push(Array.from({ length: n }, (_, i) => i), Array.from({ length: n }, (_, i) => n + i));
  return mesh(name, verts, loops, color, o);
}
/// A flat slab: the outline [[x, z], ...] between two heights (a splitter, a wing's end plate laid flat).
export function slab(name, outline, y0, y1, color, o = {}) {
  const n = outline.length, verts = [...outline.map(([x, z]) => [x, y0, z]), ...outline.map(([x, z]) => [x, y1, z])], loops = [];
  loops.push({ v: Array.from({ length: n }, (_, i) => i), want: [0, -1, 0] }, { v: Array.from({ length: n }, (_, i) => n + i), want: [0, 1, 0] });
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; loops.push([i, j, n + j, n + i]); }
  return mesh(name, verts, loops, color, o);
}
/// A wing blade across the car: `sections` are [x, zLead, yLead, zTrail, yTrail] from one tip to the other; a thin aerofoil (rounded nose, sharp tail).
export function blade(name, sections, thick, color, o = {}) {
  const verts = [], loops = [], K = 6;
  for (const [x, z0, y0, z1, y1] of sections) {
    const at = (t, up) => [x, y0 + (y1 - y0) * t + up, z0 + (z1 - z0) * t];
    verts.push(at(0, 0), at(0.12, thick * 0.6), at(0.45, thick * 0.75), at(1, thick * 0.12), at(1, -thick * 0.12), at(0.35, -thick * 0.35));
  }
  for (let s = 0; s < sections.length - 1; s++) for (let k = 0; k < K; k++) loops.push([s * K + k, s * K + ((k + 1) % K), (s + 1) * K + ((k + 1) % K), (s + 1) * K + k]);
  loops.push(Array.from({ length: K }, (_, k) => k), Array.from({ length: K }, (_, k) => (sections.length - 1) * K + k));
  return mesh(name, verts, loops, color, o);
}
/// A wheel opening that is a little taller than wide (a helper of this file): the upper part of an ellipse carried down below the sill.
export const archE = (zc, yc, rx, ry, n = 24, y0 = -1, a0 = -0.15, a1 = Math.PI + 0.15) => [[r2(zc + rx * Math.cos(a0)), y0], ...Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [r2(zc + rx * Math.cos(a)), r2(yc + ry * Math.sin(a))]; }), [r2(zc + rx * Math.cos(a1)), y0]];
/// Hexagon bars for a grille: rows of bars that pinch together and part again, so the gaps between them are long hexagons. Thin strips `back` behind the skin.
/// Whether (x, y) lies inside an outline.
export const inPoly = (o, x, y) => { let c = false; for (let i = 0, j = o.length - 1; i < o.length; j = i++) { const [xi, yi] = o[i], [xj, yj] = o[j]; if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
export function hexBars(name, outline, at, back, o) {
  const { y0, y1, pitch, amp, period, wid, color } = o, verts = [], loops = [];
  let x0 = Infinity, x1 = -Infinity;
  for (const [x] of outline) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
  const wave = (x) => { const u = (((x / period) % 1) + 1) % 1, t = u < 0.3 ? 1 : u < 0.5 ? 1 - (u - 0.3) * 10 : u < 0.8 ? -1 : -1 + (u - 0.8) * 10; return t; };
  const step = period / 20;
  let k = 0;
  for (let y = y0; y <= y1 + 1e-6; y += pitch, k++) {
    const yy = (x) => y + (k % 2 ? -1 : 1) * amp * wave(x + period * 0.15);
    for (let x = x0; x < x1; x += step) {
      const a = [x, yy(x)], b = [x + step, yy(x + step)];
      if (!inPoly(outline, a[0], a[1]) || !inPoly(outline, b[0], b[1])) continue;
      const base = verts.length;
      for (const [px, py] of [a, b]) { const z = at(px, py) - back; verts.push([px, py - wid / 2, z], [px, py + wid / 2, z + 0.06]); }
      loops.push({ v: [base, base + 1, base + 3, base + 2], want: [0, 0, 1] });
    }
  }
  return mesh(name, verts, loops, color, { material: o.material ?? PLASTIC });
}
/// Where a ray from `c` at angle `a` leaves a closed outline (z, y).
export function rayHit(outline, c, a) {
  const d = [Math.cos(a), Math.sin(a)];
  let best = null;
  for (let i = 0; i < outline.length; i++) {
    const p = outline[i], q = outline[(i + 1) % outline.length], e = [q[0] - p[0], q[1] - p[1]], den = d[0] * e[1] - d[1] * e[0];
    if (Math.abs(den) < 1e-9) continue;
    const t = ((p[0] - c[0]) * e[1] - (p[1] - c[1]) * e[0]) / den, u = ((p[0] - c[0]) * d[1] - (p[1] - c[1]) * d[0]) / den;
    if (t > 0 && u >= -1e-6 && u <= 1 + 1e-6 && (best === null || t < best)) best = t;
  }
  return [c[0] + d[0] * (best ?? 1), c[1] + d[1] * (best ?? 1)];
}
/// A boxy bolted-on wheel-arch extension: a flat face standing off the flank at x = xf(z), from the wheel opening (circle `c`, `r`, angles a0..a1) out to
/// `outline` (z, y), with a chamfer `ch` wide back to the skin, a lip turned in round the opening, and rivets along the chamfer. Returns shapes.
export function boxArch(name, o, at, sx, color, cuts) {
  const n = o.n ?? 30, [cz, cy] = o.c, xf = curve(o.xf), verts = [], loops = [], out = [];
  const skin = (p) => at.side(p[0], Math.max(p[1], o.skinY ?? 5.5)), faceX = (p) => Math.max(xf(p[0]), skin(p) + 0.12);
  const row = [];
  for (let i = 0; i <= n; i++) {
    const a = o.a0 + ((o.a1 - o.a0) * i) / n, I = [cz + o.r * Math.cos(a), cy + o.r * Math.sin(a)], O = rayHit(o.outline, o.c, a);
    const d = Math.hypot(O[0] - I[0], O[1] - I[1]), k = Math.min(o.ch ?? 0.9, d * 0.5) / (d || 1), F = [O[0] + (I[0] - O[0]) * k, O[1] + (I[1] - O[1]) * k];
    row.push({ I, F, O, xi: Math.max(faceX(I), faceX(F) - 0.05), xo: faceX(F), xs: skin(O) - 0.15, xl: skin(I) - 0.5 });
  }
  const P = (x, p) => verts.push([sx * x, p[1], p[0]]) - 1;
  // three strips with their own points, so the edges between them stay crisp
  const strips = [
    (s) => [P(s.xl, s.I), P(s.xi, s.I)], // the lip, looking at the wheel
    (s) => [P(s.xi, s.I), P(s.xo, s.F)], // the face
    (s) => [P(s.xo, s.F), P(s.xs, s.O)], // the chamfer
  ];
  strips.forEach((mk, k) => {
    const ids = row.map(mk);
    for (let i = 0; i < n; i++) {
      const m = row[i], dz = m.F[0] - cz, dy = m.F[1] - cy, l = Math.hypot(dz, dy) || 1;
      loops.push({ v: [ids[i][0], ids[i][1], ids[i + 1][1], ids[i + 1][0]], want: k === 0 ? [0, -dy, -dz] : k === 1 ? [sx, 0, 0] : [sx * 0.7, dy / l, dz / l] });
    }
  });
  for (const s of [row[0], row[n]]) loops.push({ v: [P(s.xl, s.I), P(s.xi, s.I), P(s.xo, s.F), P(s.xs, s.O)], want: [0, -1, 0] });
  const m = mesh(name, verts, loops, color, { material: PAINT, smooth: true });
  if (cuts?.length) m.modifiers = [{ type: "cutout", cuts }];
  out.push(m);
  for (let i = 2; i < n - 1; i += o.rivetEvery ?? 3) {
    const s = row[i], k = 0.45, p = [s.F[0] + (s.I[0] - s.F[0]) * k * 0.3, s.F[1] + (s.I[1] - s.F[1]) * k * 0.3];
    out.push(cyl(`${name} rivet ${i}`, sx * (faceX(p) + 0.02), p[1], p[0], 0.12, 0.1, "x", "#9a9fa8", { segments: 6, material: STEEL }));
  }
  return out;
}
/// A bar swept along a line in plan (x, z): a bumper that follows the nose and wraps the corners. `y0`..`y1` its height, `deep` its thickness inwards.
export function sweptBar(name, line, y0, y1, deep, color, o = {}) {
  const c = o.chamfer ?? 0.3, n = line.length, verts = [], loops = [], mid = line.reduce((m, p) => [m[0] + p[0] / n, m[1] + p[1] / n], [0, 0]);
  const sec = [];
  for (let i = 0; i < n; i++) {
    const a = line[Math.max(0, i - 1)], b = line[Math.min(n - 1, i + 1)], p = line[i], tx = b[0] - a[0], tz = b[1] - a[1], l = Math.hypot(tx, tz) || 1;
    let nx = -tz / l, nz = tx / l; // inwards: towards the middle of the line
    if (nx * (mid[0] - p[0]) + nz * (mid[1] - p[1]) < 0) { nx = -nx; nz = -nz; }
    const at = (d, y) => verts.push([p[0] + nx * d, y, p[1] + nz * d]) - 1;
    sec.push([at(0, y0 + c), at(0, y1 - c), at(c, y1), at(deep, y1), at(deep, y0), at(c, y0)]);
  }
  for (let i = 0; i < n - 1; i++) for (let k = 0; k < 6; k++) {
    const q = [sec[i][k], sec[i][(k + 1) % 6], sec[i + 1][(k + 1) % 6], sec[i + 1][k]];
    const cen = [...sec[i], ...sec[i + 1]].reduce((m, v) => m.map((x, j) => x + verts[v][j] / 12), [0, 0, 0]), fc = q.reduce((m, v) => m.map((x, j) => x + verts[v][j] / 4), [0, 0, 0]);
    loops.push({ v: q, want: fc.map((x, j) => x - cen[j]) });
  }
  loops.push({ v: sec[0], want: [line[0][0] - line[1][0], 0, line[0][1] - line[1][1]] }, { v: sec[n - 1], want: [line[n - 1][0] - line[n - 2][0], 0, line[n - 1][1] - line[n - 2][1]] });
  const m = mesh(name, verts, loops, color, { material: o.material ?? PAINT });
  if (o.cuts) m.modifiers = [{ type: "cutout", cuts: o.cuts }];
  return m;
}
