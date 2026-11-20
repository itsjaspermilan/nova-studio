// Two cars modelled straight from the owner's blueprints (2026-11-19): a 1990s two-door coupe and a short 4x4 wagon. Self-contained (it shares
// nothing with the older body.mjs): a spec lists the blueprint's measurements, `buildCar` lofts the shell from cross-sections with a real glasshouse
// (frames, pillars, glass), arch lips and lathe-turned tyres, then adds the lamps, grilles, handles, wipers and so on as small shaped meshes.
// Units are 1/16 m, y up from the ground, the nose along +z. Run:  scripts/env.sh node scripts/rally/blueprint-car.mjs [car_coupe] [car_offroad]
import { withServer } from "./mcp.mjs";

const r2 = (v) => Math.round(v * 100) / 100;
const lerp = (a, b, t) => a + (b - a) * t;
const along = (nodes, z) => {
  if (z <= nodes[0][0]) return nodes[0][1];
  for (let i = 1; i < nodes.length; i++) if (z <= nodes[i][0]) return lerp(nodes[i - 1][1], nodes[i][1], (z - nodes[i - 1][0]) / (nodes[i][0] - nodes[i - 1][0] || 1));
  return nodes[nodes.length - 1][1];
};
const parse = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hex = (c) => "#" + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
const shade = (h, f) => hex(parse(h).map((v) => v * f));
const PAINT = { metallic: 0.35, roughness: 0.3 }, GLASS = { metallic: 0.6, roughness: 0.08 }, RUBBER = { metallic: 0, roughness: 0.9 }, STEEL = { metallic: 0.85, roughness: 0.28 };

// ---- small vector helpers and the mesh builder -------------------------------------------------------------------------------------------
const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function newell(P) {
  const n = [0, 0, 0];
  for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; n[0] += (p[1] - q[1]) * (p[2] + q[2]); n[1] += (p[2] - q[2]) * (p[0] + q[0]); n[2] += (p[0] - q[0]) * (p[1] + q[1]); }
  return n;
}
/// A mesh shape from points and polygons; each polygon is turned so that it faces away from `inside` (a point inside a convex-ish solid) or along `want(poly)`.
function mesh(name, verts, loops, color, o = {}) {
  const centre = verts.reduce((m, v) => m.map((x, i) => x + v[i] / verts.length), [0, 0, 0]);
  const polys = loops.map((lp) => {
    const loop = Array.isArray(lp) ? lp : lp.v;
    const P = loop.map((i) => verts[i]);
    const c = P.reduce((m, v) => m.map((x, i) => x + v[i] / P.length), [0, 0, 0]);
    const n = newell(P);
    const ref = lp.want ?? sub(c, o.inside ?? centre);
    return { v: dot(n, ref) >= 0 ? loop : [...loop].reverse(), color: (Array.isArray(lp) ? undefined : lp.color) ?? color, smooth: o.smooth ?? false };
  });
  const cube = { name, shape: "mesh", color, verts: verts.map((v) => v.map(r2)), polys, ...(o.material ?? { metallic: 0.2, roughness: 0.55 }) };
  if (o.bevel) cube.modifiers = [{ type: "bevel", width: o.bevel, segments: o.segs ?? 2, angle: 30 }];
  if (o.emissive) { cube.emissive = o.emissive; cube.metallic = 0; cube.roughness = 0.2; }
  return cube;
}
const BOX = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
/// A box whose front face and back face are quads you choose: `a` the four (x, y) corners at z0, `b` those at z1.
const prism = (name, a, b, z0, z1, color, o) => mesh(name, [...a.map(([x, y]) => [x, y, z0]), ...b.map(([x, y]) => [x, y, z1])], BOX, color, o);
const box = (name, x0, x1, y0, y1, z0, z1, color, o) => prism(name, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], z0, z1, color, o);
/// A cylinder (a lamp, a pipe, a spare wheel): centre (cx, cy, cz), radius r, length len along `axis`.
const cyl = (name, cx, cy, cz, r, len, axis, color, o = {}) => Object.assign({ name, shape: "cylinder", from: [cx - r, cy - len / 2, cz - r], size: [2 * r, len, 2 * r], rotation: axis === "z" ? [90, 0, 0] : axis === "x" ? [0, 0, 90] : [0, 0, 0], color, segments: o.segments ?? 20, smooth: true }, o.material ?? RUBBER, o.emissive ? { emissive: o.emissive, metallic: 0, roughness: 0.2 } : {});
/// A thin strip lying on the surface (a wiper): two end points and a width and thickness.
const strip = (name, p0, p1, wid, thick, color, o) => {
  const d = sub(p1, p0), s = crs(d, [0, 1, 0]), sl = Math.hypot(...s) || 1, k = wid / 2 / sl, off = s.map((v) => v * k);
  const up = [0, thick, 0];
  const base = [p0.map((v, i) => v - off[i]), p1.map((v, i) => v - off[i]), p1.map((v, i) => v + off[i]), p0.map((v, i) => v + off[i])];
  return mesh(name, [...base, ...base.map((p) => p.map((v, i) => v + up[i]))], BOX, color, o);
};
const both = (fn) => [1, -1].map(fn);

// ---- the shell ---------------------------------------------------------------------------------------------------------------------------
/// Round each wheel the body has a real opening: an arch of radius Ra (a little more than the tyre) cut through the side, with an inner wall
/// beside the tyre and a roof over it. `archAt(s, z)` is the arch's roof height at z, or null outside every arch.
const archRadius = (s) => s.R * (s.archK ?? 1.17);
const archAt = (s, z) => {
  const Ra = archRadius(s);
  for (const zc of s.wheelZ) { const d = z - zc; if (Math.abs(d) <= Ra + 1e-6) return { zc, ya: Math.min(s.R + Math.sqrt(Math.max(Ra * Ra - d * d, 0)), along(s.belt, z) - 1.0) }; }
  return null;
};
/// The half section at z: 13 points from the middle of the underside to the middle of the roof. 0 underside, 1 floor edge, 2 sill, 3 and 4 lower
/// side (or the arch's inner wall), 5 the arch lip (or the flank), 6 the shoulder, 7 to 9 the glass edges, 10 gutter, 11 roof edge, 12 the roof.
export function ringAt(s, z) {
  const w = along(s.w, z), yb = along(s.yb, z), belt = along(s.belt, z), top = along(s.top, z), rw = along(s.roofW, z);
  const arch = archAt(s, z), xin = s.track - s.tw / 2 - 0.7;
  const t = Math.max(top - belt, 0.9), big = t > 5;
  const tuck = s.tuck ?? 0, shY = s.shoulder !== undefined ? Math.min(typeof s.shoulder === "number" ? s.shoulder : along(s.shoulder, z), belt - 0.8) : null;
  const gx = (g) => lerp(w - tuck, rw, g);
  const y7 = belt + (s.glassLow ? along(s.glassLow, z) : Math.min(0.4, 0.15 * t)), y8a = belt + t * (big ? 0.88 : 0.6), y9 = top - Math.min(0.55, 0.15 * t), y8 = s.glassTopOff ? Math.max(Math.min(top - along(s.glassTopOff, z), y9 - 0.05), y7 + 0.15) : y8a, y10 = top - Math.min(0.35, 0.1 * t), y11 = top - Math.min(0.06, 0.02 * t);
  const low = (a) => yb + a * (belt - yb);
  const head = arch
    ? [[0, yb], [Math.min(xin, w - 3.2), yb], [xin, yb + 1.0], [xin, lerp(yb, arch.ya, 0.4)], [xin, arch.ya - 0.25], [w, arch.ya], [w - tuck, belt]]
    : [[0, yb], [Math.max(w - 3.2, 1), yb], [w - 1.0, yb + 1.2], [w, low(0.3)], [w, s.lineA ? Math.min(Math.max(along(s.lineA, z), low(0.3) + 0.3), (shY ?? low(0.8)) - 0.3) : low(0.55)], [w, shY ?? low(0.8)], [w - tuck, belt]];
  return [...head, [gx(0.06), y7], [gx(0.78), y8], [gx(0.9), y9], [Math.min(gx(1.0), rw), y10], [rw * 0.5, y11], [0, top]];
}
/// Is the point (x, y) inside the half section at z? (the section's polygon, closed through the axis)
function insideAt(s, z, x, y) {
  const p = ringAt(s, z); let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const [xi, yi] = p[i], [xj, yj] = p[j]; if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; }
  return c && x >= 0;
}
/// The z of the body's skin at (x, y), looking in from the nose (dir 1) or the tail (dir -1): the end cap's plane where the point is inside the end
/// section, otherwise the first place going inwards where the section holds the point.
function surfaceZ(s, x, y, dir) {
  let z = dir > 0 ? s.zf : s.zr;
  if (insideAt(s, z, Math.abs(x), y)) return z;
  let prev = z;
  for (let i = 0; i < 700; i++) { z -= dir * 0.05; if (insideAt(s, z, Math.abs(x), y)) { let lo = z, hi = prev; for (let k = 0; k < 10; k++) { const m = (lo + hi) / 2; if (insideAt(s, m, Math.abs(x), y)) lo = m; else hi = m; } return (lo + hi) / 2; } prev = z; }
  return z;
}
/// The x of the side's skin at (z, y) on the positive side, from the sill up.
function flankX(s, z, y) {
  const pts = ringAt(s, z);
  for (let i = 3; i < pts.length; i++) if (y <= pts[i][1] + 1e-6) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return x0 + (x1 - x0) * ((y - y0) / (y1 - y0 || 1)); }
  return pts[pts.length - 1][0];
}
/// Where the body's side is at height y (before smoothing), for fixing details to it.
function sideX(s, z, y) {
  const pts = ringAt(s, z);
  for (let i = 5; i < pts.length; i++) if (y <= pts[i][1] + 1e-6) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return x0 + (x1 - x0) * ((y - y0) / (y1 - y0 || 1)); }
  return pts[pts.length - 1][0];
}

function loftShell(s) {
  const { zr, zf } = s;
  const keys = new Set([r2(zr), r2(zf)]), gapZ = new Set();
  const add = (z) => { if (z > zr && z < zf) keys.add(r2(z)); };
  for (const list of [s.w, s.yb, s.belt, s.top, s.roofW]) for (const [z] of list) add(z);
  const Ra = archRadius(s);
  for (const zc of s.wheelZ) {
    for (let k = 0; k <= 12; k++) { const a = (k / 12) * Math.PI; add(zc + Ra * Math.cos(a)); } // the arch's edge, every 15 degrees
    add(zc + Ra + 0.3); add(zc - Ra - 0.3);
  }
  for (const [a, b] of s.sideWin) { add(a); add(a + 0.5); add(b - 0.5); add(b); }
  for (const rg of [s.screen, s.rear]) if (rg) { add(rg[0]); add(rg[0] + 0.5); add((rg[0] + rg[1]) / 2); add(rg[1] - 0.5); add(rg[1]); }
  let zs = [...keys].sort((a, b) => a - b);
  for (const z of s.seams) { zs = zs.filter((k) => Math.abs(k - z) > 0.6 || k === zr || k === zf); zs.push(r2(z - 0.1), r2(z + 0.1)); gapZ.add(r2(z - 0.1)); }
  const topGap = new Set();
  for (const z of s.topCuts ?? []) { zs = zs.filter((k) => Math.abs(k - z) > 0.4); zs.push(r2(z - 0.08), r2(z + 0.08)); topGap.add(r2(z - 0.08)); gapZ.add(r2(z - 0.08)); }
  zs.sort((a, b) => a - b);
  const out = [];
  for (const z of zs) { const last = out[out.length - 1]; if (last === undefined || z - last >= 0.2 || gapZ.has(z) || gapZ.has(last)) out.push(z); }
  zs = [];
  for (let i = 0; i < out.length; i++) { if (i) { const g = out[i] - out[i - 1]; for (let k = 1; k < Math.ceil(g / 3.6); k++) zs.push(r2(out[i - 1] + (g * k) / Math.ceil(g / 3.6))); } zs.push(out[i]); }
  const N = zs.length, rings = zs.map((z) => ringAt(s, z)), M = rings[0].length;
  const inR = (z, list) => list.some(([a, b]) => z >= a && z <= b);
  const dark = s.dark ?? "#1b1c22", trim = s.trim ?? "#15161b", glass = s.glass ?? "#2f4f78", well = "#0d0e12";
  const colour0 = (i, j) => {
    const z = (zs[i] + zs[i + 1]) / 2;
    if (gapZ.has(zs[i]) && !topGap.has(zs[i]) && j >= 2 && j <= 9) return shade(s.paint, 0.4);
    if (j >= 1 && j <= 4 && archAt(s, z) && archAt(s, zs[i]) && archAt(s, zs[i + 1])) return well; // inside an arch: the dark wall and roof
    const win = inR(z, s.sideWin), scr = s.screen && z >= s.screen[0] && z <= s.screen[1], rr = s.rear && z >= s.rear[0] && z <= s.rear[1];
    const frameEnd = (list) => list.some(([a, b]) => z >= a && z <= b && (z < a + 0.55 || z > b - 0.55));
    const endBumper = s.bumper && (z < zr + (s.bumperLen ?? 3.4) || z > zf - (s.bumperLen ?? 3.4));
    switch (j) {
      case 0: case 1: return dark;
      case 2: return endBumper ? s.bumper : s.sill ?? dark;
      case 3: return endBumper ? s.bumper : s.lower ?? s.paint;
      case 4: return endBumper ? s.bumper : s.paint;
      case 5: return endBumper && z > zf - 2 ? s.bumper : s.paint;
      case 6: return win ? trim : s.paint;
      case 7: return win ? (frameEnd(s.sideWin) ? trim : glass) : s.paint;
      case 8: return win ? trim : s.paint;
      case 9: return s.paint;
      default: {
        if (scr) return z < s.screen[0] + 0.55 || z > s.screen[1] - 0.55 ? trim : glass;
        if (rr) return z < s.rear[0] + 0.55 || z > s.rear[1] - 0.55 ? trim : glass;
        return s.roofZ && (z < s.roofZ[0] || z > s.roofZ[1]) ? s.paint : s.roof ?? s.paint;
      }
    }
  };
  // baked shading, so that the forms read: the lower flank darker, the shoulder and the top surfaces lighter, glass brighter towards the sky
  const TONE = { 2: 0.9, 3: 0.84, 4: 0.9, 5: 1.06, 9: 1.03, 10: 1.1, 11: 1.14 };
  const lerpT = (a, b, u) => a + (b - a) * Math.max(0, Math.min(1, u));
  const colour = (i, j) => {
    let c = colour0(i, j);
    const z = (zs[i] + zs[i + 1]) / 2;
    if (topGap.has(zs[i]) && j >= 9) return shade(s.paint, 0.38);
    if (j === 9 && (s.shut ?? []).some(([a, b]) => z >= a && z <= b) && (c === s.paint || c === s.roof)) return shade(s.paint, 0.42);
    if (c === s.paint || c === s.roof) return shade(c, TONE[j] ?? 1);
    if (c === glass) {
      if (s.screen && z >= s.screen[0] && z <= s.screen[1] && j >= 10) return shade(glass, lerpT(1.55, 0.95, (z - s.screen[0]) / (s.screen[1] - s.screen[0])));
      if (s.rear && z >= s.rear[0] && z <= s.rear[1] && j >= 10) return shade(glass, lerpT(0.95, 1.5, (z - s.rear[0]) / (s.rear[1] - s.rear[0])));
      return shade(glass, lerpT(0.85, 1.3, (z - s.sideWin[0][0]) / (s.sideWin[s.sideWin.length - 1][1] - s.sideWin[0][0])));
    }
    return c;
  };
  const verts = [], polys = [], id = (i, j) => i * M + j;
  for (let i = 0; i < N; i++) for (const [x, y] of rings[i]) verts.push([r2(x), r2(y - s.pivot), zs[i]]);
  // every quad is wound the same way as the rings run: find which way that faces outwards once (a flat piece of side, away from the wheels)
  const flat = rings.findIndex((r, i) => !archAt(s, zs[i]) && !archAt(s, zs[Math.min(i + 1, N - 1)]) && i > 1);
  const q0 = [id(flat, 7), id(flat, 8), id(flat + 1, 8), id(flat + 1, 7)];
  const keep = dot(newell(q0.map((k) => verts[k])), [1, 0, 0]) > 0;
  const quad = (a, b, c, d) => (keep ? [a, b, c, d] : [d, c, b, a]);
  const mid = verts.reduce((m, v) => m.map((x, a) => x + v[a] / verts.length, [0, 0, 0]), [0, 0, 0]);
  const orient = (loop) => {
    const P = loop.map((k) => verts[k]);
    const c = P.reduce((m, v) => m.map((x, a) => x + v[a] / P.length), [0, 0, 0]);
    const ref = Math.abs(c[2] - verts[0][2]) < 1e-6 ? [0, 0, -1] : [0, 0, 1];
    return dot(newell(P), ref) > 0 ? loop : [...loop].reverse();
  };
  for (let i = 0; i < N - 1; i++) for (let j = 0; j < M - 1; j++) polys.push({ v: quad(id(i, j), id(i, j + 1), id(i + 1, j + 1), id(i + 1, j)), color: colour(i, j), smooth: true });
  for (const i of [0, N - 1]) polys.push({ v: orient(Array.from({ length: M }, (_, j) => id(i, j))), color: s.capColor ?? s.paint, smooth: true });
  void mid;
  const creases = [], across = { 1: 0.5, 2: 0.7, ...(s.lineA ? { 4: 0.6 } : {}), 5: 0.8, 6: 0.6, 7: 0.7, 8: 0.7, 9: 0.6, 10: 0.45 };
  for (let i = 0; i < N - 1; i++) for (const [j, wgt] of Object.entries(across)) creases.push([id(i, +j), id(i + 1, +j), wgt]);
  for (let i = 0; i < N; i++) {
    const wall = gapZ.has(zs[i]), end = i === 0 || i === N - 1, edge = !end && !!archAt(s, zs[i]) !== !!archAt(s, zs[i - 1]);
    if (wall || end) for (let j = end ? 0 : 2; j < (end ? M - 1 : 9); j++) creases.push([id(i, j), id(i, j + 1), end ? 0.55 : 0.8]);
    if (edge) for (let j = 1; j < 6; j++) creases.push([id(i, j), id(i, j + 1), 0.8]);
  }
  const body = { name: "body", shape: "mesh", color: s.paint, verts, polys, creases, modifiers: [{ type: "mirror", axis: "x", merge: 0.02, clip: true }, { type: "subsurf", levels: 1, renderLevels: s.renderLevels ?? 0, smooth: true }], ...PAINT };
  return { body, zs };
}

// ---- arch lips, wheels ---------------------------------------------------------------------------------------------------------------------
/// A black lip round the top of each wheel arch, standing a little proud of the side.
function archLips(s) {
  if (s.noLips) return []; // (none of the blueprints has a flare or a lip: the arch is the body's own cut edge)
  const cubes = [], lip = s.lip ?? 0.9, col = s.lipColor ?? "#16171c";
  for (const zc of s.wheelZ) for (const sx of [1, -1]) {
    const Ra = s.R * 1.17, verts = [], quads = [];
    const steps = 18, th0 = -0.1, th1 = Math.PI + 0.1;
    const yLow = along(s.yb, zc) + 2.2;
    for (let k = 0; k <= steps; k++) {
      const th = th0 + ((th1 - th0) * k) / steps, c = Math.cos(th), sn = Math.sin(th);
      const yIn = s.R + Ra * sn, yOut = s.R + (Ra + lip) * sn, zIn = zc + Ra * c, zOut = zc + (Ra + lip) * c;
      const cap = (z) => along(s.belt, z) + 0.1;
      const x0 = along(s.w, zIn) + 0.1;
      verts.push([sx * (x0 + 0.55), Math.min(Math.max(yIn, yLow), cap(zIn)), zIn], [sx * (x0 + 0.55), Math.min(Math.max(yOut, yLow), cap(zOut)), zOut], [sx * (x0 - 0.4), Math.min(Math.max(yOut, yLow), cap(zOut)), zOut], [sx * (x0 - 0.4), Math.min(Math.max(yIn, yLow), cap(zIn)), zIn]);
    }
    for (let k = 0; k < steps; k++) {
      const a = k * 4, b = a + 4;
      quads.push({ v: [a, a + 1, b + 1, b], want: [sx, 0, 0] }, { v: [a + 1, a + 2, b + 2, b + 1], want: [0, 1, 0] }, { v: [a + 3, a, b, b + 3], want: [0, -1, 0] });
    }
    cubes.push(mesh(`arch lip ${sx}`, verts, quads, col, { material: RUBBER, smooth: false }));
  }
  return cubes;
}

/// A wheel and tyre (tyre, sidewall, rim, dish, spokes, hub, tread knobs) built round the x axis; `axis` "z" turns it to lie along z (the spare), `at` its centre.
export function wheelCubes(s, R, tw, axis = "x", at = [0, 0, 0]) {
  const m = (x, y, z) => (axis === "x" ? [x + at[0], y + at[1], z + at[2]] : [z + at[0], y + at[1], x + at[2]]);
  const T = tw / 2, c0 = m(0, 0, 0), rimK = s.rimK ?? 0.62; // (rimK: how much of the wheel's radius the rim fills: 0.73 on the Apex GT, 0.59 on the 4x4, as drawn)
  const cubes = [
    cyl("tyre", ...c0, R, tw, axis, "#202127", { segments: 28 }),
    cyl("sidewall", ...c0, 0.86 * R, tw * 1.05, axis, "#33343d", { segments: 28 }),
    cyl("rim dish", ...c0, rimK * R, tw * 1.08, axis, s.dish ?? "#2a2c33", { material: STEEL, segments: 28 }),
    cyl("brake disc", ...c0, Math.min(0.5, rimK - 0.1) * R, tw * 1.12, axis, "#8d939e", { material: STEEL, segments: 28 }),
  ];
  // the rim's lip: a flat ring standing proud of the tyre's sidewall, both sides
  for (const side of [-1, 1]) {
    const n = 28, vv = [], ll = [];
    for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a); vv.push(m(side * 0.575 * tw, c * (rimK + 0.04) * R, sn * (rimK + 0.04) * R), m(side * 0.575 * tw, c * (rimK - 0.06) * R, sn * (rimK - 0.06) * R), m(side * 0.5 * tw, c * (rimK + 0.04) * R, sn * (rimK + 0.04) * R)); }
    for (let k = 0; k < n; k++) { const a = k * 3, b = ((k + 1) % n) * 3; ll.push([a, a + 1, b + 1, b], [a, b, b + 2, a + 2]); }
    cubes.push(mesh("rim ring", vv, ll, s.rim, { material: STEEL, inside: c0 }));
  }
  if (axis === "x") for (const side of [-1, 1]) cubes.push(box("caliper", Math.min(side * 0.34 * tw, side * 0.56 * tw), Math.max(side * 0.34 * tw, side * 0.56 * tw), 0.18 * R, 0.5 * R, -0.34 * R, 0.1 * R, s.caliper ?? "#d3262c", { bevel: 0.15, segs: 1 }));
  const n = s.spokes ?? 5, verts = [], loops = [], r0 = (s.spokeR0 ?? 0.16) * R, r1 = (s.spokeR1 ?? rimK - 0.06) * R, w1k = s.spokeW1 ?? (s.spokeW ?? 0.09) * 1.2;
  for (const side of [-1, 1]) for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + 0.3, c = Math.cos(a), sn = Math.sin(a), w = (s.spokeW ?? 0.09) * R, w1 = w1k * R, base = verts.length;
    const at3 = (r, off, ax) => m(side * ax, c * r - sn * off, sn * r + c * off);
    const ax0 = T * 1.17, ax1 = T * 1.27;
    verts.push(at3(r0, -w, ax0), at3(r0, w, ax0), at3(r1, w1, ax0), at3(r1, -w1, ax0), at3(r0, -w, ax1), at3(r0, w, ax1), at3(r1, w1, ax1), at3(r1, -w1, ax1));
    for (const f of BOX) loops.push(f.map((i) => base + i));
  }
  if (n > 0) cubes.push(mesh("spokes", verts, loops, s.rim, { material: STEEL, inside: c0 }));
  cubes.push(cyl("hub", ...c0, (s.hubK ?? 0.16) * R, tw * 1.5, axis, s.hubColor ?? "#9aa0aa", { material: STEEL, segments: 14 }));
  if (s.lugs) for (const side of [-1, 1]) for (let k = 0; k < s.lugs; k++) { // lug nuts on a ring round the hub
    const a = (k / s.lugs) * Math.PI * 2 + 0.5;
    cubes.push(cyl("lug nut", ...m(side * 0.62 * tw, Math.cos(a) * 0.2 * R, Math.sin(a) * 0.2 * R), 0.05 * R, 0.1 * tw, axis, "#c9ced6", { material: STEEL, segments: 6 }));
  }
  if (s.knobs) { // chunky tread blocks round the tyre
    const kv = [], kl = [], cnt = s.knobs;
    for (let k = 0; k < cnt; k++) {
      const a = (k / cnt) * Math.PI * 2, da = (Math.PI / cnt) * 0.62, base = kv.length;
      for (const rr of [R - 0.15, R + 0.5]) for (const [aa, ax] of [[a - da, -0.46 * tw], [a + da, -0.46 * tw], [a + da, 0.46 * tw], [a - da, 0.46 * tw]]) kv.push(m(ax, Math.cos(aa) * rr, Math.sin(aa) * rr));
      for (const f of BOX) kl.push(f.map((i) => base + i));
    }
    cubes.push(mesh("tread", kv, kl, "#202127", { material: RUBBER, inside: c0 }));
  }
  return cubes;
}
function wheelPart(name, sx, z, s, R, tw) {
  return { name, origin: [sx * s.track, R, z], rotation: [0, 0, 0], cubes: wheelCubes(s, R, tw), children: [] };
}

export function buildCar(s) {
  const { body } = loftShell(s);
  const cubes = [body, ...archLips(s)];
  const topAt = (z, x) => { const p = ringAt(s, z), ax = Math.abs(x); if (ax >= p[10][0]) return p[10][1]; for (let i = 10; i < 12; i++) if (ax >= p[i + 1][0]) return p[i + 1][1] + (p[i][1] - p[i + 1][1]) * ((ax - p[i + 1][0]) / (p[i][0] - p[i + 1][0] || 1)); return p[12][1]; };
  /// A thin sheet lying on the nose or tail: four (x, y) corners (bottom left, bottom right, top right, top left), each point at the skin's z plus `off`.
  const frontPatch = (nm, corners, dir, color, o = {}, off = 0.06, nu = 8, nv = 3) => {
    const verts = [], loops = [], lerp2 = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const lo = lerp2(corners[0], corners[1], i / nu), hi = lerp2(corners[3], corners[2], i / nu), [x, y] = lerp2(lo, hi, j / nv);
      verts.push([x, y, surfaceZ(s, x, y, dir) + dir * off]);
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i; loops.push({ v: [a, a + 1, a + nu + 2, a + nu + 1], want: [0, 0, dir] }); }
    return mesh(nm, verts, loops, color, { ...o, smooth: true });
  };
  /// A sheet on the side (sx = 1 or -1): z0..z1 along, y0..y1 up, at the skin's x plus `off`.
  const sidePatch = (nm, sx, z0, z1, y0, y1, color, o = {}, off = 0.06, nu = 4, nv = 2) => {
    const verts = [], loops = [];
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { const z = z0 + ((z1 - z0) * i) / nu, y = y0 + ((y1 - y0) * j) / nv; verts.push([sx * (flankX(s, z, y) + off), y, z]); }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i; loops.push({ v: [a, a + 1, a + nu + 2, a + nu + 1], want: [sx, 0, 0] }); }
    return mesh(nm, verts, loops, color, { ...o, smooth: true });
  };
  /// A lamp that belongs to the nose or tail: a dark bezel on the skin, the lens a hair above it inside, same outline, no box.
  const lamp = (nm, corners, dir, lensColor, emissive, bezelColor, grow = 0.3) => {
    const cx = corners.reduce((m, c) => m + c[0] / 4, 0), cy = corners.reduce((m, c) => m + c[1] / 4, 0);
    const scale = (k) => corners.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]);
    const big = corners.map(([x, y]) => { const d = Math.hypot(x - cx, y - cy) || 1; return [x + ((x - cx) / d) * grow, y + ((y - cy) / d) * grow]; });
    return [frontPatch(nm + " bezel", big, dir, bezelColor, { material: RUBBER }, 0.05), frontPatch(nm, scale(0.92), dir, lensColor, emissive ? { emissive } : { material: GLASS }, 0.11)];
  };
  const edgeZ = (x, dir) => { let z = dir > 0 ? s.zf : s.zr; for (let i = 0; i < 400; i++, z -= dir * 0.05) if (along(s.w, z) >= x) return z; return z; };
  const slab = (nm, corners, dir, depth, color, o, out = 0.15) => {
    const front = corners.map(([x, y]) => [x, y, edgeZ(Math.abs(x), dir) + dir * out]);
    return mesh(nm, [...front, ...front.map(([x, y, z]) => [x, y, z - dir * depth])], [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]], color, o);
  };
  const ctx = { frontPatch, sidePatch, lamp, edgeZ, slab, s, sideX: (z, y) => sideX(s, z, y), top: (z) => along(s.top, z), topAt, both, mesh, prism, box, cyl, strip, shade, along, STEEL, RUBBER, PAINT, GLASS };
  const tail = s.details(ctx, cubes);
  // shapes are written with the ground at y = 0: shift them to the body's pivot
  for (const c of cubes) { if (c.verts && c.name !== "body") for (const v of c.verts) v[1] = r2(v[1] - s.pivot); else if (c.from) c.from[1] = r2(c.from[1] - s.pivot); }
  const wr = (nm, sx, z) => wheelPart(nm, sx, z, s, s.R, s.tw);
  const parts = [{ name: "body", origin: [0, s.pivot, 0], rotation: [0, 0, 0], cubes, children: [] }, wr("wheel_fl", -1, s.wheelZ[0]), wr("wheel_fr", 1, s.wheelZ[0]), wr("wheel_rl", -1, s.wheelZ[1]), wr("wheel_rr", 1, s.wheelZ[1])];
  return { model: { version: 1, scale: 0.0625, parts }, tail };
}

// ================================ the coupe: 4560 x 1730 x 1295 mm, wheelbase 2525 =======================================================
const COUPE = {
  noLips: true, shut: [[14.0, 36.0], [-35.0, -27.6]], topCuts: [13.9, -27.9, 35.6],
  zr: -36.5, zf: 36.5, R: 5.05, tw: 3.0, track: 11.76, wheelZ: [20.6, -19.8], pivot: 5.05, wheel: 0.316, archK: 1.23, flare: 1.0, dent: 2.6,
  shoulder: 11.8, tuck: 0.7,
  w: [[-36.5, 6.0], [-36, 8.7], [-34, 12.2], [-32, 12.6], [-30, 13.1], [-28, 13.2], [-24, 13.5], [-20, 13.6], [-10, 13.7], [0, 13.74], [16, 13.7], [20, 13.66], [24, 13.6], [28, 13.3], [30, 13.1], [32, 12.7], [34, 10.6], [36, 4.3], [36.5, 2.5]],
  yb: [[-36.5, 4.6], [-34, 4.0], [-30, 3.4], [-26, 2.9], [-14, 2.55], [0, 2.5], [8, 2.4], [14, 2.25], [24, 2.5], [30, 2.9], [34, 3.2], [36.5, 3.6]],
  belt: [[-36.5, 11.0], [-30, 13.4], [-10, 13.9], [10, 14.0], [22, 12.9], [30, 10.8], [36.5, 8.0]],
  top: [[-36.5, 9.4], [-35.6, 10.2], [-34.6, 11.4], [-33.8, 14.2], [-32, 14.8], [-29.6, 14.9], [-27.1, 15.1], [-24.7, 16.0], [-22.2, 17.0], [-20.9, 17.5], [-18.5, 18.5], [-16, 19.3], [-13.3, 20.2], [-11, 20.6], [-5, 20.7], [0, 20.65], [0.9, 20.3], [2.9, 19.8], [4.9, 19.0], [8.8, 17.0], [10.8, 16.0], [12.8, 14.9], [14.8, 14.3], [16.7, 14.1], [20.7, 13.8], [24.6, 13.3], [28.6, 12.4], [30.6, 11.9], [32.5, 11.1], [34.5, 9.5], [36.5, 8.6]],
  roofW: [[-36.5, 4.5], [-36, 7.4], [-34, 10.6], [-30, 12.0], [-24.5, 11.4], [-18, 9.8], [-10, 8.9], [0, 8.8], [3, 9.2], [8, 10.6], [14, 12.0], [22, 12.4], [28, 12.0], [31, 11.0], [34, 8.4], [36, 3.6], [36.5, 2.2]],
  sideWin: [[-19.5, -10.5], [-8.8, 11.2]], seams: [11.8, -9.6], screen: [2.0, 13.4], rear: [-27.5, -14.0],
  paint: "#7a4fd6", roof: "#7a4fd6", rim: "#d5d9e0", dish: "#555b69", spokes: 5, spokeW: 0.1, bumper: "#2c2e37", bumperLen: 3.0, capColor: "#2c2e37",
  details({ s, sideX, top, topAt, edgeZ, slab, frontPatch, sidePatch, lamp, both, mesh, prism, box, cyl, strip, shade, along, STEEL, RUBBER, PAINT }, cubes) {
    const dk = "#17181d", lens = "#fff3cf", amber = "#ffb020", red = "#e8202c";
    // the lamps, grille and trim lie on the body's own skin (see frontPatch): a dark bezel with the lens in it, not a box stuck to the nose
    const pit = "#0c0d11";
    for (const sx of [1, -1]) {
      const q = (arr) => arr.map(([x, y]) => [sx * x, y]);
      cubes.push(...lamp(`headlight ${sx}`, q([[4.8, 7.6], [11.4, 8.9], [11.4, 10.3], [4.8, 8.8]]), 1, lens, 0.95, dk, 0.35));
      cubes.push(...lamp(`fog lamp ${sx}`, q([[7.6, 4.8], [10.4, 4.8], [10.4, 6.0], [7.6, 6.0]]), 1, "#ffe9a8", 0.6, dk, 0.4));
      cubes.push(frontPatch(`indicator ${sx}`, q([[11.7, 6.4], [12.6, 6.4], [12.6, 7.4], [11.7, 7.4]]), 1, amber, { emissive: 0.5 }, 0.1, 3, 2));
      cubes.push(...lamp(`brake light ${sx}`, q([[7.6, 9.0], [11.4, 8.9], [11.4, 11.4], [7.6, 11.5]]), -1, red, 0.85, dk, 0.35));
      cubes.push(...lamp(`tail lamp ${sx}`, q([[3.6, 9.2], [7.2, 9.1], [7.2, 11.3], [3.6, 11.4]]), -1, "#ff5a3a", 0.7, dk, 0.3));
      cubes.push(frontPatch(`rear marker ${sx}`, q([[11.9, 9.4], [12.6, 9.4], [12.6, 10.8], [11.9, 10.8]]), -1, "#ff2a2a", { emissive: 0.5 }, 0.1, 3, 2));
      cubes.push(sidePatch(`door handle ${sx}`, sx, -8.2, -5.2, 12.0, 12.7, shade(s.paint, 0.6), {}, 0.14));
      cubes.push(sidePatch(`repeater ${sx}`, sx, 29.0, 30.6, 8.4, 9.0, amber, { emissive: 0.45 }, 0.07));
    }
    cubes.push(frontPatch("intake", [[-6.4, 4.6], [6.4, 4.6], [6.4, 6.0], [-6.4, 6.0]], 1, pit, { material: RUBBER }, 0.07, 12, 3));
    for (const y of [5.0, 5.55]) cubes.push(frontPatch("intake bar", [[-6.0, y], [6.0, y], [6.0, y + 0.18], [-6.0, y + 0.18]], 1, "#8b909a", { material: STEEL }, 0.14, 12, 1));
    cubes.push(frontPatch("front plate", [[-3.6, 6.2], [3.6, 6.2], [3.6, 8.0], [-3.6, 8.0]], 1, "#f0f0ea", {}, 0.1, 6, 2));
    cubes.push(frontPatch("garnish", [[-2.8, 7.2], [2.8, 7.2], [2.8, 9.6], [-2.8, 9.6]], -1, "#101116", { material: RUBBER }, 0.07, 4, 3));
    cubes.push(frontPatch("rear plate", [[-3.8, 5.4], [3.8, 5.4], [3.8, 7.4], [-3.8, 7.4]], -1, "#f0f0ea", {}, 0.1, 6, 2));
    cubes.push(frontPatch("valance", [[-8.0, 3.0], [8.0, 3.0], [8.0, 5.2], [-8.0, 5.2]], -1, dk, { material: RUBBER }, 0.06, 12, 2));
    cubes.push(slab("front splitter", [[-9.5, 2.7], [9.5, 2.7], [9.5, 3.5], [-9.5, 3.5]], 1, 3.0, dk, { bevel: 0.25, segs: 1, material: RUBBER }, 0.4));
    for (const x of [5.6, 7.6]) { const ez = edgeZ(x, -1) - 0.1; cubes.push(cyl("exhaust tip", x, 3.7, ez, 0.95, 1.8, "z", "#aeb4be", { material: STEEL, segments: 14 }), cyl("exhaust hole", x, 3.7, ez - 0.95, 0.65, 0.2, "z", "#0b0c10", { segments: 12 })); }
    // the boot wing: a blade on two stands with end plates
    cubes.push(box("wing", -11.8, 11.8, 16.5, 17.4, -35.8, -31.6, s.paint, { bevel: 0.3, segs: 2, material: PAINT }));
    for (const x of [-1, 1]) {
      cubes.push(box("wing stand", x * 8 - 0.6, x * 8 + 0.6, along(s.top, -33) - 0.3, 16.7, -34.4, -32.6, dk, { bevel: 0.15, segs: 1 }));
      cubes.push(box("wing end plate", x * 11.8 - 0.25, x * 11.8 + 0.25, 15.9, 18.0, -36.0, -31.4, shade(s.paint, 0.8), { bevel: 0.12, segs: 1, material: PAINT }));
    }
    // mirrors, handles, fuel cap, repeaters, wipers, aerial
    for (const sx of [1, -1]) {
      const mz = 9.4, mx = sideX(mz, 15.0) + 0.9;
      cubes.push(box(`mirror ${sx}`, Math.min(sx * (mx - 0.5), sx * (mx + 2.1)), Math.max(sx * (mx - 0.5), sx * (mx + 2.1)), 15.2, 17.4, mz - 1.5, mz + 0.8, s.paint, { bevel: 0.5, segs: 2, material: PAINT }));
      cubes.push(box(`mirror glass ${sx}`, Math.min(sx * (mx + 2.0), sx * (mx + 2.2)), Math.max(sx * (mx + 2.0), sx * (mx + 2.2)), 15.5, 17.1, mz - 1.2, mz + 0.5, "#9fb3c8", { material: GLASS }));
    }
    cubes.push(sidePatch("fuel cap", 1, -25.4, -23.0, 10.8, 12.4, "#2a2c33", {}, 0.07));
    const wip = (nm, x0, z0, x1, z1) => cubes.push(strip(nm, [x0, topAt(z0, x0) + 0.15, z0], [x1, topAt(z1, x1) + 0.15, z1], 0.5, 0.3, dk, { material: RUBBER }));
    wip("wiper a", 1.0, 12.6, 8.8, 11.0); wip("wiper b", -9.4, 11.0, -1.2, 12.6);
    cubes.push(box("aerial", -9.9, -9.4, top(-20) - 0.2, top(-20) + 3.6, -21, -20.5, dk, {}));
    cubes.push(box("roof vent", -3.6, 3.6, top(-5) - 0.15, top(-5) + 0.35, -9, -4, shade(s.paint, 0.55), { bevel: 0.1, segs: 1 }));
    return { z: r2((s.zr + 1.2) / 16), y: r2(10.2 / 16 - 0.06), x: r2(8.2 / 16 / 0.92) };
  },
};

// ================================ the 4x4 wagon: 4060 x 1690 x 1885 mm, wheelbase 2310 ====================================================
const LC = {
  noLips: true, shut: [[9.4, 29.6]], topCuts: [9.3], shoulder: 16.4, lineA: [[-30, 11.9], [30, 11.9]],
  zr: -29.8, zf: 30.4, R: 6.7, tw: 3.85, track: 11.4, wheelZ: [20.1, -16.9], pivot: 6.7, wheel: 0.419, archK: 1.16, dent: 2.8, flare: 0.8, lip: 1.1,
  w: [[-29.8, 13.2], [-28.8, 14.0], [-26, 14.1], [26, 13.9], [29, 13.6], [30.4, 12.6]],
  yb: [[-29.8, 7.3], [-28, 7.0], [-24, 6.4], [-8, 6.0], [4, 6.0], [10, 6.5], [24, 6.9], [28, 7.2], [30.4, 7.4]],
  belt: [[-29.8, 17.0], [-28.5, 19.8], [-24, 20.0], [4, 20.0], [8.5, 19.6], [10.5, 18.6], [22, 18.4], [28, 18.2], [30.4, 16.8]],
  top: [[-29.8, 21.0], [-28.7, 29.6], [-26, 30.3], [0, 30.3], [2.0, 30.0], [9.0, 21.2], [14, 20.6], [22, 20.1], [28, 19.6], [30.4, 19.0]],
  roofW: [[-29.8, 10.6], [-28.7, 11.6], [-25, 11.8], [0, 11.8], [2, 11.6], [9, 11.4], [12, 11.0], [20, 11.0], [28, 11.0], [30.4, 9.6]],
  sideWin: [[-26.5, -11.8], [-8.0, 7.6]], seams: [8.4, -8.6], screen: [2.0, 9.0], rear: [-29.7, -28.9],
  glassLow: [[-30, 1.2], [-12, 1.2], [-8.5, 0.7], [8, 0.7], [9, 0.4], [31, 0.4]],
  roofZ: [-28.7, 2.0], paint: "#d6b27a", roof: "#f2efe6", lower: "#d6b27a", sill: "#5c4a2e", rim: "#aab0ba", dish: "#e8e8e0", rimK: 0.59, spokes: 0, hubK: 0.19, hubColor: "#aab0ba", lugs: 6, knobs: 22, lipColor: "#1b1c21",
  bumper: "#23252c", bumperLen: 1.6, capColor: "#23252c",
  details({ s, sideX, top, topAt, both, mesh, prism, box, cyl, strip, shade, along, STEEL, RUBBER, PAINT, GLASS }, cubes) {
    const dk = "#1d1e24", amber = "#ffb020", red = "#e8202c", steel = "#aeb3bc";
    // round headlamps in black bezels either side of a mesh grille; indicators below; steel bumpers; plate; tow hooks
    for (const sx of [1, -1]) {
      cubes.push(cyl(`headlamp bezel ${sx}`, sx * 9.0, 14.2, 29.6, 3.1, 1.6, "z", "#2a2c33", { segments: 24 }));
      cubes.push(cyl(`headlamp ring ${sx}`, sx * 9.0, 14.2, 30.3, 2.7, 0.5, "z", "#8e949e", { segments: 24, material: STEEL }));
      cubes.push(cyl(`headlamp ${sx}`, sx * 9.0, 14.2, 30.5, 2.3, 0.6, "z", "#fff3cf", { segments: 24, emissive: 0.95 }));
      cubes.push(box(`indicator ${sx}`, Math.min(sx * 11.4, sx * 12.9), Math.max(sx * 11.4, sx * 12.9), 10.2, 11.6, 29.6, 30.8, amber, { bevel: 0.2, segs: 1, emissive: 0.55 }));
      cubes.push(box(`front lamp ${sx}`, Math.min(sx * 6.4, sx * 8.6), Math.max(sx * 6.4, sx * 8.6), 10.4, 11.4, 31.0, 32.9, "#ffe9a8", { bevel: 0.15, segs: 1, emissive: 0.5 }));
      cubes.push(box(`tow hook ${sx}`, Math.min(sx * 9.6, sx * 10.8), Math.max(sx * 9.6, sx * 10.8), 6.2, 7.2, 31.8, 33.8, "#d3262c", { bevel: 0.2, segs: 1 }));
      cubes.push(box(`front guard ${sx}`, Math.min(sx * 12.0, sx * 13.8), Math.max(sx * 12.0, sx * 13.8), 6.8, 10.6, 28.4, 32.7, steel, { bevel: 0.6, segs: 2, material: STEEL }));
    }
    cubes.push(box("grille", -5.7, 5.7, 11.0, 17.6, 29.7, 30.9, "#14151a", { bevel: 0.2, segs: 1, material: RUBBER }));
    for (let k = 0; k < 5; k++) cubes.push(box("grille bar", -5.4, 5.4, 11.5 + k * 1.2, 11.8 + k * 1.2, 30.4, 31.2, "#aeb3bc", { material: STEEL }));
    for (let k = -3; k <= 3; k++) cubes.push(box("grille post", k * 1.5 - 0.15, k * 1.5 + 0.15, 11.2, 17.4, 30.4, 31.0, "#aeb3bc", { material: STEEL }));
    cubes.push(box("front bumper", -13.3, 13.3, 6.6, 10.4, 28.6, 32.5, steel, { bevel: 0.6, segs: 2, material: STEEL }));
    cubes.push(box("front plate", -3.0, 3.0, 7.2, 9.6, 32.5, 33.1, "#f0f0ea", { bevel: 0.12, segs: 1 }));
    cubes.push(box("bumper step pad", -9.0, 9.0, 10.4, 10.9, 28.8, 31.4, "#2a2c33", { bevel: 0.15, segs: 1, material: RUBBER }));
    cubes.push(box("hood vent", -4.5, 4.5, along(s.top, 24) - 0.1, along(s.top, 24) + 0.45, 22.5, 25.5, "#16171c", { bevel: 0.1, segs: 1, material: RUBBER }));
    // the rear: a stack of lamps in each corner, steel bumper, plate, the spare on the door, a rack, a jerry can
    for (const sx of [1, -1]) {
      const x0 = Math.min(sx * 11.2, sx * 13.2), x1 = Math.max(sx * 11.2, sx * 13.2);
      cubes.push(box(`tail housing ${sx}`, x0 - 0.2, x1 + 0.2, 9.4, 17.8, -30.7, -29.2, "#2a2c33", { bevel: 0.2, segs: 1, material: RUBBER }));
      cubes.push(box(`brake light ${sx}`, x0, x1, 13.2, 17.4, -31.0, -29.6, red, { bevel: 0.15, segs: 1, emissive: 0.85 }));
      cubes.push(box(`tail indicator ${sx}`, x0, x1, 10.6, 12.8, -31.0, -29.6, amber, { bevel: 0.15, segs: 1, emissive: 0.5 }));
      cubes.push(box(`reverse lamp ${sx}`, x0, x1, 9.7, 10.3, -31.0, -29.6, "#f4f6fa", { bevel: 0.1, segs: 1, emissive: 0.5 }));
    }
    cubes.push(box("rear bumper", -13.3, 13.3, 6.8, 10.2, -32.6, -28.8, steel, { bevel: 0.6, segs: 2, material: STEEL }));
    cubes.push(box("rear plate", -8.0, -2.4, 7.4, 9.4, -33.1, -32.6, "#f0f0ea", { bevel: 0.12, segs: 1 }));
    cubes.push(box("rear step", -13.0, 13.0, 10.2, 10.8, -32.2, -29.2, "#2a2c33", { bevel: 0.15, segs: 1, material: RUBBER }));
    cubes.push(...wheelCubes(s, s.R, s.tw, "z", [3.9, 17.0, s.zr - s.tw / 2 - 0.5]));
    for (const x of [-1, 1]) cubes.push(box("rear door hinge", x * 12.4 - 0.5, x * 12.4 + 0.5, 20.0, 27.0, -30.4, -29.4, dk, { bevel: 0.15, segs: 1 }));
    for (const x of [-1, 1]) cubes.push(box("rack rail", x * 11 - 0.4, x * 11 + 0.4, 31.2, 32.0, -26.5, -1.5, "#8e949e", { bevel: 0.2, segs: 1, material: STEEL }));
    for (const x of [-1, 1]) for (const z of [-25.5, -14, -2.5]) cubes.push(box("rack post", x * 11 - 0.4, x * 11 + 0.4, 29.8, 31.3, z - 0.4, z + 0.4, dk, {}));
    for (let k = 0; k < 6; k++) { const z = -25.5 + k * 4.6; cubes.push(box("rack bar", -11.4, 11.4, 31.3, 31.9, z - 0.35, z + 0.35, "#8e949e", { bevel: 0.15, segs: 1, material: STEEL })); }
    // snorkel, big flat mirrors on arms, side steps, handles, fuel flap, wipers, side lamps
    cubes.push(box("snorkel pipe", 12.9, 13.9, 17.6, 31.0, 9.0, 10.2, dk, { bevel: 0.3, segs: 2, material: RUBBER }), box("snorkel head", 12.7, 14.1, 29.8, 31.6, 6.8, 10.6, dk, { bevel: 0.4, segs: 2, material: RUBBER }));
    for (const sx of [1, -1]) {
      const lo = (a, b) => [Math.min(sx * a, sx * b), Math.max(sx * a, sx * b)];
      cubes.push(box(`mirror arm ${sx}`, ...lo(13.0, 15.2).map((v, i) => v + (i ? 0.3 : -0.3)), 22.4, 23.0, 6.4, 7.0, dk, { bevel: 0.12, segs: 1 }));
      cubes.push(box(`mirror ${sx}`, ...lo(14.8, 15.8), 21.4, 26.2, 5.4, 8.8, dk, { bevel: 0.3, segs: 2 }));
      cubes.push(box(`mirror glass ${sx}`, ...lo(15.8, 16.0), 21.8, 25.8, 5.7, 8.5, "#9fb3c8", { material: GLASS }));
      cubes.push(box(`side step ${sx}`, ...lo(13.0, 15.4), 5.6, 6.4, -7.0, 10.0, dk, { bevel: 0.25, segs: 1, material: RUBBER }));
      cubes.push(box(`door handle ${sx}`, ...lo(13.3, 14.4), 17.4, 18.2, -7.2, -4.2, dk, { bevel: 0.15, segs: 1 }));
      cubes.push(box(`fender lamp ${sx}`, ...lo(13.3, 13.9), 16.6, 17.8, 25.0, 27.0, amber, { bevel: 0.1, segs: 1, emissive: 0.4 }));
      cubes.push(box(`quarter vent ${sx}`, ...lo(13.0, 13.5), 21.6, 25.4, 5.4, 7.2, "#1c2e47", { material: GLASS }));
    }
    cubes.push(box("fuel flap", -14.0, -13.3, 15.0, 17.0, -24.0, -21.4, "#8a7048", { bevel: 0.2, segs: 1 }));
    const wip = (nm, x0, z0, x1, z1) => cubes.push(strip(nm, [x0, topAt(z0, x0) + 0.15, z0], [x1, topAt(z1, x1) + 0.15, z1], 0.5, 0.3, dk, { material: RUBBER }));
    wip("wiper a", 1.0, 8.4, 9.0, 6.6); wip("wiper b", -9.0, 6.6, -1.0, 8.4);
    return { z: r2((s.zr - 0.25) / 16), y: r2(14.0 / 16 - 0.06), x: r2(12.2 / 16 / 0.92) };
  },
};

// ================================ the modern coupe: 4768 x 1852 x 1383 mm, wheelbase 2851 (every curve traced from the blueprint) =============
// side view: top line, nose and tail by height, underside; plan view: width by z; front view: width by height (the widest point is low, at h 11 to
// 12, and the cabin tucks in from there to a roof only 9 half-wide: `shoulder` and `tuck`).
const GT = {
  noLips: true, shut: [[16.6, 36.4], [-35.6, -29.8]], topCuts: [16.7, -29.6, 36.5],
  zr: -38.15, zf: 38.15, R: 5.3, tw: 3.9, track: 12.7, wheelZ: [24.42, -21.21], pivot: 5.3, wheel: 0.331, archK: 1.11, lip: 0.8, shoulder: [[-34, 12.4], [-30, 12.3], [-18, 12.2], [-12, 12.0], [-6, 11.7], [0, 11.5], [6, 11.1], [12, 10.7], [18, 10.3], [22, 10.5], [26, 10.6], [32, 9.8], [38, 8.6]], tuck: 1.2,
  w: [[-38.15, 4.0], [-37.5, 8.4], [-35, 12.2], [-32.5, 13.4], [-30, 14.0], [-27.5, 14.3], [-25, 14.6], [-20, 14.73], [-12.5, 14.4], [-5, 14.66], [0, 14.73], [10, 14.6], [20, 14.54], [27.5, 14.5], [30, 14.36], [32.5, 13.75], [35, 10.97], [37.5, 5.98], [38.15, 3.2]],
  yb: [[-38.15, 4.4], [-36, 3.9], [-33, 4.0], [-30, 3.5], [-27, 3.1], [-16, 2.45], [-10, 2.36], [0, 2.2], [10, 2.06], [16, 1.96], [30, 2.6], [33, 2.65], [36, 2.85], [38.15, 3.3]],
  belt: [[-38.15, 7.6], [-36.7, 8.4], [-36.4, 14.0], [-34, 14.8], [-30, 15.7], [-24, 16.4], [-20, 16.6], [-8, 15.9], [4, 15.0], [10, 14.6], [14, 14.4], [20, 14.0], [28, 13.2], [34, 11.4], [38.15, 8.8]],
  top: [[-38.15, 9.4], [-37.4, 9.8], [-36.7, 10.3], [-36.4, 15.2], [-35.6, 16.0], [-34.8, 16.05], [-33.6, 16.2], [-32.4, 16.45], [-31.2, 16.7], [-29.9, 16.8], [-28.7, 17.2], [-27.5, 17.7], [-26.2, 18.1], [-25, 18.5], [-23.8, 18.9], [-22.6, 19.3], [-21.3, 19.7], [-20.1, 20.0], [-18.9, 20.4], [-17.6, 20.7], [-14, 21.35], [-12.7, 21.5], [-10.3, 21.8], [-7.8, 22.0], [-5.3, 22.1], [-2.9, 22.12], [-0.4, 22.0], [0.8, 21.9], [2.0, 21.7], [3.3, 21.4], [4.5, 20.95], [5.7, 20.35], [6.9, 19.8], [8.2, 19.2], [9.4, 18.5], [10.6, 17.85], [11.9, 17.1], [13.1, 16.4], [14.3, 15.7], [16.8, 15.4], [18, 15.3], [20.5, 15.1], [22.9, 14.95], [25.4, 14.7], [27.8, 14.3], [30.3, 13.8], [32.7, 13.1], [35.2, 12.0], [36.4, 11.4], [37.7, 10.6], [38.15, 9.8]],
  roofW: [[-38.15, 3.0], [-37.5, 5.5], [-36.7, 8.0], [-36.4, 10.6], [-33, 11.4], [-30, 11.8], [-24, 10.8], [-16, 9.6], [-8, 9.3], [-3, 9.3], [2, 9.6], [6, 10.2], [10, 11.2], [14, 12.2], [20, 12.8], [26, 12.4], [31, 10.6], [35, 7.4], [37.5, 4.2], [38.15, 2.4]],
  sideWin: [[-20.7, -9.0], [-8.2, 12.2]], seams: [13.7, -8.6], screen: [1.8, 16.2], rear: [-29.5, -19.5],
  glassTopOff: [[-21, 3.4], [-19.3, 2.4], [-14, 1.6], [-8.9, 1.3], [12, 1.3]],
  paint: "#14b8a6", roof: "#14b8a6", sill: "#0b6f66", rim: "#d5d9e0", dish: "#3a3e4a", rimK: 0.73, spokes: 6, spokeR0: 0.2, spokeR1: 0.71, spokeW: 0.09, spokeW1: 0.19, hubK: 0.12, lugs: 5, bumper: "#262830", bumperLen: 2.2, capColor: "#262830",
  details({ s, sideX, top, topAt, frontPatch, sidePatch, lamp, both, mesh, prism, box, cyl, strip, shade, along, STEEL, RUBBER, PAINT, GLASS }, cubes) {
    const dk = "#14151a", lens = "#f4f6ff", amber = "#ffb020", red = "#e8202c", bar = "#3b3f4a", pit = "#0c0d11";
    // where the plan outline is at half-width x: the z of the nose (dir 1) or the tail (dir -1) there, so that lamps can lie on the rounded corner
    const edgeZ = (x, dir) => { let z = dir > 0 ? s.zf : s.zr; for (let i = 0; i < 400; i++, z -= dir * 0.05) if (along(s.w, z) >= x) return z; return z; };
    // a slab on the corner: four (x, y) corners, each at the outline's z for its x; sunk `depth` back into the body
    const slab = (nm, corners, dir, depth, color, o, out = 0.15) => {
      const front = corners.map(([x, y]) => [x, y, edgeZ(Math.abs(x), dir) + dir * out]);
      return mesh(nm, [...front, ...front.map(([x, y, z]) => [x, y, z - dir * depth])], [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]], color, o);
    };
    const pit2 = "#0c0d11";
    for (const sx of [1, -1]) {
      const q = (arr) => arr.map(([x, y]) => [sx * x, y]);
      // the twin grille: two tall openings at the very front, a honeycomb of bars laid on the skin
      cubes.push(frontPatch(`grille ${sx}`, q([[0.6, 4.6], [6.0, 4.6], [6.0, 9.5], [0.6, 9.5]]), 1, pit2, { material: RUBBER }, 0.06, 10, 6));
      for (let k = 0; k < 6; k++) cubes.push(frontPatch(`grille bar ${sx}`, q([[0.8, 5.0 + k * 0.78], [5.8, 5.0 + k * 0.78], [5.8, 5.2 + k * 0.78], [0.8, 5.2 + k * 0.78]]), 1, bar, { material: STEEL }, 0.14, 10, 1));
      for (let k = 0; k < 4; k++) cubes.push(frontPatch(`grille rib ${sx}`, q([[1.2 + k * 1.3, 4.8], [1.4 + k * 1.3, 4.8], [1.4 + k * 1.3, 9.3], [1.2 + k * 1.3, 9.3]]), 1, bar, { material: STEEL }, 0.14, 1, 6));
      cubes.push(...lamp(`headlight ${sx}`, q([[7.0, 9.6], [12.9, 10.6], [12.9, 11.8], [7.0, 10.5]]), 1, lens, 0.95, dk, 0.3));
      cubes.push(frontPatch(`side vent ${sx}`, q([[11.4, 4.8], [13.2, 4.8], [13.2, 8.2], [11.4, 8.2]]), 1, pit2, { material: RUBBER }, 0.06, 4, 6));
      for (let k = 0; k < 3; k++) cubes.push(frontPatch(`side vent slat ${sx}`, q([[11.6, 5.5 + k * 0.9], [13.0, 5.5 + k * 0.9], [13.0, 5.7 + k * 0.9], [11.6, 5.7 + k * 0.9]]), 1, bar, { material: STEEL }, 0.12, 4, 1));
      cubes.push(frontPatch(`bumper slot ${sx}`, q([[6.4, 3.7], [10.4, 3.7], [10.4, 4.6], [6.4, 4.6]]), 1, pit2, { material: RUBBER }, 0.06, 6, 2));
      // the tail: a thin angular lamp bar and a vertical corner lamp, each in its own bezel, a reflector, a round tip
      cubes.push(...lamp(`tail lamp ${sx}`, q([[4.6, 12.4], [13.0, 13.2], [13.0, 14.7], [4.6, 13.7]]), -1, red, 0.85, dk, 0.22));
      cubes.push(...lamp(`tail lamp wing ${sx}`, q([[11.4, 11.6], [12.6, 11.9], [12.6, 14.3], [11.4, 14.3]]), -1, red, 0.6, dk, 0.2));
      cubes.push(frontPatch(`reflector ${sx}`, q([[10.6, 6.8], [11.6, 6.8], [11.6, 9.0], [10.6, 9.0]]), -1, "#a81e26", { emissive: 0.25 }, 0.08, 3, 3));
      { const ez = edgeZ(7.6, -1) - 0.2; cubes.push(cyl(`exhaust tip ${sx}`, sx * 6.6, 5.2, ez, 1.2, 1.6, "z", "#aeb4be", { material: STEEL, segments: 16 }), cyl(`exhaust hole ${sx}`, sx * 6.6, 5.2, ez - 0.85, 0.85, 0.2, "z", "#0b0c10", { segments: 14 })); }
    }
    cubes.push(frontPatch("lower intake", [[-7.6, 3.5], [7.6, 3.5], [7.6, 4.5], [-7.6, 4.5]], 1, pit2, { material: RUBBER }, 0.06, 12, 2));
    cubes.push(slab("front splitter", [[-9.0, 2.5], [9.0, 2.5], [9.0, 3.2], [-9.0, 3.2]], 1, 3.0, dk, { bevel: 0.25, segs: 1, material: RUBBER }, 0.5));
    cubes.push(frontPatch("rear plate", [[-2.4, 12.2], [2.4, 12.2], [2.4, 13.4], [-2.4, 13.4]], -1, "#f0f0ea", {}, 0.1, 6, 2));
    cubes.push(box("duck tail", -10.6, 10.6, 14.4, 15.4, -37.5, -34.2, shade(s.paint, 0.9), { bevel: 0.25, segs: 2, material: PAINT }));
    // mirrors on short stalks, flush handles, wipers, the aerial fin
    for (const sx of [1, -1]) {
      const lo = (a, b) => [Math.min(sx * a, sx * b), Math.max(sx * a, sx * b)];
      cubes.push(box(`mirror stalk ${sx}`, ...lo(13.4, 15.2), 16.0, 16.6, 10.6, 12.2, dk, { bevel: 0.1, segs: 1 }));
      cubes.push(box(`mirror ${sx}`, ...lo(15.0, 17.8), 15.4, 17.6, 9.8, 12.8, s.paint, { bevel: 0.5, segs: 2, material: PAINT }));
      cubes.push(sidePatch(`door handle ${sx}`, sx, -4.6, 0.0, 14.4, 14.9, shade(s.paint, 0.7), {}, 0.12));
      cubes.push(sidePatch(`gill ${sx}`, sx, 15.0, 17.2, 8.6, 11.2, dk, { material: RUBBER }, 0.07));
    }
    const wip = (nm, x0, z0, x1, z1) => cubes.push(strip(nm, [x0, topAt(z0, x0) + 0.15, z0], [x1, topAt(z1, x1) + 0.15, z1], 0.45, 0.3, dk, { material: RUBBER }));
    wip("wiper a", 0.8, 15.2, 9.0, 14.0); wip("wiper b", -9.0, 14.0, -1.0, 15.2);
    cubes.push(box("aerial fin", -1.0, 1.0, top(-15) - 0.1, top(-15) + 1.2, -16.5, -13.5, dk, { bevel: 0.3, segs: 1 }));
    return { z: r2(-36.6 / 16), y: r2(13.4 / 16 - 0.06), x: r2(9.0 / 16 / 0.92) };
  },
};

// (car_offroad and car_gt are now made by blueprint-cars.mjs with carkit.mjs; their first specs above are kept only for reference)
export const SPECS = { car_coupe: COUPE };
void [LC, GT];
const want = process.argv.slice(2);
if (process.argv[1] && process.argv[1].endsWith("blueprint-car.mjs")) await withServer(async (nova) => {
  for (const [name, spec] of Object.entries(SPECS)) {
    if (want.length && !want.includes(name)) continue;
    const { model, tail } = buildCar(spec);
    await nova.call("model_write", { name, model });
    console.log("wrote", name, `TAIL ${name} = { z = ${tail.z}, y = ${tail.y}, x = ${tail.x} }`, `wheel ${spec.wheel}`);
  }
});
