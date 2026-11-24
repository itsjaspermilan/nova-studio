// The valley's trees, bushes, rocks, logs and stumps, in the game's one look (tools/palette.mjs: "a soft toy diorama"): soft rounded
// shapes like felt or painted wooden toys, smooth shading, a few chunky tiers rather than many sharp facets, one warm palette.
// Pines are three or four soft cones stacked (each a rounded profile turned round the trunk, its rim uneven and a little ragged, its
// tips drooping by different amounts); larches are taller and lighter; birches carry a crown of a few leaf clumps, each a ball with
// bulges of its own; bushes are clusters of such clumps; rocks are smooth pebbles. Every leafy surface is painted as foliage
// (`paint: "foliage"`, docs/project-format.md "Painted surfaces"): the renderer gives it leaf strokes, a darker core between the
// clumps and a sunlit rim (the owner's sixth play: "they just look like blobs now"). Their far versions (for the scenery's level of
// detail) are the same silhouettes with fewer sides, painted the same, so near and far match. Grass, flowers, the far mountains and
// the clouds still come from prop3d_make, in the same palette.
// Run: scripts/env.sh node examples/mountain-post/tools/nature.mjs [name ...]   (no names: all of them)
import { cyl, mesh, model, one, part, rng, shade, tube } from "./geo.mjs";
import { tool } from "./lib.mjs";
import { PAL } from "./palette.mjs";

const U = 16, u = (v) => Math.round(v * U * 1000) / 1000;
const made = {};
const def = (name, fn) => (made[name] = fn);

/// A profile [[radius, height], ...] (metres, from the axis, in order) spun round the y axis: a smooth turned shape.
function spun(profile, color, segments = 10, sharp = 50) {
  return mesh(profile.map(([r, y]) => [r, y, 0]), [[...profile.keys()]], color, { keep: true, modifiers: [{ type: "revolve", axis: "y", segments, sharp }] });
}
/// A round puff (a sphere squashed by `squash` in y), smooth.
function puff(c, r, color, squash = 1, segments = 10) {
  return { shape: "sphere", from: [u(c[0] - r), u(c[1] - r * squash), u(c[2] - r)], size: [u(2 * r), u(2 * r * squash), u(2 * r)], color, segments };
}
/// A soft cone tier: a rounded point at the top, a fat rounded rim, a flat-ish underside: the shape of a felt Christmas tree's layer.
/// Its rim is uneven: every other side reaches a little less far, each by its own amount, and each tip droops by its own amount, so
/// the edge reads as bunches of needles and not as a lathe's circle (never further out than `r`: the crowns the scene keeps off the
/// signs' sight lines are measured from it). Painted as foliage.
// (2026-11-23, the owner's seventh play: "Trees look a little blobby still") A tier is a drooping skirt of branches: its underside
// is hollow (the middle sits up inside it, so the underside faces down and the renderer darkens it), every other side is a long branch
// tip that reaches out and hangs down, the sides between are notched in deep, so the rim reads as separate bunches of needles.
function tier(y0, h, r, color, R, segments = 12, rag = 1) {
  const prof = [[0, y0 + h * 0.16], [r * 0.8, y0 - h * 0.02], [r, y0 + h * 0.05], [r * 0.9, y0 + h * 0.19], [r * 0.56, y0 + h * 0.55], [r * 0.18, y0 + h * 0.93], [0, y0 + h]];
  const reach = [0, 1, 1, 0.85, 0.5, 0.2, 0]; // (how much of the ragged edge each ring of the profile takes)
  const turn = R() * 6.283, verts = [], faces = [];
  const out = [], droop = [];
  for (let j = 0; j < segments; j++) {
    const tip = j % 2 === 0;
    out.push(1 - rag * (tip ? R() * 0.05 : 0.24 + R() * 0.08));
    droop.push(-rag * (tip ? 0.1 + R() * 0.12 : 0.02 + R() * 0.03) * h);
  }
  verts.push([0, prof[0][1], 0]);
  for (let i = 1; i < prof.length - 1; i++) {
    const [pr, py] = prof[i];
    for (let j = 0; j < segments; j++) {
      const a = turn + (j / segments) * 6.283, s = 1 + (out[j] - 1) * reach[i];
      verts.push([Math.sin(a) * pr * s, py + droop[j] * (i <= 2 ? 1 : i === 3 ? 0.6 : 0), Math.cos(a) * pr * s]);
    }
  }
  const top = verts.push([0, prof[prof.length - 1][1], 0]) - 1;
  const ring = (i, j) => 1 + (i - 1) * segments + (j % segments);
  for (let j = 0; j < segments; j++) faces.push([0, ring(1, j + 1), ring(1, j)]);
  for (let i = 1; i < prof.length - 2; i++) for (let j = 0; j < segments; j++) faces.push([ring(i, j), ring(i, j + 1), ring(i + 1, j + 1), ring(i + 1, j)]);
  for (let j = 0; j < segments; j++) faces.push([ring(prof.length - 2, j), ring(prof.length - 2, j + 1), top]);
  return { ...mesh(verts, faces, color, { smooth: true, inside: [0, y0 + h * 0.3, 0] }), paint: "foliage" };
}

/// A leaf clump: a ball (squashed by `squash`) with a few bulges of its own, each a soft bump in some direction, so a crown made of
/// clumps has sub-clumps and soft hollows between them that the renderer darkens. `seg` sides round, `rows` from top to bottom.
function clump(c, r, color, R, o = {}) {
  const seg = o.seg ?? 10, rows = o.rows ?? 7, squash = o.squash ?? 0.85, n = o.bulges ?? 4, amp = o.amp ?? 0.16;
  const bumps = [];
  for (let k = 0; k < n; k++) {
    const y = R() * 1.3 - 0.4, a = R() * 6.283, s = Math.sqrt(Math.max(0, 1 - y * y));
    bumps.push([Math.sin(a) * s, y, Math.cos(a) * s, amp * (0.6 + R() * 0.8)]);
  }
  const at = (d) => 1 + bumps.reduce((t, [x, y, z, h]) => t + h * Math.exp(-(1 - (d[0] * x + d[1] * y + d[2] * z)) * 3.2), 0) - amp * 0.55;
  const verts = [], faces = [];
  // (`point` draws the top up into a soft spire: a conifer's crown seen in a mass of them)
  const pt = o.point ?? 0;
  const put = (d) => { const k = r * at(d), up = Math.max(0, d[1]), w = 1 - pt * up ** 1.4 * 0.8; verts.push([c[0] + d[0] * k * w, c[1] + d[1] * k * squash * (1 + pt * up * 0.9), c[2] + d[2] * k * w]); };
  put([0, 1, 0]);
  const turn = R() * 6.283;
  for (let i = 1; i < rows; i++) {
    const t = (i / rows) * Math.PI, y = Math.cos(t), s = Math.sin(t);
    for (let j = 0; j < seg; j++) { const a = turn + (j / seg) * 6.283; put([Math.sin(a) * s, y, Math.cos(a) * s]); }
  }
  put([0, -1, 0]);
  const last = verts.length - 1, ring = (i, j) => 1 + (i - 1) * seg + (j % seg);
  for (let j = 0; j < seg; j++) faces.push([0, ring(1, j), ring(1, j + 1)]);
  for (let i = 1; i < rows - 1; i++) for (let j = 0; j < seg; j++) {
    // (two triangles a side, split along alternate diagonals so the bulges do not all lean one way)
    const a = ring(i, j), b = ring(i, j + 1), c2 = ring(i + 1, j + 1), d = ring(i + 1, j);
    if ((i + j) % 2) faces.push([a, b, c2], [a, c2, d]);
    else faces.push([a, b, d], [b, c2, d]);
  }
  for (let j = 0; j < seg; j++) faces.push([last, ring(rows - 1, j + 1), ring(rows - 1, j)]);
  return { ...mesh(verts, faces, color, { smooth: true, inside: c }), paint: o.paint ?? "foliage" };
}
/// A trunk: slightly tapered and rounded at its foot (it sinks a little into the ground, so a slope never shows a gap).
function trunk(h, r, color, segments = 6) {
  return spun([[0, -0.25], [r * 1.25, -0.25], [r * 1.25, 0.05], [r, 0.3], [r * 0.75, h], [0, h]], color, segments);
}

// ---- pines: three or four stacked soft cones in deep greens, their rims ragged -----------------------------------------------------
// (each tier's own random numbers come from a source of its own, so the sizes the scene measures stay those of the plain tiers)
// (2026-11-23: more tiers, each shorter, so they read as separate shelves of drooping branches with the trunk showing under the
// lower ones; each a little lighter than the one below, the top one lightest, as the sun catches the tips)
const pine = (seed, h, tiers, color) => () => {
  const R = rng(seed), c = [trunk(h * 0.42, 0.2, PAL.trunk)];
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers, y0 = h * (0.2 + t * 0.62), th = h * (0.34 - t * 0.07), r = h * (0.3 - t * 0.19) * (0.92 + R() * 0.16);
    c.push(tier(y0, th, r, shade(color, i * 0.06 + (R() - 0.5) * 0.04), rng(seed * 31 + i * 7 + 1)));
  }
  return one(c, { colliders: [{ x: 0, z: 0, r: 0.3 }] });
};
def("pine", pine(1, 5.2, 4, PAL.pine));
def("pine2", pine(3, 5.6, 5, PAL.pineDeep));
def("pine3", pine(7, 5.1, 4, shade(PAL.pine, 0.06)));
// (far: the same height and colour as a near pine in three ragged tiers of eight sides; from 110 m the dissolve between them is soft)
def("pine_far", () => one([trunk(2.1, 0.2, PAL.trunk, 5), tier(1.04, 1.8, 1.56, PAL.pine, rng(41), 8), tier(2.2, 1.65, 1.15, shade(PAL.pine, 0.08), rng(42), 8), tier(3.4, 1.5, 0.72, shade(PAL.pine, 0.15), rng(45), 8)]));

// ---- larches: tall, slender, light; five soft tiers, ragged -----------------------------------------------------------------------
const larch = (seed, h) => () => {
  const R = rng(seed), c = [trunk(h * 0.55, 0.15, PAL.trunk)];
  const tiers = 5;
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers, y0 = h * (0.24 + t * 0.6), th = h * 0.21, r = (1 - t) * h * 0.17 + 0.45;
    c.push(tier(y0, th, r * (0.94 + R() * 0.12), shade(PAL.larch, (R() - 0.5) * 0.08 + i * 0.035), rng(seed * 37 + i * 5 + 3), 11));
  }
  return one(c, { colliders: [{ x: 0, z: 0, r: 0.3 }] });
};
def("larch", larch(2, 13));
def("larch_small", larch(6, 8));
def("larch_far", () => one([trunk(4, 0.15, PAL.trunk, 5), tier(3.1, 3.6, 2.6, PAL.larch, rng(43), 8), tier(6.2, 3.4, 1.85, shade(PAL.larch, 0.05), rng(44), 8), tier(9.2, 3.4, 1.05, shade(PAL.larch, 0.1), rng(46), 8)]));

// ---- a birch: a pale trunk with painted dark marks, a crown of leaf clumps -----------------------------------------------------------
// (the five clumps of the old crown, each now a ball with bulges of its own: a crown of sub-clumps with soft hollows between)
def("birch", () => {
  const R = rng(2), h = 3.0, c = [trunk(h, 0.17, PAL.white)];
  for (let i = 0; i < 5; i++) { // flat painted bark marks: little dark lozenges hugging the trunk
    const y = 0.6 + i * 0.5, a = R() * 6.28, r = 0.17 * (1 - (y / h) * 0.25) + 0.005;
    c.push({ shape: "box", from: [u(Math.sin(a) * r - 0.06), u(y), u(Math.cos(a) * r - 0.06)], size: [u(0.12), u(0.05), u(0.12)], color: PAL.ink, rotation: [0, (a * 180) / Math.PI, 0] });
  }
  // (2026-11-23, "Trees look a little blobby still": the crown is now a ring of five separate leaf clusters round a darker core, every
  // other one higher, with notches between them where the sky shows at the crown's edge, and one on top; each cluster has a lighter
  // cap where the sun falls on its top, and a pale branch runs out to it from the trunk, seen in the gaps and under the crown. No
  // cluster reaches further out or higher than the old crown did: the signs' sight lines are measured from it.)
  crown(c, [0, 3.55, 0], { core: 0.9, ring: 5, out: 1.06, lift: 0.5, r: [0.68, 0.8], top: 0.74, color: shade(PAL.leaf, 0.08), bark: shade(PAL.white, -0.12), from: 2.4, seed: 12 });
  return one(c, { colliders: [{ x: 0, z: 0, r: 0.3 }] });
});

/// A broadleaf crown into `c`: a darker core clump at `at`, `ring` clusters round it `out` metres from the axis (every other one
/// `lift` higher), one on top (`top`: its radius, 0 for none), each with a lighter cap on its sunny top; branches (`bark`) from the
/// trunk at height `from` out to each cluster (none when `bark` is not given).
function crown(c, at, o) {
  const R = rng(o.seed), L = rng(o.seed * 7 + 1), clusters = [];
  for (let i = 0; i < o.ring; i++) {
    const a = (i / o.ring) * 6.283 + (R() - 0.5) * 0.5, r = o.r[0] + R() * (o.r[1] - o.r[0]);
    const y = at[1] + (i % 2 ? o.lift * 0.5 : -o.lift * 0.5) + (R() - 0.5) * 0.15;
    clusters.push([at[0] + Math.sin(a) * o.out, y, at[2] + Math.cos(a) * o.out, r]);
  }
  if (o.top) clusters.push([at[0] + (R() - 0.5) * 0.3, at[1] + o.out * 0.82, at[2] + (R() - 0.5) * 0.3, o.top]);

  c.push(clump(at, o.core, shade(o.color, -0.14), L, { seg: o.seg ?? 8, rows: 5, bulges: 3, amp: 0.12 }));
  for (const [x, y, z, r] of clusters) {
    const col = shade(o.color, (R() - 0.5) * 0.1);
    c.push(clump([x, y, z], r, col, L, { seg: o.seg ?? 8, rows: 6, bulges: 3, amp: 0.16 }));
    // the cap: a smaller, lighter clump on the cluster's top, a little outwards
    const ox = x - at[0], oz = z - at[2], d = Math.hypot(ox, oz) || 1;
    c.push(clump([x + (ox / d) * r * 0.12, y + r * 0.42, z + (oz / d) * r * 0.12], r * 0.58, shade(col, 0.16), L, { seg: 6, rows: 4, bulges: 2, amp: 0.12 }));
    if (o.bark) c.push(tube([[at[0], o.from, at[2]], [at[0] + ox * 0.45, (o.from + y) * 0.5 + 0.1, at[2] + oz * 0.45], [at[0] + ox * 0.8, y - r * 0.3, at[2] + oz * 0.8]], [0.075, 0.05, 0.03], o.bark, { segments: 5 }));
  }
}

// ---- bushes: a few leaf clusters round a darker core, lighter caps ------------------------------------------------------------------
const bush = (seed, color) => () => {
  const c = [];
  crown(c, [0, 0.46, 0], { core: 0.46, ring: 4, out: 0.44, lift: 0.14, r: [0.33, 0.42], top: 0, color, seed: seed * 13 + 5, seg: 7 });
  return one(c, { colliders: [{ x: 0, z: 0, r: 0.5 }] });
};
def("bush", bush(1, PAL.leaf));
def("bush2", bush(5, shade(PAL.pine, 0.1)));

// ---- rocks: smooth pebbles (a lumpy box cage, subdivided), a soft moss cap on the big one ------------------------------------------
const rock = (seed, w, h, d, moss) => () => {
  const R = rng(seed), v = [];
  for (const sy of [0, 1]) for (const sz of [-1, 1]) for (const sx of [-1, 1]) {
    const k = sy ? 0.7 + R() * 0.2 : 1;
    v.push([sx * w / 2 * k * (0.85 + R() * 0.3), sy ? h * (0.9 + R() * 0.2) : -0.12, sz * d / 2 * k * (0.85 + R() * 0.3)]);
  }
  const c = [mesh(v, [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]], shade(PAL.stone, (R() - 0.5) * 0.1), { modifiers: [{ type: "subsurf", levels: 2, renderLevels: 2, smooth: true }] })];
  if (moss) c.push(puff([w * 0.05, h * 0.82, 0], Math.min(w, d) * 0.33, PAL.moss, 0.35, 9));
  return one(c, { colliders: [{ x: 0, z: 0, r: Math.min(w, d) * 0.45 }] });
};
def("rock", rock(1, 1.5, 0.9, 1.4, false));
def("rock_big", rock(4, 2.4, 1.6, 2.2, true));
def("rock_small", rock(6, 0.7, 0.42, 0.75, false));

// ---- a fallen log and a stump: rounded wooden cylinders with pale cut ends -------------------------------------------------------------
def("log", () => {
  const L = 1.8, r = 0.3;
  const body = part("body", [0, 0, 0], [
    { ...cyl([0, r, 0], r, L, PAL.log, { axis: "x", segments: 12 }), smooth: true },
    cyl([L / 2 + 0.005, r, 0], r * 0.86, 0.02, PAL.woodLight, { axis: "x", segments: 12 }),
    cyl([-L / 2 - 0.005, r, 0], r * 0.86, 0.02, PAL.woodLight, { axis: "x", segments: 12 }),
    puff([0.3, r * 1.85, 0.05], 0.26, PAL.moss, 0.3, 8),
  ]);
  return model([body], { capsules: [{ ax: -L / 2, az: 0, bx: L / 2, bz: 0, r }] });
});
def("stump", () => one([
  spun([[0, -0.15], [0.62, -0.15], [0.62, 0.05], [0.48, 0.2], [0.45, 0.62], [0.4, 0.66], [0, 0.66]], PAL.log, 12),
  cyl([0, 0.665, 0], 0.37, 0.012, PAL.woodLight, { segments: 12 }),
], { colliders: [{ x: 0, z: 0, r: 0.45 }] }));

// ---- forest masses: the wood where nobody goes (the valley's sides, beyond the creek, the far bank), as a toy diorama shows it ----------
// (the owner, 2026-11-22: "Can we cut the trees a bit? Or do it in a different way?") Not trees one by one but a soft lumpy hill of
// canopy: a row of big squashed leaf clumps whose tops make a scalloped edge that reads as treetops, in the pine greens with a lighter
// larch clump here and there, the pine-green ones drawn up into soft spires, and a darker band of low wide clumps round its foot. Long
// along x; a capsule along its length blocks. Painted as canopy (the same leaf strokes, core and rim as a tree, the core worked out
// from the mass's long middle line), so it matches the trees in front of it. About six hundred triangles each; the scene places a
// few dozen of them, turned and scaled.
const mass = (seed, L, D, H) => () => {
  const R = rng(seed), K = rng(seed * 17 + 3), c = [];
  const n = Math.max(4, Math.round(L / (D * 0.6)));
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1), x = (t - 0.5) * (L - D * 0.9);
    const r = D * (0.46 + R() * 0.14), top = H * (0.62 + 0.38 * Math.sin(Math.PI * (0.15 + 0.7 * t)) * (0.8 + R() * 0.25));
    const sq = Math.min(1.25, top / (r * 1.6));
    const larchy = R() < 0.18;
    const col = larchy ? shade(PAL.larch, -0.12 - R() * 0.08) : shade(R() < 0.5 ? PAL.pine : PAL.pineDeep, (R() - 0.5) * 0.12);
    const z = (R() - 0.5) * D * 0.3;
    // (a pine-green clump is drawn up into a soft spire, so the scalloped edge reads as the tops of conifers; its middle sits lower
    // by as much, so the mass is as tall as before)
    const pt = larchy ? 0 : 0.35 + K() * 0.4;
    c.push(clump([x, top - r * sq * (1 + pt * 0.9), z], r, col, K, { seg: 8, rows: 6, squash: sq, bulges: 4, amp: 0.14, point: pt, paint: "canopy" }));
    // (2026-11-23) a lighter cap on its top, where the sun falls on the tips: each treetop of the mass reads on its own
    c.push(clump([x + (K() - 0.5) * r * 0.3, top - r * sq * (0.62 + pt * 0.5), z + (K() - 0.5) * r * 0.3], r * 0.52, shade(col, 0.15), K, { seg: 6, rows: 4, squash: sq, bulges: 2, amp: 0.12, point: pt * 0.8, paint: "canopy" }));
  }
  // the foot: a darker band of low, wide clumps, sunk a little into the ground so a slope never shows a gap
  const m = Math.max(2, Math.round(L / (D * 1.3)));
  for (let i = 0; i < m; i++) {
    const t = m === 1 ? 0.5 : i / (m - 1), x = (t - 0.5) * (L - D * 0.8);
    c.push(clump([x, D * 0.08, 0], D * 0.58, shade(PAL.pineDeep, -0.28 - R() * 0.06), K, { seg: 8, rows: 5, squash: 0.42, bulges: 3, amp: 0.1, paint: "canopy" }));
  }
  return model([part("body", [0, 0, 0], c)], { capsules: [{ ax: -L / 2 + D * 0.4, az: 0, bx: L / 2 - D * 0.4, bz: 0, r: D * 0.42 }] });
};
def("forest_long", mass(21, 42, 13, 13));
def("forest_tall", mass(22, 28, 15, 17));
def("forest_round", mass(23, 20, 16, 14));

// ---- run --------------------------------------------------------------------------------------------------------------------------------
const want = process.argv.slice(2);
for (const [name, fn] of Object.entries(made)) {
  if (want.length && !want.includes(name)) continue;
  tool("model_write", { name, model: fn() }, { quiet: true });
  console.log(`made ${name}`);
}
if (!want.length || want.includes("prop3d")) {
  // grass and flowers, the far mountains and the clouds: prop3d_make's, in the game's palette
  const palette = { base: "bright meadow", leaf: PAL.leaf, trunk: PAL.trunk, rock: PAL.stone, grass: PAL.grass, flower: "#efe0a8", flower2: PAL.rose, flower3: PAL.lilac };
  tool("prop3d_make", { palette, preview: false, kinds: [{ kind: "grass", name: "grass", seed: 1 }, { kind: "flowers", name: "flowers", seed: 1 }] });
  tool("prop3d_make", { kind: "mountain", name: "mountain", species: "range", palette, preview: false });
  tool("prop3d_make", { kind: "cloud", name: "cloud", species: "cumulus", palette, preview: false });
}
if (!want.length) tool("model_preview", { names: ["pine", "pine2", "pine3", "birch", "larch", "larch_small", "rock", "rock_big", "bush", "bush2", "log", "stump", "pine_far", "larch_far"], fit: "each", yaw: 25, pitch: 15, columns: 5, width: 240, height: 200, image_out: "build/look/nature.png" });
