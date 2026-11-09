// A generator for classic road cars in the style of the reference models in examples/ (a boxy 1980s sedan as a painted GLB, and a Dodge
// Challenger and a Ford Mustang as Blender files): realistic proportions and trim, as in a 1960s to 1980s car, not a toy. Two families
// (`boxy` sedans, wagons and vans; `muscle` coupes), a shared detail library (`classicDetails`) and an open-wheel `formula` for the racers.
// New cars are new entries in CARS (a spec: sizes, the line of the roof, the paint, the extras). The road cars were first made
// 2026-11-09 in a smooth Switch-era style (think Horizon Chase 2, Breath of the Wild) (think Horizon Chase 2, Breath of the Wild): smooth, chunky
// bodies lofted from a ring of points at each station along the car, soft shading across shared points, clean glass with a sky
// gradient, a lighter top and a darker sill, dark wheel arches, spoked rims. Written through the Nova MCP server (models/<name>.model.json
// and .glb), so the studio's model editor opens them as it does any model.
//   node scripts/rally/cars.mjs [name ...]      (no names: all of them)
// Units are 1/16 of a metre; y is up and the nose points along +z. The body and the four wheels are separate parts, as the game moves
// them on their own (lib/../entities/car.lua): the body leans and bounces on its suspension, each wheel spins, steers and follows the road.
import { withServer } from "./mcp.mjs";

// ---- small helpers ----------------------------------------------------------------------------------------------------------------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const parse = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hex = (c) => "#" + c.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0")).join("");
const mul = (h, f) => hex(parse(h).map((v) => v * f));
const mix = (a, b, t) => { const x = parse(a), y = parse(b); return hex(x.map((v, i) => lerp(v, y[i], t))); };
const r2 = (v) => Math.round(v * 100) / 100;
/// A piecewise-linear value along z from [[z, value], ...] (sorted by z).
const along = (nodes, z) => {
  if (z <= nodes[0][0]) return nodes[0][1];
  for (let i = 1; i < nodes.length; i++) if (z <= nodes[i][0]) return lerp(nodes[i - 1][1], nodes[i][1], (z - nodes[i - 1][0]) / (nodes[i][0] - nodes[i - 1][0] || 1));
  return nodes[nodes.length - 1][1];
};

const GLASS = { 5: "#1b2a3b", 6: "#294460", 8: "#203550", 9: "#2d4b6b" }, FRAME = "#14161b";
const DARK = "#26272e";
const FR = 1.0; // the width of the black frame round a window, along z

// ---- the body: a loft ------------------------------------------------------------------------------------------------------------
// `s` is the car's spec (see CARS). Returns the body part's cubes (one mesh, plus the small things on it).
function body(s) {
  const { zr, zf } = s;
  const keys = new Set();
  for (let z = zr; z < zf; z += 2.1) keys.add(r2(z));
  keys.add(zf);
  for (const z of s.keys ?? []) keys.add(z);
  for (const z of s.seams ?? []) { keys.add(r2(z - 0.25)); keys.add(r2(z + 0.25)); }
  for (const [a, b] of [...(s.sideGlass ?? []), s.front, s.rear].filter(Boolean)) { keys.add(a); keys.add(b); keys.add(r2(a + FR)); keys.add(r2(b - FR)); }
  for (const z of s.wheelZ) for (const d of [-s.R * 1.2, 0, s.R * 1.2]) keys.add(r2(z + d));
  const zs = [...keys].filter((z) => z >= zr && z <= zf).sort((a, b) => a - b).filter((z, i, a) => i === 0 || z - a[i - 1] > 0.3);
  const n = zs.length;
  // the top line, smoothed a little along z so that the corners of the glasshouse are soft
  let top = zs.map((z) => along(s.top, z));
  for (let pass = 0; pass < (s.soft ?? 2); pass++) top = top.map((v, i) => (i === 0 || i === n - 1 ? v : (top[i - 1] + 2 * v + top[i + 1]) / 4));
  const T = s.endRound ?? 3.6; // how far from an end the rounding of the nose and tail reaches
  const half = zs.map((z, i) => {
    const dEnd = Math.min(z - zr, zf - z);
    const k = dEnd >= T ? 1 : Math.sqrt(1 - (1 - dEnd / T) ** 2);
    const flare = s.wheelZ.reduce((m, wz) => m + (s.flare ?? -0.7) * Math.exp(-(((z - wz) / (s.R * 1.15)) ** 2)), 0);
    const hw = ((s.hwProfile ? along(s.hwProfile, z) : s.hw) + (s.open ? 0 : flare)) * (0.9 + 0.1 * k);
    const yb0 = s.yb, ys = along(s.belt ?? [[zr, s.ys], [zf, s.ys]], z);
    let yt = Math.max(top[i], ys + 1.5);
    const ym = (yb0 + yt) / 2, hs = 0.8 + 0.2 * k;
    const yb = ym + (yb0 - ym) * hs;
    yt = ym + (yt - ym) * hs;
    const ysb = Math.min(ys, yt - 1.5);
    const f = clamp((yt - ysb) / (s.roof - ysb), 0, 1);
    const hwt = hw * (0.94 - (s.tumble ?? 0.18) * f);
    const hb = hw * 0.9;
    const sw = s.stripe ? s.stripe.half : 1.6;
    const p = [
      [0, yb], [hb * 0.6, yb], [hb, yb + 1.0], [hw * 0.99, yb + (ysb - yb) * 0.38], [hw, yb + (ysb - yb) * 0.8], [hw * 0.995, ysb],
      [lerp(hw, hwt, 0.45), ysb + (yt - ysb) * 0.45], [hwt, ysb + (yt - ysb) * 0.86], [hwt - Math.min(s.roofRound ?? 2.4, hwt * 0.22), yt - 0.55],
      [Math.min(sw, hwt * 0.4), yt - 0.05], [0, yt],
    ];
    return { z, p, k, hw, yb, ys: ysb, yt };
  });
  // vertices: one per (station, point, side, smoothing group). Panels shade smoothly inside themselves and meet at crisp creases: the
  // belt line, the roof edge, the underside, and across the ends of the screens (a vertex on a crease is made once for each side of it).
  const verts = [];
  const lift = s.pivot;
  const creaseZ = [...new Set([s.front, s.rear].filter(Boolean).flat())].sort((a, b) => a - b);
  const zoneOf = (i) => { const z = (zs[i] + zs[i + 1]) / 2; return creaseZ.filter((c) => c < z).length; };
  const groupOf = (j) => (j <= 1 ? 0 : j <= 4 ? 1 : j <= 7 ? 2 : 3);
  const made = new Map();
  const V = (i, m, side, g, zone) => {
    const key = `${i}|${m}|${m === 0 || m === 10 ? "c" : side}|${g}|${zone}`;
    let at2 = made.get(key);
    if (at2 === undefined) {
      const pt = half[i].p[m];
      at2 = verts.length;
      verts.push([(side === "L" ? -1 : 1) * pt[0], pt[1] - lift, half[i].z]);
      made.set(key, at2);
    }
    return at2;
  };
  const polys = [];
  const inRange = (z, r) => r && z >= r[0] - 1e-6 && z <= r[1] + 1e-6;
  const seg = (i, j) => {
    // the colour of the piece of the body between stations i and i+1 on segment j (j from 0 to 9)
    const z = (zs[i] + zs[i + 1]) / 2, a = half[i], b = half[i + 1];
    const yc = (a.p[j][1] + b.p[j][1] + a.p[j + 1][1] + b.p[j + 1][1]) / 4;
    const h = clamp((yc - s.yb) / (s.roof - s.yb), 0, 1);
    const dEnd = Math.min(z - zr, zf - z);
    let c = s.paint;
    const trim = s.trim;
    const bumper = dEnd < (s.bumper ?? 4.2);
    if (j === 0) c = "#1d1e24";
    else if (j === 1) c = trim;
    else if (j === 2) c = s.cladding || bumper ? trim : mul(s.paint, 0.86);
    else if (j === 3 || j === 4) c = (s.lower && inRange(z, s.lower.z) && j === 3 ? s.lower.color : s.paint);
    else if (j === 5 || j === 6) {
      const win = (s.sideGlass ?? []).some((r) => inRange(z, r)) && !(s.noGlassEnds && dEnd < 3);
      c = win ? null : s.paint;
    } else if (j === 7) c = s.paint;
    else if (j === 8 || j === 9) {
      if (inRange(z, s.front) || inRange(z, s.rear)) c = null;
      else if (j === 9 && s.stripe && s.stripe.z.some((r) => inRange(z, r))) c = s.stripe.color;
    }
    for (const sm of s.seams ?? []) if ((j === 3 || j === 4 || j === 5) && Math.abs(z - sm) < 0.3 && c !== null) c = mul(c, 0.7);
    for (const pt of s.patch ?? []) if (pt.segs.includes(j) && inRange(z, pt.z) && c !== null) c = pt.color;
    if (c === null) {
      // glass: flat dark tints (the lower and the upper row a shade apart); a black frame at the ends of each side window (the pillars)
      if ((j === 5 || j === 6) && (s.sideGlass ?? []).some((r) => inRange(z, r) && (z - r[0] < FR || r[1] - z < FR))) return FRAME;
      return GLASS[j];
    }
    // a gentle tone across the body: darker low down, lighter on top
    return mul(c, j === 0 ? 1 : 0.88 + 0.2 * h);
  };
  for (let i = 0; i < n - 1; i++) {
    const zone = zoneOf(i);
    for (let j = 0; j < 10; j++) {
      const color = seg(i, j), g = groupOf(j);
      polys.push({ v: [V(i, j, "R", g, zone), V(i, j + 1, "R", g, zone), V(i + 1, j + 1, "R", g, zone), V(i + 1, j, "R", g, zone)], color, smooth: true });
      polys.push({ v: [V(i, j, "L", g, zone), V(i + 1, j, "L", g, zone), V(i + 1, j + 1, "L", g, zone), V(i, j + 1, "L", g, zone)], color, smooth: true });
    }
  }
  // the two ends: one flat face each; the bumper strip below in the trim colour, the panel above it in the paint
  for (const i of [0, n - 1]) {
    const E = (m, side) => V(i, m, side, 9, 99 + i);
    const lower = [0, 1, 2, 3].map((m) => E(m, "R")).concat([3, 2, 1].map((m) => E(m, "L")));
    const upper = [3, 4, 5, 6, 7, 8, 9, 10].map((m) => E(m, "R")).concat([9, 8, 7, 6, 5, 4, 3].map((m) => E(m, "L")));
    polys.push({ v: lower, color: s.trim, smooth: false, end: i }, { v: upper, color: mul(s.paint, 0.95), smooth: false, end: i });
  }
  // make every polygon face outwards (the centre of the car at its height is the reference)
  const out = polys.map((q) => {
    const P = q.v.map((v) => verts[v]);
    const c = [0, 1, 2].map((a) => P.reduce((m, p) => m + p[a], 0) / P.length);
    const nrm = [0, 1, 2].map((a) => { const b = (a + 1) % 3, d = (a + 2) % 3; let sum = 0; for (let t = 0; t < P.length; t++) { const p = P[t], r = P[(t + 1) % P.length]; sum += (p[b] - r[b]) * (p[d] + r[d]); } return sum; });
    const ref = q.end !== undefined ? [0, 0, c[2] > (zr + zf) / 2 ? 1 : -1] : [c[0], c[1] - (s.ys + s.yb) / 2 + s.pivot, 0];
    const dot = nrm[0] * ref[0] + nrm[1] * ref[1] + nrm[2] * ref[2];
    const fixed = dot < 0 ? { ...q, v: [...q.v].reverse() } : { ...q };
    delete fixed.end;
    return fixed;
  });
  const cubes = [{ name: "body", shape: "mesh", color: s.paint, verts: verts.map((v) => v.map(r2)), polys: out }];

  // ---- the small things ------------------------------------------------------------------------------------------------------------
  const Y = (y) => y - lift;
  const at = (z) => half.reduce((best, h) => (Math.abs(h.z - z) < Math.abs(best.z - z) ? h : best));
  // the body's side at a height y and a place z along it: between the two stations round it, along the ring's right side
  const surf = (z, y) => {
    let i = 0;
    while (i < n - 2 && half[i + 1].z < z) i++;
    const a = half[i], b = half[i + 1], t = clamp((z - a.z) / (b.z - a.z || 1), 0, 1);
    const P = a.p.map((pt, q) => [lerp(pt[0], b.p[q][0], t), lerp(pt[1], b.p[q][1], t)]);
    for (let q = 1; q < 9; q++) if (y <= P[q + 1][1] || q === 8) return lerp(P[q][0], P[q + 1][0], clamp((y - P[q][1]) / (P[q + 1][1] - P[q][1] || 1), 0, 1));
    return P[8][0];
  };
  // wheel arches: a dark wheel-well disc on the side of the body at each wheel, ringed by a raised fender lip (a half-tube in the paint);
  // the tyre stands a little proud of the disc, so the wheel looks to sit in an arch
  const orient = (verts2, polys2, centreOf) => polys2.map((pl) => {
    const P = pl.v.map((v) => verts2[v]);
    const c = [0, 1, 2].map((a) => P.reduce((m, p) => m + p[a], 0) / P.length);
    const nrm = [0, 1, 2].map((a) => { const b = (a + 1) % 3, d = (a + 2) % 3; let sum = 0; for (let t = 0; t < P.length; t++) { const p = P[t], r = P[(t + 1) % P.length]; sum += (p[b] - r[b]) * (p[d] + r[d]); } return sum; });
    const ref = centreOf(c, pl);
    return nrm[0] * ref[0] + nrm[1] * ref[1] + nrm[2] * ref[2] < 0 ? { ...pl, v: [...pl.v].reverse() } : pl;
  });
  const ra = s.R * 1.13;
  for (const side of [-1, 1]) for (const wz of s.open ? [] : s.wheelZ) {
    // the plane the arch lies in: just outside the body's side over the whole arch
    let xa = 0;
    for (let z = wz - ra; z <= wz + ra; z += 1.5) for (let y = s.R - ra * 0.4; y <= s.R + ra; y += 1.5) xa = Math.max(xa, surf(clamp(z, zr + 0.5, zf - 0.5), y));
    xa += 0.22;
    const tag = `${side > 0 ? "left" : "right"} ${wz > 0 ? "front" : "rear"}`;
    // the well: a disc (its low edge kept above the underside)
    const dv = [], N = 28;
    for (let q = 0; q < N; q++) {
      const a = (q / N) * Math.PI * 2;
      dv.push([side * xa, Y(Math.max(s.R + Math.sin(a) * ra * 0.97, s.yb + 0.9)), wz + Math.cos(a) * ra * 0.97]);
    }
    const disc = orient(dv, [{ v: Array.from({ length: N }, (_, q) => q), color: "#16171c" }], () => [side, 0, 0]);
    cubes.push({ name: `wheel well ${tag}`, shape: "mesh", color: "#16171c", verts: dv.map((p) => p.map(r2)), polys: disc });
    // the lip: a tube round the top of the arch, in the paint
    const tv = [], tp = [], SEGS = 18, SIDES = 8, tr = 0.6, A0 = -0.22, A1 = Math.PI + 0.22;
    const centres = [];
    for (let q = 0; q <= SEGS; q++) {
      const a = lerp(A0, A1, q / SEGS), u = [Math.cos(a), Math.sin(a)];
      const cz = wz + u[0] * ra, cy = s.R + u[1] * ra;
      centres.push([side * xa, Y(cy), cz]);
      for (let k = 0; k < SIDES; k++) {
        const f = (k / SIDES) * Math.PI * 2;
        tv.push([side * (xa - 0.1) + side * Math.sin(f) * tr * 0.9, Y(cy + u[1] * Math.cos(f) * tr), cz + u[0] * Math.cos(f) * tr]);
      }
    }
    const lipColor = mul(s.paint, 0.9);
    for (let q = 0; q < SEGS; q++) for (let k = 0; k < SIDES; k++) {
      const a = q * SIDES + k, b = q * SIDES + ((k + 1) % SIDES), c = (q + 1) * SIDES + ((k + 1) % SIDES), d = (q + 1) * SIDES + k;
      tp.push({ v: [a, b, c, d], color: lipColor, smooth: true, q });
    }
    const lip = orient(tv, tp, (c, pl) => [c[0] - centres[pl.q][0], c[1] - centres[pl.q][1], c[2] - centres[pl.q][2]]).map((pl) => { const o = { ...pl }; delete o.q; return o; });
    cubes.push({ name: `wheel arch ${tag}`, shape: "mesh", color: lipColor, verts: tv.map((p) => p.map(r2)), polys: lip });
  }
  return { cubes, half, at, Y, zs, surf };
}

// ---- wheels ----------------------------------------------------------------------------------------------------------------------
// The wheel part sits at the axle, so it spins and steers about its own middle. `x` is which side (-1 or 1).
function wheel(name, x, z, s) {
  const R = s.R, tw = s.tw;
  // a cylinder is made standing up, from the box `from`/`size`; turned 90 degrees about z it lies along x (about the box's middle, which is on the axle)
  const t = (name2, r, w, color, seg) => ({ name: name2, shape: "cylinder", from: [-r, -w / 2, -r], size: [2 * r, w, 2 * r], rotation: [0, 0, 90], color, segments: seg, smooth: true });
  const cubes = [
    t("tyre", R, tw, "#2b2c33", 24),
    t("sidewall", R * 0.86, tw + 0.5, "#3a3b44", 24),
  ];
  if (s.wheelStyle === "steel") {
    // a steel wheel with a chrome ring, a dark dish and a chrome dog-dish cap (the classics' hubcaps)
    cubes.push(t("rim", R * 0.74, tw + 0.8, "#cfd3da", 24), t("rim dish", R * 0.6, tw + 1.1, s.dish ?? "#2a2c33", 24), t("hub cap", R * 0.34, tw + 1.6, "#e2e5ea", 18), t("hub cap top", R * 0.14, tw + 2.0, "#9aa0aa", 12));
    return { name, origin: [x * s.track, R, z], rotation: [0, 0, 0], cubes, children: [] };
  }
  cubes.push(t("rim", R * 0.62, tw + 0.9, s.rim, 20), t("rim dish", R * 0.5, tw + 1.1, mul(s.rim, 0.4), 20));
  // five spokes: one star-shaped mesh, a face each side and a wall between
  const W = (tw + 1.5) / 2, tip = R * 0.52, valley = R * 0.2, N = 10;
  const verts = [], polys = [];
  for (const sx of [1, -1]) for (let q = 0; q < N; q++) {
    const a = (q / N) * Math.PI * 2, r = q % 2 === 0 ? tip : valley;
    verts.push([sx * W, Math.cos(a) * r, Math.sin(a) * r]);
  }
  const front = Array.from({ length: N }, (_, q) => q), back = Array.from({ length: N }, (_, q) => N + q);
  polys.push({ v: front, color: s.rim }, { v: [...back].reverse(), color: s.rim });
  for (let q = 0; q < N; q++) polys.push({ v: [q, N + q, N + ((q + 1) % N), (q + 1) % N], color: mul(s.rim, 0.9) });
  const fixed = polys.map((pl) => {
    const P = pl.v.map((v) => verts[v]);
    const c = [0, 1, 2].map((a) => P.reduce((m, p) => m + p[a], 0) / P.length);
    const nrm = [0, 1, 2].map((a) => { const b = (a + 1) % 3, d = (a + 2) % 3; let sum = 0; for (let t2 = 0; t2 < P.length; t2++) { const p = P[t2], r = P[(t2 + 1) % P.length]; sum += (p[b] - r[b]) * (p[d] + r[d]); } return sum; });
    return nrm[0] * c[0] + nrm[1] * c[1] + nrm[2] * c[2] < 0 ? { ...pl, v: [...pl.v].reverse() } : pl;
  });
  cubes.push({ name: "spokes", shape: "mesh", color: s.rim, verts: verts.map((v) => v.map(r2)), polys: fixed });
  cubes.push(t("hub", 1.3, tw + 1.9, mul(s.rim, 1.06), 12));
  return { name, origin: [x * s.track, R, z], rotation: [0, 0, 0], cubes, children: [] };
}

// ---- cars ------------------------------------------------------------------------------------------------------------------------
// Each is a spec: zr/zf the tail and the nose, hw half the width at the belt, yb the underside, ys the belt line (the bottom of the windows),
// roof the highest point, `top` the line of the top along z (nose, bonnet, windscreen, roof, rear window, boot, tail), `front` / `rear` the
// z ranges of the windscreen and the rear window, `sideGlass` the ranges of the side windows, `wheelZ` the axles, `R` and `tw` the tyre,
// `track` the wheel's distance from the middle, `pivot` the height the body leans about, and the colours.
// Sizes follow real cars, in 1/16 m: a Corolla sedan is 4630 x 1780 x 1435 mm on a 2700 mm wheelbase, a RAV4 4600 x 1855 x 1685, a Hilux
// 5300 x 1850 x 1800. The glasshouse (from the belt line to the roof) is about a third of a car's height, so the windows are small and the
// pillars wide. (2026-11-09; the first versions had the glass nearly half the height.)
const sedan = (o) => ({
  zr: -37, zf: 37, hw: 14.2, yb: 3.8, ys: 15.2, roof: 23.0, pivot: 5.6, R: 5.6, tw: 6.6, track: 11.6, wheelZ: [21.6, -21.6], tumble: 0.2,
  top: [[-37, 14.4], [-33, 15.6], [-27, 15.9], [-17.5, 22.4], [-4, 23.0], [2, 22.8], [13.5, 15.5], [24, 14.5], [37, 13.0]],
  front: [2, 13.5], rear: [-27, -17.5], sideGlass: [[1.2, 11.2], [-23.5, -0.8]], seams: [11.8, 0.2, -24.2], rim: "#d7dde6", trim: "#4b4f5e", ...o,
});
const hatch = (o) => ({
  zr: -32, zf: 32, hw: 13.9, yb: 3.8, ys: 15.0, roof: 23.4, pivot: 5.5, R: 5.5, tw: 6.4, track: 11.2, wheelZ: [20.4, -20.4], tumble: 0.2,
  top: [[-32, 14.6], [-30.6, 18.0], [-28, 22.0], [-21, 23.2], [-5, 23.4], [2, 23.2], [11.5, 15.6], [22, 14.4], [32, 12.8]],
  front: [2, 11.5], rear: [-28, -21], sideGlass: [[1.2, 9.8], [-25, -0.8]], seams: [10.6, 0.2], rim: "#dfe4ea", trim: "#4b4f5e", ...o,
});
const suv = (o) => ({
  zr: -37, zf: 37, hw: 14.8, yb: 5.4, ys: 17.2, roof: 27.2, pivot: 6.8, R: 6.8, tw: 7.6, track: 11.8, wheelZ: [21.5, -21.5], flare: -0.4, tumble: 0.14,
  top: [[-37, 18.0], [-35.8, 25], [-31, 27.0], [-8, 27.4], [0, 27.2], [13, 19.0], [24, 17.8], [37, 15.6]],
  front: [0, 13], rear: [-36, -31], sideGlass: [[1.4, 11.6], [-12.6, 0.2], [-31.5, -13.8]], seams: [12.2, 0.8, -13.2], cladding: true, rim: "#c9ced6", trim: "#3a3d48",
  extras: [({ box, s: sp }) => { for (const x of [-1, 1]) box("roof rail", x * 9.4, sp.roof + 0.6, -14, [1.2, 1.0, 26], "#2c2e36"); }], ...o,
});
const wagon = (o) => ({
  ...suv({}), zr: -38.5, zf: 38.5, hw: 14.8, yb: 4.2, ys: 15.6, roof: 24.0, R: 6.5, tw: 7.2, wheelZ: [22.5, -22.5], tumble: 0.18,
  top: [[-38.5, 15.2], [-37, 21.5], [-33, 23.8], [-10, 24.2], [2, 23.8], [13, 16.2], [25, 15.0], [38.5, 13.4]],
  front: [2, 13], rear: [-37, -33], sideGlass: [[2.0, 12], [-12.6, 0.8], [-32, -13.8]], seams: [12.3, 1.2, -13.2], cladding: false, ...o,
});
const van = (o) => ({
  zr: -40, zf: 40, hw: 15.6, yb: 4.8, ys: 18.6, roof: 31, pivot: 6.4, R: 6.4, tw: 7.2, track: 12, wheelZ: [24.5, -24.5], tumble: 0.1,
  top: [[-40, 27], [-38, 30.4], [-33, 31], [8, 31], [11, 30], [20, 20.5], [28, 17.6], [40, 15.2]],
  front: [11, 20], sideGlass: [[9.5, 19.4]], seams: [8, -14], cladding: true, rim: "#d7dde6", trim: "#3e414d", ...o,
});
const pickup = (o) => ({
  zr: -42, zf: 43, hw: 14.8, yb: 5.2, ys: 17.4, roof: 28.4, pivot: 6.6, R: 6.6, tw: 7.4, track: 11.8, wheelZ: [24.7, -24.7], tumble: 0.16,
  top: [[-42, 16.0], [-35, 16.4], [-9, 16.6], [-5.5, 25.6], [-3, 28.0], [7, 28.4], [11, 27.4], [19, 18.4], [30, 16.8], [43, 15.0]],
  front: [11, 19], rear: [-6, -3.2], sideGlass: [[-1.6, 16.4]], seams: [18.4, 0.2], cladding: true, rim: "#d0d5dc", trim: "#3a3d48",
  patch: [{ z: [-42, -9], segs: [8, 9], color: "#34363f" }],
  extras: [({ box, s: sp }) => {
    for (const x of [-1, 1]) box("bed side", x * (sp.hw - 0.9), 19.8, -25.6, [1.8, 6.8, 32], sp.paint);
    box("tailgate", 0, 19.6, -41.2, [sp.hw * 2 - 2, 7.0, 1.8], sp.paint);
    box("bed front", 0, 19.4, -9.8, [sp.hw * 2 - 2, 6.0, 1.4], sp.paint);
  }], ...o,
});
const sporty = (o) => ({
  zr: -33, zf: 39.5, hw: 14.8, yb: 3.2, ys: 13.0, roof: 21.0, pivot: 5.0, R: 5.6, tw: 7.4, track: 11.8, wheelZ: [21.5, -21.5], tumble: 0.22, soft: 3,
  top: [[-33, 12.0], [-29, 13.6], [-21, 14.0], [-11, 19.8], [-2, 21.0], [4, 20.6], [15, 13.4], [27, 12.4], [39.5, 10.6]],
  front: [4, 15], rear: [-21, -11], sideGlass: [[3.2, 13], [-15.5, -0.6]], seams: [14, 0.8], rim: "#e6eaf0", trim: "#41444f", bumper: 4.6, ...o,
});
// open-wheel racers: a narrow tub with the wheels out beside it, sidepods, an airbox, a helmet, front and rear wings
const formula = (o) => ({
  open: true, zr: -34, zf: 41, hw: 8, hwProfile: [[-34, 5.2], [-26, 7.4], [-6, 8.6], [8, 8.2], [18, 6.6], [30, 4.0], [41, 2.8]],
  yb: 3.0, ys: 6.4, belt: [[-34, 5.0], [-8, 6.4], [16, 4.8], [41, 3.8]], roof: 11, pivot: 5, R: 6.0, Rr: 6.5, tw: 8.0, twr: 9.0, track: 13.4,
  wheelZ: [24, -23], tumble: 0.35, soft: 3,
  top: [[-34, 6.6], [-26, 8.2], [-16, 10.2], [-8, 10.8], [-5, 8.0], [8, 7.6], [16, 7.0], [28, 5.6], [41, 4.8]],
  rim: "#cfd4dc", trim: "#2b2d35", bumper: 0.1,
  patch: [{ z: [-4.5, 8], segs: [7, 8, 9], color: "#101218" }],
  extras: [({ box, lamp, b, s: sp }) => {
    const acc = sp.accent, Yc = (y) => y;
    // sidepods: two flattened ellipsoids beside the tub
    for (const x of [-1, 1]) {
      lamp(`sidepod ${x > 0 ? "left" : "right"}`, x * 11.6, 6.2, -6, [7.2, 6.4, 26], sp.paint, 0);
      lamp(`intake ${x > 0 ? "left" : "right"}`, x * 11.6, 6.6, 6.4, [4.6, 4.2, 3.2], "#15171c", 0);
    }
    // the airbox over the driver's shoulders and the helmet in the cockpit
    lamp("airbox", 0, 10.6, -9, [5.4, 6.4, 12], sp.paint, 0);
    lamp("helmet", 0, 8.6, 1.6, [5.0, 5.0, 5.6], sp.accent, 0);
    lamp("visor", 0, 8.9, 4.0, [3.6, 1.8, 1.6], "#0d0e12", 0);
    // the front wing: a main plane, a flap and two end plates
    box("front wing", 0, 3.0, 38.4, [30, 0.9, 6.4], sp.trim);
    box("front wing flap", 0, 4.0, 37.6, [28, 0.7, 3.2], sp.paint);
    for (const x of [-1, 1]) box("front end plate", x * 15, 4.0, 38.4, [0.9, 3.6, 6.8], sp.accent);
    box("nose pylon", 0, 3.6, 35.6, [2.0, 2.2, 5.0], sp.trim);
    // the rear wing: two planes on a pillar, end plates
    box("rear wing", 0, 13.4, -33.2, [25, 1.0, 6.0], sp.trim);
    box("rear wing flap", 0, 15.2, -32.6, [25, 0.8, 3.2], sp.paint);
    for (const x of [-1, 1]) box("rear end plate", x * 12.6, 14.0, -33, [0.9, 7.6, 8.0], sp.accent);
    box("rear wing pillar", 0, 10.0, -31.6, [2.2, 6.0, 2.2], sp.trim);
    box("diffuser", 0, 4.0, -35.0, [20, 2.4, 5], sp.trim);
    // arms from the tub to each wheel
    for (const x of [-1, 1]) for (const [wz, rz] of [[24, 1], [-23, 1]]) for (const dz of [-2.6, 2.6]) {
      const half = (sp.track - 8.4) / 2, mid = 8.2 + half;
      box("arm", x * mid, 5.6 + (dz > 0 ? 1.0 : -0.6), wz + dz, [half * 2, 0.8, 0.9], "#3a3d48");
    }
    // a red lamp at the back
    box("rain light", 0, 6.4, -34.6, [3.2, 2.0, 0.9], "#ff2a36", { emissive: 0.9 });
  }], ...o,
});

const wing = ({ box, s: sp }) => {
  for (const x of [-1, 1]) box("wing strut", x * 7, sp.ys + 1.6, sp.zr + 3.2, [1.4, 4.4, 1.6], "#2c2e36");
  box("wing", 0, sp.ys + 4.1, sp.zr + 2.8, [sp.hw * 1.7, 1.2, 6.4], "#2c2e36");
};

// The two classic families (from the reference models in examples/: a boxy 1980s sedan, a Challenger, a Mustang). A boxy 3-box sedan,
// 4.7 m on a 2.85 m wheelbase, flat roof, upright screens, chrome and rubber; and a muscle coupe, 4.9 m, a long flat bonnet, a raked screen,
// a high short tail, fat rear tyres.
const classic = { classic: true, wheelStyle: "steel", endRound: 1.8, roofRound: 1.1, soft: 1, bumper: 3.4, trim: "#2b2d35" };
const boxy = (o) => ({
  ...classic, zr: -37.6, zf: 37.6, hw: 14.6, yb: 3.8, ys: 15.4, roof: 22.2, pivot: 5.8, R: 5.8, tw: 6.6, track: 11.8, wheelZ: [22.4, -23.2], tumble: 0.1,
  top: [[-37.6, 14.8], [-26.5, 15.3], [-20, 22.0], [-17, 22.2], [6, 22.2], [13.5, 14.8], [24, 14.4], [37.6, 13.6]],
  front: [6, 13.5], rear: [-26.5, -20], sideGlass: [[1.4, 11.6], [-24.2, -1.0]], seams: [12.4, 0.2, -25.4], rim: "#d7dde6", ...o,
});
const muscle = (o) => ({
  ...classic, zr: -39.4, zf: 39.4, hw: 15.5, yb: 3.4, ys: 14.4, roof: 20.8, pivot: 5.4, R: 5.8, tw: 7.4, twr: 8.8, track: 12.2, wheelZ: [22.8, -21.8], tumble: 0.2, exhaust: true,
  top: [[-39.4, 15.2], [-37, 15.8], [-28, 16.0], [-17, 20.2], [-12, 20.8], [-1, 20.8], [1, 20.4], [12, 14.6], [24, 14.4], [39.4, 13.6]],
  front: [-1, 12], rear: [-28, -12], sideGlass: [[-1.5, 10.6], [-24, -3.4]], seams: [11.4, -2.6], handles: [-0.8], rim: "#d7dde6",
  extras: [({ box, lamp, s: sp }) => {
    // a bonnet scoop and a duck-tail spoiler
    lamp("bonnet scoop", 0, sp.ys + 0.6, 20, [sp.hw * 0.7, 3.4, 14], sp.paint, 0);
    box("scoop intake", 0, sp.ys + 1.2, 26.6, [sp.hw * 0.5, 1.4, 0.8], "#0e0f12");
    box("duck tail", 0, 16.6, -36.6, [sp.hw * 1.6, 1.2, 5.0], sp.paint);
  }], ...o,
});

const CARS = {
  car_sedan: boxy({ paint: "#d9482e" }),
  car_taxi: boxy({
    paint: "#f1b21a", patch: [{ z: [-30, 30], segs: [4], color: "#202026" }],
    extras: [({ box, s: sp }) => box("taxi sign", 0, sp.roof + 1.6, -6, [8, 2.8, 3.6], "#fff6d0", { emissive: 0.6 })],
  }),
  car_police: boxy({
    paint: "#f3f5f8", patch: [{ z: [-30, 14], segs: [2, 3], color: "#1f2f66" }],
    extras: [({ box, s: sp }) => { box("siren red", -3.2, sp.roof + 1.4, -6, [5, 2.2, 3.4], "#ff3340", { emissive: 0.9 }); box("siren blue", 3.2, sp.roof + 1.4, -6, [5, 2.2, 3.4], "#3d7bff", { emissive: 0.9 }); }],
  }),
  car_green: hatch({ ...classic, paint: "#33b46c", rim: "#d7dde6", wheelStyle: "steel", endRound: 2.0, trim: "#2b2d35" }),
  car_blue: muscle({ paint: "#2563c9", patch: [{ z: [-39.4, 39.4], segs: [3], color: "#f4f6fa" }], stripe: { half: 2.6, color: "#f4f6fa", z: [[-39.4, 39.4]] } }),
  car_suv: suv({ ...classic, paint: "#5b8f5a", trim: "#2b2d35" }),
  car_suvl: wagon({ ...classic, paint: "#2e4396", trim: "#2b2d35" }),
  car_van: van({ ...classic, paint: "#f1efe7", patch: [{ z: [-40, 40], segs: [3], color: "#2b5aa8" }], trim: "#2b2d35" }),
  car_pickup: pickup({ ...classic, paint: "#e0842a", trim: "#2b2d35" }),
  car_yellow: muscle({ paint: "#ffc61a", stripe: { half: 2.4, color: "#1c1d22", z: [[-39.4, 39.4]] } }),
  car: muscle({ paint: "#d91f35", stripe: { half: 2.4, color: "#f4f6fa", z: [[-39.4, 39.4]] } }),
  racecar_green: formula({ paint: "#17a05a", accent: "#f5f7fa", stripe: { half: 2.0, color: "#f5f7fa", z: [[-34, 41]] } }),
  racecar_orange: formula({ paint: "#ff7a1a", accent: "#1b1d24", stripe: { half: 2.0, color: "#1b1d24", z: [[-34, 41]] } }),
  racecar_red: formula({ paint: "#e1262e", accent: "#f5f7fa", stripe: { half: 2.0, color: "#f5f7fa", z: [[-34, 41]] } }),
  racecar_white: formula({ paint: "#f3f5f8", accent: "#2a64d6", stripe: { half: 2.0, color: "#2a64d6", z: [[-34, 41]] } }),
};

// ---- the classics' details --------------------------------------------------------------------------------------------------------
// What the reference cars (a boxy 1980s sedan, a Challenger, a Mustang) have that a plain body does not: chrome bumpers with a black rubber
// strip and overriders, a framed grille with bars, quad headlights with chrome bezels and amber indicators, a chrome side moulding between
// the wheel arches, door handles, exhaust tips, and steel wheels with dog-dish caps (see `wheel`).
function classicDetails({ box, lamp, b, s, front, rear }) {
  const CH = "#d4d8df", CH2 = "#aeb4be", RUB = "#17181d";
  for (const [z, e, dir, nm] of [[s.zf, front, 1, "front"], [s.zr, rear, -1, "rear"]]) {
    const w = e.hw * 2 * 0.99;
    box(`${nm} bumper`, 0, e.yb + 2.8, z + dir * 0.7, [w, 2.0, 1.8], CH);
    box(`${nm} bumper rubber`, 0, e.yb + 1.3, z + dir * 0.6, [w * 0.96, 1.0, 1.6], RUB);
    for (const x of [-1, 1]) box(`${nm} overrider`, x * w * 0.36, e.yb + 2.8, z + dir * 1.5, [1.5, 2.4, 0.9], CH2);
  }
  // the grille and the headlights
  const gw = Math.min(front.hw * 1.1, 17), gy = front.yb + (front.yt - front.yb) * 0.46, fz = s.zf;
  box("grille frame", 0, gy, fz + 0.2, [gw, 3.6, 0.8], CH);
  box("grille", 0, gy, fz + 0.4, [gw - 1.0, 2.7, 0.8], "#0e0f12");
  for (let k = -3; k <= 3; k++) box("grille bar", (k * (gw - 1.8)) / 7, gy, fz + 0.9, [0.32, 2.6, 0.4], CH);
  for (const side of [-1, 1]) {
    const x = side * (gw / 2 + 3.2);
    box("headlight bezel", x, gy, fz + 0.15, [4.8, 3.4, 0.8], CH);
    box("headlight", x, gy, fz + 0.55, [3.9, 2.6, 0.8], "#fff1c4", { emissive: 0.95 });
    box("indicator", x, gy - 3.0, fz + 0.15, [3.2, 1.1, 0.7], "#ffb21e", { emissive: 0.45 });
  }
  // the side moulding between the arches (chrome over a black rubber strip), and the door handles
  const z0 = s.wheelZ[1] + s.R * 1.35, z1 = s.wheelZ[0] - s.R * 1.35, ym = s.yb + (s.ys - s.yb) * 0.42;
  let xs = 0;
  for (let z = z0; z <= z1; z += 2) xs = Math.max(xs, b.surf(z, ym));
  for (const side of [-1, 1]) {
    box("side moulding", side * (xs + 0.25), ym + 0.5, (z0 + z1) / 2, [0.6, 0.7, z1 - z0], CH);
    box("side rubber", side * (xs + 0.25), ym - 0.3, (z0 + z1) / 2, [0.6, 0.9, z1 - z0], RUB);
    const hy = s.ys - 1.6;
    for (const hz of s.handles ?? (s.seams && s.seams.length > 1 ? [s.seams[1] + 2.6, s.seams[1] - 2.6] : [])) {
      let xh = 0;
      for (let z = hz - 1.5; z <= hz + 1.5; z += 1) xh = Math.max(xh, b.surf(z, hy));
      box("door handle", side * (xh + 0.3), hy, hz, [0.7, 0.8, 3.0], CH);
    }
  }
  // exhaust tips under the tail (muscle cars: two big chrome ones)
  if (s.exhaust) for (const x of [-1, 1]) lamp("exhaust tip", x * rear.hw * 0.5, rear.yb + 0.6, s.zr - 0.6, [2.6, 2.6, 3.6], CH, 0);
}

// ---- build ----------------------------------------------------------------------------------------------------------------------
function build(name, s) {
  const b = body(s);
  const lightsAndMore = [];
  const hw = (z) => b.at(z).hw;
  const lamp = (nm, x, y, z, size, color, emissive) => lightsAndMore.push({ name: nm, shape: "sphere", from: [x - size[0] / 2, b.Y(y) - size[1] / 2, z - size[2] / 2], size, color, emissive, segments: 12 });
  const box = (nm, x, y, z, size, color, extra = {}) => lightsAndMore.push({ name: nm, shape: "box", from: [x - size[0] / 2, b.Y(y) - size[1] / 2, z - size[2] / 2], size, color, ...extra });
  const front = b.at(s.zf), rear = b.at(s.zr);
  if (s.classic) classicDetails({ box, lamp, b, s, front, rear });
  // headlights and tail lights
  for (const side of s.open ? [] : [-1, 1]) {
    const fy = front.yb + (front.yt - front.yb) * 0.66, ry = rear.yb + (rear.yt - rear.yb) * 0.72;
    if (!s.classic) box(`headlight ${side > 0 ? "left" : "right"}`, side * front.hw * 0.66, fy, s.zf + 0.05, [front.hw * 0.4, 1.9, 0.9], "#fff3cc", { emissive: 0.95 });
    box(`tail light ${side > 0 ? "left" : "right"}`, side * rear.hw * 0.66, ry, s.zr - 0.05, [rear.hw * 0.42, 1.7, 0.9], "#e5202e", { emissive: 0.8 });
  }
  if (!s.open && !s.classic) box("grille", 0, front.yb + (front.yt - front.yb) * 0.4, s.zf + 0.1, [front.hw * 0.62, 1.8, 0.9], "#17181d");
  if (!s.open) box("plate", 0, rear.yb + (rear.yt - rear.yb) * 0.42, s.zr - 0.1, [5.6, 2.0, 0.7], "#f0f0ea");
  for (const side of s.open ? [] : [-1, 1]) box(`mirror ${side > 0 ? "left" : "right"}`, side * (b.at(s.front[0] - 1.2).hw + 1.1), b.at(s.front[0]).ys + 2.6, s.front[0] - 0.4, [1.4, 1.6, 2.6], "#1d1e24");
  (s.extras ?? []).forEach((f) => f({ box, lamp, b, s, hw }));
  const parts = [
    { name: "body", origin: [0, s.pivot, 0], rotation: [0, 0, 0], cubes: [...b.cubes, ...lightsAndMore], children: [] },
    wheel("wheel_fl", -1, s.wheelZ[0], s), wheel("wheel_fr", 1, s.wheelZ[0], s),
    wheel("wheel_rl", -1, s.wheelZ[1], { ...s, R: s.Rr ?? s.R, tw: s.twr ?? s.tw }), wheel("wheel_rr", 1, s.wheelZ[1], { ...s, R: s.Rr ?? s.R, tw: s.twr ?? s.tw }),
  ];
  // where the rear lamps are, in metres, for entities/car.lua's TAIL table (the glow and the brake lights are drawn there)
  build.tail = { z: r2(s.zr / 16), y: r2((rear.yb + (rear.yt - rear.yb) * 0.72) / 16), x: r2((rear.hw * 0.66) / 16 / 0.92) };
  return { version: 1, scale: 0.0625, parts };
}

const want = process.argv.slice(2);
await withServer(async (nova) => {
  for (const [name, spec] of Object.entries(CARS)) {
    if (want.length && !want.includes(name)) continue;
    await nova.call("model_write", { name, model: build(name, spec) });
    console.log("wrote", name, `TAIL ${name} = { z = ${build.tail.z}, y = ${build.tail.y}, x = ${build.tail.x} }`);
  }
});
