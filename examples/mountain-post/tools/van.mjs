// The post van: a stubby TOY of the classic boxy mail delivery truck the owner sent pictures of (2026-11-22, second notes: "Let's
// shorten it and add that slope at the back that the reference image has. Also the windows look really weird." "The player should
// be visible through the windows of the truck also. We can also make the truck have no doors."). Our own design in the game's one
// look (tools/palette.mjs), no real service's marks: a tall square box over the rear two thirds whose front is the cab; a big
// UPRIGHT windscreen in a frame; in front of it a short low bonnet sloping to a blunt nose (a small grille, two small square lamps)
// well below the windscreen (the step); chunky dark bumpers; small dark steel wheels with a small hub in round hollow wells; behind
// the rear wheel the underside sweeps UP to the rear bumper and the back leans in towards the roof, which has a rounded lip all
// round. Two-tone: cream above, sand below, one red band between that sweeps down along the bonnet. FERNHOLLOW POST is painted on
// by the game (image_make lettering, entities/van.lua). 2.4 m long (2.5 with the bumpers), 1.48 wide, 2.0 high: next to a villager
// a metre tall it reads cute and stubby.
//
// The cab is OPEN-SIDED: no side doors, a tall rounded doorway each side, a seat and a steering wheel inside (the postmaster sits
// there while driving: entities/postmaster.lua). The doorways and the windscreen are real openings into a lined cab, and the two rear
// doors have open windows into the lined cargo hold, whose front wall (behind the seat) has a window too: from the chase camera
// behind, the driver's head shows through the back windows.
//
// Parts: `body` (the shell; its children `door_l` and `door_r`, hinged at the back corners and leaning with the back, so they move
// with every lean, roll, pitch and turn of the body; `steering`, the wheel, which turns about its column) and the four wheels `wheel_fl`, `wheel_fr`,
// `wheel_rl`, `wheel_rr` at their axles (entities/van.lua hangs each on a spring).
import { bevelled, cyl, mesh, model, part, shade, tube } from "./geo.mjs";
import { tool } from "./lib.mjs";
import { PAL } from "./palette.mjs";

const U = 16, u = (v) => Math.round(v * U * 1000) / 1000;
const CREAM = PAL.cream, LOWER = shade(PAL.cream, -0.13), RED = PAL.red, INK = PAL.ink, TYRE = PAL.tyre, LAMP = "#fff1c8";
const DARK = shade(PAL.ink, 0.08);       // the bumpers: chunky, dark
const STEEL = "#57524d";                  // plain dark steel wheels
const FRAME = shade(PAL.ink, 0.22);       // the rubber round the windscreen and the doorways
const INSIDE = shade(PAL.cream, -0.22), FLOOR = shade(PAL.ink, 0.15), DASH = PAL.woodDark, SEAT_C = PAL.redDark, HOLD = PAL.woodLight;
// sizes (metres)
export const W = 1.48, HW = W / 2;
export const R = 0.26;                    // wheel radius
export const AXF = 0.82, AXR = -0.5;      // front and rear axle (from the middle, along +z): the front under the cab, the rear a bit forward of the back
export const TR = 0.56;                   // a wheel's middle from the centre line
export const Z0 = -1.13, Z1 = 1.27;       // the back (at the bottom of its lean), the nose
const SILL = 0.28, ROOF = 1.96;
const RB = 0.72, RT = Z0 + 0.16;           // the back: its foot (high: the underside sweeps up to it) and its top, leaning 16 cm in
const ARCH = 0.34;                        // the wells' radius (round the wheel, with room to bob on its spring)
// the cab: a doorway each side, the seat on the left (+x: the van's own left, the driver's side), the windscreen
export const DOORWAY = { z0: 0.02, z1: 0.56, y0: 0.52, y1: 1.74 };
export const SEAT = { x: 0.3, z: 0.24, y: 0.68 };   // the cushion's top; where the driver sits
export const STEER = { x: 0.3, y: 0.96, z: 0.47, tilt: -58 };

// The shell is two soft extrusions of convex side outlines (z, y), so every cut-out presses onto convex faces: the tall BOX (the back
// leaning in to the roof, the flat roof, the upright windscreen carried straight down to the sill, the flat underside, and behind
// the rear wheel the sweep up to the back) and the low short BONNET stuck on its front (sloping to the blunt nose), a hair narrower,
// so the step from the windscreen to the bonnet is a soft crease
const extrude = (outline, hw) => {
  const verts = [], faces = [], n = outline.length;
  for (const s of [1, -1]) for (const [z, y] of outline) verts.push([s * hw, y, z]);
  faces.push([...Array(n).keys()], [...Array(n).keys()].map((i) => n + i));
  for (let i = 0; i < n; i++) faces.push([i, (i + 1) % n, n + ((i + 1) % n), n + i]);
  return { verts, faces };
};
const BOX = extrude([[Z0, RB], [RT, ROOF], [0.58, ROOF], [0.7, 1.86], [0.85, SILL], [-0.84, SILL], [-1.02, 0.44]], HW);
const NOSE = extrude([[0.6, SILL], [0.6, 1.05], [0.86, 1.04], [1.14, 0.94], [1.25, 0.84], [Z1, 0.34], [1.2, SILL]], HW - 0.03);

const arch = (az) => {
  const pts = [[az - ARCH, SILL - 0.1]];
  for (let i = 0; i <= 12; i++) { const a = Math.PI * (1 - i / 12); pts.push([az + Math.cos(a) * ARCH, SILL + 0.06 + Math.sin(a) * ARCH]); }
  pts.push([az + ARCH, SILL - 0.1]);
  return pts.map(([z, y]) => [u(z), u(y)]);
};
const rr = (x0, y0, x1, y1, r = 0.08, k = 4) => { // a rounded rectangle's outline (a, b) in metres -> model units
  const pts = [];
  const corner = (cx, cy, a0) => { for (let i = 0; i <= k; i++) { const a = a0 + (Math.PI / 2) * (i / k); pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } };
  corner(x1 - r, y0 + r, -Math.PI / 2); corner(x1 - r, y1 - r, 0); corner(x0 + r, y1 - r, Math.PI / 2); corner(x0 + r, y0 + r, Math.PI);
  return pts.map(([a, b]) => [u(a), u(b)]);
};
const poly = (pts) => pts.map(([a, b]) => [u(a), u(b)]);
// the windscreen's opening (front view, x and y) and its frame
const WS = { x: HW - 0.15, y0: 1.18, y1: 1.79 };
const D = DOORWAY;
const tones = [
  // two tones: sand below the band, cream above; the red band sweeps down along the bonnet to the nose
  { view: "side", points: poly([[Z0 - 0.2, 0], [1.4, 0], [1.4, 0.6], [0.62, 0.8], [Z0 - 0.2, 0.8]]), color: LOWER },
  { view: "side", points: poly([[Z0 - 0.2, 0.8], [0.62, 0.8], [1.4, 0.6], [1.4, 0.74], [0.66, 0.95], [Z0 - 0.2, 0.95]]), color: RED },
  { view: "front", points: rr(-HW - 0.2, 0, HW + 0.2, 0.6, 0.001, 1), color: LOWER },
  { view: "front", points: rr(-HW - 0.2, 0.6, HW + 0.2, 0.74, 0.001, 1), color: RED },
  { view: "back", points: rr(-HW - 0.2, 0, HW + 0.2, 0.8, 0.001, 1), color: LOWER },
  // the wheel wells (taken away, a rolled-in dark lip)
  { view: "side", points: arch(AXF), remove: true, depth: u(0.12), wall: INK },
];
export const cuts = [
  ...tones,
  { view: "side", points: arch(AXR), remove: true, depth: u(0.12), wall: INK },
  // the doorways: a tall rounded opening each side in a dark rubber frame, its edge a lip as thick as the shell
  { view: "side", points: rr(D.z0 - 0.06, D.y0 - 0.06, D.z1 + 0.06, D.y1 + 0.06, 0.19), color: FRAME },
  { view: "side", points: rr(D.z0, D.y0, D.z1, D.y1, 0.14), remove: true, depth: u(0.07), wall: INSIDE },
  // the windscreen: big, upright, nearly flat, in a frame; a real opening (a toy's: no glass to see the driver through)
  { view: "front", points: rr(-WS.x - 0.06, WS.y0 - 0.06, WS.x + 0.06, WS.y1 + 0.06, 0.15), color: FRAME, near: u(0.6) },
  { view: "front", points: rr(-WS.x, WS.y0, WS.x, WS.y1, 0.1), remove: true, depth: u(0.07), wall: INSIDE, near: u(0.6) },
  // the cargo opening behind the rear doors, into the hold, and the tail lamps beside it
  { view: "back", points: rr(-0.55, 0.8, 0.55, 1.84, 0.08), remove: true, depth: u(0.06), wall: INSIDE },
  { view: "back", points: rr(0.6, 0.92, 0.7, 1.18, 0.03), mirror: true, color: "#c23b2c", depth: u(0.015), emissive: 0.3 },
];
export const noseCuts = [
  ...tones,
  // the blunt nose: two small square lamps and a small grille of three slots
  { view: "front", points: rr(0.42, 0.66, 0.6, 0.8, 0.04), mirror: true, color: LAMP, depth: u(0.015), emissive: 0.35 },
  ...[0.44, 0.52, 0.6].map((y) => ({ view: "front", points: rr(-0.2, y, 0.2, y + 0.05, 0.02), color: INK, depth: u(0.02) })),
];
const body = [
  mesh(BOX.verts, BOX.faces, CREAM, { modifiers: [{ type: "bevel", width: u(0.12), segments: 3, angle: 30 }, { type: "cutout", cuts }] }),
  mesh(NOSE.verts, NOSE.faces, CREAM, { modifiers: [{ type: "bevel", width: u(0.1), segments: 3, angle: 30 }, { type: "cutout", cuts: noseCuts }] }),
];
// the roof's rounded lip all round, a little proud of the box
body.push(bevelled([0, ROOF - 0.03, (RT - 0.03 + 0.62) / 2], [W + 0.05, 0.08, 0.62 - RT + 0.03], shade(CREAM, -0.05), { bevel: 0.035, segments: 2 }));

// faces turned to look away from a point: a liner seen only from inside
const sheet = (pts, away, color) => mesh(pts, [[0, 1, 2, 3]], color, { inside: away });
// the wells' lining: dark faces turned inwards round each axle, so the well reads hollow and the wheel turns inside it
const liner = (az) => {
  const x = HW - 0.06, y0 = SILL - 0.04, y1 = SILL + 0.06 + ARCH + 0.02, z0 = az - ARCH - 0.02, z1 = az + ARCH + 0.02, xi = TR - 0.15;
  return [
    sheet([[-x, y1, z0], [x, y1, z0], [x, y1, z1], [-x, y1, z1]], [0, y1 + 5, az], INK),
    sheet([[-x, y0, z0], [x, y0, z0], [x, y1, z0], [-x, y1, z0]], [0, (y0 + y1) / 2, z0 - 5], INK),
    sheet([[-x, y0, z1], [x, y0, z1], [x, y1, z1], [-x, y1, z1]], [0, (y0 + y1) / 2, z1 + 5], INK),
    sheet([[xi, y0, z0], [xi, y1, z0], [xi, y1, z1], [xi, y0, z1]], [-5, (y0 + y1) / 2, az], INK),
    sheet([[-xi, y0, z0], [-xi, y1, z0], [-xi, y1, z1], [-xi, y0, z1]], [5, (y0 + y1) / 2, az], INK),
  ];
};
body.push(...liner(AXF), ...liner(AXR));

// the cab inside: a floor, a ceiling, the dash under the windscreen, the wall to the hold behind the seat (with a window), the seat
const IX = HW - 0.05;
body.push(bevelled([0, D.y0 - 0.03, (D.z0 + 0.62) / 2 - 0.02], [2 * IX, 0.06, 0.66], FLOOR, { bevel: 0.02 }));
body.push(bevelled([0, ROOF - 0.13, 0.3], [2 * IX, 0.05, 0.62], INSIDE, { bevel: 0.02 }));
body.push(bevelled([0, 0.8, 0.7], [2 * IX, 0.52, 0.22], DASH, { bevel: 0.06, segments: 2 }));
body.push(bevelled([0, 1.0, 0.64], [2 * IX - 0.1, 0.12, 0.14], shade(DASH, 0.15), { bevel: 0.05, segments: 2 })); // the dash's rounded top
// the wall behind the seat, round a window that looks into the hold (and from the back windows, through to the cab)
const BW = { x: 0.5, y0: 1.1, y1: 1.64 }, bz = -0.03, bt = 0.05;
body.push(bevelled([0, (D.y0 - 0.06 + BW.y0) / 2, bz], [2 * IX, BW.y0 - D.y0 + 0.06, bt], INSIDE, { bevel: 0.02 }));
body.push(bevelled([0, (BW.y1 + ROOF - 0.1) / 2, bz], [2 * IX, ROOF - 0.1 - BW.y1, bt], INSIDE, { bevel: 0.02 }));
// (the cab sides round the doorways, seen from inside: the pillars before and behind them, the strip over them)
for (const s of [1, -1]) for (const [z0, z1, y0, y1] of [[D.z1 - 0.04, 0.8, D.y0 - 0.05, ROOF - 0.1], [bz, D.z0 + 0.04, D.y0 - 0.05, ROOF - 0.1], [D.z0, D.z1, D.y1 - 0.06, ROOF - 0.1]]) {
  const x = s * (IX - 0.01);
  body.push(sheet([[x, y0, z0], [x, y1, z0], [x, y1, z1], [x, y0, z1]], [s * (IX + 5), (y0 + y1) / 2, (z0 + z1) / 2], INSIDE));
}
for (const s of [1, -1]) body.push(bevelled([s * (BW.x + IX) / 2, (BW.y0 + BW.y1) / 2, bz], [IX - BW.x, BW.y1 - BW.y0, bt], INSIDE, { bevel: 0.02 }));
// the seat: a cushion on a box and a low back (the driver's head shows over it through that window)
body.push(bevelled([SEAT.x, (D.y0 + SEAT.y) / 2, SEAT.z - 0.02], [0.44, SEAT.y - D.y0, 0.36], shade(SEAT_C, -0.2), { bevel: 0.04 }));
body.push(bevelled([SEAT.x, SEAT.y - 0.04, SEAT.z], [0.46, 0.09, 0.4], SEAT_C, { bevel: 0.04, segments: 2 }));
body.push(bevelled([SEAT.x, SEAT.y + 0.15, 0.05], [0.46, 0.36, 0.09], SEAT_C, { bevel: 0.04, segments: 2, rot: [-8, 0, 0] }));
// the column from the dash to the wheel
body.push(tube([[STEER.x, 0.84, 0.66], [STEER.x, STEER.y - 0.01, STEER.z + 0.02]], 0.025, INK));
// the hold: lined with light boards (seen through the back windows and when the doors open); its floor over the rear wells
// (its back end follows the leaning back: further in at the top)
const H = { x: HW - 0.04, y0: 0.78, y1: ROOF - 0.08, z1: bz - bt / 2 };
H.zb = Z0 + 0.03; H.zt = RT + 0.03;
const mid = [0, (H.y0 + H.y1) / 2, (H.zb + H.z1) / 2];
body.push(sheet([[-H.x, H.y0, H.zb], [H.x, H.y0, H.zb], [H.x, H.y0, H.z1], [-H.x, H.y0, H.z1]], [0, H.y0 - 5, mid[2]], shade(HOLD, -0.15)));
body.push(sheet([[-H.x, H.y1, H.zt], [H.x, H.y1, H.zt], [H.x, H.y1, H.z1], [-H.x, H.y1, H.z1]], [0, H.y1 + 5, mid[2]], shade(HOLD, 0.1)));
for (const s of [1, -1]) body.push(sheet([[s * H.x, H.y0, H.zb], [s * H.x, H.y1, H.zt], [s * H.x, H.y1, H.z1], [s * H.x, H.y0, H.z1]], [s * (H.x + 5), mid[1], mid[2]], HOLD));
// chunky dark bumpers, front and rear (the rear one under the swept-up back), and a mirror on a stub each side of the windscreen
body.push(bevelled([0, 0.4, Z1 + 0.04], [W + 0.06, 0.22, 0.18], DARK, { bevel: 0.08, segments: 2 }));
body.push(bevelled([0, RB + 0.02, Z0 - 0.06], [W + 0.06, 0.2, 0.18], DARK, { bevel: 0.08, segments: 2 }));
for (const s of [1, -1]) {
  body.push(bevelled([s * (HW + 0.1), 1.42, 0.72], [0.07, 0.22, 0.14], INK, { bevel: 0.03, segments: 2 }));
  body.push(bevelled([s * (HW + 0.04), 1.4, 0.72], [0.1, 0.05, 0.05], INK, { bevel: 0.015 }));
}

// the wheels: a fat tyre with round shoulders (a profile spun about x), a plain dark steel wheel with a small hub and four nuts
const wheel = (name, x, z) => {
  const s = Math.sign(x), hw = 0.1;
  const profile = [[-hw, 0.13], [-hw, R - 0.05], [-hw + 0.03, R - 0.01], [-hw + 0.06, R], [hw - 0.06, R], [hw - 0.03, R - 0.01], [hw, R - 0.05], [hw, 0.13]];
  const tyre = mesh(profile.map(([px, r]) => [px, r, 0]), [[...profile.keys()]], TYRE, { keep: true, modifiers: [{ type: "revolve", axis: "x", segments: 20, sharp: 60 }] });
  const cubes = [tyre, cyl([s * 0.005, 0, 0], 0.15, hw * 2 - 0.02, STEEL, { axis: "x", segments: 16 }), cyl([s * (hw - 0.005), 0, 0], 0.05, 0.04, PAL.metal, { axis: "x", segments: 10 })];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    cubes.push(cyl([s * (hw + 0.002), Math.sin(a) * 0.09, Math.cos(a) * 0.09], 0.018, 0.03, INK, { axis: "x", segments: 6 }));
  }
  return part(name, [x, R, z], cubes);
};
// the two rear doors, hinged at the back corners and leaning with the back (children of the body, so they ride with it); each a
// soft panel in the two tones with the band across it, an open window in a frame (no glass: the hold shows through), a handle
const LEAN = (Math.atan2(RT - Z0, ROOF - RB) * 180) / Math.PI; // (the back's lean: its top 16 cm forward over 1.24 m)
const DW = 0.555, DH = 1.1, DY = RB + 0.04, DT = 0.07;
const door = (name, s) => {
  const x = (a, b) => [-s * (a + b) / 2, b - a]; // (a span inwards from the hinge: its middle and width)
  const panel = (a, b, y0, y1, color) => { const [cx, w] = x(a, b); return bevelled([cx, (y0 + y1) / 2, -DT / 2], [w, y1 - y0, DT], color, { bevel: 0.025, segments: 2 }); };
  const flat = (a, b, y0, y1, color) => { const [cx, w] = x(a, b); return bevelled([cx, (y0 + y1) / 2, -DT - 0.004], [w - 0.01, y1 - y0, 0.012], color, { bevel: 0.004 }); };
  const win = { a: 0.09, b: DW - 0.08, y0: 0.5, y1: DH - 0.1 };
  return part(name, [s * 0.565, DY, Z0 + 0.005], [
    panel(0, DW, 0, win.y0, CREAM),
    panel(0, win.a, win.y0, DH, CREAM), panel(win.b, DW, win.y0, DH, CREAM), panel(win.a, win.b, win.y1, DH, CREAM),
    flat(0, DW, 0, 0.8 - DY, LOWER), flat(0, DW, 0.8 - DY, 0.95 - DY, RED),
    // the window's dark rubber frame
    ...[[win.a, win.a + 0.03, win.y0, win.y1], [win.b - 0.03, win.b, win.y0, win.y1], [win.a, win.b, win.y0, win.y0 + 0.03], [win.a, win.b, win.y1 - 0.03, win.y1]].map(([a, b, y0, y1]) => flat(a, b, y0, y1, FRAME)),
    (() => { const [cx] = x(DW - 0.08, DW - 0.03); return bevelled([cx, 0.5, -DT - 0.02], [0.05, 0.16, 0.04], INK, { bevel: 0.015 }); })(),
  ], [], [LEAN, 0, 0]);
};
// the steering wheel: a dark ring-like disc with a lighter middle, tilted up towards the driver; it turns about its column (y)
const steering = part("steering", [STEER.x, STEER.y, STEER.z], [
  cyl([0, 0, 0], 0.12, 0.035, INK, { segments: 18 }),
  cyl([0, 0.012, 0], 0.085, 0.02, shade(PAL.ink, 0.35), { segments: 14 }),
  cyl([0, 0.024, 0], 0.035, 0.02, PAL.mustard, { segments: 10 }),
  bevelled([0.07, 0.026, 0], [0.05, 0.012, 0.03], PAL.mustard, { bevel: 0.005 }), // (a mark so its turning shows)
], [], [STEER.tilt, 0, 0]);


export const van = model([
  part("body", [0, 0, 0], body, [door("door_l", 1), door("door_r", -1), steering]),
  wheel("wheel_fl", TR, AXF), wheel("wheel_fr", -TR, AXF), wheel("wheel_rl", TR, AXR), wheel("wheel_rr", -TR, AXR),
], { boxes: [{ x: 0, z: (Z0 + Z1) / 2, hw: HW + 0.04, hl: (Z1 - Z0) / 2 + 0.08, turn: 0 }] });

if (import.meta.url === `file://${process.argv[1]}`) {
  tool("model_write", { name: "van", model: van });
  tool("model_preview", { name: "van", yaw: 35, pitch: 12, image_out: "build/look/van.png" });
  tool("model_preview", { name: "van", yaw: 215, pitch: 10, image_out: "build/look/van-back.png" });
  tool("model_preview", { name: "van", yaw: 90, pitch: 0, image_out: "build/look/van-side.png" });
  tool("model_preview", { name: "van", yaw: 0, pitch: 4, image_out: "build/look/van-front.png" });
}
