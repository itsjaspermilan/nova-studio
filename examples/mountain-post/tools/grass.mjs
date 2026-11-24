// Where the valley's grass grows (`nova.grass`, docs/project-format.md "Grass"): terrain/grass.png, an 8-bit grey picture over the
// map's bounds, a sample every half metre, white where grass grows in full, black where none does. Made from the same things the
// game stands on: the road network's real surface (junction patches, fillets, aprons and rounded ends included, roads.mjs) with
// the grass thinning over the last metre and a half before it; the creek and the gorge with their banks; the lake; the porches
// and steps (the scene's `deck`s) and the ground footprint of every house, wall, fence, rock, stump and bench (footprint.mjs, from
// the models). Trees are left out: grass grows round a trunk. Run it again after the roads or the scene change:
//
//   scripts/env.sh node examples/mountain-post/tools/grass.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { placedFootprint } from "./footprint.mjs";
import { GAME } from "./lib.mjs";
import { BRIDGE, DECK_ENDS, xz } from "./layout.mjs";
import { roads } from "./roads.mjs";

const CELL = 0.5;
const scene = JSON.parse(readFileSync(join(GAME, "scenes/valley.scene.json"), "utf8"));
const limits = scene.objects.find((o) => o.kind === "limits").props.bounds; // x0, z0, x1, z1
const [X0, Z0, X1, Z1] = limits;
const W = Math.round((X1 - X0) / CELL) + 1, H = Math.round((Z1 - Z0) / CELL) + 1;
const cover = new Float32Array(W * H).fill(1);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const at = (i, j) => [X0 + i * CELL, Z0 + j * CELL];
const cut = (i, j, k) => { if (i >= 0 && j >= 0 && i < W && j < H) cover[j * W + i] = Math.min(cover[j * W + i], k); };

// the roads: none on the surface, thinning over the last 1.5 m before it
const { clearance } = roads();
for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
  const [x, z] = at(i, j);
  const c = clearance([-x, z]);
  if (c < 2) cut(i, j, smooth(0.15, 1.6, c));
}

// the water: the creek and the gorge (a line with a width), the lake past its shore
const segDist = (p, a, b) => {
  const dx = b[0] - a[0], dz = b[1] - a[1], l = dx * dx + dz * dz;
  const t = l > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l)) : 0;
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t);
};
for (const w of scene.objects.filter((o) => o.kind === "water")) {
  const pts = w.props.points, half = w.props.width / 2;
  const reach = half + 2;
  for (let s = 0; s + 1 < pts.length; s++) {
    const [a, b] = [pts[s], pts[s + 1]];
    const i0 = Math.floor((Math.min(a[0], b[0]) - reach - X0) / CELL), i1 = Math.ceil((Math.max(a[0], b[0]) + reach - X0) / CELL);
    const j0 = Math.floor((Math.min(a[1], b[1]) - reach - Z0) / CELL), j1 = Math.ceil((Math.max(a[1], b[1]) + reach - Z0) / CELL);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) cut(i, j, smooth(half + 0.5, half + 1.8, segDist(at(i, j), a, b)));
  }
}
// the bridge's deck (the road network has a gap there: the deck carries the road), half a metre round it
{
  const a = xz(DECK_ENDS.a), b = xz(DECK_ENDS.b), half = BRIDGE.width / 2 + 0.5, reach = half + 1.5;
  const i0 = Math.floor((Math.min(a[0], b[0]) - reach - X0) / CELL), i1 = Math.ceil((Math.max(a[0], b[0]) + reach - X0) / CELL);
  const j0 = Math.floor((Math.min(a[1], b[1]) - reach - Z0) / CELL), j1 = Math.ceil((Math.max(a[1], b[1]) + reach - Z0) / CELL);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) cut(i, j, smooth(half, half + 1.2, segDist(at(i, j), a, b)));
}
const lake = scene.objects.find((o) => o.kind === "lake");
if (lake) for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) cut(i, j, smooth(0, 2, lake.props.z0 - 2 - at(i, j)[1]));

// porches and steps: a rectangle `hw` across and `hl` along the facing, half a metre round it
for (const d of scene.objects.filter((o) => o.kind === "deck")) {
  const ry = d.props.ry ?? 0, c = Math.cos(ry), s = Math.sin(ry);
  const hw = d.props.hw + 0.5, hl = d.props.hl + 0.5, r = Math.hypot(hw, hl);
  for (let j = Math.floor((d.z - r - Z0) / CELL); j <= Math.ceil((d.z + r - Z0) / CELL); j++)
    for (let i = Math.floor((d.x - r - X0) / CELL); i <= Math.ceil((d.x + r - X0) / CELL); i++) {
      const [x, z] = at(i, j), px = x - d.x, pz = z - d.z;
      const u = px * c - pz * s, v = px * s + pz * c;
      cut(i, j, Math.max(smooth(hw - 0.5, hw, Math.abs(u)), smooth(hl - 0.5, hl, Math.abs(v))));
    }
}

// what stands on the ground: every footprint point clears the grass within 0.35 m, thinning out to 0.8 m
const STANDS = new Set(["post_office", "cabin_hazel", "cabin_pip", "workshop", "mast", "stone_wall", "fence", "rock", "rock_big",
  "rock_small", "stump", "log", "bench", "picnic_table", "woodpile", "sawhorse", "planks", "mailbox", "signpost", "gate_post",
  "barrier", "notice_board", "bridge", "old_bridge"]);
// (a house's footprint is its walls and steps: the floor inside is cleared too, the outline's hull and half a metre round it)
const HOUSES = new Set(["post_office", "cabin_hazel", "cabin_pip", "workshop"]);
const hull = (pts) => {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const q of p) { while (lo.length > 1 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (hi.length > 1 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
};
const inside = (poly, x, z) => {
  let n = false;
  for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
    const [xa, za] = poly[a], [xb, zb] = poly[b];
    if ((za > z) !== (zb > z) && x < ((xb - xa) * (z - za)) / (zb - za) + xa) n = !n;
  }
  return n;
};
for (const o of scene.objects.filter((o) => HOUSES.has(o.kind))) {
  const pts = placedFootprint(o.kind, [-o.x, o.z], o.props?.ry ?? 0, o.props?.sx ?? 1).map(([e, n]) => [-e, n]);
  if (pts.length < 3) continue;
  const poly = hull(pts);
  const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
  for (let j = Math.floor((Math.min(...zs) - Z0) / CELL); j <= Math.ceil((Math.max(...zs) - Z0) / CELL); j++)
    for (let i = Math.floor((Math.min(...xs) - X0) / CELL); i <= Math.ceil((Math.max(...xs) - X0) / CELL); i++) {
      const [x, z] = at(i, j);
      if (inside(poly, x, z)) cut(i, j, 0);
    }
}
for (const o of scene.objects.filter((o) => STANDS.has(o.kind))) {
  const pts = placedFootprint(o.kind, [-o.x, o.z], o.props?.ry ?? 0, o.props?.sx ?? 1);
  for (const [e, n] of pts) {
    const x = -e, z = n;
    for (let j = Math.floor((z - 0.8 - Z0) / CELL); j <= Math.ceil((z + 0.8 - Z0) / CELL); j++)
      for (let i = Math.floor((x - 0.8 - X0) / CELL); i <= Math.ceil((x + 0.8 - X0) / CELL); i++) {
        const [px, pz] = at(i, j);
        cut(i, j, smooth(0.35, 0.8, Math.hypot(px - x, pz - z)));
      }
  }
}

// an 8-bit grey PNG
const crcTable = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]), out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
};
const raw = Buffer.alloc(H * (1 + W));
for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) raw[j * (1 + W) + 1 + i] = Math.round(cover[j * W + i] * 255);
const head = Buffer.alloc(13);
head.writeUInt32BE(W, 0); head.writeUInt32BE(H, 4); head[8] = 8; head[9] = 0;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", head), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
writeFileSync(join(GAME, "terrain/grass.png"), png);
const none = cover.reduce((n, v) => n + (v < 0.5 ? 1 : 0), 0);
console.log(`terrain/grass.png: ${W} x ${H}, a sample every ${CELL} m from x ${X0}, z ${Z0}; ${(100 * none / cover.length).toFixed(1)}% bare, ${png.length} bytes`);
console.log(`nova.grass { map = "terrain/grass.png", x = ${X0}, z = ${Z0}, cell = ${CELL} }`);
