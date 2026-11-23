// Flat art painted on a 3D maker's round surfaces: a face on a head, a pattern on a shirt. A decal is a thin skin laid over the
// front of a surface (each point found by a ray from the front, then lifted a few millimetres along the surface's normal, so it
// hugs the curve with no gap and no flicker), unwrapped by the model document's own unwrap and painted in the model's texture
// through that unwrap. What is not painted is see-through (the game does not
// draw texels with alpha under 0.3), so only the art shows. The art is drawn in metres in the decal's own front view, as signed
// distances, so its edges are smooth at any texel size.

import { Mesh3, type V3 } from "./kit3d";
import { hex } from "./paint";
import { packBlocks, unwrap } from "../../src/lib/model-uv";
import { newRaster, type Raster } from "../../src/lib/pixels";
import type { Cube } from "../../src/lib/model-doc";

const U = 16; // model units in a metre

// ---------------------------------------------------------------------------------------------------------------------------------
// rays from the front

interface Tri { a: V3; b: V3; c: V3; n: V3; x0: number; x1: number; y0: number; y1: number }

/// The triangles of meshes (each polygon fanned), with their normals and boxes in x and y.
export function trianglesOf(meshes: Mesh3[]): Tri[] {
  const out: Tri[] = [];
  for (const m of meshes) for (const p of m.polys) {
    for (let k = 1; k + 1 < p.v.length; k++) {
      const a = m.verts[p.v[0]!]!, b = m.verts[p.v[k]!]!, c = m.verts[p.v[k + 1]!]!;
      const e1: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2: V3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n: V3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const l = Math.hypot(n[0], n[1], n[2]);
      if (l < 1e-12) continue;
      out.push({ a, b, c, n: [n[0] / l, n[1] / l, n[2] / l], x0: Math.min(a[0], b[0], c[0]), x1: Math.max(a[0], b[0], c[0]), y0: Math.min(a[1], b[1], c[1]), y1: Math.max(a[1], b[1], c[1]) });
    }
  }
  return out;
}

/// Where a ray from the front (+z, looking towards -z) at x, y first meets the triangles, and the surface's normal there (facing
/// the ray). Null when it meets nothing.
export function frontHit(tris: Tri[], x: number, y: number): { p: V3; n: V3 } | null {
  let best: { p: V3; n: V3 } | null = null;
  for (const t of tris) {
    if (x < t.x0 - 1e-9 || x > t.x1 + 1e-9 || y < t.y0 - 1e-9 || y > t.y1 + 1e-9) continue;
    // barycentric in the xy plane
    const d = (t.b[1] - t.c[1]) * (t.a[0] - t.c[0]) + (t.c[0] - t.b[0]) * (t.a[1] - t.c[1]);
    if (Math.abs(d) < 1e-14) continue;
    const l1 = ((t.b[1] - t.c[1]) * (x - t.c[0]) + (t.c[0] - t.b[0]) * (y - t.c[1])) / d;
    const l2 = ((t.c[1] - t.a[1]) * (x - t.c[0]) + (t.a[0] - t.c[0]) * (y - t.c[1])) / d;
    const l3 = 1 - l1 - l2;
    if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
    const z = l1 * t.a[2] + l2 * t.b[2] + l3 * t.c[2];
    if (!best || z > best.p[2]) best = { p: [x, y, z], n: t.n[2] >= 0 ? t.n : [-t.n[0], -t.n[1], -t.n[2]] };
  }
  return best;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// the decal's skin

export interface Decal {
  mesh: Mesh3;
  /// For each point of the mesh, where it is in the art (metres, the front view: x to the model's left (+x), y up).
  design: [number, number][];
}

/// A decal over the surfaces `tris` in the box x0..x1, y0..y1 (metres, in the space of the part they are in), as a grid of `cell`
/// metres lifted `lift` metres off the surface. Only the cells where `wanted(x, y, r)` says the art reaches (r: the cell's half
/// size, as a margin) are kept, and only cells that are not seen at a grazing slant from the front. Null when nothing is left.
export function decalOver(tris: Tri[], box: [number, number, number, number], cell: number, lift: number, wanted: (x: number, y: number, r: number) => boolean): Decal | null {
  const [x0, x1, y0, y1] = box;
  const nx = Math.max(1, Math.ceil((x1 - x0) / cell)), ny = Math.max(1, Math.ceil((y1 - y0) / cell));
  const sx = (x1 - x0) / nx, sy = (y1 - y0) / ny;
  const hits: ({ p: V3; n: V3 } | null)[][] = [];
  for (let j = 0; j <= ny; j++) {
    const row: ({ p: V3; n: V3 } | null)[] = [];
    for (let i = 0; i <= nx; i++) row.push(frontHit(tris, x0 + i * sx, y0 + j * sy));
    hits.push(row);
  }
  // each grid point's own normal: the average of the facets met round it (smoother than one facet's)
  const normalAt = (i: number, j: number): V3 => {
    const s: V3 = [0, 0, 0];
    for (const [di, dj] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const h = hits[j + dj]?.[i + di];
      if (h) for (let k = 0; k < 3; k++) s[k] = s[k]! + h.n[k]!;
    }
    const l = Math.hypot(s[0], s[1], s[2]) || 1;
    return [s[0] / l, s[1] / l, s[2] / l];
  };
  const mesh = new Mesh3("#ffffff", { bend: false });
  const design: [number, number][] = [];
  const index = new Map<string, number>();
  const point = (i: number, j: number): number => {
    const key = `${i},${j}`;
    const had = index.get(key);
    if (had !== undefined) return had;
    const h = hits[j]![i]!, n = normalAt(i, j);
    const v = mesh.v(h.p[0] + n[0] * lift, h.p[1] + n[1] * lift, h.p[2] + n[2] * lift);
    design[v] = [h.p[0], h.p[1]];
    index.set(key, v);
    return v;
  };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = [hits[j]![i], hits[j]![i + 1], hits[j + 1]![i + 1], hits[j + 1]![i]];
    if (c.some((h) => !h)) continue;
    const cx = x0 + (i + 0.5) * sx, cy = y0 + (j + 0.5) * sy;
    if (!wanted(cx, cy, Math.max(sx, sy))) continue;
    // not across a step (a ray that met the snout beside one that met the cheek behind it: the surface turns too sharply between
    // its corners), nor quite edge-on. A cell that faces more to a side or down than forward is unwrapped from that side: it is
    // painted through its own unwrap, so the art still lands where it should (stretched as the front view sees it).
    const p = c.map((h) => h!.p);
    const e1: V3 = [p[2]![0] - p[0]![0], p[2]![1] - p[0]![1], p[2]![2] - p[0]![2]], e2: V3 = [p[3]![0] - p[1]![0], p[3]![1] - p[1]![1], p[3]![2] - p[1]![2]];
    const n: V3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    if (!(n[2] > Math.hypot(n[0], n[1], n[2]) * 0.04)) continue;
    const ns = c.map((h) => h!.n);
    let turn = 1;
    for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) turn = Math.min(turn, ns[a]![0] * ns[b]![0] + ns[a]![1] * ns[b]![1] + ns[a]![2] * ns[b]![2]);
    if (turn < 0.5) continue;
    const zs = p.map((q) => q[2]);
    const v = [point(i, j), point(i + 1, j), point(i + 1, j + 1), point(i, j + 1)];
    mesh.face(v, undefined, [cx, cy, Math.min(...zs) - 1], true);
  }
  return mesh.polys.length ? { mesh, design } : null;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// the art: shapes as signed distances (metres; below 0 is inside)

export type Rgb = [number, number, number];
/// A layer of art: its colour and its distance at a point.
export type Ink = { color: Rgb; d: (x: number, y: number) => number };
export const rgbOf = (c: string): Rgb => { const h = hex(c); return [h[0], h[1], h[2]]; };

export const sd = {
  /// An ellipse about cx, cy with half-sizes a, b, turned `turn` radians (an approximation that is exact on the axes: enough for edges).
  ellipse: (cx: number, cy: number, a: number, b: number, turn = 0) => (x: number, y: number) => {
    const c = Math.cos(turn), s = Math.sin(turn);
    const dx = (x - cx) * c + (y - cy) * s, dy = -(x - cx) * s + (y - cy) * c;
    const k = Math.hypot(dx / a, dy / b);
    // (first order: the level of k, divided by how fast k grows there)
    const g = Math.hypot(dx / (a * a), dy / (b * b)) / Math.max(k, 1e-9);
    return k < 1e-6 ? -Math.min(a, b) : (k - 1) / Math.max(g, 1e-9);
  },
  circle: (cx: number, cy: number, r: number) => (x: number, y: number) => Math.hypot(x - cx, y - cy) - r,
  /// A stroke along points (a polyline), `r0` thick (half) at the start to `r1` at the end: rounded ends.
  stroke: (pts: [number, number][], r0: number, r1 = r0) => {
    const lens: number[] = [0];
    for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]));
    const total = lens[lens.length - 1]! || 1;
    return (x: number, y: number) => {
      let best = Infinity;
      for (let i = 1; i < pts.length; i++) {
        const [ax, ay] = pts[i - 1]!, [bx, by] = pts[i]!;
        const vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy || 1e-12;
        const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / l2));
        const along = (lens[i - 1]! + t * Math.sqrt(l2)) / total;
        const d = Math.hypot(x - ax - vx * t, y - ay - vy * t) - (r0 + (r1 - r0) * along);
        if (d < best) best = d;
      }
      return best;
    };
  },
  /// A filled shape bounded by points (in order).
  shape: (pts: [number, number][]) => (x: number, y: number) => {
    let inside = false, best = Infinity;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i]!, [xj, yj] = pts[j]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      const vx = xi - xj, vy = yi - yj, l2 = vx * vx + vy * vy || 1e-12;
      const t = Math.max(0, Math.min(1, ((x - xj) * vx + (y - yj) * vy) / l2));
      best = Math.min(best, Math.hypot(x - xj - vx * t, y - yj - vy * t));
    }
    return inside ? -best : best;
  },
  union: (...ds: ((x: number, y: number) => number)[]) => (x: number, y: number) => Math.min(...ds.map((d) => d(x, y))),
  /// a minus b
  minus: (a: (x: number, y: number) => number, b: (x: number, y: number) => number) => (x: number, y: number) => Math.max(a(x, y), -b(x, y)),
  both: (a: (x: number, y: number) => number, b: (x: number, y: number) => number) => (x: number, y: number) => Math.max(a(x, y), b(x, y)),
  /// a curve through three points (a quadratic Bezier from a to c pulled towards b), as points for `stroke` or `shape`
  curve: (a: [number, number], b: [number, number], c: [number, number], n = 14): [number, number][] => {
    const out: [number, number][] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      out.push([u * u * a[0] + 2 * u * t * b[0] + t * t * c[0], u * u * a[1] + 2 * u * t * b[1] + t * t * c[1]]);
    }
    return out;
  },
};

/// The colour and cover of a stack of inks at a point (later ones on top), for a texel `px` metres across.
/// Where nothing is painted the colour is the nearest ink's (with no cover), so that the filter blends an edge towards its own colour.
export function inkAt(inks: Ink[], x: number, y: number, px: number): [number, number, number, number] {
  let r = 0, g = 0, b = 0, a = 0;
  let near = Infinity, nearC: Rgb | undefined;
  for (const ink of inks) {
    const d = ink.d(x, y);
    if (d < near) { near = d; nearC = ink.color; }
    const cover = Math.max(0, Math.min(1, 0.5 - d / px));
    if (cover <= 0) continue;
    // straight alpha "over"
    const na = cover + a * (1 - cover);
    r = (ink.color[0] * cover + r * a * (1 - cover)) / na;
    g = (ink.color[1] * cover + g * a * (1 - cover)) / na;
    b = (ink.color[2] * cover + b * a * (1 - cover)) / na;
    a = na;
  }
  if (a <= 0 && nearC) return [nearC[0], nearC[1], nearC[2], 0];
  return [r, g, b, a];
}

/// Whether any of the inks reaches within `margin` of x, y.
export const reaches = (inks: Ink[], x: number, y: number, margin: number) => inks.some((i) => i.d(x, y) < margin);

// ---------------------------------------------------------------------------------------------------------------------------------
// painting through the unwrap

export interface Painted {
  /// the shape's name in the model document (the decal mesh's `name`)
  name: string;
  design: [number, number][];
  inks: Ink[];
  /// what the see-through texels hold (the colour the linear filter blends towards at an edge)
  bleed: Rgb;
}

/// Places every painted shape of the model in one texture (each its own block, as the editor's Pack would) and paints it.
/// `cubes` are the document's shapes by name. Returns the texture's size and the picture.
export function paintTexture(cubes: Map<string, Cube>, painted: Painted[]): { size: [number, number]; picture: Raster } {
  const list = painted.filter((p) => cubes.has(p.name));
  const unwraps = list.map((p) => unwrap(cubes.get(p.name)!));
  // (the smallest picture of a few widths)
  // (each block on a grid of 16 texels with at least 16 see-through texels between two blocks' paint: the game's smaller copies of the
  // picture average 2, 4, 8 and 16 texels at a time, and without the gutter a dark brow was averaged with the white cheeks in the
  // block beside it and showed a pale rim at a distance; see-through texels count for nothing in those averages)
  const CELL = 16, PAD = 8, GAP = 1;
  const up = (n: number) => Math.ceil((n + 2 * PAD + GAP) / CELL) * CELL - GAP;
  const sizes = unwraps.map((u) => [up(u.size[0]), up(u.size[1])] as [number, number]);
  const packed = [128, 256, 512, 1024].map((w) => packBlocks(sizes, [w, 8])).filter((q) => q.fits).sort((a, b) => a.size[0] * a.size[1] - b.size[0] * b.size[1] || a.size[0] - b.size[0])[0] ?? { fits: false, at: [], size: [0, 0] as [number, number] };
  if (!packed.fits) throw new Error("the painted face and clothes do not fit in a 1024 x 1024 texture");
  const [w, h] = packed.size;
  const picture = newRaster(w, h);
  list.forEach((p, k) => {
    const cube = cubes.get(p.name)!;
    const at: [number, number] = [packed.at[k]![0] + PAD, packed.at[k]![1] + PAD];
    cube.texture = { ...cube.texture!, at };
    paintBlock(picture, cube, unwraps[k]!, at, p);
  });
  dilate(picture, 16);
  return { size: [w, h], picture };
}

/// Edge padding: every see-through texel takes the colour of the painted texels next to it (and those beyond them the colour of
/// those, `passes` texels out), keeping its own zero cover. A filter that blends texels without weighing them by their cover (the
/// GPU's, between two texels and between two sizes of the picture) then blends an edge with its own colour, never with whatever
/// colour a see-through texel happened to hold (black where nothing was painted). Texels a painted shape already coloured on
/// purpose (the colour of the ink nearest them) keep it.
export function dilate(r: Raster, passes: number): void {
  const { w, h, data } = r;
  const known = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (data[i * 4 + 3]! > 0 || data[i * 4]! + data[i * 4 + 1]! + data[i * 4 + 2]! > 0) known[i] = 1;
  // (first, a see-through texel right beside paint takes that paint's colour, whatever ink it was nearest)
  const touch: [number, number, number, number][] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (data[i * 4 + 3]! > 0) continue;
    let rr = 0, gg = 0, bb = 0, n = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const X = x + dx, Y = y + dy;
      if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
      const j = (Y * w + X) * 4;
      if (data[j + 3]! < 128) continue;
      rr += data[j]!; gg += data[j + 1]!; bb += data[j + 2]!; n++;
    }
    if (n) touch.push([i, rr / n, gg / n, bb / n]);
  }
  for (const [i, rr, gg, bb] of touch) { data[i * 4] = Math.round(rr); data[i * 4 + 1] = Math.round(gg); data[i * 4 + 2] = Math.round(bb); known[i] = 1; }
  for (let pass = 0; pass < passes; pass++) {
    const add: [number, number, number, number][] = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (known[i]) continue;
      let rr = 0, gg = 0, bb = 0, n = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const X = x + dx, Y = y + dy;
        if (X < 0 || Y < 0 || X >= w || Y >= h || !known[Y * w + X]) continue;
        const j = (Y * w + X) * 4;
        rr += data[j]!; gg += data[j + 1]!; bb += data[j + 2]!; n++;
      }
      if (n) add.push([i, rr / n, gg / n, bb / n]);
    }
    if (!add.length) break;
    for (const [i, rr, gg, bb] of add) { data[i * 4] = Math.round(rr); data[i * 4 + 1] = Math.round(gg); data[i * 4 + 2] = Math.round(bb); known[i] = 1; }
  }
}

function paintBlock(r: Raster, cube: Cube, uw: ReturnType<typeof unwrap>, at: [number, number], p: Painted) {
  const s = cube.texture?.scale ?? 1;
  const px = 1 / (U * s); // metres a texel covers
  const [bw, bh] = uw.size;
  const done = new Uint8Array(bw * bh);
  const polys = cube.polys ?? [];
  polys.forEach((poly, pi) => {
    const uv = uw.polys[pi]!;
    for (let k = 1; k + 1 < poly.v.length; k++) {
      const ids = [0, k, k + 1];
      const T = ids.map((i) => uv[i]!), D = ids.map((i) => p.design[poly.v[i]!]!);
      const det = (T[1]![1] - T[2]![1]) * (T[0]![0] - T[2]![0]) + (T[2]![0] - T[1]![0]) * (T[0]![1] - T[2]![1]);
      if (Math.abs(det) < 1e-12) continue;
      const x0 = Math.max(0, Math.floor(Math.min(T[0]![0], T[1]![0], T[2]![0]) - 1)), x1 = Math.min(bw - 1, Math.ceil(Math.max(T[0]![0], T[1]![0], T[2]![0]) + 1));
      const y0 = Math.max(0, Math.floor(Math.min(T[0]![1], T[1]![1], T[2]![1]) - 1)), y1 = Math.min(bh - 1, Math.ceil(Math.max(T[0]![1], T[1]![1], T[2]![1]) + 1));
      for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
        const u = tx + 0.5, v = ty + 0.5;
        const l1 = ((T[1]![1] - T[2]![1]) * (u - T[2]![0]) + (T[2]![0] - T[1]![0]) * (v - T[2]![1])) / det;
        const l2 = ((T[2]![1] - T[0]![1]) * (u - T[2]![0]) + (T[0]![0] - T[2]![0]) * (v - T[2]![1])) / det;
        const l3 = 1 - l1 - l2;
        // inside the triangle, or within a texel and a half of it (padding, so the filter never reads an unpainted texel)
        const inside = l1 >= -1e-6 && l2 >= -1e-6 && l3 >= -1e-6;
        const cell = ty * bw + tx;
        if (!inside && done[cell] === 2) continue;
        const slack = 1.5 / Math.max(1, Math.sqrt(Math.abs(det)));
        if (!inside && (l1 < -slack || l2 < -slack || l3 < -slack)) continue;
        const x = l1 * D[0]![0] + l2 * D[1]![0] + l3 * D[2]![0];
        const y = l1 * D[0]![1] + l2 * D[1]![1] + l3 * D[2]![1];
        const c = inkAt(p.inks, x, y, px);
        const i = ((at[1] + ty) * r.w + at[0] + tx) * 4;
        const a = c[3];
        const bare = a <= 0 && !p.inks.length;
        r.data[i] = Math.round(bare ? p.bleed[0] : c[0]);
        r.data[i + 1] = Math.round(bare ? p.bleed[1] : c[1]);
        r.data[i + 2] = Math.round(bare ? p.bleed[2] : c[2]);
        r.data[i + 3] = Math.round(a * 255);
        done[cell] = inside ? 2 : 1;
      }
    }
  });
}
