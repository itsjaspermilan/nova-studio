// Rigs the character base (`hero-base.ts`, then modelled by hand): puts the arm joints where the modelled arms are, works the skin weights out again for the whole
// mesh from the bones' places, and writes the animation clips: idle, walk, run, crouch, crouch-walk, jump, fall and an "aim" pose for the arms (a layer, over the legs
// of any of the others). Everything else of the model (its points, faces, colours, symmetry) is left as the person made it. Run with NOVA_RIG_HERO=<models folder>, see
// hero-rig.test.ts.
//
// Turns in a clip are degrees about the part's own x, y and z (three.js "XYZ"; the parts are authored with no turn, so x is across, y up, z forward). For a limb that hangs
// down, a NEGATIVE turn about x swings it forward and a positive one back; for things that stand up (the spine, the head) it is the other way round.
import { eulerToQuaternion } from "../lib/model-ease";
import type { Clip, Cube, ModelDoc, Part, Prop, Skin, Track, Vec3 } from "../lib/model-doc";

type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const len = (a: V) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V): V => mul(a, 1 / (len(a) || 1));
const deg = (r: number) => (r * 180) / Math.PI;
const round = (n: number, p = 100) => Math.round(n * p) / p;

// ---- walking the part tree -------------------------------------------------------------------------------------------------------

interface Found {
  part: Part;
  path: string[]; // names from the top part
  world: V; // where its pivot is at rest (the parts are authored with no turn)
}
function walk(parts: Part[], parent: string[] = [], at: V = [0, 0, 0], out: Found[] = []): Found[] {
  for (const p of parts) {
    const path = [...parent, p.name];
    const world = add(at, p.origin as V);
    out.push({ part: p, path, world });
    walk(p.children, path, world, out);
  }
  return out;
}
const find = (all: Found[], name: string): Found => {
  const f = all.find((x) => x.part.name === name);
  if (!f) throw new Error(`the model has no part called "${name}"`);
  return f;
};

// ---- fitting the arm joints to the arms as modelled ----------------------------------------------------------------------------------

/// Where along an arm (from the shoulder to the fingertips) the elbow and the wrist are: the base builds it as rings 6.5, 12.5 and 16.3 units out.
const ELBOW_AT = 6.5 / 16.3;
const WRIST_AT = 12.5 / 16.3;

/// The arm's points: the ones out beyond the side of the chest, on that side.
function armPoints(mesh: Cube, shoulder: V, side: 1 | -1): V[] {
  const reach = Math.abs(shoulder[0]) + 0.3;
  return (mesh.verts ?? []).filter((p) => p[0] * side > reach) as V[];
}

interface Arm {
  elbow: V;
  wrist: V;
  tip: V;
}
function fitArm(mesh: Cube, shoulder: V, side: 1 | -1): Arm {
  const pts = armPoints(mesh, shoulder, side);
  if (pts.length < 8) throw new Error("could not find the arm's points");
  const far = Math.max(...pts.map((p) => len(sub(p, shoulder))));
  const ring = pts.filter((p) => len(sub(p, shoulder)) > far * 0.93);
  const end = mul(ring.reduce((s, p) => add(s, p), [0, 0, 0] as V), 1 / ring.length);
  const dir = unit(sub(end, shoulder));
  const L = Math.max(...pts.map((p) => (p[0] - shoulder[0]) * dir[0] + (p[1] - shoulder[1]) * dir[1] + (p[2] - shoulder[2]) * dir[2]));
  const at = (f: number): V => add(shoulder, mul(dir, L * f));
  return { elbow: at(ELBOW_AT), wrist: at(WRIST_AT), tip: at(1) };
}

// ---- weights --------------------------------------------------------------------------------------------------------------------

function weigh(mesh: Cube, bones: { path: string; from: V; to: V }[]): Skin {
  const seg = (p: V, a: V, b: V): number => {
    const ab = sub(b, a);
    const l2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
    const t = l2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / l2));
    return len(sub(p, add(a, mul(ab, t))));
  };
  const weights = (mesh.verts ?? []).map((p) => {
    const raw = bones.map((b, i) => ({ i, w: 1 / (seg(p as V, b.from, b.to) + 1) ** 3 })).sort((a, b) => b.w - a.w);
    const top = raw.slice(0, 4).filter((r) => r.w >= raw[0]!.w * 0.05);
    const sum = top.reduce((n, r) => n + r.w, 0);
    const pairs = top.map((r) => [r.i, Math.round((r.w / sum) * 10000) / 10000] as [number, number]);
    const total = pairs.reduce((n, [, w]) => n + w, 0);
    pairs[0]![1] = Math.round((pairs[0]![1] + (1 - total)) * 10000) / 10000;
    return pairs;
  });
  return { bones: bones.map((b) => b.path), weights };
}

// ---- turns -----------------------------------------------------------------------------------------------------------------------

type Q = [number, number, number, number]; // x, y, z, w
const qmul = (a: Q, b: Q): Q => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qconj = (q: Q): Q => [-q[0], -q[1], -q[2], q[3]];
/// The shortest turn that takes direction `a` to direction `b`.
export function arc(a: V, b: V): Q {
  const u = unit(a);
  const v = unit(b);
  const d = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  if (d < -0.999999) return [0, 0, 1, 0];
  const c: V = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const q: Q = [c[0], c[1], c[2], 1 + d];
  const l = Math.hypot(...q);
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}
/// A turn as degrees about x, y and z, as the studio keeps them (three.js "XYZ").
export function toEuler(q: Q): V {
  const [x, y, z, w] = q;
  const m11 = 1 - 2 * (y * y + z * z);
  const m12 = 2 * (x * y - z * w);
  const m13 = 2 * (x * z + y * w);
  const m22 = 1 - 2 * (x * x + z * z);
  const m23 = 2 * (y * z - x * w);
  const m32 = 2 * (y * z + x * w);
  const m33 = 1 - 2 * (x * x + y * y);
  const ey = Math.asin(Math.max(-1, Math.min(1, m13)));
  if (Math.abs(m13) < 0.9999999) return [round(deg(Math.atan2(-m23, m33)), 1000), round(deg(ey), 1000), round(deg(Math.atan2(-m12, m11)), 1000)];
  return [round(deg(Math.atan2(m32, m22)), 1000), round(deg(ey), 1000), 0];
}
export const turnOf = (e: Vec3): Q => eulerToQuaternion(e) as Q;

// ---- the clips -------------------------------------------------------------------------------------------------------------------

type Keys = [number, V][];
interface Rig {
  top: string;
  paths: Map<string, string[]>;
  hipsY: number;
  thighDrop: number; // the thigh's pivot below the hips
  thighLen: number;
  shinLen: number;
  ankleAbove: number; // how high the ankle is when standing
}

export function makeClips(rig: Rig, aim: { arm: Record<string, V>; forearm: Record<string, V> }): Clip[] {
  const track = (part: string, prop: Prop, keys: Keys): Track => ({ part: rig.paths.get(part)!, prop, keys: keys.map(([t, value]) => ({ t: round(t, 1000), value: value.map((n) => round(n)) as V })) });

  /// A looping clip of `n` samples of `f(phase)` over `duration`, the last key equal to the first.
  const cycle = (name: string, duration: number, n: number, f: (phi: number) => Record<string, V>, extra: Track[] = []): Clip => {
    const byTrack = new Map<string, Keys>();
    for (let i = 0; i <= n; i++) {
      const t = (duration * i) / n;
      const pose = f(((i % n) / n) * Math.PI * 2);
      for (const [k, v] of Object.entries(pose)) (byTrack.get(k) ?? byTrack.set(k, []).get(k)!).push([t, v]);
    }
    const tracks = [...byTrack].map(([k, keys]) => {
      const [part, prop] = k.split(":") as [string, Prop];
      return track(part, prop, keys);
    });
    return { name, duration, loop: true, tracks: [...tracks, ...extra] };
  };

  /// How high the ankle of a leg is below the hips with the thigh and the shin turned about x by these degrees.
  const ankle = (t: number, s: number) => -rig.thighDrop - rig.thighLen * Math.cos((t * Math.PI) / 180) - rig.shinLen * Math.cos(((t + s) * Math.PI) / 180);
  /// The hips' height that puts the lower of the two feet on the floor.
  const hipsOver = (tl: number, sl: number, tr: number, sr: number) => rig.ankleAbove - Math.min(ankle(tl, sl), ankle(tr, sr));

  /// The turn of a leg and its foot; the foot keeps flat, less `toeUp` degrees.
  const legs = (tl: number, sl: number, tr: number, sr: number, flat = 0.6): Record<string, V> => ({
    "left thigh:rotation": [tl, 0, 0],
    "left shin:rotation": [sl, 0, 0],
    "left foot:rotation": [-(tl + sl) * flat, 0, 0],
    "right thigh:rotation": [tr, 0, 0],
    "right shin:rotation": [sr, 0, 0],
    "right foot:rotation": [-(tr + sr) * flat, 0, 0],
  });
  const hips = (y: number): Record<string, V> => ({ "hips:position": [0, y, 0] });

  const clips: Clip[] = [];

  clips.push(
    cycle("idle", 2.4, 4, (phi) => ({
      "spine:rotation": [1.2 * Math.sin(phi), 0, 0],
      "head:rotation": [-0.8 * Math.sin(phi - 0.6), 0, 0],
      "left arm:rotation": [1.5 * Math.sin(phi + 1), 0, 0],
      "right arm:rotation": [1.5 * Math.sin(phi + 1), 0, 0],
      "left forearm:rotation": [-5, 0, 0],
      "right forearm:rotation": [-5, 0, 0],
    })),
  );

  const walk = (phi: number) => {
    const tl = -30 * Math.cos(phi);
    const tr = 30 * Math.cos(phi);
    const sl = 4 + 48 * Math.max(0, -Math.sin(phi));
    const sr = 4 + 48 * Math.max(0, Math.sin(phi));
    return {
      ...legs(tl, sl, tr, sr),
      ...hips(rig.hipsY - (rig.hipsY - hipsOver(tl, sl, tr, sr))),
      "left arm:rotation": [20 * Math.cos(phi), 0, 0] as V,
      "right arm:rotation": [-20 * Math.cos(phi), 0, 0] as V,
      "left forearm:rotation": [-(16 - 8 * Math.cos(phi)), 0, 0] as V,
      "right forearm:rotation": [-(16 + 8 * Math.cos(phi)), 0, 0] as V,
      "spine:rotation": [3, 4 * Math.cos(phi), 0] as V,
      "hips:rotation": [0, -4 * Math.cos(phi), 0] as V,
    };
  };
  clips.push(cycle("walk", 0.8, 8, walk));

  clips.push(
    cycle("run", 0.56, 8, (phi) => {
      const tl = -10 - 45 * Math.cos(phi);
      const tr = -10 + 45 * Math.cos(phi);
      const sl = 12 + 85 * Math.max(0, -Math.sin(phi));
      const sr = 12 + 85 * Math.max(0, Math.sin(phi));
      return {
        ...legs(tl, sl, tr, sr, 0.5),
        ...hips(hipsOver(tl, sl, tr, sr) + 0.9 * Math.abs(Math.sin(phi))),
        "left arm:rotation": [45 * Math.cos(phi), 0, 0],
        "right arm:rotation": [-45 * Math.cos(phi), 0, 0],
        "left forearm:rotation": [-(75 - 20 * Math.cos(phi)), 0, 0],
        "right forearm:rotation": [-(75 + 20 * Math.cos(phi)), 0, 0],
        "spine:rotation": [10, 6 * Math.cos(phi), 0],
        "hips:rotation": [0, -6 * Math.cos(phi), 0],
        "head:rotation": [-8, 0, 0],
      };
    }),
  );

  const crouchHips = (tl: number, sl: number, tr: number, sr: number) => hipsOver(tl, sl, tr, sr);
  clips.push(
    cycle("crouch", 2, 4, (phi) => ({
      ...legs(-62, 100, -62, 100, 1),
      ...hips(crouchHips(-62, 100, -62, 100)),
      "spine:rotation": [20 + 1.2 * Math.sin(phi), 0, 0],
      "head:rotation": [-18, 0, 0],
      "left forearm:rotation": [-10, 0, 0],
      "right forearm:rotation": [-10, 0, 0],
    })),
  );
  clips.push(
    cycle("crouch_walk", 1, 8, (phi) => {
      const tl = -58 - 16 * Math.cos(phi);
      const tr = -58 + 16 * Math.cos(phi);
      const sl = 98 - 6 * Math.cos(phi) + 14 * Math.max(0, -Math.sin(phi));
      const sr = 98 + 6 * Math.cos(phi) + 14 * Math.max(0, Math.sin(phi));
      return {
        ...legs(tl, sl, tr, sr, 1),
        ...hips(crouchHips(tl, sl, tr, sr)),
        "spine:rotation": [20, 3 * Math.cos(phi), 0],
        "head:rotation": [-18, 0, 0],
        "left arm:rotation": [8 * Math.cos(phi), 0, 0],
        "right arm:rotation": [-8 * Math.cos(phi), 0, 0],
        "left forearm:rotation": [-14, 0, 0],
        "right forearm:rotation": [-14, 0, 0],
      };
    }),
  );

  const air = (name: string, tl: number, sl: number, tr: number, sr: number, armUp: number, lean: number): Clip =>
    cycle(name, 0.4, 2, () => ({
      ...legs(tl, sl, tr, sr, 1),
      ...hips(rig.hipsY),
      "left arm:rotation": [0, 0, armUp],
      "right arm:rotation": [0, 0, -armUp],
      "left forearm:rotation": [-22, 0, 0],
      "right forearm:rotation": [-22, 0, 0],
      "spine:rotation": [lean, 0, 0],
      "head:rotation": [-6, 0, 0],
    }));
  clips.push(air("jump", -50, 80, -22, 40, 55, 6));
  clips.push(air("fall", -16, 24, -6, 12, 80, 2));

  // the aim pose: the arms hold a gun out in front. Only the arms are keyed (lay it over the others with a mask on the arms).
  const holds = (side: "left" | "right"): Track[] => [
    track(`${side} arm`, "rotation", [[0, aim.arm[side]!], [0.1, aim.arm[side]!]]),
    track(`${side} forearm`, "rotation", [[0, aim.forearm[side]!], [0.1, aim.forearm[side]!]]),
    track(`${side} hand`, "rotation", [[0, [0, 0, 0]], [0.1, [0, 0, 0]]]),
  ];
  clips.push({ name: "aim", duration: 0.1, loop: true, tracks: [...holds("right"), ...holds("left")] });
  return clips;
}

// ---- the rig ---------------------------------------------------------------------------------------------------------------------

/// The model rigged: arm joints fitted, weights worked out again, clips written. The points, faces and everything else are as they were.
export function rigHero(source: ModelDoc): { doc: ModelDoc; notes: string[] } {
  const doc: ModelDoc = JSON.parse(JSON.stringify(source));
  const notes: string[] = [];
  const all = walk(doc.parts);
  const top = doc.parts[0]!.name;
  let mesh: Cube | undefined;
  for (const f of all) for (const c of f.part.cubes) if (c.shape === "mesh" && c.skin) mesh = c;
  if (!mesh) throw new Error("the model has no skinned mesh");

  // the arms
  const arms: Record<string, Arm> = {};
  for (const [side, sign] of [["left", 1], ["right", -1]] as const) {
    const shoulder = find(all, `${side} arm`).world;
    const arm = fitArm(mesh, shoulder, sign);
    arms[side] = arm;
    const forearm = find(all, `${side} forearm`);
    const hand = find(all, `${side} hand`);
    const wasElbow = forearm.part.origin as V;
    forearm.part.origin = sub(arm.elbow, shoulder).map((n) => round(n, 1000)) as Vec3;
    hand.part.origin = sub(arm.wrist, arm.elbow).map((n) => round(n, 1000)) as Vec3;
    notes.push(`${side} arm: elbow joint moved by ${len(sub(forearm.part.origin as V, wasElbow)).toFixed(2)} units to fit the modelled arm`);
  }
  const placed = walk(doc.parts); // the joints now

  // the bones for the weights: each from its pivot to the pivot of its first child (or a sensible end)
  const bones = (mesh.skin!.bones as string[]).map((path) => {
    const names = path.split("/");
    const f = placed.find((x) => x.path.join("/") === path);
    if (!f) throw new Error(`the skin names a part that is gone: ${path}`);
    const name = names.at(-1)!;
    const kid = f.part.children[0];
    const sideOf = name.startsWith("right") ? "right" : "left";
    let to: V;
    if (kid) to = placed.find((x) => x.path.join("/") === `${path}/${kid.name}`)!.world;
    else if (name.endsWith("hand")) to = arms[sideOf]!.tip;
    else if (name.endsWith("foot")) to = [f.world[0], f.world[1] - 0.7, f.world[2] + 3.6];
    else to = [f.world[0], Math.max(...(mesh!.verts ?? []).map((p) => p[1])), f.world[2]]; // the head
    return { path, from: f.world, to };
  });
  mesh.skin = weigh(mesh, bones);
  notes.push(`weights worked out again for ${mesh.verts!.length} points on ${bones.length} bones`);

  // the clips
  const hips = find(placed, "hips");
  const thigh = find(placed, "left thigh");
  const shin = find(placed, "left shin");
  const foot = find(placed, "left foot");
  const rig: Rig = {
    top,
    paths: new Map(placed.map((f) => [f.part.name, f.path])),
    hipsY: hips.part.origin[1],
    thighDrop: -(thigh.part.origin[1]),
    thighLen: -(shin.part.origin[1]),
    shinLen: -(foot.part.origin[1]),
    ankleAbove: foot.world[1],
  };
  // the aim pose: the upper arms point forward and a little in, the forearms forward and up a little, so that the hands meet in front of the chest
  const aimArm: Record<string, V> = {};
  const aimFore: Record<string, V> = {};
  for (const side of ["left", "right"] as const) {
    const sign = side === "left" ? 1 : -1;
    const arm = arms[side]!;
    const restUpper = unit(sub(arm.elbow, find(placed, `${side} arm`).world));
    const restFore = unit(sub(arm.wrist, arm.elbow));
    const upper = arc(restUpper, unit([-sign * 0.35, -0.5, 1]));
    const fore = arc(restFore, unit([-sign * 0.2, 0.12, 1]));
    aimArm[side] = toEuler(upper);
    aimFore[side] = toEuler(qmul(qconj(upper), fore));
  }
  doc.clips = makeClips(rig, { arm: aimArm, forearm: aimFore });
  notes.push(`clips: ${doc.clips.map((c) => c.name).join(", ")}`);
  return { doc, notes };
}
