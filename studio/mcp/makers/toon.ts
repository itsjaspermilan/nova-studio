// The detailed style's people and creatures: small 3D shapes (pix3d.ts's spheres, capsules, boxes) drawn as bold
// cartoon pixel art instead of a soft render. What makes it look drawn:
//  - hard cel shading: each material has three tones (shadow, base, light) and a bright spec on what shines, chosen by
//    the light with hard edges, then cleaned so no tone is left as a stray pixel or a one-pixel sliver (a mode filter
//    inside each material);
//  - a bold silhouette: one pixel of near-black outside the shape and, on the sides away from the light, a second of the
//    darkest tone of the colour inside (two pixels where it meets the ground), a line inside wherever a nearer part
//    passes in front of a farther one;
//  - one clear rim of the district's neon on the right-hand edge (the side away from the key light);
//  - nothing soft: no gradients, no blur, no dithering on a body.
//
// A figure is built in its own frame (x across, y up, z forward) and turned, tipped (a roll), squashed (a hit) and
// mirrored as a whole by `Xf`, so painting by "where on the body" works in every pose.

import { Img, mix, shade, type Ramp, type Rgba } from "./paint";
import { glowHd, type Hit, type Look, type Sdf, type V3 } from "./pix3d";

const WHITE: Rgba = [255, 255, 255, 255];

/// Three cel tones and the rest: [line, shadow, base, light, spec]. Shadows lean blue-violet, lights towards `warm`.
export function toonRamp(c: Rgba, warm: Rgba = [255, 236, 210, 255]): Ramp {
  const cool: Rgba = [40, 30, 92, 255];
  return [mix(shade(c, -3.4), cool, 0.3), mix(shade(c, -1.55), cool, 0.2), c, mix(shade(c, 1.05), warm, 0.14), mix(shade(c, 2.6), warm, 0.3)];
}

export interface TPart {
  sdf: Sdf;
  /// Where it is in the figure's frame, and how far it reaches round that.
  at: V3;
  size: number;
  look: Look | ((h: Hit) => Look | null);
  /// Parts of one group get no line between them (a sleeve and its arm).
  group?: number;
  /// Light, not body: no outline, no shadow, laid over what is behind (an arc, a hologram).
  bare?: boolean;
}

/// How a figure's frame becomes the world: scaled (squash, a mirror when sx < 0), tipped about `pivot` (a roll), turned
/// by `yaw` (0 faces the camera), moved by `move`.
export interface Xf {
  yaw: number;
  pitch?: number;
  /// A turn about the forward axis through `pivot` (a cartwheel), after the pitch.
  bank?: number;
  pivot?: V3;
  sx?: number;
  sy?: number;
  move?: V3;
}

export interface ToonShot {
  w: number;
  h: number;
  /// Where the world's origin is on the picture (the ground under the middle of the thing).
  ox: number;
  oy: number;
  tilt?: number;
  outline: Rgba;
  /// The neon on the right-hand edge.
  rim?: Rgba;
  /// Hard two-tone shadows on the ground (world x, z, radius x, radius z).
  shadows?: [number, number, number, number][];
  /// No mode filter (for tests of the raw shading).
  raw?: boolean;
}

export interface Toon {
  img: Img;
  emit: Img;
  /// The group drawn at each pixel (-1 nothing, -2 a bare part).
  who: Int16Array;
  /// Where a point of the figure's frame lands on the picture.
  at: (p: V3) => [number, number];
}

const LIGHT = norm([-0.55, 0.72, 0.5]);
function norm(v: V3): V3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/// The figure's frame to the world and back.
export function xfOf(x: Xf) {
  const cs = Math.cos(x.yaw), sn = Math.sin(x.yaw);
  const pc = Math.cos(x.pitch ?? 0), ps = Math.sin(x.pitch ?? 0);
  const sx = x.sx ?? 1, sy = x.sy ?? 1, pv = x.pivot ?? [0, 0, 0], mv = x.move ?? [0, 0, 0];
  const bc = Math.cos(x.bank ?? 0), bs = Math.sin(x.bank ?? 0);
  const fwd = (p: V3): V3 => {
    let X = p[0] * sx, Y = p[1] * sy, Z = p[2] * Math.abs(sx);
    // tip about the pivot (the top goes forward for a positive pitch)
    const ty = Y - pv[1], tz = Z - pv[2];
    Y = pv[1] + ty * pc - tz * ps;
    Z = pv[2] + ty * ps + tz * pc;
    // bank about the pivot (a cartwheel: the top goes to +x for a positive bank)
    const bx = X - pv[0], by = Y - pv[1];
    X = pv[0] + bx * bc + by * bs;
    Y = pv[1] - bx * bs + by * bc;
    return [cs * X + sn * Z + mv[0], Y + mv[1], -sn * X + cs * Z + mv[2]];
  };
  const back = (w: V3): V3 => {
    const X0 = w[0] - mv[0], Y0 = w[1] - mv[1], Z0 = w[2] - mv[2];
    let X = cs * X0 - sn * Z0;
    const Z = sn * X0 + cs * Z0;
    const bx = X - pv[0], by = Y0 - pv[1];
    X = pv[0] + bx * bc - by * bs;
    const Y1 = pv[1] + bx * bs + by * bc;
    const ty = Y1 - pv[1], tz = Z - pv[2];
    const Y = pv[1] + ty * pc + tz * ps, Z2 = pv[2] - ty * ps + tz * pc;
    return [X / sx, Y / sy, Z2 / Math.abs(sx)];
  };
  /// A direction in the world turned back into the figure's frame (no scale).
  const turnBack = (n: V3): V3 => {
    const X0 = cs * n[0] - sn * n[2], Z = sn * n[0] + cs * n[2];
    const X = X0 * bc - n[1] * bs, Y0 = X0 * bs + n[1] * bc;
    const Y = Y0 * pc + Z * ps, Z2 = -Y0 * ps + Z * pc;
    return [Math.sign(sx) * X, Y, Z2];
  };
  const k = Math.min(Math.abs(sx), Math.abs(sy)), big = Math.max(Math.abs(sx), Math.abs(sy));
  return { fwd, back, turnBack, k, big };
}

/// Draws the parts of one figure (or a few figures, each with its own Xf) as bold cel-shaded pixel art.
export function toon(sets: { parts: TPart[]; xf: Xf }[], s: ToonShot): Toon {
  const tilt = ((s.tilt ?? 25) * Math.PI) / 180;
  const F: V3 = [0, Math.sin(tilt), Math.cos(tilt)];
  const U: V3 = [0, Math.cos(tilt), -Math.sin(tilt)];
  const W = s.w, H = s.h, N = W * H;
  const img = new Img(W, H), emit = new Img(W, H);
  const depth = new Float32Array(N).fill(Infinity), who = new Int16Array(N).fill(-1);
  const nxw = new Float32Array(N), nyw = new Float32Array(N);
  const tone = new Int8Array(N).fill(-1), fixed = new Uint8Array(N), key = new Int32Array(N).fill(-1);
  const ramps: (Ramp | null)[] = new Array(N).fill(null), alpha = new Float32Array(N).fill(1);
  const toPic = (w: V3): [number, number] => [s.ox + w[0], s.oy - (w[1] * U[1] + w[2] * U[2])];
  // every part in world terms
  interface WPart { p: TPart; sdf: Sdf; at: V3; size: number; xf: ReturnType<typeof xfOf>; box: [number, number, number, number] }
  const all: WPart[] = [];
  for (const set of sets) {
    const xf = xfOf(set.xf);
    for (const p of set.parts) {
      const at = xf.fwd(p.at), size = p.size * xf.big;
      const [px, py] = toPic(at);
      all.push({
        p, at, size, xf,
        sdf: (x, y, z) => p.sdf(...xf.back([x, y, z])) * xf.k,
        box: [Math.floor(px - size - 1), Math.floor(py - size - 1), Math.ceil(px + size + 1), Math.ceil(py + size + 1)],
      });
    }
  }
  // hard two-tone shadows on the ground first
  for (const [x, z, rx, rz] of s.shadows ?? []) {
    const cx = s.ox + x, cy = s.oy + z * Math.sin(tilt), ry = Math.max(1, rz * Math.sin(tilt));
    for (let py = Math.floor(cy - ry - 1); py <= cy + ry + 1; py++) for (let px = Math.floor(cx - rx - 1); px <= cx + rx + 1; px++) {
      const d = ((px + 0.5 - cx) / rx) ** 2 + ((py + 0.5 - cy) / ry) ** 2;
      if (d < 1) img.set(px, py, [14, 10, 30, d < 0.55 ? 130 : 80]);
    }
  }
  const bare: [number, Rgba][] = [];
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
    const ax = px + 0.5 - s.ox, ay = s.oy - (py + 0.5);
    const o: V3 = [ax, ay * U[1] + 200 * F[1], ay * U[2] + 200 * F[2]];
    let best = Infinity, bi = -1;
    for (let i = 0; i < all.length; i++) {
      const q = all[i]!, b = q.box;
      if (px < b[0] || px > b[2] || py < b[1] || py > b[3]) continue;
      const ocx = o[0] - q.at[0], ocy = o[1] - q.at[1], ocz = o[2] - q.at[2];
      const bq = ocx * F[0] + ocy * F[1] + ocz * F[2], cq = ocx * ocx + ocy * ocy + ocz * ocz - (q.size + 1) ** 2;
      const disc = bq * bq - cq;
      if (disc < 0) continue;
      let t = Math.max(0, bq - Math.sqrt(disc));
      const tEnd = Math.min(best, bq + Math.sqrt(disc));
      for (let k = 0; k < 80 && t < tEnd; k++) {
        const d = q.sdf(o[0] - F[0] * t, o[1] - F[1] * t, o[2] - F[2] * t);
        if (d < 0.04) {
          if (t < best) [best, bi] = [t, i];
          break;
        }
        t += Math.max(d, 0.04);
      }
    }
    if (bi < 0) continue;
    const q = all[bi]!;
    const w: V3 = [o[0] - F[0] * best, o[1] - F[1] * best, o[2] - F[2] * best];
    const e = 0.2;
    const n = norm([
      q.sdf(w[0] + e, w[1], w[2]) - q.sdf(w[0] - e, w[1], w[2]),
      q.sdf(w[0], w[1] + e, w[2]) - q.sdf(w[0], w[1] - e, w[2]),
      q.sdf(w[0], w[1], w[2] + e) - q.sdf(w[0], w[1], w[2] - e),
    ]);
    const l = q.xf.back(w), ln = q.xf.turnBack(n);
    const look = typeof q.p.look === "function" ? q.p.look({ w, l, n, ln }) : q.p.look;
    if (!look) continue;
    const i = py * W + px;
    let t: number;
    if (look.emit) {
      t = n[0] * F[0] + n[1] * F[1] + n[2] * F[2] > 0.7 ? 4 : 3;
      emit.set(px, py, WHITE);
      fixed[i] = 1;
    } else if (look.flat !== undefined) {
      t = look.flat;
      fixed[i] = 1;
    } else {
      const lam = n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2];
      t = lam < 0.12 ? 1 : lam < 0.66 ? 2 : 3;
      if (look.spec) {
        const r: V3 = [2 * lam * n[0] - LIGHT[0], 2 * lam * n[1] - LIGHT[1], 2 * lam * n[2] - LIGHT[2]];
        const sp = Math.max(0, r[0] * F[0] + r[1] * F[1] + r[2] * F[2]) ** 14 * look.spec;
        if (sp > 0.4) {
          t = 4;
          fixed[i] = 1;
        }
      }
    }
    if (q.p.bare) {
      bare.push([i, look.ramp[t]!]);
      if (look.alpha !== undefined) bare[bare.length - 1]![1] = [...look.ramp[t]!.slice(0, 3), Math.round(255 * look.alpha)] as Rgba;
      continue;
    }
    depth[i] = best;
    who[i] = q.p.group ?? 1000 + bi;
    nxw[i] = n[0];
    nyw[i] = n[1];
    tone[i] = t;
    ramps[i] = look.ramp;
    const c = look.ramp[2];
    key[i] = (who[i]! * 7919) ^ ((c[0] << 16) | (c[1] << 8) | c[2]);
    if (look.alpha !== undefined) alpha[i] = look.alpha;
  }
  // clean the tones: a pixel whose tone fewer than three of its eight neighbours (in its own material) share takes the
  // tone most of them have, twice over; no stray pixels, no one-pixel slivers between two bands
  if (!s.raw) for (let pass = 0; pass < 2; pass++) {
    const next = tone.slice();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (tone[i]! < 0 || fixed[i]) continue;
      const count = [0, 0, 0, 0, 0];
      let same = 0, mine = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const X = x + dx, Y = y + dy;
        if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
        const j = Y * W + X;
        if (key[j] !== key[i] || fixed[j]) continue;
        same++;
        count[tone[j]!]!++;
        if (tone[j] === tone[i]) mine++;
      }
      if (same >= 3 && mine < 3) {
        let bt = tone[i]!, bc = -1;
        for (let k = 1; k <= 3; k++) if (count[k]! > bc) [bt, bc] = [k, count[k]!];
        next[i] = bt;
      }
    }
    tone.set(next);
  }
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < W && y < H ? who[y * W + x]! : -1);
  const colour = (i: number): Rgba => {
    const c = ramps[i]![tone[i]!]!;
    return alpha[i]! < 1 ? [c[0], c[1], c[2], Math.round(255 * alpha[i]!)] : c;
  };
  const out = new Uint8ClampedArray(img.r.data);
  const put = (i: number, c: Rgba) => out.set(c, i * 4);
  for (let i = 0; i < N; i++) if (who[i]! >= 0) put(i, colour(i));
  // lines inside: where a nearer part passes in front, the farther one's pixel takes its darkest tone
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, me = who[i]!;
    if (me < 0) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const o = at(x + dx, y + dy);
      if (o < 0 || o === me) continue;
      if (depth[(y + dy) * W + x + dx]! < depth[i]! - 2.2) {
        put(i, ramps[i]![0]);
        break;
      }
    }
  }
  // the silhouette's inside ring: the neon rim on the right-hand edge, the darkest tone on the sides away from the light
  const inner = new Uint8Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (who[i]! < 0 || fixed[i] && ramps[i] && tone[i] === 4) continue;
    const right = at(x + 1, y) < 0, below = at(x, y + 1) < 0, left = at(x - 1, y) < 0, above = at(x, y - 1) < 0;
    if (!(right || below || left || above)) continue;
    inner[i] = 1;
    if (right && s.rim && nxw[i]! > 0.12 && nyw[i]! > -0.6) put(i, mix(ramps[i]![3], s.rim, 0.8));
    else if (right || below) put(i, ramps[i]![0]);
  }
  // the outside ring: near-black, tinted by the colour it surrounds
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (who[i]! >= 0) continue;
    let near: Ramp | null = null;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      if (at(x + dx, y + dy) < 0) continue;
      near = ramps[(y + dy) * W + x + dx]!;
      break;
    }
    if (!near) continue;
    const c = mix(s.outline, near[0], 0.3);
    put(i, [c[0], c[1], c[2], 255]);
    who[i] = -3;
  }
  img.r.data.set(out);
  // light laid over the body last
  for (const [i, c] of bare) img.set(i % W, Math.floor(i / W), c);
  for (const [i] of bare) if (who[i] === -1) who[i] = -2;
  return { img, emit, who, at: (p) => toPic(xfOf(sets[0]!.xf).fwd(p)) };
}

/// A small picture stamped on a figure (an eye, a mouth): `rows` of characters, each a colour from `ink` ("." leaves
/// the pixel), placed with its top-left at (x, y), flipped when `flip`; only where `may` allows.
export function stamp(img: Img, rows: string[], x: number, y: number, ink: Record<string, Rgba>, flip = false, may: (x: number, y: number) => boolean = () => true) {
  const w = Math.max(...rows.map((r) => r.length));
  rows.forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx++) {
      const ch = row[dx]!;
      if (ch === "." || ch === " ") continue;
      const c = ink[ch];
      if (!c) continue;
      const X = Math.round(x) + (flip ? w - 1 - dx : dx), Y = Math.round(y) + dy;
      if (may(X, Y)) img.set(X, Y, c);
    }
  });
}

/// A thick stroke of light along a path (a swing's arc, a roll's streak): `width` from tail to head, a hot core.
export function streak(img: Img, pts: [number, number][], core: Rgba, edge: Rgba, width: [number, number], under?: (x: number, y: number) => boolean) {
  const n = pts.length;
  const seen = new Map<number, number>();
  for (let k = 0; k < n - 1; k++) {
    const [x0, y0] = pts[k]!, [x1, y1] = pts[k + 1]!;
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
    for (let j = 0; j <= steps; j++) {
      const t = (k + j / steps) / (n - 1), x = x0 + ((x1 - x0) * j) / steps, y = y0 + ((y1 - y0) * j) / steps;
      const r = (width[0] + (width[1] - width[0]) * t) / 2;
      for (let dy = Math.floor(-r - 1); dy <= Math.ceil(r + 1); dy++) for (let dx = Math.floor(-r - 1); dx <= Math.ceil(r + 1); dx++) {
        const d = Math.hypot(dx, dy);
        if (d > r + 0.2) continue;
        const X = Math.round(x + dx), Y = Math.round(y + dy), key = Y * img.w + X;
        const v = d < r * 0.45 ? 2 : 1;
        if ((seen.get(key) ?? 0) < v) seen.set(key, v);
      }
    }
  }
  for (const [key, v] of seen) {
    const X = key % img.w, Y = Math.floor(key / img.w);
    if (!img.inside(X, Y) || (under && !under(X, Y))) continue;
    img.set(X, Y, v === 2 ? core : edge);
  }
}

/// The tell's flash: the outside ring of a drawn figure in the glow colour, and one more ring of it, half see-through.
export function flashRing(img: Img, c: Rgba, hot: Rgba) {
  const W = img.w, H = img.h;
  const solid = (x: number, y: number) => img.firm(x, y);
  const ring1: [number, number][] = [], ring2: [number, number][] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!solid(x, y)) continue;
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !solid(x + dx!, y + dy!))) ring1.push([x, y]);
  }
  const on = new Set(ring1.map(([x, y]) => y * W + x));
  for (const [x, y] of ring1) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const X = x + dx, Y = y + dy;
    if (X < 0 || Y < 0 || X >= W || Y >= H || solid(X, Y) || on.has(Y * W + X)) continue;
    on.add(Y * W + X);
    ring2.push([X, Y]);
  }
  for (const [x, y] of ring1) img.set(x, y, hot);
  for (const [x, y] of ring2) img.r.data.set([c[0], c[1], c[2], 200], (y * W + x) * 4);
}

/// The light of what glows (pix3d's glowHd), kept inside the figure's outline: the outside ring stays dark, so a lit
/// baton or visor reads as drawn, not as a halo pasted on.
export function glowInside(t: Toon, acc: Ramp, o: { reach?: number; hot?: number; strength?: number } = {}) {
  const before = t.img.r.data.slice();
  glowHd(t.img, (x, y) => t.emit.has(x, y), acc, o);
  // the ring and everything outside it (the ground's shadow, nothing) as they were
  for (let i = 0; i < t.who.length; i++) if (t.who[i] === -1 || t.who[i] === -3) t.img.r.data.set(before.subarray(i * 4, i * 4 + 4), i * 4);
}

export { WHITE };
