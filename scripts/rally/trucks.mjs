// The two big service vehicles of Pine Ridge Rally, the fire engine and the bin lorry, built from rounded panels with the editor's own
// modifiers (a bevel on every box, an array for the rungs of the ladder) so the studio opens them as any model: the cage stays editable.
// Written through the Nova MCP server (models/<name>.model.json and .glb), like scripts/rally/cars.mjs.
//   scripts/env.sh node scripts/rally/trucks.mjs [firetruck | garbage_truck ...]
// Units are 1/16 of a metre, y up, the nose along +z. The body and the four wheels are separate parts, as entities/car.lua moves them:
// the wheels sit where the old models had them (z +-15.3, x +-10.8 (11.7 for the bin lorry), radius 6.8), so handling and camera are unchanged.
import { withServer } from "./mcp.mjs";

const PIV = 3.8; // the height the body leans about; shapes are written in world heights (ground = 0) and shifted by this
const R = 6.8, TW = 7.6;
const r2 = (v) => Math.round(v * 100) / 100;
const parse = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hex = (c) => "#" + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
const mul = (h, f) => hex(parse(h).map((v) => v * f));

// ---- shapes -----------------------------------------------------------------------------------------------------------------------
// A box-shaped cage from its eight corners (the cube's order: 0-3 the back face z0, 4-7 the front face z1, each going round from
// bottom-left), faces turned to face outwards, with a bevel to round it (bevel 0: sharp).
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
  if (o.bevel) cube.modifiers = [{ type: "bevel", width: o.bevel, segments: o.segs ?? 2, angle: 30 }, ...(o.mods ?? [])];
  else if (o.mods) cube.modifiers = o.mods;
  if (o.emissive) cube.emissive = o.emissive;
  if (o.material) Object.assign(cube, o.material);
  return cube;
}
// An upright box between x0..x1, y0..y1, z0..z1; `lean` pulls the top of the front face back (a raked windscreen) and `rake` the top of the back.
const box = (name, x0, x1, y0, y1, z0, z1, color, o = {}) => {
  const lean = o.lean ?? 0, rake = o.rake ?? 0;
  return cage(name, [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0 + rake], [x0, y1, z0 + rake], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1 - lean], [x0, y1, z1 - lean]], color, o);
};
// Tilts the top of a slab's front and back faces by dz along z (a raked screen).
const tilt = (g, dz) => { for (const i of [2, 3, 6, 7]) g.verts[i][2] = r2(g.verts[i][2] + dz); return g; };

// ---- materials (as cars.mjs: what each kind of shape is made of) -----------------------------------------------------------------
const GLASS = { metallic: 0.55, roughness: 0.05 }, PAINT = { metallic: 0.4, roughness: 0.3 }, CHROME = { metallic: 0.95, roughness: 0.16 }, RUBBER = { metallic: 0, roughness: 0.85 };
const mat = (cube, m) => Object.assign(cube, m);

// ---- the wheels: the same parts the cars have (a tyre, a sidewall, a steel rim with a hub) -----------------------------------------
function wheel(name, side, z, track) {
  const t = (n, r, w, color, seg, m) => mat({ name: n, shape: "cylinder", from: [-r, -w / 2, -r], size: [2 * r, w, 2 * r], rotation: [0, 0, 90], color, segments: seg, smooth: true }, m);
  const cubes = [
    t("tyre", R, TW, "#26272d", 24, RUBBER), t("sidewall", R * 0.86, TW + 0.5, "#35363e", 24, RUBBER),
    t("rim", R * 0.66, TW + 0.8, "#cfd3da", 24, { metallic: 0.85, roughness: 0.28 }), t("rim dish", R * 0.52, TW + 1.1, "#2a2c33", 24, RUBBER),
    t("hub", R * 0.3, TW + 1.6, "#dde1e7", 18, { metallic: 0.85, roughness: 0.28 }),
  ];
  for (let k = 0; k < 8; k++) { // the lug nuts: small bars along the axle
    const a = (k / 8) * Math.PI * 2, w = TW + 1.9;
    cubes.push(mat({ name: `nut ${k + 1}`, shape: "box", from: [-w / 2, Math.cos(a) * R * 0.4 - 0.5, Math.sin(a) * R * 0.4 - 0.5], size: [w, 1, 1], color: "#9aa0aa" }, CHROME));
  }
  return { name, origin: [side * track, R, z], rotation: [0, 0, 0], cubes, children: [] };
}

// ---- parts both share --------------------------------------------------------------------------------------------------------------
const GLASS_COLOR = "#1f3350", FRAME = "#14161b", DARK = "#1b1c22", GREY = "#4a4e5b", CH = "#d4d8df";
function arches(zs, hw) { // the dark wheel wells on the sides, behind each tyre (discs lying along x, written standing and turned about z like the tyres)
  const out = [], rr = R * 1.28, th = 0.8;
  for (const side of [-1, 1]) for (const z of zs) out.push(mat({ name: "wheel well", shape: "cylinder", from: [side * hw - rr, R - PIV - th / 2, z - rr], size: [2 * rr, th, 2 * rr], rotation: [0, 0, 90], color: "#101116", segments: 24, smooth: true }, RUBBER));
  return out;
}
function lamps(spec) { // spec: { front: z, rear: z, hw }: the headlights, indicators and tail lights, and the plates
  const { front, rear, hw, hy = 11, ty = 12 } = spec, out = [];
  for (const s of [-1, 1]) {
    out.push(box("headlight bezel", s * (hw - 5) - 2.6, s * (hw - 5) + 2.6, hy - 1.6, hy + 1.6, front - 0.3, front + 0.5, CH, { material: CHROME }));
    out.push(box("headlight", s * (hw - 5) - 2.0, s * (hw - 5) + 2.0, hy - 1.1, hy + 1.1, front + 0.2, front + 0.8, "#fff1c4", { emissive: 0.95 }));
    out.push(box("indicator", s * (hw - 5) - 2.0, s * (hw - 5) + 2.0, hy - 3.2, hy - 2.2, front + 0.1, front + 0.7, "#ffb21e", { emissive: 0.5 }));
    out.push(box("tail light", s * (hw - 3.2) - 1.7, s * (hw - 3.2) + 1.7, ty - 1.8, ty + 1.8, rear - 0.7, rear + 0.1, "#e5202e", { emissive: 0.85 }));
  }
  out.push(box("plate", -3, 3, ty - 1.6, ty + 1.6, rear - 0.5, rear + 0.2, "#f0f0ea", { material: RUBBER }));
  return out;
}
const mirror = (side, x, y, z) => [
  box("mirror arm", side * x - 0.4, side * x + 0.4, y - 0.4, y + 0.4, z - 1.2, z + 0.4, GREY, { material: RUBBER }),
  box("mirror", side * (x + 1.4) - 0.9, side * (x + 1.4) + 0.9, y - 2.6, y + 2.6, z - 1.2, z + 0.1, FRAME, { bevel: 0.35, segs: 2, material: RUBBER }),
];

// ---- the fire engine -----------------------------------------------------------------------------------------------------------------
function firetruck() {
  const RED = "#d3262c", HW = 14, ZR = -35, ZF = 29, CAB = 13; // CAB: where the cab starts (z)
  const body = [];
  const P = (c) => ({ material: PAINT, ...c });
  // the chassis, and the bumpers
  body.push(box("chassis", -12.4, 12.4, 4.6, 9.4, ZR + 1, ZF - 1, "#2a2c34", { bevel: 0.8, material: RUBBER }));
  body.push(box("front bumper", -13.6, 13.6, 4.8, 8.6, ZF - 1.4, ZF + 1.8, CH, { bevel: 0.9, segs: 2, material: CHROME }));
  body.push(box("front bumper rubber", -12.8, 12.8, 5.4, 6.6, ZF + 1.7, ZF + 2.0, "#17181d", { material: RUBBER }));
  body.push(box("rear step", -13, 13, 5.2, 8.4, ZR - 1.6, ZR + 1.5, "#d9dde3", { bevel: 0.7, material: CHROME }));
  for (let k = 0; k < 5; k++) body.push(box("step stripe", -12.4 + k * 5.2, -9 + k * 5.2, 8.45, 8.6, ZR - 1.5, ZR + 1.4, k % 2 ? "#e8b822" : "#17181d", { material: RUBBER }));
  // the cab: rounded, with the screen raked back
  body.push(box("cab", -HW, HW, 9, 27.4, CAB, ZF, RED, P({ bevel: 1.6, segs: 3, lean: 3.6, rake: 0 })));
  body.push(box("cab skirt", -HW - 0.1, HW + 0.1, 9, 12.5, CAB + 0.4, ZF - 0.4, mul(RED, 0.82), P({ bevel: 0.9, segs: 2 })));
  const slope = (y) => ZF - 3.6 * ((y - 9) / 18.4); // where the front face is at height y
  body.push(tilt(box("windscreen frame", -12.4, 12.4, 17.6, 26.6, slope(17.6) - 0.5, slope(17.6) + 0.05, FRAME, { material: RUBBER }), slope(26.6) - slope(17.6)));
  body.push(tilt(box("windscreen", -11.6, 11.6, 18.4, 25.8, slope(18.4) - 0.1, slope(18.4) + 0.45, GLASS_COLOR, { material: GLASS }), slope(25.8) - slope(18.4)));
  for (const s of [-1, 1]) {
    body.push(box(`side window ${s}`, s * HW - (s > 0 ? 0.1 : 0.3), s * HW + (s > 0 ? 0.3 : 0.1), 18.4, 25.6, CAB + 2.4, ZF - 4.6, GLASS_COLOR, { material: GLASS }));
    body.push(box(`door seam ${s}`, s * HW - 0.1, s * HW + 0.2, 10, 26.6, CAB + 1.2, CAB + 1.5, "#8e1519", { material: RUBBER }));
    body.push(box(`door handle ${s}`, s * HW - 0.1, s * HW + 0.5, 17, 17.8, ZF - 5.8, ZF - 3.2, CH, { material: CHROME }));
    body.push(box(`cab step ${s}`, s * HW - 1.6, s * HW + 1.6, 9.2, 10, CAB + 3, ZF - 3, "#d9dde3", { material: CHROME }));
    for (const m of mirror(s, HW + 0.6, 22, ZF - 4.2)) body.push(m);
  }
  // the grille, the badge, the roof lamps and the siren
  body.push(box("grille", -9, 9, 10.4, 15.4, ZF - 0.4, ZF + 0.35, "#17181d", { material: RUBBER, lean: 0 }));
  for (let k = 0; k < 4; k++) body.push(box("grille bar", -9, 9, 11.2 + k * 1.2, 11.6 + k * 1.2, ZF - 0.2, ZF + 0.6, CH, { material: CHROME }));
  body.push(box("light bar base", -9, 9, 27.4, 28.4, ZF - 9, ZF - 5.5, "#2b2d35", { bevel: 0.4, material: CHROME }));
  for (const s of [-1, 1]) body.push(box(`beacon ${s}`, s * 8.4 - 1.8, s * 8.4 + 1.8, 28.3, 30, ZF - 8.5, ZF - 6, s > 0 ? "#2a6cf0" : "#e5202e", { bevel: 0.5, emissive: 0.9 }));
  body.push(box("beacon middle", -4, 4, 28.3, 29.6, ZF - 8.5, ZF - 6, "#ffffff", { bevel: 0.4, emissive: 0.7 }));
  // the body behind the cab: rounded, with the roller-shutter lockers and the ladder
  body.push(box("body", -HW, HW, 9, 27, ZR + 0.6, CAB - 0.4, RED, P({ bevel: 1.4, segs: 3 })));
  body.push(box("roof panel", -HW + 2, HW - 2, 26.6, 27.8, ZR + 2, CAB - 2, mul(RED, 0.9), P({ bevel: 0.5 })));
  const lockerZ = [[-31.5, -21], [-19.5, -9], [-7.5, 3], [4.6, CAB - 1.6]];
  for (const s of [-1, 1]) for (let k = 0; k < lockerZ.length; k++) {
    const [a, b] = lockerZ[k];
    body.push(box(`shutter ${s} ${k + 1}`, s * HW - (s > 0 ? 0.3 : 0.05), s * HW + (s > 0 ? 0.05 : 0.3), 11.2, 24.2, a, b, "#8c929d", { bevel: 0.3, material: { metallic: 0.8, roughness: 0.4 } }));
    for (let r = 0; r < 6; r++) body.push(box("shutter rib", s * HW - (s > 0 ? 0.4 : 0.05), s * HW + (s > 0 ? 0.05 : 0.4), 12.4 + r * 2, 12.7 + r * 2, a + 0.4, b - 0.4, "#6d737e", { material: RUBBER }));
    body.push(box("shutter handle", s * HW - (s > 0 ? 0.6 : 0.05), s * HW + (s > 0 ? 0.05 : 0.6), 18, 19, (a + b) / 2 - 1.4, (a + b) / 2 + 1.4, CH, { material: CHROME }));
  }
  for (const s of [-1, 1]) {
    body.push(box(`side stripe ${s}`, s * HW - (s > 0 ? 0.3 : 0.05), s * HW + (s > 0 ? 0.05 : 0.3), 9.6, 10.9, ZR + 1, CAB - 1, "#f1c40f", { material: RUBBER }));
    body.push(box(`cab stripe ${s}`, s * HW - (s > 0 ? 0.3 : 0.05), s * HW + (s > 0 ? 0.05 : 0.3), 12.4, 13.6, CAB + 0.4, ZF - 0.6, "#f1c40f", { material: RUBBER }));
  }
  // the ladder on the roof: two rails and 16 rungs made with an array modifier
  for (const s of [-1, 1]) body.push(box(`ladder rail ${s}`, s * 4.4 - 0.5, s * 4.4 + 0.5, 28.2, 29.4, ZR + 2, CAB - 3, "#d9dde3", { bevel: 0.25, material: CHROME }));
  body.push(box("ladder rungs", -4.4, 4.4, 28.5, 29.1, ZR + 3, ZR + 3.7, "#c3c8cf", { material: CHROME, mods: [{ type: "array", count: 16, offset: [0, 0, 3.2] }] }));
  for (const s of [-1, 1]) for (const z of [ZR + 6, -10, CAB - 6]) body.push(box("ladder bracket", s * 4.4 - 0.7, s * 4.4 + 0.7, 27.6, 28.3, z, z + 1.2, GREY, { material: RUBBER }));
  // the rear: a reflective chevron band, hose reel, the tail lights
  for (let k = 0; k < 7; k++) body.push(box("chevron", -12.6 + k * 3.6, -9.6 + k * 3.6, 10.6, 15, ZR - 0.05, ZR + 0.3, k % 2 ? "#e8e8ee" : "#d3262c", { material: RUBBER }));
  body.push(box("hose reel", -5, 5, 17.5, 24, ZR - 1.4, ZR + 0.6, "#c0c5cd", { bevel: 0.9, segs: 3, material: CHROME }));
  body.push(box("hose", -3.6, 3.6, 19, 22.5, ZR - 1.9, ZR - 1.3, "#b7312d", { bevel: 0.8, segs: 3, material: RUBBER }));
  for (const l of lamps({ front: ZF + 0.2, rear: ZR - 0.2, hw: HW, hy: 12.4, ty: 17 })) body.push(l);
  // the front plate sits under the grille: dropped from the shared list (the front is the bumper's)
  return { body: body.concat(arches([15.3, -15.3], HW)), track: 10.8, tail: { z: r2(ZR / 16), y: r2(17 / 16), x: r2((HW - 3.2) / 16) } };
}

// ---- the bin lorry ---------------------------------------------------------------------------------------------------------------------
function garbage() {
  const GREEN = "#2b9a58", HW = 14, ZR = -35.5, ZF = 29, CAB = 14;
  const body = [];
  const P = (c) => ({ material: PAINT, ...c });
  body.push(box("chassis", -12.4, 12.4, 4.6, 9.4, ZR + 1, ZF - 1, "#2a2c34", { bevel: 0.8, material: RUBBER }));
  body.push(box("front bumper", -13.6, 13.6, 4.8, 8.6, ZF - 1.4, ZF + 1.8, "#5b606c", { bevel: 0.9, segs: 2, material: CHROME }));
  body.push(box("cab", -13.4, 13.4, 9, 26.4, CAB, ZF, GREEN, P({ bevel: 1.6, segs: 3, lean: 3.4 })));
  body.push(box("cab skirt", -13.5, 13.5, 9, 12.5, CAB + 0.4, ZF - 0.4, mul(GREEN, 0.8), P({ bevel: 0.9, segs: 2 })));
  const slope = (y) => ZF - 3.4 * ((y - 9) / 17.4);
  body.push(tilt(box("windscreen frame", -12.2, 12.2, 17.2, 25.4, slope(17.2) - 0.5, slope(17.2) + 0.05, FRAME, { material: RUBBER }), slope(25.4) - slope(17.2)));
  body.push(tilt(box("windscreen", -11.4, 11.4, 18, 24.8, slope(18) - 0.1, slope(18) + 0.45, GLASS_COLOR, { material: GLASS }), slope(24.8) - slope(18)));
  for (const s of [-1, 1]) {
    body.push(box(`side window ${s}`, s * 13.4 - (s > 0 ? 0.1 : 0.3), s * 13.4 + (s > 0 ? 0.3 : 0.1), 18, 24.6, CAB + 2.4, ZF - 4.4, GLASS_COLOR, { material: GLASS }));
    body.push(box(`door seam ${s}`, s * 13.4 - 0.1, s * 13.4 + 0.2, 10, 25.6, CAB + 1.2, CAB + 1.5, "#1d6a3b", { material: RUBBER }));
    body.push(box(`door handle ${s}`, s * 13.4 - 0.1, s * 13.4 + 0.5, 16.6, 17.4, ZF - 5.8, ZF - 3.2, CH, { material: CHROME }));
    for (const m of mirror(s, 14, 21, ZF - 4.2)) body.push(m);
    body.push(box(`cab step ${s}`, s * 13.4 - 1.6, s * 13.4 + 1.6, 9.2, 10, CAB + 3, ZF - 3, "#d9dde3", { material: CHROME }));
  }
  body.push(box("grille", -8.6, 8.6, 10.4, 15, ZF - 0.4, ZF + 0.35, "#17181d", { material: RUBBER }));
  for (let k = 0; k < 4; k++) body.push(box("grille bar", -8.6, 8.6, 11 + k * 1.1, 11.4 + k * 1.1, ZF - 0.2, ZF + 0.6, CH, { material: CHROME }));
  body.push(box("beacon", -3.5, 3.5, 26.2, 28.2, ZF - 9, ZF - 6, "#ff9a1a", { bevel: 0.7, segs: 3, emissive: 0.85 }));
  // the packer body behind the cab: a deep rounded box with a heavy roof curve, a white band, and the hopper at the back
  body.push(box("body", -HW, HW, 9, 28.6, ZR + 0.6, CAB - 0.5, GREEN, P({ bevel: 3.4, segs: 4 })));
  body.push(box("body lower", -HW - 0.1, HW + 0.1, 9, 13, ZR + 1.4, CAB - 1, mul(GREEN, 0.78), P({ bevel: 1, segs: 2 })));
  for (const s of [-1, 1]) {
    body.push(box(`band ${s}`, s * HW - (s > 0 ? 0.45 : 0.05), s * HW + (s > 0 ? 0.05 : 0.45), 17.4, 20.4, ZR + 3, CAB - 2.4, "#f4f6f8", { bevel: 0.15, material: RUBBER }));
    body.push(box(`rib ${s}`, s * HW - (s > 0 ? 0.4 : 0.05), s * HW + (s > 0 ? 0.05 : 0.4), 22, 22.6, ZR + 3, CAB - 2.4, mul(GREEN, 0.8), { material: RUBBER }));
    body.push(box(`panel line ${s}`, s * HW - (s > 0 ? 0.35 : 0.05), s * HW + (s > 0 ? 0.05 : 0.35), 13.3, 28, CAB - 8, CAB - 7.6, mul(GREEN, 0.72), { material: RUBBER }));
  }
  // the hopper: a dark open mouth with a lip, and the lifting bars of the bin lift
  body.push(box("hopper lip", -12, 12, 11.5, 14, ZR - 3.4, ZR + 1.2, "#3a3e49", { bevel: 0.9, material: CHROME }));
  body.push(box("hopper", -11, 11, 13.6, 22.5, ZR - 0.5, ZR + 6, "#17181d", { bevel: 0.6, material: RUBBER }));
  body.push(box("hopper door", -12.4, 12.4, 22.5, 27.5, ZR - 1.2, ZR + 1.2, mul(GREEN, 0.9), P({ bevel: 1.2, segs: 3 })));
  for (const s of [-1, 1]) {
    body.push(box(`lift bar ${s}`, s * 9 - 0.9, s * 9 + 0.9, 11.4, 27, ZR - 3.0, ZR - 1.8, "#c7ccd3", { bevel: 0.35, material: CHROME }));
    body.push(box(`lift ram ${s}`, s * 12 - 0.7, s * 12 + 0.7, 14, 22, ZR - 2.4, ZR - 1.4, "#e8b822", { bevel: 0.25, material: RUBBER }));
  }
  body.push(box("rear bumper", -13.6, 13.6, 4.8, 8.2, ZR - 2.6, ZR + 1, "#3a3e49", { bevel: 0.8, material: CHROME }));
  for (let k = 0; k < 6; k++) body.push(box("hazard", -13 + k * 4.4, -10 + k * 4.4, 8.3, 9.2, ZR - 1.5, ZR - 0.6, k % 2 ? "#e8b822" : "#17181d", { material: RUBBER }));
  for (const l of lamps({ front: ZF + 0.2, rear: ZR - 2.9, hw: HW, hy: 12, ty: 10.5 })) body.push(l);
  return { body: body.concat(arches([15.3, -15.3], HW)), track: 11.7, tail: { z: r2(ZR / 16), y: r2(10.5 / 16), x: r2((HW - 3.2) / 16) } };
}

// ---- build ---------------------------------------------------------------------------------------------------------------------------
function finish(parts) { // glow keeps its glow, the rest gets a material
  for (const p of parts) for (const c of p.cubes) {
    if (c.emissive) { c.metallic = 0; c.roughness = 0.2; }
    else if (c.metallic === undefined) Object.assign(c, { metallic: 0.2, roughness: 0.5 });
  }
  return parts;
}
function build(spec) {
  const parts = [{ name: "body", origin: [0, PIV, 0], rotation: [0, 0, 0], cubes: spec.body, children: [] },
    wheel("wheel_fl", -1, 15.3, spec.track), wheel("wheel_fr", 1, 15.3, spec.track), wheel("wheel_rl", -1, -15.3, spec.track), wheel("wheel_rr", 1, -15.3, spec.track)];
  return { version: 1, scale: 0.0625, parts: finish(parts) };
}

const TRUCKS = { firetruck, garbage_truck: garbage };
const want = process.argv.slice(2);
await withServer(async (nova) => {
  for (const [name, make] of Object.entries(TRUCKS)) {
    if (want.length && !want.includes(name)) continue;
    const spec = make();
    await nova.call("model_write", { name, model: build(spec) });
    console.log("wrote", name, `TAIL ${name} = { z = ${spec.tail.z}, y = ${spec.tail.y}, x = ${spec.tail.x} }`);
  }
});
