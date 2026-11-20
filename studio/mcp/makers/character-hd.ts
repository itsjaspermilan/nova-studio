// character_make in the detailed style ("style": "detailed"): a body about 32x48 pixels in 64x64 frames, built as a
// little 3D figure (pix3d.ts) and drawn as pixel art in each direction and each frame: a face (eyes, brows, a nose, a
// mouth, a jaw), hands, layered clothes (a coat over a shirt, a collar, a belt), hair with volume. Draw it with
// sx = 1.5, sy = 1.5: it is then as big on the screen as a 16x24 body at 3.
//
// Animations, each facing down, left, right and up: idle 4 (breathing), walk 6 (a coat's hem trails), attack 4 (wind-up,
// a smear with the weapon's arc, the follow-through, recovery), hurt 2, roll 4.

import { colourOf, mix, ramp, type Ramp, type Rgba } from "./paint";
import { Img } from "./paint";
import { accentOf, lit, paletteOf, type Palette } from "./palettes";
import { box, capsule, cut, cylinder, ellipsoid, glowHd, hdRamp, inter, render, smooth, sphere, union, type Hit, type Look, type Part, type Sdf, type V3 } from "./pix3d";
import { writeSheet, type Put } from "./sheet";

type Args = Record<string, any>;
const WHITE: Rgba = [255, 255, 255, 255];

export const HD_DIRECTIONS = ["down", "left", "right", "up"] as const;
type Dir = (typeof HD_DIRECTIONS)[number];
const YAW: Record<Dir, number> = { down: 0, right: Math.PI / 2, left: -Math.PI / 2, up: Math.PI };
export const HD_ANIMS: [string, number, number][] = [["idle", 4, 220], ["walk", 6, 95], ["attack", 4, 70], ["hurt", 2, 140], ["roll", 4, 70]];

interface Body {
  P: Palette;
  skin: Ramp; hair: Ramp; main: Ramp; trim: Ramp; shoes: Ramp; metal: Ramp; dark: Ramp; glass: Ramp; wood: Ramp; gold: Ramp;
  glow: Ramp;
  style: string; outfit: string; hat: string; item: string;
  /// Body shape: chest width, height scale.
  wide: number; tall: number;
}

/// Where the joints are for one pose, in the figure's own frame (x to its left as we see it from the front, y up, z
/// forward), and what else the pose says.
interface Rig {
  hip: [V3, V3]; knee: [V3, V3]; ankle: [V3, V3]; toe: [V3, V3];
  shoulder: [V3, V3]; elbow: [V3, V3]; hand: [V3, V3];
  pelvis: V3; chest: V3; neck: V3; head: V3;
  /// Where a coat's hem lies (its middle, local) and how far it trails.
  hem: V3;
  /// The held item's direction from the hand (local).
  aim: V3;
  eyes: "open" | "shut";
  /// Extra pieces: a swing's arc (world points are local here), a rolled ball.
  arc?: V3[];
  smear?: V3[];
  ball?: number;
}

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const lerp = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const unit = (v: V3): V3 => {
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/// A two-bone limb: the middle joint from the ends and the bones' lengths, bent towards `bend`.
function joint(a: V3, c: V3, l1: number, l2: number, bend: V3): V3 {
  const d = Math.min(Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]), l1 + l2 - 0.01);
  const t = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - t * t));
  const dir = unit([c[0] - a[0], c[1] - a[1], c[2] - a[2]]);
  // the bend direction made square to the bone
  const dot = bend[0] * dir[0] + bend[1] * dir[1] + bend[2] * dir[2];
  const b = unit([bend[0] - dot * dir[0], bend[1] - dot * dir[1], bend[2] - dot * dir[2]]);
  return [a[0] + dir[0] * t + b[0] * h, a[1] + dir[1] * t + b[1] * h, a[2] + dir[2] * t + b[2] * h];
}

function rigOf(B: Body, anim: string, i: number): Rig {
  const T = B.tall, W = B.wide;
  let bob = 0, lean = 0, twist = 0;
  const feet: [V3, V3] = [[-3.6, 2.4, 0.6], [3.6, 2.4, 0.6]];
  let hands: [V3, V3] = [[-9 * W, 23 * T, 0.5], [9 * W, 23 * T, 0.5]];
  let aim: V3 = unit([0.15, 0.9, 0.35]);
  let hem: V3 = [0, 6.5 * T, -0.5];
  let eyes: "open" | "shut" = "open";
  let arc: V3[] | undefined, smear: V3[] | undefined, ball: number | undefined;
  if (anim === "idle") {
    bob = [0, 0.4, 0.8, 0.4][i]!; // breathing: the chest and shoulders rise
    hands = [[-9 * W, 23 * T + bob * 0.5, 0.6], [9 * W, 23 * T + bob * 0.5, 0.6]];
  } else if (anim === "walk") {
    const ph = (i / 6) * Math.PI * 2;
    for (const [k, p] of [[0, ph], [1, ph + Math.PI]] as const) {
      feet[k] = [k ? 3.4 : -3.4, 2.4 + Math.max(0, Math.sin(p + 0.9)) * 3.2, 0.6 + Math.sin(p) * 6];
    }
    bob = -Math.abs(Math.cos(ph)) * 1.2 + 0.6;
    hands = [[-8.6 * W, 23 * T, 0.5 - Math.sin(ph) * 4.5], [8.6 * W, 23 * T, 0.5 + Math.sin(ph) * 4.5]];
    lean = 0.8;
    // the coat's hem trails behind and swings with the step
    hem = [Math.sin(ph) * 1.4, 6.5 * T + Math.abs(Math.sin(ph)) * 1.2, -3 - Math.abs(Math.cos(ph)) * 1.5];
  } else if (anim === "attack") {
    // the right hand swings the item across in front: back and up, a blur, down across, and back
    const poses: [V3, V3][] = [
      [[10, 40, -3], unit([0.4, 0.9, -0.5])],
      [[6, 31, 8], unit([0.2, 0.2, 1])],
      [[-6, 24, 7], unit([-0.8, -0.3, 0.6])],
      [[8, 26, 3], unit([0.3, 0.7, 0.4])],
    ];
    const [h, d] = poses[i]!;
    hands = [[-8.5 * W, 25 * T, -1], [h[0] * W, h[1] * T, h[2]]];
    aim = d;
    lean = [-1, 2.5, 3, 1][i]!;
    twist = [0.35, -0.1, -0.35, 0][i]!;
    if (i === 1 || i === 2) {
      // the arc the swing leaves, round the body at the item's tip
      arc = [];
      const from = i === 1 ? 70 : 10, to = i === 1 ? -20 : -120;
      for (let k = 0; k <= 14; k++) {
        const a = ((from + (to - from) * (k / 14)) * Math.PI) / 180;
        arc.push([Math.cos(a) * 17, 30 * T + Math.sin(a) * 9, 7 + Math.sin(a) * 4]);
      }
      if (i === 1) smear = [[9, 38, 2], [8, 35, 6]];
    }
  } else if (anim === "hurt") {
    lean = -3;
    eyes = "shut";
    hands = [[-10 * W, 31 * T, 2], [10 * W, 32 * T, 2]];
    bob = i ? -0.5 : 0.5;
  } else if (anim === "roll") {
    ball = i;
  }
  const pelvis: V3 = [0, 23.5 * T + bob * 0.4, lean * 0.2];
  const chest: V3 = [twist * 2, 34 * T + bob, lean * 0.7];
  const neck: V3 = [twist * 2.5, 40.5 * T + bob, lean * 0.9];
  const head: V3 = [twist * 3, 46.6 * T + bob, lean * 1.1 + 0.3];
  const hip: [V3, V3] = [[-3.8, pelvis[1] - 1, pelvis[2]], [3.8, pelvis[1] - 1, pelvis[2]]];
  const ankle = feet;
  const knee: [V3, V3] = [0, 1].map((k) => joint(hip[k]!, ankle[k]!, 10.6 * T, 10.4 * T, [0, 0, 1])) as [V3, V3];
  const toe: [V3, V3] = [0, 1].map((k) => add(ankle[k]!, [0, -1.2, 3])) as [V3, V3];
  const shoulder: [V3, V3] = [[-7.4 * W + twist * 2, 38 * T + bob, chest[2] - 0.5], [7.4 * W + twist * 2, 38 * T + bob, chest[2] - 0.5]];
  const elbow: [V3, V3] = [0, 1].map((k) => joint(shoulder[k]!, hands[k]!, 8 * T, 7.6 * T, [k ? 0.4 : -0.4, -0.2, -1])) as [V3, V3];
  return { hip, knee, ankle, toe, shoulder, elbow, hand: hands, pelvis, chest, neck, head, hem, aim, eyes, arc, smear, ball };
}

// ---- the figure's parts ------------------------------------------------------------------------------------------------
const L = (ramp: Ramp, spec = 0, extra: Partial<Look> = {}): Look => ({ ramp, spec, ...extra });

function figure(B: Body, r: Rig, yaw: number): Part[] {
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  const w = (p: V3): V3 => [cs * p[0] + sn * p[2], p[1], -sn * p[0] + cs * p[2]];
  const frame = { o: [0, 0, 0] as V3, yaw };
  const parts: Part[] = [];
  const put = (sdf: Sdf, at: V3, size: number, look: Part["look"], group?: number, bare = false) => parts.push({ sdf, at, size, look, frame, group, bare });
  const longCoat = B.outfit === "long_coat" || B.outfit === "lab_coat";
  const skirt = B.outfit === "robe" || B.outfit === "dress";
  const trousers = B.outfit === "jumpsuit" || B.outfit === "suit" || skirt ? B.main : B.trim;
  const armour = B.outfit === "riot_armor" || B.outfit === "armor";
  const sleeve = B.outfit === "rags" ? B.skin : B.main;

  if (r.ball !== undefined) return ballOf(B, r.ball, yaw, put, w);

  // legs: trousers, then boots
  for (const k of [0, 1] as const) {
    const g = 10 + k;
    put(union(capsule(w(r.hip[k]), w(r.knee[k]), 3.3, 2.7), capsule(w(r.knee[k]), w(r.ankle[k]), 2.7, 2.2)), w(lerp(r.hip[k], r.ankle[k], 0.5)), 13, (h) => L(h.w[1] < 9 && armour ? B.metal : trousers, armour && h.w[1] < 9 ? 0.6 : 0), g);
    put(smooth(1, capsule(w(r.ankle[k]), w(r.toe[k]), 2.4, 2.1), sphere(w(r.ankle[k]), 2.5)), w(r.ankle[k]), 6, (h) => L(B.shoes, 0.3, h.w[1] - r.ankle[k][1] < -1.8 + (r.ankle[k][1] - 2.4) ? { flat: 3 } : {}), g);
  }
  // the body: hips and chest, with what is worn on it painted by where it is
  const torso = smooth(3, ellipsoid(w(r.pelvis), [5.6 * B.wide, 4, 3.8]), ellipsoid(w([r.chest[0], r.chest[1] - 5, r.chest[2] - 0.3]), [5.6 * B.wide, 5, 3.7]), ellipsoid(w(r.chest), [7 * B.wide, 5.5, 4.2]));
  put(torso, w(lerp(r.pelvis, r.chest, 0.5)), 14, (h) => clothes(B, h, r), 1);
  // a coat's skirt or a robe: a cone from the waist to the hem, open down the front for a coat
  if (longCoat || skirt) {
    const top: V3 = [0, r.pelvis[1] + 3, r.pelvis[2]], hem = r.hem;
    const cone = inter(capsule(w(top), w(add(hem, [0, -3, 0])), 6.2 * B.wide, (skirt ? 9 : 8.6) * B.wide), (x, y, z) => hem[1] + 0.5 - y);
    const open = longCoat ? box(w([0, (top[1] + hem[1]) / 2, 9]), [1.6, 30, 6], 0, yaw) : null;
    const shape = open ? cut(cone, open) : cone;
    put(shape, w(lerp(top, hem, 0.5)), 16, (h) => {
      if (h.w[1] < hem[1] + 1.6 && B.outfit === "long_coat") return L(B.glow, 0, { emit: true });
      if (Math.abs(h.ln[0]) > 0.8 && h.l[2] > 3) return L(B.dark); // the lining, inside the opening
      const fold = Math.sin(Math.atan2(h.l[0], h.l[2]) * 5 + h.w[1] * 0.08) > 0.6;
      return L(fold ? ([B.main[0], B.main[0], B.main[1], B.main[2], B.main[3]] as Ramp) : B.main);
    }, 1);
  }
  // arms: sleeve to the wrist, a hand; riot armour has shoulder plates
  for (const k of [0, 1] as const) {
    const g = 20 + k;
    put(union(capsule(w(r.shoulder[k]), w(r.elbow[k]), 2.9, 2.5), capsule(w(r.elbow[k]), w(r.hand[k]), 2.5, 2.1)), w(lerp(r.shoulder[k], r.hand[k], 0.5)), 12, (h) => {
      const d = Math.hypot(h.w[0] - w(r.hand[k])[0], h.w[1] - r.hand[k][1], h.w[2] - w(r.hand[k])[2]);
      if (B.outfit === "rags" && d < 6) return L(B.skin);
      return L(d < 2.6 ? B.trim : armour ? B.main : sleeve, armour ? 0.4 : 0);
    }, g);
    put(sphere(w(add(r.hand[k], [0, -0.6, 0])), 2.3), w(r.hand[k]), 3, L(B.skin), g);
    if (armour) put(ellipsoid(w(add(r.shoulder[k], [k ? 0.8 : -0.8, 1, 0])), [3.6, 2.8, 3.6]), w(r.shoulder[k]), 5, L(B.metal, 0.7), g);
  }
  // neck, head, ears, nose
  put(capsule(w(r.neck), w(add(r.neck, [0, 3, 0])), 2.3), w(r.neck), 4, L(B.skin), 30);
  const hc = w(r.head);
  put(ellipsoid(hc, [5.9, 6.5, 5.8]), hc, 8, (h) => face(B, h, r), 30);
  for (const s of [-1, 1]) put(ellipsoid(w(add(r.head, [s * 5.7, -0.6, -0.4])), [1.2, 2, 1.5]), w(add(r.head, [s * 5.7, -0.6, 0])), 3, L(B.skin), 30);
  put(sphere(w(add(r.head, [0, -1.2, 5.6])), 1.2), w(add(r.head, [0, -1.2, 5.6])), 2, L(B.skin), 30);
  hairOf(B, r, w, put, yaw);
  hatOf(B, r, w, put, yaw);
  // collars and hoods lying down
  if (longCoat || B.outfit === "jacket") {
    const n = r.neck;
    put(cut(cylinder(w(add(n, [0, 0, -0.3])), 4.8, n[1] - 1, n[1] + (longCoat ? 3.6 : 2.4), 1), union(cylinder(w(add(n, [0, 0, -0.3])), 3.4, n[1] - 3, n[1] + 6), box(w(add(n, [0, 1, 4.5])), [2.2, 5, 3], 0, yaw))), w(n), 6, (h) => L(h.w[1] > n[1] + 2.5 ? B.main : ([B.main[0], B.main[1], B.main[1], B.main[2], B.main[3]] as Ramp)), 2);
  }
  if (B.outfit === "hoodie" && B.hat !== "hood") put(ellipsoid(w(add(r.neck, [0, 0.5, -3.4])), [5.4, 3, 2.6]), w(add(r.neck, [0, 0, -3])), 6, L(B.main), 2);
  itemOf(B, r, w, put, yaw);
  // the swing's arc and smear: light, not body
  if (r.arc) r.arc.forEach((p, k) => put(sphere(w(p), k > 10 ? 1.6 : 1.1), w(p), 2.5, L(B.glow, 0, { emit: true }), 90, true));
  if (r.smear) for (const p of r.smear) put(capsule(w(r.hand[1]), w(p), 1.6), w(lerp(r.hand[1], p, 0.5)), 9, L(B.glow, 0, { alpha: 0.45, flat: 3 }), 91, true);
  return parts;
}

/// The clothes on the body: what the outfit puts where.
function clothes(B: Body, h: Hit, r: Rig): Look {
  const y = h.w[1], lx = h.l[0], front = h.ln[2] > 0.2, waist = r.pelvis[1] + 3;
  const near = (a: number, b: number) => Math.abs(a - b);
  switch (B.outfit) {
    case "long_coat":
    case "lab_coat":
      // a coat open over a shirt: lapels, then the shirt; a belt
      if (front && Math.abs(lx) < 1.6 + (r.neck[1] - y) * 0.12 && y > waist - 1) return L(B.outfit === "lab_coat" ? B.trim : B.dark);
      if (front && Math.abs(lx) < 2.6 + (r.neck[1] - y) * 0.12 && y > waist + 4) return L(B.main, 0, { flat: 3 });
      if (near(y, waist) < 0.9) return L(B.outfit === "lab_coat" ? B.main : B.trim, 0.3);
      return L(B.main);
    case "jacket":
      if (front && Math.abs(lx) < 0.6) return L(B.metal, 0.8);
      if (y < waist + 1) return L(B.trim);
      return L(B.main);
    case "hoodie":
      if (front && near(y, waist + 2) < 1.6 && Math.abs(lx) < 3.5) return L(B.main, 0, { flat: 1 });
      if (front && y > r.chest[1] + 2 && Math.abs(Math.abs(lx) - 1.8) < 0.5) return L(B.trim, 0, { flat: 4 });
      return L(B.main);
    case "jumpsuit":
      if (front && Math.abs(lx) < 0.5 && y > waist) return L(B.metal, 0.8);
      if (near(y, waist) < 0.9) return L(B.trim);
      return L(B.main);
    case "suit":
      if (front && Math.abs(lx) < 0.8 && y > waist + 1) return L(B.trim, 0.2);
      if (front && Math.abs(lx) < 2 + (y - waist) * 0.2 && y > r.chest[1]) return L(hdRampOf([228, 228, 236, 255]));
      return L(B.main);
    case "riot_armor":
    case "armor":
      if (front && near(y, r.chest[1] + 1) < 0.7 && Math.abs(lx) < 4 && B.outfit === "riot_armor") return L(B.glow, 0, { emit: true });
      if (h.ln[2] > 0.5 && y > waist + 2) return L(B.outfit === "armor" ? B.metal : B.main, 0.7);
      if (near(y, waist) < 1) return L(B.trim);
      return L(B.outfit === "armor" ? B.metal : B.main, 0.4);
    case "rags":
      if (Math.sin(lx * 1.7 + y * 0.6) > 0.85) return L(B.trim);
      if (y < waist && Math.sin(lx * 3) > 0.3) return L(B.dark);
      return L(B.main);
    default:
      // tunic, shirt, robe, dress
      if (near(y, waist) < 0.9 && B.outfit !== "shirt") return L(B.trim);
      if (B.outfit === "shirt" && front && y > r.neck[1] - 2 && Math.abs(lx) < 1.5) return L(B.skin);
      return L(B.main);
  }
}

const hdRampOf = (c: Rgba) => hdRamp(c);

/// The face, painted on the head by where it is in the head's own frame.
function face(B: Body, h: Hit, r: Rig): Look | null {
  const x = h.l[0] - r.head[0], y = h.l[1] - r.head[1], z = h.l[2] - r.head[2];
  if (z > 3.2) {
    // eyes: white, an iris, a brow above; shut is a line
    for (const s of [-1, 1]) {
      const ex = x - s * 2.4;
      if (r.eyes === "shut") {
        if (Math.abs(y + 0.2) < 0.45 && Math.abs(ex) < 1.6) return L(B.dark, 0, { flat: 0 });
      } else {
        if (Math.abs(ex) < 1.5 && y > -1.3 && y < 0.9) return Math.abs(ex - s * 0.3) < 0.75 && y < 0.6 ? L(B.dark, 0, { flat: 0 }) : L(hdRamp([238, 236, 244, 255]), 0, { flat: 3 });
      }
      if (Math.abs(ex) < 1.8 && y > 1.5 && y < 2.4) return L(B.hair, 0, { flat: 1 });
    }
    if (Math.abs(x) < 1.4 && y > -4.4 && y < -3.6) return L(B.skin, 0, { flat: 0 });
  }
  return L(B.skin);
}

function hairOf(B: Body, r: Rig, w: (p: V3) => V3, put: (s: Sdf, at: V3, size: number, l: Part["look"], g?: number) => void, yaw: number) {
  const bx = (c: V3, h: V3) => box(w(c), h, 0, yaw);
  if (B.style === "bald") return;
  const hc = r.head, look = (h: Hit): Look => {
    // strands: clusters of a darker tone running back over the head
    const strand = Math.sin(h.l[0] * 1.6 + h.w[1] * 0.4) > 0.55;
    return L(strand ? ([B.hair[0], B.hair[0], B.hair[1], B.hair[2], B.hair[3]] as Ramp) : B.hair, 0.35);
  };
  if (B.style === "mohawk") {
    put(capsule(w(add(hc, [0, 5.2, 4.5])), w(add(hc, [0, 5.2, -5.5])), 1.9, 1.4), w(add(hc, [0, 5, 0])), 8, look, 40);
    put(union(...[3, 0.5, -2, -4.5].map((z) => capsule(w(add(hc, [0, 5.5, z])), w(add(hc, [0, 9.2, z - 1.5])), 1.4, 0.5))), w(add(hc, [0, 7, -1])), 8, look, 40);
    return;
  }
  const cap = cut(ellipsoid(w(add(hc, [0, 0.8, -0.5])), [6.7, 7.2, 6.6]), union(
    bx(add(hc, [0, -2.8, 6]), [8, 4.9, 5]),
    // the face, under a fringe
    ellipsoid(w(add(hc, [0, -1.6, 4.2])), [5.2, 5.0, 4]),
    B.style === "short" || B.style === "spiky" || B.style === "mohawk" ? bx(add(hc, [0, -5.8, -2]), [8, 2.6, 8]) : bx(add(hc, [0, -30, 0]), [1, 1, 1]),
  ));
  put(cap, w(hc), 9, look, 40);
  if (B.style === "long" || B.style === "bob") put(ellipsoid(w(add(hc, [0, B.style === "long" ? -5 : -2.5, -2.8])), [6.4, B.style === "long" ? 7 : 4.4, 3.6]), w(add(hc, [0, -4, -2])), 9, look, 40);
  if (B.style === "ponytail") put(capsule(w(add(hc, [0, 1, -6])), w(add(hc, [0, -7, -8])), 2.2, 1.3), w(add(hc, [0, -3, -7])), 7, look, 40);
  if (B.style === "spiky") put(union(...[[-3, 2], [0, 3], [3, 2], [-1.5, -2], [2, -2]].map(([x, z]) => capsule(w(add(hc, [x!, 5, z!])), w(add(hc, [x! * 1.3, 9, z! - 1])), 1.6, 0.4))), w(add(hc, [0, 7, 0])), 8, look, 40);
}

function hatOf(B: Body, r: Rig, w: (p: V3) => V3, put: (s: Sdf, at: V3, size: number, l: Part["look"], g?: number) => void, _yaw: number) {
  const bx = (c: V3, h: V3) => box(w(c), h, 0, _yaw);
  const hc = r.head, h = B.hat;
  const shell = (grow: number) => ellipsoid(w(add(hc, [0, 0.4, -0.2])), [6.2 + grow, 6.8 + grow, 6.1 + grow]);
  if (h === "visor") {
    put(inter(shell(0.8), (x, y, z) => Math.abs(y - (hc[1] + 0.1)) - 1.1), w(hc), 9, (k) => (k.ln[2] > 0.15 ? L(B.glow, 0, { emit: true }) : L(B.dark, 0.6)), 41);
  } else if (h === "riot_helmet" || h === "helmet") {
    const dome = cut(shell(1.3), bx(add(hc, [0, -6.5, 0]), [9, 4.2, 9]));
    put(dome, w(hc), 10, (k) => (Math.abs(k.w[1] - (hc[1] + 4)) < 0.7 && h === "riot_helmet" ? L(B.glow, 0, { emit: true }) : L(B.dark, 0.8)), 41);
    if (h === "riot_helmet") put(inter(shell(1.8), bx(add(hc, [0, -1.5, 5]), [7, 3.4, 3])), w(add(hc, [0, -1, 5])), 8, L(B.glass, 0.9, { alpha: 0.82 }), 42);
  } else if (h === "gas_mask") {
    put(inter(shell(0.9), bx(add(hc, [0, -3.4, 4]), [7, 3, 4])), w(add(hc, [0, -3, 4])), 8, L(B.dark, 0.3), 41);
    put(cylinder(w(add(hc, [0, -4.6, 7])), 2, hc[1] - 6.5, hc[1] - 3.2, 0.6), w(add(hc, [0, -5, 7])), 4, L(B.metal, 0.8), 42);
    for (const s of [-1, 1]) put(sphere(w(add(hc, [s * 2.4, 0, 5.1])), 1.5), w(add(hc, [s * 2.4, 0, 5])), 2.5, L(B.glow, 0, { emit: true }), 43);
  } else if (h === "cyber_eye") {
    put(sphere(w(add(hc, [2.5, 0, 5.1])), 1.6), w(add(hc, [2.5, 0, 5])), 2.5, L(B.glow, 0, { emit: true }), 43);
    put(cut(sphere(w(add(hc, [2.6, 0.2, 4.8])), 2.4), sphere(w(add(hc, [2.5, 0, 5.6])), 1.5)), w(add(hc, [2.5, 0, 5])), 3.5, L(B.metal, 0.9), 42);
  } else if (h === "hood") {
    put(cut(shell(1.6), ellipsoid(w(add(hc, [0, -1.4, 6])), [4.6, 5.2, 4])), w(hc), 10, L(B.main), 41);
  } else if (h === "cap") {
    put(cut(shell(0.7), bx(add(hc, [0, -4, 0]), [9, 5, 9])), w(hc), 9, L(B.trim), 41);
    put(box(w(add(hc, [0, 1.3, 7])), [4.2, 0.6, 3], 0.5, _yaw), w(add(hc, [0, 1, 7])), 6, L(B.trim), 41);
  } else if (h === "bandana") {
    put(inter(shell(0.6), (x, y, z) => Math.abs(y - (hc[1] + 2.6)) - 1.3), w(hc), 9, L(B.main), 41);
  } else if (h === "crown") {
    put(cut(cylinder(w(add(hc, [0, 0, -0.3])), 5, hc[1] + 4, hc[1] + 8, 0.5), cylinder(w(add(hc, [0, 0, -0.3])), 4, hc[1], hc[1] + 10)), w(add(hc, [0, 6, 0])), 7, L(B.gold, 0.9), 41);
  } else if (h === "wizard") {
    put(capsule(w(add(hc, [0, 4, -0.5])), w(add(hc, [0, 15, -3])), 6.5, 0.6), w(add(hc, [0, 9, -1])), 9, L(B.main), 41);
  }
}

function itemOf(B: Body, r: Rig, w: (p: V3) => V3, put: (s: Sdf, at: V3, size: number, l: Part["look"], g?: number) => void, yaw: number) {
  const hand = r.hand[1], d = r.aim, at = (t: number): V3 => add(hand, [d[0] * t, d[1] * t, d[2] * t]);
  switch (B.item) {
    case "baton":
      put(capsule(w(at(-2)), w(at(3)), 1.2), w(at(0)), 4, L(B.dark, 0.4), 50);
      put(capsule(w(at(3)), w(at(14)), 1), w(at(8)), 7, L(B.glow, 0, { emit: true }), 50);
      break;
    case "pipe":
      put(capsule(w(at(-2)), w(at(14)), 1.4), w(at(6)), 9, L(B.wood.map((c, i) => mix(c, B.metal[i]!, 0.4)) as Ramp, 0.6), 50);
      put(sphere(w(at(14)), 2.2), w(at(14)), 3, L(B.metal, 0.9), 50);
      break;
    case "sword":
      put(capsule(w(at(-2)), w(at(1.5)), 1), w(at(0)), 3, L(B.wood), 50);
      put(box(w(at(2)), [3, 0.6, 0.6], 0.3, yaw), w(at(2)), 4, L(B.gold, 0.8), 50);
      put(capsule(w(at(2.5)), w(at(15)), 1.1, 0.4), w(at(9)), 8, L(B.metal, 1), 50);
      break;
    case "axe":
    case "staff":
    case "spear":
      put(capsule(w(at(-3)), w(at(15)), 0.9), w(at(6)), 10, L(B.wood), 50);
      if (B.item === "axe") put(ellipsoid(w(at(13)), [3.5, 3, 0.8]), w(at(13)), 4, L(B.metal, 1), 50);
      if (B.item === "spear") put(capsule(w(at(15)), w(at(19)), 1.2, 0.2), w(at(17)), 3, L(B.metal, 1), 50);
      if (B.item === "staff") put(sphere(w(at(16)), 2), w(at(16)), 3, L(B.glow, 0, { emit: true }), 50);
      break;
    case "pistol": {
      const g: V3 = d[1] > 0.5 ? unit([0, -0.3, 1]) : d;
      const p = (t: number): V3 => add(hand, [g[0] * t, g[1] * t, g[2] * t]);
      put(union(capsule(w(p(0)), w(p(6)), 1.2), capsule(w(add(hand, [0, -0.5, 0])), w(add(hand, [0, -3, -0.5])), 0.9)), w(p(3)), 5, L(B.dark, 0.8), 50);
      break;
    }
    case "rifle":
      put(union(capsule(w(at(-6)), w(at(4)), 1.6, 1.4), capsule(w(at(4)), w(at(13)), 0.8)), w(at(3)), 11, (h) => L(h.w[1] < hand[1] && d[1] > 0 ? B.wood : B.dark, 0.7), 50);
      break;
    case "shield": {
      const c = add(r.hand[0], [0, 3, 3.5]);
      put(box(w(c), [5.5, 9, 0.8], 0.8, yaw), w(c), 11, (h) => (Math.abs(h.w[1] - (c[1] + 4)) < 0.8 && h.ln[2] > 0.5 ? L(B.glow, 0, { emit: true }) : L(B.glass, 0.9, { alpha: 0.88 })), 50);
      break;
    }
    case "bottle":
      put(union(capsule(w(at(0)), w(at(4)), 1.8), capsule(w(at(4)), w(at(7)), 0.8)), w(at(3)), 6, L(hdRamp([90, 160, 90, 255]), 1, { alpha: 0.9 }), 50);
      put(sphere(w(at(8)), 1.1), w(at(8)), 2, L(hdRamp([240, 160, 70, 255]), 0, { emit: true }), 50);
      break;
  }
}

/// The roll: the body tucked into a ball that turns over, head and knees and boots on it.
function ballOf(B: Body, i: number, yaw: number, put: (s: Sdf, at: V3, size: number, l: Part["look"], g?: number, bare?: boolean) => void, w: (p: V3) => V3): Part[] {
  const parts: Part[] = [];
  const add2 = (s: Sdf, at: V3, size: number, l: Part["look"], g?: number) => parts.push({ sdf: s, at, size, look: l, frame: { o: [0, 0, 0], yaw }, group: g });
  void put;
  const a = (i / 4) * Math.PI * 2, c: V3 = [0, 10.5, 0];
  const on = (ang: number, r: number, side = 0): V3 => [side, c[1] + Math.cos(a + ang) * r, c[2] + Math.sin(a + ang) * r];
  add2(ellipsoid(w(c), [8.5, 9.5, 9.5]), w(c), 11, (h) => {
    const band = Math.sin(Math.atan2(h.l[1] - c[1], h.l[2]) * 3 - a) > 0.75;
    return L(band ? ([B.main[0], B.main[0], B.main[1], B.main[2], B.main[3]] as Ramp) : B.main);
  }, 1);
  add2(sphere(w(on(0.4, 8.5)), 5.2), w(on(0.4, 8.5)), 7, (h) => L(h.ln[1] > -0.2 ? B.hair : B.skin), 2);
  for (const s of [-1, 1]) add2(capsule(w(on(2.6, 7.5, s * 3)), w(on(3.2, 8.5, s * 3)), 2.4), w(on(2.9, 8, s * 3)), 6, L(B.shoes, 0.3), 3);
  if (B.outfit === "long_coat") add2(capsule(w(on(4.6, 9.2, -5)), w(on(4.6, 9.2, 5)), 1), w(on(4.6, 9.2)), 7, L(B.glow, 0, { emit: true }), 4);
  return parts;
}

/// `character_make` with `"style": "detailed"`.
export function makeCharacterHd(name: string, a: Args, put: Put, lists: { hair: string[]; outfits: string[]; hats: string[]; items: string[]; builds: string[]; skins: Record<string, string>; colours: Record<string, string> }) {
  if (a.size !== undefined && String(a.size).replace(/\s/g, "") !== "32x48") throw new Error(`"size": the detailed style draws one size, a 32x48 body in 64x64 frames (leave "size" out)`);
  const one = (v: unknown, all: string[], what: string, fallback: string): string => {
    const s = v === undefined || v === null ? fallback : String(v).trim().toLowerCase();
    if (!all.includes(s)) throw new Error(`"${what}" is one of ${all.join(", ")} (got '${v}')`);
    return s;
  };
  const P = paletteOf(a.palette);
  const warm = P.city ? mix(P.accent[0][2], WHITE, 0.6) : mix(P.light, WHITE, 0.5);
  const R = (c: Rgba) => hdRamp(lit(P, c), warm);
  const outfit = one(a.outfit, lists.outfits, "outfit", "tunic");
  const build = one(a.build, lists.builds, "build", "normal");
  const skinText = String(a.skin ?? "light").trim().toLowerCase();
  const B: Body = {
    P,
    skin: R(colourOf(lists.skins[skinText] ?? a.skin, `"skin" (${Object.keys(lists.skins).join(", ")}, or a colour)`)),
    hair: R(colourOf(a.hair_color ?? a.hair_colour, '"hair_color"', "brown")),
    main: R(colourOf(a.outfit_color ?? a.outfit_colour, '"outfit_color"', lists.colours[outfit] ?? (outfit === "armor" ? "red" : "green"))),
    trim: R(colourOf(a.trim_color ?? a.trim_colour, '"trim_color"', "brown")),
    shoes: R(colourOf(a.shoe_color ?? a.shoe_colour, '"shoe_color"', "#3a2c26")),
    metal: hdRamp(lit(P, P.mat.metal[2]), warm),
    dark: hdRamp(lit(P, mix(P.mat.metal[1], P.outline, 0.45)), warm),
    glass: hdRamp(lit(P, P.mat.glass[2]), warm),
    wood: hdRamp(lit(P, P.mat.trunk[2]), warm),
    gold: hdRamp(lit(P, P.mat.gold[2]), warm),
    glow: accentOf(P, a.glow_color ?? a.glow_colour, '"glow_color"') ?? P.accent[0],
    style: one(a.hair, lists.hair, "hair", "short"),
    outfit,
    hat: one(a.hat, lists.hats, "hat", "none"),
    item: one(a.item, lists.items, "item", "sword"),
    wide: build === "slim" ? 0.86 : build === "stout" ? 1.2 : 1,
    tall: build === "small" ? 0.86 : 1,
  };
  if (B.hat === "mohawk") [B.style, B.hat] = ["mohawk", "none"];
  const rim = P.city ? P.accent[1][3] : undefined;
  const frames: Img[] = [];
  const tags: { name: string; from: number; to: number; loop?: boolean }[] = [];
  const durations: number[] = [];
  for (const dir of HD_DIRECTIONS) {
    for (const [anim, count, ms] of HD_ANIMS) {
      tags.push({ name: `${anim}_${dir}`, from: frames.length, to: frames.length + count - 1, ...(anim === "attack" || anim === "hurt" || anim === "roll" ? { loop: false } : {}) });
      for (let i = 0; i < count; i++) {
        const r = rigOf(B, anim, i);
        // the roll moves the body forward through its frames; everything else stays on its feet
        const { img, emit } = render(figure(B, r, YAW[dir]), { w: 64, h: 64, ox: 32, oy: 60, tilt: 25, outline: P.outline, rim, shadows: [[0, 0.5, r.ball !== undefined ? 9 : 8, 5]] });
        glowHd(img, (x, y) => emit.has(x, y), B.glow, { reach: 2.6, strength: 0.7, hot: 0.45 });
        frames.push(img);
        durations.push(ms);
      }
    }
  }
  const hitbox = { x: 25, y: 53, w: 14, h: 8 };
  const pivot = { x: 32, y: 61 };
  const made = writeSheet(name, { frames, tags, durations, hitbox, pivot }, put);
  return {
    text: [
      made.text,
      `the detailed style: a 32x48 body in 64x64 frames (draw it at sx = 1.5, sy = 1.5: as big on the screen as a 16x24 body at 3): ${build} build, ${skinText} skin, ${B.style} hair, ${outfit}, hat ${B.hat}, item ${B.item}; palette "${P.name}"`,
      `animations, each facing down, left, right and up: idle_<dir> (4, breathing), walk_<dir> (6), attack_<dir> (4: wind-up, smear, follow-through, recovery; plays once), hurt_<dir> (2, once), roll_<dir> (4, once)`,
      `In its entity: sprite = "${name}", anim = "idle_down", pivot = { 0.5, ${Math.round((pivot.y / 64) * 1000) / 1000} }, hitbox = { -7, -8, 14, 8 }, sx = 1.5, sy = 1.5; then self:play("walk_" .. dir). The same pivot and hitbox are in the .sprite.json.`,
    ].join("\n"),
    picture: made.picture,
  };
}

export { ramp };
