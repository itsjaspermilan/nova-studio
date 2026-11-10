// Unwrapping shapes onto the model's texture. Each textured shape owns a block of texels (`texture.at` is its
// top-left corner); inside the block its faces are laid out automatically, one texel per model unit by default.
// The layout depends only on the shape's geometry, so it stays put while a shape is moved or turned; resizing a
// shape changes its block, and "Pack" in the editor lays every block out again.

import { newRaster, setPixel, type Raster, type Rgba } from "./pixels";
import type { Cube, Face, ModelDoc, Vec3 } from "./model-doc";
import { hexToRgba, MAX_TEXTURE, metallicOf, MIN_TEXTURE, NEW_TEXEL_SCALE, roughnessOf } from "./model-doc";
import { hasVolume, polyColor, segmentsOf, solidOf, unitSolid } from "./model-mesh";
import { walk } from "./model-doc";

export type UV = [number, number];

export interface Unwrap {
  /// The block of texels the shape needs, width then height.
  size: [number, number];
  /// For each polygon of the shape, the texel (relative to the block) of each of its points.
  polys: UV[][];
  /// A mesh: its islands, each as the lowest polygon in it and the rectangle it covers in the block.
  islands?: { poly: number; x: number; y: number; w: number; h: number }[];
}

const texels = (units: number, scale: number) => Math.max(1, Math.ceil(units * scale - 1e-9));
const GAP = 1;
const ISLAND_GAP = 2; // (texels between a mesh's islands: room for the padding round each, see bakeColors)

/// Corner of the unit box -> position inside a face's rectangle (0..1 each way), seen from outside with up as up.
function faceUV(face: string, c: Vec3): UV {
  switch (face) {
    case "north": return [1 - c[0], 1 - c[1]];
    case "south": return [c[0], 1 - c[1]];
    case "east": return [1 - c[2], 1 - c[1]];
    case "west": return [c[2], 1 - c[1]];
    case "up": return [c[0], c[2]];
    default: return [c[0], 1 - c[2]]; // down
  }
}

export const boxRects = (w: number, h: number, d: number): Record<string, [number, number, number, number]> => ({
  up: [d, 0, w, d], down: [d + w, 0, w, d], west: [0, d, d, h], north: [d, d, w, h], east: [d + w, d, d, h], south: [2 * d + w, d, w, h],
});

/// Roughly the length of the way round an ellipse with these radii.
const around = (a: number, b: number) => Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));

export function unwrap(c: Cube): Unwrap {
  const shape = c.shape ?? "box";
  const s = c.texture?.scale ?? 1;
  const solid = solidOf(c);
  if (!hasVolume(c)) return { size: [1, 1], polys: solid.polys.map((p) => p.v.map(() => [0, 0] as UV)) };

  if (shape === "box" || shape === "wedge" || shape === "pyramid") {
    const [w, h, d] = [texels(c.size[0], s), texels(c.size[1], s), texels(c.size[2], s)];
    const rects = boxRects(w, h, d);
    const unit = unitSolid(c);
    // A mirrored copy shows the same texels reflected: its points are reflected back into the original's box and its
    // faces across the mirror swap places.
    const mirror = c.texture?.mirror ?? 0;
    const swap: Record<string, string> = { east: "west", west: "east", up: "down", down: "up", south: "north", north: "south" };
    const bitOf: Record<string, number> = { east: 1, west: 1, up: 2, down: 2, south: 4, north: 4 };
    const swapped = (face: string) => (mirror & bitOf[face]! ? swap[face]! : face);
    const own = c.texture?.faces;
    const [bx, by] = c.texture?.at ?? [0, 0];
    const polys = unit.polys.map((p) => {
      const face = swapped(p.face ?? "up");
      // a face placed by hand uses its own rectangle (given in the picture, worked here relative to the block)
      const placed = p.face ? own?.[p.face] : undefined;
      const r: [number, number, number, number] = placed ? [placed[0] - bx, placed[1] - by, placed[2], placed[3]] : (rects[face] as [number, number, number, number]);
      return p.v.map((i) => {
        const corner: Vec3 = [...unit.verts[i]!] as Vec3;
        for (const [bit, axis] of [[1, 0], [2, 1], [4, 2]] as const) if (mirror & bit) corner[axis] = 1 - corner[axis];
        const [u, v] = faceUV(face, corner);
        return [r[0] + u * r[2], r[1] + v * r[3]] as UV;
      });
    });
    return { size: [2 * d + 2 * w, d + h], polys };
  }

  if (shape === "cylinder" || shape === "cone" || shape === "sphere") {
    const n = segmentsOf(c);
    const [rx, rz] = [c.size[0] / 2, c.size[2] / 2];
    const cw = texels(around(rx, rz), s);
    const hh = texels(c.size[1], s);
    const unit = unitSolid(c);
    if (shape === "sphere") {
      const rings = Math.max(2, Math.round(n / 2));
      const sh = texels(Math.PI * Math.sqrt((c.size[1] ** 2 / 4 + (rx + rz) ** 2 / 4) / 2), s);
      const u = (i: number) => ((n - i) / n) * cw; // seen from outside, the angle runs right to left
      const v = (r: number) => (r / rings) * sh;
      const polys: UV[][] = [];
      for (let i = 0; i < n; i++) polys.push([[((n - i - 0.5) / n) * cw, 0], [u(i + 1), v(1)], [u(i), v(1)]]);
      for (let r = 1; r < rings - 1; r++) for (let i = 0; i < n; i++) polys.push([[u(i), v(r)], [u(i + 1), v(r)], [u(i + 1), v(r + 1)], [u(i), v(r + 1)]]);
      for (let i = 0; i < n; i++) polys.push([[((n - i - 0.5) / n) * cw, sh], [u(i), v(rings - 1)], [u(i + 1), v(rings - 1)]]);
      return { size: [cw, sh], polys };
    }
    const capW = texels(c.size[0], s);
    const capD = texels(c.size[2], s);
    const u = (i: number) => ((n - i) / n) * cw;
    const polys: UV[][] = [];
    for (let i = 0; i < n; i++) {
      polys.push(shape === "cylinder" ? [[u(i), hh], [u(i), 0], [u(i + 1), 0], [u(i + 1), hh]] : [[u(i), hh], [((n - i - 0.5) / n) * cw, 0], [u(i + 1), hh]]);
    }
    // the top cap is seen from above (v follows z), the bottom one from below (v runs the other way)
    const cap = (poly: number[], x0: number, below: boolean): UV[] => poly.map((i) => [x0 + unit.verts[i]![0] * capW, hh + (below ? 1 - unit.verts[i]![2] : unit.verts[i]![2]) * capD] as UV);
    if (shape === "cylinder") polys.push(cap(unit.polys[n]!.v, 0, false), cap(unit.polys[n + 1]!.v, capW, true));
    else polys.push(cap(unit.polys[n]!.v, 0, true));
    return { size: [Math.max(cw, shape === "cylinder" ? 2 * capW : capW), hh + capD], polys };
  }

  // a free mesh (2026-11-08): its polygons are sorted by the way they face (up, down, and the four sides), and each group is
  // laid flat as seen from that side, so polygons that touch on the model touch in the picture, the picture's rows run level
  // with the model, and a stripe painted down a car's bonnet is a straight line. A group is split where its polygons are not
  // joined, or where two of them would cover the same texels (a spoiler over the boot); each piece is an island, and the
  // islands are packed side by side, tallest first. (Until then every polygon was its own island, turned along its first edge:
  // the pixels slanted and no two neighbours lined up.)
  return meshIslands(solid, s, c.modifiers?.length ? undefined : c.seams, c.texture?.islands);
}

/// The way each group of a mesh is seen: the texel across (u) and down (v) for a point, seen from outside with up as up
/// (the same views as a box's faces).
const VIEWS: ((p: Vec3) => UV)[] = [
  (p) => [-p[2], -p[1]], // facing +x (east): seen from that side
  (p) => [p[2], -p[1]], // facing -x (west)
  (p) => [p[0], p[2]], // facing up: seen from above
  (p) => [p[0], -p[2]], // facing down: seen from below
  (p) => [p[0], -p[1]], // facing +z (south)
  (p) => [-p[0], -p[1]], // facing -z (north)
];

function viewOf(n: Vec3): number {
  const [x, y, z] = [Math.abs(n[0]), Math.abs(n[1]), Math.abs(n[2])];
  const axis = x >= y && x >= z ? 0 : y >= z ? 1 : 2;
  return axis * 2 + (n[axis]! >= 0 ? 0 : 1);
}

/// The texel cells whose centres lie inside a flat polygon (texel units, any position).
function cellsOf(pts: UV[]): string[] {
  const out: string[] = [];
  const minX = Math.floor(Math.min(...pts.map((q) => q[0]))), maxX = Math.ceil(Math.max(...pts.map((q) => q[0])));
  const minY = Math.floor(Math.min(...pts.map((q) => q[1]))), maxY = Math.ceil(Math.max(...pts.map((q) => q[1])));
  for (let y = minY; y < maxY; y++) for (let x = minX; x < maxX; x++) {
    const px = x + 0.5, py = y + 0.5;
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i]!, [xj, yj] = pts[j]!;
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
    if (inside) out.push(x + "," + y);
  }
  return out;
}

function meshIslands(solid: { verts: Vec3[]; polys: { v: number[] }[] }, s: number, seams?: [number, number][], placed?: { poly: number; at: [number, number] }[]): Unwrap {
  const seam = new Set((seams ?? []).map(([a, b]) => (a < b ? a + "," + b : b + "," + a)));
  const polys = solid.polys;
  const views = polys.map((p) => {
    const n = polyNormalOf(p.v.map((i) => solid.verts[i]!));
    return Math.hypot(...n) < 1e-12 ? -1 : viewOf(n);
  });
  const flat = polys.map((p, pi) => (views[pi]! < 0 ? p.v.map(() => [0, 0] as UV) : p.v.map((i) => VIEWS[views[pi]!]!(solid.verts[i]!).map((x) => x * s) as UV)));
  // polygons that share an edge, by the edge's two points
  const byEdge = new Map<string, number[]>();
  polys.forEach((p, pi) => p.v.forEach((a, k) => {
    const b = p.v[(k + 1) % p.v.length]!;
    const key = a < b ? a + "," + b : b + "," + a;
    byEdge.set(key, [...(byEdge.get(key) ?? []), pi]);
  }));
  const neighbours = polys.map((p) => {
    const out = new Set<number>();
    p.v.forEach((a, k) => {
      const b = p.v[(k + 1) % p.v.length]!;
      const ek = a < b ? a + "," + b : b + "," + a;
      if (!seam.has(ek)) for (const q of byEdge.get(ek) ?? []) out.add(q);
    });
    return out;
  });
  // the islands: grown from a polygon across shared edges, within one view, skipping a polygon that would cover texels the
  // island already has (it starts or joins another island later)
  const island = polys.map(() => -1);
  const islands: number[][] = [];
  for (let start = 0; start < polys.length; start++) {
    if (island[start] !== -1) continue;
    const id = islands.length;
    const members: number[] = [];
    const used = new Set<string>();
    const queue = [start];
    const tried = new Set<number>();
    while (queue.length) {
      const pi = queue.shift()!;
      if (island[pi] !== -1 || tried.has(pi)) continue;
      tried.add(pi);
      const cells = cellsOf(flat[pi]!);
      if (members.length && cells.some((c) => used.has(c))) continue;
      cells.forEach((c) => used.add(c));
      island[pi] = id;
      members.push(pi);
      for (const q of neighbours[pi]!) if (island[q] === -1 && views[q] === views[pi]) queue.push(q);
    }
    islands.push(members);
  }
  // each island's box, then shelves of islands, tallest first
  const boxes = islands.map((members) => {
    const pts = members.flatMap((pi) => flat[pi]!);
    const lo: UV = [Math.floor(Math.min(...pts.map((q) => q[0]))), Math.floor(Math.min(...pts.map((q) => q[1])))];
    const hi: UV = [Math.max(...pts.map((q) => q[0])), Math.max(...pts.map((q) => q[1]))];
    return { lo, w: Math.max(1, Math.ceil(hi[0] - lo[0] - 1e-9)), h: Math.max(1, Math.ceil(hi[1] - lo[1] - 1e-9)) };
  });
  const area = boxes.reduce((a, f) => a + (f.w + ISLAND_GAP) * (f.h + ISLAND_GAP), 0);
  const rowMax = Math.max(32, Math.ceil(Math.sqrt(area) * 1.3), ...boxes.map((f) => f.w));
  const order = boxes.map((_, i) => i).sort((a, b) => boxes[b]!.h - boxes[a]!.h || a - b);
  const placedAt: UV[] = [];
  let x = 0, y = 0, rowH = 0, width = 1;
  for (const i of order) {
    const f = boxes[i]!;
    if (x > 0 && x + f.w > rowMax) {
      x = 0;
      y += rowH + ISLAND_GAP;
      rowH = 0;
    }
    placedAt[i] = [x, y];
    x += f.w + ISLAND_GAP;
    rowH = Math.max(rowH, f.h);
    width = Math.max(width, x - ISLAND_GAP);
  }
  // islands the person moved by hand
  for (const o of placed ?? []) {
    const k = island[o.poly];
    if (k !== undefined && k >= 0) placedAt[k] = [Math.max(0, Math.round(o.at[0])), Math.max(0, Math.round(o.at[1]))];
  }
  width = Math.max(1, ...boxes.map((f, i) => placedAt[i]![0] + f.w));
  const height = Math.max(1, ...boxes.map((f, i) => placedAt[i]![1] + f.h));
  return {
    size: [width, height],
    islands: islands.map((members, k) => ({ poly: Math.min(...members), x: placedAt[k]![0], y: placedAt[k]![1], w: boxes[k]!.w, h: boxes[k]!.h })),
    polys: flat.map((pts, pi) => {
      const k = island[pi]!;
      const [ox, oy] = placedAt[k]!;
      const lo = boxes[k]!.lo;
      return pts.map((q) => [ox + q[0] - lo[0], oy + q[1] - lo[1]] as UV);
    }),
  };
}

function polyNormalOf(pts: Vec3[]): Vec3 {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return [nx, ny, nz];
}

/// Texel coordinates for every vertex `meshOf` emits for the shape, two numbers each, in the order it emits them
/// (polygon by polygon). Empty when the shape is not textured.
export function uvsOf(c: Cube): number[] {
  if (!c.texture || !hasVolume(c)) return [];
  const [ax, ay] = c.texture.at;
  return unwrap(c).polys.flatMap((p) => p.flatMap((q) => [ax + q[0], ay + q[1]]));
}

/// Where each textured shape's block goes: left to right in rows, tallest first, in a texture at least `size` wide
/// and tall, growing (up to the largest allowed) until everything fits. `fits` is false if even that is too small.
export function packBlocks(blocks: [number, number][], size: [number, number]): { at: [number, number][]; size: [number, number]; fits: boolean } {
  const order = blocks.map((_, i) => i).sort((a, b) => blocks[b]![1] - blocks[a]![1] || blocks[b]![0] - blocks[a]![0]);
  const attempt = (width: number) => {
    const at: [number, number][] = blocks.map(() => [0, 0]);
    let x = 0, y = 0, rowH = 0;
    for (const i of order) {
      const [w, h] = blocks[i]!;
      if (x + w > width && x > 0) {
        x = 0;
        y += rowH + GAP;
        rowH = 0;
      }
      at[i] = [x, y];
      x += w + GAP;
      rowH = Math.max(rowH, h);
    }
    return { at, height: y + rowH, widest: Math.max(0, ...blocks.map((b) => b[0])) };
  };
  const pow2 = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(8, n)));
  let width = size[0];
  for (;;) {
    const r = attempt(width);
    if (r.widest <= width && r.height <= MAX_TEXTURE) return { at: r.at, size: [width, Math.max(size[1], Math.min(MAX_TEXTURE, pow2(r.height)))], fits: true };
    if (width >= MAX_TEXTURE) return { at: r.at, size: [width, MAX_TEXTURE], fits: false };
    width = Math.min(MAX_TEXTURE, width * 2);
  }
}

/// Every textured shape of the model with a block placed by `packBlocks`; the texture grows if it must.
export function packModel(doc: ModelDoc): { doc: ModelDoc; fits: boolean } {
  const next: ModelDoc = JSON.parse(JSON.stringify(doc));
  const holders = walk(next).flatMap(({ part }) => part.cubes).filter((c) => c.texture);
  if (!holders.length) return { doc: next, fits: true };
  const placed = packBlocks(holders.map((c) => unwrap(c).size), next.texture?.size ?? [64, 64]);
  holders.forEach((c, i) => (c.texture!.at = placed.at[i]!));
  next.texture = { ...next.texture, size: placed.size };
  return { doc: next, fits: placed.fits };
}

/// Fills a triangle of texel coordinates with a colour (sampling at texel centres), clipped to the picture.
/// `grow`: texels the triangle is made larger by on every side (for padding).
function fillTriangle(r: Raster, a: UV, b: UV, c: UV, rgba: [number, number, number, number], grow = 0) {
  const g = Math.ceil(grow);
  const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])) - g);
  const maxX = Math.min(r.w - 1, Math.ceil(Math.max(a[0], b[0], c[0])) + g);
  const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])) - g);
  const maxY = Math.min(r.h - 1, Math.ceil(Math.max(a[1], b[1], c[1])) + g);
  const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (Math.abs(area) < 1e-9) return;
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const px = x + 0.5, py = y + 0.5;
    const w0 = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / area;
    const w1 = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area;
    const w2 = 1 - w0 - w1;
    if (grow > 0) {
      // distance outside each edge, in texels: the weight times the edge's height over it
      const len = (p: UV, q: UV) => Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
      const h0 = Math.abs(area) / len(b, c), h1 = Math.abs(area) / len(c, a), h2 = Math.abs(area) / len(a, b);
      if (w0 * h0 >= -grow && w1 * h1 >= -grow && w2 * h2 >= -grow) setPixel(r, x, y, rgba);
      continue;
    }
    const e = -1e-6;
    if (w0 >= e && w1 >= e && w2 >= e) setPixel(r, x, y, rgba);
  }
}

/// Paints the shape's colours into its block of the texture, so turning texturing on changes nothing you can see.
export function bakeColors(r: Raster, c: Cube, colourOf: (c: Cube, p: { color?: string }) => Rgba = (cube, p) => hexToRgba(polyColor(cube, p as never))) {
  if (!c.texture || !hasVolume(c)) return;
  const [ax, ay] = c.texture.at;
  const solid = solidOf(c);
  const un = unwrap(c);
  solid.polys.forEach((p, pi) => {
    const uv = un.polys[pi]!.map((q) => [ax + q[0], ay + q[1]] as UV);
    const rgba = colourOf(c, p);
    for (let k = 1; k + 1 < uv.length; k++) fillTriangle(r, uv[0]!, uv[k]!, uv[k + 1]!, rgba, 0.75);
  });
  // then exactly, over the padding: each polygon is first filled a little larger than it is, so a texel the GPU samples at the
  // very edge of a polygon (its centre just outside) has the polygon's colour and not the gap's
  solid.polys.forEach((p, pi) => {
    const uv = un.polys[pi]!.map((q) => [ax + q[0], ay + q[1]] as UV);
    const rgba = colourOf(c, p);
    for (let k = 1; k + 1 < uv.length; k++) fillTriangle(r, uv[0]!, uv[k]!, uv[k + 1]!, rgba);
  });
}

// ---- giving shapes texels --------------------------------------------------------------------------------------

export interface Block {
  x: number;
  y: number;
  w: number;
  h: number;
}

/// The block of texels a painted shape occupies.
export function blockOf(c: Cube): Block {
  const [w, h] = unwrap(c).size;
  return { x: c.texture?.at[0] ?? 0, y: c.texture?.at[1] ?? 0, w, h };
}

/// The first spot (top to bottom, left to right) where a `w` x `h` block fits among `taken`, with a texel's gap;
/// null when there is none inside a `size` picture.
export function freeSpot(taken: Block[], w: number, h: number, size: [number, number]): [number, number] | null {
  const [W, H] = size;
  if (w > W || h > H) return null;
  // summed-area table of the texels in use, so each candidate is one lookup
  const sum = new Int32Array((W + 1) * (H + 1));
  const used = new Uint8Array(W * H);
  for (const b of taken) {
    for (let y = Math.max(0, b.y); y < Math.min(H, b.y + b.h + GAP); y++) for (let x = Math.max(0, b.x); x < Math.min(W, b.x + b.w + GAP); x++) used[y * W + x] = 1;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) sum[(y + 1) * (W + 1) + x + 1] = used[y * W + x]! + sum[y * (W + 1) + x + 1]! + sum[(y + 1) * (W + 1) + x]! - sum[y * (W + 1) + x]!;
  const count = (x: number, y: number) => sum[(y + h) * (W + 1) + x + w]! - sum[y * (W + 1) + x + w]! - sum[(y + h) * (W + 1) + x]! + sum[y * (W + 1) + x]!;
  for (let y = 0; y + h <= H; y++) for (let x = 0; x + w <= W; x++) if (count(x, y) === 0) return [x, y];
  return null;
}

const grown = (r: Raster, w: number, h: number): Raster => {
  const out = newRaster(w, h);
  for (let y = 0; y < Math.min(h, r.h); y++) out.data.set(r.data.subarray(y * r.w * 4, (y * r.w + Math.min(r.w, w)) * 4), y * w * 4);
  return out;
};

/// The picture at another size, keeping its pixels in the top-left corner (cropping if smaller).
export function resizeTexture(doc: ModelDoc, picture: Raster, w: number, h: number): { doc: ModelDoc; picture: Raster } {
  const side = (n: number) => Math.min(MAX_TEXTURE, Math.max(MIN_TEXTURE, Math.round(n)));
  const [nw, nh] = [side(w), side(h)];
  const next: ModelDoc = JSON.parse(JSON.stringify(doc));
  next.texture = { ...next.texture, size: [nw, nh] };
  return { doc: next, picture: grown(picture, nw, nh) };
}

/// Turns on texturing for one shape: finds it a free block (growing the picture, top to bottom, if need be), paints its
/// current colours there so nothing changes on screen, and leaves its own colour as a white tint.
/// (`firstScale`: the texels per unit a shape painted for the first time gets.)
export function enableTexture(doc: ModelDoc, picture: Raster | null, parts: number[], index: number, firstScale = NEW_TEXEL_SCALE): { doc: ModelDoc; picture: Raster; fits: boolean } | null {
  let next: ModelDoc = JSON.parse(JSON.stringify(doc));
  const part = parts.reduce<{ children: ModelDoc["parts"]; part?: ModelDoc["parts"][number] }>((acc, i) => ({ children: acc.children[i]?.children ?? [], part: acc.children[i] }), { children: next.parts }).part;
  const cube = part?.cubes[index];
  if (!cube || !hasVolume(cube)) return null;
  next.texture ??= { size: [64, 64], smooth: true }; // (a model's first painted shape: smooth, detailed paint)
  let pic = picture && picture.w === next.texture.size[0] && picture.h === next.texture.size[1] ? picture : grown(picture ?? newRaster(1, 1), next.texture.size[0], next.texture.size[1]);
  pic = { w: pic.w, h: pic.h, data: new Uint8ClampedArray(pic.data) };
  const scale = cube.texture?.scale ?? firstScale;
  const [bw, bh] = unwrap({ ...cube, texture: { at: [0, 0], scale } }).size;
  const taken = walk(next).flatMap(({ part: p }) => p.cubes).filter((c) => c.texture && c !== cube).map(blockOf);
  let spot = freeSpot(taken, bw, bh, next.texture.size);
  let fits = true;
  while (!spot) {
    const [w, h] = next.texture.size;
    if (h >= MAX_TEXTURE && w >= MAX_TEXTURE) {
      fits = false;
      break;
    }
    // too wide for the picture: widen it; otherwise grow it downward, and widen only once it is as tall as allowed
    const grownSize: [number, number] = bw > w || h >= MAX_TEXTURE ? [Math.min(MAX_TEXTURE, w * 2), h] : [w, Math.min(MAX_TEXTURE, h * 2)];
    next.texture = { ...next.texture, size: grownSize };
    pic = grown(pic, grownSize[0], grownSize[1]);
    spot = freeSpot(taken, bw, bh, grownSize);
  }
  cube.texture = { at: spot ?? [0, 0], ...(scale !== 1 ? { scale } : {}) };
  bakeColors(pic, cube);
  cube.color = "#ffffff";
  delete cube.faces;
  for (const f of cube.polys ?? []) delete f.color;
  next = JSON.parse(JSON.stringify(next));
  return { doc: next, picture: pic, fits };
}

/// A picture for the model's texture with every painted shape's colours in its block.
export function bakeAll(doc: ModelDoc): Raster {
  const [w, h] = doc.texture?.size ?? [MIN_TEXTURE, MIN_TEXTURE];
  const r = newRaster(w, h);
  for (const { part } of walk(doc)) for (const c of part.cubes) bakeColors(r, c);
  return r;
}

/// Puts the mesh island that holds polygon `poly` at `at` (texels from the block's corner); null for `at` puts every island back where the unwrap placed it.
export function moveIsland(c: Cube, poly: number, at: [number, number] | null): Cube {
  if (!c.texture) return c;
  const rest = (c.texture.islands ?? []).filter((i) => i.poly !== poly);
  const islands = at ? [...rest, { poly, at: [Math.max(0, Math.round(at[0])), Math.max(0, Math.round(at[1]))] as [number, number] }] : rest;
  return { ...c, texture: { ...c.texture, islands: islands.length ? islands : undefined } };
}

/// The surface picture for a model: every painted shape's block holds its own roughness (green) and metal (blue) numbers, so nothing changes until it is painted.
export function bakeSurface(doc: ModelDoc): Raster {
  const [w, h] = doc.texture?.size ?? [MIN_TEXTURE, MIN_TEXTURE];
  const r = newRaster(w, h);
  for (let i = 0; i < r.data.length; i += 4) { r.data[i] = 255; r.data[i + 1] = 255; r.data[i + 3] = 255; }
  for (const { part } of walk(doc)) for (const c of part.cubes) bakeColors(r, c, (cube) => [255, Math.round(roughnessOf(cube) * 255), Math.round(metallicOf(cube) * 255), 255]);
  return r;
}

/// A channel of a surface picture as a grey picture to paint on, and a grey picture written back into a channel (green: roughness, blue: metal).
export type SurfaceChannel = "roughness" | "metal" | "bump";
export function channelToGrey(surface: Raster, channel: SurfaceChannel): Raster {
  const out = newRaster(surface.w, surface.h);
  const k = channel === "roughness" ? 1 : channel === "metal" ? 2 : 0;
  for (let i = 0; i < out.data.length; i += 4) {
    const v = surface.data[i + k]!;
    out.data[i] = out.data[i + 1] = out.data[i + 2] = v;
    out.data[i + 3] = 255;
  }
  return out;
}
export function greyToChannel(surface: Raster, grey: Raster, channel: SurfaceChannel): Raster {
  const out: Raster = { w: surface.w, h: surface.h, data: new Uint8ClampedArray(surface.data) };
  const k = channel === "roughness" ? 1 : channel === "metal" ? 2 : 0;
  for (let i = 0; i < out.data.length && i < grey.data.length; i += 4) out.data[i + k] = grey.data[i]!;
  return out;
}

/// The picture cropped or padded (top-left kept) to the model's texture size.
export function fitPicture(doc: ModelDoc, picture: Raster): Raster {
  const [w, h] = doc.texture?.size ?? [picture.w, picture.h];
  return picture.w === w && picture.h === h ? picture : grown(picture, w, h);
}

/// The rectangle each face of a box, wedge or pyramid takes in the picture, in texels: the one placed by hand if there is one,
/// else its place in the automatic layout. Null for other shapes (which unwrap as strips and patches).
export function faceRects(c: Cube): Partial<Record<Face, [number, number, number, number]>> | null {
  const shape = c.shape ?? "box";
  if (!c.texture || !["box", "wedge", "pyramid"].includes(shape)) return null;
  const s = c.texture.scale ?? 1;
  const [w, h, d] = [texels(c.size[0], s), texels(c.size[1], s), texels(c.size[2], s)];
  const auto = boxRects(w, h, d);
  const mirror = c.texture.mirror ?? 0;
  const bitOf: Record<string, number> = { east: 1, west: 1, up: 2, down: 2, south: 4, north: 4 };
  const swap: Record<string, string> = { east: "west", west: "east", up: "down", down: "up", south: "north", north: "south" };
  const out: Partial<Record<Face, [number, number, number, number]>> = {};
  for (const p of unitSolid(c).polys) {
    const f = p.face;
    if (!f || out[f]) continue;
    const placed = c.texture.faces?.[f];
    if (placed) out[f] = [...placed];
    else {
      const a = auto[mirror & bitOf[f]! ? swap[f]! : f]!;
      out[f] = [c.texture.at[0] + a[0], c.texture.at[1] + a[1], a[2], a[3]];
    }
  }
  return out;
}

/// A rectangle as the area it covers (`[left, top, width, height]`, sizes positive), whichever way it runs.
export const normRect = (r: [number, number, number, number]): [number, number, number, number] => [Math.min(r[0], r[0] + r[2]), Math.min(r[1], r[1] + r[3]), Math.abs(r[2]), Math.abs(r[3])];

/// The same area at a new top-left corner, running the same ways as `like` (flipped sides stay flipped).
export const rectAt = (like: [number, number, number, number], left: number, top: number): [number, number, number, number] => {
  const [, , w, h] = normRect(like);
  return [like[2] < 0 ? left + w : left, like[3] < 0 ? top + h : top, like[2] < 0 ? -w : w, like[3] < 0 ? -h : h];
};

/// The rectangle turned over left to right (`across` true) or top to bottom.
export const flippedRect = (r: [number, number, number, number], across: boolean): [number, number, number, number] =>
  across ? [r[0] + r[2], r[1], -r[2], r[3]] : [r[0], r[1] + r[3], r[2], -r[3]];
