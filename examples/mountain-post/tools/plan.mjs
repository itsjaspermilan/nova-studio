// A plan of the valley from straight above, for laying things out by eye (not shipped with the game): the ground shaded by its height
// and slope, contour lines every 2 m, a grid every 50 m (darker every 100 m, the cross at x = 0, z = 0), the roads' lines, the water,
// the playable area's edge and every placed thing as a dot by its kind. Nova's x runs to the LEFT of the picture (east is to the
// right, as on a map). Writes build/plan.png:  scripts/env.sh node examples/mountain-post/tools/plan.mjs [px per metre]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { writePNG } from "../../../scripts/lib/png.mjs";
import { ground } from "./heights.mjs";
import { GAME } from "./lib.mjs";

const K = Number(process.argv[2] ?? 2);
const scene = JSON.parse(readFileSync(join(GAME, "scenes/valley.scene.json"), "utf8"));
const [X0, Z0, X1, Z1] = scene.objects.find((o) => o.kind === "limits").props.bounds;
const W = Math.round((X1 - X0) * K), H = Math.round((Z1 - Z0) * K);
const px = Buffer.alloc(W * H * 3);
const g = ground();
// (picture column from x: x1 on the left)
const toPx = (x, z) => [(X1 - x) * K, (Z1 - z) * K];
for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
  const x = X1 - i / K, z = Z1 - j / K, h = g.height(x, z), s = g.slope(x, z);
  const t = Math.max(0, Math.min(1, h / 40));
  let r = 90 + 120 * t, gg = 140 + 70 * t, b = 80 + 60 * t;
  const shade = 1 - Math.min(0.5, s * 1.2);
  r *= shade; gg *= shade; b *= shade;
  const c0 = Math.floor(h / 2), c1 = Math.floor(g.height(x - 1 / K, z) / 2), c2 = Math.floor(g.height(x, z - 1 / K) / 2);
  if (c0 !== c1 || c0 !== c2) { r *= 0.8; gg *= 0.8; b *= 0.8; }
  if (Math.abs(x % 50) < 0.5 / K || Math.abs(z % 50) < 0.5 / K) { const k = Math.abs(x % 100) < 0.5 / K || Math.abs(z % 100) < 0.5 / K ? 0.55 : 0.8; r *= k; gg *= k; b *= k; }
  const o = (j * W + i) * 3;
  px[o] = r; px[o + 1] = gg; px[o + 2] = b;
}
const dot = (x, z, rad, c) => {
  const [cx, cy] = toPx(x, z), R = Math.max(1, rad * K);
  for (let j = Math.floor(cy - R); j <= cy + R; j++) for (let i = Math.floor(cx - R); i <= cx + R; i++) {
    if (i < 0 || j < 0 || i >= W || j >= H || Math.hypot(i - cx, j - cy) > R) continue;
    const o = (j * W + i) * 3; px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2];
  }
};
const line = (pts, rad, c, closed = false) => {
  const n = pts.length;
  for (let k = 0; k + (closed ? 0 : 1) < n; k++) {
    const a = pts[k], b = pts[(k + 1) % n], l = Math.hypot(b[0] - a[0], b[1] - a[1]), steps = Math.max(1, Math.ceil(l * K));
    for (let s = 0; s <= steps; s++) dot(a[0] + ((b[0] - a[0]) * s) / steps, a[1] + ((b[1] - a[1]) * s) / steps, rad, c);
  }
};
const COL = {
  tree: [30, 70, 35], mass: [45, 95, 50], house: [200, 60, 50], rock: [120, 120, 125], fence: [150, 110, 60], hedge: [40, 110, 40],
  pond: [70, 130, 200], other: [240, 200, 60], wall: [170, 165, 150],
};
const kindCol = (k) => (/pine|larch|birch/.test(k) ? COL.tree : /forest/.test(k) ? COL.mass : /post_office|cabin|workshop/.test(k) ? COL.house
  : /rock|outcrop/.test(k) ? COL.rock : /fence|gate/.test(k) ? COL.fence : /hedge|bush/.test(k) ? COL.hedge : /wall/.test(k) ? COL.wall : COL.other);
for (const o of scene.objects) {
  const p = o.props ?? {};
  if (o.kind === "roadline") line(p.points, p.surface === "road" ? 2.5 : 1.8, [245, 240, 225]);
  else if (o.kind === "water") line(p.points, p.width / 2, [70, 130, 200]);
  else if (o.kind === "pond") line(p.shore, 0.6, COL.pond, true);
  else if (o.kind === "playable") { for (const a of p.areas) line(a, 0.5, [230, 30, 30], true); for (const s of p.secrets ?? []) dot(s.at[0], s.at[1], 2.5, [255, 0, 255]); }
}
for (const o of scene.objects) {
  if (["roadline", "water", "pond", "playable", "limits", "lake", "groundcover", "valley_ground", "far_mountain"].includes(o.kind)) continue;
  const big = /forest/.test(o.kind) ? 8 * (o.props?.sx ?? 1) : /post_office|cabin/.test(o.kind) ? 4 : /tree|pine|larch|birch/.test(o.kind) ? 1.2 : 0.8;
  dot(o.x, o.z, big, kindCol(o.kind));
}
writePNG(join(GAME, "build/plan.png"), W, H, px);
console.log(`build/plan.png ${W} x ${H}: x ${X1} (left) to ${X0} (right), z ${Z1} (top) to ${Z0}; ${K} px a metre`);
