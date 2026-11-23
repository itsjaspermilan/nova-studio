// The post van: a TOY of the classic boxy US/Canadian mail delivery truck the owner sent pictures of. The owner's third play: "We gotta
// reassess the van. It looks kinda borked now and too wide. We can slim it down and use those reference images." Shrinking one side at
// a time (2.9 -> 2.4 long, 1.9 -> 1.7 high, 1.48 -> 1.56 wide) had left a squashed golf cart; this one starts from the reference's own
// proportions (about 4.45 x 1.93 x 2.16 m in life, length : width : height 1 : 0.43 : 0.48) and scales the whole thing, a little
// chibi (rounded, slightly bigger wheels, a touch shorter and taller for its length): 2.95 m long with its bumpers, 1.34 wide, 1.63
// high (1 : 0.45 : 0.55), wheels 0.54 across. Our own design in the game's one look (tools/palette.mjs), no real service's marks.
//
// The shape, as the reference has it (the numbers are the curves below):
// - from the side, front to back: a dark bumper sticking out; a blunt upright nose 0.74 high (45% of the height); a short bonnet (0.46,
//   16% of the length) rising gently to the base of a big flat windscreen that leans back 12.5 degrees and reaches nearly to the roof;
//   one flat roof all the way back with a thin overhanging lip; an upright back leaning in 6 cm towards the roof; under it the underside
//   sweeping UP at 25 degrees from just behind the rear wheel to the dark rear bumper (the step).
// - the cab: on the left (the driver's side) an open doorway shaped as the reference's door, no door (the owner, second notes: "We can
//   also make the truck have no doors"): its front edge leaning with the windscreen pillar, its foot low with a dark step inside, and
//   rising round the front wheel's well (the owner, after the third play's pictures: "they would go around the wheel well and have a
//   step in them too"). On the right no doorway: one big window, the panel and the band unbroken under it ("We can remove the
//   passenger side door and just keep it as a window"). The cargo box behind is plain, the lettering on its upper half (FERNHOLLOW
//   POST, drawn by the game: entities/van.lua).
// - small dark steel wheels with a small hub (0.54 across, 33% of the height): the front one under the front of the doorway just behind
//   the bonnet, the rear one at 70% of the length, a long rear overhang; round wells cut in the body with a rolled lip, hollow inside.
// - the front: the windscreen in a thick dark rubber frame with thin pillars, two small square headlamps at the nose's outer corners
//   with a small amber lamp beside each, a small grille between, a mirror on a stalk at each pillar.
// - two tones: cream above, sand below, a red band at mid height that swoops down towards the front wheel.
//
// It is ONE smooth body surface with things cut into it (the approach of the car kit, studio/mcp/makers/car/kit.mjs: one skin from the
// drawing's curves, everything a real truck has cut into it with the Cut-out modifier, only real separate pieces as shapes). The skin
// is lofted along the van from three explicit curves, each read straight from the reference's numbers: SIDE (the top line and the
// bottom line, z -> y), PLAN (the half-width along z) and SECTION (the cross-section: upright sides leaning in a little towards the
// roof, round roof edges, smaller round bottom edges); its two ends (the nose, the back) are rounded over by insetting the last rings,
// and the windscreen's pillars are rounded in plan the same way. The cut-outs: the wheel wells, the left doorway, the right window, the windscreen, the opening
// behind the rear doors, the two tones and the band.
//
// The lamps are their own named parts, so the game can light them (entities/van.lua): `lamp_head` (the headlamps, softly lit) and the
// amber lamps beside them; at the back a stack each side of the doors: `lamp_tail` (red), the amber indicator and the white reverse lamp;
// `lamp_brake` (the tail lamps glowing bright, hidden at rest: shown while braking) and `lamp_reverse` (the reverse lamps lit, hidden at
// rest: shown while reversing) sit just over them; amber side markers at the front corners, red ones at the back.
//
// Glass: a lightly tinted pane in the windscreen and in each rear door's window. A pane is see-through (its colour has an alpha), and
// Nova draws a mesh's see-through triangles after the solid ones, blended, the rest of the mesh solid (it used to draw the whole mesh
// blended when any vertex was see-through, which is why glass made a body see-through: crates/nova-runtime/src/gfx.rs, `solid_first`).
//
// Parts: `body` (the shell and the cab; its children `door_l` and `door_r`, hinged at the back corners and leaning with the back, the
// `steering` wheel, the lamps) and the four wheels `wheel_fl`, `wheel_fr`, `wheel_rl`, `wheel_rr` at their axles (entities/van.lua hangs
// each on a spring).
import { bevelled, cyl, mesh, model, part, shade, tube } from "./geo.mjs";
import { tool } from "./lib.mjs";
import { PAL } from "./palette.mjs";

const U = 16, u = (v) => Math.round(v * U * 1000) / 1000;
const CREAM = PAL.cream, LOWER = shade(PAL.cream, -0.13), RED = PAL.red, INK = PAL.ink, TYRE = PAL.tyre;
const DARK = shade(PAL.ink, 0.08);       // the bumpers: chunky, dark
const STEEL = "#57524d";                  // plain dark steel wheels
const FRAME = shade(PAL.ink, 0.18);       // the rubber round the windscreen and the windows
const INSIDE = shade(PAL.cream, -0.22), FLOOR = shade(PAL.ink, 0.15), DASH = PAL.woodDark, SEAT_C = PAL.redDark, HOLD = PAL.woodLight;
const GLASS = "#b9d6e0";                  // the panes: a light blue-grey, mostly clear (alpha below)
const PANE_ALPHA = "50";
// the lamps' lenses, unlit and lit
export const LAMPS = {
  head: "#fff4d6", headLit: "#ffe9b0", amber: "#e9a23b", tail: "#b8392c", tailLit: "#ff4a36", reverse: "#ece6dc", reverseLit: "#ffffff",
};

// ---- the numbers (metres; z along the van, + forward; y up from the ground; x across, + is the van's own left) -------------------
export const L = 2.95, W = 1.34, H = 1.63;        // over the bumpers, over the body, over the roof's lip
export const HW = W / 2;
export const R = 0.27;                            // wheel radius (0.54 across)
export const AXF = 0.72, AXR = -0.59;             // front and rear axle: under the front of the doorway; at 70% of the length
export const TR = 0.55;                           // a wheel's middle from the centre line
export const ZF = 1.40, ZB = -1.42;               // the nose; the foot of the back (its top leans 6 cm in)
export const Z1 = 1.49, Z0 = -1.48;               // the bumpers' faces (the van's ends)
const SILL = 0.24, ROOF = 1.6;                    // the underside; the roof (its lip a little higher)
const NOSE_TOP = 0.78;                            // the nose's top (0.74 seen, once its edge is rounded)
const WS = { top: [0.78, ROOF], base: [0.94, 0.88] }; // the windscreen's top and base (z, y): 0.16 back over 0.72 up, 12.5 degrees
const ARCH = 0.34;                                // the wells' radius (round the wheel, with room to bob on its spring)
const ARCH_Y = 0.29;                              // the wells' middle
const END = { nose: 0.07, back: 0.07 };            // how round the two ends' edges are
const BACK_LEAN = 0.06;                           // the back leans in this much from its foot to the roof
// the cab: one open doorway on the left (+x: the driver's side) shaped as the reference's door: its rear edge upright, its front edge
// leaning with the windscreen pillar, its top high with round corners, its bottom low (a step inside it) and level from the back until
// it meets the front wheel's well, then rising round the well `gap` metres clear of its lip. The right side has no doorway: a window.
export const DOORWAY = { z0: 0.14, y0: 0.36, y1: 1.46, gap: 0.07, top: 0.11, foot: 0.04 };
export const SIDE_WINDOW = { z0: 0.26, z1: 0.74, y0: 0.98, y1: 1.42, r: 0.1 };
export const SEAT = { x: 0.28, z: 0.2, y: 0.53 };   // the cushion's top; where the driver sits
export const STEER = { x: 0.28, y: 0.86, z: 0.46, tilt: -58 };
const CAB_WALL = 0.0;                              // the wall between the cab and the hold (z)

// ---- the three curves --------------------------------------------------------------------------------------------------------------
// A polyline with its corners rounded (fillet radius per corner), sampled: [[z, y], ...] from the back to the nose.
function filleted(pts, radii, n = 6) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const [p0, p1, p2] = [pts[i - 1], pts[i], pts[i + 1]], r = radii[i] ?? 0;
    if (!r) { out.push(p1); continue; }
    const d0 = [p0[0] - p1[0], p0[1] - p1[1]], d2 = [p2[0] - p1[0], p2[1] - p1[1]];
    const l0 = Math.hypot(...d0), l2 = Math.hypot(...d2);
    const a = Math.acos(Math.max(-1, Math.min(1, (d0[0] * d2[0] + d0[1] * d2[1]) / (l0 * l2))));
    const t = Math.min(r / Math.tan(a / 2), l0 * 0.45, l2 * 0.45);
    const A = [p1[0] + (d0[0] / l0) * t, p1[1] + (d0[1] / l0) * t], B = [p1[0] + (d2[0] / l2) * t, p1[1] + (d2[1] / l2) * t];
    // (a quadratic through the corner: close to the arc for these gentle radii, and always between A and B)
    for (let k = 0; k <= n; k++) {
      const s = k / n, q = 1 - s;
      out.push([q * q * A[0] + 2 * q * s * p1[0] + s * s * B[0], q * q * A[1] + 2 * q * s * p1[1] + s * s * B[1]]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}
// y at z along a sampled line that runs one way in z
const at = (line, z) => {
  for (let i = 0; i < line.length - 1; i++) {
    const [z0, y0] = line[i], [z1, y1] = line[i + 1];
    if ((z - z0) * (z - z1) <= 0 && z0 !== z1) return y0 + ((y1 - y0) * (z - z0)) / (z1 - z0);
  }
  return z < line[0][0] ? line[0][1] : line[line.length - 1][1];
};
// z at y along the windscreen line (for the pillars' rounding)
const zOfWindscreen = (y) => WS.base[0] + ((WS.top[0] - WS.base[0]) * (y - WS.base[1])) / (WS.top[1] - WS.base[1]);

// SIDE: the top line (roof, windscreen, bonnet to the nose) and the bottom line (the sweep up behind the rear wheel, the flat underside)
const NOSE0 = ZF - END.nose, BACK0 = ZB + BACK_LEAN + END.back + 0.05; // where the two ends' rounding begins
export const SIDE = {
  top: filleted([[BACK0, ROOF], [WS.top[0], ROOF], WS.base, [NOSE0, NOSE_TOP]], [0, 0.12, 0.09, 0]),
  bottom: filleted([[BACK0, SILL + (-0.97 - BACK0) * Math.tan((25 * Math.PI) / 180)], [-0.97, SILL], [NOSE0, SILL]], [0, 0.18, 0]),
};
// PLAN: the half-width along z (a hair narrower at the nose, as the reference's front corners are)
export const PLAN = (z) => HW - 0.02 * Math.max(0, Math.min(1, (z - 0.94) / (NOSE0 - 0.94)));
// SECTION: the ring of points round the van at one place, from the half-width, the bottom and the top there: upright sides that lean
// in 3.5 cm towards the roof (from 1.1 m up), the roof's edges round (12 cm), the bottom's edges smaller (6 cm). `inset` shrinks it
// all round (the ends' rounding). Points go round from the bottom's middle by the van's left (+x) and back by its right.
const SECTION = { lean: 0.035, from: 1.1, rTop: 0.12, rBottom: 0.06 };
function section(hw, yb, yt, inset = 0) {
  hw -= inset; yb += inset; yt -= inset;
  const rt = Math.max(0.005, Math.min(SECTION.rTop, (yt - yb) * 0.3) - inset * 0.5), rb = Math.max(0.005, SECTION.rBottom - inset * 0.5);
  const side = (y) => hw - SECTION.lean * Math.max(0, Math.min(1, (y - SECTION.from) / Math.max(0.2, ROOF - SECTION.from)));
  const half = [];
  for (const s of [0, 0.5]) half.push([(hw - rb) * s, yb]);
  for (let k = 0; k <= 4; k++) { const a = -Math.PI / 2 + (k / 4) * (Math.PI / 2); half.push([hw - rb + Math.cos(a) * rb, yb + rb + Math.sin(a) * rb]); }
  for (let k = 1; k <= 4; k++) { const y = yb + rb + ((yt - rt - yb - rb) * k) / 5; half.push([side(y), y]); }
  const xt = side(yt - rt);
  for (let k = 0; k <= 5; k++) { const a = (k / 5) * (Math.PI / 2); half.push([xt - rt + Math.cos(a) * rt, yt - rt + Math.sin(a) * rt]); }
  half.push([(xt - rt) * 0.5, yt], [0, yt]);
  // the whole ring: the left half up, the right half (mirrored) back down, the two middles shared
  const right = half.slice(1, -1).reverse().map(([x, y]) => [-x, y]);
  return [...half, ...right];
}

// ---- the skin: rings along the van, the two ends rounded over, capped ------------------------------------------------------------
function skin() {
  // the stations: evenly every 6 cm, and every sample of the two lines (so the windscreen's and the sweep's corners are kept)
  const zs = new Set();
  for (let z = BACK0; z <= NOSE0 + 1e-6; z += 0.06) zs.add(Math.round(z * 1000) / 1000);
  for (const [z] of [...SIDE.top, ...SIDE.bottom]) if (z >= BACK0 && z <= NOSE0) zs.add(Math.round(z * 1000) / 1000);
  zs.add(NOSE0); zs.add(BACK0);
  const stations = [...zs].sort((a, b) => a - b).filter((z, i, all) => i === 0 || z - all[i - 1] > 0.004);
  const rings = [];
  // the pillars: just behind the windscreen, its upper corners are rounded in plan (the reference's A-pillars), fading out below the
  // windscreen's base so the bonnet's sides run on straight
  const PILLAR = 0.07;
  const pillar = (x, y, z) => {
    if (y < WS.base[1] + 0.02) return x;
    const dz = zOfWindscreen(Math.min(y, ROOF)) - z;
    if (dz < 0 || dz > PILLAR) return x;
    const k = Math.min(1, (y - WS.base[1]) / 0.12);
    const q = PILLAR - dz;
    return Math.sign(x) * Math.max(0, Math.abs(x) - k * (PILLAR - Math.sqrt(Math.max(0, PILLAR * PILLAR - q * q))) * Math.min(1, Math.abs(x) / (HW * 0.6)));
  };
  const ringAt = (z, inset = 0, zOf = () => z, base = z) =>
    section(PLAN(base), at(SIDE.bottom, base), at(SIDE.top, base), inset).map(([x, y]) => [pillar(x, y, base), y, zOf(y)]);
  // the back's rounding: rings stepping back and in to the leaning back face (its foot further back than its top)
  const STEPS = 5;
  for (let k = STEPS; k >= 0; k--) {
    const a = (k / STEPS) * (Math.PI / 2), d = END.back * (1 - Math.cos(a));
    rings.push(ringAt(BACK0, d, (y) => backZ(y) + END.back * (1 - Math.sin(a)), BACK0));
  }
  for (const z of stations) rings.push(ringAt(z));
  for (let k = 1; k <= STEPS; k++) {
    const a = (k / STEPS) * (Math.PI / 2), d = END.nose * (1 - Math.cos(a));
    rings.push(ringAt(NOSE0, d, () => NOSE0 + Math.sin(a) * END.nose, NOSE0));
  }
  const n = rings[0].length, verts = [], faces = [];
  for (const r of rings) for (const p of r) verts.push(p);
  for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < n; j++) {
    const a = i * n + j, b = i * n + ((j + 1) % n);
    faces.push([a, b, b + n, a + n]);
  }
  // the caps: a fan from each end ring's middle
  for (const [ri, dir] of [[0, -1], [rings.length - 1, 1]]) {
    const r = rings[ri], c = r.reduce((m, p) => m.map((v, i) => v + p[i] / n), [0, 0, 0]);
    const ci = verts.push(c) - 1;
    for (let j = 0; j < n; j++) faces.push(dir > 0 ? [ri * n + j, ri * n + ((j + 1) % n), ci] : [ri * n + ((j + 1) % n), ri * n + j, ci]);
  }
  return { verts, faces, rings, stations };
}
// the back face's z at a height (its foot at ZB, leaning in BACK_LEAN to the roof): for the skin, and what sits on it (doors, lamps)
function backZ(y) {
  const yb0 = at(SIDE.bottom, BACK0), yt0 = at(SIDE.top, BACK0);
  return ZB + BACK_LEAN * Math.max(0, Math.min(1, (y - yb0) / (yt0 - yb0)));
}
const SKIN = skin();

// ---- the cut-outs ------------------------------------------------------------------------------------------------------------------
const rr = (x0, y0, x1, y1, r = 0.08, k = 4) => { // a rounded rectangle's outline (a, b) in metres -> model units
  const pts = [];
  const corner = (cx, cy, a0) => { for (let i = 0; i <= k; i++) { const a = a0 + (Math.PI / 2) * (i / k); pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } };
  corner(x1 - r, y0 + r, -Math.PI / 2); corner(x1 - r, y1 - r, 0); corner(x0 + r, y1 - r, Math.PI / 2); corner(x0 + r, y0 + r, Math.PI);
  return pts.map(([a, b]) => [u(a), u(b)]);
};
const poly = (pts) => pts.map(([a, b]) => [u(a), u(b)]);
const arch = (az) => {
  const pts = [[az - ARCH, SILL - 0.1]];
  for (let i = 0; i <= 14; i++) { const a = Math.PI * (1 - i / 14); pts.push([az + Math.cos(a) * ARCH, ARCH_Y + Math.sin(a) * ARCH]); }
  pts.push([az + ARCH, SILL - 0.1]);
  return pts.map(([z, y]) => [u(z), u(y)]);
};
// the band: at mid height along the box (0.8 to 0.94), swooping down past the doorway towards the front wheel and on along the bonnet
const BAND = { lo: [[-1.6, 0.8], [0.12, 0.8], [0.96, 0.58], [1.6, 0.58]], hi: [[1.6, 0.7], [0.96, 0.7], [0.14, 0.94], [-1.6, 0.94]] };
const D = DOORWAY;
// the doorway's front edge at a height: the windscreen pillar's lean, 10 cm behind its face
const doorFront = (y) => zOfWindscreen(Math.max(y, WS.base[1])) - 0.1;
// The doorway's outline (z, y in metres), grown by `g` all round (the frame): the rear foot corner, the level bottom, round the wheel
// well, up the front edge, the two round top corners.
export function doorOutline(g = 0) {
  const z0 = D.z0 - g, yb = D.y0 - g, yt = D.y1 + g, R = ARCH + D.gap - g, rt = D.top + g, rb = D.foot + g * 0.5;
  const front = (y) => doorFront(y) + g;
  const pts = [];
  const corner = (cz, cy, r, a0, a1, n = 5) => { for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; pts.push([cz + Math.cos(a) * r, cy + Math.sin(a) * r]); } };
  corner(z0 + rb, yb + rb, rb, Math.PI, 1.5 * Math.PI, 3);
  // level to the well, then round it (the angle from the well's middle falling from the back over the top and on)
  let a = Math.atan2(yb - ARCH_Y, -Math.sqrt(Math.max(0, R * R - (yb - ARCH_Y) ** 2)));
  const step = 0.04;
  while (a > -0.3) {
    const z = AXF + Math.cos(a) * R, y = ARCH_Y + Math.sin(a) * R;
    if (z >= front(y)) break;
    pts.push([z, y]);
    a -= step;
  }
  const yE = ARCH_Y + Math.sin(a + step) * R;
  pts.push([front(yE), yE]);
  // up the front edge (leaning with the pillar), the round top corners
  for (const y of [WS.base[1], (WS.base[1] + yt - rt) / 2]) if (y > yE) pts.push([front(y), y]);
  corner(front(yt - rt) - rt, yt - rt, rt, 0, Math.PI / 2);
  corner(z0 + rt, yt - rt, rt, Math.PI / 2, Math.PI);
  return pts;
}
const SW = SIDE_WINDOW;
const WIN = { x: HW - 0.11, y0: 1.0, y1: 1.5 };   // the windscreen's opening (front view)
export const cuts = [
  // two tones: sand below the band, cream above; the red band
  { view: "side", points: poly([[-1.6, 0], [1.6, 0], ...BAND.lo.slice().reverse()]), color: LOWER },
  { view: "side", points: poly([...BAND.lo, ...BAND.hi]), color: RED },
  { view: "front", points: rr(-HW - 0.2, 0, HW + 0.2, 0.6, 0.001, 1), color: LOWER },
  { view: "front", points: rr(-HW - 0.2, 0.6, HW + 0.2, 0.7, 0.001, 1), color: RED },
  { view: "back", points: rr(-HW - 0.2, 0, HW + 0.2, 0.8, 0.001, 1), color: LOWER },
  { view: "back", points: rr(-HW - 0.2, 0.8, HW + 0.2, 0.94, 0.001, 1), color: RED },
  // the wheel wells (taken away, a rolled-in dark lip)
  { view: "side", points: arch(AXF), remove: true, depth: u(0.1), wall: INK },
  { view: "side", points: arch(AXR), remove: true, depth: u(0.1), wall: INK },
  // the left doorway: the door's outline round the wheel well, an opening in a dark rubber edge, its lip as thick as the shell
  { view: "side", only: "+x", points: poly(doorOutline(0.045)), color: FRAME },
  { view: "side", only: "+x", points: poly(doorOutline(0)), remove: true, depth: u(0.06), wall: INSIDE },
  // the right side: no door, one big window in a dark frame (a pane inside: below), the panel and the band unbroken under it
  { view: "side", only: "-x", points: rr(SW.z0 - 0.045, SW.y0 - 0.045, SW.z1 + 0.045, SW.y1 + 0.045, SW.r + 0.04), color: FRAME },
  { view: "side", only: "-x", points: rr(SW.z0, SW.y0, SW.z1, SW.y1, SW.r), remove: true, depth: u(0.05), wall: FRAME },
  // the windscreen: big and flat in a thick dark rubber frame, thin pillars; an opening (the pane is a piece of its own, inside)
  { view: "front", points: rr(-WIN.x - 0.06, WIN.y0 - 0.06, WIN.x + 0.06, WIN.y1 + 0.05, 0.12), color: FRAME, near: u(0.7) },
  { view: "front", points: rr(-WIN.x, WIN.y0, WIN.x, WIN.y1, 0.08), remove: true, depth: u(0.05), wall: FRAME, near: u(0.7) },
  // the grille between the headlamps, and the opening behind the rear doors into the hold
  { view: "front", points: rr(-0.2, 0.38, 0.2, 0.56, 0.03), color: INK, depth: u(0.02), wall: INK, near: u(1.3), far: u(1.5) },
  { view: "back", points: rr(-0.5, 0.56, 0.5, 1.49, 0.06), remove: true, depth: u(0.05), wall: INSIDE },
];
const body = [mesh(SKIN.verts, SKIN.faces, CREAM, { keep: true, smooth: true, modifiers: [{ type: "cutout", cuts }] })];
// (the skin's faces are wound by hand, outwards: `keep`; smooth shading across the whole skin)

// the roof's thin lip, overhanging all round: one flat rounded slab on the roof, as the reference's roof cap
const capZ0 = backZ(ROOF) - 0.015, capZ1 = WS.top[0] + 0.02;
body.push(bevelled([0, ROOF + 0.01, (capZ0 + capZ1) / 2], [W - 0.17, 0.04, capZ1 - capZ0], shade(CREAM, -0.04), { bevel: 0.018, segments: 2 }));

// the grille's three bars
for (const y of [0.42, 0.47, 0.52]) body.push(bevelled([0, y, ZF + 0.005], [0.36, 0.022, 0.02], shade(PAL.ink, 0.3), { bevel: 0.008 }));

// faces turned to look away from a point: a liner seen only from inside
const sheet = (pts, away, color) => mesh(pts, [[0, 1, 2, 3]], color, { inside: away });
// the wells' lining: dark faces turned inwards round each axle, so the well reads hollow and the wheel turns inside it
const liner = (az) => {
  const x = HW - 0.05, y0 = SILL - 0.04, y1 = ARCH_Y + ARCH + 0.02, z0 = az - ARCH - 0.02, z1 = az + ARCH + 0.02, xi = TR - 0.13;
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
const IX = HW - 0.06, FL = 0.5;
const STEP = { x0: IX - 0.2, y: 0.4 };  // the step well inside the doorway: from here to the side, its tread this high
body.push(bevelled([(-IX + STEP.x0) / 2, FL - 0.03, (CAB_WALL + 0.9) / 2], [IX + STEP.x0, 0.06, 0.9 - CAB_WALL], FLOOR, { bevel: 0.02 }));
body.push(bevelled([0, ROOF - 0.1, (CAB_WALL + WS.top[0]) / 2], [2 * IX, 0.04, WS.top[0] - CAB_WALL], INSIDE, { bevel: 0.015 }));
// (its foot over the front wells' linings, so it never shows in a wheel arch)
body.push(bevelled([0, 0.83, 0.8], [2 * IX, 0.26, 0.2], DASH, { bevel: 0.06, segments: 2 }));
body.push(bevelled([0, 0.95, 0.76], [2 * IX - 0.1, 0.1, 0.14], shade(DASH, 0.15), { bevel: 0.045, segments: 2 })); // the dash's rounded top
const BW = { x: 0.46, y0: 0.92, y1: 1.38 }, bz = CAB_WALL, bt = 0.05;
body.push(bevelled([0, (FL + BW.y0) / 2, bz], [2 * IX, BW.y0 - FL, bt], INSIDE, { bevel: 0.02 }));
body.push(bevelled([0, (BW.y1 + ROOF - 0.08) / 2, bz], [2 * IX, ROOF - 0.08 - BW.y1, bt], INSIDE, { bevel: 0.02 }));
for (const s of [1, -1]) body.push(bevelled([s * (BW.x + IX) / 2, (BW.y0 + BW.y1) / 2, bz], [IX - BW.x, BW.y1 - BW.y0, bt], INSIDE, { bevel: 0.02 }));
// (the cab's sides seen from inside: on the left round the doorway, before, behind and over it; on the right round the window)
const inner = (s, z0, z1, y0, y1) => {
  const x = s * (IX - 0.005);
  body.push(sheet([[x, y0, z0], [x, y1, z0], [x, y1, z1], [x, y0, z1]], [s * (IX + 5), (y0 + y1) / 2, (z0 + z1) / 2], INSIDE));
};
inner(1, doorFront(D.y1) - 0.04, 0.92, FL, ROOF - 0.08);
inner(1, bz, D.z0 + 0.04, STEP.y, ROOF - 0.08);
inner(1, D.z0, doorFront(D.y1), D.y1 - 0.05, ROOF - 0.08);
for (const [z0, z1, y0, y1] of [[bz, SW.z0 + 0.03, FL, ROOF - 0.08], [SW.z1 - 0.03, 0.92, FL, ROOF - 0.08], [SW.z0, SW.z1, FL, SW.y0 + 0.03], [SW.z0, SW.z1, SW.y1 - 0.03, ROOF - 0.08]]) inner(-1, z0, z1, y0, y1);
// the step: a dark well just inside the doorway's foot, lower than the cab floor, behind the front wheel's well; a ribbed tread
{
  const z0 = D.z0 + 0.01, z1 = AXF - ARCH - 0.02, x0 = STEP.x0, x1 = IX;
  body.push(bevelled([(x0 + x1) / 2, STEP.y - 0.03, (z0 + z1) / 2], [x1 - x0, 0.06, z1 - z0], DARK, { bevel: 0.012 }));
  for (const k of [0.25, 0.5, 0.75]) body.push(bevelled([(x0 + x1) / 2, STEP.y + 0.006, z0 + (z1 - z0) * k], [x1 - x0 - 0.04, 0.014, 0.018], shade(PAL.ink, 0.28), { bevel: 0.005 }));
  // its inner wall up to the floor, and its back
  body.push(sheet([[x0, STEP.y - 0.06, z0], [x0, FL, z0], [x0, FL, z1], [x0, STEP.y - 0.06, z1]], [x0 + 5, FL, (z0 + z1) / 2], shade(DARK, 0.15)));
  body.push(sheet([[x0, STEP.y - 0.06, z0], [x1, STEP.y - 0.06, z0], [x1, FL, z0], [x0, FL, z0]], [(x0 + x1) / 2, FL, z0 + 5], shade(DARK, 0.15)));
}
// the seat: a cushion on a box and a low back (the driver's head shows over it through that window)
body.push(bevelled([SEAT.x, (FL + SEAT.y) / 2, SEAT.z - 0.02], [0.4, SEAT.y - FL, 0.32], shade(SEAT_C, -0.2), { bevel: 0.03 }));
body.push(bevelled([SEAT.x, SEAT.y - 0.04, SEAT.z], [0.42, 0.08, 0.36], SEAT_C, { bevel: 0.035, segments: 2 }));
body.push(bevelled([SEAT.x, SEAT.y + 0.15, 0.05], [0.42, 0.34, 0.08], SEAT_C, { bevel: 0.035, segments: 2, rot: [-8, 0, 0] }));
// the column from the dash to the wheel
body.push(tube([[STEER.x, 0.74, 0.74], [STEER.x, STEER.y - 0.01, STEER.z + 0.02]], 0.025, INK));
// the hold: lined with light boards (seen through the back windows and when the doors open); its floor over the rear wells
const Hd = { x: HW - 0.05, y0: ARCH_Y + ARCH + 0.03, y1: ROOF - 0.07, z1: bz - bt / 2, zb: ZB + BACK_LEAN + 0.02, zt: ZB + 0.02 + 0.0 };
const mid = [0, (Hd.y0 + Hd.y1) / 2, (Hd.zb + Hd.z1) / 2];
body.push(sheet([[-Hd.x, Hd.y0, Hd.zb], [Hd.x, Hd.y0, Hd.zb], [Hd.x, Hd.y0, Hd.z1], [-Hd.x, Hd.y0, Hd.z1]], [0, Hd.y0 - 5, mid[2]], shade(HOLD, -0.15)));
body.push(sheet([[-Hd.x, Hd.y1, Hd.zb], [Hd.x, Hd.y1, Hd.zb], [Hd.x, Hd.y1, Hd.z1], [-Hd.x, Hd.y1, Hd.z1]], [0, Hd.y1 + 5, mid[2]], shade(HOLD, 0.1)));
for (const s of [1, -1]) body.push(sheet([[s * Hd.x, Hd.y0, Hd.zb], [s * Hd.x, Hd.y1, Hd.zb], [s * Hd.x, Hd.y1, Hd.z1], [s * Hd.x, Hd.y0, Hd.z1]], [s * (Hd.x + 5), mid[1], mid[2]], HOLD));

// the windscreen's pane: lightly tinted, just inside the opening, leaning with it
{
  const lean = Math.atan2(WS.base[0] - WS.top[0], WS.top[1] - WS.base[1]) * (180 / Math.PI);
  const yc = (WIN.y0 + WIN.y1) / 2, zc = zOfWindscreen(yc) - 0.045;
  body.push(bevelled([0, yc, zc], [2 * WIN.x + 0.04, WIN.y1 - WIN.y0 + 0.04, 0.012], GLASS + PANE_ALPHA, { bevel: 0.005, rot: [-lean, 0, 0] }));
}

// the right window's pane, lightly tinted, just inside the side
body.push(bevelled([-(HW - 0.035), (SW.y0 + SW.y1) / 2, (SW.z0 + SW.z1) / 2], [0.01, SW.y1 - SW.y0 + 0.03, SW.z1 - SW.z0 + 0.03], GLASS + PANE_ALPHA, { bevel: 0.004 }));

// chunky dark bumpers, front and rear (the rear one the step under the swept-up back)
body.push(bevelled([0, 0.36, Z1 - 0.065], [W + 0.02, 0.15, 0.13], DARK, { bevel: 0.06, segments: 2 }));
body.push(bevelled([0, 0.45, Z0 + 0.065], [W - 0.02, 0.13, 0.13], DARK, { bevel: 0.05, segments: 2 }));
// a mirror on a stalk at each windscreen pillar
for (const s of [1, -1]) {
  body.push(tube([[s * (HW - 0.04), 1.28, 0.86], [s * (HW + 0.1), 1.3, 0.9]], 0.018, INK));
  body.push(bevelled([s * (HW + 0.12), 1.21, 0.9], [0.05, 0.2, 0.12], INK, { bevel: 0.022, segments: 2 }));
}

// ---- the lamps: their own parts -------------------------------------------------------------------------------------------------
// A lamp: a dark rounded housing on the body and a lens over it; `lit` makes the lens glow (emissive).
const lens = (c, size, color, glow = 0) => bevelled(c, size, color, { bevel: Math.min(...size) * 0.3, segments: 2, emissive: glow || undefined });
const housing = (c, size) => bevelled(c, size, INK, { bevel: Math.min(...size) * 0.3, segments: 2 });
// the front: the headlamps at the nose's outer corners, an amber lamp beside each (inboard), side markers at the front corners
export const HEAD = { x: 0.47, y: 0.5, s: 0.14 }, AMBER_F = { x: 0.34, y: 0.5, s: 0.07 };
const fz = ZF + 0.01;
for (const s of [1, -1]) {
  body.push(housing([s * HEAD.x, HEAD.y, fz], [HEAD.s + 0.04, HEAD.s + 0.04, 0.03]));
  body.push(housing([s * AMBER_F.x, AMBER_F.y, fz], [AMBER_F.s + 0.03, AMBER_F.s + 0.03, 0.025]));
}
// (the headlamps' lenses unlit, under the lit ones: what shows with the lamps off)
for (const s of [1, -1]) body.push(lens([s * HEAD.x, HEAD.y, fz + 0.012], [HEAD.s, HEAD.s, 0.02], LAMPS.head));
const lampHead = part("lamp_head", [0, 0, 0], [1, -1].map((s) => lens([s * HEAD.x, HEAD.y, fz + 0.018], [HEAD.s, HEAD.s, 0.025], LAMPS.headLit, 0.55)));
const lampAmberF = part("lamp_indicator_front", [0, 0, 0], [
  ...[1, -1].map((s) => lens([s * AMBER_F.x, AMBER_F.y, fz + 0.016], [AMBER_F.s, AMBER_F.s, 0.02], LAMPS.amber, 0.05)),
  // the side markers at the front corners (amber), low on the nose's flank
  ...[1, -1].map((s) => lens([s * (PLAN(1.2) + 0.005), 0.5, 1.22], [0.02, 0.06, 0.1], LAMPS.amber, 0.05)),
]);
// the back: a stack each side of the doors (red tail and brake lamp on top, amber indicator, white reverse lamp), red side markers
export const STACK = { x: 0.56, w: 0.07, tail: [0.86, 1.02], amber: [0.76, 0.83], reverse: [0.66, 0.73] };
const bzAt = (y) => backZ(y) - 0.012;
const stackLens = (y0, y1, color, glow, proud = 0) => [1, -1].map((s) => lens([s * STACK.x, (y0 + y1) / 2, bzAt((y0 + y1) / 2) - 0.012 - proud], [STACK.w, y1 - y0, 0.022], color, glow));
for (const s of [1, -1]) body.push(housing([s * STACK.x, (STACK.reverse[0] + STACK.tail[1]) / 2, bzAt(0.84)], [STACK.w + 0.035, STACK.tail[1] - STACK.reverse[0] + 0.04, 0.03]));
const lampTail = part("lamp_tail", [0, 0, 0], [
  ...stackLens(...STACK.tail, LAMPS.tail, 0.2),
  ...[1, -1].map((s) => lens([s * (HW - 0.003), 0.62, ZB + 0.24], [0.02, 0.06, 0.1], LAMPS.tail, 0.15)),
]);
const lampAmberB = part("lamp_indicator_back", [0, 0, 0], stackLens(...STACK.amber, LAMPS.amber, 0.05));
const lampRevOff = part("lamp_reverse_off", [0, 0, 0], stackLens(...STACK.reverse, LAMPS.reverse, 0));
// (the lit ones: a hair proud of the unlit lenses, hidden until the game shows them)
const lampBrake = part("lamp_brake", [0, 0, 0], stackLens(...STACK.tail, LAMPS.tailLit, 1, 0.006));
const lampReverse = part("lamp_reverse", [0, 0, 0], stackLens(...STACK.reverse, LAMPS.reverseLit, 1, 0.006));
lampBrake.hidden = true;
lampReverse.hidden = true;

// ---- the wheels: a fat tyre with round shoulders (a profile spun about x), a plain dark steel wheel with a small hub and four nuts --
const wheel = (name, x, z) => {
  const s = Math.sign(x), hw = 0.09;
  const profile = [[-hw, 0.14], [-hw, R - 0.05], [-hw + 0.03, R - 0.01], [-hw + 0.06, R], [hw - 0.06, R], [hw - 0.03, R - 0.01], [hw, R - 0.05], [hw, 0.14]];
  const tyre = mesh(profile.map(([px, r]) => [px, r, 0]), [[...profile.keys()]], TYRE, { keep: true, modifiers: [{ type: "revolve", axis: "x", segments: 20, sharp: 60 }] });
  const cubes = [tyre, cyl([s * 0.005, 0, 0], 0.16, hw * 2 - 0.02, STEEL, { axis: "x", segments: 16 }), cyl([s * (hw - 0.005), 0, 0], 0.05, 0.04, PAL.metal, { axis: "x", segments: 10 })];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    cubes.push(cyl([s * (hw + 0.002), Math.sin(a) * 0.095, Math.cos(a) * 0.095], 0.018, 0.03, INK, { axis: "x", segments: 6 }));
  }
  return part(name, [x, R, z], cubes);
};

// ---- the two rear doors: hinged at the back's outer edges, leaning with it (children of the body, so they ride with it). Each is ONE
// solid, softly rounded panel (the owner: "The back doors look like a bunch of rectangles just stuck together, not a solid door"): the
// band painted across it, one window pressed into it in a dark rubber frame with a lightly tinted pane, a handle by the seam where the
// two doors meet, two small hinges on the outer edge. The panel hangs in a leaf part centred on itself.
const DY = 0.56, DH = 0.92, DT = 0.06;                  // the doors' foot, height, thickness
export const HINGE = 0.5, DW = 0.495;                   // the hinges' x; each door's width
const LEAN = (Math.atan2(BACK_LEAN, ROOF - at(SIDE.bottom, BACK0)) * 180) / Math.PI;
const DWIN = { w: 0.3, y0: 0.44, y1: 0.78 };
const doorCuts = [
  { view: "back", points: rr(-DW, -0.1, DW, 0.8 - DY, 0.001, 1), color: LOWER },
  { view: "back", points: rr(-DW, 0.8 - DY, DW, 0.94 - DY, 0.001, 1), color: RED },
  // the window's frame pressed in a little, then the window itself, right through
  { view: "back", points: rr(-DWIN.w / 2 - 0.04, DWIN.y0 - 0.04, DWIN.w / 2 + 0.04, DWIN.y1 + 0.04, 0.08), color: FRAME, depth: u(0.01) },
  { view: "back", points: rr(-DWIN.w / 2, DWIN.y0, DWIN.w / 2, DWIN.y1, 0.055), remove: true, depth: u(DT + 0.04), wall: FRAME },
];
const extrude = (outline, hw) => {
  const verts = [], faces = [], n = outline.length;
  for (const s of [1, -1]) for (const [z, y] of outline) verts.push([s * hw, y, z]);
  faces.push([...Array(n).keys()], [...Array(n).keys()].map((i) => n + i));
  for (let i = 0; i < n; i++) faces.push([i, (i + 1) % n, n + ((i + 1) % n), n + i]);
  return { verts, faces };
};
const door = (name, s) => {
  const slab = extrude([[-DT, 0], [0, 0], [0, DH], [-DT, DH]], DW / 2);
  const leaf = part(`${name}_leaf`, [-s * DW / 2, 0, 0], [
    mesh(slab.verts, slab.faces, CREAM, { modifiers: [{ type: "bevel", width: u(0.025), segments: 3, angle: 30 }, { type: "cutout", cuts: doorCuts }] }),
    // the pane, lightly tinted, in the middle of the door's thickness
    bevelled([0, (DWIN.y0 + DWIN.y1) / 2, -DT / 2], [DWIN.w + 0.03, DWIN.y1 - DWIN.y0 + 0.03, 0.01], GLASS + PANE_ALPHA, { bevel: 0.004 }),
    // the handle, upright, by the seam
    bevelled([-s * (DW / 2 - 0.06), 0.3, -DT - 0.016], [0.04, 0.14, 0.032], INK, { bevel: 0.013, segments: 2 }),
  ]);
  const hinges = [0.14, DH - 0.14].map((y) => cyl([s * 0.005, y, -DT / 2], 0.02, 0.09, INK, { segments: 8 }));
  return part(name, [s * HINGE, DY, backZ(DY) + 0.004], hinges, [leaf], [LEAN, 0, 0]);
};
// the steering wheel: a dark ring-like disc with a lighter middle, tilted up towards the driver; it turns about its column (y)
const steering = part("steering", [STEER.x, STEER.y, STEER.z], [
  cyl([0, 0, 0], 0.11, 0.032, INK, { segments: 18 }),
  cyl([0, 0.012, 0], 0.078, 0.02, shade(PAL.ink, 0.35), { segments: 14 }),
  cyl([0, 0.024, 0], 0.032, 0.02, PAL.mustard, { segments: 10 }),
  bevelled([0.064, 0.026, 0], [0.045, 0.012, 0.03], PAL.mustard, { bevel: 0.005 }), // (a mark so its turning shows)
], [], [STEER.tilt, 0, 0]);

export const van = model([
  part("body", [0, 0, 0], body, [door("door_l", 1), door("door_r", -1), steering, lampHead, lampAmberF, lampTail, lampAmberB, lampRevOff, lampBrake, lampReverse]),
  wheel("wheel_fl", TR, AXF), wheel("wheel_fr", -TR, AXF), wheel("wheel_rl", TR, AXR), wheel("wheel_rr", -TR, AXR),
], { boxes: [{ x: 0, z: (Z0 + Z1) / 2, hw: HW + 0.02, hl: (Z1 - Z0) / 2, turn: 0 }] });

// The measures, checked against the reference's (printed by the recipe; the tests read the model).
export function measures() {
  const ys = SKIN.verts.map((v) => v[1]);
  return {
    length: Z1 - Z0, width: W, height: Math.max(ROOF + 0.03, ...ys), wheel: 2 * R,
    ratio: [1, W / (Z1 - Z0), (ROOF + 0.03) / (Z1 - Z0)].map((v) => Math.round(v * 100) / 100),
    nose: NOSE_TOP - END.nose * 0.4, bonnet: (NOSE0 + END.nose - WS.base[0]) / (Z1 - Z0),
    windscreen_lean_deg: (Math.atan2(WS.base[0] - WS.top[0], WS.top[1] - WS.base[1]) * 180) / Math.PI,
    rear_wheel_at: (Z1 - AXR) / (Z1 - Z0), wheel_to_height: (2 * R) / (ROOF + 0.03),
    sweep_deg: 25, doorway: (doorFront(1.0) - DOORWAY.z0) / (Z1 - Z0),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(measures()));
  tool("model_write", { name: "van", model: van });
  const views = { "van-34": [35, 12], "van-back-34": [215, 10], "van-side": [90, 0], "van-front": [0, 0], "van-back": [180, 0], "van-top": [90, 89] };
  for (const [name, [yaw, pitch]] of Object.entries(views)) tool("model_preview", { name: "van", yaw, pitch, width: 1280, height: 720, image_out: `build/look/${name}.png` });
}
