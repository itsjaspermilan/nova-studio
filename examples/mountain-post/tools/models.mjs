// Fernhollow's buildings and things, each a model_write document built here from simple shapes (tools/geo.mjs) in one set of
// flat warm colours. Run: scripts/env.sh node examples/mountain-post/tools/models.mjs [name ...]  (no names: all of them)
// Every model stands on y = 0 and faces +z (its door, its front); what blocks the walker or the van is in its `boxes` and
// `colliders` (world units), which nova.scenery and nova.model_shapes read.
import { bevelled, box as hardBox, cone, cyl, mesh, model, one, part, rng, shade, tube } from "./geo.mjs";
import { tool } from "./lib.mjs";
import { PAL } from "./palette.mjs";

// The game's one look (tools/palette.mjs): every colour here is one of the palette's (or a shade of one), and every box is softened
// as it is made (`box` below), every other solid when the model is written (`toy`).
const C = {
  plank: PAL.wood, plankDark: PAL.woodDark, log: PAL.log, logDark: shade(PAL.log, -0.18), cream: PAL.cream, roof: PAL.slate, roofRed: PAL.roofRed,
  stone: PAL.stone, stoneDark: PAL.stoneDark, moss: PAL.moss, wood: PAL.wood, woodLight: PAL.woodLight, paint: PAL.sky, glass: PAL.glass,
  window: PAL.lit, dark: PAL.ink, iron: shade(PAL.ink, 0.12), white: PAL.white, red: PAL.red, green: PAL.teal, sign: PAL.woodDark,
  paper: shade(PAL.cream, -0.14), string: PAL.paper, floor: PAL.wood, wall: shade(PAL.cream, -0.1), dust: shade(PAL.stone, 0.15), mustard: PAL.mustard, rose: PAL.rose, metal: PAL.metal,
};

// ---- the house style -----------------------------------------------------------------------------------------------------------------------
// ONE construction language for every building and what stands by one (the post office, the cabins, the workshop, the bridge, the
// barrier, fences, porches, chimneys, the mast's footing), so that a new building made with these helpers matches the rest (the owner's
// sixth play: "keep a consistent look ... a little more rounded"). Metres. The look rule is tools/palette.mjs; this is its carpentry:
//   edge     the one rounding radius of every box edge: a box is rounded by `edge`, or by 0.4 of its thinnest side where that is less (a
//            4 cm board gets 1.6 cm, a wall 16 cm); anything thinner than 3 cm is flat paint and stays sharp
//   board    siding: a painted board line every 0.32 m on every wall, 4 cm tall, flat on the wall (never thicker than 2 cm)
//   trim     the thickness of every trim piece (frames, fascias, caps, sills); corner boards are 0.24 square, cream, on every house
//   plinth   every house stands on a rounded stone footing that sticks out `over` all round, in stoneDark
//   roof     gable roofs: soft thick plates (`thick`) of the same pitch (rise = pitch x half the span), overhanging `over` at the eaves
//            and the gables, a rounded ridge cap; lean-to roofs (porches, the workshop) are plates of the same thickness and overhang
//            that fall `drop` from the wall to the front
//   window   1.1 x 0.95 m glass in a cream frame 0.13 wide, a cross of 6 cm bars, a sill under it
//   door     1.1 x 2.15 m leaf in a cream frame 0.14 wide, a mustard knob
//   post     porch posts and fence and gate posts are 0.18 square (cream on a house, wood in the field), capped; rails are 0.1 thick
const HOUSE = {
  edge: 0.16,
  board: 0.32, boardLine: 0.04,
  trim: 0.12, corner: 0.24,
  plinth: { over: 0.15 },
  roof: { thick: 0.22, over: 0.45, pitch: 0.6, drop: 0.45, ridge: 0.15 },
  window: { w: 1.1, h: 0.95, frame: 0.13, bar: 0.06, sill: 0.1 },
  door: { w: 1.1, h: 2.15, frame: 0.14 },
  post: 0.18, rail: 0.1,
};
const edgeOf = (size) => Math.min(HOUSE.edge, Math.min(...size) * 0.4);
// A box with soft toy edges (HOUSE.edge), turned as `rot` says.
const box = (c, size, color, o = {}) => {
  const r = edgeOf(size);
  return Math.min(...size) < 0.03 ? hardBox(c, size, color, o) : bevelled(c, size, color, { bevel: r, segments: r >= 0.12 ? 3 : r >= 0.07 ? 2 : 1, ...o });
};
// A plate: eight points (the top four, then the bottom four, each counter-clockwise from above), edges rounded by `r`.
const plate = (top, th, color, r = 0.09) => {
  const bottom = top.map(([x, y, z]) => [x, y - th, z]);
  const m = mesh([...top, ...bottom], [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]], color);
  m.modifiers = [{ type: "bevel", width: Math.round(r * 16 * 1000) / 1000, segments: 2, angle: 30 }];
  return m;
};
// A gable roof over a W x D plan whose walls end at y = top: the ridge runs along x (`along: "x"`) or z. Returns the roof (a thick plate
// folded at a rounded ridge), the attic (the gable's triangles of wall, one closed prism in the wall's colour) and the ridge cap, and
// `at(h)`: the roof's top surface at h metres from the ridge, for what stands in it (a chimney).
function gableRoof(W, D, top, wallColor, roofColor, along = "x") {
  const { thick, over, pitch, ridge } = HOUSE.roof;
  const span = along === "x" ? D : W, len = along === "x" ? W : D, hs = span / 2, he = hs + over, hl = len / 2 + over;
  const yTop = (h) => top + thick + pitch * (hs - h); // (the top surface, h from the ridge: the wall's line at h = hs)
  const P = (u, y, v) => (along === "x" ? [v, y, u] : [u, y, v]); // (u across the ridge, v along it)
  const th = thick * 1.17; // (vertical thickness of a plate of that thickness on that pitch)
  const top6 = [[-he, yTop(he), -hl], [-he, yTop(he), hl], [0, yTop(0), -hl], [0, yTop(0), hl], [he, yTop(he), -hl], [he, yTop(he), hl]].map(([u, y, v]) => P(u, y, v));
  const verts = [...top6, ...top6.map(([x, y, z]) => [x, y - th, z])];
  const roof = mesh(verts, [[0, 2, 3, 1], [2, 4, 5, 3], [6, 7, 9, 8], [8, 9, 11, 10], [0, 2, 4, 10, 8, 6], [1, 3, 5, 11, 9, 7], [0, 1, 7, 6], [4, 10, 11, 5]], roofColor, { inside: P(0, top + thick / 2, 0) });
  roof.modifiers = [{ type: "bevel", width: Math.round(0.09 * 16 * 1000) / 1000, segments: 2, angle: 20 }];
  const apex = top + pitch * hs - 0.05;
  const attic = mesh([[-hs, top - 0.1, -len / 2], [hs, top - 0.1, -len / 2], [0, apex, -len / 2], [-hs, top - 0.1, len / 2], [hs, top - 0.1, len / 2], [0, apex, len / 2]].map(([u, y, v]) => P(u, y, v)),
    [[0, 2, 1], [3, 4, 5], [0, 1, 4, 3], [1, 2, 5, 4], [2, 0, 3, 5]], wallColor);
  const cap = cyl([0, yTop(0) - 0.01, 0], ridge, len + 2 * over + 0.12, shade(roofColor, -0.1), { axis: along, segments: 10, smooth: true });
  return { cubes: [roof, attic, cap], at: yTop };
}
// A lean-to roof over a porch (or a shed): a plate of the house roof's thickness and overhang, from zBack (against a wall: no overhang
// there unless `free`) to zFront (its posts' line, and `over` more), between x0 and x1 (and `over` more). Its top is at yBack at zBack and
// falls `drop` by its front edge.
function leanRoof(x0, x1, zBack, zFront, yBack, { free = false, color = C.roofRed } = {}) {
  const { thick, over, drop } = HOUSE.roof;
  const zb = free ? zBack - over : zBack, zf = zFront + over, y = (z) => yBack - (drop * (z - zBack)) / (zf - zBack);
  return plate([[x0 - over, y(zb), zb], [x1 + over, y(zb), zb], [x1 + over, y(zf), zf], [x0 - over, y(zf), zf]], thick, color);
}
// The cream corner boards of a house on its plinth, and the siding's board lines on its four walls (flat paint).
function walls(W, D, base, H, color, lineColor) {
  const c = [box([0, base + H / 2, 0], [W, H, D], color)];
  const bl = HOUSE.boardLine;
  for (let y = base + HOUSE.board; y < base + H - 0.1; y += HOUSE.board) {
    for (const s of [1, -1]) c.push(hardBox([0, y, s * (D / 2 + 0.01)], [W - 0.3, bl, 0.02], lineColor), hardBox([s * (W / 2 + 0.01), y, 0], [0.02, bl, D - 0.3], lineColor));
  }
  for (const sx of [1, -1]) for (const sz of [1, -1]) c.push(box([sx * (W / 2), base + H / 2, sz * (D / 2)], [HOUSE.corner, H + 0.02, HOUSE.corner], C.cream));
  return c;
}
// The stone footing a house stands on (HOUSE.plinth), its top at y = base.
const plinth = (W, D, base) => box([0, base / 2, 0], [W + 2 * HOUSE.plinth.over, base, D + 2 * HOUSE.plinth.over], C.stoneDark);
// A window in a front wall (the wall's face at z = zw), its middle at (x, y).
function windowAt(x, y, zw, { lit = false, flowers = false } = {}) {
  const { w, h, frame, bar, sill } = HOUSE.window, t = HOUSE.trim;
  const c = [box([x, y, zw + t / 2 - 0.02], [w + 2 * frame, h + 2 * frame, t], C.cream)];
  const glass = lit ? box([x, y, zw + t - 0.005], [w, h, 0.04], PAL.lit, { emissive: 0.45 }) : box([x, y, zw + t - 0.005], [w, h, 0.04], PAL.glass);
  c.push(glass, box([x, y, zw + t + 0.025], [bar, h, 0.03], C.cream), box([x, y, zw + t + 0.025], [w, bar, 0.03], C.cream));
  c.push(box([x, y - h / 2 - frame - sill / 2 + 0.02, zw + t / 2 + 0.06], [w + 2 * frame + 0.2, sill, 0.22], C.cream));
  if (flowers) { // a box of flowers under it, painted bright
    c.push(box([x, y - h / 2 - frame - sill - 0.1, zw + 0.24], [w + 0.1, 0.22, 0.26], C.plankDark));
    for (let i = 0; i < 5; i++) c.push(box([x - w / 2 + 0.12 + i * (w - 0.24) / 4, y - h / 2 - frame - sill + 0.05, zw + 0.24], [0.16, 0.16, 0.16], i % 2 ? PAL.mustard : PAL.red));
  }
  return c;
}
// A door in a front wall: its frame (cream, in the wall) and its leaf (the colour; `leaf` cubes are relative to the leaf's bottom middle, so
// a door that opens can be a part of its own).
function doorAt(x, base, zw, color) {
  const { w, h, frame } = HOUSE.door;
  const frameBox = box([x, base + (h + frame) / 2, zw + HOUSE.trim / 2 - 0.02], [w + 2 * frame, h + frame, HOUSE.trim], C.cream);
  return { frame: frameBox, leaf: doorLeaf(color, [x, base, zw + HOUSE.trim - 0.02]) };
}
const doorLeaf = (color, [ox, oy, oz] = [0, 0, 0]) => {
  const { w, h } = HOUSE.door;
  return [box([ox, oy + h / 2, oz + 0.04], [w, h, 0.1], color), box([ox + w / 2 - 0.16, oy + h / 2 - 0.05, oz + 0.11], [0.09, 0.15, 0.06], PAL.mustard)];
};
// A porch across the front: a deck, a lean-to roof on posts, a fascia; `posts` are x positions; `top` is the roof's top at the wall.
function porch(W, D, base, top, { w, depth, posts, x = 0 }) {
  const c = [box([x, base - 0.06, D / 2 + depth / 2], [w, 0.12, depth], C.woodLight)];
  const zf = D / 2 + depth, yFront = top - HOUSE.roof.drop;
  c.push(leanRoof(x - w / 2 + 0.2, x + w / 2 - 0.2, D / 2, zf, top, {}));
  const under = yFront - HOUSE.roof.thick; // (the front edge's underside)
  for (const px of posts) c.push(box([px, base + (under - base) / 2, zf - 0.15], [HOUSE.post, under - base, HOUSE.post], C.cream));
  c.push(box([x, under - 0.08, zf - 0.15], [w - 0.2, 0.16, HOUSE.trim + 0.04], C.cream)); // the fascia beam on the posts
  return c;
}
// A chimney: a stone stack with a cap (stoneDark) and a dark flue.
function chimney(x, z, w, d, y0, y1) {
  const t = HOUSE.trim + 0.04;
  return [box([x, (y0 + y1) / 2, z], [w, y1 - y0, d], C.stone), box([x, y1 + t / 2, z], [w + 0.2, t, d + 0.2], C.stoneDark), hardBox([x, y1 + t + 0.005, z], [w - 0.3, 0.01, d - 0.3], C.dark)];
}
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
  const c = [plinth(W, D, base), ...walls(W, D, base, H, C.plank, C.plankDark)];
  const roof = gableRoof(W, D, base + H, C.plank, C.roof, "x");
  c.push(...roof.cubes);
  // the porch: a deck, steps, posts, a lean-to roof
  c.push(...porch(W, D, base, base + 2.9, { w: W - 1.2, depth: 2.2, posts: [-3.6, -1.2, 1.2, 3.6] }));
  for (let i = 0; i < 3; i++) c.push(box([0, base - 0.15 * (i + 1), D / 2 + 2.3 + i * 0.3], [2.2, 0.15, 0.3], shade(C.woodLight, -0.1 * i)));
  // a rail either side of the steps
  for (const s of [1, -1]) {
    c.push(box([s * 2.5, base + 0.5, D / 2 + 2.05], [2.2, HOUSE.rail, HOUSE.rail], C.cream));
    for (const x of [1.6, 2.6, 3.5]) c.push(box([s * x, base + 0.25, D / 2 + 2.05], [HOUSE.trim, 0.5, HOUSE.trim], C.cream));
  }
  // windows either side of the door, with a box of flowers under one
  c.push(...windowAt(2.6, base + 1.65, D / 2), ...windowAt(-2.6, base + 1.65, D / 2, { flowers: true }));
  // the door frame (the door is its own part) and a lamp over it
  const door = doorAt(0, base, D / 2, PAL.teal);
  c.push(door.frame, box([0, base + 2.55, D / 2 + 0.15], [HOUSE.trim, 0.2, HOUSE.trim], C.iron));
  // the sign board over the porch roof (its words are drawn by the game)
  c.push(box([0, base + 3.35, D / 2 + 0.08], [4.2, 0.85, 0.12], shade(PAL.slate, -0.3)));
  c.push(box([0, base + 3.35, D / 2 + 0.03], [4.4, 1.0, 0.08], C.cream));
  // the chimney, stone, at the back right, up through the roof (its smoke starts at 6.5 m: scenes/valley.lua)
  c.push(...chimney(2.6, -1.4, 0.75, 0.75, roof.at(1.4) - 0.4, 6.34));
  // a bench on the porch, a post box at the steps' foot
  c.push(box([2.9, base + 0.42, D / 2 + 0.4], [1.5, HOUSE.rail, 0.42], C.wood));
  for (const s of [2.25, 3.55]) c.push(box([s, base + 0.2, D / 2 + 0.4], [HOUSE.rail, 0.4, 0.36], C.plankDark));
  c.push(bevelled([1.75, 0.6, D / 2 + 3.6], [0.5, 1.2, 0.5], C.red, { bevel: 0.12, segments: 3 }));
  c.push(box([1.75, 1.25, D / 2 + 3.6], [0.6, 0.12, 0.6], shade(C.red, -0.25)));
  c.push(box([1.75, 0.95, D / 2 + 3.86], [0.3, 0.05, 0.02], C.dark));
  const leaf = part("door", [-0.55, base, D / 2 + HOUSE.trim - 0.02], doorLeaf(PAL.teal, [0.55, 0, 0]));
  return model([part("body", [0, 0, 0], c.filter(Boolean)), leaf], { boxes: [{ x: 0, z: 0, hw: W / 2 + 0.2, hl: D / 2 + 0.2, turn: 0 }, { x: 3.3, z: D / 2 + 1.1, hw: 1.0, hl: 1.1, turn: 0 }, { x: -3.3, z: D / 2 + 1.1, hw: 1.0, hl: 1.1, turn: 0 }], colliders: [{ x: 1.75, z: D / 2 + 3.6, r: 0.4 }] });
});

// ---- the post office, inside: a room 7 x 5 m, the door in the front wall (+z), a window in the right-hand wall --------------------------
// Seen from one fixed view high over the front (scenes/office.lua, lib/camera.lua ROOM), like a diorama: no ceiling, and the front
// wall cut away to a low stub either side of the doorway, a mat in the doorway.
def("office_room", () => {
  const X = 3.5, Z = 2.6, H = 3.0;
  const c = [];
  c.push(box([0, -0.05, 0], [2 * X + 0.4, 0.1, 2 * Z + 0.4], C.floor));
  for (let x = -X + 0.25; x < X; x += 0.5) c.push(box([x, 0.003, 0], [0.02, 0.01, 2 * Z], shade(C.floor, -0.2))); // floorboards
  // the walls, each a thick slab; the front one with a door gap, the right one (-x) with a window gap
  const wall = (cx, cz, w, d, h = H, y = H / 2) => c.push(box([cx, y, cz], [w, h, d], C.wall));
  wall(0, -Z - 0.1, 2 * X + 0.4, 0.2);
  wall(X + 0.1, 0, 0.2, 2 * Z);
  // the front, cut away: a low stub either side of the door (1.1 wide at x = 0.9), its cut top a darker wood
  const STUB = 0.32;
  wall((-X + 0.35) / 2, Z + 0.1, X + 0.35, 0.2, STUB, STUB / 2);
  wall((X + 1.45) / 2, Z + 0.1, X - 1.45, 0.2, STUB, STUB / 2);
  for (const [cx, w] of [[(-X + 0.35) / 2, X + 0.35], [(X + 1.45) / 2, X - 1.45]]) c.push(box([cx, STUB + 0.015, Z + 0.1], [w + 0.02, 0.03, 0.22], C.plankDark));
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
  // the walls' cut tops (no ceiling: the room is seen from above), and a mat in the doorway
  for (const [cx, cz, w, d] of [[0, -Z - 0.1, 2 * X + 0.42, 0.22], [X + 0.1, 0, 0.22, 2 * Z + 0.4], [-X - 0.1, 0, 0.22, 2 * Z + 0.4]]) c.push(box([cx, H + 0.015, cz], [w, 0.03, d], C.plankDark));
  c.push(box([0.9, 0.012, Z - 0.15], [1.0, 0.02, 0.55], PAL.mustard));
  c.push(box([0.9, 0.018, Z - 0.15], [0.8, 0.02, 0.4], shade(PAL.mustard, -0.15)));
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
  const c = [plinth(W, D, base), ...walls(W, D, base, H, C.log, C.logDark)];
  const roof = gableRoof(W, D, base + H, C.log, C.roof, "x");
  c.push(...roof.cubes);
  // the door (front, left of middle), two windows with warm light, a porch roof on two posts
  const door = doorAt(-1.0, base, D / 2, PAL.woodDark);
  c.push(door.frame, ...door.leaf);
  c.push(...windowAt(1.45, base + 1.6, D / 2, { lit: true }), ...windowAt(2.9, base + 1.6, D / 2, { lit: true }));
  c.push(...porch(W, D, base, base + H - 0.25, { w: W - 1, depth: 2.1, posts: [-3.2, 3.2] }));
  // a stone chimney on the left end, from the ground up through the roof (its smoke starts at 5.8 m: scenes/valley.lua)
  c.push(box([W / 2 + 0.35, 0.2, -0.8], [1.1, 0.4, 1.2], C.stoneDark), ...chimney(W / 2 + 0.35, -0.8, 0.9, 1.0, 0.2, 5.4));
  // a rocking chair on the porch
  c.push(box([2.2, base + 0.45, D / 2 + 1.0], [0.55, HOUSE.rail, 0.5], C.wood));
  c.push(box([2.2, base + 0.85, D / 2 + 0.78], [0.55, 0.8, HOUSE.rail], C.wood));
  return model([part("body", [0, 0, 0], c)], { boxes: [{ x: 0, z: 0, hw: W / 2 + 0.3, hl: D / 2 + 0.3, turn: 0 }, { x: W / 2 + 0.35, z: -0.8, hw: 0.5, hl: 0.55, turn: 0 }] });
});
def("workshop", () => {
  // an open shed on four posts, a lean-to roof, a back wall of boards, the bench along it
  const c = [], z0 = -1.4, z1 = 1.4, x1 = 2;
  const roof = leanRoof(-x1, x1, z0, z1, 2.95, { free: true, color: C.roofRed });
  c.push(roof);
  const under = (z) => 2.95 - (HOUSE.roof.drop * (z - z0)) / (z1 + HOUSE.roof.over - z0) - HOUSE.roof.thick;
  for (const [x, z] of [[-x1, z0], [x1, z0], [-x1, z1], [x1, z1]]) {
    c.push(box([x, 0.09, z], [0.4, 0.18, 0.4], C.stoneDark)); // (each post on a little stone footing, as a house on its plinth)
    c.push(box([x, 0.18 + (under(z) - 0.18) / 2, z], [HOUSE.post, under(z) - 0.18, HOUSE.post], C.log));
  }
  c.push(box([0, 1.35, -1.52], [4.1, 2.6, 0.12], C.plank));
  for (let y = 0.45; y < 2.6; y += HOUSE.board) c.push(hardBox([0, y, -1.455], [3.8, HOUSE.boardLine, 0.02], C.plankDark));
  c.push(box([0, 0.85, -1.05], [3.2, HOUSE.rail, 0.7], C.woodLight)); // the bench
  for (const x of [-1.4, 1.4]) c.push(box([x, 0.4, -1.05], [HOUSE.rail, 0.8, 0.6], C.plankDark));
  // tools on the back wall: a saw, a mallet, a row of hooks
  c.push(box([-0.8, 1.6, -1.42], [0.8, 0.22, 0.04], PAL.metal));
  c.push(box([-0.35, 1.6, -1.42], [0.18, 0.12, 0.06], C.wood));
  c.push(box([0.6, 1.55, -1.42], [0.06, 0.5, 0.06], C.wood));
  c.push(box([0.6, 1.8, -1.42], [0.2, 0.12, 0.1], C.plankDark));
  c.push(box([1.3, 1.5, -1.42], [0.3, 0.4, 0.04], shade(PAL.metal, -0.2)));
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
  const c = [plinth(W, D, base), ...walls(W, D, base, H, C.paint, shade(C.paint, -0.18))];
  // (the ridge runs front to back: the front is a gable, its triangle of wall above the porch roof)
  const roof = gableRoof(W, D, base + H, C.paint, C.roofRed, "z");
  c.push(...roof.cubes);
  const door = doorAt(0.9, base, D / 2, PAL.mustard); // a yellow door
  c.push(door.frame, ...door.leaf);
  c.push(...windowAt(-1.3, base + 1.6, D / 2, { lit: true }));
  c.push(...porch(W, D, base, base + H - 0.25, { w: W - 0.6, depth: 1.55, posts: [-2.5, 2.5] }));
  // the radio: a box on the porch with a dial and a speaker horn on the wall
  c.push(box([-2.0, base + 0.5, D / 2 + 0.55], [0.9, 0.7, 0.5], PAL.woodDark));
  c.push(cyl([-2.2, base + 0.6, D / 2 + 0.82], 0.12, 0.04, PAL.mustard, { axis: "z", segments: 12 }));
  c.push(cyl([-1.8, base + 0.6, D / 2 + 0.82], 0.08, 0.04, PAL.ink, { axis: "z", segments: 10 }));
  c.push(cone([2.6, base + 2.0, D / 2 + 0.2], 0.22, 0.4, PAL.metal));
  // a bunting of little flags along the porch's front beam
  const yb = base + 2.45 - HOUSE.roof.drop - HOUSE.roof.thick - 0.2, zb = D / 2 + 1.55 - 0.15 + 0.1;
  for (let i = 0; i < 9; i++) c.push(mesh([[-2.4 + i * 0.6, yb, zb], [-2.1 + i * 0.6, yb, zb], [-2.25 + i * 0.6, yb - 0.27, zb], [-2.25 + i * 0.6, yb, zb + 0.02]], [[0, 1, 2], [0, 2, 3], [1, 3, 2], [0, 3, 1]], [PAL.red, PAL.mustard, PAL.sky, PAL.leaf][i % 4]));
  // the chimney, up through the roof beside the ridge (its smoke starts at 4.9 m: scenes/valley.lua)
  c.push(...chimney(2.4, -1.0, 0.5, 0.5, roof.at(2.4) - 0.4, 4.8));
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
  // its footing, a house's plinth in small: a rounded stone block, a smaller stone one on it
  c.push(box([0, 0.12, 0], [1.4, 0.24, 1.4], C.stoneDark), box([0, 0.3, 0], [0.95, 0.2, 0.95], C.stone));
  return one(c, { colliders: [{ x: 0, z: 0, r: 0.6 }] });
});

// ---- by the roads ---------------------------------------------------------------------------------------------------------------------
def("signpost", () => {
  // a chunky post with up to two arms (the owner's fifth play: "the road signs are hard to see from far away"): the arms hang at the
  // chase camera's height (their middles at 3.0, or 3.2 for a two-line board, and 2.15 m), so the boards are seen face on from the van
  const c = [box([0, 1.95, 0], [0.26, 3.9, 0.26], C.sign), box([0, 3.96, 0], [0.36, 0.14, 0.36], C.woodLight), box([0, 0.15, 0], [0.56, 0.3, 0.56], C.stoneDark)];
  return one(c, { colliders: [{ x: 0, z: 0, r: 0.16 }] });
});
// One arm, pointing along +x from the post: a pointed board with a light wooden rim (the quiet outline that keeps it apart from the dark
// trees behind) round a dark panel on each face, on which the game draws the road's name in cream (sprites/fx/sign_*). The point shows
// which way the road goes. One family: every board 3.6 m long; a short name on one line (letters 0.36 m high) on a board 0.72 m high,
// a long one on two lines ("KETTLE CREEK" over "ROAD", letters 0.29 m) on a board 1.12 m high (it was one line on a 4.8 m board).
export const SIGN = { h: 0.72, tall: 1.12, rim: 0.06, t: 0.06, panel: 0.014, point: 0.42, length: 3.6 };
const signArm = (L, h) => () => {
  const { rim, t, panel, point } = SIGN;
  const outline = (x0, x1, tip, hh) => [[x0, -hh], [x1 - point, -hh], [tip, 0], [x1 - point, hh], [x0, hh]];
  const slab = (pts, z0, z1, color) => {
    const v = [...pts.map(([x, y]) => [x, y, z0]), ...pts.map(([x, y]) => [x, y, z1])];
    const n = pts.length, f = [[...Array(n).keys()], [...Array(n).keys()].map((i) => n + n - 1 - i)];
    for (let i = 0; i < n; i++) f.push([i, (i + 1) % n, n + ((i + 1) % n), n + i]);
    return mesh(v, f, color, { inside: [L / 2, 0, (z0 + z1) / 2] });
  };
  const board = slab(outline(0.08, L, L, h / 2), -t, t, C.woodLight);
  const inner = outline(0.08 + rim, L - rim * 0.8, L - rim * 1.6, h / 2 - rim);
  const dark = shade(PAL.ink, 0.08);
  return one([board, slab(inner, t - 0.002, t + panel, dark), slab(inner, -t - panel, -t + 0.002, dark)]);
};
def("sign_arm", signArm(SIGN.length, SIGN.h));
def("sign_arm_tall", signArm(SIGN.length, SIGN.tall));
def("mailbox", () => one([
  box([0, 0.4, 0], [0.12, 0.8, 0.12], C.sign),
  bevelled([0, 0.92, 0.05], [0.36, 0.3, 0.55], PAL.teal, { bevel: 0.06 }),
  box([0.2, 1.0, 0.12], [0.03, 0.25, 0.04], C.red),
  box([0, 0.9, 0.33], [0.26, 0.2, 0.02], shade(PAL.teal, -0.3)),
], { colliders: [{ x: 0, z: 0, r: 0.15 }] }));
def("gate_post", () => one([box([0, 0.7, 0], [HOUSE.post + 0.04, 1.4, HOUSE.post + 0.04], C.log), box([0, 1.45, 0], [0.3, HOUSE.trim, 0.3], C.logDark)], { colliders: [{ x: 0, z: 0, r: 0.15 }] }));
def("fence", () => {
  // a split-rail fence, 3 m along x: capped posts (HOUSE.post) and two rails (HOUSE.rail)
  const c = [];
  for (const x of [-1.5, 1.5]) c.push(box([x, 0.55, 0], [HOUSE.post, 1.1, HOUSE.post], C.log), box([x, 1.14, 0], [0.24, 0.08, 0.24], C.logDark));
  for (const y of [0.45, 0.85]) c.push(box([0, y, 0], [3.1, HOUSE.rail, HOUSE.rail], C.wood, { rot: [0, 0, y > 0.6 ? 1.5 : -1] }));
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
  // the wooden bridge over Kettle Creek: 22 m long (along z), 4.6 wide, on two trestles; its deck at y = 0 at both ends. Rails and posts as the
  // fence's (HOUSE.post, HOUSE.rail), the stone piers capped like a plinth
  const L = 22, Wd = 4.6, c = [];
  for (let z = -L / 2 + 0.2; z < L / 2; z += 0.42) c.push(box([0, -0.08, z], [Wd, 0.14, 0.38], shade(C.woodLight, ((z * 13) % 3) / 20 - 0.05)));
  for (const s of [1, -1]) {
    c.push(box([s * 1.6, -0.26, 0], [0.3, 0.22, L], C.plankDark));
    c.push(box([s * (Wd / 2 + 0.05), 0.95, 0], [HOUSE.rail + 0.02, HOUSE.rail + 0.02, L], C.wood));
    c.push(box([s * (Wd / 2 + 0.05), 0.5, 0], [HOUSE.rail, HOUSE.rail, L], C.wood));
    for (let z = -L / 2; z <= L / 2 + 0.01; z += 2.2) c.push(box([s * (Wd / 2 + 0.05), 0.55, z], [HOUSE.post, 1.1, HOUSE.post], C.log));
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
  // a road barrier across Post Road's end (one white rail with red bands wrapped round it, on two capped posts) and a hand-painted board on
  // two posts (words by the game, on the board's +z face)
  const c = [];
  for (const x of [-2.6, 2.6]) c.push(box([x, 0.55, 0], [HOUSE.post, 1.1, HOUSE.post], C.white), box([x, 1.14, 0], [0.26, 0.08, 0.26], C.white));
  c.push(box([0, 0.95, 0.0], [5.6, 0.28, 0.1], C.white));
  for (let i = 0; i < 8; i += 2) c.push(box([-2.45 + i * 0.7 + 0.35, 0.95, 0.0], [0.7, 0.29, 0.11], C.red));
  for (const x of [-0.7, 0.7]) c.push(box([x, 1.05, -0.55], [HOUSE.post - 0.02, 2.1, HOUSE.post - 0.02], C.log));
  c.push(box([0, 1.85, -0.44], [2.3, 0.9, 0.1], C.cream, { rot: [0, 0, -2] }));
  c.push(box([0, 1.85, -0.39], [2.1, 0.7, 0.03], PAL.paper, { rot: [0, 0, -2] }));
  return one(c, { boxes: [{ x: 0, z: 0, hw: 2.8, hl: 0.25, turn: 0 }] });
});
// What is left of the lake bridge, in two pieces, one on each rim of the gorge (each drawn rigid, `lift = "origin"`: on the rim's level
// ground where it stands, its stone pier (24 m) reaching down into the cliff, never sheared down the slope).
def("old_bridge", () => {
  // the near rim, at the end of Post Road: just past the road's end (z from 1 m on), the pier, the deck's broken end, the railings
  const c = [box([0, -12, 2.6], [5.4, 24, 3], C.stone), box([0, 0.1, 3.6], [5.0, 0.3, 4.5], C.plankDark)];
  c.push(box([0, 0.0, 6.6], [4.6, 0.25, 2.5], C.plankDark, { rot: [-22, 0, 4] }));
  for (const s of [1, -1]) c.push(box([s * 2.3, 0.6, 5.1], [0.12, 1.0, 4.0], C.wood));
  return one(c);
});
def("old_bridge_far", () => {
  // the far rim: its pier and the deck's other broken end, reaching back (-z) over the gorge
  const c = [box([0, -12, 0], [5.4, 24, 3], C.stone), box([0, 0.1, -1.0], [5.0, 0.3, 4.5], C.plankDark)];
  c.push(box([0, 0.0, -3.5], [4.6, 0.25, 2.0], C.plankDark, { rot: [18, 0, -6] }));
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
