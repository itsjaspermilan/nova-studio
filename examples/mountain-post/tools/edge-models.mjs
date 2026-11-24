// The models of the valley's edges and its ponds (the owner's eighth play, notes 5 and 6), in the game's one look (tools/palette.mjs: soft,
// chunky, flat warm colours): a hedge, a locked field gate (a secret way, closed for now), a fallen tree across an old track (another),
// a reed clump, a raft of lily pads, a little jetty, and a rock outcrop for the steep banks. Each stands on y = 0 and faces +z; what
// blocks is in its colliders, capsules and boxes (metres here, model units in the file). Run from the repository's root:
//   scripts/env.sh node examples/mountain-post/tools/edge-models.mjs [name ...]
import { bevelled, cyl, mesh, model, one, part, rng, shade, tube } from "./geo.mjs";
import { tool } from "./lib.mjs";
import { PAL } from "./palette.mjs";

const made = {};
const def = (name, fn) => (made[name] = fn);
const paint = (c, kind) => ((c.paint = kind), c);
const soft = (c, size, color, o = {}) => bevelled(c, size, color, { bevel: Math.max(0.015, Math.min(0.12, Math.min(...size) * 0.3)), segments: 2, ...o });
// a lumpy rounded blob (a box cage, subdivided): leaves, a rock
const blob = (R, c, [w, h, d], color, o = {}) => {
  const v = [];
  for (const sy of [0, 1]) for (const sz of [-1, 1]) for (const sx of [-1, 1]) {
    const k = sy ? (o.top ?? 0.8) + R() * 0.15 : 1;
    v.push([c[0] + sx * (w / 2) * k * (0.85 + R() * 0.3), c[1] + (sy ? h * (0.9 + R() * 0.2) : -0.1), c[2] + sz * (d / 2) * k * (0.85 + R() * 0.3)]);
  }
  return mesh(v, [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]], color, { modifiers: [{ type: "subsurf", levels: 2, renderLevels: 2, smooth: true }] });
};

// ---- a hedge: 3 m along x, 1.3 m high, a little under a metre through; a row of soft leaf lumps painted as a crown -------------------------
def("hedge", () => {
  const R = rng(31), c = [];
  // (a squarish body of overlapping lumps, then a softer row along its top: trimmed, not round bushes)
  for (let i = 0; i < 5; i++) {
    const x = -1.2 + i * 0.6 + (R() - 0.5) * 0.1;
    c.push(paint(blob(R, [x, 0, (R() - 0.5) * 0.08], [0.95, 1.05, 0.9], shade(PAL.leaf, -0.24 + (R() - 0.5) * 0.06), { top: 0.95 }), "foliage"));
  }
  for (let i = 0; i < 4; i++) c.push(paint(blob(R, [-1.05 + i * 0.7, 0.85, 0], [0.8, 0.42, 0.75], shade(PAL.leaf, -0.14 + (R() - 0.5) * 0.06), { top: 0.8 }), "foliage"));
  return one(c, { capsules: [{ ax: -1.4, az: 0, bx: 1.4, bz: 0, r: 0.45 }] });
});

// ---- a locked field gate: two stout posts and a five-bar gate between them, chained shut with a padlock (a way out to open later) ------
def("field_gate", () => {
  const c = [], W = 3.6;
  for (const x of [-W / 2 - 0.12, W / 2 + 0.12]) c.push(soft([x, 0.75, 0], [0.24, 1.5, 0.24], PAL.log), soft([x, 1.53, 0], [0.32, 0.08, 0.32], shade(PAL.log, -0.18)));
  for (let i = 0; i < 5; i++) c.push(soft([0, 0.3 + i * 0.24, 0], [W, 0.1, 0.1], PAL.woodLight));
  for (const x of [-W / 2 + 0.1, W / 2 - 0.1]) c.push(soft([x, 0.78, 0], [0.12, 1.1, 0.12], PAL.woodLight));
  // the diagonal brace
  c.push(soft([0, 0.78, 0.02], [Math.hypot(W - 0.3, 0.9), 0.1, 0.1], PAL.woodLight, { rot: [0, 0, Math.atan2(0.9, W - 0.3) * 57.3] }));
  // the chain round the latch post and the padlock
  c.push(cyl([W / 2 - 0.05, 0.95, 0], 0.17, 0.08, PAL.metal, { segments: 10 }), soft([W / 2 + 0.05, 0.8, 0.14], [0.14, 0.17, 0.08], PAL.mustard));
  return one(c, { capsules: [{ ax: -W / 2 - 0.15, az: 0, bx: W / 2 + 0.15, bz: 0, r: 0.16 }] });
});

// ---- a fallen tree: a long mossy trunk lying along x, its root plate stood up at one end, two broken branches ---------------------------
def("fallen_tree", () => {
  const L = 7.5, r = 0.42, R = rng(41), c = [];
  c.push({ ...cyl([0, r * 0.95, 0], r, L, PAL.log, { axis: "x", segments: 12 }), smooth: true });
  c.push(cyl([-L / 2 - 0.01, r * 0.95, 0], r * 0.85, 0.03, PAL.woodLight, { axis: "x", segments: 12 }));
  // the root plate: a disc of earth and roots stood on edge at the +x end
  c.push(blob(R, [L / 2 + 0.2, 0, 0], [0.5, 1.9, 2.1], shade(PAL.trunk, -0.12), { top: 0.75 }));
  for (const [x, a] of [[-1.2, 0.6], [1.0, -0.5]]) c.push(tube([[x, r * 1.6, 0], [x - 0.3, r * 1.6 + 0.7, Math.sin(a) * 0.4], [x - 0.45, r * 1.6 + 1.1, Math.sin(a) * 0.7]], [0.13, 0.1, 0.08], PAL.trunk, { segments: 6 }));
  for (let i = 0; i < 4; i++) c.push(blob(R, [-2.8 + i * 1.6, r * 1.6, (R() - 0.5) * 0.2], [0.7, 0.18, 0.55], shade(PAL.moss, (R() - 0.5) * 0.15)));
  return model([part("body", [0, 0, 0], c)], { capsules: [{ ax: -L / 2, az: 0, bx: L / 2 + 0.3, bz: 0, r: r + 0.1 }] });
});

// ---- reeds: a clump of tall soft blades, a few brown cattail heads; they sway ----------------------------------------------------------
def("reeds", () => {
  const R = rng(51), c = [];
  for (let i = 0; i < 14; i++) {
    const a = R() * 6.28, d = R() * 0.45, x = Math.sin(a) * d, z = Math.cos(a) * d, h = 0.9 + R() * 0.7, lean = (R() - 0.5) * 0.35;
    c.push(tube([[x, -0.1, z], [x + lean * 0.4, h * 0.5, z + lean * 0.2], [x + lean, h, z + lean * 0.5]], [0.05, 0.04, 0.015], shade(i % 3 ? PAL.leaf : PAL.moss, (R() - 0.5) * 0.15), { segments: 5 }));
    if (i % 4 === 0) c.push(cyl([x + lean * 0.8, h * 0.88, z + lean * 0.4], 0.055, 0.24, shade(PAL.trunk, -0.05), { segments: 8 }));
  }
  return one(c);
});

// ---- lily pads: a few round flat leaves with their notch, one with a pale flower, lying on the water (y = 0 is the water) -------------
def("lily_pads", () => {
  const R = rng(61), c = [];
  for (let i = 0; i < 6; i++) {
    const a = R() * 6.28, d = 0.3 + R() * 1.1, x = Math.sin(a) * d, z = Math.cos(a) * d, r = 0.22 + R() * 0.16, turn = R() * 6.28;
    const pts = [[x, 0.02, z]];
    const n = 12;
    for (let k = 0; k <= n; k++) { const t = 0.35 + (k / n) * (6.28 - 0.7) + turn; pts.push([x + Math.cos(t) * r, 0.02, z + Math.sin(t) * r]); }
    const top = pts.map(([px, , pz]) => [px, 0.035, pz]);
    const verts = [...pts, ...top], m = pts.length;
    const faces = [];
    for (let k = 1; k < m - 1; k++) faces.push([0, k, k + 1], [m, m + k + 1, m + k]);
    for (let k = 0; k < m; k++) faces.push([k, (k + 1) % m, m + ((k + 1) % m), m + k]);
    c.push(mesh(verts, faces, shade(PAL.leaf, -0.1 + (R() - 0.5) * 0.12), { inside: [x, 0.03, z] }));
    if (i === 2) c.push(cyl([x, 0.08, z], 0.09, 0.09, PAL.white, { segments: 8 }), cyl([x, 0.13, z], 0.04, 0.04, PAL.mustard, { segments: 6 }));
  }
  return one(c);
});

// ---- a little jetty: a deck of boards 6 m long (along +z, out over the water) and 1.6 wide, on four pairs of posts; y = 0 is its deck --
import { JETTY } from "./layout.mjs";
def("jetty", () => {
  const c = [], { length: L, width: W } = JETTY, n = 15;
  for (let i = 0; i < n; i++) c.push(paint(soft([0, -0.06, (L * (i + 0.5)) / n], [W, 0.1, L / n - 0.04], shade(PAL.woodLight, ((i * 7) % 3) / 25 - 0.04)), "wood"));
  for (const x of [-W / 2 + 0.08, W / 2 - 0.08]) c.push(soft([x, -0.16, L / 2], [0.12, 0.12, L], PAL.woodDark));
  for (let k = 0; k < 4; k++) for (const x of [-W / 2, W / 2]) c.push(soft([x, -0.9, 0.3 + k * ((L - 0.6) / 3)], [0.16, 1.9, 0.16], PAL.woodDark));
  // a mooring post at the far end
  c.push(soft([W / 2 - 0.1, 0.3, L - 0.2], [0.16, 0.6, 0.16], PAL.woodDark));
  return one(c, { boxes: [] });
});

// ---- a rock outcrop: three or four big lumps of stone leaning together, for a steep bank's top; it blocks ---------------------------------
def("outcrop", () => {
  const R = rng(71), c = [];
  for (const [x, z, w, h] of [[0, 0, 2.8, 2.2], [-1.9, 0.4, 2.0, 1.5], [1.8, -0.3, 2.1, 1.3], [0.6, 1.2, 1.4, 0.8]]) {
    c.push(blob(R, [x, 0, z], [w, h, w * 0.85], shade(PAL.stone, (R() - 0.5) * 0.14), { top: 0.65 }));
  }
  return one(c, { capsules: [{ ax: -2.4, az: 0.2, bx: 2.4, bz: -0.1, r: 1.1 }] });
});

const want = process.argv.slice(2);
for (const [name, fn] of Object.entries(made)) {
  if (want.length && !want.includes(name)) continue;
  tool("model_write", { name, model: fn() }, { quiet: true });
  console.log(`made ${name}`);
}
if (!want.length) tool("model_preview", { names: Object.keys(made), fit: "each", yaw: 25, pitch: 20, columns: 4, width: 280, height: 220, image_out: "build/look/edges.png" });
