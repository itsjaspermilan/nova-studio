// Arcade-style cars for Pine Ridge Rally, in the spirit of Hotshot Racing and Art of Rally: low, wide, chunky bodies of a few big rounded
// panels (a bevel on every cage), a small tinted glasshouse with raked glass, wheels pushed right into the corners under flared arches,
// a livery of bold stripes, and big simple lights. No micro-detail: it must read from a chase camera on a 6-inch screen.
// Written through the Nova MCP server (models/<name>.model.json + .glb), so the studio opens them like any model.
//   scripts/env.sh node scripts/rally/arcade.mjs [name ...]
// Units are 1/16 m, y up, nose along +z. The body and four wheels are separate parts, as entities/car.lua moves them.
import { withServer } from "./mcp.mjs";

const r2 = (v) => Math.round(v * 100) / 100;
const parse = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hex = (c) => "#" + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
const mul = (h, f) => hex(parse(h).map((v) => v * f));
const add = (a, b) => a.map((v, i) => v + b[i]);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const scale = (a, k) => a.map((v) => v * k);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };

const PAINT = { metallic: 0.4, roughness: 0.28 }, GLASS = { metallic: 0.5, roughness: 0.06 }, CHROME = { metallic: 0.95, roughness: 0.16 }, RUBBER = { metallic: 0, roughness: 0.85 };
const GLASS_COLOR = "#16273d", DARK = "#16171c", CH = "#d4d8df";

// ---- cages -------------------------------------------------------------------------------------------------------------------------------
// A box-shaped cage from eight corners (0-3 one face going round, 4-7 the opposite face, i joined to i+4), faces turned outwards, with a
// bevel to round it. `PIV` is subtracted from every height: shapes are written in world heights (ground = 0).
let PIV = 5.6;
const FACES = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 3, 7, 4], [1, 2, 6, 5], [0, 1, 5, 4], [3, 2, 6, 7]];
function cage(name, c8, color, o = {}) {
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
// An axis-aligned box.
const box = (name, x0, x1, y0, y1, z0, z1, color, o = {}) => cage(name, [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], color, o);
// A point on a quad A B C D (A origin, u towards B, v towards D).
const bil = (q, u, v) => [0, 1, 2].map((a) => q[0][a] * (1 - u) * (1 - v) + q[1][a] * u * (1 - v) + q[2][a] * u * v + q[3][a] * (1 - u) * v);
// A thin slab lying on the face `q` (A B C D), from u0..u1 and v0..v1 of it, standing `lift` out of it and `thick` thick (a window, a stripe, a lamp).
function onFace(name, q, u0, u1, v0, v1, color, lift, thick, o = {}, outward) {
  const p = [bil(q, u0, v0), bil(q, u1, v0), bil(q, u1, v1), bil(q, u0, v1)];
  let n = norm(cross(sub(q[1], q[0]), sub(q[3], q[0])));
  if (outward && n[0] * outward[0] + n[1] * outward[1] + n[2] * outward[2] < 0) n = scale(n, -1);
  const base = p.map((pt) => add(pt, scale(n, lift)));
  const top = base.map((pt) => add(pt, scale(n, thick)));
  return cage(name, [...base, ...top], color, o);
}

// ---- wheels: big, simple, bold -------------------------------------------------------------------------------------------------------
function wheel(name, side, z, s) {
  const R = s.R, tw = s.tw;
  const t = (n, r, w, color, seg, m) => Object.assign({ name: n, shape: "cylinder", from: [-r, -w / 2, -r], size: [2 * r, w, 2 * r], rotation: [0, 0, 90], color, segments: seg, smooth: true }, m);
  const rim = s.rim ?? "#e6e9ee";
  const cubes = [t("tyre", R, tw, "#202127", 24, RUBBER), t("sidewall", R * 0.84, tw + 0.5, "#30313a", 24, RUBBER), t("rim", R * 0.68, tw + 0.9, rim, 24, CHROME), t("rim dish", R * 0.5, tw + 1.3, "#1d1e24", 24, RUBBER)];
  // five fat spokes: a star mesh each side of the dish
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

// ---- the car --------------------------------------------------------------------------------------------------------------------------
// spec: zr, zf (tail, nose), hw (half width of the body), yb (underside), yTail, yNose (height of the top of the body at the ends),
// cabin: { z: [back bottom, front bottom, back top, front top], h: roof height, w: [half width at the base, at the roof] },
// R, tw, track, wheelZ [front, rear], paint, roof (colour of the roof), stripe: { color, half }, spoiler: bool
function arcade(s) {
  PIV = s.pivot ?? s.R;
  const body = [];
  const P = { material: PAINT };
  const { zr, zf, hw, yb } = s;
  const yTail = s.yTail, yNose = s.yNose;
  const belt = Math.max(yTail, yNose) + 0.4;
  // the lower body: a wide, low slab with a sloping top, rounded all round
  const bt = hw - 0.5, bb = hw - 1.6, nb = hw - 3.2, nt = hw - 1.8; // half widths: back top, back bottom, nose bottom, nose top
  const lower = cage("body", [[-bb, yb, zr], [bb, yb, zr], [bt, yTail, zr], [-bt, yTail, zr], [-nb, yb + 0.8, zf], [nb, yb + 0.8, zf], [nt, yNose, zf], [-nt, yNose, zf]], s.paint, { bevel: s.bevel ?? 2.6, segs: 3, ...P });
  body.push(lower);
  // the top face of the lower body (for stripes): back-left, back-right... as a quad A B C D with u across x, v along z
  const topFace = [[-bt, yTail, zr], [bt, yTail, zr], [nt, yNose, zf], [-nt, yNose, zf]];
  // the glasshouse: a trapezoid, the roof narrower than the base, the front and the back raked
  const c = s.cabin, [zb0, zb1, zt0, zt1] = c.z, [xb, xt] = c.w, y0 = Math.max(yTail, yNose) - 0.5 + (c.sink ?? 0), y1 = c.h;
  const cab = cage("cabin", [[-xb, y0, zb0], [xb, y0, zb0], [xt, y1, zt0], [-xt, y1, zt0], [-xb, y0, zb1], [xb, y0, zb1], [xt, y1, zt1], [-xt, y1, zt1]], s.roof ?? s.paint, { bevel: 1.5, segs: 3, ...P });
  body.push(cab);
  const out = [0, 0, 0];
  const front = [[-xb, y0, zb1], [xb, y0, zb1], [xt, y1, zt1], [-xt, y1, zt1]], back = [[xb, y0, zb0], [-xb, y0, zb0], [-xt, y1, zt0], [xt, y1, zt0]];
  const left = [[-xb, y0, zb0], [-xb, y0, zb1], [-xt, y1, zt1], [-xt, y1, zt0]], right = [[xb, y0, zb1], [xb, y0, zb0], [xt, y1, zt0], [xt, y1, zt1]];
  body.push(onFace("windscreen", front, 0.09, 0.91, 0.13, 0.87, GLASS_COLOR, 0.02, 0.35, { material: GLASS }, [0, y0, 1]));
  body.push(onFace("rear window", back, 0.1, 0.9, 0.13, 0.85, GLASS_COLOR, 0.02, 0.35, { material: GLASS }, [0, y0, -1]));
  const wins = s.windows ?? [[0.09, 0.49], [0.55, 0.91]];
  wins.forEach(([a, b], i) => {
    body.push(onFace(`window left ${i + 1}`, left, a, b, 0.12, 0.88, GLASS_COLOR, 0.02, 0.35, { material: GLASS }, [-1, 0, 0]));
    body.push(onFace(`window right ${i + 1}`, right, a, b, 0.12, 0.88, GLASS_COLOR, 0.02, 0.35, { material: GLASS }, [1, 0, 0]));
  });
  void out;
  // the livery: bold stripes over the bonnet, the roof and the boot
  if (s.stripe) {
    const { color, half } = s.stripe, k = half / (2 * hw) * 2; // fraction of the width each side of the middle
    body.push(onFace("bonnet stripe", [topFace[0], topFace[1], topFace[2], topFace[3]], 0.5 - k, 0.5 + k, 0.62, 0.995, color, 0.1, 0.35, { material: PAINT }, [0, 1, 0]));
    body.push(onFace("boot stripe", [topFace[0], topFace[1], topFace[2], topFace[3]], 0.5 - k, 0.5 + k, 0.005, 0.2, color, 0.1, 0.35, { material: PAINT }, [0, 1, 0]));
    const roof = [[-xt, y1, zt0], [xt, y1, zt0], [xt, y1, zt1], [-xt, y1, zt1]];
    body.push(onFace("roof stripe", roof, 0.5 - (half / (2 * xt)), 0.5 + (half / (2 * xt)), 0.0, 1.0, color, 0.1, 0.35, { material: PAINT }, [0, 1, 0]));
  }
  // bumpers, the splitter and the diffuser
  body.push(box("front bumper", -nt - 0.2, nt + 0.2, yb + 0.4, yb + 4.2, zf - 1.4, zf + 1.0, s.bumper ?? s.paint, { bevel: 1.2, segs: 2, material: { metallic: 0.1, roughness: 0.55 } }));
  body.push(box("splitter", -hw + 1.4, hw - 1.4, yb - 0.2, yb + 1.0, zf - 0.5, zf + 2.0, "#101114", { bevel: 0.35, segs: 1, material: RUBBER }));
  body.push(box("rear bumper", -bt, bt, yb + 0.4, yb + 4.6, zr - 1.2, zr + 1.0, s.bumper ?? s.paint, { bevel: 1.2, segs: 2, material: { metallic: 0.1, roughness: 0.55 } }));
  body.push(box("diffuser", -hw + 3.4, hw - 3.4, yb - 0.2, yb + 1.6, zr - 2.0, zr + 0.8, "#101114", { bevel: 0.3, segs: 1, material: RUBBER }));
  // the lights: big simple shapes
  const hy = yNose - 3.4;
  for (const side of [-1, 1]) {
    body.push(box(`headlight ${side}`, side * (nt - 7.4), side * (nt - 1.4), hy - 1.2, hy + 1.2, zf - 0.7, zf + 0.35, "#fff3cf", { bevel: 0.5, segs: 2, emissive: 0.95 }));
    const hx = [side * (nt - 7.4), side * (nt - 1.4)].sort((a, b) => a - b);
    body[body.length - 1] = box(`headlight ${side}`, hx[0], hx[1], hy - 1.2, hy + 1.2, zf - 0.7, zf + 0.35, "#fff3cf", { bevel: 0.5, segs: 2, emissive: 0.95 });
    body.push(box(`headlight rim ${side}`, hx[0] - 0.5, hx[1] + 0.5, hy - 1.7, hy + 1.7, zf - 0.8, zf + 0.1, "#2a2c33", { bevel: 0.4, segs: 1, material: RUBBER }));
    body.push(box(`fog ${side}`, side * (nt - 6) - 1.5, side * (nt - 6) + 1.5, yb + 1.8, yb + 3.2, zf - 0.2, zf + 1.4, "#ffe07a", { bevel: 0.3, segs: 1, emissive: 0.6 }));
  }
  body.push(box("grille", -(nt - 8.6), nt - 8.6, hy - 1.2, hy + 1.0, zf - 0.7, zf + 0.3, "#0f1013", { bevel: 0.4, segs: 1, material: RUBBER }));
  body.push(box("tail light bar", -bt + 1.6, bt - 1.6, yTail - 3.6, yTail - 1.6, zr - 0.9, zr + 0.2, "#e8202c", { bevel: 0.45, segs: 2, emissive: 0.9 }));
  for (const side of [-1, 1]) body.push(box(`brake ${side}`, side * (bt - 1.6) - 2.0, side * (bt - 1.6) + 2.0, yTail - 5.8, yTail - 3.8, zr - 0.9, zr + 0.2, "#ff5a3a", { bevel: 0.35, segs: 1, emissive: 0.75 }));
  body.push(box("plate", -3.2, 3.2, yb + 1.8, yb + 4.2, zr - 1.5, zr - 0.8, "#f0f0ea", { material: RUBBER }));
  // the arches: flared fenders over each wheel, and a dark well, so the wheels sit in the body
  for (const side of [-1, 1]) for (const wz of s.wheelZ) {
    const fx0 = side > 0 ? hw - 2.4 : -hw - 0.7, fx1 = side > 0 ? hw + 0.7 : -hw + 2.4;
    const topAt = (z) => yTail + (yNose - yTail) * ((z - zr) / (zf - zr));
    body.push(box("fender", fx0, fx1, s.R * 2 - 1.6, Math.min(topAt(wz - s.R), topAt(wz + s.R)) + 0.1, wz - s.R * 1.28, wz + s.R * 1.28, s.paint, { bevel: 1.1, segs: 3, material: PAINT }));
    body.push(Object.assign({ name: "wheel well", shape: "cylinder", from: [(side > 0 ? hw - 0.4 : -hw - 0.4) - s.R * 1.18, s.R - PIV - 0.4, wz - s.R * 1.18], size: [s.R * 2.36, 0.8, s.R * 2.36], rotation: [0, 0, 90], color: "#0e0f13", segments: 24, smooth: true }, RUBBER));
  }
  // the side skirts, the door line and the handles, the mirrors
  for (const side of [-1, 1]) {
    const x = side * (hw - 0.2);
    body.push(box(`skirt ${side}`, x - (side > 0 ? 0.6 : 0.9), x + (side > 0 ? 0.9 : 0.6), yb + 0.2, yb + 2.0, s.wheelZ[1] + s.R * 1.3, s.wheelZ[0] - s.R * 1.3, "#101114", { bevel: 0.3, segs: 1, material: RUBBER }));
    body.push(box(`door line ${side}`, x - (side > 0 ? 0.2 : 0.3), x + (side > 0 ? 0.3 : 0.2), yb + 2.4, Math.max(yTail, yNose) - 0.6, (zb0 + zb1) / 2 - 0.2, (zb0 + zb1) / 2 + 0.2, mul(s.paint, 0.55), { material: RUBBER }));
    body.push(box(`mirror ${side}`, side * (xb + 0.8) - 1.1, side * (xb + 0.8) + 1.1, y0 + 0.6, y0 + 2.6, zb1 - 3.4, zb1 - 1.0, s.paint, { bevel: 0.5, segs: 2, material: PAINT }));
  }
  if (s.spoiler) {
    for (const side of [-1, 1]) body.push(box(`spoiler post ${side}`, side * (hw - 5) - 0.7, side * (hw - 5) + 0.7, yTail - 0.4, yTail + 4.4, zr + 3, zr + 5, "#101114", { bevel: 0.2, segs: 1, material: RUBBER }));
    body.push(box("spoiler", -hw + 1, hw - 1, yTail + 3.8, yTail + 5.0, zr - 0.5, zr + 6.5, s.accent ?? "#101114", { bevel: 0.45, segs: 2, material: PAINT }));
    for (const side of [-1, 1]) body.push(box(`spoiler end ${side}`, side * (hw - 1) - 0.4, side * (hw - 1) + 0.4, yTail + 3.2, yTail + 6.4, zr - 0.7, zr + 6.7, s.accent ?? "#101114", { material: PAINT }));
  }
  for (const side of [-1, 1]) body.push(Object.assign({ name: `exhaust ${side}`, shape: "cylinder", from: [side * 5.4 - 1.1, yb + 0.9 - PIV, zr - 3.0], size: [2.2, 2.2, 2.2], rotation: [90, 0, 0], color: "#aeb4be", segments: 12, smooth: true }, CHROME));
  const put = (...args) => { const c = box(...args); body.push(c); return c; };
  for (const fn of s.extras ?? []) fn({ body, box: put, onFace, cage, s, hw, yb, yTail, yNose, roofY: y1, cabinY: y0, zr, zf, xb, xt, zt0, zt1, zb0, zb1 });
  const parts = [{ name: "body", origin: [0, PIV, 0], rotation: [0, 0, 0], cubes: body, children: [] },
    wheel("wheel_fl", -1, s.wheelZ[0], s), wheel("wheel_fr", 1, s.wheelZ[0], s), wheel("wheel_rl", -1, s.wheelZ[1], s), wheel("wheel_rr", 1, s.wheelZ[1], s)];
  const ty = yTail - 2.6;
  return { model: { version: 1, scale: 0.0625, parts }, tail: { z: r2(zr / 16), y: r2(ty / 16), x: r2((bt - 1.6) / 16) } };
}

// ---- the roster -----------------------------------------------------------------------------------------------------------------------
// archetypes (a spec each), then a livery per car. `wheel` (metres) is what state.lua says each car's tyre radius is: keep the two together.
const sedan = (o) => ({ zr: -37, zf: 37, hw: 15.2, yb: 3.6, yTail: 15.2, yNose: 13.4, cabin: { z: [-27, 11, -18, 4], h: 24.6, w: [13.4, 11.0] }, R: 6.0, tw: 7.4, track: 12.6, wheelZ: [23, -22.5], pivot: 6, ...o });
const coupe = (o) => ({ zr: -38, zf: 38, hw: 15.8, yb: 3.2, yTail: 15.4, yNose: 11.8, cabin: { z: [-25, 5, -17, -4], h: 22.4, w: [13.6, 10.6] }, R: 6.2, tw: 8.0, track: 13.0, wheelZ: [25, -24], pivot: 6.2, windows: [[0.1, 0.9]], spoiler: true, ...o });
const hatch = (o) => ({ zr: -32, zf: 32, hw: 14.9, yb: 3.8, yTail: 17.0, yNose: 13.6, cabin: { z: [-31, 7, -28, 1], h: 25.2, w: [13.2, 11.2] }, R: 5.8, tw: 7.2, track: 12.2, wheelZ: [20, -20], pivot: 5.8, windows: [[0.08, 0.5], [0.56, 0.92]], ...o });
const suv = (o) => ({ zr: -37, zf: 37, hw: 15.6, yb: 5.6, yTail: 19.0, yNose: 17.0, cabin: { z: [-33, 13, -30, 5], h: 30.0, w: [14.0, 12.4] }, R: 7.0, tw: 8.0, track: 12.8, wheelZ: [22.5, -22], pivot: 7, windows: [[0.07, 0.34], [0.38, 0.66], [0.7, 0.93]], bevel: 3, ...o });
const van = (o) => ({ zr: -40, zf: 40, hw: 16, yb: 4.8, yTail: 27.0, yNose: 19.0, cabin: { z: [-39, 27, -38, 14], h: 34.0, w: [14.9, 13.8] }, R: 6.4, tw: 7.6, track: 13.2, wheelZ: [25, -25], pivot: 6.4, windows: [[0.06, 0.32], [0.36, 0.64], [0.68, 0.94]], bevel: 3, ...o });
const pickup = (o) => ({ zr: -41, zf: 41, hw: 15.4, yb: 5.0, yTail: 16.4, yNose: 15.6, cabin: { z: [-13, 14, -10, 6], h: 28.0, w: [13.4, 11.6] }, R: 6.8, tw: 7.8, track: 12.6, wheelZ: [24.5, -24], pivot: 6.8, windows: [[0.1, 0.9]], bevel: 3, ...o });
const roofBox = (name, w, d, h, color, z, emissive) => ({ box, roofY, zt0, zt1 }) => box(name, -w / 2, w / 2, roofY - 0.2, roofY + h, z - d / 2, z + d / 2, color, { bevel: 0.5, segs: 2, emissive });
const CARS = {
  car_pickup: () => pickup({ paint: "#e0842a", roof: "#e0842a", bumper: "#2b2d35", wheel: 0.425, accent: "#e0842a",
    extras: [({ box, hw, yTail }) => {
      const t = yTail, w = hw - 1.0;
      box("bed floor", -w + 1.2, w - 1.2, t - 0.2, t + 0.5, -39, -16, "#2a2c33", { material: { metallic: 0.1, roughness: 0.8 } });
      for (const side of [-1, 1]) box("bed side", side * w - 1.1, side * w + 1.1, t - 0.6, t + 6.2, -40.4, -15.4, "#e0842a", { bevel: 0.7, segs: 2, material: PAINT });
      box("tailgate", -w, w, t - 0.6, t + 6.0, -41.4, -39.6, "#e0842a", { bevel: 0.7, segs: 2, material: PAINT });
      box("bed front", -w, w, t - 0.6, t + 5.4, -16.8, -14.9, "#e0842a", { bevel: 0.7, segs: 2, material: PAINT });
      for (let k = 0; k < 5; k++) box("bed rib", -w + 1.4, w - 1.4, t + 0.5, t + 0.9, -37.6 + k * 4.6, -36.6 + k * 4.6, "#3a3d46", {});
    }] }),
  car_sedan: () => sedan({ paint: "#e0442c", roof: "#1b1d24", stripe: { color: "#f3f5f8", half: 2.4 }, wheel: 0.375 }),
  car_taxi: () => sedan({ paint: "#f6b81c", roof: "#f6b81c", bumper: "#1b1d24", zr: -39, zf: 39, wheelZ: [24, -23.5], wheel: 0.375,
    extras: [roofBox("taxi sign", 9, 3.6, 2.8, "#fff6d0", -5, 0.6), ({ box, hw, yb }) => { for (const side of [-1, 1]) box("taxi band", side * hw - (side > 0 ? 0.5 : 0.1), side * hw + (side > 0 ? 0.1 : 0.5), yb + 5.2, yb + 7.0, -34, 34, "#1b1d24", {}); }] }),
  car_police: () => sedan({ paint: "#f2f4f7", roof: "#1b1d24", bumper: "#1f2f66", zr: -39, zf: 39, wheelZ: [24, -23.5], wheel: 0.375,
    extras: [({ box, roofY }) => { box("siren red", -6.4, -0.4, roofY - 0.2, roofY + 2.2, -9, -4, "#ff3340", { bevel: 0.5, segs: 2, emissive: 0.95 }); box("siren blue", 0.4, 6.4, roofY - 0.2, roofY + 2.2, -9, -4, "#3d7bff", { bevel: 0.5, segs: 2, emissive: 0.95 }); },
      ({ box, hw, yb, yTail, yNose }) => { for (const side of [-1, 1]) box("police stripe", side * hw - (side > 0 ? 0.5 : 0.1), side * hw + (side > 0 ? 0.1 : 0.5), yb + 3.6, yb + 7.6, -30, 31, "#1f3a8a", {}); }] }),
  car: () => coupe({ paint: "#d91f35", roof: "#d91f35", stripe: { color: "#f4f6fa", half: 2.2 }, wheel: 0.385 }),
  car_blue: () => coupe({ paint: "#2563c9", roof: "#2563c9", stripe: { color: "#f4f6fa", half: 2.6 }, accent: "#f4f6fa", wheel: 0.385 }),
  car_yellow: () => coupe({ paint: "#ffc61a", roof: "#1c1d22", stripe: { color: "#1c1d22", half: 2.4 }, accent: "#1c1d22", wheel: 0.385 }),
  car_green: () => hatch({ paint: "#33b46c", roof: "#f3f5f8", stripe: { color: "#f3f5f8", half: 1.6 }, wheel: 0.36 }),
  car_suv: () => suv({ paint: "#5b8f5a", roof: "#e9ecef", bumper: "#2b2d35", wheel: 0.44,
    extras: [({ box, roofY, xt }) => { for (const side of [-1, 1]) box("roof rail", side * (xt - 1.4) - 0.5, side * (xt - 1.4) + 0.5, roofY, roofY + 1.0, -26, 0, "#2b2d35", {}); }] }),
  car_suvl: () => suv({ zr: -39, zf: 39, hw: 16, yTail: 18.4, yNose: 16.6, paint: "#27324d", roof: "#27324d", stripe: { color: "#c9ced6", half: 1.4 }, bumper: "#1b1d24", wheel: 0.44, wheelZ: [24, -23.5],
    extras: [({ box, roofY, xt }) => { for (const side of [-1, 1]) box("roof rail", side * (xt - 1.4) - 0.5, side * (xt - 1.4) + 0.5, roofY, roofY + 1.0, -28, 0, "#c9ced6", {}); }] }),
  car_van: () => van({ paint: "#f1efe7", roof: "#f1efe7", bumper: "#2b5aa8", wheel: 0.4,
    extras: [({ box, hw, yb }) => { for (const side of [-1, 1]) box("van band", side * hw - (side > 0 ? 0.5 : 0.1), side * hw + (side > 0 ? 0.1 : 0.5), yb + 4.4, yb + 9.4, -38, 38, "#2b5aa8", {}); },
      ({ box, roofY, xt }) => { for (const side of [-1, 1]) box("roof rail", side * (xt - 1.6) - 0.5, side * (xt - 1.6) + 0.5, roofY, roofY + 1.0, -34, 4, "#c9ced6", {}); }] }),
};

const want = process.argv.slice(2);
await withServer(async (nova) => {
  for (const [name, make] of Object.entries(CARS)) {
    if (want.length && !want.includes(name)) continue;
    const { model, tail } = arcade(make());
    await nova.call("model_write", { name, model });
    console.log("wrote", name, `TAIL ${name} = { z = ${tail.z}, y = ${tail.y}, x = ${tail.x} }`);
  }
});
