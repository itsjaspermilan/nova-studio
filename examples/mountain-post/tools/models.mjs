// Fernhollow's buildings and things, each a model_write document built here from simple shapes (tools/geo.mjs) in one set of
// flat warm colours. Run: scripts/env.sh node examples/mountain-post/tools/models.mjs [name ...]  (no names: all of them)
// Every model stands on y = 0 and faces +z (its door, its front); what blocks the walker or the van is in its `boxes` and
// `colliders` (world units), which nova.scenery and nova.model_shapes read.
import { bevelled, box as hardBox, cone, cyl, gable, gableEnd, mesh, model, one, part, rng, shade, tube } from "./geo.mjs";
import { tool } from "./lib.mjs";
import { PAL, soft } from "./palette.mjs";

// The game's one look (tools/palette.mjs): every colour here is one of the palette's, and every box is softened as it is made
// (`box` below), every other solid when the model is written (`toy`).
const C = {
  plank: PAL.wood, plankDark: PAL.woodDark, log: PAL.log, logDark: shade(PAL.log, -0.18), cream: PAL.cream, roof: PAL.slate, roofRed: PAL.roofRed,
  stone: PAL.stone, stoneDark: PAL.stoneDark, moss: PAL.moss, wood: PAL.wood, woodLight: PAL.woodLight, paint: PAL.sky, glass: PAL.glass,
  window: PAL.lit, dark: PAL.ink, iron: shade(PAL.ink, 0.12), white: PAL.white, red: PAL.red, green: PAL.teal, sign: PAL.woodDark,
  paper: "#d8b886", string: PAL.paper, floor: PAL.wood, wall: "#d2b88f", dust: "#bfb097", mustard: PAL.mustard, rose: PAL.rose, metal: PAL.metal,
};
// A box with soft toy edges: rounded by a quarter of its thinnest side (palette.mjs `soft`), turned as `rot` says.
const box = (c, size, color, o = {}) => (Math.min(...size) < 0.03 ? hardBox(c, size, color, o) : bevelled(c, size, color, { bevel: soft(size), segments: Math.min(...size) > 0.15 ? 2 : 1, ...o }));
// Every other solid of a model made toy-like when it is written: round shapes shaded smooth; closed meshes without a stack of their
// own get a soft bevel (a roof, a gable, a sign board).
function toy(doc) {
  const walk = (p) => {
    for (const c of p.cubes ?? []) {
      if (c.shape === "cylinder" || c.shape === "cone" || c.shape === "sphere") c.smooth = true;
      if (c.shape === "tube") c.segments = Math.max(c.segments ?? 6, 8);
      // (a sheet seen from both sides, a fern's frond or a flag, has each face twice: it has no edge to round)
      const sheet = c.shape === "mesh" && c.polys.every((p) => c.polys.filter((q) => [...q.v].sort().join() === [...p.v].sort().join()).length === 2);
      if (c.shape === "mesh" && !c.modifiers && c.polys.length >= 4 && !sheet) {
        const xs = c.verts.map((v) => v[0]), ys = c.verts.map((v) => v[1]), zs = c.verts.map((v) => v[2]);
        const thin = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), Math.max(...zs) - Math.min(...zs)) / 16;
        if (thin >= 0.05) c.modifiers = [{ type: "bevel", width: 0.56, segments: 2, angle: 30 }]; // (3.5 cm: a slab's edge, whatever its size)
      }
    }
    for (const ch of p.children ?? []) walk(ch);
  };
  doc.parts.forEach(walk);
  return doc;
}
const made = {};
const def = (name, fn) => (made[name] = fn);

// ---- the post office, outside ------------------------------------------------------------------------------------------------------------
// 9 m wide, 6.4 m deep, its porch along the front (+z) up three steps; the door in the middle; a faded sign over the porch roof.
def("post_office", () => {
  const W = 9, D = 6.4, H = 3.2, base = 0.45;
  const c = [];
  c.push(box([0, base / 2, 0], [W + 0.3, base, D + 0.3], C.stoneDark)); // the stone footing
  c.push(box([0, base + H / 2, 0], [W, H, D], C.plank));
  for (let y = base + 0.3; y < base + H; y += 0.32) for (const s of [1, -1]) c.push(box([0, y, s * (D / 2 + 0.01)], [W + 0.02, 0.04, 0.02], C.plankDark)); // board lines
  for (let y = base + 0.3; y < base + H; y += 0.32) for (const s of [1, -1]) c.push(box([s * (W / 2 + 0.01), y, 0], [0.02, 0.04, D + 0.02], C.plankDark));
  for (const sx of [1, -1]) for (const sz of [1, -1]) c.push(box([sx * (W / 2), base + H / 2, sz * (D / 2)], [0.22, H + 0.02, 0.22], C.cream)); // corner boards
  c.push(gableAlongX(W, D, base + H, base + H + 2.2));
  for (const s of [1, -1]) c.push(gableSide(s * W / 2, D, base + H, base + H + 2.2, C.plank));
  // the porch: a deck, steps, posts, a lean-to roof
  const pz = D / 2 + 1.1;
  c.push(box([0, base - 0.06, pz], [W - 1.2, 0.12, 2.2], C.woodLight));
  for (let i = 0; i < 3; i++) c.push(box([0, base - 0.15 * (i + 1) + 0.0, D / 2 + 2.3 + i * 0.3], [2.2, 0.15, 0.3], shade(C.woodLight, -0.1 * i)));
  for (const s of [-3.6, -1.2, 1.2, 3.6]) c.push(box([s, base + 1.25, D / 2 + 2.05], [0.16, 2.5, 0.16], C.cream));
  c.push(mesh([[-W / 2 + 0.4, base + 2.9, D / 2], [W / 2 - 0.4, base + 2.9, D / 2], [W / 2 - 0.4, base + 2.45, D / 2 + 2.45], [-W / 2 + 0.4, base + 2.45, D / 2 + 2.45],
    [-W / 2 + 0.4, base + 2.8, D / 2], [W / 2 - 0.4, base + 2.8, D / 2], [W / 2 - 0.4, base + 2.35, D / 2 + 2.45], [-W / 2 + 0.4, base + 2.35, D / 2 + 2.45]],
    [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]], C.roofRed));
  c.push(box([0, base + 2.42, D / 2 + 2.08], [W - 0.7, 0.14, 0.12], C.cream));
  // a rail either side of the steps
  for (const s of [1, -1]) {
    c.push(box([s * 2.5, base + 0.5, D / 2 + 2.05], [2.2, 0.08, 0.08], C.cream));
    for (const x of [1.6, 2.6, 3.5]) c.push(box([s * x, base + 0.25, D / 2 + 2.05], [0.06, 0.5, 0.06], C.cream));
  }
  // windows either side of the door, with cream frames and a box of flowers under one
  for (const s of [1, -1]) {
    c.push(box([s * 2.6, base + 1.65, D / 2 + 0.02], [1.3, 1.1, 0.06], C.cream));
    c.push(box([s * 2.6, base + 1.65, D / 2 + 0.05], [1.1, 0.9, 0.04], PAL.glass));
    c.push(box([s * 2.6, base + 1.65, D / 2 + 0.08], [0.06, 0.9, 0.03], C.cream));
    c.push(box([s * 2.6, base + 1.07, D / 2 + 0.12], [1.4, 0.08, 0.2], C.cream));
  }
  c.push(box([-2.6, base + 0.9, D / 2 + 0.22], [1.2, 0.22, 0.25], C.plankDark));
  for (let i = 0; i < 5; i++) c.push(box([-3.1 + i * 0.25, base + 1.07, D / 2 + 0.22], [0.14, 0.12, 0.14], i % 2 ? PAL.mustard : PAL.red));
  // the door frame (the door is its own part) and a lamp over it
  c.push(box([0, base + 1.12, D / 2 + 0.03], [1.36, 2.3, 0.06], C.cream));
  c.push(box([0, base + 2.45, D / 2 + 0.15], [0.16, 0.2, 0.16], C.iron));
  // the sign board over the porch roof (its words are drawn by the game)
  c.push(box([0, base + 3.35, D / 2 + 0.08], [4.2, 0.85, 0.12], shade(PAL.slate, -0.3)));
  c.push(box([0, base + 3.35, D / 2 + 0.03], [4.4, 1.0, 0.08], C.cream));
  // the chimney, stone, at the back right
  c.push(box([2.6, base + H + 1.9, -1.4], [0.75, 2.4, 0.75], C.stone));
  c.push(box([2.6, base + H + 3.12, -1.4], [0.9, 0.16, 0.9], C.stoneDark));
  // a bench on the porch, a post box at the steps' foot
  c.push(box([2.9, base + 0.42, D / 2 + 0.4], [1.5, 0.08, 0.4], C.wood));
  for (const s of [2.25, 3.55]) c.push(box([s, base + 0.2, D / 2 + 0.4], [0.08, 0.4, 0.36], C.plankDark));
  c.push(bevelled([1.75, 0.6, D / 2 + 3.6], [0.5, 1.2, 0.5], C.red, { bevel: 0.08 }));
  c.push(box([1.75, 1.25, D / 2 + 3.6], [0.6, 0.12, 0.6], shade(C.red, -0.25)));
  c.push(box([1.75, 0.95, D / 2 + 3.86], [0.3, 0.05, 0.02], C.dark));
  const door = part("door", [-0.55, base, D / 2 + 0.04], [box([0.55, 1.05, 0], [1.1, 2.1, 0.08], PAL.teal), box([0.55, 1.5, 0.05], [0.7, 0.6, 0.02], PAL.glass), box([0.95, 1.0, 0.07], [0.07, 0.14, 0.05], PAL.mustard)]);
  return model([part("body", [0, 0, 0], c.filter(Boolean)), door], { boxes: [{ x: 0, z: 0, hw: W / 2 + 0.2, hl: D / 2 + 0.2, turn: 0 }, { x: 3.3, z: D / 2 + 1.1, hw: 1.0, hl: 1.1, turn: 0 }, { x: -3.3, z: D / 2 + 1.1, hw: 1.0, hl: 1.1, turn: 0 }], colliders: [{ x: 1.75, z: D / 2 + 3.6, r: 0.4 }] });
});
// a gable roof whose ridge runs along x (the long side), and the triangle of wall under it at each end
function gableAlongX(W, D, y0, y1) {
  const hw = W / 2 + 0.4, hd = D / 2 + 0.5, th = 0.14;
  const v = [[-hw, y0, -hd], [-hw, y1, 0], [-hw, y0, hd], [hw, y0, -hd], [hw, y1, 0], [hw, y0, hd], [-hw, y0 - th, -hd], [-hw, y1 - th, 0], [-hw, y0 - th, hd], [hw, y0 - th, -hd], [hw, y1 - th, 0], [hw, y0 - th, hd]];
  return mesh(v, [[0, 1, 4, 3], [1, 2, 5, 4], [6, 9, 10, 7], [7, 10, 11, 8], [0, 3, 9, 6], [2, 8, 11, 5], [0, 6, 7, 1], [1, 7, 8, 2], [3, 4, 10, 9], [4, 5, 11, 10]], C.roof, { inside: [0, (y0 + y1) / 2 - 0.3, 0] });
}
function gableSide(x, D, y0, y1, color) {
  return mesh([[x - 0.06, y0, -D / 2], [x - 0.06, y0, D / 2], [x - 0.06, y1 - 0.15, 0], [x + 0.06, y0, -D / 2], [x + 0.06, y0, D / 2], [x + 0.06, y1 - 0.15, 0]], [[0, 1, 2], [3, 5, 4], [0, 3, 4, 1], [1, 4, 5, 2], [2, 5, 3, 0]], color);
}

// ---- the post office, inside: a room 7 x 5 m, the door in the front wall (+z), a window in the right-hand wall --------------------------
def("office_room", () => {
  const X = 3.5, Z = 2.6, H = 3.0;
  const c = [];
  c.push(box([0, -0.05, 0], [2 * X + 0.4, 0.1, 2 * Z + 0.4], C.floor));
  for (let x = -X + 0.25; x < X; x += 0.5) c.push(box([x, 0.003, 0], [0.02, 0.01, 2 * Z], shade(C.floor, -0.2))); // floorboards
  // the walls, each a thick slab; the front one with a door gap, the right one (-x) with a window gap
  const wall = (cx, cz, w, d, h = H, y = H / 2) => c.push(box([cx, y, cz], [w, h, d], C.wall));
  wall(0, -Z - 0.1, 2 * X + 0.4, 0.2);
  wall(X + 0.1, 0, 0.2, 2 * Z);
  // the front: either side of the door (1.1 wide at x = 0.9) and over it
  wall((-X + 0.35) / 2, Z + 0.1, X + 0.35, 0.2);
  wall((X + 1.45) / 2, Z + 0.1, X - 1.45, 0.2);
  wall(0.9, Z + 0.1, 1.1, 0.2, H - 2.15, 2.15 + (H - 2.15) / 2);
  // the right-hand wall with a window 1.4 wide, 1.2 high
  wall(-X - 0.1, (-Z - 0.7) / 2 - 0.0, 0.2, Z - 0.7 + 0.0001 + 0.0);
  wall(-X - 0.1, (Z + 0.7) / 2, 0.2, Z - 0.7);
  wall(-X - 0.1, 0, 0.2, 1.4, 1.0, 0.5);
  wall(-X - 0.1, 0, 0.2, 1.4, H - 2.2, 2.2 + (H - 2.2) / 2);
  c.push(box([-X - 0.06, 1.6, 0], [0.08, 1.24, 1.5], C.cream));
  c.push(box([-X - 0.12, 1.6, 0], [0.04, 1.2, 1.4], shade(PAL.lit, 0.4), { emissive: 0.9 })); // the bright day outside
  c.push(box([-X + 0.02, 1.6, 0], [0.04, 1.2, 0.06], C.cream));
  c.push(box([-X + 0.02, 1.6, 0], [0.04, 0.06, 1.4], C.cream));
  c.push(box([-X + 0.1, 0.98, 0], [0.22, 0.06, 1.6], C.cream)); // the sill
  // a wainscot and a picture rail round the walls
  for (const [cx, cz, w, d] of [[0, -Z + 0.01, 2 * X, 0.02], [X - 0.01, 0, 0.02, 2 * Z]]) {
    c.push(box([cx, 0.5, cz], [w, 1.0, d], shade(C.wall, -0.18)));
    c.push(box([cx, 2.45, cz], [w, 0.06, d + 0.02], shade(C.wall, -0.3)));
  }
  // the ceiling and its beams
  c.push(box([0, H + 0.05, 0], [2 * X + 0.4, 0.1, 2 * Z + 0.4], shade(C.wall, -0.3)));
  for (let x = -X + 0.8; x < X; x += 1.6) c.push(box([x, H - 0.1, 0], [0.18, 0.2, 2 * Z], C.plankDark));
  // the door (a gap; the doorway is bright: the porch in the sun)
  c.push(box([0.9, 1.07, Z + 0.22], [1.1, 2.15, 0.02], shade(PAL.lit, 0.3), { emissive: 0.85 }));
  // the counter: across the room in front of the shelves, a flap at its left end
  // (at the height of the cast: villagers a little over a metre tall, who look over it)
  c.push(box([0.4, 0.36, -0.6], [4.2, 0.72, 0.7], C.wood));
  c.push(box([0.4, 0.76, -0.6], [4.4, 0.08, 0.85], C.woodLight));
  for (let x = -1.5; x <= 2.3; x += 0.95) c.push(box([x, 0.36, -0.24], [0.04, 0.64, 0.02], shade(C.wood, -0.3)));
  c.push(cyl([1.6, 0.84, -0.6], 0.08, 0.06, PAL.mustard)); // a bell
  c.push(cone([1.6, 0.92, -0.6], 0.07, 0.1, PAL.mustard));
  c.push(box([-0.8, 0.85, -0.5], [0.42, 0.1, 0.32], shade(PAL.metal, -0.3))); // scales
  c.push(box([-0.8, 1.02, -0.5], [0.3, 0.03, 0.3], PAL.metal));
  c.push(box([2.1, 0.82, -0.75], [0.3, 0.04, 0.22], PAL.paper)); // a ledger
  // the pigeonholes on the back wall: a grid of cubbies, mostly empty
  const px0 = -2.6, py0 = 1.15, cw = 0.36, ch = 0.3, cols = 10, rows = 4;
  c.push(box([px0 + (cols * cw) / 2, py0 + (rows * ch) / 2, -Z + 0.2], [cols * cw + 0.08, rows * ch + 0.08, 0.36], C.plankDark));
  for (let i = 0; i <= cols; i++) c.push(box([px0 + i * cw, py0 + (rows * ch) / 2, -Z + 0.38], [0.03, rows * ch, 0.04], C.wood));
  for (let j = 0; j <= rows; j++) c.push(box([px0 + (cols * cw) / 2, py0 + j * ch, -Z + 0.38], [cols * cw, 0.03, 0.04], C.wood));
  const R = rng(4);
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) if (R() < 0.12) c.push(box([px0 + (i + 0.5) * cw, py0 + j * ch + 0.08, -Z + 0.22], [0.24, 0.12, 0.2], R() < 0.5 ? PAL.paper : shade(PAL.paper, -0.12), { rot: [0, 0, R() * 20 - 10] }));
  c.push(box([px0 + (cols * cw) / 2, py0 + rows * ch + 0.06, -Z + 0.22], [cols * cw, 0.04, 0.3], C.dust)); // dust on the top
  // the shelf of what is to go out today (left wall, +x): three boards on brackets
  for (let j = 0; j < 3; j++) c.push(box([X - 0.25, 0.42 + j * 0.42, 1.0], [0.42, 0.05, 1.4], C.woodLight));
  for (const z of [0.4, 1.6]) c.push(box([X - 0.1, 0.65, z], [0.08, 1.3, 0.06], C.plankDark));
  // a noticeboard with yellowed papers, a calendar, a clock that has stopped
  c.push(box([X - 0.03, 1.8, -1.2], [0.04, 0.8, 1.1], PAL.wood));
  for (const [y, z, w, h] of [[1.95, -1.45, 0.3, 0.38], [1.75, -1.0, 0.36, 0.3], [1.6, -1.42, 0.25, 0.2]]) c.push(box([X - 0.06, y, z], [0.02, h, w], shade(PAL.paper, -0.08), { rot: [0, 0, 0] }));
  c.push(box([2.6, 2.1, -Z + 0.03], [0.5, 0.65, 0.02], PAL.paper));
  c.push(box([2.6, 2.32, -Z + 0.045], [0.5, 0.18, 0.02], C.red));
  c.push(cyl([-2.9, 2.2, -Z + 0.06], 0.22, 0.06, C.plankDark, { axis: "z", segments: 14 }));
  c.push(cyl([-2.9, 2.2, -Z + 0.1], 0.18, 0.02, PAL.paper, { axis: "z", segments: 14 }));
  // a rug, a stool, a stove in the corner, a sack of old mail, cobwebs
  c.push(box([0.9, 0.012, 1.4], [1.6, 0.02, 1.0], PAL.redDark));
  c.push(box([0.9, 0.018, 1.4], [1.3, 0.02, 0.7], PAL.rose));
  c.push(cyl([-1.2, 0.35, 0.2], 0.2, 0.06, C.wood, { segments: 10 }));
  for (const [dx, dz] of [[-0.12, -0.12], [0.12, -0.12], [-0.12, 0.12], [0.12, 0.12]]) c.push(box([-1.2 + dx, 0.17, 0.2 + dz], [0.04, 0.34, 0.04], C.plankDark));
  c.push(cyl([-2.9, 0.45, -1.9], 0.32, 0.9, PAL.ink, { segments: 10 }));
  c.push(cyl([-2.9, 1.9, -1.9], 0.08, 2.1, PAL.ink, { segments: 8 }));
  c.push(bevelled([2.7, 0.3, 2.0], [0.7, 0.6, 0.5], shade(PAL.woodLight, -0.18), { bevel: 0.12, taper: 0.7 }));
  c.push(mesh([[X - 0.02, H - 0.02, -Z + 0.02], [X - 0.6, H - 0.02, -Z + 0.02], [X - 0.02, H - 0.55, -Z + 0.02], [X - 0.03, H - 0.02, -Z + 0.6]], [[0, 1, 2], [0, 2, 3], [0, 3, 1], [1, 3, 2]], PAL.white));
  return model([part("body", [0, 0, 0], c)], {
    boxes: [
      { x: 0, z: -Z - 0.1, hw: X + 0.2, hl: 0.15, turn: 0 }, { x: X + 0.1, z: 0, hw: 0.15, hl: Z + 0.2, turn: 0 }, { x: -X - 0.1, z: 0, hw: 0.15, hl: Z + 0.2, turn: 0 },
      { x: (-X + 0.35) / 2, z: Z + 0.1, hw: (X + 0.35) / 2, hl: 0.15, turn: 0 }, { x: (X + 1.45) / 2, z: Z + 0.1, hw: (X - 1.45) / 2, hl: 0.15, turn: 0 },
      { x: 0.4, z: -0.6, hw: 2.2, hl: 0.42, turn: 0 }, { x: X - 0.25, z: 1.0, hw: 0.25, hl: 0.75, turn: 0 }, { x: -2.9, z: -1.9, hw: 0.35, hl: 0.35, turn: 0 }, { x: 2.7, z: 2.0, hw: 0.38, hl: 0.3, turn: 0 },
    ],
  });
});

// ---- parcels and the letter ----------------------------------------------------------------------------------------------------------
// (a soft brown-paper bundle; its string is a band as rounded as the parcel, a hair bigger, so it hugs the corners)
const parcel = (w, h, d, paper) => one([
  box([0, h / 2, 0], [w, h, d], paper, { bevel: 0.024 }),
  bevelled([0, h / 2, 0], [w + 0.012, h + 0.012, 0.035], C.string, { bevel: 0.017, segments: 2 }),
  bevelled([0, h / 2, 0], [0.035, h + 0.012, d + 0.012], C.string, { bevel: 0.017, segments: 2 }),
  box([w * 0.18, h + 0.006, d * 0.2], [w * 0.4, 0.004, d * 0.3], C.white), box([w * 0.32, h + 0.008, -d * 0.3], [0.08, 0.004, 0.06], PAL.red),
]);
def("parcel_hazel", () => parcel(0.5, 0.18, 0.34, PAL.woodLight)); // chisels: long and flat
def("parcel_pip", () => parcel(0.32, 0.3, 0.32, shade(PAL.woodLight, -0.1))); // a valve: a cube
def("letter", () => one([box([0, 0.005, 0], [0.24, 0.01, 0.16], PAL.paper), box([0, 0.011, 0.02], [0.24, 0.002, 0.09], shade(PAL.paper, -0.06)), box([0.08, 0.012, -0.04], [0.04, 0.003, 0.05], C.red)]));

// ---- Hazel's cabin and workshop (No. 3) ------------------------------------------------------------------------------------------------
def("cabin_hazel", () => {
  const W = 7.5, D = 6, H = 2.9, base = 0.35;
  const c = [box([0, base / 2, 0], [W + 0.3, base, D + 0.3], C.stoneDark)];
  for (let y = base + 0.15; y < base + H; y += 0.3) {
    for (const s of [1, -1]) c.push(cyl([0, y, s * D / 2], 0.16, W + 0.5, shade(C.log, (y * 7) % 2 > 1 ? -0.08 : 0), { axis: "x", segments: 6 }));
    for (const s of [1, -1]) c.push(cyl([s * W / 2, y + 0.15, 0], 0.16, D + 0.5, shade(C.log, -0.05), { axis: "z", segments: 6 }));
  }
  c.push(box([0, base + H / 2, 0], [W - 0.2, H, D - 0.2], C.logDark));
  c.push(gableAlongX(W, D + 0.4, base + H + 0.1, base + H + 2.3));
  for (const s of [1, -1]) c.push(gableSide(s * W / 2, D, base + H + 0.1, base + H + 2.3, C.log));
  // the door (front, left of middle), windows with warm light, a porch roof on two posts
  c.push(box([-1.0, base + 1.05, D / 2 + 0.2], [1.1, 2.1, 0.1], PAL.woodDark));
  c.push(box([-0.6, base + 1.0, D / 2 + 0.26], [0.08, 0.12, 0.05], PAL.mustard));
  for (const x of [1.5, 2.9]) {
    c.push(box([x, base + 1.6, D / 2 + 0.2], [1.0, 0.9, 0.08], C.cream));
    c.push(box([x, base + 1.6, D / 2 + 0.25], [0.8, 0.7, 0.04], PAL.lit, { emissive: 0.45 }));
  }
  c.push(box([0, base + 2.75, D / 2 + 1.1], [W - 1, 0.12, 2.1], C.roof, { rot: [10, 0, 0] }));
  for (const x of [-3.2, 3.2]) c.push(box([x, base + 1.35, D / 2 + 1.95], [0.18, 2.7, 0.18], C.log));
  c.push(box([0, base - 0.05, D / 2 + 1.1], [W - 1, 0.12, 2.0], C.woodLight));
  // a stone chimney on the left end
  c.push(box([W / 2 + 0.35, 2.5, -0.8], [0.9, 5.0, 1.0], C.stone));
  c.push(box([W / 2 + 0.35, 5.3, -0.8], [0.7, 0.6, 0.8], C.stoneDark));
  // a rocking chair on the porch
  c.push(box([2.2, base + 0.45, D / 2 + 1.0], [0.55, 0.06, 0.5], C.wood));
  c.push(box([2.2, base + 0.85, D / 2 + 0.78], [0.55, 0.8, 0.06], C.wood));
  return model([part("body", [0, 0, 0], c)], { boxes: [{ x: 0, z: 0, hw: W / 2 + 0.3, hl: D / 2 + 0.3, turn: 0 }, { x: W / 2 + 0.35, z: -0.8, hw: 0.5, hl: 0.55, turn: 0 }] });
});
def("workshop", () => {
  const c = [];
  for (const [x, z] of [[-2, -1.4], [2, -1.4], [-2, 1.4], [2, 1.4]]) c.push(box([x, 1.3, z], [0.18, 2.6, 0.18], C.log));
  c.push(box([0, 2.7, 0], [4.8, 0.14, 3.6], C.roofRed, { rot: [8, 0, 0] }));
  c.push(box([0, 1.2, -1.5], [4.2, 2.4, 0.1], C.plank));
  c.push(box([0, 0.85, -1.05], [3.2, 0.08, 0.7], C.woodLight)); // the bench
  for (const x of [-1.4, 1.4]) c.push(box([x, 0.42, -1.05], [0.1, 0.84, 0.6], C.plankDark));
  // tools on the back wall: a saw, a mallet, a row of hooks
  c.push(box([-0.8, 1.6, -1.42], [0.8, 0.22, 0.02], PAL.metal));
  c.push(box([-0.35, 1.6, -1.42], [0.18, 0.12, 0.04], C.wood));
  c.push(box([0.6, 1.55, -1.42], [0.06, 0.5, 0.04], C.wood));
  c.push(box([0.6, 1.8, -1.42], [0.2, 0.12, 0.08], C.plankDark));
  c.push(box([1.3, 1.5, -1.42], [0.3, 0.4, 0.03], shade(PAL.metal, -0.2)));
  return model([part("body", [0, 0, 0], c)], { boxes: [{ x: 0, z: -1.2, hw: 2.2, hl: 0.4, turn: 0 }], colliders: [{ x: -2, z: 1.4, r: 0.15 }, { x: 2, z: 1.4, r: 0.15 }] });
});
def("sawhorse", () => {
  const c = [box([0, 0.75, 0], [1.2, 0.1, 0.12], C.woodLight)];
  for (const sx of [1, -1]) for (const sz of [1, -1]) c.push(box([sx * 0.45, 0.37, sz * 0.14], [0.08, 0.8, 0.08], C.wood, { rot: [sz * 14, 0, 0] }));
  return one(c, { colliders: [{ x: 0, z: 0, r: 0.5 }] });
});
def("planks", () => {
  const c = [], R = rng(9);
  for (let j = 0; j < 6; j++) for (let i = 0; i < 4; i++) c.push(box([(i - 1.5) * 0.24 + (R() - 0.5) * 0.04, 0.1 + j * 0.07, (R() - 0.5) * 0.2], [0.22, 0.06, 2.4 + R() * 0.3], shade(C.woodLight, (R() - 0.5) * 0.25)));
  for (const z of [-0.9, 0.9]) c.push(box([0, 0.04, z], [1.1, 0.08, 0.1], C.plankDark));
  return one(c, { boxes: [{ x: 0, z: 0, hw: 0.55, hl: 1.25, turn: 0 }] });
});
def("plank_held", () => one([box([0, 0, 0], [0.12, 0.05, 1.3], C.woodLight)]));

// ---- Pip's cabin (No. 7) and the mast -------------------------------------------------------------------------------------------------
def("cabin_pip", () => {
  const W = 6, D = 5, H = 2.7, base = 0.4;
  const c = [box([0, base / 2, 0], [W + 0.2, base, D + 0.2], C.stoneDark), box([0, base + H / 2, 0], [W, H, D], C.paint)];
  for (let x = -W / 2 + 0.25; x < W / 2; x += 0.3) for (const s of [1, -1]) c.push(box([x, base + H / 2, s * (D / 2 + 0.01)], [0.03, H, 0.02], shade(C.paint, -0.18)));
  c.push(gable([0, 0, 0], W, D, base + H, base + H + 1.9, C.roofRed, { over: 0.4 }));
  for (const s of [1, -1]) c.push(gableEnd(-W / 2, W / 2, base + H, base + H + 1.8, s * D / 2, C.paint));
  // hmm: gable() runs its ridge along z: the ends are at ±D/2 and the triangle walls fill them
  c.push(box([0.9, base + 1.05, D / 2 + 0.03], [1.0, 2.1, 0.08], PAL.mustard)); // a yellow door
  c.push(cyl([1.25, base + 1.0, D / 2 + 0.1], 0.04, 0.05, C.dark, { axis: "z" }));
  c.push(box([-1.3, base + 1.6, D / 2 + 0.03], [1.1, 0.9, 0.06], C.cream));
  c.push(box([-1.3, base + 1.6, D / 2 + 0.07], [0.9, 0.7, 0.04], PAL.lit, { emissive: 0.4 }));
  c.push(box([0, base - 0.05, D / 2 + 0.8], [W - 0.6, 0.12, 1.5], C.woodLight));
  for (const x of [-2.5, 2.5]) c.push(box([x, base + 1.2, D / 2 + 1.45], [0.14, 2.4, 0.14], C.cream));
  c.push(box([0, base + 2.45, D / 2 + 0.85], [W - 0.4, 0.1, 1.6], C.roofRed, { rot: [12, 0, 0] }));
  // the radio: a box on the porch with a dial and a speaker horn on the wall
  c.push(box([-2.0, base + 0.5, D / 2 + 0.55], [0.9, 0.7, 0.5], PAL.woodDark));
  c.push(cyl([-2.2, base + 0.6, D / 2 + 0.82], 0.12, 0.04, PAL.mustard, { axis: "z", segments: 12 }));
  c.push(cyl([-1.8, base + 0.6, D / 2 + 0.82], 0.08, 0.04, PAL.ink, { axis: "z", segments: 10 }));
  c.push(cone([2.6, base + 2.1, D / 2 + 0.2], 0.22, 0.4, PAL.metal));
  // a bunting of little flags under the porch roof
  for (let i = 0; i < 9; i++) c.push(mesh([[-2.4 + i * 0.6, base + 2.25, D / 2 + 1.42], [-2.1 + i * 0.6, base + 2.25, D / 2 + 1.42], [-2.25 + i * 0.6, base + 1.98, D / 2 + 1.42], [-2.25 + i * 0.6, base + 2.25, D / 2 + 1.44]], [[0, 1, 2], [0, 2, 3], [1, 3, 2], [0, 3, 1]], [PAL.red, PAL.mustard, PAL.sky, PAL.leaf][i % 4]));
  c.push(box([2.4, base + H + 0.9, -1.0], [0.5, 1.6, 0.5], C.stone));
  return model([part("body", [0, 0, 0], c)], { boxes: [{ x: 0, z: 0, hw: W / 2 + 0.2, hl: D / 2 + 0.2, turn: 0 }] });
});
def("mast", () => {
  // a home-made lattice mast: three legs, rungs, a crosspiece and a little dish at the top; guy wires are drawn by the game
  const c = [], h = 15, legs = [[0.32, 0], [-0.16, 0.28], [-0.16, -0.28]];
  for (const [x, z] of legs) c.push(tube([[x, 0, z], [x * 0.4, h, z * 0.4]], 0.065, PAL.metal, { segments: 5 }));
  // (painted bands, red and white, so it reads from across the valley)
  for (let y = 1.5, k = 0; y < h; y += 1.5, k++) c.push(box([0, y, 0], [0.62 * (1 - (y / h) * 0.6), 0.5, 0.62 * (1 - (y / h) * 0.6)], k % 2 ? PAL.white : PAL.red));
  for (let y = 0.6; y < h; y += 0.75) {
    const k = 1 - (y / h) * 0.6;
    for (let i = 0; i < 3; i++) {
      const [ax, az] = legs[i], [bx, bz] = legs[(i + 1) % 3];
      c.push(tube([[ax * k, y, az * k], [bx * k, y + 0.35, bz * k]], 0.035, shade(PAL.metal, -0.1), { segments: 3 }));
    }
  }
  c.push(box([0, h + 0.1, 0], [1.6, 0.06, 0.06], PAL.metal));
  c.push(box([0, h + 0.1, 0], [0.06, 0.06, 1.2], PAL.metal));
  c.push(tube([[0, h, 0], [0, h + 1.4, 0]], 0.03, PAL.metal));
  c.push(cyl([0, h + 1.45, 0], 0.09, 0.12, C.red, { emissive: 0.6 }));
  c.push(cone([0.5, h - 1.2, 0.3], 0.35, 0.25, shade(PAL.metal, 0.2)));
  c.push(box([0, 0.1, 0], [1.0, 0.2, 1.0], C.stoneDark));
  return one(c, { colliders: [{ x: 0, z: 0, r: 0.6 }] });
});

// ---- by the roads ---------------------------------------------------------------------------------------------------------------------
def("signpost", () => {
  // a post with up to two arms; each arm is a pointed board whose words the game draws (sprites/fx/sign_*)
  const c = [box([0, 2.1, 0], [0.24, 4.2, 0.24], C.sign), box([0, 4.25, 0], [0.32, 0.12, 0.32], shade(C.sign, 0.2)), box([0, 0.15, 0], [0.5, 0.3, 0.5], C.stoneDark)];
  return one(c, { colliders: [{ x: 0, z: 0, r: 0.15 }] });
});
def("sign_arm", () => {
  // one arm, pointing along +x from the post (the board 3.2 x 0.62, the point at +x: big enough to read from a moving van)
  const L = 3.2, h = 0.62, t = 0.06;
  const v = [[0.08, -h / 2, -t], [L - 0.34, -h / 2, -t], [L, 0, -t], [L - 0.34, h / 2, -t], [0.08, h / 2, -t], [0.08, -h / 2, t], [L - 0.34, -h / 2, t], [L, 0, t], [L - 0.34, h / 2, t], [0.08, h / 2, t]];
  return one([mesh(v, [[0, 1, 2, 3, 4], [5, 9, 8, 7, 6], [0, 5, 6, 1], [1, 6, 7, 2], [2, 7, 8, 3], [3, 8, 9, 4], [4, 9, 5, 0]], C.sign, { inside: [L / 2, 0, 0] })]);
});
def("mailbox", () => one([
  box([0, 0.4, 0], [0.12, 0.8, 0.12], C.sign),
  bevelled([0, 0.92, 0.05], [0.36, 0.3, 0.55], PAL.teal, { bevel: 0.06 }),
  box([0.2, 1.0, 0.12], [0.03, 0.25, 0.04], C.red),
  box([0, 0.9, 0.33], [0.26, 0.2, 0.02], shade(PAL.teal, -0.3)),
], { colliders: [{ x: 0, z: 0, r: 0.15 }] }));
def("gate_post", () => one([box([0, 0.7, 0], [0.2, 1.4, 0.2], C.log), box([0, 1.42, 0], [0.24, 0.06, 0.24], C.logDark)], { colliders: [{ x: 0, z: 0, r: 0.15 }] }));
def("fence", () => {
  // a split-rail fence, 3 m along x
  const c = [];
  for (const x of [-1.5, 1.5]) c.push(box([x, 0.55, 0], [0.14, 1.1, 0.14], C.log));
  for (const y of [0.45, 0.85]) c.push(box([0, y, 0], [3.1, 0.09, 0.08], C.wood, { rot: [0, 0, y > 0.6 ? 1.5 : -1] }));
  return one(c, { capsules: [{ ax: -1.5, az: 0, bx: 1.5, bz: 0, r: 0.12 }] });
});
def("stone_wall", () => {
  // an old dry-stone wall, 4 m along x: stacked stones, moss on top
  const c = [], R = rng(3);
  for (let row = 0; row < 3; row++) for (let i = 0; i < 6; i++) {
    const x = -1.75 + i * 0.7 + (row % 2) * 0.3 + (R() - 0.5) * 0.08;
    if (x > 1.85) continue;
    c.push(bevelled([x, 0.16 + row * 0.26, (R() - 0.5) * 0.06], [0.66 + R() * 0.1, 0.27, 0.55 - row * 0.06], shade(C.stone, (R() - 0.5) * 0.3), { bevel: 0.05, ry: (R() - 0.5) * 8 }));
  }
  for (let i = 0; i < 4; i++) c.push(bevelled([-1.5 + i * 1.0 + R() * 0.3, 0.86, 0], [0.6 + R() * 0.3, 0.07, 0.44], shade(C.moss, (R() - 0.5) * 0.3), { bevel: 0.03 }));
  return one(c, { boxes: [{ x: 0, z: 0, hw: 2.0, hl: 0.3, turn: 0 }] });
});
def("bridge", () => {
  // the wooden bridge over Kettle Creek: 22 m long (along z), 4.6 wide, on two trestles; its deck at y = 0 at both ends
  const L = 22, Wd = 4.6, c = [];
  for (let z = -L / 2 + 0.2; z < L / 2; z += 0.42) c.push(box([0, -0.08, z], [Wd, 0.14, 0.38], shade(C.woodLight, ((z * 13) % 3) / 20 - 0.05)));
  for (const s of [1, -1]) {
    c.push(box([s * 1.6, -0.26, 0], [0.3, 0.22, L], C.plankDark));
    c.push(box([s * (Wd / 2 + 0.05), 0.95, 0], [0.12, 0.12, L], C.wood));
    c.push(box([s * (Wd / 2 + 0.05), 0.5, 0], [0.08, 0.08, L], C.wood));
    for (let z = -L / 2; z <= L / 2 + 0.01; z += 2.2) c.push(box([s * (Wd / 2 + 0.05), 0.5, z], [0.16, 1.1, 0.16], C.plankDark));
  }
  for (const z of [-3.6, 3.6]) {
    for (const s of [1, -1]) c.push(box([s * 1.6, -2.4, z], [0.3, 4.3, 0.3], C.plankDark));
    c.push(box([0, -1.4, z], [3.4, 0.2, 0.24], C.plankDark));
    c.push(box([0, -2.6, z], [3.6, 0.2, 0.24], C.plankDark, { rot: [0, 0, 24] }));
    c.push(box([0, -4.5, z], [3.6, 0.5, 0.6], C.stone));
  }
  return one(c, { capsules: [{ ax: Wd / 2 + 0.1, az: -L / 2, bx: Wd / 2 + 0.1, bz: L / 2, r: 0.12 }, { ax: -Wd / 2 - 0.1, az: -L / 2, bx: -Wd / 2 - 0.1, bz: L / 2, r: 0.12 }] });
});
def("barrier", () => {
  // a road barrier of red and white boards across Post Road's end, and a hand-painted board on two posts (words by the game)
  const c = [];
  for (const x of [-2.6, 2.6]) c.push(box([x, 0.55, 0], [0.18, 1.1, 0.18], C.white));
  for (let i = 0; i < 8; i++) c.push(box([-2.45 + i * 0.7 + 0.35, 0.95, 0.02], [0.7, 0.28, 0.06], i % 2 ? C.white : C.red));
  for (const x of [-0.7, 0.7]) c.push(box([x, 1.05, -0.5], [0.12, 2.1, 0.12], C.log));
  c.push(box([0, 1.85, -0.44], [2.2, 0.8, 0.06], PAL.paper, { rot: [0, 0, -2] }));
  return one(c, { boxes: [{ x: 0, z: 0, hw: 2.8, hl: 0.25, turn: 0 }] });
});
def("old_bridge", () => {
  // what is left of the lake bridge: a stone pier on each bank, the deck's broken ends, a lamp post leaning
  const c = [];
  for (const z of [0, 34]) {
    c.push(box([0, -6, z], [5.4, 12, 3], C.stone));
    c.push(box([0, 0.1, z + (z ? -1.0 : 1.0)], [5.0, 0.3, 4.5], C.plankDark));
  }
  c.push(box([0, 0.0, 4.0], [4.6, 0.25, 2.5], C.plankDark, { rot: [-22, 0, 4] }));
  c.push(box([0, 0.0, 30.5], [4.6, 0.25, 2.0], C.plankDark, { rot: [18, 0, -6] }));
  for (const s of [1, -1]) c.push(box([s * 2.3, 0.6, 2.5], [0.12, 1.0, 4.0], C.wood));
  return one(c);
});
def("picnic_table", () => {
  const c = [box([0, 0.75, 0], [1.9, 0.07, 0.8], C.woodLight)];
  for (const s of [1, -1]) c.push(box([0, 0.45, s * 0.65], [1.9, 0.06, 0.3], C.woodLight));
  for (const x of [-0.75, 0.75]) for (const s of [1, -1]) c.push(box([x, 0.38, s * 0.3], [0.08, 0.8, 0.08], C.wood, { rot: [s * 28, 0, 0] }));
  return one(c, { boxes: [{ x: 0, z: 0, hw: 0.95, hl: 0.8, turn: 0 }] });
});
def("bench", () => {
  const c = [box([0, 0.45, 0], [1.6, 0.06, 0.42], C.woodLight), box([0, 0.8, -0.2], [1.6, 0.3, 0.05], C.woodLight, { rot: [-10, 0, 0] })];
  for (const x of [-0.65, 0.65]) c.push(box([x, 0.22, 0], [0.08, 0.45, 0.38], C.plankDark));
  return one(c, { colliders: [{ x: 0, z: 0, r: 0.5 }] });
});
def("woodpile", () => {
  const c = [];
  for (let j = 0; j < 4; j++) for (let i = 0; i < 6 - j; i++) c.push(cyl([(i - (5 - j) / 2) * 0.24, 0.12 + j * 0.21, 0], 0.11, 0.6, shade(C.log, ((i + j) % 3) * 0.08), { axis: "z", segments: 7 }));
  return one(c, { boxes: [{ x: 0, z: 0, hw: 0.75, hl: 0.35, turn: 0 }] });
});

// ---- plants -----------------------------------------------------------------------------------------------------------------------------
// a fern: a few broad fronds arching out from the middle, each a soft leaf with a round tip (a toy's felt leaves, not sharp blades;
// seen from both sides: two faces)
const fern = (seed, n, size, color) => () => {
  const R = rng(seed), c = [];
  n = Math.max(5, Math.round(n * 0.7));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + R() * 0.4, len = size * (0.7 + R() * 0.35), up = 0.5 + R() * 0.25, wd = 0.2 * size;
    const dx = Math.sin(a), dz = Math.cos(a), px = dz, pz = -dx;
    // (along the frond: how far out, how high, how wide)
    const shape = [[0, 0.02, 0.05], [0.22, up * 0.8, 0.75], [0.5, up * 1.05, 1], [0.78, up * 0.95, 0.85], [0.93, up * 0.75, 0.55], [1, up * 0.6, 0.12]];
    const v = [], f = [];
    shape.forEach(([t, y, w]) => {
      const p = [dx * len * t, y * len * 0.6, dz * len * t];
      v.push([p[0] + px * wd * w, p[1], p[2] + pz * wd * w], [p[0] - px * wd * w, p[1], p[2] - pz * wd * w]);
    });
    for (let k = 0; k < shape.length - 1; k++) { f.push([2 * k, 2 * k + 2, 2 * k + 3, 2 * k + 1]); f.push([2 * k, 2 * k + 1, 2 * k + 3, 2 * k + 2]); }
    c.push(mesh(v, f, shade(color, (R() - 0.5) * 0.2), { keep: true, smooth: true }));
  }
  return one(c);
};
def("fern", fern(5, 9, 0.9, PAL.leaf));
def("fern_big", fern(8, 11, 1.3, shade(PAL.leaf, -0.12)));
def("fern_light", fern(13, 8, 0.75, PAL.grass));

// ---- run -------------------------------------------------------------------------------------------------------------------------------
const want = process.argv.slice(2);
for (const [name, fn] of Object.entries(made)) {
  if (want.length && !want.includes(name)) continue;
  tool("model_write", { name, model: toy(fn()) }, { quiet: true });
  console.log(`made ${name}`);
}
