// A starting point for a character: ONE connected mesh in an A-pose (arms down and out), skinned to a 15-part skeleton with the same part names as the Person
// template ("hips", "spine", "head", "left arm", "left forearm", "left hand", "left thigh", "left shin", "left foot" and the same for the right).
// It is built the way a person would box-model it: a torso from a few rings, then legs, arms, neck and head pulled out of its faces with the editor's own
// extrude. Left is +x, the front is +z, the feet are on y = 0, and it is 1.8 m tall at the default scale. Weights come from the nearest bones, to be painted by hand.
import { fitBounds, type Cube, type ModelDoc, type Part, type Skin, type Vec3 } from "../lib/model-doc";
import { extrudeFace, faceCentre, faceNormal } from "../lib/mesh-edit";
import { rotateAbout } from "../lib/point-transform";

const K = 0.9; // the sketch below is 32 units tall; scaled so that the figure is 1.8 m at 1/16 metre a unit
const A_POSE = Math.PI / 4; // how far the arms hang down from straight out

const SKIN = "#e0b08a";
const SHIRT = "#4f7fd1";
const TROUSERS = "#3d4660";
const SHOES = "#2c2c34";

type V = [number, number, number];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];

// ---- the joints, in the sketch's units (x across, y up, z forward) ------------------------------------------------------------
const SHOULDER: V = [4.4, 22.5, 0];
const ARM: V = [Math.cos(A_POSE), -Math.sin(A_POSE), 0]; // the direction an arm points in
const ELBOW = add(SHOULDER, mul(ARM, 6.5));
const WRIST = add(SHOULDER, mul(ARM, 12.5));
const HAND_END = add(SHOULDER, mul(ARM, 15.5));
const mirrorX = (p: V): V => [-p[0], p[1], p[2]];

interface Joint {
  name: string;
  parent: string | null;
  at: V; // world, unscaled
  to: V; // where the bone points to (its far end), world, for the weights
}
const side = (s: "left" | "right"): Joint[] => {
  const f = s === "left" ? (p: V) => p : mirrorX;
  return [
    { name: `${s} arm`, parent: "spine", at: f(SHOULDER), to: f(ELBOW) },
    { name: `${s} forearm`, parent: `${s} arm`, at: f(ELBOW), to: f(WRIST) },
    { name: `${s} hand`, parent: `${s} forearm`, at: f(WRIST), to: f(HAND_END) },
    { name: `${s} thigh`, parent: "hips", at: f([2, 13, 0]), to: f([2, 7.5, 0]) },
    { name: `${s} shin`, parent: `${s} thigh`, at: f([2, 7.5, 0]), to: f([2, 1.5, 0]) },
    { name: `${s} foot`, parent: `${s} shin`, at: f([2, 1.5, 0]), to: f([2, 0.75, 4]) },
  ];
};
const JOINTS: Joint[] = [
  { name: "hips", parent: null, at: [0, 14, 0], to: [0, 16, 0] },
  { name: "spine", parent: "hips", at: [0, 16, 0], to: [0, 24.5, 0] },
  { name: "head", parent: "spine", at: [0, 24.5, 0], to: [0, 31.6, 0] },
  ...side("left"),
  ...side("right"),
];

// ---- the mesh --------------------------------------------------------------------------------------------------------------------
const ring = (y: number, hx: number, hz: number): V[] => [[-hx, y, -hz], [0, y, -hz], [hx, y, -hz], [hx, y, hz], [0, y, hz], [-hx, y, hz]];

function torso(): Cube {
  const levels: [number, number, number][] = [[13, 4, 2.4], [17, 3.6, 2.2], [21, 4.2, 2.4], [24, 4.4, 2.4]];
  const verts: V[] = [];
  const rings: number[][] = levels.map(([y, hx, hz]) => ring(y, hx, hz).map((p) => verts.push(p) - 1));
  const polys: { v: number[] }[] = [];
  for (let i = 0; i + 1 < rings.length; i++) for (let k = 0; k < 6; k++) polys.push({ v: [rings[i]![k]!, rings[i + 1]![k]!, rings[i + 1]![(k + 1) % 6]!, rings[i]![(k + 1) % 6]!] });
  const b = rings[0]!;
  polys.push({ v: [b[0]!, b[1]!, b[4]!, b[5]!] }); // 18: the bottom, right half (the figure's right, -x)
  polys.push({ v: [b[1]!, b[2]!, b[3]!, b[4]!] }); // 19: the bottom, left half
  polys.push({ v: [...rings[3]!].reverse() }); // 20: the top
  const cube: Cube = { name: "body", shape: "mesh", from: [0, 0, 0], size: [0, 0, 0], color: SHIRT, verts, polys };
  fitBounds(cube);
  return cube;
}

/// The first face (from `from`) whose normal points along `dir` and whose middle satisfies `where`.
function findFace(c: Cube, dir: V, where: (m: V) => boolean, from = 0): number {
  for (let i = from; i < c.polys!.length; i++) {
    const n = faceNormal(c, i);
    if (n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2] > 0.9 && where(faceCentre(c, i))) return i;
  }
  throw new Error("no such face");
}

/// Pulls a chain of extrusions out of a face: each step is `[distance, shrink]`. Returns the mesh and the numbers of every point made.
function pull(c: Cube, face: number, steps: [number, number][]): { cube: Cube; made: number[] } {
  let cube = c;
  const made: number[] = [];
  for (const [d, s] of steps) {
    const r = extrudeFace(cube, face, d, s);
    cube = r.cube;
    made.push(...r.points);
  }
  return { cube, made };
}

function build(): Cube {
  let c = torso();

  // legs: out of the two bottom halves, tapering; the foot goes forward off the last wall
  for (const [face, sx] of [[19, 1], [18, -1]] as [number, number][]) {
    const before = c.polys!.length;
    c = pull(c, face, [[5.5, 0.25], [6, 0.12], [1.5, 0]]).cube;
    const toe = findFace(c, [0, 0, 1], (m) => m[1] < 1.6 && m[0] * sx > 0, before);
    c = pull(c, toe, [[3.5, 0.1]]).cube;
  }

  // arms: out of the sides of the chest, straight out, then the whole arm turned down into an A
  for (const [face, sx] of [[14, 1], [17, -1]] as [number, number][]) {
    const n0 = c.verts!.length;
    const r = pull(c, face, [[6.5, 0.22], [6, 0.12], [3, 0.25], [0.8, 0.3]]);
    c = r.cube;
    const pivot: V = [sx * SHOULDER[0], SHOULDER[1], 0];
    for (let i = n0; i < c.verts!.length; i++) c.verts![i] = rotateAbout(c.verts![i]!, pivot, [0, 0, 1], -sx * A_POSE);
  }

  // neck and head out of the top: a narrow neck, a short slope out to the jaw, the head, and a slightly smaller crown
  let neck = pull(c, 20, [[1, 0.55], [0.5, 0]]);
  c = neck.cube;
  const cap = neck.made.slice(-c.polys![20]!.v.length);
  const mid = cap.reduce<V>((s, i) => add(s, c.verts![i]!), [0, 0, 0]);
  const centre: V = mul(mid, 1 / cap.length);
  for (const i of cap) {
    const p = c.verts![i]!;
    c.verts![i] = [centre[0] + (p[0] - centre[0]) * 1.65, p[1], centre[2] + (p[2] - centre[2]) * 3.2];
  }
  c = pull(c, 20, [[5.5, 0], [0.6, 0.25]]).cube;

  // colours by region, to be repainted
  c.polys!.forEach((p, i) => {
    const m = faceCentre(c, i);
    const distFromShoulder = Math.hypot(Math.abs(m[0]) - SHOULDER[0], m[1] - SHOULDER[1]);
    let colour = SHIRT;
    if (m[1] > 24.9) colour = SKIN;
    else if (Math.abs(m[0]) > 4.5 && m[1] > 10) colour = distFromShoulder > 7.5 ? SKIN : SHIRT;
    else if (m[1] < 13.2) colour = m[1] < 1.6 ? SHOES : TROUSERS;
    if (colour !== c.color) p.color = colour;
  });

  // the whole figure to size
  c.verts = c.verts!.map((p) => mul(p, K));
  fitBounds(c);
  return c;
}

/// Weights from the distance to each bone's line: the nearest few bones share a point, the nearer one more.
function weigh(c: Cube, prefix: string): Skin {
  const paths = new Map<string, string>();
  const byName = new Map(JOINTS.map((j) => [j.name, j]));
  const path = (name: string): string => {
    const cached = paths.get(name);
    if (cached) return cached;
    const j = byName.get(name)!;
    const p = j.parent ? `${path(j.parent)}/${name}` : `${prefix}/${name}`;
    paths.set(name, p);
    return p;
  };
  const bones = JOINTS.map((j) => path(j.name));
  const seg = (p: V, a: V, b: V): number => {
    const ab: V = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const l2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
    const t = l2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / l2));
    return Math.hypot(p[0] - (a[0] + ab[0] * t), p[1] - (a[1] + ab[1] * t), p[2] - (a[2] + ab[2] * t));
  };
  const weights = c.verts!.map((v) => {
    const p = mul(v, 1 / K);
    const raw = JOINTS.map((j, i) => ({ i, w: 1 / (seg(p, j.at, j.to) + 1) ** 3 })).sort((a, b) => b.w - a.w);
    const top = raw.slice(0, 4).filter((r) => r.w >= raw[0]!.w * 0.05);
    const sum = top.reduce((n, r) => n + r.w, 0);
    const pairs = top.map((r) => [r.i, Math.round((r.w / sum) * 10000) / 10000] as [number, number]);
    const total = pairs.reduce((n, [, w]) => n + w, 0);
    pairs[0]![1] = Math.round((pairs[0]![1] + (1 - total)) * 10000) / 10000;
    return pairs;
  });
  return { bones, weights };
}

const part = (name: string, origin: V, children: Part[] = [], cubes: Cube[] = []): Part => ({ name, origin, rotation: [0, 0, 0], cubes, children });

/// The model: the skeleton (a part tree, left is +x) and the one skinned mesh, in a part of its own.
export function heroBase(name = "hero"): ModelDoc {
  const mesh = build();
  mesh.skin = weigh(mesh, name);
  const at = (j: Joint): V => {
    const parent = j.parent ? JOINTS.find((x) => x.name === j.parent)!.at : ([0, 0, 0] as V);
    return mul([j.at[0] - parent[0], j.at[1] - parent[1], j.at[2] - parent[2]], K);
  };
  const tree = (parent: string | null): Part[] =>
    JOINTS.filter((j) => j.parent === parent).map((j) => part(j.name, at(j), tree(j.name)));
  const hips = tree(null)[0]!;
  const root: Part = part(name, [0, 0, 0], [part("hips", mul(JOINTS[0]!.at, K), hips.children), part("body", [0, 0, 0], [], [mesh])]);
  return { version: 1, scale: 1 / 16, symmetry: "x", parts: [root] };
}
