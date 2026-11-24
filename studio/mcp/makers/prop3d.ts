// prop3d_make: the things a small 3D level is furnished with, by kind and seed, each an ordinary model (free meshes of flat
// coloured faces) with what it blocks on the ground. Sizes are metres beside a hero about 1.6 high. The ideas for the
// trees and the ruins come from Pine Ridge's scenery scripts (scripts/rally/scenery-*.mjs); the code is new.

import { rngOf } from "./paint";
import { paletteOf } from "./palettes";
import { between, blend, choice, colours, Mesh3, modelDoc, part, pick, tone, U, type Args, type Rand, type V3 } from "./kit3d";

export const PROP_KINDS = [
  "tree", "pine", "dead_tree", "bush", "rock", "grass", "flowers", "mushroom", "log", "fence", "crate", "barrel", "lantern", "sign", "well",
  "wall", "broken_wall", "arch", "pillar", "broken_pillar", "steps", "dais", "house", "tower", "gem", "coin",
] as const;
export type PropKind = (typeof PROP_KINDS)[number];

export interface Prop {
  kind: PropKind;
  model: Args;
  /// How its entity should be declared, and why.
  entity: { static: boolean; solid: boolean; sway?: number; spins?: boolean };
  /// Where a light belongs, if it is a lamp (metres from the model's origin).
  light?: { x: number; y: number; z: number; radius: number; color: [number, number, number] };
  /// What it is and how it blocks, in words.
  says: string;
  size: { w: number; h: number; d: number };
}

type C = Record<string, string>;
interface Built {
  meshes: Mesh3[];
  colliders?: { x: number; z: number; r: number }[];
  boxes?: { x: number; z: number; hw: number; hl: number; turn: number }[];
  capsules?: { ax: number; az: number; bx: number; bz: number; r: number }[];
  entity: Prop["entity"];
  light?: Prop["light"];
  says: string;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/// Courses of stone blocks filling a wall from x0 to x1 (along x), `thick` deep about z = 0, up to `top(x)` at each place:
/// the joints staggered from course to course, every block its own tone, a hair smaller than its place so the joints show.
function masonry(m: Mesh3, rand: Rand, stone: string, moss: string, x0: number, x1: number, y0: number, top: (x: number) => number, thick: number, o: { course?: number; z?: number; mossy?: number } = {}) {
  const course = o.course ?? 0.42, z = o.z ?? 0;
  for (let y = y0, row = 0; y < 20; y += course, row++) {
    let x = x0 - (row % 2 ? between(rand, 0.25, 0.45) : 0);
    let any = false;
    while (x < x1 - 0.02) {
      const w = between(rand, 0.55, 0.95);
      const a = Math.max(x, x0), b = Math.min(x + w, x1);
      x += w;
      if (b - a < 0.12) continue;
      const mid = (a + b) / 2, room = top(mid) - y;
      if (room < course * 0.35) continue;
      const h = Math.min(course, room);
      const broken = h < course - 1e-6;
      const colour = rand() < (o.mossy ?? 0.1) && !broken ? blend(stone, moss, 0.45) : tone(stone, between(rand, -0.55, 0.45));
      m.box([mid, y + h / 2, z + between(rand, -0.02, 0.02)], [b - a - 0.035, h - 0.03, thick + between(rand, -0.04, 0.04)], colour, broken ? { rz: between(rand, -5, 5), taper: [between(rand, 0.75, 1), 1] } : {});
      any = true;
    }
    if (!any) break;
  }
}

/// A few fallen blocks lying about a place.
function rubble(m: Mesh3, rand: Rand, stone: string, at: V3, count: number, spread: number) {
  for (let i = 0; i < count; i++) {
    const s = between(rand, 0.22, 0.42);
    m.box([at[0] + between(rand, -spread, spread), s * 0.36, at[2] + between(rand, -spread, spread) * 0.6], [s * between(rand, 1, 1.6), s * 0.75, s], tone(stone, between(rand, -0.5, 0.3)), { ry: between(rand, 0, 90), rz: between(rand, -14, 14), rx: between(rand, -10, 10) });
  }
}

// ---- the painted style (`style: "painted"`, 2026-11-23): soft rounded crowns that the game paints as foliage --------------------------
// A crown is a few leaf clumps, each a smooth ball with bulges of its own; a pine is soft stacked tiers whose rims are uneven and ragged,
// their tips drooping by different amounts. Every leafy surface carries `paint: "foliage"` (docs/project-format.md, "Painted
// surfaces"): the renderer gives it leaf strokes, a darker core between the clumps and a sunlit rim, so the colours here stay plain
// (one tone a clump or a tier). Opt-in: the low style's models (and every example made with them) are unchanged.

/// A leaf clump into `m`: a ball of radii `r` about `c` with `bulges` soft bumps in random directions, shaded smooth.
function clump(m: Mesh3, c: V3, r: V3, color: string, rand: Rand, o: { seg?: number; rows?: number; bulges?: number; amp?: number } = {}): void {
  const seg = o.seg ?? 9, rows = o.rows ?? 6, amp = o.amp ?? 0.15;
  const bumps: [number, number, number, number][] = [];
  for (let k = 0; k < (o.bulges ?? 4); k++) {
    const y = rand() * 1.3 - 0.4, a = rand() * Math.PI * 2, s = Math.sqrt(Math.max(0, 1 - y * y));
    bumps.push([Math.sin(a) * s, y, Math.cos(a) * s, amp * (0.6 + rand() * 0.8)]);
  }
  const at = (d: V3) => 1 + bumps.reduce((t, [x, y, z, h]) => t + h * Math.exp(-(1 - (d[0] * x + d[1] * y + d[2] * z)) * 3.2), 0) - amp * 0.55;
  const put = (d: V3) => { const k = at(d); return m.v(c[0] + d[0] * r[0] * k, c[1] + d[1] * r[1] * k, c[2] + d[2] * r[2] * k); };
  const top = put([0, 1, 0]), turn = rand() * Math.PI * 2;
  const ring: number[][] = [];
  for (let i = 1; i < rows; i++) {
    const t = (i / rows) * Math.PI, y = Math.cos(t), s = Math.sin(t), row: number[] = [];
    for (let j = 0; j < seg; j++) { const a = turn + (j / seg) * Math.PI * 2; row.push(put([Math.sin(a) * s, y, Math.cos(a) * s])); }
    ring.push(row);
  }
  const bottom = put([0, -1, 0]);
  for (let j = 0; j < seg; j++) {
    const j2 = (j + 1) % seg;
    m.face([top, ring[0]![j]!, ring[0]![j2]!], color, c, true);
    for (let i = 0; i + 1 < ring.length; i++) {
      const a = ring[i]![j]!, b = ring[i]![j2]!, d = ring[i + 1]![j]!, e = ring[i + 1]![j2]!;
      if ((i + j) % 2) { m.face([a, b, e], color, c, true); m.face([a, e, d], color, c, true); } else { m.face([a, b, d], color, c, true); m.face([b, e, d], color, c, true); }
    }
    m.face([bottom, ring[ring.length - 1]![j2]!, ring[ring.length - 1]![j]!], color, c, true);
  }
}

/// A soft cone tier into `m`: a rounded point, a fat rim and a flat-ish underside, `r` at its widest; every other side reaches a
/// little less far and each tip droops by its own amount, so the rim reads as bunches of needles (never further out than `r`).
/// (2026-11-23, Fernhollow's seventh play: "Trees look a little blobby still") A drooping skirt of branches: the underside is hollow
/// (so it faces down and is painted darker), every other side is a long branch tip that reaches out and hangs down, the sides
/// between are notched in deep, so the rim reads as separate bunches of needles.
function raggedTier(m: Mesh3, y0: number, h: number, r: number, color: string, rand: Rand, seg = 12): void {
  const prof: [number, number][] = [[0, y0 + h * 0.16], [r * 0.8, y0 - h * 0.02], [r, y0 + h * 0.05], [r * 0.9, y0 + h * 0.19], [r * 0.56, y0 + h * 0.55], [r * 0.18, y0 + h * 0.93], [0, y0 + h]];
  const reach = [0, 1, 1, 0.85, 0.5, 0.2, 0], turn = rand() * Math.PI * 2;
  const out: number[] = [], droop: number[] = [];
  for (let j = 0; j < seg; j++) {
    const tip = j % 2 === 0;
    out.push(1 - (tip ? rand() * 0.05 : 0.24 + rand() * 0.08));
    droop.push(-(tip ? 0.1 + rand() * 0.12 : 0.02 + rand() * 0.03) * h);
  }
  const inside: V3 = [0, y0 + h * 0.3, 0];
  const bottom = m.v(0, prof[0]![1], 0), top = m.v(0, prof[6]![1], 0);
  const rows: number[][] = [];
  for (let i = 1; i <= 5; i++) {
    const [pr, py] = prof[i]!, row: number[] = [];
    for (let j = 0; j < seg; j++) {
      const a = turn + (j / seg) * Math.PI * 2, s = 1 + (out[j]! - 1) * reach[i]!;
      row.push(m.v(Math.sin(a) * pr * s, py + droop[j]! * (i <= 2 ? 1 : i === 3 ? 0.6 : 0), Math.cos(a) * pr * s));
    }
    rows.push(row);
  }
  for (let j = 0; j < seg; j++) {
    const j2 = (j + 1) % seg;
    m.face([bottom, rows[0]![j]!, rows[0]![j2]!], color, inside, true);
    for (let i = 0; i + 1 < rows.length; i++) m.face([rows[i]![j]!, rows[i]![j2]!, rows[i + 1]![j2]!, rows[i + 1]![j]!], color, inside, true);
    m.face([top, rows[4]![j2]!, rows[4]![j]!], color, inside, true);
  }
}

const PAINTED: Partial<Record<PropKind, (rand: Rand, c: C) => Built>> = {
  tree(rand, c) {
    const h = between(rand, 1.7, 2.2), lean: [number, number] = [between(rand, -0.18, 0.18), between(rand, -0.18, 0.18)];
    const trunk = new Mesh3(c.trunk);
    trunk.rings([{ y: 0, rx: 0.42 }, { y: 0.3, rx: 0.28 }, { y: h * 0.55, rx: 0.23, cx: lean[0] * 0.5, cz: lean[1] * 0.5 }, { y: h + 0.6, rx: 0.16, cx: lean[0], cz: lean[1] }], 8, c.trunk!, { smooth: true });
    // (2026-11-23) a darker core, a ring of separate leaf clusters round it (every other one higher, notches between them where the
    // sky shows at the crown's edge) and one on top; each cluster with a lighter cap where the sun falls, and a branch out to it
    const crown = new Mesh3(c.leaf, { paint: "foliage" });
    const top: V3 = [lean[0], h + 1.45, lean[1]];
    clump(crown, top, [1.05, 0.9, 1.05], tone(c.leaf!, -0.3), rand, { seg: 8, rows: 5, bulges: 3, amp: 0.12 });
    const lumps = 5 + Math.floor(rand() * 2), clusters: [V3, number][] = [];
    for (let i = 0; i < lumps; i++) {
      const a = (i / lumps) * Math.PI * 2 + between(rand, -0.25, 0.25), d = between(rand, 1.2, 1.4), r = between(rand, 0.78, 0.95);
      clusters.push([[top[0] + Math.cos(a) * d, top[1] + (i % 2 ? 0.3 : -0.35) + between(rand, -0.1, 0.1), top[2] + Math.sin(a) * d], r]);
    }
    clusters.push([[top[0] + between(rand, -0.2, 0.2), top[1] + 1.05, top[2] + between(rand, -0.2, 0.2)], 0.85]);
    for (const [p, r] of clusters) {
      const color = tone(c.leaf!, between(rand, -0.2, 0.15));
      clump(crown, p, [r, r * 0.85, r], color, rand, { seg: 8, rows: 6, bulges: 3, amp: 0.16 });
      const ox = p[0] - top[0], oz = p[2] - top[2], d = Math.hypot(ox, oz) || 1;
      clump(crown, [p[0] + (ox / d) * r * 0.12, p[1] + r * 0.42, p[2] + (oz / d) * r * 0.12], [r * 0.58, r * 0.5, r * 0.58], tone(color, 0.35), rand, { seg: 6, rows: 4, bulges: 2, amp: 0.12 });
      trunk.tube([[top[0] * 0.6, h + 0.2, top[2] * 0.6], [top[0] + ox * 0.45, (h + 0.2 + p[1]) * 0.5 + 0.1, top[2] + oz * 0.45], [top[0] + ox * 0.8, p[1] - r * 0.3, top[2] + oz * 0.8]], [0.09, 0.06, 0.035], 5, c.trunk!, { smooth: true });
    }
    return { meshes: [trunk, crown], colliders: [{ x: 0, z: 0, r: 0.36 }], entity: { static: true, solid: false, sway: 0.2 }, says: "a broadleaf tree with a painted crown of leaf clusters (lighter caps, branches between them); its trunk blocks (a circle of 0.36), you walk under its crown" };
  },
  pine(rand, c) {
    const trunk = new Mesh3(c.trunk);
    trunk.taper([0, 0, 0], 0, 1.5, 0.2, 0.12, 7, tone(c.trunk!, -0.5), { smooth: true, shades: false });
    const green = blend(c.leaf!, "#1d5b52", 0.5);
    const crown = new Mesh3(green, { paint: "foliage" });
    const tiers = 4 + Math.floor(rand() * 2), height = between(rand, 4.6, 5.6);
    let y = 0.8;
    for (let i = 0; i < tiers; i++) {
      const t = i / tiers, r = (1.55 - 1.15 * t) * between(rand, 0.94, 1.06), th = (height - 0.8) / tiers + 0.45; // (2026-11-23: less overlap, so the tiers read as separate shelves)
      raggedTier(crown, y, th, r, tone(green, i * 0.12 + between(rand, -0.1, 0.1)), rand);
      y += th - 0.45;
    }
    return { meshes: [trunk, crown], colliders: [{ x: 0, z: 0, r: 0.3 }], entity: { static: true, solid: false, sway: 0.14 }, says: "a pine of soft ragged tiers, painted; its trunk blocks (a circle of 0.3)" };
  },
  bush(rand, c) {
    const m = new Mesh3(c.leaf, { paint: "foliage" });
    const green = tone(c.leaf!, 0.35);
    clump(m, [0, 0.42, 0], [0.62, 0.5, 0.62], green, rand, { seg: 9, rows: 6, bulges: 4, amp: 0.12 });
    const n = 3 + Math.floor(rand() * 2);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand(), r = between(rand, 0.34, 0.46);
      const col = tone(green, between(rand, -0.3, 0.2)), p: V3 = [Math.cos(a) * 0.5, r * 0.8, Math.sin(a) * 0.5];
      clump(m, p, [r, r * 0.85, r], col, rand, { seg: 8, rows: 5, bulges: 3, amp: 0.12 });
      clump(m, [p[0] * 1.06, p[1] + r * 0.4, p[2] * 1.06], [r * 0.56, r * 0.46, r * 0.56], tone(col, 0.35), rand, { seg: 6, rows: 4, bulges: 2, amp: 0.1 }); // (a lighter cap)
    }
    return { meshes: [m], colliders: [{ x: 0, z: 0, r: 0.5 }], entity: { static: true, solid: false, sway: 0.08 }, says: "a round bush of painted leaf clumps; it blocks as a circle of 0.5" };
  },
};
/// The kinds that have a painted style.
export const PAINTED_KINDS = Object.keys(PAINTED) as PropKind[];

const BUILDERS: Record<PropKind, (rand: Rand, c: C, a: Args) => Built> = {
  tree(rand, c) {
    const h = between(rand, 1.7, 2.2), lean: [number, number] = [between(rand, -0.18, 0.18), between(rand, -0.18, 0.18)];
    const trunk = new Mesh3(c.trunk);
    const bark = (_: number, j: number) => tone(c.trunk!, Math.cos((j / 7) * Math.PI * 2 + 0.9) * 0.55 - 0.1);
    trunk.rings(
      [{ y: 0, rx: 0.46 }, { y: 0.3, rx: 0.3 }, { y: h * 0.55, rx: 0.25, cx: lean[0] * 0.5, cz: lean[1] * 0.5 }, { y: h + 0.5, rx: 0.17, cx: lean[0], cz: lean[1] }],
      7, bark,
    );
    // two boughs reaching into the crown
    for (let i = 0; i < 2; i++) {
      const a = rand() * Math.PI * 2, y = h * between(rand, 0.6, 0.8);
      trunk.tube([[lean[0] * 0.6, y, lean[1] * 0.6], [lean[0] + Math.cos(a) * 0.7, y + 0.75, lean[1] + Math.sin(a) * 0.7]], [0.1, 0.05], 5, bark);
    }
    const crown = new Mesh3(c.leaf);
    const top: V3 = [lean[0], h + 1.45, lean[1]];
    crown.blob(top, [between(rand, 1.75, 2.05), between(rand, 1.4, 1.6), between(rand, 1.75, 2.05)], c.leaf!, rand, { seg: 8, rows: 4, jitter: 0.13 });
    const lumps = 4 + Math.floor(rand() * 2);
    for (let i = 0; i < lumps; i++) {
      const a = (i / lumps) * Math.PI * 2 + rand() * 0.8, d = between(rand, 1.2, 1.55), r = between(rand, 1.0, 1.3);
      crown.blob([top[0] + Math.cos(a) * d, top[1] + between(rand, -0.85, 0.1), top[2] + Math.sin(a) * d], [r, r * 0.8, r], tone(c.leaf!, between(rand, -0.35, 0.35)), rand, { seg: 6, rows: 3, jitter: 0.15 });
    }
    return { meshes: [trunk, crown], colliders: [{ x: 0, z: 0, r: 0.36 }], entity: { static: true, solid: false, sway: 0.2 }, says: "a broadleaf tree; its trunk blocks (a circle of 0.36), you walk under its crown" };
  },
  pine(rand, c) {
    const trunk = new Mesh3(c.trunk);
    trunk.taper([0, 0, 0], 0, 1.5, 0.2, 0.12, 6, tone(c.trunk!, -0.5));
    const green = blend(c.leaf!, "#1d5b52", 0.5);
    const crown = new Mesh3(green);
    const tiers = 4 + Math.floor(rand() * 2), height = between(rand, 4.6, 5.6);
    let y = 0.9;
    for (let i = 0; i < tiers; i++) {
      const t = i / tiers, r = (1.55 - 1.15 * t) * between(rand, 0.94, 1.06), th = (height - 0.9) / tiers + 0.45;
      const last = i === tiers - 1;
      crown.rings(
        [{ y: y - 0.1, rx: r * 0.55 }, { y: y - 0.02, rx: r }, { y: y + 0.16, rx: r * 0.9 }, { y: y + th, rx: last ? 0 : r * 0.3 }],
        8,
        (ring, j) => tone(green, (ring === 0 ? -1.5 : ring === 1 ? -0.5 : 0.25) + Math.cos((j / 8) * Math.PI * 2 + 0.9) * 0.45 + (rand() - 0.5) * 0.3),
        { jitter: 0.07, rand, turn: rand() },
      );
      y += th - 0.45;
    }
    return { meshes: [trunk, crown], colliders: [{ x: 0, z: 0, r: 0.3 }], entity: { static: true, solid: false, sway: 0.14 }, says: "a pine; its trunk blocks (a circle of 0.3)" };
  },
  dead_tree(rand, c) {
    const wood = blend(c.trunk!, "#8d8a84", 0.45);
    const m = new Mesh3(wood);
    const bark = (_: number, j: number) => tone(wood, Math.cos((j / 6) * Math.PI * 2 + 0.9) * 0.6 - 0.1);
    const h = between(rand, 2.6, 3.4), bend: [number, number] = [between(rand, -0.3, 0.3), between(rand, -0.3, 0.3)];
    m.rings([{ y: 0, rx: 0.32 }, { y: 0.3, rx: 0.2 }, { y: h * 0.6, rx: 0.15, cx: bend[0] * 0.4, cz: bend[1] * 0.4 }, { y: h, rx: 0.07, cx: bend[0], cz: bend[1] }, { y: h + 0.5, rx: 0, cx: bend[0] * 1.3, cz: bend[1] * 1.3 }], 6, bark);
    const n = 3 + Math.floor(rand() * 2);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand(), y = h * between(rand, 0.45, 0.85), len = between(rand, 0.8, 1.4);
      const from: V3 = [bend[0] * 0.5, y, bend[1] * 0.5];
      const mid: V3 = [from[0] + Math.cos(a) * len * 0.6, y + len * 0.35, from[2] + Math.sin(a) * len * 0.6];
      const end: V3 = [from[0] + Math.cos(a + 0.3) * len, y + len * 0.95, from[2] + Math.sin(a + 0.3) * len];
      m.tube([from, mid, end], [0.085, 0.055, 0.02], 5, bark);
    }
    return { meshes: [m], colliders: [{ x: 0, z: 0, r: 0.26 }], entity: { static: true, solid: false, sway: 0.05 }, says: "a bare dead tree; its trunk blocks (a circle of 0.26)" };
  },
  bush(rand, c) {
    const m = new Mesh3(c.leaf);
    const green = tone(c.leaf!, 0.35);
    const n = 3 + Math.floor(rand() * 2);
    m.blob([0, 0.42, 0], [0.62, 0.5, 0.62], green, rand, { seg: 7, rows: 3, jitter: 0.14, flatBottom: 0.8 });
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand(), r = between(rand, 0.34, 0.46);
      m.blob([Math.cos(a) * 0.45, r * 0.8, Math.sin(a) * 0.45], [r, r * 0.85, r], tone(green, between(rand, -0.4, 0.3)), rand, { seg: 6, rows: 3, jitter: 0.15, flatBottom: 0.9 });
    }
    if (rand() < 0.6) {
      for (let i = 0; i < 6; i++) {
        const a = rand() * Math.PI * 2, y = between(rand, 0.3, 0.7), d = Math.sqrt(Math.max(0, 0.36 - (y - 0.42) ** 2)) * 1.05 + 0.1;
        m.box([Math.cos(a) * d, y, Math.sin(a) * d], [0.07, 0.07, 0.07], c.flower!, { ry: 45, rz: 45, flat: true });
      }
    }
    return { meshes: [m], colliders: [{ x: 0, z: 0, r: 0.5 }], entity: { static: true, solid: false, sway: 0.08 }, says: "a bush; it blocks as a circle of 0.5" };
  },
  rock(rand, c, a) {
    const size = choice(a.size, ["medium", "small", "large"] as const, "a rock's size");
    const k = size === "small" ? 0.45 : size === "large" ? 1.5 : 0.9;
    const m = new Mesh3(c.rock);
    const rx = k * between(rand, 0.75, 1), rz = k * between(rand, 0.6, 0.85), ry = k * between(rand, 0.5, 0.7);
    m.blob([0, ry * 0.55, 0], [rx, ry, rz], c.rock!, rand, { seg: 7, rows: 3, jitter: 0.22, tones: 0.8, flatBottom: 0.6 });
    if (rand() < 0.7) {
      const s = k * between(rand, 0.3, 0.45), an = rand() * Math.PI * 2;
      m.blob([Math.cos(an) * rx * 0.95, s * 0.5, Math.sin(an) * rz * 0.95], [s, s * 0.75, s * 0.9], tone(c.rock!, -0.3), rand, { seg: 6, rows: 3, jitter: 0.22, tones: 0.7, flatBottom: 0.6 });
    }
    m.turn(rand() * 360);
    return { meshes: [m], colliders: [{ x: 0, z: 0, r: r2(Math.max(rx, rz) * 0.85) }], entity: { static: true, solid: true }, says: `a ${size} rock; solid as it is shaped (a circle of ${r2(Math.max(rx, rz) * 0.85)} for a plain collider)` };
  },
  grass(rand, c) {
    const m = new Mesh3(c.grass);
    const n = 7 + Math.floor(rand() * 4);
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2, d = between(rand, 0, 0.13), h = between(rand, 0.16, 0.34), lean = between(rand, 0.05, 0.14);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      m.rings([{ y: 0, rx: 0.024 }, { y: h * 0.6, rx: 0.018, cx: Math.cos(a) * lean * 0.5, cz: Math.sin(a) * lean * 0.5 }, { y: h, rx: 0, cx: Math.cos(a) * lean, cz: Math.sin(a) * lean }], 3, (ring) => tone(c.grass!, -0.9 + ring * 0.9 + (rand() - 0.5) * 0.4), { at: [x, 0, z], turn: rand() });
    }
    return { meshes: [m], entity: { static: true, solid: false, sway: 0.5 }, says: "a tuft of grass; nothing blocks" };
  },
  flowers(rand, c) {
    const stems = new Mesh3(tone(c.leaf!, 0.4));
    const heads = new Mesh3(c.flower);
    const n = 4 + Math.floor(rand() * 3);
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2, d = between(rand, 0.05, 0.28), h = between(rand, 0.22, 0.42);
      const x = Math.cos(a) * d, z = Math.sin(a) * d, lx = between(rand, -0.06, 0.06), lz = between(rand, -0.06, 0.06);
      stems.rings([{ y: 0, rx: 0.018 }, { y: h, rx: 0.012, cx: lx, cz: lz }], 3, tone(c.leaf!, 0.3), { at: [x, 0, z] });
      // a leaf low on the stem
      stems.box([x + Math.cos(a) * 0.06, h * 0.3, z + Math.sin(a) * 0.06], [0.12, 0.012, 0.05], tone(c.leaf!, 0.6), { ry: (-a * 180) / Math.PI, rz: 28, flat: true });
      const colour = pick(rand, [c.flower!, c.flower2!, c.flower3!]);
      const r = between(rand, 0.05, 0.07);
      heads.rings([{ y: -0.015, rx: r * 0.4 }, { y: 0.012, rx: r }, { y: 0.03, rx: r * 0.55 }], 6, (ring) => tone(colour, ring ? 0.5 : -0.5), { at: [x + lx, h, z + lz], turn: rand() });
      heads.box([x + lx, h + 0.036, z + lz], [0.04, 0.03, 0.04], blend(c.flower2!, "#fff2b0", 0.3), { ry: 45, flat: true });
    }
    return { meshes: [stems, heads], entity: { static: true, solid: false, sway: 0.4 }, says: "a clump of flowers; nothing blocks" };
  },
  mushroom(rand, c) {
    const m = new Mesh3("#efe6d2");
    const cap = pick(rand, [c.flower!, c.roof!, blend(c.wood!, "#d9a35c", 0.5)]);
    const one = (x: number, z: number, s: number) => {
      m.rings([{ y: 0, rx: 0.07 * s }, { y: 0.2 * s, rx: 0.05 * s }], 6, "#efe6d2", { at: [x, 0, z] });
      m.rings([{ y: 0.16 * s, rx: 0.2 * s }, { y: 0.2 * s, rx: 0.21 * s }, { y: 0.29 * s, rx: 0.14 * s }, { y: 0.33 * s, rx: 0 }], 7, (ring) => (ring === 0 ? "#e6d9bd" : tone(cap, ring * 0.4 - 0.4)), { at: [x, 0, z], turn: rand() });
      for (let i = 0; i < 4; i++) {
        const an = (i / 4) * Math.PI * 2 + rand(), d = 0.12 * s;
        m.box([x + Math.cos(an) * d, 0.275 * s, z + Math.sin(an) * d], [0.045 * s, 0.03 * s, 0.045 * s], "#f6f1e4", { ry: rand() * 90, flat: true });
      }
    };
    one(0, 0, between(rand, 0.6, 0.8));
    const n = 1 + Math.floor(rand() * 2);
    for (let i = 0; i < n; i++) {
      const an = rand() * Math.PI * 2;
      one(Math.cos(an) * 0.15, Math.sin(an) * 0.15, between(rand, 0.32, 0.48));
    }
    return { meshes: [m], entity: { static: true, solid: false }, says: "mushrooms; nothing blocks" };
  },
  log(rand, c) {
    const m = new Mesh3(c.trunk);
    const len = between(rand, 1.5, 2.1), r = between(rand, 0.24, 0.3);
    const bark = (_: number, j: number) => tone(c.trunk!, Math.sin((j / 8) * Math.PI * 2) * 0.6 - 0.2 + (rand() - 0.5) * 0.3);
    m.tube([[-len / 2, r * 0.92, 0], [0, r * 0.95, 0.03], [len / 2, r * 0.9, 0]], [r, r * 0.96, r * 0.9], 8, bark, { ends: blend(c.wood!, "#e9c896", 0.45) });
    // growth rings on the ends, and a stub of a branch
    for (const s of [-1, 1]) m.tube([[s * (len / 2 + 0.004), r * 0.91, 0], [s * (len / 2 + 0.012), r * 0.91, 0]], r * 0.45, 8, tone(c.wood!, -0.2));
    m.tube([[len * 0.15, r * 1.5, 0.05], [len * 0.2, r * 2.2, 0.16]], [0.07, 0.05], 5, bark, { ends: blend(c.wood!, "#e9c896", 0.45) });
    if (rand() < 0.6) m.blob([-len * 0.2, r * 1.86, 0.02], [0.3, 0.07, 0.2], blend(c.grass!, c.leaf!, 0.5), rand, { seg: 6, rows: 2, jitter: 0.1 });
    return { meshes: [m], capsules: [{ ax: r2(-len / 2 + r), az: 0, bx: r2(len / 2 - r), bz: 0, r: r2(r) }], entity: { static: true, solid: true }, says: `a fallen log lying along x, ${r2(len)} long; solid as it is shaped (a capsule for a plain collider)` };
  },
  fence(rand, c) {
    const m = new Mesh3(c.wood);
    const wood = c.wood!;
    for (const x of [-1, 0, 1]) {
      const h = between(rand, 0.95, 1.05);
      m.box([x, h / 2, 0], [0.13, h, 0.13], tone(wood, between(rand, -0.5, 0.1)), { rz: between(rand, -2, 2), taper: 0.85 });
    }
    for (const y of [0.42, 0.78]) {
      for (const [a, b] of [[-1, 0], [0, 1]] as const) {
        m.box([(a + b) / 2, y + between(rand, -0.02, 0.02), 0.075], [1.06, 0.11, 0.045], tone(wood, between(rand, -0.2, 0.5)), { rz: between(rand, -1.6, 1.6) });
      }
    }
    return { meshes: [m], boxes: [{ x: 0, z: 0, hw: 1.05, hl: 0.1, turn: 0 }], entity: { static: true, solid: true }, says: "a 2 m length of wooden fence along x (place the next one 2 m on; turn with ry); solid as it is shaped" };
  },
  crate(rand, c) {
    const m = new Mesh3(c.wood);
    const s = between(rand, 0.74, 0.86), wood = c.wood!;
    m.box([0, s / 2, 0], [s - 0.05, s - 0.05, s - 0.05], tone(wood, -0.25));
    const edge = 0.09, e = s / 2 - edge / 2;
    // the frame: twelve edges, and a brace across each side
    for (const y of [edge / 2, s - edge / 2]) for (const k of [-1, 1]) {
      m.box([0, y, k * e], [s, edge, edge], tone(wood, 0.3 + (rand() - 0.5) * 0.3));
      m.box([k * e, y, 0], [edge, edge, s], tone(wood, 0.3 + (rand() - 0.5) * 0.3));
    }
    for (const kx of [-1, 1]) for (const kz of [-1, 1]) m.box([kx * e, s / 2, kz * e], [edge, s, edge], tone(wood, 0.25 + (rand() - 0.5) * 0.3));
    const diag = Math.hypot(s - 2 * edge, s - 2 * edge);
    for (const k of [-1, 1]) {
      m.box([0, s / 2, k * (s / 2 - 0.02)], [diag, edge * 0.8, 0.03], tone(wood, 0.1), { rz: 45 * k });
      m.box([k * (s / 2 - 0.02), s / 2, 0], [0.03, edge * 0.8, diag], tone(wood, 0.1), { rx: 45 * k });
    }
    return { meshes: [m], boxes: [{ x: 0, z: 0, hw: r2(s / 2), hl: r2(s / 2), turn: 0 }], entity: { static: true, solid: true }, says: `a crate ${r2(s)} a side; solid as it is shaped (too high to step onto, low enough to jump on)` };
  },
  barrel(rand, c) {
    const m = new Mesh3(c.wood);
    const h = between(rand, 0.92, 1.02), r = between(rand, 0.33, 0.37), wood = c.wood!;
    const stave = Array.from({ length: 10 }, () => between(rand, -0.45, 0.35));
    m.rings([{ y: 0, rx: r * 0.86 }, { y: h * 0.25, rx: r * 0.98 }, { y: h * 0.5, rx: r }, { y: h * 0.75, rx: r * 0.98 }, { y: h, rx: r * 0.86 }], 10, (_, j) => tone(wood, stave[j]! + Math.cos((j / 10) * Math.PI * 2 + 0.9) * 0.3));
    m.rings([{ y: h - 0.005, rx: r * 0.78 }, { y: h + 0.001, rx: r * 0.78 }], 10, tone(wood, 0.5));
    const iron = new Mesh3("#4b4f5a", { metallic: 0.6, roughness: 0.6 });
    for (const y of [h * 0.16, h * 0.84]) iron.rings([{ y: y - 0.035, rx: r * 0.95 }, { y: y + 0.035, rx: r * 0.95 }], 10, (_, j) => tone("#4b4f5a", Math.cos((j / 10) * Math.PI * 2 + 0.9) * 0.4), { caps: true });
    return { meshes: [m, iron], colliders: [{ x: 0, z: 0, r: r2(r) }], entity: { static: true, solid: true }, says: "a barrel; solid as it is shaped" };
  },
  lantern(rand, c) {
    const iron = "#3a3d47";
    const m = new Mesh3(iron);
    const h = between(rand, 2.25, 2.45);
    m.box([0, 0.09, 0], [0.34, 0.18, 0.34], tone(c.stone!, -0.3));
    m.box([0, 0.22, 0], [0.22, 0.1, 0.22], tone(c.stone!, 0.1));
    m.rings([{ y: 0.26, rx: 0.06 }, { y: h, rx: 0.042 }], 6, (_, j) => tone(iron, Math.cos((j / 6) * Math.PI * 2 + 0.9) * 0.5));
    m.box([0, h + 0.03, 0.22], [0.05, 0.05, 0.5], iron);
    m.box([0, h - 0.1, 0.16], [0.035, 0.035, 0.34], iron, { rx: -38 });
    // the lamp hangs from the end of the arm
    const lz = 0.42, ly = h - 0.33;
    m.box([0, h - 0.045, lz], [0.02, 0.1, 0.02], iron);
    m.box([0, ly + 0.17, lz], [0.26, 0.04, 0.26], iron, { taper: 0.5 });
    m.box([0, ly - 0.15, lz], [0.2, 0.03, 0.2], iron);
    for (const kx of [-1, 1]) for (const kz of [-1, 1]) m.box([kx * 0.09, ly, lz + kz * 0.09], [0.022, 0.3, 0.022], iron);
    const glass = new Mesh3("#ffd98a", { emissive: 1 });
    glass.box([0, ly, lz], [0.16, 0.27, 0.16], "#ffd98a", { flat: true });
    return {
      meshes: [m, glass], colliders: [{ x: 0, z: 0, r: 0.16 }], entity: { static: true, solid: true },
      light: { x: 0, y: r2(ly), z: lz, radius: 6, color: [255, 196, 120] },
      says: `a lamp post, its lamp hanging ${r2(lz)} in front (+z) at ${r2(ly)} high and glowing by itself; give the scene a light there`,
    };
  },
  sign(rand, c) {
    const m = new Mesh3(c.wood);
    const wood = c.wood!, lean = between(rand, -4, 4);
    m.box([0, 0.65, 0], [0.11, 1.3, 0.11], tone(wood, -0.5), { rz: lean, taper: 0.9 });
    m.box([0, 1.08, 0.07], [0.86, 0.46, 0.05], tone(wood, 0.35), { rz: lean + between(rand, -3, 3) });
    for (const [y, w] of [[1.17, 0.56], [1.07, 0.62], [0.97, 0.4]] as const) m.box([between(rand, -0.04, 0.04), y, 0.1], [w, 0.035, 0.012], tone(wood, -1.6), { rz: lean, flat: true });
    return { meshes: [m], colliders: [{ x: 0, z: 0, r: 0.12 }], entity: { static: true, solid: true }, says: "a signpost, its board facing +z; solid as it is shaped" };
  },
  well(rand, c) {
    const stone = c.stone!;
    const m = new Mesh3(stone);
    const R = 0.95, inner = 0.68, wallH = 0.8;
    // the ring of stones: two courses, each stone its own tone
    const course = (y0: number, y1: number, turn: number) => {
      const tones = Array.from({ length: 12 }, () => between(rand, -0.6, 0.45));
      m.rings([{ y: y0, rx: R }, { y: y1, rx: R }, { y: y1, rx: inner }, { y: y0, rx: inner }], 12, (ring, j) => tone(stone, tones[j]! + (ring === 1 ? 0.5 : ring === 2 ? -0.8 : 0)), { turn, caps: false });
    };
    course(0, 0.4, 0);
    course(0.4, wallH, 0.5);
    const water = new Mesh3(c.water);
    water.rings([{ y: 0.3, rx: inner + 0.01 }, { y: 0.34, rx: inner + 0.01 }], 12, tone(c.water!, -0.6));
    const wood = new Mesh3(c.wood);
    for (const k of [-1, 1]) wood.box([k * (R - 0.14), wallH + 0.72, 0], [0.13, 1.45, 0.13], tone(c.wood!, -0.4));
    wood.tube([[-(R - 0.14), wallH + 1.05, 0], [R - 0.14, wallH + 1.05, 0]], 0.05, 6, tone(c.wood!, -0.1));
    // a little roof
    for (const k of [-1, 1]) wood.box([0, wallH + 1.66, k * 0.33], [2.3, 0.07, 0.82], tone(c.roof!, k > 0 ? 0.1 : -0.4), { rx: k * 32 });
    wood.box([0, wallH + 1.88, 0], [2.36, 0.07, 0.1], tone(c.roof!, -0.7));
    // the rope and the bucket
    wood.box([0.15, wallH + 0.72, 0], [0.025, 0.66, 0.025], "#cbb891", { flat: true });
    wood.rings([{ y: wallH + 0.2, rx: 0.11 }, { y: wallH + 0.42, rx: 0.14 }], 8, (_, j) => tone(c.wood!, Math.cos((j / 8) * Math.PI * 2) * 0.4), { at: [0.15, 0, 0] });
    return { meshes: [m, water, wood], colliders: [{ x: 0, z: 0, r: R }], entity: { static: true, solid: true }, says: "a well with a roof; solid as it is shaped (a circle of 0.95 for a plain collider)" };
  },
  wall(rand, c) {
    const m = new Mesh3(c.stone);
    const len = 4, h = between(rand, 2.4, 2.8);
    masonry(m, rand, c.stone!, c.grass!, -len / 2, len / 2, 0, () => h, 0.5, { mossy: 0.12 });
    // a row of cap stones
    for (let x = -len / 2; x < len / 2 - 0.01; x += len / 5) m.box([x + len / 10, h + 0.07, 0], [len / 5 - 0.03, 0.14, 0.62], tone(c.stone!, between(rand, 0.1, 0.6)));
    return { meshes: [m], boxes: [{ x: 0, z: 0, hw: len / 2, hl: 0.28, turn: 0 }], entity: { static: true, solid: true }, says: `a stone wall 4 m long (along x) and ${r2(h)} high; solid as it is shaped` };
  },
  broken_wall(rand, c) {
    const m = new Mesh3(c.stone);
    const len = 4, high = between(rand, 2.3, 2.8), low = between(rand, 0.5, 0.9), side = rand() < 0.5 ? 1 : -1;
    const notch = between(rand, -0.4, 0.6);
    // tall at one end, crumbling down in steps to the other
    const top = (x: number) => {
      const t = (x * side + len / 2) / len;
      const stepped = Math.floor(t * 5) / 5;
      return low + (high - low) * Math.max(0, 1 - stepped * 1.25) - (Math.abs(x - notch) < 0.3 ? 0.4 : 0);
    };
    masonry(m, rand, c.stone!, c.grass!, -len / 2, len / 2, 0, top, 0.5, { mossy: 0.2 });
    rubble(m, rand, c.stone!, [side * 1.1, 0, 0.6], 4, 0.7);
    rubble(m, rand, c.stone!, [side * 0.4, 0, -0.55], 2, 0.5);
    return { meshes: [m], boxes: [{ x: 0, z: 0, hw: len / 2, hl: 0.28, turn: 0 }], entity: { static: true, solid: true }, says: "a ruined wall 4 m long (along x), high at one end and fallen at the other, with rubble; solid as it is shaped" };
  },
  arch(rand, c) {
    const m = new Mesh3(c.stone);
    const stone = c.stone!, half = 1.25, pier = 0.8, spring = 2.3;
    for (const k of [-1, 1]) {
      const x = k * (half + pier / 2);
      // (a plinth higher than a step: a walker goes round it, and does not half climb it)
      m.box([x, 0.2, 0], [pier + 0.24, 0.4, pier + 0.24], tone(stone, -0.35));
      masonry(m, rand, stone, c.grass!, x - pier / 2, x + pier / 2, 0.4, () => spring, pier, { course: 0.38, mossy: 0.12 });
      m.box([x, spring + 0.07, 0], [pier + 0.14, 0.14, pier + 0.14], tone(stone, 0.4));
    }
    // the ring of wedge stones, with a key stone
    const n = 9, r = half + pier / 2, y0 = spring + 0.14;
    for (let i = 0; i < n; i++) {
      const a = Math.PI * ((i + 0.5) / n), key = i === (n - 1) / 2;
      const w = (Math.PI * r) / n;
      m.box([Math.cos(a) * r, y0 + Math.sin(a) * r, 0], [(key ? pier * 1.2 : pier) , w * 1.02, pier * (key ? 1.08 : 0.98)], tone(stone, key ? 0.55 : between(rand, -0.5, 0.35)), { rz: (a * 180) / Math.PI, taper: [1, 1] });
    }
    const out = half + pier / 2;
    return {
      meshes: [m], boxes: [{ x: -out, z: 0, hw: 0.52, hl: 0.52, turn: 0 }, { x: out, z: 0, hw: 0.52, hl: 0.52, turn: 0 }], entity: { static: true, solid: true },
      says: `an arch to walk through along z: the opening is ${r2(half * 2)} wide and ${r2(spring + 0.14 + half)} high, between two piers; solid as it is shaped`,
    };
  },
  pillar(rand, c) {
    return column(rand, c, false);
  },
  broken_pillar(rand, c) {
    return column(rand, c, true);
  },
  steps(rand, c) {
    const m = new Mesh3(c.stone);
    const n = 4, rise = 0.25, run = 0.42, w = 2.4;
    for (let i = 0; i < n; i++) {
      // each step a slab resting on the one below
      const y = i * rise, z = -i * run;
      for (let x = -w / 2; x < w / 2 - 0.01; x += w / 3) {
        m.box([x + w / 6, y + rise / 2, z - (n - i) * run / 2 + run / 2], [w / 3 - 0.03, rise - 0.015, (n - i) * run - 0.02], tone(c.stone!, between(rand, -0.45, 0.4)));
      }
    }
    return {
      meshes: [m], boxes: [{ x: 0, z: r2(-(n - 1) * run / 2), hw: w / 2, hl: r2((n * run) / 2), turn: 0 }], entity: { static: true, solid: true },
      says: `four stone steps ${w} wide, climbing towards -z: each ${rise} high (a walker with the usual step of 0.35 climbs them), ${run} deep, the top at ${n * rise}. Make it solid = true (the plain box collider would only block)`,
    };
  },
  dais(rand, c) {
    const m = new Mesh3(c.stone);
    const stone = c.stone!;
    const tier = (r: number, y0: number, y1: number, turn: number) => {
      const tones = Array.from({ length: 10 }, () => between(rand, -0.5, 0.4));
      m.rings([{ y: y0, rx: r }, { y: y1, rx: r }], 10, (_, j) => tone(stone, tones[j]!), { turn });
      m.rings([{ y: y1 - 0.004, rx: r - 0.14 }, { y: y1 + 0.003, rx: r - 0.14 }], 10, tone(stone, 0.55), { turn });
    };
    tier(2.3, 0, 0.25, 0);
    tier(1.85, 0.25, 0.5, 0.5);
    // a ring of darker slabs set into the top
    m.rings([{ y: 0.5, rx: 0.9 }, { y: 0.508, rx: 0.9 }], 10, blend(stone, c.rock!, 0.5), { turn: 0 });
    m.rings([{ y: 0.508, rx: 0.5 }, { y: 0.514, rx: 0.5 }], 10, tone(stone, 0.8), { turn: 0.5 });
    return { meshes: [m], colliders: [{ x: 0, z: 0, r: 2.3 }], entity: { static: true, solid: true }, says: "a round stone platform of two low steps (0.25 each: a walker climbs them), 4.6 across, its top at 0.5. Make it solid = true (the plain circle would only block)" };
  },
  house(rand, c) {
    const W = 5, D = 4, wallH = 2.5, base = 0.35;
    const walls = new Mesh3(c.plaster);
    walls.box([0, base / 2, 0], [W + 0.16, base, D + 0.16], tone(c.stone!, -0.3));
    walls.box([0, base + wallH / 2, 0], [W, wallH, D], c.plaster!);
    const timber = new Mesh3(c.wood);
    const beam = tone(c.wood!, -0.9);
    for (const kx of [-1, 1]) for (const kz of [-1, 1]) timber.box([kx * (W / 2 - 0.02), base + wallH / 2, kz * (D / 2 - 0.02)], [0.2, wallH, 0.2], beam);
    for (const kz of [-1, 1]) timber.box([0, base + wallH - 0.08, kz * (D / 2 + 0.01)], [W, 0.16, 0.08], beam);
    for (const kx of [-1, 1]) timber.box([kx * (W / 2 + 0.01), base + wallH - 0.08, 0], [0.08, 0.16, D], beam);
    // the roof: two slabs meeting at a ridge along x, and the gable walls under them
    const rise = 1.5, over = 0.4, slope = Math.atan2(rise, D / 2), slab = Math.hypot(rise, D / 2) + over;
    const roof = new Mesh3(c.roof);
    for (const k of [-1, 1]) {
      const mid = (slab / 2 - 0.05);
      roof.box([0, base + wallH + rise - Math.sin(slope) * mid + 0.05, k * Math.cos(slope) * mid], [W + 0.7, 0.14, slab], tone(c.roof!, k > 0 ? 0.15 : -0.5), { rx: (k * slope * 180) / Math.PI });
      // rows of tiles as darker lines
      for (let i = 1; i < 4; i++) {
        const t = (slab * i) / 4 - 0.05;
        roof.box([0, base + wallH + rise - Math.sin(slope) * t + 0.115, k * Math.cos(slope) * t], [W + 0.72, 0.03, 0.06], tone(c.roof!, -1.2), { rx: (k * slope * 180) / Math.PI, flat: true });
      }
    }
    roof.box([0, base + wallH + rise + 0.1, 0], [W + 0.74, 0.12, 0.2], tone(c.roof!, -0.9));
    for (const k of [-1, 1]) {
      const x = k * (W / 2 - 0.03);
      const g = new Mesh3(c.plaster);
      const a = g.v(x, base + wallH, -D / 2), b = g.v(x, base + wallH, D / 2), t = g.v(x, base + wallH + rise, 0);
      const a2 = g.v(x - k * 0.1, base + wallH, -D / 2), b2 = g.v(x - k * 0.1, base + wallH, D / 2), t2 = g.v(x - k * 0.1, base + wallH + rise, 0);
      const inside: V3 = [x - k * 0.05, base + wallH + 0.4, 0];
      g.face([a, b, t], tone(c.plaster!, k > 0 ? -0.2 : 0), inside).face([a2, b2, t2], c.plaster!, inside).face([a, b, b2, a2], c.plaster!, inside);
      walls.add(g);
      timber.box([x + k * 0.04, base + wallH + rise / 2, 0], [0.07, rise - 0.1, 0.14], beam);
    }
    // the door and two windows on the front (+z), a window at each end
    const front = D / 2 + 0.02, door = between(rand, -0.9, 0.9);
    timber.box([door, base + 1.02, front], [1.0, 2.04, 0.08], beam);
    timber.box([door, base + 0.98, front + 0.03], [0.82, 1.9, 0.06], tone(c.wood!, 0.1));
    timber.box([door + 0.28, base + 1.0, front + 0.07], [0.07, 0.07, 0.04], "#d9b24a", { flat: true });
    walls.box([door, base * 0.5, front + 0.3], [1.3, base, 0.6], tone(c.stone!, 0.2));
    const glass = new Mesh3("#7fb6dc", { emissive: 0.15 });
    const window = (x: number, z: number, along: "x" | "z") => {
      const s: V3 = along === "x" ? [0.86, 0.86, 0.08] : [0.08, 0.86, 0.86], g: V3 = along === "x" ? [0.68, 0.68, 0.1] : [0.1, 0.68, 0.68];
      timber.box([x, base + 1.45, z], s, beam);
      glass.box([x, base + 1.45, z], g, "#7fb6dc", { flat: true });
      timber.box([x, base + 1.45, z], along === "x" ? [0.05, 0.68, 0.12] : [0.12, 0.68, 0.05], beam);
      timber.box([x, base + 1.45, z], along === "x" ? [0.68, 0.05, 0.12] : [0.12, 0.05, 0.68], beam);
      timber.box([x, base + 0.98, z + (along === "x" ? Math.sign(z) * 0.06 : 0)], along === "x" ? [1.0, 0.07, 0.2] : [0.2, 0.07, 1.0], tone(c.stone!, 0.3));
    };
    window(door > 0 ? door - 1.7 : door + 1.7, front, "x");
    window(-W / 2 - 0.02, between(rand, -0.6, 0.6), "z");
    window(W / 2 + 0.02, between(rand, -0.6, 0.6), "z");
    window(between(rand, -1.2, 1.2), -front, "x");
    // the chimney
    const cx = W * 0.28 * (rand() < 0.5 ? 1 : -1);
    walls.box([cx, base + wallH + rise + 0.25, -0.5], [0.5, 1.5, 0.5], tone(c.stone!, -0.1));
    walls.box([cx, base + wallH + rise + 1.04, -0.5], [0.62, 0.12, 0.62], tone(c.stone!, -0.6));
    return {
      meshes: [walls, timber, roof, glass], boxes: [{ x: 0, z: 0, hw: r2(W / 2 + 0.1), hl: r2(D / 2 + 0.1), turn: 0 }], entity: { static: true, solid: true },
      says: `a cottage ${W} by ${D} m, ${r2(base + wallH + rise)} to the ridge, its door on the +z side; solid as it is shaped`,
    };
  },
  tower(rand, c) {
    const m = new Mesh3(c.stone);
    const stone = c.stone!, R = 1.7, H = between(rand, 6.2, 7.2), seg = 12;
    // courses of stones, the joints staggered
    m.rings([{ y: 0, rx: R + 0.18 }, { y: 0.5, rx: R + 0.18 }, { y: 0.5, rx: R }], seg, (ring, j) => tone(stone, -0.5 + (ring ? 0.3 : 0) + Math.cos((j / seg) * Math.PI * 2 + 0.9) * 0.3), { caps: false });
    const course = 0.62;
    for (let y = 0.5, row = 0; y < H - 0.01; y += course, row++) {
      const tones = Array.from({ length: seg }, () => between(rand, -0.5, 0.4));
      m.rings([{ y, rx: R - (y / H) * 0.12 }, { y: Math.min(H, y + course), rx: R - (Math.min(H, y + course) / H) * 0.12 }], seg, (_, j) => tone(stone, tones[j]! + Math.cos((j / seg) * Math.PI * 2 + 0.9) * 0.35), { turn: row % 2 ? 0.5 : 0, caps: false });
    }
    const top = R - 0.12;
    m.rings([{ y: H, rx: top + 0.2 }, { y: H + 0.3, rx: top + 0.2 }], seg, (_, j) => tone(stone, 0.1 + Math.cos((j / seg) * Math.PI * 2 + 0.9) * 0.35));
    const roofed = rand() < 0.5;
    const roof = new Mesh3(c.roof);
    if (roofed) {
      roof.rings([{ y: H + 0.3, rx: top + 0.45 }, { y: H + 0.42, rx: top + 0.4 }, { y: H + 2.6, rx: 0 }], seg, (ring, j) => tone(c.roof!, (ring ? 0 : -0.8) + Math.cos((j / seg) * Math.PI * 2 + 0.9) * 0.6));
    } else {
      for (let j = 0; j < seg; j += 2) {
        const a = ((j + 0.5) / seg) * Math.PI * 2;
        m.box([Math.cos(a) * (top + 0.02), H + 0.6, Math.sin(a) * (top + 0.02)], [0.5, 0.6, 0.7], tone(stone, between(rand, -0.3, 0.4)), { ry: (-a * 180) / Math.PI });
      }
    }
    // a door at the foot (+z) and slit windows up the wall
    const wood = new Mesh3(c.wood);
    wood.box([0, 1.0, R - 0.02], [1.0, 2.0, 0.16], tone(stone, -0.9));
    wood.box([0, 0.95, R + 0.03], [0.8, 1.86, 0.12], tone(c.wood!, -0.3));
    wood.box([0.26, 1.0, R + 0.1], [0.07, 0.07, 0.04], "#d9b24a", { flat: true });
    for (const [a, y] of [[0.5, 3.4], [2.3, 4.6], [4.1, 3.0], [-0.9, 5.2]] as const) {
      const r = R - (y / H) * 0.12 - 0.05;
      wood.box([Math.sin(a) * r, y, Math.cos(a) * r], [0.2, 0.75, 0.2], "#1f2230", { ry: (a * 180) / Math.PI, flat: true });
    }
    return {
      meshes: [m, roof, wood], colliders: [{ x: 0, z: 0, r: r2(R + 0.18) }], entity: { static: true, solid: true },
      says: `a round stone tower ${r2(H)} high with ${roofed ? "a pointed roof" : "battlements"}, its door on the +z side; solid as it is shaped (a circle of ${r2(R + 0.18)} for a plain collider)`,
    };
  },
  gem(rand, c, a) {
    const colour = a.color ? String(a.color) : pick(rand, ["#3fd0e8", "#5fe08a", "#f05a7a", "#b07af0", "#f5c542"]);
    const m = new Mesh3(colour, { emissive: 0.45 });
    const r = 0.2, turn = rand();
    m.rings([{ y: -0.3, rx: 0 }, { y: 0.04, rx: r }, { y: 0.16, rx: r * 0.62 }], 6, (ring, j) => tone(colour, (ring === 0 ? -0.9 : 0.5) + (j % 2 ? 0.55 : -0.35)), { turn });
    m.rings([{ y: 0.16, rx: r * 0.62 }, { y: 0.163, rx: r * 0.62 }], 6, tone(colour, 1.6), { turn });
    return { meshes: [m], entity: { static: false, solid: false, spins: true }, says: "a gem to collect, 0.46 high, its middle at the model's origin (place it about 0.8 above the ground); it glows a little" };
  },
  coin(_rand, c) {
    const gold = c.gold!;
    const m = new Mesh3(gold, { metallic: 0.7, roughness: 0.35, emissive: 0.2 });
    const R = 0.2, T = 0.035;
    // a disc standing on its edge, facing +z, with a raised rim and a square stamped in the middle
    m.tube([[0, 0, -T], [0, 0, T]], R, 12, (_, j) => tone(gold, Math.cos((j / 12) * Math.PI * 2) * 0.6 - 0.2), { ends: gold });
    for (const k of [-1, 1]) {
      m.tube([[0, 0, k * T], [0, 0, k * (T + 0.012)]], R * 0.78, 12, tone(gold, -0.5), { ends: tone(gold, 0.7) });
      m.box([0, 0, k * (T + 0.02)], [0.12, 0.12, 0.012], tone(gold, -0.8), { rz: 45, flat: true });
    }
    return { meshes: [m], entity: { static: false, solid: false, spins: true }, says: "a coin to collect, 0.4 across, its middle at the model's origin (place it about 0.7 above the ground)" };
  },
};

function column(rand: Rand, c: C, broken: boolean): Built {
  const m = new Mesh3(c.stone);
  const stone = c.stone!, r = 0.36, drum = 0.62;
  const drums = broken ? 1 + Math.floor(rand() * 2) : 4;
  // (the base is higher than a step, so a walker goes round it and does not half climb it)
  m.box([0, 0.2, 0], [1.0, 0.4, 1.0], tone(stone, -0.3));
  m.box([0, 0.45, 0], [0.84, 0.1, 0.84], tone(stone, 0.2));
  let y = 0.5;
  for (let i = 0; i < drums; i++) {
    const last = broken && i === drums - 1;
    const tones = Array.from({ length: 10 }, () => between(rand, -0.25, 0.25));
    const cx = between(rand, -0.02, 0.02), cz = between(rand, -0.02, 0.02);
    // fluted: every second side a little darker
    m.rings([{ y: y + 0.012, rx: r }, { y: y + (last ? drum * between(rand, 0.5, 0.8) : drum) - 0.012, rx: r * (last ? 1 : 0.985), cx: last ? between(rand, -0.05, 0.05) : 0 }], 10, (_, j) => tone(stone, tones[j]! + (j % 2 ? -0.3 : 0.2) + Math.cos((j / 10) * Math.PI * 2 + 0.9) * 0.4), { at: [cx, 0, cz], turn: rand() < 0.5 ? 0 : 0.5 });
    y += drum;
  }
  if (!broken) {
    m.box([0, y + 0.07, 0], [0.8, 0.14, 0.8], tone(stone, 0.1), { taper: 1.15 });
    m.box([0, y + 0.22, 0], [1.0, 0.16, 1.0], tone(stone, 0.45));
  } else {
    // the rest of it lies beside the base
    const a = rand() * Math.PI * 2, d = 1.25;
    const lie = new Mesh3(stone);
    lie.tube([[-0.34, r, 0], [0.34, r, 0]], r, 10, (_, j) => tone(stone, (j % 2 ? -0.3 : 0.2) + Math.sin((j / 10) * Math.PI * 2) * 0.4 - 0.1), { ends: tone(stone, 0.35) });
    lie.turn((a * 180) / Math.PI + 70);
    m.add(lie, [Math.cos(a) * d, 0, Math.sin(a) * d]);
    rubble(m, rand, stone, [Math.cos(a + 2) * 0.9, 0, Math.sin(a + 2) * 0.9], 3, 0.35);
  }
  return {
    meshes: [m], colliders: [{ x: 0, z: 0, r: 0.6 }], entity: { static: true, solid: true },
    says: broken ? "the stump of a pillar on its base, a fallen drum and rubble beside it; solid as it is shaped" : `a stone pillar ${r2(y + 0.3)} high on a base 1 m square and 0.4 high; solid as it is shaped (a circle of 0.6 for a plain collider)`,
  };
}

/// One prop as a model document, with how to use it. The same kind, seed and palette always give the same model.
export function makeProp(a: Args): Prop {
  const kind = choice(a.kind, PROP_KINDS, "a prop's kind");
  const p = paletteOf(a.palette);
  const c = colours(p);
  const seed = Number.isFinite(a.seed) ? Number(a.seed) : 1;
  const rand = rngOf(seed * 7919 + PROP_KINDS.indexOf(kind) * 104729 + 17);
  // (`style: "painted"`: the painted version of a kind that has one; the others are the low style as ever)
  const painted = a.style === "painted" ? PAINTED[kind] : undefined;
  const b = painted ? painted(rand, c) : BUILDERS[kind](rand, c, a);
  const meshes = b.meshes.filter((m) => m.polys.length);
  const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const m of meshes) {
    const bb = m.bounds();
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k]!, bb.min[k]!);
      hi[k] = Math.max(hi[k]!, bb.max[k]!);
    }
  }
  // (what stands on the ground stands on it exactly: a lumpy rock is set down on its lowest point)
  if (!b.entity.spins && Math.abs(lo[1]) > 1e-6) {
    for (const m of meshes) m.verts = m.verts.map((p) => [p[0], p[1] - lo[1], p[2]]);
    hi[1] -= lo[1];
    lo[1] = 0;
  }
  // (the shapes are worked out in metres; a model document keeps them in model units, which the export scales by the model's
  // `scale` like its points: before 2026-11-22 they were written in metres and so came out 16 times too small in the game)
  const mu = (v: number) => Math.round(v * U * 1000) / 1000;
  const model = modelDoc([part(kind, [0, 0, 0], meshes)], {
    ...(b.colliders?.length ? { colliders: b.colliders.map((c) => ({ x: mu(c.x), z: mu(c.z), r: mu(c.r) })) } : {}),
    ...(b.capsules?.length ? { capsules: b.capsules.map((c: Args) => ({ ax: mu(c.ax), az: mu(c.az), bx: mu(c.bx), bz: mu(c.bz), r: mu(c.r) })) } : {}),
    ...(b.boxes?.length ? { boxes: b.boxes.map((c: Args) => ({ x: mu(c.x), z: mu(c.z), hw: mu(c.hw), hl: mu(c.hl), turn: c.turn })) } : {}),
  });
  return { kind, model, entity: b.entity, light: b.light, says: b.says, size: { w: r2(hi[0] - lo[0]), h: r2(hi[1] - lo[1]), d: r2(hi[2] - lo[2]) } };
}

/// The entity file a prop is placed with: scenery that never moves, solid where its shape should block; or, for what is
/// collected, a thing that turns and bobs.
export function propEntity(name: string, prop: Prop): string {
  const e = prop.entity;
  if (e.spins) {
    return `-- ${prop.says}. It turns and bobs (on_ground = true: a scene's y is its height above the ground under it); the hero's own code collects it (see the comment).
local Thing = nova.entity { model = "${name}", tags = { "${name}", "pickup" }, velocity = false, on_ground = true }

function Thing:create()
  self.base_y = self.y
  self.t = (self.x * 0.37 + (self.z or 0) * 0.61) % 6.28 -- so they do not all bob together
end

function Thing:update(dt)
  self.t = self.t + dt
  self.ry = self.t * 2
  self.y = self.base_y + math.sin(self.t * 2.4) * 0.1
end

-- In the hero's update, to collect what it comes near:
--   for _, p in ipairs(nova.all("pickup")) do
--     if math.abs(p.x - self.x) < 0.8 and math.abs(p.z - self.z) < 0.8 and math.abs(p.y - self.y - 0.8) < 1.2 then p:destroy() end
--   end

return Thing
`;
  }
  const keys = [`model = "${name}"`, "static = true"];
  if (e.solid) keys.push("solid = true");
  if (e.sway) keys.push(`sway = ${e.sway}`);
  // a tree (anything tall that sways) stands upright on the hills: lifted vertex by vertex, its crown would lean with the slope
  const upright = !!e.sway && prop.size.h > 1.2;
  if (upright) keys.push('lift = "upright"');
  keys.push("on_ground = true");
  return `-- ${prop.says}.\n-- Scenery: it never moves, and is drawn only near the camera. on_ground = true: it stands on the ground under its x, z (a scene's y is the height above it).${upright ? ' lift = "upright": on a slope its foot follows the ground and its crown stays level.' : ""}${e.solid ? " solid = true: its own shape blocks bodies (nova.solid.move) and the camera." : prop.model.colliders ? " Its model's collision circle blocks bodies moved with nova.solid.move, and its whole shape the camera." : ""}\nreturn nova.entity { ${keys.join(", ")} }\n`;
}
