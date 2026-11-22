// The valley's trees, bushes, rocks, logs and stumps, in the game's one look (tools/palette.mjs: "a soft toy diorama"): soft rounded
// shapes like felt or painted wooden toys, smooth shading, a few chunky tiers rather than many sharp facets, one warm palette.
// Pines are three or four soft cones stacked (each a rounded profile spun round the trunk); larches are taller and lighter;
// birches carry a crown of round puffs; bushes are clusters of puffs; rocks are smooth pebbles. Their far versions (for the
// scenery's level of detail) are the same silhouettes with fewer sides. Grass, flowers, the far mountains and the clouds still
// come from prop3d_make, in the same palette.
// Run: scripts/env.sh node examples/mountain-post/tools/nature.mjs [name ...]   (no names: all of them)
import { cyl, mesh, model, one, part, rng, shade } from "./geo.mjs";
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
function tier(y0, h, r, color, segments = 9) { // (nine sides, shaded smooth: round enough, and there are two thousand trees)
  return spun([[0, y0 + h * 0.05], [r * 0.86, y0], [r, y0 + h * 0.1], [r * 0.93, y0 + h * 0.24], [r * 0.62, y0 + h * 0.58], [r * 0.2, y0 + h * 0.95], [0, y0 + h]], color, segments); // (from the bottom up: its faces look out)
}
/// A trunk: slightly tapered and rounded at its foot (it sinks a little into the ground, so a slope never shows a gap).
function trunk(h, r, color, segments = 6) {
  return spun([[0, -0.25], [r * 1.25, -0.25], [r * 1.25, 0.05], [r, 0.3], [r * 0.75, h], [0, h]], color, segments);
}

// ---- pines: three or four stacked soft cones in deep greens -------------------------------------------------------------------------
const pine = (seed, h, tiers, color) => () => {
  const R = rng(seed), c = [trunk(h * 0.35, 0.2, PAL.trunk)];
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers, y0 = h * (0.16 + t * 0.6), th = h * (0.44 - t * 0.08), r = h * (0.3 - t * 0.17) * (0.92 + R() * 0.16);
    c.push(tier(y0, th, r, shade(color, i * 0.05 + (R() - 0.5) * 0.04)));
  }
  return one(c, { colliders: [{ x: 0, z: 0, r: 0.3 }] });
};
def("pine", pine(1, 5.2, 3, PAL.pine));
def("pine2", pine(3, 5.6, 4, PAL.pineDeep));
def("pine3", pine(7, 5.1, 3, shade(PAL.pine, 0.06)));
def("pine_far", () => one([trunk(1.6, 0.2, PAL.trunk, 5), tier(0.8, 4.6, 1.5, PAL.pine, 6)]));

// ---- larches: tall, slender, light; four soft tiers --------------------------------------------------------------------------------
const larch = (seed, h) => () => {
  const R = rng(seed), c = [trunk(h * 0.5, 0.15, PAL.trunk)];
  const tiers = 4;
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers, y0 = h * (0.22 + t * 0.58), th = h * 0.26, r = (1 - t) * h * 0.17 + 0.45;
    c.push(tier(y0, th, r * (0.94 + R() * 0.12), shade(PAL.larch, (R() - 0.5) * 0.08 + i * 0.03), 8));
  }
  return one(c, { colliders: [{ x: 0, z: 0, r: 0.3 }] });
};
def("larch", larch(2, 13));
def("larch_small", larch(6, 8));
def("larch_far", () => one([trunk(3, 0.15, PAL.trunk, 5), tier(2.4, 10, 2.1, PAL.larch, 6)]));

// ---- a birch: a pale trunk with painted dark marks, a crown of round puffs -----------------------------------------------------------
def("birch", () => {
  const R = rng(2), h = 3.0, c = [trunk(h, 0.17, PAL.white)];
  for (let i = 0; i < 5; i++) { // flat painted bark marks: little dark lozenges hugging the trunk
    const y = 0.6 + i * 0.5, a = R() * 6.28, r = 0.17 * (1 - (y / h) * 0.25) + 0.005;
    c.push({ shape: "box", from: [u(Math.sin(a) * r - 0.06), u(y), u(Math.cos(a) * r - 0.06)], size: [u(0.12), u(0.05), u(0.12)], color: PAL.ink, rotation: [0, (a * 180) / Math.PI, 0] });
  }
  for (const [x, y, z, r] of [[0, 3.6, 0, 1.35], [0.9, 3.1, 0.4, 0.95], [-0.8, 3.2, -0.3, 1.0], [0.2, 4.4, -0.5, 0.9], [-0.3, 3.0, 0.9, 0.8]]) c.push(puff([x, y, z], r, shade(PAL.leaf, 0.08 + (R() - 0.5) * 0.1), 0.85));
  return one(c, { colliders: [{ x: 0, z: 0, r: 0.3 }] });
});

// ---- bushes: a few round puffs together ----------------------------------------------------------------------------------------------
const bush = (seed, color) => () => {
  const R = rng(seed), c = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * 6.28 + R(), d = i === 0 ? 0 : 0.42, r = i === 0 ? 0.55 : 0.36 + R() * 0.1;
    c.push(puff([Math.sin(a) * d, r * 0.8, Math.cos(a) * d], r, shade(color, (R() - 0.5) * 0.12), 0.85, 9));
  }
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
// canopy: a row of big squashed puffs whose tops make a scalloped edge that reads as treetops, in the pine greens with a lighter
// larch puff here and there, and a darker band of low wide puffs round its foot. Long along x; a capsule along its length blocks.
// A few hundred triangles each; the scene places a few dozen of them, turned and scaled.
const mass = (seed, L, D, H) => () => {
  const R = rng(seed), c = [];
  const n = Math.max(4, Math.round(L / (D * 0.6)));
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1), x = (t - 0.5) * (L - D * 0.9);
    const r = D * (0.46 + R() * 0.14), top = H * (0.62 + 0.38 * Math.sin(Math.PI * (0.15 + 0.7 * t)) * (0.8 + R() * 0.25));
    const sq = Math.min(1.25, top / (r * 1.6));
    const col = R() < 0.18 ? shade(PAL.larch, -0.12 - R() * 0.08) : shade(R() < 0.5 ? PAL.pine : PAL.pineDeep, (R() - 0.5) * 0.12);
    c.push({ ...puff([x, top - r * sq, (R() - 0.5) * D * 0.3], r, col, sq, 7), smooth: true });
  }
  // the foot: a darker band of low, wide puffs, sunk a little into the ground so a slope never shows a gap
  const m = Math.max(2, Math.round(L / (D * 1.3)));
  for (let i = 0; i < m; i++) {
    const t = m === 1 ? 0.5 : i / (m - 1), x = (t - 0.5) * (L - D * 0.8);
    c.push({ ...puff([x, D * 0.08, 0], D * 0.58, shade(PAL.pineDeep, -0.28 - R() * 0.06), 0.42, 7), smooth: true });
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
