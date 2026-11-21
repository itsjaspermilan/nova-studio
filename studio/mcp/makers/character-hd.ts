// character_make in the detailed style ("style": "detailed"): a bold cartoon figure about 44x64 pixels in 96x96 frames,
// drawn with sx = 1.5 (96 units high on the screen: a third more than the first detailed kit). Heroic-cartoon
// proportions: a head a quarter of the height so the face reads, a strong shoulder line, a clear waist, thick limbs,
// big hands and boots. Built as a little 3D figure (pix3d.ts's shapes) and drawn by toon.ts: hard cel shading in three
// tones and a spec, a two-pixel outline where it meets the ground, one neon rim on the right-hand edge, no soft tones.
// The face is drawn on as pixels (eyes, brows, a mouth that changes with what the figure is doing), so it stays crisp.
//
// Animations, each facing down, left, right and up: idle 4 (weight shift, coat sway), walk 6 (bounce, counter-swinging
// arms), attack 4 (anticipation, a smear with the neon arc, overshoot, settle), hurt 2 (a squash), roll 5 (a tumbling
// figure with a motion streak), tell 2 (wound up to strike, then the same with an accent flash).

import { colourOf, hex, Img, mix, ramp, type Ramp, type Rgba } from "./paint";
import { accentOf, lit, paletteOf, type Palette } from "./palettes";
import { box, capsule, cut, cylinder, ellipsoid, glowHd, inter, smooth, sphere, union, type Hit, type Look, type Sdf, type V3 } from "./pix3d";
import { flashRing, glowInside, stamp, streak, toon, toonRamp, type TPart, type Xf } from "./toon";
import { writeSheet, type Put } from "./sheet";

type Args = Record<string, any>;
const WHITE: Rgba = [255, 255, 255, 255];

export const HD_DIRECTIONS = ["down", "left", "right", "up"] as const;
type Dir = (typeof HD_DIRECTIONS)[number];
const YAW: Record<Dir, number> = { down: 0, right: Math.PI / 2, left: -Math.PI / 2, up: Math.PI };
/// Name, frames, and how long each frame shows.
export const HD_ANIMS: [string, number, number[]][] = [
  ["idle", 4, [220, 180, 220, 180]],
  ["walk", 6, [95, 95, 95, 95, 95, 95]],
  ["attack", 4, [130, 50, 80, 120]],
  ["hurt", 2, [90, 170]],
  ["roll", 5, [56, 56, 56, 56, 56]],
  ["tell", 2, [100, 100]],
  // (last, so that the frames of every other animation keep their numbers)
  ["run", 8, [45, 45, 45, 45, 45, 45, 45, 45]],
  // (after the run, for the same reason: a low lunge with a wide, flat slash; 0.37 s in all, once)
  ["dash_attack", 4, [50, 70, 110, 140]],
];
/// The frame, where the feet stand in it, and the feet's box (unchanged from the first detailed kit, so rooms and
/// collisions stay as they were).
export const HD_FRAME = 96;
const OX = 48, OY = 86;
export const HD_PIVOT = { x: 48, y: 87 };
export const HD_HITBOX = { x: 41, y: 79, w: 14, h: 8 };

// What the detailed style draws besides the classic parts.
export const HD_OUTFITS_MORE = ["loud_suit", "bellhop", "vest", "scrubs", "utility", "tank_top"];
export const HD_HATS_MORE = ["goggles", "hard_hat", "shades", "fedora", "bellhop_cap", "eyeshade", "surgical"];
export const HD_ITEMS_MORE = ["wrench", "scalpel", "tray", "ledger", "mine"];
export const HD_SKINS_MORE: Record<string, string> = { chrome: "#b9c3d2" };
export const STANCES = ["upright", "hunched", "lanky", "heavy", "proud"];
export const POSES = ["low", "shoulder", "cocked", "wide", "guard", "aim"];
export const EXPRESSIONS = ["neutral", "smirk", "grin", "scowl", "smile"];
export const VISORS = ["up", "down"];
export const ARM_COUNTS = [2, 4, 6];

/// Neon Undertow's people as character_make recipes (add "name" and "style": "detailed"): the runner and an enemy of
/// every archetype, each with a silhouette of its own. docs/mcp.md lists them; the tests make every one.
export const HD_ARCHETYPES: Record<string, Args> = {
  runner: { palette: "gutter market", outfit: "long_coat", outfit_color: "#6c6488", trim_color: "#2c2a3a", hat: "visor", hair: "short", hair_color: "#4a3a5c", skin: "tan", item: "baton", glow_color: "2", shoe_color: "#2a2630", expression: "smirk" },
  scrapper: { palette: "gutter market", outfit: "hoodie", outfit_color: "#8a3040", trim_color: "#34323a", hair: "mohawk", hair_color: "#ff7a2e", skin: "light", item: "pipe", glow_color: "1", stance: "hunched", pose: "shoulder", expression: "grin" },
  bottle_thrower: { palette: "gutter market", outfit: "tank_top", outfit_color: "#e0d8c0", trim_color: "#4a4458", hat: "bandana", hat_color: "#d03040", hair: "long", hair_color: "#2a2028", skin: "brown", item: "bottle", stance: "lanky", pose: "cocked", expression: "grin", glow_color: "1" },
  tout: { palette: "gutter market", outfit: "loud_suit", outfit_color: "#e0487a", trim_color: "#f0c040", hat: "fedora", hat_color: "#3a2a4a", skin: "pale", item: "none", pose: "wide", expression: "grin", hologram: true, glow_color: "2" },
  shieldbearer: { palette: "hollow line", outfit: "riot_armor", outfit_color: "#4a5262", trim_color: "#2a2a30", hat: "riot_helmet", item: "shield", stance: "heavy", pose: "guard", expression: "scowl", glow_color: "1" },
  marksman: { palette: "hollow line", outfit: "jacket", outfit_color: "#5a4a3a", trim_color: "#2e2a28", hat: "cyber_eye", hair: "ponytail", hair_color: "#c8c0b0", skin: "light", item: "rifle", stance: "lanky", pose: "aim", expression: "scowl", glow_color: "2" },
  sapper: { palette: "hollow line", outfit: "utility", outfit_color: "#6a6040", trim_color: "#3a3428", hat: "goggles", hair: "spiky", hair_color: "#e05a20", skin: "tan", item: "mine", stance: "hunched", pose: "cocked", expression: "grin", glow_color: "1" },
  engineer: { palette: "hollow line", outfit: "jumpsuit", outfit_color: "#c4682c", trim_color: "#3a3a40", hat: "hard_hat", hair: "short", hair_color: "#2a2020", skin: "dark", item: "wrench", stance: "heavy", pose: "shoulder", glow_color: "1" },
  splicer: { palette: "bloom labs", outfit: "scrubs", outfit_color: "#3f8a86", trim_color: "#2a3a3a", hat: "surgical", skin: "pale", item: "scalpel", arms: 6, stance: "hunched", pose: "wide", expression: "scowl", glow_color: "1" },
  concierge: { palette: "spire", outfit: "bellhop", outfit_color: "#b02a3a", trim_color: "#2a2430", hat: "bellhop_cap", hair: "bald", skin: "chrome", item: "tray", stance: "proud", pose: "guard", expression: "smile", glow_color: "2" },
  accountant: { palette: "spire", outfit: "vest", outfit_color: "#3e4a5e", trim_color: "#2c2c38", hat: "eyeshade", hair: "bob", hair_color: "#5a4030", skin: "pale", item: "ledger", build: "slim", pose: "low", expression: "smirk", glow_color: "1" },
  black_suit: { palette: "spire", outfit: "suit", outfit_color: "#1e1e26", trim_color: "#8a1e2a", hat: "shades", hair: "short", hair_color: "#1a1a20", skin: "brown", item: "pistol", stance: "proud", pose: "low", glow_color: "1" },
};

// groups: parts of one group get no line between them
const G = { legL: 10, legR: 11, torso: 1, coat: 2, collar: 3, armL: 20, armR: 21, extra: 24, head: 30, hair: 40, hat: 41, hat2: 42, item: 50, item2: 51 };

interface Body {
  P: Palette;
  skin: Ramp; hair: Ramp; main: Ramp; trim: Ramp; shoes: Ramp; metal: Ramp; dark: Ramp; glass: Ramp; wood: Ramp; gold: Ramp; white: Ramp; shirt: Ramp;
  glow: Ramp;
  /// The headgear's own colour, when given.
  hatc: Ramp | null;
  style: string; outfit: string; hat: string; item: string;
  stance: string; pose: string; expression: string; visor: string; arms: number; hologram: boolean; chrome: boolean;
  W: number; T: number;
}

type Eyes = "bean" | "shock" | "squeeze" | "narrow";
type Brows = "neutral" | "angry" | "shock" | "worried" | "smirk";
type Mouth = "neutral" | "smirk" | "grin" | "scowl" | "smile" | "grit" | "yell" | "shock";

/// One pose: joints in the figure's frame (x across, y up, z forward; the held item is in hand 1, at +x).
interface Rig {
  hip: [V3, V3]; knee: [V3, V3]; ankle: [V3, V3];
  shoulder: [V3, V3]; elbow: [V3, V3]; hand: [V3, V3];
  extra: { shoulder: V3; elbow: V3; hand: V3 }[];
  pelvis: V3; waist: V3; chest: V3; neck: V3; head: V3;
  /// The middle of a coat's hem.
  hem: V3;
  /// The held item's direction from its hand, and the other hand's (a rifle's fore grip, a shield).
  aim: V3;
  open: boolean;
  eyes: Eyes; brows: Brows; mouth: Mouth;
  xf: Omit<Xf, "yaw">;
  /// The swing's arc: the item's tip along it, from tail to head.
  arc?: V3[];
  arcWidth?: number;
  hideItem?: boolean;
  streak?: boolean;
  flash?: boolean;
  noFace?: boolean;
}

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const lerp = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const unit = (v: V3): V3 => {
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const mirror = (v: V3): V3 => [-v[0], v[1], v[2]];

/// A two-bone limb: the middle joint from the ends and the bones' lengths, bent towards `bend`.
function joint(a: V3, c: V3, l1: number, l2: number, bend: V3): V3 {
  const d = Math.min(Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]), l1 + l2 - 0.01);
  const t = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - t * t));
  const dir = unit(sub(c, a));
  const dot = bend[0] * dir[0] + bend[1] * dir[1] + bend[2] * dir[2];
  const b = unit([bend[0] - dot * dir[0], bend[1] - dot * dir[1], bend[2] - dot * dir[2]]);
  return [a[0] + dir[0] * t + b[0] * h, a[1] + dir[1] * t + b[1] * h, a[2] + dir[2] * t + b[2] * h];
}

/// Turns a point about the vertical through the pelvis by `a`, more the higher it is (a twist of the upper body).
function twisted(p: V3, a: number, from: number, to: number): V3 {
  const k = Math.max(0, Math.min(1, (p[1] - from) / (to - from))) * a;
  const c = Math.cos(k), s = Math.sin(k);
  return [c * p[0] + s * p[2], p[1], -s * p[0] + c * p[2]];
}

interface Spec {
  bob?: number; lean?: number; twist?: number; sway?: number; crouch?: number; headTilt?: number;
  feet?: [V3, V3]; hands?: [V3, V3]; aim?: V3; hem?: V3; open?: boolean;
  eyes?: Eyes; brows?: Brows; mouth?: Mouth; xf?: Omit<Xf, "yaw">;
  extraSwing?: number;
}

/// The figure's rest: where its joints are standing still, by stance and build.
function rest(B: Body) {
  const T = B.T, W = B.W;
  const s = { pelvis: 27 * T, waist: 32.5 * T, chest: 39.5 * T, shoulderY: 44 * T, neck: 46.6 * T, hipX: 4.7 * W, footX: 5.4 * W, shoulderX: 11.6 * W, hunch: 0, proud: 0 };
  if (B.stance === "hunched") s.hunch = 1;
  if (B.stance === "proud") s.proud = 1;
  return s;
}

/// The hands at rest for the figure's pose (the item's hand is 1), and which way the item points.
function poseHands(B: Body, R: ReturnType<typeof rest>): { hands: [V3, V3]; aim: V3; open: boolean } {
  const W = B.W, T = B.T, sy = R.shoulderY;
  switch (B.pose) {
    case "shoulder":
      return { hands: [[-13 * W, 26 * T, 1.5], [8.5 * W, sy + 1, 4]], aim: unit([0.25, 0.55, -0.8]), open: false };
    case "cocked":
      return { hands: [[-12 * W, 30 * T, 4], [12 * W, sy + 8, -4]], aim: unit([0.1, 0.9, -0.3]), open: false };
    case "wide":
      return { hands: [[-20 * W, sy - 1, 4], [20 * W, sy, 4]], aim: unit([0.6, 0.6, 0.4]), open: true };
    case "guard":
      return { hands: [[-4 * W, 36 * T, 11], [5 * W, 34 * T, 10]], aim: unit([0.1, 0.95, 0.25]), open: false };
    case "aim":
      return { hands: [[-1.5 * W, 37 * T, 12.5], [3 * W, 37 * T, 9]], aim: unit([0, 0.05, 1]), open: false };
    default:
      return { hands: [[-12.6 * W, 26.5 * T, 1.5], [12.6 * W, 27 * T, 4]], aim: unit([0.25, -0.5, 0.85]), open: false };
  }
}

/// The joints of one pose from what moves in it.
function build(B: Body, k: Spec): Rig {
  const R = rest(B);
  const T = B.T, W = B.W;
  const bob = k.bob ?? 0, lean = k.lean ?? 0, sway = k.sway ?? 0, crouch = k.crouch ?? 0;
  const hunchZ = R.hunch * 3, hunchY = R.hunch * 2;
  const def = poseHands(B, R);
  const feet = k.feet ?? [[-R.footX, 3.6, 1], [R.footX, 3.6, 1]];
  const pelvis: V3 = [sway, R.pelvis + bob - crouch - hunchY, 0.2 * lean];
  const waist: V3 = [sway * 0.6, R.waist + bob - crouch - hunchY, 0.5 * lean + hunchZ * 0.4 + R.proud * 0.6];
  const chest: V3 = [sway * 0.2, R.chest + bob - crouch - hunchY * 0.8, 0.8 * lean + hunchZ + R.proud * 1.5];
  const neck: V3 = [0, R.neck + bob - crouch - hunchY * 1.6, 1 * lean + hunchZ * 1.7 - R.proud * 0.6];
  const head: V3 = [0, neck[1] + 9.4 + (k.headTilt ?? 0) * 0.3, neck[2] + 0.6 + (k.headTilt ?? 0) + R.hunch * 2.5 - R.proud * 0.6];
  const shoulderY = R.shoulderY + bob - crouch - hunchY * 1.1 + R.proud * 0.4;
  let shoulder: [V3, V3] = [[-R.shoulderX, shoulderY, chest[2] - 0.6], [R.shoulderX, shoulderY, chest[2] - 0.6]];
  let hands = k.hands ?? def.hands.map((h) => add(h, [0, bob - crouch - hunchY, R.hunch * 2])) as [V3, V3];
  // the upper body twists (a swing)
  const tw = k.twist ?? 0;
  const turn = (p: V3) => twisted(p, tw, R.pelvis, R.shoulderY);
  shoulder = shoulder.map(turn) as [V3, V3];
  hands = hands.map((h) => twisted(h, tw * 0.7, R.pelvis - 6, R.shoulderY)) as [V3, V3];
  const hip: [V3, V3] = [[-R.hipX + sway, pelvis[1] - 1.6, pelvis[2]], [R.hipX + sway, pelvis[1] - 1.6, pelvis[2]]];
  const legLen = (R.pelvis - 1.6 - 3.6) / 2 + 0.25;
  const knee: [V3, V3] = [0, 1].map((i) => joint(hip[i]!, feet[i]!, legLen, legLen, [0, 0, 1])) as [V3, V3];
  const armA = 9 * T, armB = 8.4 * T;
  const elbow: [V3, V3] = [0, 1].map((i) => joint(shoulder[i]!, hands[i]!, armA, armB, [i ? 0.5 : -0.5, -0.3, -1])) as [V3, V3];
  // more arms (a Splicer's): lower down the body, splayed, each a little behind the one above
  const extra: Rig["extra"] = [];
  for (let n = 1; n < B.arms / 2; n++) for (const s of [-1, 1]) {
    const sh: V3 = turn([s * (R.shoulderX - 1.5 * n) , shoulderY - 5 * n, chest[2] - 1]);
    const sw = Math.sin((k.extraSwing ?? 0) + n * 1.7 + (s > 0 ? 0 : Math.PI)) * 3;
    const hd: V3 = turn([s * (19 + 2 * n) * W, shoulderY - 6 * n + sw, 6 + sw]);
    extra.push({ shoulder: sh, hand: hd, elbow: joint(sh, hd, armA * 0.9, armB * 0.9, [0, -1, -0.3]) });
  }
  return {
    hip, knee, ankle: feet, shoulder, elbow, hand: hands, extra,
    pelvis, waist: turn(waist), chest: turn(chest), neck: turn(neck), head: turn(head),
    hem: k.hem ?? [sway * 1.5, 9 * T, -0.8],
    aim: k.aim ?? def.aim, open: k.open ?? def.open,
    eyes: k.eyes ?? "bean", brows: k.brows ?? (B.expression === "scowl" ? "angry" : B.expression === "smirk" ? "smirk" : "neutral"),
    mouth: k.mouth ?? (B.expression as Mouth),
    xf: k.xf ?? {},
  };
}

/// Whether the item swings (a gun is fired and a shield or tray bashes instead).
const swings = (B: Body) => !["pistol", "rifle", "shield", "tray", "none"].includes(B.item);

/// The pose of one frame of one animation.
function rigOf(B: Body, anim: string, i: number): Rig {
  const R = rest(B), T = B.T, W = B.W;
  const def = poseHands(B, R);
  const held = B.pose === "shoulder" || B.pose === "cocked" || B.pose === "guard" || B.pose === "aim" || B.pose === "wide";
  if (anim === "idle") {
    // weight onto one foot and back: the hips go over, the shoulders counter, the coat sways after
    const sway = [-1.1, -0.5, 1.1, 0.5][i]!, breathe = [0, 0.5, 0.2, 0.7][i]!;
    const feet: [V3, V3] = [[-R.footX, 3.6, 1], [R.footX, 3.6, 1]];
    return build(B, { sway, bob: breathe * 0.4, feet, hem: [-sway * 1.2 + [0, 0.6, 0, -0.6][i]!, 9 * T, -0.8], hands: def.hands.map((h, k) => add(h, [sway * 0.4, breathe * 0.6 + R.hunch * 0 - (R.hunch ? 2 : 0), B.pose === "wide" ? [0, 1, 0, -1][i]! * (k ? 1 : -1) : 0])) as [V3, V3] });
  }
  if (anim === "walk") {
    const ph = (i / 6) * Math.PI * 2;
    const feet = [0, 1].map((k) => {
      const p = ph + k * Math.PI;
      return [k ? R.footX : -R.footX, 3.6 + Math.max(0, Math.cos(p)) * 4, 1 + Math.sin(p) * 7.5] as V3;
    }) as [V3, V3];
    const bob = -2 * Math.cos(2 * ph) + 0.3;
    const swingZ = (k: number) => -Math.sin(ph + k * Math.PI) * 7;
    const hands = def.hands.map((h, k) => (held && (k === 1 || B.pose === "aim" || B.pose === "guard" || B.pose === "wide") ? add(h, [0, bob * 0.5, 0]) : add(h, [k ? -0.6 : 0.6, Math.abs(swingZ(k)) * 0.25, swingZ(k)]))) as [V3, V3];
    return build(B, { bob, lean: 1.6, feet, hands, hem: [Math.sin(ph) * 1.6, 9 * T + Math.abs(Math.sin(ph)) * 1.4, -3.5 - Math.abs(Math.cos(ph)) * 1.5], extraSwing: ph });
  }
  if (anim === "run") {
    // a sprint: the body leans into it, a long stride with a frame in the air (both feet off the ground, the legs split), knees driving,
    // arms pumping against the legs, the item trailing, the coat streaming out behind. A cycle is 8 frames of 45 ms: at 235 world units
    // a second the feet then keep step with the ground (a stride of 14 pixels each way, drawn at 1.5)
    const ph = (i / 8) * Math.PI * 2;
    const feet = [0, 1].map((k) => {
      const p = ph + k * Math.PI;
      return [k ? R.footX : -R.footX, 3.6 + Math.max(0, Math.cos(p) + 0.55) * 10, 1 + Math.sin(p) * 15] as V3;
    }) as [V3, V3];
    const bob = -3.8 * Math.cos(2 * ph) + 1.8;
    // arms bent hard: the hand comes up to the chest forwards and goes back past the hip
    const hands = def.hands.map((h, k) => {
      const s = -Math.sin(ph + k * Math.PI);
      const base: V3 = [h[0] * 0.8, 28 * T + Math.max(0, s) * 11, 0];
      return add(base, [0, bob * 0.5, 5 + s * 11]);
    }) as [V3, V3];
    const aim = B.item === "none" ? def.aim : unit([0.15, -0.55, -0.8]);
    return build(B, {
      bob, lean: 10.5, headTilt: -1.2, feet, hands, aim, twist: Math.cos(ph) * 0.22,
      hem: [Math.sin(ph) * 4, 15 + Math.abs(Math.cos(ph)) * 3, -14 - Math.abs(Math.sin(ph)) * 4],
      eyes: "narrow", brows: "angry", mouth: "grit", extraSwing: ph * 2,
      xf: { sy: 1 + 0.02 * Math.cos(2 * ph), sx: 1 - 0.015 * Math.cos(2 * ph) },
    });
  }
  if (anim === "attack" || anim === "tell") {
    const tell = anim === "tell";
    if (!swings(B)) {
      // a gun: raise, fire (a flash at the muzzle), kick, settle; a shield or a tray: pull back, bash, hold, settle
      const gun = B.item === "pistol" || B.item === "rifle";
      const f = tell ? 0 : i;
      const pull = [-3, 4, 2.5, 0.8][f]!;
      const hands: [V3, V3] = gun
        ? [[-1.5 * W, 38 * T, 12 + pull * 0.4], [3 * W, 38 * T + (f === 2 ? 2 : 0), 9 + pull * 0.6]]
        : B.pose === "wide" || B.item === "none"
          ? [[-11 * W, 36 * T, 8 + pull * 1.4], [11 * W, 37 * T, 8 + pull * 1.6]]
          : [[-4 * W, 35 * T, 10 + pull * 1.5], [5 * W, 34 * T, 9 + pull * 1.5]];
      const rig = build(B, {
        lean: gun ? [-1, 0, -2.5, 0][f]! : pull * 0.7, hands, aim: gun ? unit([0, f === 2 ? 0.35 : 0.04, 1]) : def.aim,
        eyes: f === 0 ? "narrow" : "bean", brows: "angry", mouth: f === 1 || f === 2 ? "yell" : "grit",
        xf: { sy: [0.95, 1.03, 1, 1][f]!, sx: [1.04, 0.98, 1, 1][f]! },
        crouch: f === 0 ? 1.5 : 0,
      });
      if (tell) rig.xf = { sy: 0.92, sx: 1.06 };
      if (gun && f === 1) rig.arc = [];
      rig.flash = tell && i === 1;
      return rig;
    }
    // a swing: wind up (coiled back, a squash), the smear (the arc, a stretch), the overshoot, the settle
    const f = tell ? 0 : i;
    const keys: [V3, V3][] = [
      [[11 * W, 50 * T, -5], unit([0.35, 0.8, -0.5])],
      [[5 * W, 36 * T, 14], unit([-0.2, 0.1, 1])],
      [[-9 * W, 27 * T, 10], unit([-0.85, -0.35, 0.4])],
      [[8 * W, 31 * T, 7], unit([0.35, 0.35, 0.85])],
    ];
    let [h, d] = keys[f]!;
    if (tell) [h, d] = [[12.5 * W, 53 * T, -7], unit([0.45, 0.75, -0.6])];
    const off: V3 = [[-10, 33, 7], [-12, 30, -2], [-11, 34, -3], [-12, 28, 2]][f]! as V3;
    const rig = build(B, {
      hands: [[off[0] * W, off[1] * T, off[2]], [h[0], h[1], h[2]]], aim: d,
      lean: tell ? -3 : [-2.2, 3.5, 4.2, 1.5][f]!, twist: tell ? 0.7 : [0.5, -0.25, -0.6, -0.15][f]!, crouch: tell ? 2 : [1.4, 0, 0.6, 0][f]!,
      eyes: f === 0 ? "narrow" : "bean", brows: "angry", mouth: f === 1 ? "yell" : f === 3 ? (B.expression === "neutral" ? "smirk" : (B.expression as Mouth)) : "grit",
      xf: tell ? { sy: 0.92, sx: 1.06 } : { sy: [0.95, 1.04, 1, 1][f]!, sx: [1.04, 0.97, 1, 1][f]! },
      extraSwing: f * 1.4,
      feet: [[-R.footX - 0.5, 3.6, f === 1 || f === 2 ? -1 : 2], [R.footX + 0.5, 3.6, f === 1 || f === 2 ? 4 : 0]],
    });
    if (!tell && (f === 1 || f === 2)) {
      // the arc the item's tip leaves, swept from up and back, through the front, across and down
      const sh = add(rig.shoulder[1], [0, 2, 0]), reach = 28 * T;
      // (a diagonal slash: it reads as an arc from the front and from the side)
      const dirs = [unit([0.5, 0.85, -0.3]), unit([0.55, 0.15, 0.85]), unit([-0.35, -0.75, 0.6])];
      const pts: V3[] = [];
      const n = 16, end = f === 1 ? 1 : 1, start = f === 1 ? 0 : 0.45;
      for (let s = 0; s <= n; s++) {
        const t = start + ((end - start) * s) / n, seg = t < 0.5 ? 0 : 1, u = t < 0.5 ? t * 2 : t * 2 - 1;
        const dd = unit(lerp(dirs[seg]!, dirs[seg + 1]!, u));
        pts.push(add(sh, scale(dd, reach)));
      }
      rig.arc = pts;
      rig.arcWidth = f === 1 ? 9 : 4;
      rig.hideItem = f === 1;
    }
    rig.flash = tell && i === 1;
    return rig;
  }
  if (anim === "hurt") {
    const k: Spec = i === 0
      ? { lean: -4.5, headTilt: -2, hands: [[-16 * W, 41 * T, 3], [16 * W, 43 * T, 3]], eyes: "shock", brows: "shock", mouth: "shock", xf: { sy: 0.87, sx: 1.09 }, crouch: 1 }
      : { lean: -2, headTilt: -1, hands: [[-13 * W, 31 * T, 4], [13 * W, 32 * T, 5]], eyes: "squeeze", brows: "worried", mouth: "grit", xf: { sy: 0.97, sx: 1.02 } };
    return build(B, k);
  }
  if (anim === "roll") return rollRig(B, i);
  if (anim === "dash_attack") return dashAttackRig(B, i);
  return build(B, {});
}

/// The dash attack: out of a roll, a low lunge along the ground with a wide, flat slash: wound up and coiled, the lunge (the item
/// smeared in a long arc, speed lines behind), the crack (the arc ends far across the body), and the skid. Guns and shields do the
/// same lunge with their own hands (the arc is only drawn for a swinging item).
function dashAttackRig(B: Body, i: number): Rig {
  const W = B.W, T = B.T;
  const hands: [V3, V3][] = [
    [[-9 * W, 30 * T, 8], [11 * W, 38 * T, -7]],
    [[-6 * W, 30 * T, 17], [6 * W, 31 * T, 25]],
    [[5 * W, 29 * T, 18], [-12 * W, 27 * T, 15]],
    [[-8 * W, 24 * T, 12], [-6 * W, 20 * T, 15]],
  ];
  const aim: V3[] = [unit([0.5, 0.7, -0.5]), unit([-0.25, 0.0, 1]), unit([-1, -0.1, 0.25]), unit([-0.3, -0.6, 0.8])];
  const feet: [V3, V3][] = [
    [[-5.6, 3.6, -3], [5.6, 4.5, 4]],
    [[-5.6, 5.5, -9], [5.6, 3.6, 8]],
    [[-5.8, 4.5, -8], [5.8, 3.6, 9]],
    [[-6.4, 3.6, -5], [6.4, 3.6, 6]],
  ];
  const rig = build(B, {
    hands: hands[i]!, aim: aim[i]!, feet: feet[i]!,
    crouch: [5, 8.5, 8, 6][i]!, lean: [6, 15, 14, 8][i]!, twist: [0.8, 0.1, -0.7, -0.3][i]!, headTilt: [0, -1, -1, 0][i]!,
    eyes: i === 3 ? "bean" : "narrow", brows: "angry", mouth: i === 1 || i === 2 ? "yell" : "grit",
    hem: [[0, 12, -9], [0, 11, -15], [0, 11, -14], [0, 10, -8]][i] as V3,
    xf: [{ sy: 0.95, sx: 1.04 }, { sy: 0.92, sx: 1.06 }, { sy: 0.94, sx: 1.05 }, { sy: 0.96, sx: 1.03 }][i]!,
    extraSwing: i * 1.4,
  });
  if ((i === 1 || i === 2) && swings(B)) {
    // a flat sweep across the front at about chest height: from out on the item's side, through the front, to far across
    const sh = add(rig.shoulder[1], [0, 0, 0]), reach = 34 * T;
    const a0 = i === 1 ? 1.9 : 0.5, a1 = i === 1 ? 0.2 : -2.0;
    const pts: V3[] = [];
    for (let s = 0; s <= 18; s++) {
      const a = a0 + ((a1 - a0) * s) / 18;
      pts.push(add(sh, scale(unit([Math.sin(a), -0.18 + 0.12 * (s / 18), Math.cos(a)]), reach)));
    }
    rig.arc = pts;
    rig.arcWidth = i === 1 ? 11 : 6;
    rig.hideItem = i === 1;
  }
  rig.streak = i === 1 || i === 2;
  return rig;
}

/// The roll: a dive into a tuck, the tucked figure turning over twice a quarter at a time, and the landing crouch; the
/// figure tips as a whole about its middle.
function rollRig(B: Body, i: number): Rig {
  const W = B.W, T = B.T;
  const C: V3 = [0, 15, 1];
  const tuck = (r: Rig): Rig => {
    // knees up to the chest, the head down, the arms round the shins
    r.pelvis = [0, 11, -3];
    r.waist = [0, 15, -2];
    r.chest = [0, 21, 0.5];
    r.neck = [0, 25, 3.5];
    r.head = [0, 28, 8];
    r.shoulder = [[-10 * W, 23, 0.5], [10 * W, 23, 0.5]];
    r.hip = [[-4.7 * W, 9.5, -2.5], [4.7 * W, 9.5, -2.5]];
    r.knee = [[-5.5 * W, 20, 8.5], [5.5 * W, 20, 8.5]];
    r.ankle = [[-5.4 * W, 7, 7.5], [5.4 * W, 7, 7.5]];
    r.hand = [[-8.5 * W, 15, 11], [8.5 * W, 15.5, 11]];
    r.elbow = [[-12 * W, 18, 4], [12 * W, 18, 4]];
    r.hem = [0, 6, -9];
    r.aim = unit([0, -0.4, -1]);
    r.extra = r.extra.map((e, k) => ({ shoulder: [Math.sign(e.shoulder[0]) * 9, 19 - k, 0], elbow: [Math.sign(e.shoulder[0]) * 13, 15, 3], hand: [Math.sign(e.shoulder[0]) * 10, 12, 9] }));
    return r;
  };
  void T;
  if (i === 0) {
    // the dive: low, leaning hard into the roll, arms reaching
    const r = build(B, { crouch: 7, lean: 9, headTilt: 3, hands: [[-9 * W, 26, 15], [9 * W, 27, 16]], aim: unit([0, -0.2, 1]), eyes: "narrow", brows: "angry", mouth: "grit", hem: [0, 11, -9], feet: [[-5, 3.6, -5], [5, 6, 3]] });
    r.xf = { pitch: 0.5, pivot: C };
    r.streak = true;
    return r;
  }
  if (i === 4) {
    // the landing: a crouch on one knee's spring, one hand down to the ground
    const r = build(B, { crouch: 6, lean: 4, hands: [[-11 * W, 9, 9], [12 * W, 24, 6]], eyes: "bean", brows: "angry", mouth: B.expression === "neutral" ? "smirk" : (B.expression as Mouth), hem: [0, 8, -7], feet: [[-5.5, 3.6, -3], [5.5, 3.6, 4]] });
    r.xf = { sy: 0.94, sx: 1.04 };
    return r;
  }
  const r = tuck(build(B, {}));
  r.xf = { pitch: [0, 1.75, 3.3, 4.85][i]!, pivot: C };
  r.noFace = true;
  r.streak = true;
  return r;
}

// ---- the figure's parts ------------------------------------------------------------------------------------------------
const L = (ramp: Ramp, spec = 0, extra: Partial<Look> = {}): Look => ({ ramp, spec, ...extra });

const cylinderZ = (c: V3, r: number, z0: number, z1: number): Sdf => (x, y, z) => {
  const d = Math.hypot(x - c[0], y - c[1]) - r, dz = Math.abs(z - (z0 + z1) / 2) - (z1 - z0) / 2;
  return Math.min(Math.max(d, dz), 0) + Math.hypot(Math.max(d, 0), Math.max(dz, 0));
};
/// A disc of radius r and half thickness t about c, facing along n.
const disc = (c: V3, n: V3, r: number, t: number): Sdf => {
  const u = unit(n);
  return (x, y, z) => {
    const p = [x - c[0], y - c[1], z - c[2]] as V3;
    const a = p[0] * u[0] + p[1] * u[1] + p[2] * u[2];
    const q = Math.hypot(p[0] - a * u[0], p[1] - a * u[1], p[2] - a * u[2]);
    const dx = q - r, dy = Math.abs(a) - t;
    return Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  };
};
/// A box from its middle and half sizes along three directions of its own.
const obox = (c: V3, h: V3, ax: V3, ay: V3, r = 0): Sdf => {
  const X = unit(ax), Y0 = unit(ay);
  const d = X[0] * Y0[0] + X[1] * Y0[1] + X[2] * Y0[2];
  const Y = unit([Y0[0] - d * X[0], Y0[1] - d * X[1], Y0[2] - d * X[2]]);
  const Z: V3 = [X[1] * Y[2] - X[2] * Y[1], X[2] * Y[0] - X[0] * Y[2], X[0] * Y[1] - X[1] * Y[0]];
  return (x, y, z) => {
    const p: V3 = [x - c[0], y - c[1], z - c[2]];
    const lx = Math.abs(p[0] * X[0] + p[1] * X[1] + p[2] * X[2]) - h[0] + r, ly = Math.abs(p[0] * Y[0] + p[1] * Y[1] + p[2] * Y[2]) - h[1] + r, lz = Math.abs(p[0] * Z[0] + p[1] * Z[1] + p[2] * Z[2]) - h[2] + r;
    return Math.hypot(Math.max(lx, 0), Math.max(ly, 0), Math.max(lz, 0)) + Math.min(Math.max(lx, ly, lz), 0) - r;
  };
};

type PutFn = (sdf: Sdf, at: V3, size: number, look: TPart["look"], group?: number, bare?: boolean) => void;

function figure(B: Body, r: Rig): TPart[] {
  const parts: TPart[] = [];
  const put: PutFn = (sdf, at, size, look, group, bare = false) => parts.push({ sdf, at, size, look, group, bare });
  const coat = B.outfit === "long_coat" || B.outfit === "lab_coat";
  const skirt = B.outfit === "robe" || B.outfit === "dress";
  const trousers = ["jumpsuit", "suit", "scrubs", "loud_suit"].includes(B.outfit) || skirt ? B.main : B.trim;
  const armour = B.outfit === "riot_armor" || B.outfit === "armor";
  const W = B.W;

  // legs: trousers, then big boots that come up the shin
  for (const k of [0, 1] as const) {
    const g = k ? G.legR : G.legL;
    const boot = r.ankle[k][1] + 4.5;
    put(union(capsule(r.hip[k], r.knee[k], 5.2 * W, 4.5 * W), capsule(r.knee[k], r.ankle[k], 4.5 * W, 4 * W)), lerp(r.hip[k], r.ankle[k], 0.5), 17, (h) => {
      if (h.l[1] < boot && Math.hypot(h.l[0] - r.ankle[k][0], h.l[2] - r.ankle[k][2]) < 6) return L(B.shoes, 0.25);
      if (armour && Math.abs(h.l[1] - r.knee[k][1]) < 2.4 && h.ln[2] > 0.3) return L(B.metal, 0.8);
      return L(trousers);
    }, g);
    // the boot: a big rounded toe, a heel, a thick sole
    const toe = add(r.ankle[k], [0, -1, 6.5]);
    put(smooth(1.5, capsule(add(r.ankle[k], [0, 0.6, -1]), toe, 4, 3.6), sphere(add(r.ankle[k], [0, 1.2, -0.5]), 4.2)), add(r.ankle[k], [0, 0, 2.5]), 9, (h) => (h.l[1] < r.ankle[k][1] - 2.3 ? L(B.dark, 0, { flat: 1 }) : L(B.shoes, 0.35)), g);
  }
  // the body: hips, a clear waist, a broad chest and a strong shoulder line
  const torso = smooth(2.6,
    ellipsoid(r.pelvis, [8.6 * W, 5.2, 5.8]),
    ellipsoid(r.waist, [7.2 * W, 4.6, 5.2]),
    ellipsoid(add(r.chest, [0, 0.5, 0]), [10.8 * W, 6.6, 6.4]),
    capsule(add(r.shoulder[0], [1.5, -0.6, 0]), add(r.shoulder[1], [-1.5, -0.6, 0]), 5),
  );
  put(torso, lerp(r.pelvis, r.chest, 0.5), 22, (h) => clothes(B, h, r), G.torso);
  if (B.outfit === "utility") {
    // pouches on the vest
    for (const s of [-1, 1]) put(box(add(r.chest, [s * 4.6 * W, -4.5, 5.6]), [2.3, 2.2, 1.6], 0.6), add(r.chest, [s * 4.6, -4.5, 5.6]), 4, L(B.trim, 0.2), G.collar);
    put(box(add(r.waist, [0, -1, 5.6]), [3.4, 1.8, 1.4], 0.6), add(r.waist, [0, -1, 5.6]), 4, L(B.trim, 0.2), G.collar);
  }
  // a long coat's skirt or a robe: from the waist out to a flared hem; a coat is open down the front
  if (coat || skirt) {
    const top: V3 = [r.pelvis[0], r.waist[1] - 1, r.pelvis[2] - 0.4], hem = r.hem;
    const flare = (skirt ? 12.5 : B.outfit === "lab_coat" ? 11.5 : 13.6) * W;
    const cone = inter(capsule(top, add(hem, [0, -3, 0]), 7.6 * W, flare), (_x, y) => hem[1] + 0.4 - y);
    // open down the front in a V that widens to the hem, so the legs stride out of it
    const open: Sdf = (x, y, z) => Math.max(Math.abs(x - top[0]) - (1.6 + Math.max(0, top[1] - y) * 0.42), top[2] + 1 - z);
    const shape = coat ? cut(cone, open) : cone;
    const still = !r.xf.pitch && !r.xf.bank;
    put(shape, lerp(top, hem, 0.5), 22, (h) => {
      if (h.l[1] < hem[1] + 1.8 && B.outfit === "long_coat" && still) return L(B.glow, 0, { emit: true });
      if (h.l[1] < hem[1] + 1.5 && skirt) return L(B.trim);
      if (Math.abs(h.ln[0]) > 0.75 && h.l[2] > 3 && coat) return L(B.dark); // the lining, inside the opening
      return L(B.main);
    }, G.coat);
  }
  // arms: a shoulder, a sleeve, a big hand; armour has shoulder plates
  const bare = B.outfit === "tank_top" || B.outfit === "rags" || B.outfit === "scrubs";
  const sleeve = B.outfit === "vest" ? B.shirt : B.main;
  const gloves = armour || B.chrome ? (B.chrome ? B.skin : B.dark) : B.skin;
  for (const k of [0, 1] as const) {
    const g = k ? G.armR : G.armL;
    put(union(sphere(r.shoulder[k], 5.2 * W), capsule(r.shoulder[k], r.elbow[k], 4.7 * W, 4.2 * W), capsule(r.elbow[k], r.hand[k], 4.2 * W, 3.8 * W)), lerp(r.shoulder[k], r.hand[k], 0.5), 15, (h) => {
      const fromHand = Math.hypot(h.l[0] - r.hand[k][0], h.l[1] - r.hand[k][1], h.l[2] - r.hand[k][2]);
      const fromShoulder = Math.hypot(h.l[0] - r.shoulder[k][0], h.l[1] - r.shoulder[k][1], h.l[2] - r.shoulder[k][2]);
      if (fromHand < 3.8) return L(B.outfit === "bellhop" || B.outfit === "suit" || B.outfit === "loud_suit" ? B.white : armour ? B.dark : B.trim, 0.2); // a cuff
      if (B.outfit === "tank_top" && fromShoulder > 2.5) return L(B.skin, B.chrome ? 0.8 : 0);
      if (bare && fromHand < 8.5) return L(B.skin, B.chrome ? 0.8 : 0);
      if (B.outfit === "vest" && Math.abs(fromShoulder - 5.5) < 1.1) return L(B.gold, 0.6); // a sleeve garter
      return L(armour ? B.main : sleeve, armour ? 0.5 : 0);
    }, g);
    hand(B, r, k, put, g, gloves);
    if (armour || B.outfit === "bellhop") put(ellipsoid(add(r.shoulder[k], [k ? 1.4 : -1.4, 1.6, 0]), [5.4 * W, 2.6, 5]), r.shoulder[k], 7, L(armour ? B.metal : B.gold, 0.8), g);
  }
  for (const [n, e] of r.extra.entries()) {
    const g = G.extra + n;
    put(union(sphere(e.shoulder, 3), capsule(e.shoulder, e.elbow, 3.1, 2.8), capsule(e.elbow, e.hand, 2.8, 2.5)), lerp(e.shoulder, e.hand, 0.5), 15, (h) => (Math.hypot(h.l[0] - e.hand[0], h.l[1] - e.hand[1], h.l[2] - e.hand[2]) < 5 ? L(B.skin) : L(sleeve)), g);
    put(sphere(e.hand, 2.9), e.hand, 4, L(hdGlove(B)), g);
    // each holds a little blade
    const d = unit(sub(e.hand, e.elbow));
    put(capsule(add(e.hand, scale(d, 1.5)), add(e.hand, scale(d, 6.5)), 0.8, 0.3), add(e.hand, scale(d, 4)), 5, L(B.metal, 1), G.item2);
  }
  // neck, head (a jaw, a nose, ears)
  put(capsule(r.neck, add(r.neck, [0, 3.6, 0.4]), 3.3), r.neck, 6, L(B.skin, B.chrome ? 0.6 : 0), G.head);
  const hc = r.head, first = parts.length;
  const head = smooth(2.2, ellipsoid(hc, [8.7, 8.5, 8.2]), ellipsoid(add(hc, [0, -4.4, 1.6]), [6.9, 4.2, 6.2]));
  put(head, hc, 11, (h) => (B.chrome && Math.abs(Math.abs(h.l[0] - hc[0]) - 6.3) < 0.6 && h.l[1] < hc[1] - 1 ? L(B.dark, 0, { flat: 1 }) : L(B.skin, B.chrome ? 0.7 : 0)), G.head);
  for (const s of [-1, 1]) put(ellipsoid(add(hc, [s * 8.3, -0.6, -0.6]), [1.6, 2.6, 2]), add(hc, [s * 8.3, -0.6, 0]), 4, L(B.skin), G.head);
  put(sphere(add(hc, [0, -1.6, 8.2]), 1.7), add(hc, [0, -1.6, 8.2]), 3, L(B.skin, B.chrome ? 0.6 : 0), G.head);
  hairOf(B, r, put);
  hatOf(B, r, put);
  // the head, its hair and hat drawn a size up (a cartoon's head: a quarter of the height, so the face reads)
  for (let n = first; n < parts.length; n++) parts[n] = bigger(parts[n]!, hc, HEAD);
  // collars and hoods lying down
  if (coat || B.outfit === "jacket" || B.outfit === "bellhop") {
    const n = r.neck, high = B.outfit === "long_coat";
    const ring = cut(cylinder(add(n, [0, 0, -0.6]), high ? 7.2 : 6, n[1] - 2, n[1] + (high ? 5.2 : 2.6), 1.2), union(cylinder(add(n, [0, 0, -0.6]), 4.4, n[1] - 4, n[1] + 9), box(add(n, [0, 1, 6]), [high ? 3.2 : 2.6, 7, 4])));
    put(ring, n, 9, (h) => L(h.ln[1] > 0.5 ? B.main : B.main), G.collar);
  }
  if (B.outfit === "hoodie" && B.hat !== "hood") put(ellipsoid(add(r.neck, [0, 0.5, -4.6]), [7, 3.6, 3.2]), add(r.neck, [0, 0, -4]), 8, L(B.main), G.collar);
  if (!r.hideItem) itemOf(B, r, put);
  return parts;
}

const hdGlove = (B: Body) => B.skin;

/// How much bigger the head is drawn than it is built.
const HEAD = 1.13;
/// A part made k times bigger about c (its painting sees the point where it was before).
function bigger(p: TPart, c: V3, k: number): TPart {
  const inv = (x: number, y: number, z: number): V3 => [c[0] + (x - c[0]) / k, c[1] + (y - c[1]) / k, c[2] + (z - c[2]) / k];
  const look = p.look;
  return {
    ...p,
    sdf: (x, y, z) => p.sdf(...inv(x, y, z)) * k,
    at: add(c, scale(sub(p.at, c), k)),
    size: p.size * k,
    look: typeof look === "function" ? (h: Hit) => look({ ...h, l: inv(...h.l) }) : look,
  };
}

/// A hand: a big fist, or open (fingers spread) for a wide pose.
function hand(B: Body, r: Rig, k: 0 | 1, put: PutFn, g: number, look: Ramp) {
  const h = r.hand[k];
  if (r.open && (k === 0 || B.item === "none")) {
    const d = unit(sub(h, r.elbow[k]));
    put(smooth(1, ellipsoid(add(h, scale(d, 1)), [3.6, 3.6, 2.2]), ...[-1, 0, 1].map((f) => capsule(add(h, scale(d, 2.5)), add(add(h, scale(d, 6)), [f * 2.2, 0, 0]), 1.1))), h, 7, L(look, B.chrome ? 0.7 : 0), g);
    return;
  }
  put(sphere(add(h, [0, -0.4, 0]), 4.5), h, 6, L(look, B.chrome ? 0.7 : 0), g);
}

/// What the outfit puts where on the body.
function clothes(B: Body, h: Hit, r: Rig): Look {
  const y = h.l[1], lx = h.l[0] - r.chest[0], front = h.ln[2] > 0.25, waist = r.waist[1];
  const belt = Math.abs(y - (waist - 2)) < 1.3;
  const fromNeck = r.neck[1] - y;
  switch (B.outfit) {
    case "long_coat":
    case "lab_coat":
      // a coat open over a shirt: the shirt in a V, a belt
      if (front && Math.abs(lx) < 1.4 + fromNeck * 0.16 && y > waist - 3) return L(B.outfit === "lab_coat" ? B.shirt : B.dark);
      if (belt) return L(B.outfit === "lab_coat" ? B.main : B.trim, 0.3);
      return L(B.main);
    case "jacket":
      if (front && Math.abs(lx) < 0.7 && y > waist - 3) return L(B.metal, 0.8);
      if (y < waist - 2) return L(B.trim);
      return L(B.main);
    case "hoodie":
      if (front && y < waist + 1 && y > waist - 5 && Math.abs(lx) < 4.5) return L(B.main, 0, { flat: 1 });
      if (front && fromNeck < 7 && Math.abs(Math.abs(lx) - 2) < 0.6) return L(B.white, 0, { flat: 2 });
      if (y < waist - 4) return L(B.trim);
      return L(B.main);
    case "jumpsuit":
      if (front && Math.abs(lx) < 0.6 && y > waist - 2) return L(B.metal, 0.8);
      if (belt) return L(B.trim);
      return L(B.main);
    case "suit":
    case "loud_suit": {
      if (front && Math.abs(lx) < 1.1 && y > waist - 1 && fromNeck > 1) return L(B.outfit === "loud_suit" ? B.glow : B.trim, 0.2, B.outfit === "loud_suit" ? { flat: 2 } : {});
      if (front && Math.abs(lx) < 2.4 + (y - waist) * 0.28 && y > r.chest[1] - 3) return L(B.white);
      if (B.outfit === "loud_suit" && (Math.floor((h.l[0] + 40) / 3.4) + Math.floor((y + 40) / 3.4)) % 2) return L(B.trim);
      return L(B.main);
    }
    case "bellhop":
      if (front && Math.abs(Math.abs(lx) - 2.6) < 0.9 && y > waist - 3 && Math.round(y) % 3 === 0) return L(B.gold, 1, { flat: 3 });
      if (y < waist - 3.5) return L(B.trim);
      if (Math.abs(y - (waist - 3)) < 0.9) return L(B.gold, 0.6);
      return L(B.main);
    case "vest":
      if (front && Math.abs(lx) < 0.9 && fromNeck > 1 && y > waist - 1) return L(B.trim, 0.2);
      if (front && Math.abs(lx) < 2.6 + (y - waist) * 0.3 && y > r.chest[1] - 2) return L(B.shirt);
      if (!front && y > waist + 2 && Math.abs(lx) > 6) return L(B.shirt);
      if (y < waist - 3) return L(B.trim);
      return L(B.main);
    case "scrubs":
      if (front && y < r.chest[1] + 2 && y > waist - 6 && Math.abs(lx) < 6) return L(B.white, 0, Math.sin(h.l[0] * 1.3 + y) > 0.85 ? { flat: 1 } : {});
      return L(B.main);
    case "utility":
      if (front && Math.abs(Math.abs(lx) - (fromNeck * 0.45)) < 1 && y > waist) return L(B.dark, 0.3); // straps crossing
      if (y < waist - 3) return L(B.trim);
      return L(B.main);
    case "tank_top":
      if (y > r.chest[1] + 1.5 && Math.abs(lx) > 5.5) return L(B.skin, B.chrome ? 0.7 : 0);
      if (y < waist - 3) return L(B.trim);
      return L(B.main);
    case "riot_armor":
    case "armor":
      if (front && Math.abs(y - r.chest[1]) < 0.9 && Math.abs(lx) < 5 && B.outfit === "riot_armor") return L(B.glow, 0, { emit: true });
      if (h.ln[2] > 0.5 && y > waist) return L(B.outfit === "armor" ? B.metal : B.main, 0.8);
      if (belt) return L(B.trim);
      return L(B.outfit === "armor" ? B.metal : B.main, 0.5);
    case "rags":
      if (Math.sin(h.l[0] * 1.4 + y * 0.7) > 0.9) return L(B.trim);
      if (y < waist - 3) return L(B.trim);
      return L(B.main);
    default:
      // tunic, shirt, robe, dress
      if (belt && B.outfit !== "shirt") return L(B.trim);
      if (B.outfit === "shirt" && front && fromNeck < 3.5 && Math.abs(lx) < 1.8) return L(B.skin);
      return L(B.main);
  }
}

function hairOf(B: Body, r: Rig, put: PutFn) {
  if (B.style === "bald") return;
  const hc = r.head, look = L(B.hair, 0.4);
  if (B.style === "mohawk") {
    // a tall crest from the brow to the back of the neck, in five chunky fins
    put(capsule(add(hc, [0, 7.6, 6]), add(hc, [0, 6.4, -7.5]), 3.4, 2.6), add(hc, [0, 7, -1]), 11, look, G.hair);
    put(union(...[6, 2.5, -1, -4.5, -7.5].map((z, k) => capsule(add(hc, [0, 7.5 - (k > 3 ? 1.5 : 0), z]), add(hc, [0, 16.5 - Math.abs(k - 1.2) * 1.1, z - 3.4]), 3, 0.9))), add(hc, [0, 12, -1]), 13, look, G.hair);
    return;
  }
  // a cap of hair over the skull, the face cut out under a fringe
  const cap = cut(ellipsoid(add(hc, [0, 1.6, -0.8]), [9.4, 9.2, 9.2]), union(
    box(add(hc, [0, -3.6, 7]), [11, 6.8, 6]),
    ellipsoid(add(hc, [0, -2.4, 5.4]), [7.4, 6, 5]),
    B.style === "short" || B.style === "spiky" ? box(add(hc, [0, -9, -2]), [11, 4.4, 11]) : box(add(hc, [0, -40, 0]), [1, 1, 1]),
  ));
  put(cap, hc, 12, look, G.hair);
  // the fringe: three chunky locks over the brow
  if (B.style !== "long") put(union(...[-3.4, 0.2, 3.6].map((x, k) => capsule(add(hc, [x, 5.6, 6]), add(hc, [x + 1.4, 2.8 + (k === 1 ? -0.6 : 0), 8.2]), 2, 0.9))), add(hc, [0, 4, 7]), 8, look, G.hair);
  if (B.style === "long" || B.style === "bob") put(ellipsoid(add(hc, [0, B.style === "long" ? -7 : -3.4, -4]), [9.4, B.style === "long" ? 10 : 5.6, 5]), add(hc, [0, -5, -3]), 14, look, G.hair);
  if (B.style === "ponytail") put(capsule(add(hc, [0, 2, -8.5]), add(hc, [0, -10, -11]), 3.2, 1.6), add(hc, [0, -4, -10]), 10, look, G.hair);
  if (B.style === "spiky") put(union(...[[-4.5, 2], [0, 3.5], [4.5, 2], [-2.5, -3], [3, -3], [0, -6]].map(([x, z]) => capsule(add(hc, [x!, 7, z!]), add(hc, [x! * 1.4, 13, z! - 1.5]), 2.4, 0.5))), add(hc, [0, 10, 0]), 11, look, G.hair);
}

function hatOf(B: Body, r: Rig, put: PutFn) {
  const hc = r.head, h = B.hat;
  const shell = (grow: number) => ellipsoid(add(hc, [0, 1.4, -0.6]), [9.4 + grow, 9.4 + grow, 9.2 + grow]);
  const slab = (y0: number, y1: number): Sdf => (_x, y) => Math.max(y0 - (y - hc[1]), y - hc[1] - y1);
  const front = (z0: number): Sdf => (_x, _y, z) => z0 - (z - hc[2]);
  const lens = (k: Hit) => (k.ln[2] > 0.2 ? L(B.glow, 0.9, k.ln[1] > 0.55 && k.ln[0] < 0 ? { flat: 4 } : { emit: true }) : L(B.dark, 0.7));
  if (h === "visor") {
    // pushed up onto the forehead by default (the face shows); "visor": "down" wears it over the eyes
    const [y0, y1] = B.visor === "down" ? [-1.8, 2.6] : [4.4, 7.6];
    put(inter(inter(shell(1.1), slab(y0, y1)), front(-3)), add(hc, [0, (y0 + y1) / 2, 4]), 11, lens, G.hat);
    put(inter(shell(0.6), slab(y0 + 0.6, y1 - 0.6)), add(hc, [0, (y0 + y1) / 2, 0]), 11, L(B.dark, 0.5), G.hat2);
  } else if (h === "riot_helmet" || h === "helmet") {
    const dome = cut(shell(1.6), box(add(hc, [0, -9.5, 2]), [12, 6.5, 12]));
    put(cut(dome, h === "helmet" ? box(add(hc, [0, -2, 9]), [5.6, 4.4, 4]) : box(add(hc, [0, -40, 0]), [1, 1, 1])), hc, 13, (k) => (Math.abs(k.l[1] - (hc[1] + 7)) < 0.9 && h === "riot_helmet" ? L(B.glow, 0, { emit: true }) : L(h === "helmet" ? B.metal : B.dark, 0.9)), G.hat);
    if (h === "riot_helmet") put(inter(inter(shell(2.2), slab(-2.4, 3)), front(-1)), add(hc, [0, 0, 7]), 11, (k) => L(B.glass, 1, k.ln[1] > 0.3 ? { flat: 4 } : { flat: 1 }), G.hat2);
    if (h === "helmet") put(box(add(hc, [0, 0, 10.6]), [0.9, 3.6, 0.9], 0.3), add(hc, [0, 0, 10.6]), 4, L(B.metal, 0.9), G.hat2);
  } else if (h === "gas_mask") {
    put(inter(inter(shell(1.4), slab(-9, -1.2)), front(0)), add(hc, [0, -4, 6]), 11, L(B.dark, 0.4), G.hat);
    put(cylinderZ(add(hc, [0, -6.2, 0]), 2.6, hc[2] + 8, hc[2] + 11.5), add(hc, [0, -6.2, 10]), 5, L(B.metal, 0.9), G.hat2);
    for (const s of [-1, 1]) put(sphere(add(hc, [s * 3.6, 0.2, 7.4]), 2.4), add(hc, [s * 3.6, 0, 7.4]), 3, L(B.glow, 0, { emit: true }), G.hat2);
  } else if (h === "hood") {
    put(cut(shell(2.2), ellipsoid(add(hc, [0, -2.4, 8.5]), [7, 7.6, 6])), hc, 13, L(B.hatc ?? B.main), G.hat);
  } else if (h === "cap") {
    put(inter(shell(0.8), slab(2.2, 12)), hc, 12, L(B.hatc ?? B.trim), G.hat);
    put(box(add(hc, [0, 2.8, 10]), [6.4, 0.8, 4], 0.7), add(hc, [0, 2.8, 10]), 8, L(B.hatc ?? B.trim), G.hat);
  } else if (h === "bandana") {
    put(inter(shell(0.8), slab(3.2, 6.2)), hc, 12, L(B.hatc ?? B.trim), G.hat);
    put(union(capsule(add(hc, [0, 4.5, -9.6]), add(hc, [-2.5, -0.5, -11]), 1.3, 0.6), capsule(add(hc, [0, 4.5, -9.6]), add(hc, [2.8, 0, -11.5]), 1.3, 0.6)), add(hc, [0, 2, -10.5]), 7, L(B.hatc ?? B.trim), G.hat);
  } else if (h === "crown") {
    put(cut(cylinder(add(hc, [0, 0, -0.6]), 7, hc[1] + 6, hc[1] + 12, 0.5), union(cylinder(add(hc, [0, 0, -0.6]), 5.6, hc[1], hc[1] + 14), ...[0, 1, 2, 3, 4, 5].map((k) => sphere(add(hc, [Math.cos(k * 1.05) * 7, 12.6, Math.sin(k * 1.05) * 7 - 0.6]), 2)))), add(hc, [0, 9, 0]), 9, L(B.gold, 1), G.hat);
  } else if (h === "wizard") {
    put(capsule(add(hc, [0, 5, -0.8]), add(hc, [0, 21, -5]), 9.6, 0.8), add(hc, [0, 12, -2]), 13, L(B.hatc ?? B.main), G.hat);
  } else if (h === "goggles") {
    put(inter(shell(0.5), slab(4.2, 6.4)), hc, 12, L(B.dark, 0.3), G.hat);
    for (const s of [-1, 1]) put(capsule(add(hc, [s * 3.8, 5.4, 6.6]), add(hc, [s * 3.8, 6.4, 9.4]), 2.8), add(hc, [s * 3.8, 6, 8]), 5, (k) => (k.ln[2] > 0.6 || k.ln[1] > 0.6 ? L(B.glass, 1) : L(B.metal, 0.8)), G.hat2);
  } else if (h === "hard_hat") {
    const yellow = toonRamp([236, 182, 40, 255]);
    put(cut(shell(1.8), box(add(hc, [0, -6.5, 0]), [13, 6.8, 13])), hc, 13, (k) => L(Math.abs(k.l[0] - hc[0]) < 1.4 && k.ln[1] > 0.2 ? B.glow : yellow, 0.7, Math.abs(k.l[0] - hc[0]) < 1.4 && k.ln[1] > 0.2 ? { emit: true } : {}), G.hat);
    put(cylinder(add(hc, [0, 0, 1.6]), 12, hc[1] + 0.5, hc[1] + 1.6, 0.5), add(hc, [0, 1, 1]), 13, L(yellow, 0.5), G.hat);
  } else if (h === "fedora") {
    put(cut(cylinder(add(hc, [0, 0, -0.6]), 8.4, hc[1] + 4, hc[1] + 13, 2.4), box(add(hc, [0, 13.5, -0.6]), [1.4, 1.6, 7])), add(hc, [0, 8, 0]), 11, (k) => L(Math.abs(k.l[1] - (hc[1] + 5.6)) < 1.4 ? B.dark : B.hatc ?? B.trim, 0.3), G.hat);
    put(ellipsoid(add(hc, [0, 4.3, 1.2]), [15, 1.1, 14]), add(hc, [0, 4.3, 1]), 15, L(B.hatc ?? B.trim, 0.3), G.hat);
  } else if (h === "bellhop_cap") {
    put(cylinder(add(hc, [2.4, 0, 0]), 5.6, hc[1] + 5.6, hc[1] + 11, 1), add(hc, [2.4, 8, 0]), 8, (k) => L(Math.abs(k.l[1] - (hc[1] + 6.8)) < 1 ? B.gold : B.hatc ?? B.main, 0.6), G.hat);
  } else if (h === "eyeshade") {
    const green = toonRamp([70, 190, 120, 255]);
    put(inter(shell(0.5), slab(3.6, 5.6)), hc, 12, L(B.dark, 0.3), G.hat);
    put(cut(ellipsoid(add(hc, [0, 4.6, 8]), [9, 1, 7]), box(add(hc, [0, 4.6, 0]), [12, 3, 7])), add(hc, [0, 4.6, 10]), 10, L(green, 0.9), G.hat2);
  } else if (h === "surgical") {
    const teal = toonRamp([120, 196, 196, 255]);
    put(inter(shell(1.2), slab(3.4, 14)), hc, 13, L(teal), G.hat);
    put(inter(inter(shell(0.9), slab(-9.5, -1.6)), front(1)), add(hc, [0, -5, 6]), 11, L(teal, 0, { flat: 3 }), G.hat2);
  }
}

function itemOf(B: Body, r: Rig, put: PutFn) {
  const hand = r.hand[1], d = r.aim, at = (t: number): V3 => add(hand, scale(d, t));
  const g = G.item;
  switch (B.item) {
    case "baton":
      put(capsule(at(-2.5), at(3.5), 1.8), at(0), 5, L(B.dark, 0.5), g);
      put(capsule(at(3.5), at(17), 1.5, 1.7), at(10), 9, L(B.glow, 0, { emit: true }), g);
      break;
    case "pipe": {
      const elbow = at(18), bend = unit([d[2] * 0.6, 0.3, -d[0] * 0.6 + 0.4]);
      put(union(capsule(at(-3), elbow, 2.1), capsule(elbow, add(elbow, scale(bend, 4)), 2.1), sphere(elbow, 2.7)), at(8), 13, (h) => L(Math.abs(Math.hypot(...sub(h.l, elbow)) - 2.5) < 0.6 ? B.dark : toonRamp(mix(B.metal[2], B.wood[2], 0.45)), 0.8), g);
      break;
    }
    case "sword":
      put(capsule(at(-2.5), at(1.5), 1.4), at(0), 3, L(B.wood), g);
      put(obox(at(2.4), [4.2, 0.9, 0.9], [d[2], 0, -d[0]].some((v) => v) ? [d[2] || 1, 0, -d[0]] : [1, 0, 0], [0, 1, 0], 0.4), at(2.4), 5, L(B.gold, 0.9), g);
      put(capsule(at(3), at(18), 1.6, 0.5), at(10), 10, L(B.metal, 1), g);
      break;
    case "axe":
    case "staff":
    case "spear":
      put(capsule(at(-4), at(18), 1.2), at(7), 13, L(B.wood), g);
      if (B.item === "axe") put(ellipsoid(at(16), [4.6, 4, 1.1]), at(16), 6, L(B.metal, 1), g);
      if (B.item === "spear") put(capsule(at(18), at(23), 1.7, 0.2), at(20), 4, L(B.metal, 1), g);
      if (B.item === "staff") put(sphere(at(19.5), 2.6), at(19.5), 4, L(B.glow, 0, { emit: true }), g);
      break;
    case "pistol": {
      const a = d[1] > 0.5 ? unit([0, -0.2, 1]) : d;
      const p = (t: number): V3 => add(hand, scale(a, t));
      put(union(capsule(p(-0.5), p(8), 1.8), capsule(add(hand, [0, -0.6, 0]), add(hand, [0, -4, -0.8]), 1.3)), p(3), 7, L(B.dark, 0.9), g);
      if (r.arc) put(sphere(p(11), 3.2), p(11), 4, L(hdFlash(B), 0, { emit: true }), G.item2, true);
      break;
    }
    case "rifle":
      put(union(capsule(at(-8), at(5), 2.3, 2), capsule(at(5), at(17), 1.2), box(add(at(1), [0, 2.6, 0]), [1, 1.2, 1.6])), at(4), 15, (h) => L(h.l[1] < hand[1] - 0.5 ? B.wood : B.dark, 0.8), g);
      if (r.arc) put(sphere(at(20), 3.6), at(20), 5, L(hdFlash(B), 0, { emit: true }), G.item2, true);
      break;
    case "shield": {
      const c = add(r.hand[0], [1, 3.5, 4.6]);
      put(box(c, [8, 12, 1.1], 1.4), c, 15, (h) => (Math.abs(h.l[1] - (c[1] + 7)) < 1.1 && h.ln[2] > 0.5 ? L(B.glow, 0, { emit: true }) : L(B.glass, 1)), g);
      break;
    }
    case "tray": {
      const c = add(r.hand[0], [1.6, 3, 4.5]);
      put(disc(c, [0, 0.25, 1], 9.6, 0.8), c, 11, (h) => L(Math.abs(Math.hypot(h.l[0] - c[0], h.l[1] - c[1]) - 8.6) < 0.9 ? B.gold : B.metal, 1), g);
      break;
    }
    case "bottle":
      put(union(capsule(at(0), at(5.5), 2.6), capsule(at(5.5), at(9), 1.1)), at(4), 8, L(toonRamp([90, 170, 100, 255]), 1), g);
      put(sphere(at(10.2), 1.6), at(10.2), 3, L(toonRamp([255, 170, 70, 255]), 0, { emit: true }), g);
      break;
    case "wrench": {
      const head = at(15);
      put(capsule(at(-3), at(13), 1.6), at(5), 11, L(B.metal, 0.9), g);
      put(cut(obox(head, [4.4, 3, 1.6], [d[0] || 0.01, d[1], d[2]], [d[2] || 0, 0, -d[0] || 1], 1), obox(add(head, scale(d, 2.6)), [3, 1.4, 3], [d[0] || 0.01, d[1], d[2]], [d[2] || 0, 0, -d[0] || 1])), head, 7, L(B.metal, 1), g);
      break;
    }
    case "scalpel":
      put(capsule(at(-1.5), at(4), 1.2), at(1), 4, L(B.white, 0.4), g);
      put(capsule(at(4), at(11), 1.1, 0.2), at(7.5), 5, L(B.metal, 1), g);
      break;
    case "ledger": {
      const c = add(hand, [0, 1, 2.5]);
      put(box(c, [6, 7.6, 2.2], 0.8), c, 11, (h) => L(Math.abs(h.l[2] - c[2]) < 1.5 && Math.abs(h.ln[2]) < 0.5 ? B.white : Math.abs(h.l[0] - c[0]) > 4.6 && Math.abs(h.l[1] - c[1]) > 6 ? B.gold : toonRamp([120, 44, 44, 255]), 0.4), g);
      break;
    }
    case "mine": {
      const c = add(hand, [0, 2.6, 2]);
      put(cylinder(c, 5.6, c[1] - 1.6, c[1] + 1.6, 1), c, 7, L(B.dark, 0.7), g);
      put(sphere(add(c, [0, 2, 0]), 1.8), add(c, [0, 2, 0]), 3, L(B.glow, 0, { emit: true }), g);
      break;
    }
  }
}

const hdFlash = (B: Body): Ramp => toonRamp(mix(B.glow[2], WHITE, 0.55));

// ---- the face -----------------------------------------------------------------------------------------------------------
const EYES: Record<Eyes, string[]> = {
  bean: ["GK", "KK", "KK"],
  narrow: ["KK", "KK"],
  shock: ["WWW", "WKW", "WWW"],
  squeeze: ["K..", ".KK", "K.."],
};
const BROWS: Record<Brows, string[]> = {
  neutral: ["BBB"],
  angry: ["BB..", "..BB"],
  shock: [".BB.", "B..B"],
  worried: ["..BB", "BB.."],
  smirk: ["BBB"],
};
const MOUTHS: Record<Mouth, string[]> = {
  neutral: ["KKK"],
  smirk: ["...K", "KKK."],
  smile: ["K...K", ".KKK."],
  grin: ["KKKKK", "KWWWK", ".KKK."],
  scowl: [".KKK.", "K...K"],
  grit: ["KKKKK", "KWKWK", "KKKKK"],
  yell: ["KKKKK", "KWWWK", "KRRRK", ".KKK."],
  shock: [".K.", "KRK", "KRK", ".K."],
};

/// Draws the face on the head: eyes (or shades, a cyber eye, a visor's glint), brows, a mouth, as crisp pixels. Only
/// where the head (or for brows, the fringe) is what shows, so an arm or an item in front hides them.
function drawFace(B: Body, r: Rig, dir: Dir, img: Img, who: Int16Array, at: (p: V3) => [number, number]) {
  if (dir === "up" || r.noFace || B.hologram && false) return;
  const W = img.w;
  const onHead = (x: number, y: number) => img.inside(x, y) && who[y * W + x] === G.head;
  const onBrow = (x: number, y: number) => img.inside(x, y) && (who[y * W + x] === G.head || who[y * W + x] === G.hair);
  const dark = mix(B.P.outline, B.skin[0], 0.25);
  const ink: Record<string, Rgba> = {
    K: dark, W: [246, 242, 236, 255], G: WHITE, R: [138, 34, 52, 255], B: mix(B.P.outline, B.hair[0], 0.35), S: B.skin[1],
    A: B.glow[2], H: mix(B.glow[3], WHITE, 0.5), M: B.dark[1],
  };
  const hc = r.head;
  const fp = (o: V3) => at(add(hc, scale(o, HEAD)));
  const side = dir === "left" || dir === "right";
  // which way the face looks on the picture: the picture's x of a point a little in front of the face
  const fwd = fp([0, 0, 9])[0] - at(hc)[0];
  const sgn = side ? (fwd >= 0 ? 1 : -1) : 0;
  const masked = B.hat === "gas_mask";
  const visorDown = B.hat === "visor" && B.visor === "down" || B.hat === "riot_helmet";
  const eyePts: [number, number][] = side ? [fp([0, 0, 6.6])] : [fp([-3.6, 0, 7.4]), fp([3.6, 0, 7.4])];
  // eyes, or what is worn over them
  if (B.chrome) ink.K = mix(B.P.outline, B.dark[0], 0.3);
  eyePts.forEach(([ex, ey], k) => {
    const flip = side ? sgn < 0 : k === 1;
    if (visorDown || masked) return;
    if (B.hat === "shades") {
      stamp(img, ["KKKK", "KKKG", ".KK."], ex - 2 + (side ? -sgn : 0), ey - 1, { ...ink, G: [190, 210, 255, 255] }, flip, onBrow);
      return;
    }
    if (B.hat === "cyber_eye" && (side ? sgn > 0 : k === 1)) {
      stamp(img, ["MMMM", "MAAM", "MAHM", "MMMM"], ex - 2, ey - 2, ink, false, (x, y) => onHead(x, y) || onBrow(x, y));
      return;
    }
    const e = EYES[r.eyes];
    const ew = e[0]!.length;
    const eyeInk = B.chrome ? { ...ink, K: B.glow[2], G: WHITE } : ink;
    stamp(img, e, ex - Math.floor(ew / 2) + (side ? -sgn : 0), ey - 1, eyeInk, flip, onHead);
  });
  // brows
  if (!visorDown || B.hat === "visor") eyePts.forEach(([ex, ey], k) => {
    if (visorDown) return;
    let b = BROWS[r.brows];
    if (r.brows === "smirk") b = k === 1 ? ["..B", "BB."] : ["BBB"];
    const bw = b[0]!.length, flip = side ? sgn < 0 : k === 1;
    stamp(img, b, ex - Math.floor(bw / 2) + (side ? -sgn : 0), ey - 2 - b.length - (r.brows === "shock" ? 1 : 0), ink, flip, onBrow);
  });
  // a visor or a face shield over the eyes: a glint
  if (visorDown) {
    const [ex, ey] = side ? eyePts[0]! : eyePts[0]!;
    stamp(img, ["GG.", ".G."], ex - 1, ey - 1, ink, false, (x, y) => img.inside(x, y) && (who[y * W + x] === G.hat || who[y * W + x] === G.hat2));
  }
  // the nose's shadow, then the mouth
  if (!masked && B.hat !== "surgical") {
    if (!side) {
      const [nx, ny] = fp([0.8, -2.6, 8.6]);
      stamp(img, ["S"], nx + 1, ny, ink, false, onHead);
    }
    const m = MOUTHS[r.mouth];
    const [mx, my] = fp([0, -5.2, side ? 6.4 : 7.6]);
    if (side) {
      // the front half of the mouth, at the front of the face
      const half = m.map((row) => row.slice(Math.floor(row.length / 2)));
      stamp(img, half, sgn > 0 ? mx - half[0]!.length + 2 : mx - 1, my - 1, ink, sgn < 0, onHead);
    } else {
      stamp(img, m, mx - Math.floor(m[0]!.length / 2), my - 1, ink, false, onHead);
    }
  }
}

// ---- drawing one frame ---------------------------------------------------------------------------------------------------
function drawFrame(B: Body, anim: string, i: number, dir: Dir): Img {
  const r = rigOf(B, anim, i);
  // a roll seen from the front or the back turns over as a cartwheel (a somersault towards the camera reads as a ball)
  if (anim === "roll" && i > 0 && (dir === "down" || dir === "up") && r.xf.pitch) r.xf = { ...r.xf, bank: r.xf.pitch, pitch: 0 };
  const xf: Xf = { yaw: YAW[dir], ...r.xf, sx: (r.xf.sx ?? 1) * (dir === "right" ? -1 : 1) };
  const rim = B.P.city ? B.P.accent[1][3] : undefined;
  const t = toon([{ parts: figure(B, r), xf }], { w: HD_FRAME, h: HD_FRAME, ox: OX, oy: OY, tilt: 25, outline: B.P.outline, rim, shadows: [[0, 0.5, r.xf.pitch !== undefined ? 12 : 11, 6]] });
  const img = t.img;
  drawFace(B, r, dir, img, t.who, t.at);
  // light: the glowing parts, then the arc of a swing, the roll's streak, the tell's flash
  glowInside(t, B.glow, { reach: 1.6, strength: 0.45, hot: 0.4 });
  if (r.arc && r.arc.length > 1) {
    const pts = r.arc.map((p) => t.at(p));
    const head = mix(B.glow[3], WHITE, 0.55), edge = B.glow[2];
    const behind = dir === "up";
    streak(img, pts, head, edge, [1, r.arcWidth ?? 5], behind ? (x, y) => !img.firm(x, y) : (x, y) => t.who[y * img.w + x] !== G.head);
  }
  if (r.streak) {
    // speed lines behind the way it rolls, where nothing is drawn
    const [dx, dy] = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] }[dir];
    const c: [number, number] = [OX, OY - 16];
    const lines: [number, number, number][] = [[-8, 16, 2], [0, 24, 3], [8, 14, 2]];
    for (const [o, len, w] of lines) {
      const sx = c[0] - dx * 12 + (dy ? o : 0), sy = c[1] - dy * 14 + (dx ? o : 0);
      streak(img, [[sx - dx * len, sy - dy * len], [sx, sy]], mix(B.glow[3], WHITE, 0.4), B.glow[2], [0.6, w], (x, y) => !img.firm(x, y));
    }
  }
  if (r.flash) flashRing(img, B.glow[2], mix(B.glow[3], WHITE, 0.5));
  if (B.hologram) return hologram(B, img, i + (anim === "walk" ? 1 : 0));
  return img;
}

/// A hologram: the figure redrawn in the glow colour's tones by how light it was, scan lines across it, standing on its
/// projector; no outline of black, no dither.
function hologram(B: Body, img: Img, i: number): Img {
  const out = new Img(img.w, img.h), a = B.glow;
  const glitch = i % 4 === 2 ? 30 + (i * 7) % 20 : -9;
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    const p = img.get(x, y);
    if (!p || p[3] < 150) continue;
    const l = (p[0] * 0.3 + p[1] * 0.55 + p[2] * 0.15) / 255;
    const scan = (y + i) % 3 === 0;
    let c = l < 0.16 ? a[0] : l < 0.4 ? a[1] : l < 0.65 ? a[2] : mix(a[3], WHITE, 0.3);
    if (scan) c = mix(c, a[0], 0.55);
    const sx = y >= glitch && y < glitch + 2 ? x + 3 : x;
    out.set(sx, y, [c[0], c[1], c[2], scan ? 150 : 225]);
  }
  // the projector under the feet, and its beam
  for (let y = OY - 2; y <= OY + 3; y++) for (let x = OX - 11; x <= OX + 11; x++) {
    const d = ((x - OX) / 11.5) ** 2 + ((y - OY - 0.5) / 3.4) ** 2;
    if (d <= 1) out.set(x, y, d > 0.7 ? B.P.outline : y < OY ? B.metal[3] : B.metal[1]);
  }
  for (let x = OX - 6; x <= OX + 6; x++) out.set(x, OY - 2, mix(a[3], WHITE, 0.5));
  return out;
}

/// `character_make` with `"style": "detailed"`.
export function makeCharacterHd(name: string, a: Args, put: Put, lists: { hair: string[]; outfits: string[]; hats: string[]; items: string[]; builds: string[]; skins: Record<string, string>; colours: Record<string, string> }) {
  if (a.size !== undefined && !["32x48", "44x64"].includes(String(a.size).replace(/\s/g, ""))) throw new Error(`"size": the detailed style draws one size, a body about 44x64 in ${HD_FRAME}x${HD_FRAME} frames (leave "size" out)`);
  const one = (v: unknown, all: string[], what: string, fallback: string): string => {
    const s = v === undefined || v === null || v === "" ? fallback : String(v).trim().toLowerCase().replace(/[ -]/g, "_");
    if (!all.includes(s)) throw new Error(`"${what}" is one of ${all.join(", ")} (got '${v}')`);
    return s;
  };
  const P = paletteOf(a.palette);
  const warm = P.city ? mix(P.accent[0][2], WHITE, 0.6) : mix(P.light, WHITE, 0.5);
  const R = (c: Rgba) => toonRamp(lit(P, c), warm);
  const outfits = [...lists.outfits, ...HD_OUTFITS_MORE], hats = [...lists.hats, ...HD_HATS_MORE], items = [...lists.items, ...HD_ITEMS_MORE];
  const skins = { ...lists.skins, ...HD_SKINS_MORE };
  const outfit = one(a.outfit, outfits, "outfit", "tunic");
  const build = one(a.build, lists.builds, "build", "normal");
  const item = one(a.item, items, "item", "sword");
  const skinText = String(a.skin ?? "light").trim().toLowerCase();
  const defaultColours: Record<string, string> = { loud_suit: "#d6487a", bellhop: "#b02a3a", vest: "#4a5a3a", scrubs: "#3f8a86", utility: "#5a5a3a", tank_top: "#c8c4b8" };
  const stance = one(a.stance, STANCES, "stance", build === "stout" ? "heavy" : "upright");
  const pose = one(a.pose, POSES, "pose", item === "pistol" || item === "rifle" ? "aim" : item === "shield" || item === "tray" ? "guard" : "low");
  const arms = a.arms === undefined ? 2 : Number(a.arms);
  if (!ARM_COUNTS.includes(arms)) throw new Error(`"arms" is ${ARM_COUNTS.join(", ")} (a Splicer has 6; got '${a.arms}')`);
  const B: Body = {
    P,
    skin: R(colourOf(skins[skinText] ?? a.skin, `"skin" (${Object.keys(skins).join(", ")}, or a colour)`)),
    hair: R(colourOf(a.hair_color ?? a.hair_colour, '"hair_color"', "brown")),
    main: R(colourOf(a.outfit_color ?? a.outfit_colour, '"outfit_color"', lists.colours[outfit] ?? defaultColours[outfit] ?? (outfit === "armor" ? "red" : "green"))),
    trim: R(colourOf(a.trim_color ?? a.trim_colour, '"trim_color"', "brown")),
    shoes: R(colourOf(a.shoe_color ?? a.shoe_colour, '"shoe_color"', "#3a2c26")),
    metal: toonRamp(lit(P, P.mat.metal[3]), warm),
    dark: toonRamp(lit(P, mix(P.mat.metal[1], P.outline, 0.4)), warm),
    glass: toonRamp(lit(P, mix(P.mat.glass[2], P.outline, 0.35)), warm),
    wood: toonRamp(lit(P, P.mat.trunk[2]), warm),
    gold: toonRamp(lit(P, P.mat.gold[2]), warm),
    white: toonRamp(lit(P, hex("#e8e6ee")), warm),
    shirt: toonRamp(lit(P, hex("#dcd8d0")), warm),
    glow: accentOf(P, a.glow_color ?? a.glow_colour, '"glow_color"') ?? P.accent[0],
    hatc: a.hat_color ?? a.hat_colour ? R(colourOf(a.hat_color ?? a.hat_colour, '"hat_color"')) : null,
    style: one(a.hair, lists.hair, "hair", "short"),
    outfit,
    hat: one(a.hat, hats, "hat", "none"),
    item,
    stance, pose,
    expression: one(a.expression, EXPRESSIONS, "expression", "neutral"),
    visor: one(a.visor, VISORS, "visor", "up"),
    arms,
    hologram: a.hologram === true || a.hologram === "true",
    chrome: skinText === "chrome",
    W: (build === "slim" ? 0.88 : build === "stout" ? 1.16 : 1) * (stance === "lanky" ? 0.88 : stance === "heavy" ? 1.16 : 1),
    T: (build === "small" ? 0.88 : 1) * (stance === "lanky" ? 1.08 : stance === "heavy" ? 0.96 : 1),
  };
  if (B.hat === "mohawk") [B.style, B.hat] = ["mohawk", "none"];
  const frames: Img[] = [];
  const tags: { name: string; from: number; to: number; loop?: boolean }[] = [];
  const durations: number[] = [];
  for (const dir of HD_DIRECTIONS) {
    for (const [anim, count, ms] of HD_ANIMS) {
      tags.push({ name: `${anim}_${dir}`, from: frames.length, to: frames.length + count - 1, ...(anim === "attack" || anim === "hurt" || anim === "roll" || anim === "dash_attack" ? { loop: false } : {}) });
      for (let i = 0; i < count; i++) {
        frames.push(drawFrame(B, anim, i, dir));
        durations.push(ms[i]!);
      }
    }
  }
  const made = writeSheet(name, { frames, tags, durations, hitbox: HD_HITBOX, pivot: HD_PIVOT }, put);
  const py = Math.round((HD_PIVOT.y / HD_FRAME) * 1000) / 1000;
  const hb = HD_HITBOX;
  return {
    text: [
      made.text,
      `the detailed style: a bold body about 44x64 in ${HD_FRAME}x${HD_FRAME} frames (draw it at sx = 1.5, sy = 1.5: 96 units high on the screen): ${build} build, ${stance} stance, pose ${pose}, ${skinText} skin, ${B.style} hair, ${outfit}, hat ${B.hat}${B.hat === "visor" ? ` (${B.visor})` : ""}, item ${item}, expression ${B.expression}${arms > 2 ? `, ${arms} arms` : ""}${B.hologram ? ", a hologram" : ""}; palette "${P.name}"`,
      `animations, each facing down, left, right and up: idle_<dir> (4: weight shift), walk_<dir> (6), attack_<dir> (4: anticipation, the smear with the arc, overshoot, settle; plays once), hurt_<dir> (2: a squash; once), roll_<dir> (5: a tumble with a streak; once), run_<dir> (8: a sprint, leaning in, a long stride with a frame in the air, arms pumping, the coat streaming behind; a cycle is 0.36 s, which keeps step with 235 world units a second), tell_<dir> (2: wound up to strike, then the same with a flash in the glow colour; loop it for the 0.4 s before an enemy's attack), dash_attack_<dir> (4: a low lunge with a wide flat slash and speed lines, then a skid; once, 0.37 s)`,
      `In its entity: sprite = "${name}", anim = "idle_down", pivot = { 0.5, ${py} }, hitbox = { ${hb.x - HD_PIVOT.x}, ${hb.y - HD_PIVOT.y}, ${hb.w}, ${hb.h} }, sx = 1.5, sy = 1.5; then self:play("walk_" .. dir). The hitbox is the feet's (14x8 pixels, 21x12 on the screen). The same pivot and hitbox are in the .sprite.json.`,
    ].join("\n"),
    picture: made.picture,
  };
}

export { ramp };
