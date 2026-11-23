// What the 3D makers build with: a free mesh under construction, in metres, made of flat faces with a colour each.
// Everything they make is written through model_write as an ordinary model document (free meshes, parts, clips), so it
// opens in the model editor and can be changed afterwards. One style for all of them: few, flat faces; each face a
// slightly different tone of its material, lighter towards the top; chunky proportions; no textures.

import { hex, mix, shade, toHex, type Rgba } from "./paint";
import type { Palette } from "./palettes";

export type V3 = [number, number, number];
export type Args = Record<string, any>;
export type Rand = () => number;

/// Model units in a metre at the scale the makers write (0.0625).
export const U = 16;

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/// A colour a little lighter or darker: `by` is in shades of a ramp (1 is one step lighter).
export const tone = (c: string, by: number): string => toHex(shade(hex(c), by));
export const blend = (a: string, b: string, t: number): string => toHex(mix(hex(a), hex(b), t));
export const rgb = (c: Rgba): string => toHex(c);

/// The colours of a palette the 3D makers use, as "#rrggbb" (the middle shade of each material).
export function colours(p: Palette): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, ramp] of Object.entries(p.mat)) out[name] = toHex(ramp[2]);
  out.outline = toHex(p.outline);
  return out;
}

export interface Poly {
  v: number[];
  color?: string;
  smooth?: boolean;
}

export interface MeshOpts {
  emissive?: number;
  metallic?: number;
  roughness?: number;
  /// Whether model_write's `bend` skins it (a limb) or leaves it rigid.
  bend?: boolean;
  name?: string;
  /// Painted with the model's texture at this many texels a model unit (a decal: see decal3d.ts); its place in the picture is set
  /// when the texture is packed.
  texture?: number;
  /// How the game paints the surface ("foliage", "canopy", "ground", "water": model-doc.ts PAINT_KINDS; docs/project-format.md,
  /// "Painted surfaces").
  paint?: string;
}

export class Mesh3 {
  verts: V3[] = [];
  polys: Poly[] = [];
  constructor(public color = "#888888", public opts: MeshOpts = {}) {}

  v(x: number, y: number, z: number): number {
    this.verts.push([x, y, z]);
    return this.verts.length - 1;
  }

  /// A face, its points put in the order that makes it face away from `from` (a point inside the solid).
  face(v: number[], color: string | undefined, from: V3, smooth = false): this {
    const n: V3 = [0, 0, 0], mid: V3 = [0, 0, 0];
    for (let i = 0; i < v.length; i++) {
      const a = this.verts[v[i]!]!, b = this.verts[v[(i + 1) % v.length]!]!;
      n[0] += (a[1] - b[1]) * (a[2] + b[2]);
      n[1] += (a[2] - b[2]) * (a[0] + b[0]);
      n[2] += (a[0] - b[0]) * (a[1] + b[1]);
      for (let k = 0; k < 3; k++) mid[k]! += a[k]! / v.length;
    }
    const out = n[0] * (mid[0] - from[0]) + n[1] * (mid[1] - from[1]) + n[2] * (mid[2] - from[2]);
    const p: Poly = { v: out < 0 ? [...v].reverse() : v };
    if (color && color !== this.color) p.color = color;
    if (smooth) p.smooth = true;
    this.polys.push(p);
    return this;
  }

  /// A box by its middle and size, optionally narrower at the top (`taper`: one factor, or [x, z]) and turned (degrees,
  /// about x, then z, then y, about its own middle). The top is a shade lighter and the sides away from the light darker.
  box(c: V3, size: V3, color: string, o: { ry?: number; rx?: number; rz?: number; taper?: number | [number, number]; flat?: boolean } = {}): this {
    const [w, h, d] = size;
    const rad = (v = 0) => (v * Math.PI) / 180;
    const [a, b, g] = [rad(o.ry), rad(o.rz), rad(o.rx)];
    const [tx, tz] = Array.isArray(o.taper) ? o.taper : [o.taper ?? 1, o.taper ?? 1];
    const idx: number[] = [];
    for (const sy of [-1, 1]) for (const sz of [-1, 1]) for (const sx of [-1, 1]) {
      let x = (sx * w * (sy > 0 ? tx : 1)) / 2, y = (sy * h) / 2, z = (sz * d * (sy > 0 ? tz : 1)) / 2;
      [y, z] = [y * Math.cos(g) - z * Math.sin(g), y * Math.sin(g) + z * Math.cos(g)];
      [x, y] = [x * Math.cos(b) - y * Math.sin(b), x * Math.sin(b) + y * Math.cos(b)];
      [x, z] = [x * Math.cos(a) + z * Math.sin(a), -x * Math.sin(a) + z * Math.cos(a)];
      idx.push(this.v(c[0] + x, c[1] + y, c[2] + z));
    }
    const p = (sx: number, sy: number, sz: number) => idx[(sy > 0 ? 4 : 0) + (sz > 0 ? 2 : 0) + (sx > 0 ? 1 : 0)]!;
    const k = o.flat ? 0 : 1;
    const top = tone(color, 0.55 * k), dark = tone(color, -0.6 * k), dim = tone(color, -0.28 * k);
    this.face([p(-1, 1, -1), p(-1, 1, 1), p(1, 1, 1), p(1, 1, -1)], top, c);
    this.face([p(-1, -1, -1), p(1, -1, -1), p(1, -1, 1), p(-1, -1, 1)], dark, c);
    this.face([p(1, -1, -1), p(1, 1, -1), p(1, 1, 1), p(1, -1, 1)], dim, c);
    this.face([p(-1, -1, -1), p(-1, -1, 1), p(-1, 1, 1), p(-1, 1, -1)], color, c);
    this.face([p(-1, -1, 1), p(1, -1, 1), p(1, 1, 1), p(-1, 1, 1)], color, c);
    this.face([p(-1, -1, -1), p(-1, 1, -1), p(1, 1, -1), p(1, -1, -1)], dark, c);
    return this;
  }

  /// Rings stacked along y about `at`: each { y, rx, rz (rx when left out), cx, cz (its own middle, off the axis) }, joined by
  /// four-sided faces and closed at both ends (a ring of radius 0 is a point). `color` may be a function of (ring, side).
  /// `jitter` moves every point in or out by that share of its radius (needs `rand`).
  rings(
    rings: { y: number; rx: number; rz?: number; cx?: number; cz?: number }[],
    seg: number,
    color: string | ((ring: number, side: number) => string),
    o: { at?: V3; smooth?: boolean; jitter?: number; rand?: Rand; turn?: number; caps?: boolean } = {},
  ): this {
    const at = o.at ?? [0, 0, 0];
    const col = typeof color === "function" ? color : () => color;
    const rows: number[][] = [];
    const mids: V3[] = [];
    rings.forEach((r, i) => {
      const cx = at[0] + (r.cx ?? 0), cz = at[2] + (r.cz ?? 0), y = at[1] + r.y;
      mids.push([cx, y, cz]);
      if (r.rx < 1e-6) {
        rows.push([this.v(cx, y, cz)]);
        return;
      }
      const row: number[] = [];
      for (let j = 0; j < seg; j++) {
        const a = ((j + (o.turn ?? 0) + (i % 2 ? 0 : 0)) / seg) * Math.PI * 2;
        const k = o.jitter && o.rand ? 1 + (o.rand() - 0.5) * 2 * o.jitter : 1;
        const dy = o.jitter && o.rand ? (o.rand() - 0.5) * o.jitter * 0.6 * r.rx : 0;
        row.push(this.v(cx + Math.cos(a) * r.rx * k, y + dy, cz + Math.sin(a) * (r.rz ?? r.rx) * k));
      }
      rows.push(row);
    });
    for (let i = 0; i + 1 < rows.length; i++) {
      const lo = rows[i]!, hi = rows[i + 1]!;
      if (lo.length === 1 && hi.length === 1) continue;
      const inside: V3 = [(mids[i]![0] + mids[i + 1]![0]) / 2, (mids[i]![1] + mids[i + 1]![1]) / 2, (mids[i]![2] + mids[i + 1]![2]) / 2];
      for (let j = 0; j < seg; j++) {
        const j2 = (j + 1) % seg;
        const q = lo.length === 1 ? [lo[0]!, hi[j]!, hi[j2]!] : hi.length === 1 ? [lo[j]!, lo[j2]!, hi[0]!] : [lo[j]!, hi[j]!, hi[j2]!, lo[j2]!];
        this.face(q, col(i, j), inside, o.smooth);
      }
    }
    if (o.caps !== false) {
      const first = rows[0]!, last = rows[rows.length - 1]!;
      const n = rows.length;
      if (first.length > 1) this.face([...first], col(0, 0), mids[Math.min(1, n - 1)]!);
      if (last.length > 1) this.face([...last], col(n - 1, 0), mids[Math.max(0, n - 2)]!);
    }
    return this;
  }

  /// A lumpy ball of flat faces: a rock, a tree's crown, a bush. Lighter towards the top, every face a little different.
  blob(c: V3, r: V3, color: string, rand: Rand, o: { seg?: number; rows?: number; jitter?: number; tones?: number; flatBottom?: number } = {}): this {
    const rows = o.rows ?? 4, seg = o.seg ?? 7;
    const rings: { y: number; rx: number; rz: number }[] = [];
    for (let i = 0; i <= rows; i++) {
      const t = -Math.PI / 2 + (Math.PI * (i + 0.35)) / (rows + 0.7);
      const y = Math.sin(t) * r[1];
      rings.push({ y: o.flatBottom !== undefined ? Math.max(y, -r[1] * o.flatBottom) : y, rx: Math.cos(t) * r[0], rz: Math.cos(t) * r[2] });
    }
    const tones = o.tones ?? 0.5;
    return this.rings(rings, seg, (i) => tone(color, -0.9 + (i / rows) * 1.7 + (rand() - 0.5) * tones), { jitter: o.jitter ?? 0.16, rand, at: c, turn: rand() });
  }

  /// A cone or a tapering trunk: `r0` wide at y0, `r1` at y1 (0 is a point), with `seg` sides.
  taper(at: V3, y0: number, y1: number, r0: number, r1: number, seg: number, color: string, o: { smooth?: boolean; lean?: [number, number]; shades?: boolean } = {}): this {
    const col = o.shades === false ? color : (_: number, j: number) => tone(color, Math.cos(((j + 0.5) / seg) * Math.PI * 2 + 0.9) * 0.45);
    return this.rings([{ y: y0, rx: r0 }, { y: y1, rx: r1, cx: o.lean?.[0] ?? 0, cz: o.lean?.[1] ?? 0 }], seg, col, { at, smooth: o.smooth });
  }

  /// A round limb along points (a branch, a rail, an arm): a ring of `seg` points round each, `radii` one per point (or one
  /// number). `color` may be a function of (stretch, side); `ends` colours the two flat ends.
  tube(path: V3[], radii: number | number[], seg: number, color: string | ((i: number, j: number) => string), o: { smooth?: boolean; ends?: string; squash?: number } = {}): this {
    const col = typeof color === "function" ? color : () => color;
    const rad = (i: number) => (Array.isArray(radii) ? radii[i]! : radii);
    const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const norm = (a: V3): V3 => {
      const l = Math.hypot(a[0], a[1], a[2]) || 1;
      return [a[0] / l, a[1] / l, a[2] / l];
    };
    const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    let u: V3 = [1, 0, 0];
    const rows: number[][] = [];
    path.forEach((p, i) => {
      const t = norm(sub(path[Math.min(path.length - 1, i + 1)]!, path[Math.max(0, i - 1)]!));
      const seed: V3 = i === 0 ? (Math.abs(t[0]) > 0.9 ? [0, 0, 1] : [1, 0, 0]) : u;
      const d = dot(seed, t);
      u = norm([seed[0] - t[0] * d, seed[1] - t[1] * d, seed[2] - t[2] * d]);
      const w = cross(t, u);
      const row: number[] = [];
      for (let j = 0; j < seg; j++) {
        const a = (j / seg) * Math.PI * 2, r = rad(i);
        const cu = Math.cos(a) * r, cw = Math.sin(a) * r * (o.squash ?? 1);
        row.push(this.v(p[0] + u[0] * cu + w[0] * cw, p[1] + u[1] * cu + w[1] * cw, p[2] + u[2] * cu + w[2] * cw));
      }
      rows.push(row);
    });
    for (let i = 0; i + 1 < rows.length; i++) {
      const inside: V3 = [(path[i]![0] + path[i + 1]![0]) / 2, (path[i]![1] + path[i + 1]![1]) / 2, (path[i]![2] + path[i + 1]![2]) / 2];
      for (let j = 0; j < seg; j++) {
        const j2 = (j + 1) % seg;
        this.face([rows[i]![j]!, rows[i + 1]![j]!, rows[i + 1]![j2]!, rows[i]![j2]!], col(i, j), inside, o.smooth);
      }
    }
    const n = path.length;
    this.face([...rows[0]!], o.ends ?? col(0, 0), path[1]!);
    this.face([...rows[n - 1]!], o.ends ?? col(n - 2, 0), path[n - 2]!);
    return this;
  }

  /// Every point of another mesh, moved, added to this one.
  add(other: Mesh3, move: V3 = [0, 0, 0]): this {
    const base = this.verts.length;
    for (const p of other.verts) this.verts.push([p[0] + move[0], p[1] + move[1], p[2] + move[2]]);
    for (const p of other.polys) this.polys.push({ ...p, v: p.v.map((i) => i + base), color: p.color ?? (other.color !== this.color ? other.color : undefined) });
    return this;
  }

  /// Turns the whole mesh about the y axis through the origin (degrees).
  turn(degrees: number): this {
    const a = (degrees * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    this.verts = this.verts.map(([x, y, z]) => [x * c + z * s, y, -x * s + z * c]);
    return this;
  }

  bounds(): { min: V3; max: V3 } {
    const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
    for (const p of this.verts) for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k]!, p[k]!);
      max[k] = Math.max(max[k]!, p[k]!);
    }
    return { min, max };
  }

  /// The mesh as a shape of the model document, its points (given here in metres from `origin`) in model units.
  cube(origin: V3 = [0, 0, 0]): Args {
    const out: Args = { shape: "mesh", color: this.color, verts: this.verts.map((p) => [r3((p[0] - origin[0]) * U), r3((p[1] - origin[1]) * U), r3((p[2] - origin[2]) * U)]), polys: this.polys };
    if (this.opts.name) out.name = this.opts.name;
    if (this.opts.emissive) out.emissive = this.opts.emissive;
    if (this.opts.metallic) out.metallic = this.opts.metallic;
    if (this.opts.roughness !== undefined) out.roughness = this.opts.roughness;
    if (this.opts.bend !== undefined) out.bend = this.opts.bend;
    if (this.opts.texture) out.texture = { at: [0, 0], scale: this.opts.texture };
    if (this.opts.paint) out.paint = this.opts.paint;
    return out;
  }
}

/// A part of the model document: `origin` in metres in its parent; its shapes are meshes given in metres from that origin.
export function part(name: string, origin: V3, meshes: Mesh3[], children: Args[] = [], rotation: V3 = [0, 0, 0]): Args {
  return { name, origin: origin.map((v) => r3(v * U)), rotation, cubes: meshes.filter((m) => m.polys.length).map((m) => m.cube()), children };
}

export function modelDoc(parts: Args[], extra: Args = {}): Args {
  return { version: 1, scale: 1 / U, parts, ...extra };
}

/// One of a list, by the random source.
export const pick = <T>(rand: Rand, list: readonly T[]): T => list[Math.floor(rand() * list.length) % list.length]!;
export const between = (rand: Rand, a: number, b: number) => a + (b - a) * rand();

/// A named choice, or the first of the list when left out; an unknown one is refused with the list.
export function choice<T extends string>(given: unknown, list: readonly T[], what: string, fallback: T = list[0]!): T {
  if (given === undefined || given === null || given === "") return fallback;
  const s = String(given).trim().toLowerCase().replace(/[ -]/g, "_");
  const hit = list.find((x) => x === s);
  if (!hit) throw new Error(`${what} is one of ${list.join(", ")} (got ${JSON.stringify(given)})`);
  return hit;
}
