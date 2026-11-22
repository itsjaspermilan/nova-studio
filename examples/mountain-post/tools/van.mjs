// The post van: a small high-roofed delivery van, cream with a red stripe, round headlights, a roof rack, slightly toy-like
// proportions (big round wheels, a short nose, a tall box). Low-poly with softened edges, like everything else in Fernhollow.
// Its four wheels are parts named wheel_fl, wheel_fr, wheel_rl, wheel_rr at their axles (entities/van.lua finds them with
// nova.model_pose and hangs each on a spring), and the rear doors are parts too (door_l, door_r) so they can swing open.
// FERNHOLLOW POST is painted on by the game (image_make lettering, entities/van.lua), not modelled.
import { bevelled, box, cyl, model, part, shade } from "./geo.mjs";
import { tool } from "./lib.mjs";

const CREAM = "#f1e6c8", RED = "#c8402f", DARK = "#2a2b30", GLASS = "#4b6a7c", CHROME = "#d4d6d8", TRIM = "#6d6a64", TYRE = "#232327";
const L = 3.9, W = 1.72, H = 2.08; // length, width, height (metres)
const R = 0.33, AX = 1.28, TR = 0.74; // wheel radius, axle from the middle, wheel from the centre line

const body = [];
const z0 = -L / 2, z1 = L / 2;
// the lower body: a full-length box above the arches, sills between them, the nose and tail below the arch line
body.push(bevelled([0, 0.94, -0.05], [W, 0.62, L - 0.1], CREAM, { bevel: 0.07 }));
body.push(bevelled([0, 0.5, 0], [W - 0.04, 0.32, 2 * AX - 2 * R - 0.12], CREAM, { bevel: 0.05 }));
body.push(bevelled([0, 0.52, z1 - 0.28], [W - 0.06, 0.36, 0.5], CREAM, { bevel: 0.06 }));
body.push(bevelled([0, 0.52, z0 + 0.25], [W - 0.06, 0.36, 0.42], CREAM, { bevel: 0.06 }));
// the box behind the cab: tall, its top a little narrower
body.push(bevelled([0, 1.66, -0.52], [W - 0.02, 0.86, L - 1.1], CREAM, { bevel: 0.09, taper: 0.96 }));
// the cab: the windscreen leans back from a short bonnet up to the roof
const cabZ = 0.95;
body.push(bevelled([0, 1.5, cabZ], [W - 0.06, 0.56, 0.42], CREAM, { bevel: 0.06, taper: 0.96, taperZ: 0.55 }));
body.push(bevelled([0, 1.86, cabZ - 0.1], [W - 0.08, 0.36, 0.3], CREAM, { bevel: 0.05, taper: 0.97 }));
// a rounded bonnet
body.push(bevelled([0, 1.28, z1 - 0.42], [W - 0.12, 0.12, 0.62], shade(CREAM, -0.04), { bevel: 0.05, taper: 0.92 }));
// the red stripe all round, and the roof's cream lip
body.push(box([0, 0.86, -0.05], [W + 0.012, 0.13, L - 0.06], RED));
// glass: the windscreen (leaning), the cab's side windows; the box has none (it is a delivery van)
body.push(box([0, 1.58, cabZ + 0.21], [W - 0.32, 0.5, 0.04], GLASS, { rot: [-26, 0, 0] }));
for (const s of [1, -1]) {
  body.push(box([s * (W / 2 - 0.01), 1.6, cabZ - 0.02], [0.03, 0.46, 0.5], GLASS));
  // a door line and a handle
  body.push(box([s * (W / 2 + 0.004), 1.0, cabZ - 0.32], [0.008, 0.85, 0.02], shade(CREAM, -0.18)));
  body.push(box([s * (W / 2 + 0.012), 1.14, cabZ - 0.18], [0.02, 0.04, 0.12], TRIM));
  // a mirror on a stalk
  body.push(box([s * (W / 2 + 0.1), 1.62, cabZ + 0.12], [0.06, 0.2, 0.13], DARK));
  body.push(box([s * (W / 2 + 0.04), 1.55, cabZ + 0.1], [0.1, 0.03, 0.03], DARK));
  // round headlights with a chrome ring, an indicator
  body.push(cyl([s * 0.56, 0.98, z1 - 0.03], 0.15, 0.05, CHROME, { axis: "z", segments: 14 }));
  body.push(cyl([s * 0.56, 0.98, z1 - 0.0], 0.12, 0.05, "#fbf3d2", { axis: "z", segments: 14, emissive: 0.35 }));
  body.push(box([s * 0.78, 0.74, z1 - 0.04], [0.08, 0.06, 0.04], "#f0a33a", { emissive: 0.2 }));
  // tail lamps
  body.push(box([s * 0.62, 0.62, z0 - 0.02], [0.2, 0.12, 0.05], "#b5241c", { emissive: 0.25 }));
  // dark wheel arches (the inside of each opening)
  for (const az of [AX, -AX]) body.push(cyl([s * (W / 2 - 0.12), R + 0.02, az], R + 0.07, 0.22, "#3a3833", { axis: "x", segments: 14 }));
}
// a grille between the lamps, bumpers, a number plate
body.push(bevelled([0, 0.86, z1 - 0.02], [0.62, 0.26, 0.06], DARK, { bevel: 0.03 }));
for (let i = 0; i < 4; i++) body.push(box([0, 0.77 + i * 0.06, z1 + 0.012], [0.56, 0.018, 0.02], "#4d4f55"));
body.push(bevelled([0, 0.45, z1 + 0.03], [W - 0.02, 0.15, 0.14], TRIM, { bevel: 0.04 }));
body.push(bevelled([0, 0.45, z0 - 0.03], [W - 0.02, 0.15, 0.14], TRIM, { bevel: 0.04 }));
body.push(box([0, 0.6, z1 + 0.035], [0.4, 0.11, 0.02], "#efeee6"));
// the roof rack: two rails on feet and four cross bars
for (const s of [1, -1]) {
  body.push(box([s * 0.66, H + 0.06, -0.55], [0.05, 0.05, 2.5], DARK));
  for (const fz of [-1.7, -0.55, 0.62]) body.push(box([s * 0.66, H + 0.0, fz], [0.06, 0.1, 0.06], DARK));
}
for (const fz of [-1.6, -1.0, -0.2, 0.5]) body.push(box([0, H + 0.08, fz], [1.32, 0.035, 0.05], DARK));
// under the van: a dark floor so nothing shows through from a low view
body.push(box([0, 0.36, 0], [W - 0.25, 0.08, L - 0.5], "#1e1e22"));

// the wheels: a fat tyre and a cream hub with a chrome cap
const wheel = (name, x, z) => {
  const s = Math.sign(x);
  return part(name, [x, R, z], [
    cyl([0, 0, 0], R, 0.24, TYRE, { axis: "x", segments: 16 }),
    cyl([s * 0.05, 0, 0], R * 0.6, 0.16, CREAM, { axis: "x", segments: 14 }),
    cyl([s * 0.1, 0, 0], R * 0.25, 0.08, CHROME, { axis: "x", segments: 10 }),
    box([s * 0.11, 0, 0], [0.04, R * 0.9, 0.05], shade(CREAM, -0.2)),
  ]);
};
// the rear doors, hinged at the back corners
const door = (name, s) => part(name, [s * (W / 2 - 0.02), 1.36, z0 + 0.0], [
  box([-s * 0.42, 0, -0.035], [0.82, 1.3, 0.06], CREAM),
  box([-s * 0.42, -0.5, -0.07], [0.83, 0.13, 0.02], RED),
  box([-s * 0.42, 0.42, -0.07], [0.6, 0.34, 0.02], GLASS),
  box([-s * 0.76, -0.05, -0.08], [0.04, 0.12, 0.03], TRIM),
]);
const van = model([
  part("body", [0, 0, 0], body),
  wheel("wheel_fl", TR, AX), wheel("wheel_fr", -TR, AX), wheel("wheel_rl", TR, -AX), wheel("wheel_rr", -TR, -AX),
  door("door_l", 1), door("door_r", -1),
], { boxes: [{ x: 0, z: 0, hw: W / 2, hl: L / 2, turn: 0 }] });

tool("model_write", { name: "van", model: van });
tool("model_preview", { name: "van", yaw: 35, pitch: 14, image_out: "build/look/van.png" });
tool("model_preview", { name: "van", yaw: 200, pitch: 10, image_out: "build/look/van-back.png" });
