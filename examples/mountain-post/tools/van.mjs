// The post van: the silhouette of a modern high-roof panel van, kept simple and a little cute by proportion (slightly short and tall,
// slightly big wheels): one tall smooth body with softly rounded edges, a short sloping bonnet flowing into a big raked windscreen,
// flat clean sides with a sliding-door line and one cab window each side, two tall rear doors with small windows, small wheels in
// plain arches, round-cornered lamps. Cream with a red stripe; FERNHOLLOW POST is painted on by the game (image_make lettering,
// entities/van.lua). No maker's badge, no grille design. The four wheels are parts wheel_fl, wheel_fr, wheel_rl, wheel_rr at their
// axles (entities/van.lua hangs each on a spring), and the rear doors are parts door_l and door_r, hinged at the back corners.
import { bevelled, box, cyl, mesh, model, part, shade } from "./geo.mjs";
import { tool } from "./lib.mjs";

const CREAM = "#f2e8cc", RED = "#c8402f", DARK = "#2a2b30", GLASS = "#3f5d70", TRIM = "#6d6a64", TYRE = "#232327", LAMP = "#fbf3d2";
const W = 1.82, HW = W / 2; // width
const R = 0.34, AX = 1.32, TR = 0.76; // wheel radius, axle from the middle, wheel from the centre line
const Z0 = -2.1, Z1 = 2.12; // tail, nose

// the body's side outline (z, y), tail to nose over the roof: a tall box, the roof's front edge rounding into the raked windscreen,
// a short sloping bonnet, a rounded nose
const outline = [
  [Z0, 0.42], [Z0, 2.04], [Z0 + 0.12, 2.17], [0.78, 2.19], [1.02, 2.13], [1.6, 1.36], [1.95, 1.18], [Z1, 1.02], [Z1 + 0.03, 0.62], [Z1 - 0.05, 0.42],
];
// extruded across the van, the upper half a touch narrower (a slight tumblehome), with a bevel for the soft edges
const verts = [], faces = [];
for (const s of [1, -1]) for (const [z, y] of outline) verts.push([s * (y > 1.3 ? HW - 0.04 : HW), y, z]);
const n = outline.length;
faces.push([...Array(n).keys()]);
faces.push([...Array(n).keys()].map((i) => n + i).reverse());
for (let i = 0; i < n; i++) faces.push([i, (i + 1) % n, n + ((i + 1) % n), n + i]);
const body = [mesh(verts, faces, CREAM, { modifiers: [{ type: "bevel", width: 1.6, segments: 2, angle: 30 }] })];

// the windscreen: a big raked pane, inset from the edges; the cab's side windows following its slope
const ws = (t, x) => { const a = outline[4], b = outline[5]; return [x, a[1] + (b[1] - a[1]) * t, a[0] + (b[0] - a[0]) * t]; };
const wn = [0, 0.8, 0.6]; // (its outward normal, roughly)
const off = (p, d) => [p[0], p[1] + wn[1] * d, p[2] + wn[2] * d];
body.push(mesh([off(ws(0.08, HW - 0.16), 0.02), off(ws(0.08, -HW + 0.16), 0.02), off(ws(0.94, -HW + 0.12), 0.02), off(ws(0.94, HW - 0.12), 0.02),
  off(ws(0.08, HW - 0.16), -0.01), off(ws(0.08, -HW + 0.16), -0.01), off(ws(0.94, -HW + 0.12), -0.01), off(ws(0.94, HW - 0.12), -0.01)],
[[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]], GLASS));
for (const s of [1, -1]) {
  const x = s * (HW - 0.035);
  // one cab window each side: its front edge leans with the windscreen
  body.push(mesh([[x, 1.36, 0.62], [x, 1.98, 0.62], [x, 1.98, 0.92], [x, 1.36, 1.5], [x + s * 0.03, 1.36, 0.62], [x + s * 0.03, 1.98, 0.62], [x + s * 0.03, 1.98, 0.92], [x + s * 0.03, 1.36, 1.5]],
    [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]], GLASS));
  // the sliding door's line (a thin dark frame on the flat side) and its handle; the cab door's line
  const sx = s * (HW + 0.004);
  for (const [z, y, w, h] of [[-0.55, 1.2, 0.02, 1.5], [0.42, 1.2, 0.02, 1.5], [-0.065, 1.95, 0.99, 0.02], [-0.065, 0.46, 0.99, 0.02], [1.55, 0.95, 0.02, 1.0]]) body.push(box([sx, y, z], [0.012, h, w], shade(CREAM, -0.22)));
  body.push(box([s * (HW + 0.012), 1.12, 0.3], [0.02, 0.05, 0.16], TRIM));
  // the red stripe along the side, under the windows, round the nose's corner
  body.push(box([s * (HW + 0.006), 0.92, -0.02], [0.012, 0.13, Z1 - Z0 - 0.3], RED));
  // a small mirror
  body.push(bevelled([s * (HW + 0.1), 1.5, 1.42], [0.07, 0.2, 0.13], DARK, { bevel: 0.025 }));
  // plain dark arches round the wheels
  for (const az of [AX, -AX]) body.push(cyl([s * (HW - 0.1), R + 0.02, az], R + 0.08, 0.22, "#3a3833", { axis: "x", segments: 16 }));
  // round-cornered lamps: the headlamp wrapping the nose's corner, a tall tail lamp on each rear corner, an indicator
  body.push(bevelled([s * 0.6, 1.0, Z1 - 0.02], [0.4, 0.2, 0.08], LAMP, { bevel: 0.05, emissive: 0.4 }));
  body.push(bevelled([s * 0.79, 0.84, Z0 - 0.0], [0.14, 0.42, 0.06], "#b5241c", { bevel: 0.04, emissive: 0.25 }));
  body.push(bevelled([s * 0.84, 0.86, Z1 - 0.12], [0.06, 0.08, 0.16], "#f0a33a", { bevel: 0.02, emissive: 0.2 }));
}
// the nose: a plain dark band for the air (no grille design) and a number plate; bumpers in soft grey
body.push(bevelled([0, 0.72, Z1 + 0.01], [1.1, 0.14, 0.06], DARK, { bevel: 0.04 }));
body.push(box([0, 0.55, Z1 + 0.06], [0.42, 0.11, 0.02], "#efeee6"));
body.push(bevelled([0, 0.47, Z1 + 0.04], [W - 0.02, 0.16, 0.14], TRIM, { bevel: 0.05 }));
body.push(bevelled([0, 0.47, Z0 - 0.04], [W - 0.02, 0.16, 0.14], TRIM, { bevel: 0.05 }));
body.push(box([0, 0.38, 0], [W - 0.3, 0.08, Z1 - Z0 - 0.5], "#1e1e22")); // (underneath, so a low view shows nothing through)

// the wheels: a fat tyre, a plain hub
const wheel = (name, x, z) => {
  const s = Math.sign(x);
  return part(name, [x, R, z], [
    cyl([0, 0, 0], R, 0.25, TYRE, { axis: "x", segments: 18 }),
    cyl([s * 0.06, 0, 0], R * 0.55, 0.15, "#d9d4c4", { axis: "x", segments: 14 }),
    cyl([s * 0.1, 0, 0], R * 0.2, 0.08, "#a9abb0", { axis: "x", segments: 10 }),
  ]);
};
// the two tall rear doors, hinged at the back corners, each with a small window and the stripe across it
const door = (name, s) => part(name, [s * (HW - 0.03), 1.25, Z0], [
  box([-s * 0.43, 0, -0.03], [0.86, 1.56, 0.05], CREAM),
  box([-s * 0.43, -0.33, -0.06], [0.87, 0.13, 0.02], RED),
  bevelled([-s * 0.43, 0.48, -0.06], [0.56, 0.36, 0.02], GLASS, { bevel: 0.03 }),
  box([-s * 0.8, 0.02, -0.07], [0.04, 0.14, 0.03], TRIM),
]);
const van = model([
  part("body", [0, 0, 0], body),
  wheel("wheel_fl", TR, AX), wheel("wheel_fr", -TR, AX), wheel("wheel_rl", TR, -AX), wheel("wheel_rr", -TR, -AX),
  door("door_l", 1), door("door_r", -1),
], { boxes: [{ x: 0, z: 0, hw: HW, hl: (Z1 - Z0) / 2, turn: 0 }] });

tool("model_write", { name: "van", model: van });
tool("model_preview", { name: "van", yaw: 35, pitch: 12, image_out: "build/look/van.png" });
tool("model_preview", { name: "van", yaw: 210, pitch: 10, image_out: "build/look/van-back.png" });
tool("model_preview", { name: "van", yaw: 90, pitch: 0, image_out: "build/look/van-side.png" });
