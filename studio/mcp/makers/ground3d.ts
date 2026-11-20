// ground3d_make: the ground of a 3D level from a map of characters, as one mesh: grass that rises and falls gently, and
// paths, paved places, sand and water drawn into it with soft, wandering edges. Faces are flat and each a slightly
// different tone, like the props that stand on it.

import { hash2 } from "./paint";
import { paletteOf } from "./palettes";
import { blend, colours, Mesh3, modelDoc, part, tone, type Args, type V3 } from "./kit3d";

export const GROUND_KINDS = ["grass", "path", "paved", "sand", "water"] as const;
type Kind = (typeof GROUND_KINDS)[number];
const DEFAULT_LEGEND: Record<string, Kind> = { ".": "grass", g: "grass", p: "path", s: "paved", w: "water", a: "sand", " ": "grass" };

export interface Ground {
  model: Args;
  width: number;
  depth: number;
  cell: number;
  hills: number;
  says: string;
  where: string[];
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const smooth = (t: number) => {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
};

/// Smooth noise from 0 to 1 that changes over about one unit of x and z.
function noise(x: number, z: number, seed: number): number {
  const xi = Math.floor(x), zi = Math.floor(z), fx = smooth(x - xi), fz = smooth(z - zi);
  const h = (a: number, b: number) => hash2(a, b, seed);
  const top = h(xi, zi) + (h(xi + 1, zi) - h(xi, zi)) * fx, bottom = h(xi, zi + 1) + (h(xi + 1, zi + 1) - h(xi, zi + 1)) * fx;
  return top + (bottom - top) * fz;
}

export function makeGround(a: Args): Ground {
  const rows: unknown = a.map;
  if (!Array.isArray(rows) || !rows.length || !rows.every((r) => typeof r === "string" && r.length > 0)) throw new Error('map is rows of characters, like ["....", ".pp.", ".pp."]: the first row is the far edge (-z)');
  const cols = (rows[0] as string).length;
  const bad = (rows as string[]).findIndex((r) => r.length !== cols);
  if (bad >= 0) throw new Error(`map row ${bad} has ${(rows as string[])[bad]!.length} characters and row 0 has ${cols}: every row is the same length`);
  if (cols > 64 || rows.length > 64) throw new Error(`the map is ${cols} by ${rows.length}; at most 64 by 64 (make the squares bigger with "cell")`);
  const legend: Record<string, Kind> = { ...DEFAULT_LEGEND };
  if (a.legend !== undefined) {
    if (!a.legend || typeof a.legend !== "object" || Array.isArray(a.legend)) throw new Error(`legend says what each character is: { ".": "grass", "p": "path" } (${GROUND_KINDS.join(", ")})`);
    for (const [ch, kind] of Object.entries(a.legend)) {
      const k = String(kind).toLowerCase() === "stone" || String(kind).toLowerCase() === "paving" ? "paved" : String(kind).toLowerCase() === "dirt" ? "path" : String(kind).toLowerCase();
      if (ch.length !== 1) throw new Error(`legend: "${ch}" is not one character`);
      if (!(GROUND_KINDS as readonly string[]).includes(k)) throw new Error(`legend: "${ch}" is "${kind}", which is not a kind of ground (${GROUND_KINDS.join(", ")})`);
      legend[ch] = k as Kind;
    }
  }
  const grid: Kind[][] = (rows as string[]).map((row, r) => [...row].map((ch, c) => {
    const k = legend[ch];
    if (!k) throw new Error(`map row ${r}, column ${c}: '${ch}' is not in the legend (${Object.keys(legend).filter((x) => x !== " ").map((x) => `'${x}' ${legend[x]}`).join(", ")})`);
    return k;
  }));
  const cell = a.cell === undefined ? 2 : Number(a.cell);
  if (!(cell >= 1 && cell <= 8)) throw new Error("cell is the side of one square in metres, from 1 to 8");
  const hills = a.hills === undefined ? 0.5 : Number(a.hills);
  if (!(hills >= 0 && hills <= 3)) throw new Error("hills is how far the grass rises and falls in metres, from 0 to 3");
  const skirt = a.skirt === undefined ? 40 : Number(a.skirt);
  if (!(skirt >= 0 && skirt <= 400)) throw new Error("skirt is how far the ground runs on past the map, in metres, from 0 to 400");
  const seed = Number.isFinite(a.seed) ? Number(a.seed) : 1;
  const c = colours(paletteOf(a.palette));
  const nRows = grid.length, W = cols * cell, D = nRows * cell;

  // how finely it is cut: faces of about two thirds of a metre, fewer on a big map
  let sub = Math.max(1, Math.min(6, Math.round(cell / 0.5)));
  while (sub > 1 && cols * nRows * sub * sub > 8000) sub--;
  const step = cell / sub, nx = cols * sub, nz = nRows * sub;

  const at = (col: number, row: number): Kind => grid[Math.max(0, Math.min(nRows - 1, row))]![Math.max(0, Math.min(cols - 1, col))]!;
  /// What the ground is at a place: the map's square there.
  const kindAt = (x: number, z: number): Kind => at(Math.floor((x + W / 2) / cell), Math.floor((z + D / 2) / cell));
  /// How far a place is from the nearest square that is not grass (metres; 0 inside one), and what that square is.
  const offGrass = (x: number, z: number): { d: number; kind: Kind | null } => {
    const col = Math.floor((x + W / 2) / cell), row = Math.floor((z + D / 2) / cell);
    let best = Infinity, kind: Kind | null = null;
    for (let r = row - 2; r <= row + 2; r++) for (let q = col - 2; q <= col + 2; q++) {
      if (r < 0 || q < 0 || r >= nRows || q >= cols || grid[r]![q] === "grass") continue;
      const x0 = -W / 2 + q * cell, z0 = -D / 2 + r * cell;
      const dx = Math.max(x0 - x, 0, x - (x0 + cell)), dz = Math.max(z0 - z, 0, z - (z0 + cell));
      const d = Math.hypot(dx, dz);
      if (d < best) [best, kind] = [d, grid[r]![q]!];
    }
    return { d: best, kind };
  };
  const height = (x: number, z: number): number => {
    const k = kindAt(x, z);
    const near = offGrass(x, z);
    // level beside what is laid, rising with distance from it; and level again at the map's edge, where the skirt joins
    const edge = smooth(Math.min(x + W / 2, W / 2 - x, z + D / 2, D / 2 - z) / Math.max(cell * 1.5, 3));
    const free = smooth((near.d - cell * 0.35) / (cell * 1.6)) * edge;
    const roll = (noise(x / 7, z / 7, seed) - 0.5) * 2 * 0.7 + (noise(x / 2.6, z / 2.6, seed + 3) - 0.5) * 2 * 0.3;
    let y = hills * roll * free;
    if (k === "grass") y += 0.035 * smooth(near.d / (cell * 0.4)); // (a lip of turf beside a path)
    if (k === "water") y -= 0.34 + 0.1 * noise(x, z, seed + 5);
    else if (near.kind === "water") y -= 0.34 * (1 - smooth(near.d / (cell * 0.5)));
    return y;
  };

  const base: Record<Kind, string> = { grass: c.grass!, path: c.path!, paved: c.stone!, sand: c.sand!, water: blend(c.sand!, c.water!, 0.35) };
  const colourAt = (x: number, z: number, k: Kind): string => {
    const jit = hash2(Math.round(x * 31), Math.round(z * 31), seed + 7) - 0.5;
    if (k === "grass") {
      // broad lighter and darker patches, and every face a little different
      const patch = noise(x / 5, z / 5, seed + 21) - 0.5;
      return blend(tone(base.grass, patch * 1.3 + jit * 0.45), c.leaf!, Math.max(0, patch) * 0.3);
    }
    if (k === "paved") {
      // slabs about a metre square, each its own tone, every second row shifted
      const row = Math.floor(z / 1.05 + 1000), col = Math.floor((x + (row % 2 ? 0.52 : 0)) / 1.05 + 1000);
      return tone(base.paved, (hash2(col, row, seed + 9) - 0.5) * 1.3 + jit * 0.12);
    }
    if (k === "path") return tone(base.path, (noise(x / 1.7, z / 1.7, seed + 23) - 0.5) * 1.1 + jit * 0.35);
    if (k === "sand") return tone(base.sand, (noise(x / 2.5, z / 2.5, seed + 25) - 0.5) * 0.8 + jit * 0.25);
    return tone(base.water, -0.6 + jit * 0.2);
  };

  const land = new Mesh3(base.grass);
  // The points: a grid, each pushed a little off its place (not those on the map's edge), so that the edges between
  // kinds of ground, which run along the grid, wander like something laid by hand.
  const idx: number[][] = [];
  for (let j = 0; j <= nz; j++) {
    const row: number[] = [];
    for (let i = 0; i <= nx; i++) {
      const inside = i > 0 && j > 0 && i < nx && j < nz;
      const x = -W / 2 + i * step + (inside ? (hash2(i, j, seed + 51) - 0.5) * step * 0.5 : 0);
      const z = -D / 2 + j * step + (inside ? (hash2(i, j, seed + 52) - 0.5) * step * 0.5 : 0);
      row.push(land.v(x, height(-W / 2 + i * step, -D / 2 + j * step), z));
    }
    idx.push(row);
  }
  const below: V3 = [0, -1000, 0];
  /// The kind of the face at column i, row j of the fine grid (the map's edge repeated beyond it).
  const faceKind = (i: number, j: number): Kind => at(Math.floor(Math.max(0, Math.min(nx - 1, i)) / sub), Math.floor(Math.max(0, Math.min(nz - 1, j)) / sub));
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = -W / 2 + (i + 0.5) * step, z = -D / 2 + (j + 0.5) * step;
    const k = faceKind(i, j);
    const [p00, p10, p11, p01] = [idx[j]![i]!, idx[j]![i + 1]!, idx[j + 1]![i + 1]!, idx[j + 1]![i]!];
    // A corner that sticks out is cut off: where the faces on two sides that meet at a corner are both another kind,
    // the half of this face at that corner is given to them. So paths turn their corners at a slant, not square.
    const [L, R, N, S] = [faceKind(i - 1, j), faceKind(i + 1, j), faceKind(i, j - 1), faceKind(i, j + 1)];
    const cutOff: [boolean, Kind, number[], number[]][] = [
      [L !== k && L === N, L, [p00, p10, p01], [p10, p11, p01]],
      [R !== k && R === N, R, [p00, p10, p11], [p00, p11, p01]],
      [R !== k && R === S, R, [p10, p11, p01], [p00, p10, p01]],
      [L !== k && L === S, L, [p00, p11, p01], [p00, p10, p11]],
    ];
    const hit = cutOff.find((q) => q[0]);
    if (hit) {
      land.face(hit[2], colourAt(x, z, hit[1]), below);
      land.face(hit[3], colourAt(x, z, k), below);
    } else if (k === "paved" || k === "path") {
      land.face([p00, p10, p11, p01], colourAt(x, z, k), below);
    } else {
      // two triangles, cut one way or the other, a shade apart: the facets of low-poly land
      const col = colourAt(x, z, k), flip = (i + j) % 2 === 0;
      const t1 = flip ? [p00, p10, p11] : [p00, p10, p01], t2 = flip ? [p00, p11, p01] : [p10, p11, p01];
      land.face(t1, col, below);
      land.face(t2, tone(col, k === "grass" ? -0.22 : -0.12), below);
    }
  }
  // the skirt: the ground running on, flat, in broad faces, so the level does not end in a line against the sky
  if (skirt > 0) {
    const ring = [0, Math.min(skirt, 10), skirt].filter((v, i, l) => i === 0 || v > l[i - 1]!);
    for (let n = 0; n + 1 < ring.length; n++) {
      const a0 = ring[n]!, a1 = ring[n + 1]!;
      const pieces = Math.max(2, Math.round((W + D) / 16));
      const edgeLoop = (out: number): V3[] => {
        const pts: V3[] = [];
        const x0 = -W / 2 - out, x1 = W / 2 + out, z0 = -D / 2 - out, z1 = D / 2 + out;
        for (let i = 0; i < pieces; i++) pts.push([x0 + ((x1 - x0) * i) / pieces, 0, z0]);
        for (let i = 0; i < pieces; i++) pts.push([x1, 0, z0 + ((z1 - z0) * i) / pieces]);
        for (let i = 0; i < pieces; i++) pts.push([x1 - ((x1 - x0) * i) / pieces, 0, z1]);
        for (let i = 0; i < pieces; i++) pts.push([x0, 0, z1 - ((z1 - z0) * i) / pieces]);
        return pts;
      };
      const inner = edgeLoop(a0).map((p) => land.v(p[0], n === 0 ? -0.02 : 0, p[2])), outer = edgeLoop(a1).map((p) => land.v(p[0], 0, p[2]));
      for (let i = 0; i < inner.length; i++) {
        const i2 = (i + 1) % inner.length;
        const mid = land.verts[inner[i]!]!;
        land.face([inner[i]!, inner[i2]!, outer[i2]!, outer[i]!], tone(base.grass, (hash2(i, n, seed + 41) - 0.5) * 0.35), below);
      }
    }
  }
  // the water's surface, a little under the bank
  const water = new Mesh3(c.water!, { roughness: 0.25 });
  let wet = 0;
  for (let r = 0; r < nRows; r++) for (let q = 0; q < cols; q++) {
    if (grid[r]![q] !== "water") continue;
    wet++;
    const x0 = -W / 2 + q * cell - cell * 0.45, z0 = -D / 2 + r * cell - cell * 0.45, s = cell * 1.9 / 2;
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
      const xa = x0 + i * s, za = z0 + j * s;
      const v = [water.v(xa, -0.14, za), water.v(xa + s, -0.14, za), water.v(xa + s, -0.14, za + s), water.v(xa, -0.14, za + s)];
      water.face(v, tone(c.water!, (hash2(q * 2 + i, r * 2 + j, seed + 31) - 0.5) * 0.5), below);
    }
  }

  const count: Record<string, { n: number; first: [number, number] }> = {};
  grid.forEach((row, r) => row.forEach((k, q) => {
    const e = (count[k] ??= { n: 0, first: [r2(-W / 2 + (q + 0.5) * cell), r2(-D / 2 + (r + 0.5) * cell)] });
    e.n++;
  }));
  const where = Object.entries(count).filter(([k]) => k !== "grass").map(([k, e]) => `  ${k}: ${e.n} square${e.n === 1 ? "" : "s"}, the first at [x, z] = [${e.first.join(", ")}]`);
  return {
    model: modelDoc([part("ground", [0, 0, 0], [land, ...(wet ? [water] : [])])]),
    width: W, depth: D, cell, hills,
    says: `ground ${W} by ${D} m (${cols} by ${nRows} squares of ${cell} m), ${Object.entries(count).map(([k, e]) => `${e.n} ${k}`).join(", ")}; ${land.polys.length + water.polys.length} faces${skirt ? `, and ${skirt} m of flat grass beyond the edge` : ""}`,
    where,
  };
}
