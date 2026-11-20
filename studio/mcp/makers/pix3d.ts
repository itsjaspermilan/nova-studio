// The detailed style's renderer: small solid shapes (spheres, capsules, rounded boxes, cylinders) put together in 3D
// and drawn as pixel art, so a character, a creature or a prop can be drawn facing four ways and in every frame of a
// move from one description. A pixel is one unit; the camera looks down at the scene from the front at a fixed tilt
// (the 3/4 view of a top-down game), with no perspective.
//
// What makes it pixel art and not a render:
//  - every material is a ramp of five tones (shadows pulled towards blue-violet, lights towards the palette's light)
//    and the light (from the upper left, a little in front) picks one of them: bands, not gradients;
//  - a specular band on what shines (metal, glass, wet things);
//  - selective outlines: the silhouette in a dark version of the colour it surrounds, lighter on the lit side, and a
//    line inside wherever one part passes in front of another;
//  - a rim of the accent neon on the edges that face away from the light (the street's signs are behind);
//  - what glows is light: a near-white core, two rings of the accent falling off over what is under it (glowHd).

import { mix, shade, type Ramp, type Rgba } from "./paint";
import { Img } from "./paint";

export type V3 = [number, number, number];
const WHITE: Rgba = [255, 255, 255, 255];

// ---- shapes: signed distance functions in world units ---------------------------------------------------------------
export type Sdf = (x: number, y: number, z: number) => number;

export const sphere = (c: V3, r: number): Sdf => (x, y, z) => Math.hypot(x - c[0], y - c[1], z - c[2]) - r;
export const ellipsoid = (c: V3, r: V3): Sdf => (x, y, z) => {
  const px = (x - c[0]) / r[0], py = (y - c[1]) / r[1], pz = (z - c[2]) / r[2];
  const k0 = Math.hypot(px, py, pz), k1 = Math.hypot(px / r[0], py / r[1], pz / r[2]);
  return k1 === 0 ? -Math.min(...r) : (k0 * (k0 - 1)) / k1;
};
/// A capsule from a to b whose radius goes from ra to rb (a limb that tapers).
export const capsule = (a: V3, b: V3, ra: number, rb = ra): Sdf => {
  const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2], bb = bx * bx + by * by + bz * bz || 1e-6;
  return (x, y, z) => {
    const px = x - a[0], py = y - a[1], pz = z - a[2];
    const h = Math.max(0, Math.min(1, (px * bx + py * by + pz * bz) / bb));
    return Math.hypot(px - bx * h, py - by * h, pz - bz * h) - (ra + (rb - ra) * h);
  };
};
/// A box about c with half sizes h and corners rounded by r, turned by yaw (radians about the vertical).
export const box = (c: V3, h: V3, r = 0, yaw = 0): Sdf => {
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  return (x, y, z) => {
    const dx = x - c[0], dz = z - c[2];
    const lx = Math.abs(cs * dx - sn * dz) - h[0] + r, ly = Math.abs(y - c[1]) - h[1] + r, lz = Math.abs(sn * dx + cs * dz) - h[2] + r;
    return Math.hypot(Math.max(lx, 0), Math.max(ly, 0), Math.max(lz, 0)) + Math.min(Math.max(lx, ly, lz), 0) - r;
  };
};
/// An upright cylinder: its axis through (c.x, c.z) from y0 to y1, radius r, edges rounded by e.
export const cylinder = (c: V3, r: number, y0: number, y1: number, e = 0): Sdf => (x, y, z) => {
  const dx = Math.hypot(x - c[0], z - c[2]) - r + e, dy = Math.abs(y - (y0 + y1) / 2) - (y1 - y0) / 2 + e;
  return Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) - e;
};
/// A cylinder lying along the x axis (a pipe, a drum on its side).
export const cylinderX = (c: V3, r: number, x0: number, x1: number): Sdf => (x, y, z) => {
  const d = Math.hypot(y - c[1], z - c[2]) - r, dx = Math.abs(x - (x0 + x1) / 2) - (x1 - x0) / 2;
  return Math.min(Math.max(d, dx), 0) + Math.hypot(Math.max(d, 0), Math.max(dx, 0));
};
export const union = (...s: Sdf[]): Sdf => (x, y, z) => {
  let d = Infinity;
  for (const f of s) d = Math.min(d, f(x, y, z));
  return d;
};
export const smooth = (k: number, ...s: Sdf[]): Sdf => (x, y, z) => {
  let d = s[0]!(x, y, z);
  for (let i = 1; i < s.length; i++) {
    const e = s[i]!(x, y, z), h = Math.max(0, Math.min(1, 0.5 + (0.5 * (e - d)) / k));
    d = e + (d - e) * h - k * h * (1 - h);
  }
  return d;
};
export const cut = (a: Sdf, b: Sdf): Sdf => (x, y, z) => Math.max(a(x, y, z), -b(x, y, z));
export const inter = (a: Sdf, b: Sdf): Sdf => (x, y, z) => Math.max(a(x, y, z), b(x, y, z));

// ---- what a surface is made of ----------------------------------------------------------------------------------------
export interface Look {
  ramp: Ramp;
  /// 0 matte, 1 a hard shine (metal, glass, wet).
  spec?: number;
  /// Lit from inside: drawn in the ramp's light tones whatever the light, and marked to glow.
  emit?: boolean;
  /// Flat (no shading): painted marks, a screen.
  flat?: number;
  /// See-through (glass): 0 to 1.
  alpha?: number;
}
export interface Hit {
  /// The point hit, in world units and in the part's own frame (x right, y up, z forward, as the part faces).
  w: V3;
  l: V3;
  n: V3;
  /// The normal in the part's own frame.
  ln: V3;
}

export interface Part {
  sdf: Sdf;
  /// Where it is (for the bounds), and how big round that.
  at: V3;
  size: number;
  look: Look | ((h: Hit) => Look | null);
  /// The part's own frame: its origin and which way it faces (radians about the vertical; 0 faces the camera).
  frame?: { o: V3; yaw: number };
  /// Parts of one group get no line between them (a sleeve and its arm).
  group?: number;
  /// Leave out of the outline and the shadow (a glow, a hologram).
  bare?: boolean;
}

export interface Shot {
  w: number;
  h: number;
  /// Where the world's origin is on the picture (the ground under the middle of the thing), pixels.
  ox: number;
  oy: number;
  /// The camera's tilt down from level, degrees (35 when left out).
  tilt?: number;
  outline: Rgba;
  /// The light's colour mixed into the light tones and the neon for rim light.
  rim?: Rgba;
  /// Soft shadows on the ground: [x, z, radius x, radius z].
  shadows?: [number, number, number, number][];
  /// The cool and warm the tones are pulled towards.
  scale?: number;
}

const LIGHT = norm([-0.55, 0.72, 0.5]);
function norm(v: V3): V3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/// A ramp for the detailed style: five tones, the shadows pulled towards blue-violet and darker, the lights towards
/// `warm` (the district's light or its neon) and paler.
export function hdRamp(c: Rgba, warm: Rgba = [255, 236, 210, 255]): Ramp {
  const cool: Rgba = [52, 40, 110, 255];
  return [mix(shade(c, -2.6), cool, 0.22), mix(shade(c, -1.25), cool, 0.12), c, mix(shade(c, 0.9), warm, 0.12), mix(shade(c, 1.9), warm, 0.22)];
}

/// Draws the parts. Returns the picture, and what glows (to light with glowHd after anything else is drawn).
export function render(parts: Part[], s: Shot): { img: Img; emit: Img } {
  const tilt = ((s.tilt ?? 35) * Math.PI) / 180;
  const F: V3 = [0, Math.sin(tilt), Math.cos(tilt)]; // towards the viewer
  const U: V3 = [0, Math.cos(tilt), -Math.sin(tilt)]; // up the picture
  const W = s.w, H = s.h;
  const img = new Img(W, H), emit = new Img(W, H);
  const depth = new Float32Array(W * H).fill(Infinity), who = new Int16Array(W * H).fill(-1);
  const nx = new Float32Array(W * H), nz = new Float32Array(W * H);
  // each part's box on the picture
  const boxes = parts.map((p) => {
    const sx = s.ox + p.at[0], sy = s.oy - (p.at[1] * U[1] + p.at[2] * U[2]);
    return [Math.floor(sx - p.size - 1), Math.floor(sy - p.size - 1), Math.ceil(sx + p.size + 1), Math.ceil(sy + p.size + 1)] as [number, number, number, number];
  });
  // soft shadows on the ground first, darkest in the middle
  for (const [x, z, rx, rz] of s.shadows ?? []) {
    const cx = s.ox + x, cy = s.oy + z * Math.sin(tilt) * 0 - z * U[2];
    const ry = rz * Math.sin(tilt);
    for (let py = Math.floor(cy - ry - 1); py <= cy + ry + 1; py++) for (let px = Math.floor(cx - rx - 1); px <= cx + rx + 1; px++) {
      const d = ((px + 0.5 - cx) / rx) ** 2 + ((py + 0.5 - cy) / Math.max(1, ry)) ** 2;
      if (d < 1) img.set(px, py, [18, 14, 34, d < 0.35 ? 120 : d < 0.7 ? 85 : 45]);
    }
  }
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
    // the ray through this pixel: from in front of everything, towards the scene
    const ax = px + 0.5 - s.ox, ay = s.oy - (py + 0.5);
    const o: V3 = [ax + 0 * F[0], ay * U[1] + 200 * F[1], ay * U[2] + 200 * F[2]];
    let best = Infinity, bi = -1;
    for (let i = 0; i < parts.length; i++) {
      const b = boxes[i]!;
      if (px < b[0] || px > b[2] || py < b[1] || py > b[3]) continue;
      const p = parts[i]!;
      // start where the ray meets the part's bounding sphere
      const ocx = o[0] - p.at[0], ocy = o[1] - p.at[1], ocz = o[2] - p.at[2];
      const bq = ocx * F[0] + ocy * F[1] + ocz * F[2], cq = ocx * ocx + ocy * ocy + ocz * ocz - (p.size + 1) ** 2;
      const disc = bq * bq - cq;
      if (disc < 0) continue;
      let t = Math.max(0, bq - Math.sqrt(disc));
      const tEnd = Math.min(best, bq + Math.sqrt(disc));
      for (let k = 0; k < 64 && t < tEnd; k++) {
        const d = p.sdf(o[0] - F[0] * t, o[1] - F[1] * t, o[2] - F[2] * t);
        if (d < 0.05) {
          if (t < best) [best, bi] = [t, i];
          break;
        }
        t += Math.max(d, 0.05);
      }
    }
    if (bi < 0) continue;
    const p = parts[bi]!;
    const w: V3 = [o[0] - F[0] * best, o[1] - F[1] * best, o[2] - F[2] * best];
    const e = 0.25;
    const n = norm([
      p.sdf(w[0] + e, w[1], w[2]) - p.sdf(w[0] - e, w[1], w[2]),
      p.sdf(w[0], w[1] + e, w[2]) - p.sdf(w[0], w[1] - e, w[2]),
      p.sdf(w[0], w[1], w[2] + e) - p.sdf(w[0], w[1], w[2] - e),
    ]);
    const fr = p.frame ?? { o: [0, 0, 0] as V3, yaw: 0 };
    const cs = Math.cos(fr.yaw), sn = Math.sin(fr.yaw);
    const rel: V3 = [w[0] - fr.o[0], w[1] - fr.o[1], w[2] - fr.o[2]];
    const l: V3 = [cs * rel[0] - sn * rel[2], rel[1], sn * rel[0] + cs * rel[2]];
    const ln: V3 = [cs * n[0] - sn * n[2], n[1], sn * n[0] + cs * n[2]];
    const look = typeof p.look === "function" ? p.look({ w, l, n, ln }) : p.look;
    if (!look) continue;
    const i = py * W + px;
    depth[i] = best;
    who[i] = p.group ?? bi;
    nx[i] = n[0];
    nz[i] = n[2];
    let c: Rgba;
    if (look.emit) {
      c = look.ramp[n[0] * F[0] + n[2] * F[2] + n[1] * F[1] > 0.75 ? 4 : 3];
      emit.set(px, py, WHITE);
    } else if (look.flat !== undefined) c = look.ramp[look.flat]!;
    else {
      const lam = Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
      const I = 0.2 + 0.8 * lam;
      let idx = I < 0.3 ? 0 : I < 0.47 ? 1 : I < 0.68 ? 2 : I < 0.88 ? 3 : 4;
      if (look.spec) {
        // the light's reflection towards the viewer: a band of the brightest tone
        const dot = n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2];
        const r: V3 = [2 * dot * n[0] - LIGHT[0], 2 * dot * n[1] - LIGHT[1], 2 * dot * n[2] - LIGHT[2]];
        const sp = Math.max(0, r[0] * F[0] + r[1] * F[1] + r[2] * F[2]) ** 12 * look.spec;
        if (sp > 0.45) idx = 4;
        c = sp > 0.8 ? mix(look.ramp[4], WHITE, 0.45) : look.ramp[idx]!;
      } else c = look.ramp[idx]!;
    }
    if (look.alpha !== undefined) c = [c[0], c[1], c[2], Math.round(255 * look.alpha)];
    if (p.bare) {
      img.set(px, py, c);
      who[i] = -2;
    } else img.r.data.set(c, i * 4);
  }
  finishHd(img, depth, who, nx, nz, s);
  return { img, emit };
}

/// The outlines and the rim light of a rendered picture.
function finishHd(img: Img, depth: Float32Array, who: Int16Array, nx: Float32Array, nz: Float32Array, s: Shot) {
  const W = img.w, H = img.h;
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < W && y < H ? who[y * W + x]! : -1);
  const out = img.clone();
  // rim light: the edge that faces right and away from the light catches the neon from behind
  if (s.rim) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (who[i]! < 0) continue;
    const edge = at(x + 1, y) < 0 || at(x + 2, y) < 0;
    if (edge && nx[i]! > 0.3 && nz[i]! < 0.85) out.set(x, y, mix(img.get(x, y)!, s.rim, 0.5));
  }
  // a line inside where a nearer part passes in front of a farther one: the farther one's pixel darkens
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, me = who[i]!;
    if (me < 0) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const j = (y + dy) * W + x + dx, o = at(x + dx, y + dy);
      if (o < 0 || o === me) continue;
      if (depth[j]! < depth[i]! - 2.5) {
        const c = out.get(x, y)!;
        out.set(x, y, mix(shade(c, -2), s.outline, 0.35));
        break;
      }
    }
  }
  // the silhouette: a dark of the colour inside it; lighter where the light falls (above and to the left)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (at(x, y) !== -1 || (img.get(x, y)?.[3] ?? 0) > 200) continue;
    let near: Rgba | null = null, lit = false, count = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      if (at(x + dx, y + dy) < 0) continue;
      count++;
      const c = img.get(x + dx, y + dy)!;
      if (!near || c[0] + c[1] + c[2] < near[0] + near[1] + near[2]) near = c;
      if (dx === 1 || dy === 1) lit = true;
    }
    if (!near) continue;
    let c = mix(shade(near, -2.4), s.outline, lit ? 0.35 : 0.65);
    if (count >= 3) c = mix(c, near, 0.3); // fills a notch: softens the stair
    out.r.data.set([c[0], c[1], c[2], 255], (y * W + x) * 4);
  }
  img.r.data.set(out.r.data);
}

/// Light, not paint, at the detailed size: a near-white core, the accent round it, then two rings falling off over what
/// is under them (blended, not a flat halo).
export function glowHd(img: Img, core: (x: number, y: number) => boolean, acc: Ramp, o: { reach?: number; hot?: number; strength?: number } = {}) {
  const W = img.w, H = img.h, reach = o.reach ?? 3.5, k = o.strength ?? 1;
  const pts: [number, number][] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (core(x, y)) pts.push([x, y]);
  if (!pts.length) return;
  const dist = new Float32Array(W * H).fill(Infinity);
  const R = Math.ceil(reach);
  for (const [cx, cy] of pts) for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const x = cx + dx, y = cy + dy;
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const d = Math.hypot(dx, dy);
    if (d < dist[y * W + x]!) dist[y * W + x] = d;
  }
  const hot = mix(acc[2], WHITE, o.hot ?? 0.6);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = dist[y * W + x]!;
    if (d === Infinity || d > reach) continue;
    if (d === 0) img.set(x, y, hot);
    else if (d < 1.5) img.set(x, y, blend(img.get(x, y), acc[2], 0.9 * k));
    else if (d < 2.5) img.set(x, y, blend(img.get(x, y), acc[2], 0.42 * k));
    else img.set(x, y, blend(img.get(x, y), acc[1], 0.22 * k));
  }
}

/// A colour laid over what is there by `a` (or alone, half see-through, over nothing).
export function blend(under: Rgba | null, c: Rgba, a: number): Rgba {
  if (!under || under[3] < 40) return [c[0], c[1], c[2], Math.round(255 * Math.min(1, a))];
  const m = mix(under, [c[0], c[1], c[2], under[3]], Math.min(1, a));
  // light adds: never darker than what was there
  return [Math.max(m[0], under[0]), Math.max(m[1], under[1]), Math.max(m[2], under[2]), under[3]];
}

/// A soft spill of coloured light on the ground (under a sign, beside a strip): an ellipse falling off from its middle.
export function spill(img: Img, cx: number, cy: number, rx: number, ry: number, c: Rgba, a = 0.35) {
  for (let y = Math.floor(cy - ry); y <= cy + ry; y++) for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
    const d = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2;
    if (d >= 1) continue;
    const s = d < 0.3 ? 1 : d < 0.65 ? 0.6 : 0.3;
    img.set(x, y, blend(img.get(x, y), c, a * s));
  }
}
