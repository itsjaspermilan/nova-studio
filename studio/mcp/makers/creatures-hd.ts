// creature_make's city archetypes in the detailed style: twice the pixels (draw with sx = 1.5), built in 3D and drawn by
// pix3d.ts, with more frames where motion shows: a rat-drone's blade spins through six, a drone bobs while its light
// sweeps, a mimic opens through in-between frames. Every one has a "tell" frame (its edge lit in the glow colour and
// its lights flared) and a white "hit" frame.

import { hex, Img, mix, type Ramp, type Rgba } from "./paint";
import type { Palette } from "./palettes";
import { box, capsule, cut, cylinder, ellipsoid, glowHd, hdRamp, render, smooth, sphere, union, type Hit, type Look, type Part, type Sdf, type V3 } from "./pix3d";
import { vendingHd } from "./city-hd";

const WHITE: Rgba = [255, 255, 255, 255];

export interface HdCtx {
  P: Palette;
  r: Ramp;
  r2: Ramp;
  acc: Ramp;
  metal: Ramp;
  dark: Ramp;
}

interface HdKind {
  size: number;
  states: [string, number, number][];
  alias?: Record<string, string>;
  /// The parts of one frame (state "tell" is the first state's first pose made ready).
  parts?: (c: HdCtx, state: string, i: number) => Part[];
  /// A frame drawn whole (the mimic is the vending machine).
  whole?: (c: HdCtx, state: string, i: number) => Img;
  shadow?: (state: string, i: number) => [number, number, number, number] | null;
  names?: Record<string, number>;
  oy?: number;
}

const L = (ramp: Ramp, spec = 0, extra: Partial<Look> = {}): Look => ({ ramp, spec, ...extra });
const P = (sdf: Sdf, at: V3, size: number, look: Part["look"], group?: number, bare = false): Part => ({ sdf, at, size, look, group, bare });
const glowL = (c: HdCtx) => L(c.acc, 0, { emit: true });

function drone(c: HdCtx, state: string, i: number, mirror: boolean): Part[] {
  const n = state === "move" ? 6 : 4, ph = (i / n) * Math.PI * 2;
  const y = 15 + Math.sin(ph) * 1.5 + (state === "tell" ? -1 : 0), tilt = state === "move" ? 2 : 0;
  const body = mirror
    ? (h: Hit) => {
        // mirror plate: facets that throw back the street (its two neons and a white sky)
        const f = Math.floor(Math.atan2(h.n[0], h.n[2]) * 2.2 + h.n[1] * 2);
        return L(f % 3 === 0 ? hdRamp(c.P.accent[1][3]) : f % 3 === 1 ? hdRamp([230, 236, 246, 255]) : c.r, 1);
      }
    : L(c.r, 0.6);
  const parts: Part[] = [
    P(ellipsoid([0, y, tilt], [8, 4.6, 7]), [0, y, 0], 9, body, 1),
    P(cut(ellipsoid([0, y - 2.5, 1], [4.4, 3, 4]), box([0, y + 1, 1], [6, 2, 6])), [0, y - 2, 1], 5, L(c.dark, 0.7), 1),
  ];
  // the camera eye: its light sweeps side to side
  const sweep = Math.sin(ph) * 2.5;
  parts.push(P(sphere([sweep, y - 3.6, 4.4], 1.4), [sweep, y - 3.6, 4.4], 2, glowL(c), 2));
  for (const [x, z] of [[-11, -6], [11, -6], [-11, 6], [11, 6]] as const) {
    parts.push(P(capsule([x * 0.5, y, z * 0.5], [x, y + 1, z], 1), [x * 0.75, y, z * 0.75], 7, L(c.dark, 0.5), 3));
    parts.push(P(cylinder([x, 0, z], 1.4, y + 0.5, y + 2.5, 0.4), [x, y + 1.5, z], 3, L(c.metal, 0.8), 3));
    // the rotor: a pale disc that is blur, see-through
    parts.push(P(cylinder([x, 0, z], 6, y + 2.6, y + 3.1), [x, y + 2.8, z], 7, (h) => {
      const a = Math.atan2(h.w[2] - z, h.w[0] - x) + i * 1.3;
      return L(hdRamp(c.r2[3]), 0, { alpha: Math.cos(a * 2) > 0.6 ? 0.75 : 0.28, flat: 3 });
    }, 4, true));
  }
  return parts;
}

export const HD_CREATURES: Record<string, HdKind> = {
  rat_drone: {
    size: 32, states: [["idle", 4, 220], ["move", 6, 55]],
    parts: (c, state, i) => {
      const ph = state === "move" ? (i / 6) * Math.PI * 2 : (i / 4) * Math.PI * 2;
      const bob = state === "move" ? Math.abs(Math.sin(ph)) * 0.8 : Math.sin(ph) * 0.3;
      const spin = (state === "move" ? i * 0.9 : i * 0.25) + (state === "tell" ? 0.4 : 0);
      const parts: Part[] = [
        // the body: a low shell like a toy car's, a stripe, a cable for a tail, an antenna
        P(smooth(2, box([-1, 6 + bob, 0], [8, 2.6, 5], 1.5), ellipsoid([-1, 8.5 + bob, 0], [7, 3.4, 4.6])), [-1, 7, 0], 10, (h) => L(Math.abs(h.w[1] - (7 + bob)) < 0.8 && h.ln[2] > 0.3 ? c.r2 : c.r, 0.6), 1),
        P(capsule([-9, 5 + bob, 0], [-14, 6 + Math.sin(ph) * 2, -2], 0.7, 0.4), [-12, 6, -1], 5, L(c.dark, 0.3), 2),
        P(capsule([-4, 11 + bob, -1], [-6, 16 + bob, -2], 0.5), [-5, 14, -1], 4, L(c.metal, 0.8), 2),
        P(sphere([-6, 16.5 + bob, -2], 0.9), [-6, 16.5, -2], 2, glowL(c), 2),
        P(sphere([6.2, 8 + bob, 3], 1.1), [6, 8, 3], 2, glowL(c), 2),
      ];
      // wheels: discs on their side, a hub that turns
      for (const [x, z] of [[-5, 5], [4, 5], [-5, -5], [4, -5]] as const) parts.push(P(cylinderZ([x, 2.8, z], 2.8, z - 1.1, z + 1.1), [x, 2.8, z], 4, (h) => L(Math.hypot(h.w[0] - x, h.w[1] - 2.8) < 1.2 ? c.metal : c.dark, 0.5, Math.cos(Math.atan2(h.w[1] - 2.8, h.w[0] - x) * 2 + spin * 3) > 0.9 ? { flat: 3 } : {}), 3));
      // the blade: a toothed disc on the nose that spins
      parts.push(P((x, y, z) => {
        const dx = x - 10, dy = y - (6 + bob), dz = z;
        const a = Math.atan2(dy, dx) + spin, teeth = 5 + 0.9 * (Math.cos(a * 10) > 0 ? 1 : 0);
        return Math.max(Math.hypot(dx, dy) - teeth, Math.abs(dz) - 0.5);
      }, [10, 6, 0], 8, (h) => {
        const a = Math.atan2(h.w[1] - (6 + bob), h.w[0] - 10) + spin;
        const r = Math.hypot(h.w[0] - 10, h.w[1] - (6 + bob));
        if (state === "tell" && r > 4.5) return glowL(c);
        return L(r < 1.5 ? c.dark : Math.cos(a * 3) > 0.6 ? hdRamp(c.r2[4]) : c.r2, 1, { flat: r > 4.6 ? 4 : r < 1.5 ? 1 : Math.cos(a * 3) > 0.6 ? 4 : 2 });
      }, 5));
      return parts;
    },
    shadow: () => [0, 1, 13, 7],
  },
  hover_drone: { size: 32, states: [["idle", 4, 180], ["move", 6, 80]], parts: (c, s, i) => drone(c, s, i, false), shadow: () => [0, 0, 9, 7] },
  mirror_drone: { size: 32, states: [["idle", 4, 180], ["move", 6, 80]], parts: (c, s, i) => drone(c, s, i, true), shadow: () => [0, 0, 9, 7] },
  turret: {
    size: 48, states: [["idle", 2, 400], ["turn", 6, 90], ["fire", 3, 70]], alias: { move: "turn" },
    parts: (c, state, i) => {
      const yaw = state === "turn" ? ((i / 6) * 2 - 1) * 1.2 : 0, kick = state === "fire" && i === 0 ? -3 : state === "fire" && i === 1 ? -1.5 : 0;
      const dir: V3 = [Math.sin(yaw), 0, Math.cos(yaw)], at = (t: number, y = 13): V3 => [dir[0] * t, y, dir[2] * t];
      const parts: Part[] = [
        P(cylinder([0, 0, 0], 15, 0, 4, 1.2), [0, 2, 0], 16, (h) => L(Math.floor(Math.atan2(h.w[0], h.w[2]) * 4) % 2 && h.n[1] < 0.6 ? c.dark : c.metal, 0.6), 1),
        P(cut(ellipsoid([0, 8, 0], [11, 9, 11]), box([0, 0, 0], [16, 4, 16])), [0, 9, 0], 12, L(c.r, 0.7), 2),
        P(capsule(at(4 + kick), at(19 + kick), 2.2, 1.8), at(12), 10, L(c.dark, 0.9), 3),
        P(cylinder([dir[0] * (19 + kick), 0, dir[2] * (19 + kick)], 2.6, 11, 15), at(19 + kick), 3, L(c.metal, 0.9), 3),
        P(sphere(add(at(9), [0, 3, 0]), 1.8), add(at(9), [0, 3, 0]), 2, state === "idle" && i === 1 ? L(c.dark, 0.5) : glowL(c), 4),
      ];
      if (state === "fire" && i < 2) parts.push(P(sphere(at(23 + kick), i ? 2.2 : 4), at(23), 5, L(hdRamp(mix(c.acc[2], WHITE, 0.5)), 0, { emit: true }), 5, true));
      if (state === "tell") parts.push(P(sphere(at(21), 2.6), at(21), 3, glowL(c), 5, true));
      return parts;
    },
    shadow: () => [0, 0, 16, 12],
  },
  vending_mimic: {
    size: 64, states: [["idle", 1, 600], ["open", 4, 80]], alias: { closed: "idle" },
    whole: (c, state, i) => {
      // the vending machine tile itself in a 64x64 frame; opening, its window becomes a mouth
      const ctx = { t: 32, k: 2, P: c.P, seed: 1 };
      const open = state === "open" ? [0.25, 0.55, 0.85, 1][i]! : 0;
      return new Img(64, 64).draw(vendingHd(ctx, open, state === "tell"), 16, 0);
    },
    oy: 58,
  },
  spore_hound: {
    size: 48, states: [["idle", 4, 220], ["move", 6, 80], ["leap", 2, 120]],
    parts: (c, state, i) => {
      const ph = (i / (state === "move" ? 6 : 4)) * Math.PI * 2;
      const crouch = state === "tell" ? 3 : 0, air = state === "leap" ? 6 - i * 2 : 0, stretch = state === "leap" ? 3 : 0;
      const by = 14 - crouch + air + (state === "idle" ? Math.sin(ph) * 0.5 : 0);
      const flesh = (h: Hit) => L(Math.sin(h.w[0] * 0.9 + h.w[2] * 1.4) > 0.75 ? hdRamp(c.r[1]) : c.r, 0.25);
      const parts: Part[] = [
        P(smooth(4, ellipsoid([-2, by, 0], [11 + stretch, 6.5, 6.5]), ellipsoid([8 + stretch, by + 2, 0], [6, 5.5, 5.5])), [2, by, 0], 16, flesh, 1),
        P(smooth(2, ellipsoid([15 + stretch, by + 5, 0], [5, 4.2, 4]), capsule([17 + stretch, by + 4, 0], [22 + stretch, by + 3, 0], 2.6, 1.8)), [17 + stretch, by + 4, 0], 9, flesh, 2),
        P(capsule([19 + stretch, by + 1.5, 0], [22.5 + stretch, by + 1.5, 0], 1.2), [21, by + 1.5, 0], 4, L(hdRamp(hex("#7a1c2a"))), 2),
        P(sphere([18 + stretch, by + 6, 3.4], 1), [18, by + 6, 3.4], 2, glowL(c), 2),
        P(capsule([-12 - stretch, by + 1, 0], [-18 - stretch, by + 5 + Math.sin(ph) * 2, 0], 1.5, 0.7), [-15, by + 3, 0], 7, flesh, 3),
      ];
      // four legs stepping in turn
      for (const [x, z, k] of [[-8, 3.5, 0], [8, 3.5, 2], [-8, -3.5, 3], [8, -3.5, 1]] as const) {
        const sw = state === "move" ? Math.sin(ph + (k * Math.PI) / 2) * 4 : state === "leap" ? (x < 0 ? -6 : 6) : 0;
        const foot: V3 = [x + sw + (state === "leap" ? stretch : 0), Math.max(0, air - 2) + (state === "move" ? Math.max(0, Math.cos(ph + (k * Math.PI) / 2)) * 2 : 0), z];
        parts.push(P(union(capsule([x, by - 2, z], [x + sw * 0.5, by * 0.45, z], 2.2, 1.6), capsule([x + sw * 0.5, by * 0.45, z], foot, 1.6, 1.3)), [x, by * 0.5, z], 10, (h) => L(z < 0 ? hdRamp(c.r[1]) : c.r, 0.2), 10 + k));
      }
      // spores: bulbs along its back that glow
      for (const [x, z] of [[-6, 1], [-1, -1], [4, 1.5], [0, 3]] as const) parts.push(P(sphere([x + stretch * 0.3, by + 6.2, z], 2), [x, by + 6, z], 3, glowL(c), 20));
      return parts;
    },
    shadow: (s) => [2, 0, s === "leap" ? 10 : 16, 8],
  },
  bloom_pod: {
    size: 48, states: [["idle", 4, 260], ["open", 4, 90]], alias: { closed: "idle" },
    parts: (c, state, i) => {
      const leaf = c.r, open = state === "open" ? [0.3, 0.6, 0.9, 1][i]! : state === "tell" ? 1 : 0, breathe = state === "idle" ? Math.sin((i / 4) * Math.PI * 2) * 0.6 : 0;
      const parts: Part[] = [];
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        parts.push(P(capsule([0, 2, 0], [Math.cos(a) * 13, 0.5, Math.sin(a) * 8], 2, 0.8), [Math.cos(a) * 6, 1, Math.sin(a) * 4], 9, L(hdRamp(c.P.mat.leaf[1]), 0.2), 1));
      }
      parts.push(P(capsule([0, 0, 0], [0, 9, 0], 3.4, 2.6), [0, 5, 0], 6, L(hdRamp(c.P.mat.leaf[2]), 0.2), 2));
      if (open === 0) {
        parts.push(P(ellipsoid([0, 17, 0], [9 + breathe, 10 + breathe, 9 + breathe]), [0, 17, 0], 12, (h) => L(Math.cos(Math.atan2(h.w[0], h.w[2]) * 5) > 0.85 ? hdRamp(leaf[1]) : leaf, 0.5), 3));
        parts.push(P(sphere([0, 27.5, 0], 1.4), [0, 27, 0], 2, L(hdRamp(leaf[3]), 0.5), 3));
      } else {
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2 + 0.3, d = 4 + open * 6;
          parts.push(P(ellipsoid([Math.cos(a) * d, 16 + open * 2, Math.sin(a) * d * 0.8], [6, 6.5 - open * 2, 5]), [Math.cos(a) * d, 17, Math.sin(a) * d], 9, L(leaf, 0.5), 10 + k));
        }
        parts.push(P(sphere([0, 17, 1], 4.5), [0, 17, 1], 6, L(c.r2, 0.3), 20));
        for (const [x, y] of [[-1.6, 19], [1.8, 19.5], [0, 15.5]] as const) parts.push(P(sphere([x, y, 5], 1.3), [x, y, 5], 2, glowL(c), 21));
      }
      return parts;
    },
    shadow: () => [0, 0, 14, 9],
  },
  graft: {
    size: 64, states: [["idle", 4, 260], ["move", 6, 110]],
    parts: (c, state, i) => {
      const ph = (i / (state === "move" ? 6 : 4)) * Math.PI * 2, crouch = state === "tell" ? 2 : 0;
      const skinA = c.r, skinB = hdRamp(mix(c.r[2], [150, 120, 130, 255], 0.35)), cloth = c.r2;
      const parts: Part[] = [];
      // two bodies, two heads, joined at a seam of stitches
      for (const [x, s, h, k] of [[-6.5, skinA, 1, 0], [7, skinB, 1.12, 1]] as const) {
        const bob = state === "idle" ? Math.sin(ph + k) * 0.6 : state === "move" ? Math.abs(Math.sin(ph + k)) : 0;
        const top = 30 * h - crouch + bob;
        parts.push(P(smooth(3, ellipsoid([x, top - 7, 0], [7.5 * h, 9, 6]), ellipsoid([x, top - 15, 0], [6 * h, 5, 5])), [x, top - 10, 0], 14, (hh) => (hh.w[1] < top - 13 ? L(cloth, 0.2) : L(Math.abs(hh.w[0]) < 1.2 ? hdRamp(s[0]) : s, 0.2)), 1));
        parts.push(P(ellipsoid([x * 1.08, top + 5 * h, 0.5], [4.6 * h, 5 * h, 4.6 * h]), [x, top + 5, 0], 7, L(s, 0.25), 2 + k));
        parts.push(P(sphere([x * 1.08 + 1.6, top + 5.5 * h, 4.2 * h], 0.9), [x, top + 5, 4], 2, k ? glowL(c) : L(hdRamp(c.P.outline), 0, { flat: 0 }), 2 + k));
        // its outer arm, long, hanging (raised in the tell)
        const sx = x + (k ? 8 : -8) * h, lift = state === "tell" && k ? 9 : 0;
        parts.push(P(union(capsule([sx, top - 3, 0], [sx + (k ? 2 : -2), top - 13 + lift, 2], 2.4, 2), capsule([sx + (k ? 2 : -2), top - 13 + lift, 2], [sx + (k ? 3 : -3), top - 22 + lift * 2 + (state === "move" ? Math.sin(ph) * 2 : 0), 3], 2, 2.6)), [sx, top - 12, 1], 13, L(s, 0.2), 5 + k));
        // legs
        for (const lx of [-2.6, 2.6]) {
          const step = state === "move" ? Math.sin(ph + (lx > 0 ? Math.PI : 0) + k) * 3 : 0;
          parts.push(P(capsule([x + lx, top - 17, 0], [x + lx, Math.max(0, step * 0.5) + 1.5, step], 2.6, 2.2), [x + lx, (top - 17) / 2, 0], 14, L(cloth, 0.15), 8 + k));
        }
      }
      parts.push(P(capsule([0.5, 9, 5.5], [0.5, 30, 5.5], 0.5), [0.5, 20, 5.5], 11, (h) => L(Math.floor(h.w[1]) % 3 === 0 ? hdRamp([230, 220, 200, 255]) : hdRamp(c.P.outline), 0, { flat: 2 }), 30));
      return parts;
    },
    shadow: () => [0, 0, 20, 9],
  },
  hologram: {
    size: 64, states: [["idle", 4, 160], ["move", 6, 90]],
    whole: (c, state, i) => hologramHd(c, state, i),
  },
  mine: {
    size: 32, states: [["idle", 2, 500], ["armed", 4, 120]],
    parts: (c, state, i) => {
      const lit = state === "tell" || (state === "armed" && i % 2 === 0);
      return [
        ...[0, 1, 2, 3].map((k) => P(capsule([0, 2, 0], [Math.cos(k * 1.57 + 0.78) * 11, 0.6, Math.sin(k * 1.57 + 0.78) * 9], 1), [0, 1, 0], 12, L(c.dark, 0.5), 1)),
        P(cylinder([0, 0, 0], 8, 0.5, 5, 1.6), [0, 3, 0], 9, (h) => L(Math.floor(Math.atan2(h.w[0], h.w[2]) * 3) % 2 && h.n[1] < 0.5 ? c.dark : c.r, 0.6), 2),
        P(sphere([0, 5.2, 0], 2.4), [0, 5, 0], 3, lit ? glowL(c) : L(hdRamp(mix(c.acc[0], c.P.outline, 0.5)), 0.8), 3),
      ];
    },
    shadow: () => [0, 0, 10, 8],
  },
  crane_arm: {
    size: 64, states: [["base", 1, 400], ["arm", 1, 400], ["idle", 2, 400], ["move", 6, 110]],
    names: { base: 0, arm: 1, magnet: 2 },
    parts: (c, state, i) => {
      const y0 = 12;
      if (state === "base") return [
        P(cylinderZ([0, 28, 0], 22, -6, 6), [0, 28, 0], 24, (h) => L(Math.hypot(h.w[0], h.w[1] - 28) > 19 ? c.r : Math.floor(h.w[1] / 2.5) % 2 ? c.dark : c.metal, 0.6), 1),
        P(cylinderZ([0, 28, 0], 5, -7.5, 7.5), [0, 28, 0], 9, L(hdRamp(c.r[3]), 0.9), 2),
      ];
      if (state === "arm") {
        const parts: Part[] = [P(box([0, 34, 0], [32, 1.5, 3], 0.6), [0, 34, 0], 33, L(c.r, 0.5), 1), P(box([0, 22, 0], [32, 1.5, 3], 0.6), [0, 22, 0], 33, L(hdRamp(c.r[1]), 0.5), 1)];
        for (let x = -32; x < 32; x += 10) parts.push(P(union(capsule([x, 22, 0], [x + 5, 34, 0], 0.9), capsule([x + 5, 34, 0], [x + 10, 22, 0], 0.9)), [x + 5, 28, 0], 9, L(c.r, 0.5), 2));
        return parts;
      }
      const sway = state === "move" ? Math.sin((i / 6) * Math.PI * 2) * 9 : state === "idle" ? (i ? 1.5 : -1.5) : 0;
      const parts: Part[] = [
        P(capsule([0, 62, 0], [sway, 30, 0], 0.9), [sway / 2, 46, 0], 18, (h) => L(Math.floor(h.w[1] / 2) % 2 ? c.metal : c.dark, 0.8), 1),
        P(cylinder([sway, 0, 0], 20, y0, y0 + 9, 2), [sway, y0 + 4, 0], 22, (h) => L(h.w[1] > y0 + 6 ? c.r : Math.cos(Math.atan2(h.w[0] - sway, h.w[2]) * 12) > 0.4 ? c.dark : c.metal, 0.7), 2),
        P(cylinder([sway, 0, 0], 6, y0 + 9, y0 + 13, 1), [sway, y0 + 11, 0], 8, L(c.dark, 0.7), 3),
      ];
      if (state === "tell") for (let k = 0; k < 10; k++) parts.push(P(sphere([sway + Math.cos(k * 0.63) * 21, y0 + 1, Math.sin(k * 0.63) * 21], 1.3), [sway, y0, 0], 23, glowL(c), 9, true));
      return parts;
    },
    shadow: (s) => (s === "base" || s === "arm" ? null : [0, 0, 20, 12]),
    oy: 62,
  },
};

function add(a: V3, b: V3): V3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
const cylinderZ = (c: V3, r: number, z0: number, z1: number): Sdf => (x, y, z) => {
  const d = Math.hypot(x - c[0], y - c[1]) - r, dz = Math.abs(z - (z0 + z1) / 2) - (z1 - z0) / 2;
  return Math.min(Math.max(d, dz), 0) + Math.hypot(Math.max(d, 0), Math.max(dz, 0));
};

/// A hologram: a person made of light over its projector, scan lines running down it, see-through, no outline.
function hologramHd(c: HdCtx, state: string, i: number): Img {
  const img = new Img(64, 64), a = c.acc;
  const bob = state === "move" ? Math.sin((i / 6) * Math.PI * 2) : 0, glitch = state === "idle" && i === 2 ? 24 : -9;
  const parts: Part[] = [
    P(ellipsoid([0, 46 + bob, 0.5], [5.5, 6, 5.5]), [0, 46, 0], 7, L(a)),
    P(smooth(3, ellipsoid([0, 34 + bob, 0], [7, 6, 4]), ellipsoid([0, 26 + bob, 0], [5.5, 5, 3.5])), [0, 30, 0], 10, L(a)),
    ...[-1, 1].map((s) => P(capsule([s * 7.5, 37 + bob, 0], [s * 9, 22 + bob, 2], 2.4, 1.9), [s * 8, 30, 1], 10, L(a))),
    ...[-1, 1].map((s) => P(capsule([s * 3.5, 22 + bob, 0], [s * 3.6 + (state === "move" ? Math.sin(i + s) * 2 : 0), 7 + bob, 0], 2.8, 2.2), [s * 3.5, 15, 0], 10, L(a))),
  ];
  const fig = render(parts, { w: 64, h: 64, ox: 32, oy: 58, tilt: 25, outline: a[0] }).img;
  // the projector
  const base = render([P(cylinder([0, 0, 0], 8, 0, 3, 1), [0, 1.5, 0], 10, L(c.metal, 0.8))], { w: 64, h: 64, ox: 32, oy: 58, tilt: 25, outline: c.P.outline, shadows: [[0, 0, 9, 7]] }).img;
  img.draw(base);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const p = fig.get(x, y);
    if (!p || p[3] < 200) continue;
    if (x % 2 === 0 && (y + i) % 2 === 0 && ((x >> 1) + ((y + i) >> 1)) % 2 === 0) continue;
    const sx = y === glitch || y === glitch + 1 ? x + 3 : x;
    const scan = (y + i * 2) % 4 === 0;
    const col = state === "tell" ? mix(p, WHITE, 0.4) : scan ? mix(p, a[0], 0.5) : p;
    img.set(sx, y, [col[0], col[1], col[2], scan ? 170 : 225]);
  }
  // the beam up from the projector
  for (let y = 40; y < 56; y++) for (let x = 22; x < 43; x++) if ((x + y) % 2 === 0 && Math.abs(x - 32) < 4 + (56 - y) * 0.4) img.set(x, y, [a[2][0], a[2][1], a[2][2], 40]);
  glowHd(img, (x, y) => y === 56 && x >= 26 && x <= 37, a, { reach: 2.5 });
  return img;
}

export const HD_CREATURE_NAMES = Object.keys(HD_CREATURES);

/// Every frame of a detailed archetype: its states, then "tell", then "hit".
export function hdFrames(kindName: string, c: HdCtx) {
  const kind = HD_CREATURES[kindName]!, n = kind.size, oy = kind.oy ?? n - 5;
  const frame = (state: string, i: number, shadow = true): Img => {
    if (kind.whole) return kind.whole(c, state, i);
    const sh = shadow ? kind.shadow?.(state, i) : null;
    const { img, emit } = render(kind.parts!(c, state, i), { w: n, h: n, ox: n / 2, oy, tilt: 25, outline: c.P.outline, rim: c.P.city ? c.P.accent[1][3] : undefined, shadows: sh ? [sh] : [] });
    glowHd(img, (x, y) => emit.has(x, y), c.acc, { reach: 3, strength: 0.9 });
    return img;
  };
  const frames: Img[] = [], durations: number[] = [];
  const tags: { name: string; from: number; to: number; loop?: boolean }[] = [];
  for (const [state, count, ms] of kind.states) {
    tags.push({ name: state, from: frames.length, to: frames.length + count - 1, ...(state === "fire" || state === "leap" || state === "open" ? { loop: false } : {}) });
    for (let i = 0; i < count; i++) {
      frames.push(frame(state, i));
      durations.push(ms);
    }
  }
  for (const [alias, of] of Object.entries(kind.alias ?? {})) {
    const t = tags.find((x) => x.name === of);
    if (t) tags.push({ ...t, name: alias });
  }
  // the tell: the first pose, its edge lit in the glow colour
  const first = kind.states.find(([s]) => s === "idle")?.[0] ?? kind.states[0]![0];
  const tell = frame("tell", 0);
  const edge = (x: number, y: number) => (tell.get(x, y)?.[3] ?? 0) > 200 && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => (tell.get(x + dx!, y + dy!)?.[3] ?? 0) < 100);
  const lit = new Img(n, n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (edge(x, y)) lit.set(x, y, WHITE);
  glowHd(tell, (x, y) => lit.has(x, y), c.acc, { reach: 2.5, hot: 0.2, strength: 0.8 });
  tags.push({ name: "tell", from: frames.length, to: frames.length, loop: false });
  frames.push(tell);
  durations.push(240);
  tags.push({ name: "hit", from: frames.length, to: frames.length, loop: false });
  frames.push(frame(first, 0, false).silhouette(WHITE));
  durations.push(120);
  return { frames, tags, durations, size: n, oy };
}

export { cylinderZ, union };
