// The post van: a small stubby TOY of a boxy mail truck (the owner's reference, 2026-11-22: "too large and realistic. We need to
// have some style"), sized for villagers about a metre tall. A tall square body with softly rounded edges, a very short sloping
// nose, a big upright windscreen, big cab windows, a flat back with two doors, small wheels tucked under it in real hollow arches,
// one red stripe along each side. Cream; FERNHOLLOW POST is painted on by the game (image_make lettering, entities/van.lua). No
// real service's marks, no maker's badge. The look is the game's one rule (tools/palette.mjs).
//
// Parts: `body` (the shell; its children `door_l` and `door_r`, hinged at the back corners, so they move with every lean, roll,
// pitch and turn of the body), and the four wheels `wheel_fl`, `wheel_fr`, `wheel_rl`, `wheel_rr` at their axles (entities/van.lua
// hangs each on a spring). Each wheel turns inside a hollow well cut into the body (a cut-out with a rolled-in lip, lined dark).
import { bevelled, cyl, mesh, model, part } from "./geo.mjs";
import { tool } from "./lib.mjs";
import { PAL } from "./palette.mjs";

const U = 16, u = (v) => Math.round(v * U * 1000) / 1000;
const CREAM = PAL.cream, RED = PAL.red, INK = PAL.ink, GLASS = PAL.glass, TRIM = PAL.metal, TYRE = PAL.tyre, LAMP = "#fff1c8";
// sizes (metres)
export const W = 1.62, HW = W / 2;
export const R = 0.28;                    // wheel radius
export const AXF = 0.92, AXR = -0.88;     // front and rear axle (from the middle, along +z)
export const TR = 0.6;                    // a wheel's middle from the centre line
export const Z0 = -1.42, Z1 = 1.5;        // the flat back, the nose
const SILL = 0.3, ROOF = 1.92;
const ARCH = 0.37;                        // the wells' radius (round the wheel, with room to bob on its spring)

// the side outline (z, y): the flat back, a flat roof whose front edge rounds into a big upright windscreen, a short sloping nose
const outline = [[Z0, SILL], [Z0, ROOF], [0.52, ROOF], [0.66, 1.84], [0.86, 1.14], [1.36, 0.98], [Z1, 0.86], [Z1, SILL]];
const verts = [], faces = [];
for (const s of [1, -1]) for (const [z, y] of outline) verts.push([s * (y > 1.4 ? HW - 0.03 : HW), y, z]);
const n = outline.length;
faces.push([...Array(n).keys()]);
faces.push([...Array(n).keys()].map((i) => n + i).reverse());
for (let i = 0; i < n; i++) faces.push([i, (i + 1) % n, n + ((i + 1) % n), n + i]);

// the cuts, all pressed into the one shell: the wheel wells (taken away, a rolled-in lip), the windows (glass, a little sunk), the
// stripe (flush paint), the lamps and the air intake on the nose, the cargo opening behind the doors
const arch = (az) => {
  const pts = [[az - ARCH, SILL - 0.1]];
  for (let i = 0; i <= 10; i++) { const a = Math.PI * (1 - i / 10); pts.push([az + Math.cos(a) * ARCH, SILL + 0.06 + Math.sin(a) * ARCH]); }
  pts.push([az + ARCH, SILL - 0.1]);
  return pts.map(([z, y]) => [u(z), u(y)]);
};
const rr = (x0, y0, x1, y1, r = 0.08, k = 3) => { // a rounded rectangle's outline (a, b) in metres -> model units
  const pts = [];
  const corner = (cx, cy, a0) => { for (let i = 0; i <= k; i++) { const a = a0 + (Math.PI / 2) * (i / k); pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } };
  corner(x1 - r, y0 + r, -Math.PI / 2); corner(x1 - r, y1 - r, 0); corner(x0 + r, y1 - r, Math.PI / 2); corner(x0 + r, y0 + r, Math.PI);
  return pts.map(([a, b]) => [u(a), u(b)]);
};
const circle = (cx, cy, r, k = 14) => [...Array(k).keys()].map((i) => [u(cx + Math.cos((i / k) * 2 * Math.PI) * r), u(cy + Math.sin((i / k) * 2 * Math.PI) * r)]);
const cuts = [
  { view: "side", points: arch(AXF), remove: true, depth: u(0.13), wall: INK },
  { view: "side", points: arch(AXR), remove: true, depth: u(0.13), wall: INK },
  // the big cab window, its front edge leaning with the windscreen (the box behind it is a plain panel for the lettering)
  { view: "side", points: [[0.06, 1.14], [0.82, 1.14], [0.64, 1.78], [0.06, 1.78]].map(([z, y]) => [u(z), u(y)]), color: GLASS, depth: u(0.025), glass: 0.6 },
  // the red stripe, one band from the back to the nose
  { view: "side", points: rr(Z0 - 0.1, 0.8, Z1 + 0.1, 0.96, 0.001, 1), color: RED },
  // the windscreen: big and upright
  { view: "front", points: rr(-HW + 0.13, 1.2, HW - 0.13, 1.8, 0.09), color: GLASS, depth: u(0.025), glass: 0.6 },
  // round toy headlamps and a plain air intake (no grille design), a plate
  { view: "front", points: circle(0.5, 0.62, 0.12), mirror: true, color: LAMP, depth: u(0.02), emissive: 0.35 },
  { view: "front", points: rr(-0.3, 0.5, 0.3, 0.72, 0.06), color: INK, depth: u(0.03) },
  // the cargo opening behind the doors (seen when they swing open) and the tall tail lamps either side of it
  { view: "back", points: rr(-0.64, 0.42, 0.64, 1.78, 0.06), color: INK, depth: u(0.05) },
  { view: "back", points: rr(0.69, 0.66, 0.78, 1.08, 0.04), mirror: true, color: "#c23b2c", depth: u(0.015), emissive: 0.3 },
];
const body = [mesh(verts, faces, CREAM, { modifiers: [{ type: "bevel", width: u(0.13), segments: 3, angle: 30 }, { type: "cutout", cuts }] })];

// the wells' lining: a dark box round each axle with its faces turned inwards (seen through the arch, never from outside), so the
// well reads hollow and the wheel turns inside it
const liner = (az) => {
  const x = HW - 0.06, y0 = SILL - 0.04, y1 = SILL + 0.06 + ARCH + 0.02, z0 = az - ARCH - 0.02, z1 = az + ARCH + 0.02;
  const out = [];
  // one face per side, each turned to look away from a point outside it (that is: into the box)
  const face = (pts, away) => out.push(mesh(pts, [[0, 1, 2, 3]], INK, { inside: away }));
  face([[-x, y1, z0], [x, y1, z0], [x, y1, z1], [-x, y1, z1]], [0, y1 + 5, az]); // the ceiling
  face([[-x, y0, z0], [x, y0, z0], [x, y1, z0], [-x, y1, z0]], [0, (y0 + y1) / 2, z0 - 5]); // the back wall
  face([[-x, y0, z1], [x, y0, z1], [x, y1, z1], [-x, y1, z1]], [0, (y0 + y1) / 2, z1 + 5]); // the front wall
  face([[0.3, y0, z0], [0.3, y1, z0], [0.3, y1, z1], [0.3, y0, z1]], [-5, (y0 + y1) / 2, az]); // the inner walls, behind each wheel
  face([[-0.3, y0, z0], [-0.3, y1, z0], [-0.3, y1, z1], [-0.3, y0, z1]], [5, (y0 + y1) / 2, az]);
  return out;
};
body.push(...liner(AXF), ...liner(AXR));
// chunky rounded bumpers, soft grey; a mirror on a stub each side
body.push(bevelled([0, 0.36, Z1 + 0.06], [W + 0.04, 0.2, 0.2], TRIM, { bevel: 0.07, segments: 2 }));
body.push(bevelled([0, 0.36, Z0 - 0.06], [W + 0.04, 0.2, 0.2], TRIM, { bevel: 0.07, segments: 2 }));
for (const s of [1, -1]) {
  body.push(bevelled([s * (HW + 0.1), 1.42, 0.86], [0.08, 0.26, 0.16], INK, { bevel: 0.035, segments: 2 }));
  body.push(bevelled([s * (HW + 0.04), 1.4, 0.86], [0.1, 0.05, 0.05], INK, { bevel: 0.015 }));
}

// the wheels: a fat tyre with round shoulders (a profile spun about x), a cream hub with four dark bolts so the turning shows
const wheel = (name, x, z) => {
  const s = Math.sign(x), hw = 0.115;
  const profile = [[-hw, 0.14], [-hw, R - 0.05], [-hw + 0.03, R - 0.01], [-hw + 0.06, R], [hw - 0.06, R], [hw - 0.03, R - 0.01], [hw, R - 0.05], [hw, 0.14]];
  const tyre = mesh(profile.map(([px, r]) => [px, r, 0]), [[...profile.keys()]], TYRE, { keep: true, modifiers: [{ type: "revolve", axis: "x", segments: 20, sharp: 60 }] });
  const cubes = [tyre, cyl([s * 0.005, 0, 0], 0.16, hw * 2 - 0.02, PAL.cream, { axis: "x", segments: 16 }), cyl([s * (hw - 0.01), 0, 0], 0.055, 0.04, TRIM, { axis: "x", segments: 10 })];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    cubes.push(cyl([s * (hw + 0.002), Math.sin(a) * 0.105, Math.cos(a) * 0.105], 0.024, 0.03, INK, { axis: "x", segments: 6 }));
  }
  return part(name, [x, R, z], cubes);
};
// the two rear doors, hinged at the back corners (children of the body, so they ride with it), each a soft panel with a window and
// the stripe across it, and a handle
const DW = 0.64, DH = 1.36, DY = 1.1;
const door = (name, s) => part(name, [s * 0.65, DY, Z0 - 0.02], [
  bevelled([-s * DW / 2, 0, -0.035], [DW, DH, 0.07], CREAM, { bevel: 0.03, segments: 2 }),
  bevelled([-s * DW / 2, -0.22, -0.072], [DW - 0.02, 0.15, 0.012], RED, { bevel: 0.004 }),
  bevelled([-s * DW / 2, 0.36, -0.072], [DW - 0.2, 0.34, 0.012], GLASS, { bevel: 0.05 }),
  bevelled([-s * (DW - 0.07), 0.0, -0.085], [0.05, 0.16, 0.04], INK, { bevel: 0.015 }),
]);
const van = model([
  part("body", [0, 0, 0], body, [door("door_l", 1), door("door_r", -1)]),
  wheel("wheel_fl", TR, AXF), wheel("wheel_fr", -TR, AXF), wheel("wheel_rl", TR, AXR), wheel("wheel_rr", -TR, AXR),
], { boxes: [{ x: 0, z: (Z0 + Z1) / 2, hw: HW + 0.04, hl: (Z1 - Z0) / 2 + 0.06, turn: 0 }] });

if (import.meta.url === `file://${process.argv[1]}`) {
  tool("model_write", { name: "van", model: van });
  tool("model_preview", { name: "van", yaw: 35, pitch: 12, image_out: "build/look/van.png" });
  tool("model_preview", { name: "van", yaw: 210, pitch: 10, image_out: "build/look/van-back.png" });
  tool("model_preview", { name: "van", yaw: 90, pitch: 0, image_out: "build/look/van-side.png" });
}
