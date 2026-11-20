// Less typing for model_write. Two shapes that become an ordinary free mesh when the model is written (`tube`: a round
// limb along points; `lathe`: a profile turned about an axis), and clips written with where the feet go instead of joint
// angles (`ik`, or a `walk` made from a stride), which become ordinary rotation keys. The file that is written holds
// only what the model editor knows: meshes and keys a person could have typed.

type Vec3 = [number, number, number];
type Args = Record<string, any>;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const isVec3 = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n));

/// A polygon's points in the order that makes it face `out` (counter-clockwise seen from outside).
function facing(verts: Vec3[], v: number[], out: Vec3): number[] {
  const n: Vec3 = [0, 0, 0];
  for (let i = 0; i < v.length; i++) {
    const a = verts[v[i]!]!, b = verts[v[(i + 1) % v.length]!]!;
    n[0] += (a[1] - b[1]) * (a[2] + b[2]);
    n[1] += (a[2] - b[2]) * (a[0] + b[0]);
    n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return dot(n, out) < 0 ? [...v].reverse() : v;
}

const middle = (verts: Vec3[], v: number[]): Vec3 => mul(v.reduce((s, i) => add(s, verts[i]!), [0, 0, 0] as Vec3), 1 / v.length);

/// What a shape keeps when it becomes a mesh: everything but the keys that described it.
function asMesh(shape: Args, drop: string[], verts: Vec3[], polys: number[][]): Args {
  const rest = Object.fromEntries(Object.entries(shape).filter(([k]) => !drop.includes(k) && k !== "shape" && k !== "from" && k !== "size"));
  const smooth = shape.smooth !== false;
  // (a mesh's box is the box round its points)
  const lo = [0, 1, 2].map((k) => r3(Math.min(...verts.map((p) => p[k]!))));
  const hi = [0, 1, 2].map((k) => r3(Math.max(...verts.map((p) => p[k]!))));
  return { shape: "mesh", from: lo, size: hi.map((v, k) => r3(v - lo[k]!)), ...rest, verts: verts.map((p) => p.map(r3) as Vec3), polys: polys.map((v) => (smooth ? { v, smooth: true } : { v })) };
}

/// `{ "shape": "tube", "points": [[x, y, z], ...], "radius": 2 | "radii": [2, 1.6, ...], "segments": 8, "caps": true }`:
/// a ring of `segments` points round each point of the path, joined by four-sided faces, with a flat end at each end.
function tube(shape: Args, at: string): Args {
  const pts: unknown = shape.points;
  if (!Array.isArray(pts) || pts.length < 2 || !pts.every(isVec3)) throw new Error(`${at}: a tube needs "points": at least two [x, y, z] along its middle`);
  const radii: number[] = Array.isArray(shape.radii) ? shape.radii : pts.map(() => shape.radius);
  if (radii.length !== pts.length || !radii.every((r) => typeof r === "number" && r > 0)) throw new Error(`${at}: a tube needs "radius" (a number above 0) or "radii" (one for each of its ${pts.length} points)`);
  const n = Math.round(shape.segments ?? 8);
  if (!(n >= 3 && n <= 32)) throw new Error(`${at}: "segments" is how many points go round the tube, from 3 to 32`);
  const verts: Vec3[] = [], polys: number[][] = [];
  let u: Vec3 = [0, 0, 0];
  const path = pts as Vec3[];
  path.forEach((p, i) => {
    const t = unit(sub(path[Math.min(path.length - 1, i + 1)]!, path[Math.max(0, i - 1)]!));
    // (the ring's first direction is carried along the path, so the tube does not twist)
    const seed: Vec3 = i === 0 ? (Math.abs(t[0]) > 0.9 ? [0, 0, 1] : [1, 0, 0]) : u;
    u = unit(sub(seed, mul(t, dot(seed, t))));
    const v = cross(t, u);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * 2 * Math.PI;
      verts.push(add(p, add(mul(u, Math.cos(a) * radii[i]!), mul(v, Math.sin(a) * radii[i]!))));
    }
  });
  for (let i = 0; i < path.length - 1; i++) {
    for (let k = 0; k < n; k++) {
      const q = [i * n + k, i * n + ((k + 1) % n), (i + 1) * n + ((k + 1) % n), (i + 1) * n + k];
      polys.push(facing(verts, q, sub(middle(verts, q), mul(add(path[i]!, path[i + 1]!), 0.5))));
    }
  }
  if (shape.caps !== false) {
    const ring = (i: number) => Array.from({ length: n }, (_, k) => i * n + k);
    polys.push(facing(verts, ring(0), sub(path[0]!, path[1]!)), facing(verts, ring(path.length - 1), sub(path[path.length - 1]!, path[path.length - 2]!)));
  }
  return asMesh(shape, ["points", "radius", "radii", "segments", "caps"], verts, polys);
}

/// `{ "shape": "lathe", "profile": [[radius, height], ...], "segments": 12, "axis": "y", "at": [x, y, z] }`: the profile
/// turned about the axis through `at`. A radius of 0 is a point on the axis (the tip of a cone, the top of a dome).
function lathe(shape: Args, at: string): Args {
  const profile: unknown = shape.profile;
  if (!Array.isArray(profile) || profile.length < 2 || !profile.every((p) => Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === "number" && Number.isFinite(v)) && p[0] >= 0)) {
    throw new Error(`${at}: a lathe needs "profile": at least two [radius, height] pairs along the axis, radius 0 or more`);
  }
  const n = Math.round(shape.segments ?? 12);
  if (!(n >= 3 && n <= 48)) throw new Error(`${at}: "segments" is how many points go round the lathe, from 3 to 48`);
  const axis = shape.axis ?? "y";
  if (!["x", "y", "z"].includes(axis)) throw new Error(`${at}: "axis" is "x", "y" or "z" (got ${JSON.stringify(axis)})`);
  const origin: Vec3 = isVec3(shape.at) ? shape.at : [0, 0, 0];
  if (shape.at !== undefined && !isVec3(shape.at)) throw new Error(`${at}: "at" is [x, y, z], a point on the axis`);
  // (along the axis, and two directions across it)
  const [along, a, b]: [Vec3, Vec3, Vec3] = axis === "y" ? [[0, 1, 0], [1, 0, 0], [0, 0, 1]] : axis === "x" ? [[1, 0, 0], [0, 1, 0], [0, 0, 1]] : [[0, 0, 1], [1, 0, 0], [0, 1, 0]];
  const verts: Vec3[] = [], polys: number[][] = [];
  const rings: number[][] = [];
  const centres: Vec3[] = [];
  for (const [r, h] of profile as [number, number][]) {
    const c = add(origin, mul(along, h));
    centres.push(c);
    if (r < 1e-6) {
      rings.push([verts.push(c) - 1]);
      continue;
    }
    rings.push(Array.from({ length: n }, (_, k) => {
      const t = (k / n) * 2 * Math.PI;
      return verts.push(add(c, add(mul(a, Math.cos(t) * r), mul(b, Math.sin(t) * r)))) - 1;
    }));
  }
  for (let i = 0; i < rings.length - 1; i++) {
    const lo = rings[i]!, hi = rings[i + 1]!;
    if (lo.length === 1 && hi.length === 1) continue;
    for (let k = 0; k < n; k++) {
      const q = lo.length === 1 ? [lo[0]!, hi[k]!, hi[(k + 1) % n]!] : hi.length === 1 ? [lo[k]!, lo[(k + 1) % n]!, hi[0]!] : [lo[k]!, lo[(k + 1) % n]!, hi[(k + 1) % n]!, hi[k]!];
      const mid = middle(verts, q);
      const onAxis = add(origin, mul(along, dot(sub(mid, origin), along)));
      polys.push(facing(verts, q, sub(mid, onAxis)));
    }
  }
  if (shape.caps !== false) {
    const first = rings[0]!, last = rings[rings.length - 1]!;
    const up = (profile as number[][])[profile.length - 1]![1]! >= (profile as number[][])[0]![1]! ? 1 : -1;
    if (first.length > 1) polys.push(facing(verts, first, mul(along, -up)));
    if (last.length > 1) polys.push(facing(verts, last, mul(along, up)));
  }
  return asMesh(shape, ["profile", "segments", "axis", "at", "caps"], verts, polys);
}

// ---- feet --------------------------------------------------------------------------------------------------------------

interface Found {
  part: Args;
  names: string[];
  chain: Args[];
}

function findPart(parts: Args[], name: string, names: string[] = [], chain: Args[] = []): Found[] {
  const out: Found[] = [];
  for (const p of parts ?? []) {
    if (!p || typeof p !== "object") continue;
    const here = { part: p, names: [...names, String(p.name)], chain: [...chain, p] };
    if (p.name === name) out.push(here);
    out.push(...findPart(p.children ?? [], name, here.names, here.chain));
  }
  return out;
}

interface Leg {
  ankle: Found;
  /// The lengths and rest directions of the thigh (hip to knee) and the shin (knee to ankle), in the plane the leg swings in.
  l1: number;
  l2: number;
  rest1: number;
  rest2: number;
}

/// The turn about x that takes "straight down" to the direction (y, z): positive swings a hanging leg back, as the model's
/// rotations do.
const swing = (y: number, z: number) => Math.atan2(-z, -y);
const deg = (r: number) => (r * 180) / Math.PI;

function legOf(model: Args, ankle: string, at: string): Leg {
  const found = findPart(model.parts ?? [], ankle);
  if (found.length !== 1) throw new Error(`${at}: ${found.length ? `${found.length} parts are called "${ankle}"; a foot needs a name of its own` : `there is no part called "${ankle}" (a foot is named by its part: the part above it is the shin, and the one above that the thigh)`}`);
  const f = found[0]!;
  if (f.chain.length < 3) throw new Error(`${at}: "${ankle}" needs two parts above it, a thigh and a shin (hips > leg > shin > ${ankle}); it has ${f.chain.length - 1}`);
  const [thigh, shin, foot] = f.chain.slice(-3) as [Args, Args, Args];
  for (const p of [thigh, shin, foot]) {
    if (!isVec3(p.origin)) throw new Error(`${at}: part "${p.name}" needs an origin`);
    if (Array.isArray(p.rotation) && p.rotation.some((v: number) => Math.abs(v) > 1e-6)) throw new Error(`${at}: part "${p.name}" has a rotation of its own at rest (${JSON.stringify(p.rotation)}); feet are solved for legs whose three parts rest unturned (model the leg hanging down)`);
  }
  for (const p of f.chain.slice(0, -3)) {
    if (Array.isArray(p.rotation) && p.rotation.some((v: number) => Math.abs(v) > 1e-6)) throw new Error(`${at}: part "${p.name}" above the leg is turned at rest; feet are solved under unturned parts`);
  }
  const l1 = Math.hypot(shin.origin[1], shin.origin[2]), l2 = Math.hypot(foot.origin[1], foot.origin[2]);
  if (l1 < 1e-6 || l2 < 1e-6) throw new Error(`${at}: the knee ("${shin.name}") and the ankle ("${foot.name}") must sit below their parents: their origins are where they join, so a thigh 6 long has its shin at [0, -6, 0]`);
  return { ankle: f, l1, l2, rest1: swing(shin.origin[1], shin.origin[2]), rest2: swing(foot.origin[1], foot.origin[2]) };
}

/// A value of a track at a time, straight between its keys.
function valueAt(keys: Args[], t: number): Vec3 {
  if (t <= keys[0]!.t) return keys[0]!.value;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]!, b = keys[i + 1]!;
    if (t <= b.t) {
      const f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
      return [0, 1, 2].map((k) => a.value[k] + (b.value[k] - a.value[k]) * f) as Vec3;
    }
  }
  return keys[keys.length - 1]!.value;
}

const samePath = (a: string[], b: string[]) => a.length === b.length && a.every((n, i) => n === b[i]);

/// Where the hip joint of a leg is in the model at a time: the origins of the parts down to the thigh, each replaced by
/// the clip's own position key for that part when it has one (hips that bob).
function hipAt(clip: Args, leg: Leg, t: number): Vec3 {
  let p: Vec3 = [0, 0, 0];
  const chain = leg.ankle.chain.slice(0, -2);
  chain.forEach((part, i) => {
    const names = leg.ankle.names.slice(0, i + 1);
    const track = (clip.tracks ?? []).find((tr: Args) => tr.prop === "position" && Array.isArray(tr.part) && samePath(tr.part, names) && tr.keys?.length);
    p = add(p, track ? valueAt(track.keys, t) : part.origin);
  });
  return p;
}

/// The turns of thigh, shin and foot (degrees about x) that put the ankle at `target` (model space), the knee forward.
function solve(leg: Leg, hip: Vec3, target: Vec3, pitch: number): { turns: [number, number, number]; short: number } {
  const y = target[1] - hip[1], z = target[2] - hip[2];
  const want = Math.hypot(y, z);
  const d = Math.min(Math.max(want, Math.abs(leg.l1 - leg.l2) + 1e-4), leg.l1 + leg.l2 - 1e-4);
  const to = swing(y, z);
  const bend = Math.acos(Math.min(1, Math.max(-1, (leg.l1 * leg.l1 + d * d - leg.l2 * leg.l2) / (2 * leg.l1 * d))));
  const thighDir = to - bend; // (the knee in front of the line from hip to ankle)
  const t1 = thighDir - leg.rest1;
  const knee: [number, number] = [-Math.cos(thighDir) * leg.l1, -Math.sin(thighDir) * leg.l1];
  const ty = -Math.cos(to) * d, tz = -Math.sin(to) * d;
  const shinDir = swing(ty - knee[0], tz - knee[1]);
  const t2 = shinDir - leg.rest2 - t1;
  return { turns: [deg(t1), deg(t2), -deg(t1 + t2) + pitch], short: Math.max(0, want - (leg.l1 + leg.l2)) };
}

const ankleAtRest = (leg: Leg): Vec3 => leg.ankle.chain.reduce((p, part) => add(p, part.origin), [0, 0, 0] as Vec3);

function writeLeg(clip: Args, leg: Leg, times: number[], target: (t: number) => { at: Vec3; pitch: number }, notes: string[], what: string) {
  const names = leg.ankle.names;
  const paths = [names.slice(0, -2), names.slice(0, -1), names];
  const keys: Args[][] = [[], [], []];
  let short = 0, shortAt = 0, shortHip: Vec3 = [0, 0, 0], shortFoot: Vec3 = [0, 0, 0];
  const restX = ankleAtRest(leg)[0] - hipAt({ tracks: [] }, leg, 0)[0];
  for (const t of times) {
    const g = target(t);
    const hip = hipAt(clip, leg, t);
    const s = solve(leg, hip, g.at, g.pitch);
    if (s.short > short) [short, shortAt, shortHip, shortFoot] = [s.short, t, hip, g.at];
    // sideways: when the hips have moved across (a sway), the whole leg leans from the hip so the foot stays where it is
    // put, and the foot leans back so its sole stays level (+z swings a hanging limb out towards +x)
    const dx = g.at[0] - (hip[0] + restX);
    const lean = Math.abs(dx) > 1e-6 ? deg(Math.atan2(dx, Math.max(1e-6, hip[1] - g.at[1]))) : 0;
    s.turns.forEach((v, i) => keys[i]!.push({ t: r3(t), value: [r3(v), 0, i === 0 ? r3(lean) : i === 2 ? r3(-lean) : 0] }));
  }
  clip.tracks = (clip.tracks ?? []).filter((tr: Args) => !(tr.prop === "rotation" && Array.isArray(tr.part) && paths.some((p) => samePath(p, tr.part))));
  paths.forEach((part, i) => clip.tracks.push({ part, prop: "rotation", keys: keys[i] }));
  if (short > 0.01) {
    const reach = leg.l1 + leg.l2;
    const across = Math.hypot(shortFoot[1] - shortHip[1], shortFoot[2] - shortHip[2]);
    notes.push(
      `WARNING ${what}: the leg ${names.slice(-3).join(" > ")} is ${r3(short)} units too short to reach its foot's place at ${r3(shortAt)} s: it reaches ${r3(reach)} from the hip (thigh ${r3(leg.l1)} + shin ${r3(leg.l2)}), the hip is at height ${r3(shortHip[1])} (z ${r3(shortHip[2])}) then, and the place [${shortFoot.map(r3).join(", ")}] is ${r3(across)} from it. The foot stops short there. ` +
        `Lower the hips (a hips position key, or less "bob"), shorten the stride or bring the place nearer: a planted foot can be at most ${r3(Math.sqrt(Math.max(0, reach * reach - (shortHip[1] - shortFoot[1]) ** 2)))} in front of or behind the hip at that height. A foot on the ground keeps its x and z in the world: in the model it keeps its x and moves back at one steady speed while it is down`,
    );
  }
}

/// How far a foot part's own shapes reach from its ankle: down to the sole, forward to the toe, back to the heel (model units).
function footShape(foot: Args): { sole: number; toe: number; heel: number } | null {
  let sole = Infinity, toe = -Infinity, heel = Infinity;
  for (const c of Array.isArray(foot.cubes) ? foot.cubes : []) {
    if (!c || typeof c !== "object") continue;
    const pts: number[][] = Array.isArray(c.verts) && c.verts.length ? c.verts : Array.isArray(c.from) && Array.isArray(c.size) ? [c.from, [c.from[0] + c.size[0], c.from[1] + c.size[1], c.from[2] + c.size[2]]] : [];
    for (const p of pts) {
      sole = Math.min(sole, p[1]!);
      toe = Math.max(toe, p[2]!);
      heel = Math.min(heel, p[2]!);
    }
  }
  return Number.isFinite(sole) ? { sole, toe, heel } : null;
}

/// A point [y, z] of a foot turned about its ankle by `degrees` about x (positive: toes down).
const pitched = (p: [number, number], degrees: number): [number, number] => {
  const a = (degrees * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return [p[0] * c - p[1] * s, p[0] * s + p[1] * c];
};

/// Turns `shape: "tube"` and `"lathe"` into meshes and a clip's `ik` and `walk` into rotation keys, in place of them.
/// Returns the model as the editor's format has it, and what was done in words.
/// `bend` says, for each shape by its place ("0.1#2": part 1 of part 0, shape 2), whether it is to bend with the parts around
/// it: true or false where the shape says so itself (`"bend": false`), and false for a lathe that does not (a turned shape
/// is a body, not a limb). A shape that is not listed follows model_write's own `bend`. `speeds` is, for each clip made by
/// `walk`, the speed in world units a second at which its feet do not slide.
export function expandModel(given: Args): { model: Args; notes: string[]; bend: Record<string, boolean>; speeds: Record<string, number> } {
  const model: Args = JSON.parse(JSON.stringify(given));
  const notes: string[] = [];
  const bend: Record<string, boolean> = {};
  const speeds: Record<string, number> = {};
  let tubes = 0, lathes = 0;
  const visit = (parts: Args[], path: string, index: number[]) => {
    (Array.isArray(parts) ? parts : []).forEach((p, n) => {
      if (!p || typeof p !== "object") return;
      const here = `${path}${p.name ?? "?"}`;
      const at = [...index, n];
      if (Array.isArray(p.cubes)) {
        p.cubes = p.cubes.map((c: Args, i: number) => {
          if (!c || typeof c !== "object") return c;
          const key = `${at.join(".")}#${i}`;
          if (c.bend !== undefined) {
            if (typeof c.bend !== "boolean") throw new Error(`${here}, shape ${i}: "bend" is true or false (whether this shape bends with the parts around it)`);
            bend[key] = c.bend;
          } else if (c.shape === "lathe") bend[key] = false;
          const { bend: _own, ...rest } = c;
          if (rest.shape === "tube") return tubes++, tube(rest, `${here}, shape ${i}`);
          if (rest.shape === "lathe") return lathes++, lathe(rest, `${here}, shape ${i}`);
          return rest;
        });
      }
      visit(p.children, `${here} > `, at);
    });
  };
  visit(model.parts, "", []);
  if (tubes || lathes) notes.push(`${[tubes ? `${tubes} tube${tubes > 1 ? "s" : ""}` : "", lathes ? `${lathes} lathe${lathes > 1 ? "s" : ""}` : ""].filter(Boolean).join(" and ")} written as free meshes (the file holds their points and faces)`);

  const scale = typeof model.scale === "number" ? model.scale : 0.0625;
  for (const clip of Array.isArray(model.clips) ? model.clips : []) {
    if (!clip || typeof clip !== "object" || (clip.ik === undefined && clip.walk === undefined)) continue;
    const at = `clip "${clip.name}"`;
    const D = Number(clip.duration);
    if (!(D > 0)) throw new Error(`${at}: needs a duration above 0`);
    clip.tracks = Array.isArray(clip.tracks) ? clip.tracks : [];
    if (clip.walk !== undefined) {
      const w: Args = clip.walk;
      const allowed = ["legs", "stride", "lift", "stance", "samples", "event", "hips", "bob", "sway", "roll", "heel", "toe", "arms", "arm_swing", "elbow"];
      const bad = Object.keys(w ?? {}).filter((k) => !allowed.includes(k));
      if (!w || typeof w !== "object" || bad.length) throw new Error(`${at}: walk is { "legs": ["foot_l", "foot_r"], "stride": 12, "lift": 2, "stance": 0.6 }${bad.length ? ` (it has no "${bad.join('", "')}"; it takes ${allowed.join(", ")})` : ""}`);
      if (!Array.isArray(w.legs) || !w.legs.length) throw new Error(`${at}: walk needs "legs": the names of the foot parts, like ["foot_l", "foot_r"] (or { "ankle": "foot_l", "phase": 0 } entries)`);
      if (!(w.stride > 0)) throw new Error(`${at}: walk needs "stride": how far a foot travels along the ground while it stands, in model units`);
      const stance = w.stance ?? 0.6;
      if (!(stance > 0.05 && stance < 0.95)) throw new Error(`${at}: walk's "stance" is the share of the cycle a foot is on the ground, between 0.05 and 0.95 (0.6 walks, 0.35 runs)`);
      const lift = w.lift ?? w.stride * 0.15;
      const N = Math.round(w.samples ?? 24);
      if (!(N >= 4 && N <= 64)) throw new Error(`${at}: walk's "samples" is how many keys a cycle gets, from 4 to 64`);
      const bob = w.bob ?? 0.8;
      if (!(typeof bob === "number" && bob >= 0 && bob <= 1.5)) throw new Error(`${at}: walk's "bob" is how much the hips rise over the standing leg, from 0 (hips level: a creep) to 1 (the leg nearly straight as the body passes over it); 0.8 when left out`);
      const legs = w.legs.map((l: unknown, i: number) => {
        const name = typeof l === "string" ? l : (l as Args)?.ankle;
        if (typeof name !== "string") throw new Error(`${at}: a leg is the name of its foot part, or { "ankle": name, "phase": 0 to 1 }`);
        const leg = legOf(model, name, at);
        const shape = footShape(leg.ankle.part);
        // the roll from heel to toe needs to know where the sole is: a foot without shapes of its own is kept level
        const rolls = w.roll !== false && !!shape && shape.toe - shape.heel > 1e-3 && shape.sole < 0;
        return { leg, phase: typeof l === "object" && typeof (l as Args).phase === "number" ? (l as Args).phase : i / w.legs.length, shape: shape ?? { sole: 0, toe: 0, heel: 0 }, rolls };
      });
      type LegOf = (typeof legs)[number];
      const heelUp = typeof w.heel === "number" ? w.heel : 10, toeDown = typeof w.toe === "number" ? w.toe : 24;
      const times = Array.from({ length: N + 1 }, (_, i) => (D * i) / N);
      const phaseOf = (l: LegOf, t: number) => (((t / D + l.phase) % 1) + 1) % 1;
      // Where a leg's ankle is at a point u of its own cycle, and how its foot is tipped. It stands for `stance` of the cycle,
      // the place it touches the ground moving back at one steady speed all that time (so nothing slides): first the heel
      // (toes up), then the whole sole, then, as the heel lifts, the toe. Then it swings forward, never lower than the ground.
      const HEEL = 0.15, TOE = 0.68;
      const footAt = (l: LegOf, u: number): { at: Vec3; pitch: number } => {
        const rest = ankleAtRest(l.leg), f = l.shape;
        const up = l.rolls ? heelUp : 0, down = l.rolls ? toeDown : 0;
        // the ankle that keeps the point p of the foot on the ground at nz + p's own place, with the foot tipped
        const about = (nz: number, p: [number, number], pitch: number): Vec3 => {
          const r = pitched(p, pitch);
          return [rest[0], rest[1] + f.sole - r[0], nz + p[1] - r[1]];
        };
        const standing = (st: number): { at: Vec3; pitch: number } => {
          const nz = rest[2] + w.stride * (0.5 - st);
          if (st < HEEL && up) {
            const pitch = -up * (1 - st / HEEL);
            return { at: about(nz, [f.sole, f.heel], pitch), pitch };
          }
          if (st > TOE && down) {
            const k = (st - TOE) / (1 - TOE);
            const pitch = down * k * k;
            return { at: about(nz, [f.sole, f.toe], pitch), pitch };
          }
          return { at: [rest[0], rest[1], nz], pitch: 0 };
        };
        if (u < stance) return standing(u / stance);
        const sw = (u - stance) / (1 - stance), e = (1 - Math.cos(Math.PI * sw)) / 2;
        const a = standing(1), b = standing(0);
        // (the toes come up early in the swing, so they clear the ground as the foot passes under the body)
        const pe = Math.min(1, sw / 0.6), pitch = a.pitch + (b.pitch - a.pitch) * ((1 - Math.cos(Math.PI * pe)) / 2);
        let y = a.at[1] + (b.at[1] - a.at[1]) * e + lift * Math.sin(Math.PI * sw);
        const low = Math.min(y + pitched([f.sole, f.toe], pitch)[0], y + pitched([f.sole, f.heel], pitch)[0]);
        const floor = rest[1] + f.sole + lift * 0.12 * Math.sin(Math.PI * sw);
        if (low < floor) y += floor - low;
        return { at: [rest[0], y, a.at[2] + (b.at[2] - a.at[2]) * e], pitch };
      };
      const hipsPath: string[] = typeof w.hips === "string" ? (findPart(model.parts, w.hips)[0]?.names ?? []) : legs[0]!.leg.ankle.names.slice(0, -3);
      if (typeof w.hips === "string" && !hipsPath.length) throw new Error(`${at}: walk's "hips" names no part ("${w.hips}")`);
      for (const { leg } of legs) {
        const rest = ankleAtRest(leg), hip = hipAt({ tracks: [] }, leg, 0);
        const reach = (leg.l1 + leg.l2) * 0.985, half = w.stride / 2 + Math.abs(rest[2] - hip[2]);
        if (half >= reach) throw new Error(`${at}: a stride of ${w.stride} is longer than the leg ${leg.ankle.names.slice(-3).join(" > ")} can make (thigh ${r3(leg.l1)} + shin ${r3(leg.l2)}): at most about ${r3((reach - Math.abs(rest[2] - hip[2])) * 1.6)}`);
      }
      // The hips: as high as the legs allow at each moment (the body vaults over the standing leg and is lowest when both
      // feet are down), which is what makes a walk read as a walk and not a creep; `bob` scales that rise. They also lean
      // a little towards the standing foot (`sway`).
      const highest = (t: number): number => {
        let y = Infinity;
        for (const l of legs) {
          const hip = hipAt({ tracks: [] }, l.leg, 0), rest = ankleAtRest(l.leg);
          const foot = footAt(l, phaseOf(l, t)).at;
          const reach = (l.leg.l1 + l.leg.l2) * 0.99, dz = foot[2] - hip[2];
          // (how far the hips part itself may be above its place at rest for this leg)
          y = Math.min(y, foot[1] + Math.sqrt(Math.max(0, reach * reach - dz * dz)) - (hip[1] - rest[1]) - rest[1]);
        }
        return y;
      };
      const rise = times.map(highest);
      const lowest = Math.min(...rise);
      let lifted = rise.map((y) => lowest + (y - lowest) * Math.min(bob, 1));
      // (rounded off where the two legs change over, and never above what the legs reach)
      lifted = lifted.map((_, i) => {
        const n = lifted.length - 1, at = (k: number) => lifted[((k % n) + n) % n]!;
        return Math.min(rise[i]!, (at(i - 1) + 2 * at(i) + at(i + 1)) / 4);
      });
      lifted[lifted.length - 1] = lifted[0]!;
      const pair = legs.length === 2 && Math.abs(((((legs[0]!.phase - legs[1]!.phase) % 1) + 1) % 1) - 0.5) < 0.05;
      const apart = pair ? ankleAtRest(legs[0]!.leg)[0] - ankleAtRest(legs[1]!.leg)[0] : 0;
      const sway = typeof w.sway === "number" ? w.sway * Math.sign(apart || 1) : apart * 0.14;
      let drop = 0;
      if (hipsPath.length) {
        const hips = hipsPath.reduce<Args | undefined>((p, n) => (p ? (p.children ?? []).find((c: Args) => c.name === n) : undefined), { children: model.parts });
        const o: Vec3 = hips!.origin;
        drop = -lowest;
        clip.tracks = clip.tracks.filter((tr: Args) => !(tr.prop === "position" && samePath(tr.part, hipsPath)));
        clip.tracks.push({
          part: hipsPath,
          prop: "position",
          keys: times.map((t, i) => ({ t: r3(t), value: [r3(o[0] + (pair ? sway * Math.cos(2 * Math.PI * (phaseOf(legs[0]!, t) - stance / 2)) : 0)), r3(o[1] + lifted[i]!), o[2]] })),
        });
      } else if (lowest < -1e-3) notes.push(`${at}: the legs hang from the top of the model, so the hips cannot be lowered ${r3(-lowest)} units for the stride: the feet stop short at its ends. Put the legs under a hips part`);
      for (const l of legs) writeLeg(clip, l.leg, times, (t) => footAt(l, phaseOf(l, t)), notes, at);
      // arms that swing against the legs: each arm goes back as the leg on its side comes forward
      if (w.arms !== undefined) {
        if (!Array.isArray(w.arms) || w.arms.length !== legs.length || !w.arms.every((n: unknown) => typeof n === "string")) throw new Error(`${at}: walk's "arms" names the upper-arm parts in the order of "legs" (the arm on the same side as each leg), like ["arm_l", "arm_r"]`);
        const swing = typeof w.arm_swing === "number" ? w.arm_swing : 26, elbow = typeof w.elbow === "number" ? w.elbow : 14;
        w.arms.forEach((name: string, i: number) => {
          const found = findPart(model.parts, name);
          if (found.length !== 1) throw new Error(`${at}: walk's "arms": ${found.length ? "more than one part is" : "no part is"} called "${name}"`);
          const arm = found[0]!;
          const base: Vec3 = isVec3(arm.part.rotation) ? arm.part.rotation : [0, 0, 0];
          // how far forward the leg of this side is, from -1 to 1 (a smooth wave that is 1 as its heel lands)
          const fore = (t: number) => Math.cos(2 * Math.PI * (phaseOf(legs[i]!, t) - 0.02));
          const drop_ = (path: string[]) => (clip.tracks = clip.tracks.filter((tr: Args) => !(tr.prop === "rotation" && samePath(tr.part, path))));
          drop_(arm.names);
          clip.tracks.push({ part: arm.names, prop: "rotation", keys: times.map((t) => ({ t: r3(t), value: [r3(base[0] + swing * fore(t)), base[1], base[2]] })) });
          const fore_arm = (arm.part.children ?? [])[0];
          if (fore_arm && elbow) {
            const fb: Vec3 = isVec3(fore_arm.rotation) ? fore_arm.rotation : [0, 0, 0];
            const path = [...arm.names, String(fore_arm.name)];
            drop_(path);
            // (the elbow bends more as the arm comes forward: a negative turn about x lifts the forearm to the front)
            clip.tracks.push({ part: path, prop: "rotation", keys: times.map((t) => ({ t: r3(t), value: [r3(fb[0] - elbow * (1.2 - fore(t))), fb[1], fb[2]] })) });
          }
        });
      }
      if (typeof w.event === "string" && w.event) {
        const lands = legs.map(({ phase }: { phase: number }) => r3((((1 - phase) % 1) + 1) % 1 * D)).sort((a: number, b: number) => a - b);
        clip.events = [...(Array.isArray(clip.events) ? clip.events : []), ...lands.map((t: number) => ({ t, name: w.event }))].sort((a, b) => a.t - b.t);
      }
      const speed = w.stride / (stance * D);
      speeds[String(clip.name)] = r3(speed * scale);
      const span = Math.max(...lifted) - Math.min(...lifted);
      const leads = legs.map((l: LegOf) => `${l.leg.ankle.names[l.leg.ankle.names.length - 1]} lands at ${r3((((1 - l.phase) % 1) + 1) % 1 * D)} s`).join(", ");
      notes.push(`${at}: a walk of ${legs.length} legs (${legs.map(({ leg }: { leg: Leg }) => leg.ankle.names.slice(-3).join(" > ")).join("; ")}), ${N + 1} keys each; ${leads} (it is in front then). A standing foot moves back ${r3(w.stride)} units in ${r3(stance * D)} s, so the feet do not slide when the entity moves ${r3(speed * scale)} world units a second (${r3(speed)} model units a second at scale ${scale}); play the clip faster or slower in step with the speed: at playback rate r the speed is ${r3(speed * scale)} x r (${[0.5, 0.75, 1.25, 1.5, 2].map((r) => `rate ${r}: ${r3(speed * scale * r)}`).join(", ")} world units a second), and to move at v play it at rate v / ${r3(speed * scale)}${hipsPath.length ? `. The hips ("${hipsPath[hipsPath.length - 1]}") are keyed: ${r3(Math.max(0, drop))} units lower where both feet are down, rising ${r3(span)} over the standing leg ("bob": ${bob}; 0 keeps them level)${pair && Math.abs(sway) > 1e-3 ? `, and ${r3(Math.abs(sway))} towards the standing foot ("sway")` : ""}` : ""}${legs.some((l: LegOf) => l.rolls) ? `. The feet roll from heel (toes ${heelUp} degrees up as it lands) to toe (${toeDown} degrees down as it leaves), the sole never under the ground ("roll": false keeps them level)` : ""}${w.arms ? `. The arms ${w.arms.join(", ")} swing against the legs` : ""}${typeof w.event === "string" && w.event ? `. Events "${w.event}" where each foot lands` : ""}`);
      delete clip.walk;
    }
    if (clip.ik !== undefined) {
      const ik: Args = clip.ik;
      if (!ik || typeof ik !== "object" || Array.isArray(ik) || !Object.keys(ik).length) throw new Error(`${at}: ik is { "foot_l": [[t, x, y, z], ...], "foot_r": [...] }: for each foot part, where its ankle is at each time (model units, in the model's space)`);
      for (const [name, list] of Object.entries(ik)) {
        if (!Array.isArray(list) || !list.length || !list.every((k) => Array.isArray(k) && (k.length === 4 || k.length === 5) && k.every((v) => typeof v === "number" && Number.isFinite(v)))) {
          throw new Error(`${at}: ik "${name}" is a list of [t, x, y, z] (or [t, x, y, z, pitch] to tip the foot, degrees): where the ankle is at each time`);
        }
        const leg = legOf(model, name, at);
        const keys = (list as number[][]).map((k) => ({ t: k[0]!, value: [k[1]!, k[2]!, k[3]!] as Vec3, pitch: k[4] ?? 0 })).sort((a, b) => a.t - b.t);
        // between the keys the foot goes straight, which joint angles between two keys would not do: so more keys
        const steps = Math.min(120, Math.max(2, Math.ceil(D * 30)));
        const times = [...new Set([...keys.map((k) => r3(k.t)), ...Array.from({ length: steps + 1 }, (_, i) => r3((D * i) / steps))])].sort((a, b) => a - b);
        const pitchKeys = keys.map((k) => ({ t: k.t, value: [k.pitch, 0, 0] as Vec3 }));
        writeLeg(clip, leg, times, (t) => ({ at: valueAt(keys, t), pitch: valueAt(pitchKeys, t)[0] }), notes, at);
        // when it stands (as low as it gets) and how fast it moves back then
        const low = Math.min(...keys.map((k) => k.value[1]));
        let span = 0, back = 0;
        // the stretches it is down for, each as its moments: a foot that slides there is said
        const runs: { t: number; at: Vec3 }[][] = [];
        let open = false;
        for (let i = 0; i < times.length - 1; i++) {
          const a = valueAt(keys, times[i]!), b = valueAt(keys, times[i + 1]!);
          if (a[1] <= low + 0.02 * (leg.l1 + leg.l2) && b[1] <= low + 0.02 * (leg.l1 + leg.l2)) {
            span += times[i + 1]! - times[i]!;
            back += a[2] - b[2];
            if (!open) runs.push([{ t: times[i]!, at: a }]);
            runs[runs.length - 1]!.push({ t: times[i + 1]!, at: b });
            open = true;
          } else open = false;
        }
        const tol = 0.02 * (leg.l1 + leg.l2);
        for (const run of runs) {
          if (run.length < 3) continue;
          const first = run[0]!, last = run[run.length - 1]!;
          const drift = Math.max(...run.map((p) => Math.abs(p.at[0] - first.at[0])));
          const speeds = run.slice(1).map((p, i) => (run[i]!.at[2] - p.at[2]) / Math.max(1e-6, p.t - run[i]!.t));
          const mean = (first.at[2] - last.at[2]) / Math.max(1e-6, last.t - first.t);
          const uneven = Math.max(...speeds.map((v) => Math.abs(v - mean)));
          const faults = [
            drift > tol ? `its x moves ${r3(drift)} units` : "",
            uneven * (last.t - first.t) > tol ? `it moves back unevenly (from ${r3(Math.min(...speeds))} to ${r3(Math.max(...speeds))} units a second, ${r3(mean)} on average)` : "",
          ].filter(Boolean);
          if (faults.length) {
            notes.push(
              `WARNING ${at}: ${leg.ankle.names[leg.ankle.names.length - 1]} slides while it is down (${r3(first.t)} s to ${r3(last.t)} s): ${faults.join(", and ")}. A planted foot keeps its x and z in the world: in the model keep its x the same and move its z back at one steady speed (the same distance in each equal time), the entity's own speed; here ${r3(first.at[2])} to ${r3(last.at[2])} in ${r3(last.t - first.t)} s is ${r3(mean * scale)} world units a second`,
            );
          }
        }
        notes.push(`${at}: ${leg.ankle.names.slice(-3).join(" > ")} solved from ${keys.length} places into ${times.length} keys${span > 0 && Math.abs(back) > 1e-3 ? `; the foot is down for ${r3(span)} s and moves back ${r3(back)} units in that time, so it does not slide when the entity moves ${r3((back / span) * scale)} world units a second` : ""}`);
      }
      delete clip.ik;
    }
    clip.tracks.forEach((tr: Args) => tr.keys?.sort((a: Args, b: Args) => a.t - b.t));
  }
  return { model, notes, bend, speeds };
}

export const SHAPES_HELP =
  'A free mesh is { "shape": "mesh", "verts": [[x, y, z], ...], "polys": [{ "v": [0, 1, 2, 3], "smooth"?: true, "color"?: "#rrggbb" }, ...], "color", "creases"?: [[point a, point b, weight 0 to 1], ...] }: `verts` are points in the part\'s space (model units), each poly lists three or more point numbers (counted from 0) going counter-clockwise as seen from outside (a face listed the other way is see-through from outside), flat faces of any number of sides are fine, and an open end shows the inside, so close it with a poly. `smooth` shades a face smoothly across the points it shares; `creases` only matter under a Subdivision modifier. The smallest solid, a pyramid on a triangle: "verts": [[0, 0, 0], [4, 0, 0], [2, 0, 3], [2, 4, 1]], "polys": [{ "v": [0, 1, 2] }, { "v": [0, 3, 1] }, { "v": [1, 3, 2] }, { "v": [2, 3, 0] }]. ' +
  'Two shapes are written for you as such meshes: { "shape": "tube", "points": [[0, 0, 0], [0, -5, 0.5], [0, -10, 0]], "radius": 1.5 (or "radii": one per point), "segments": 8, "color" } is a round limb along the points with closed ends (give a limb that must bend a point at the joint and one either side of it, and pass bend: true); ' +
  '{ "shape": "lathe", "profile": [[0, 0], [3, 0], [2, 6], [0, 8]], "segments": 12, "axis": "y", "at": [0, 0, 0], "color" } turns a profile of [radius, height] pairs about an axis (a vase, a dome, a wheel with axis "x"; radius 0 is a point on the axis). ';

export const FEET_HELP =
  'Feet instead of angles: a clip may say where the feet go and the leg\'s turns are worked out and written as ordinary rotation keys. A foot is named by its part; the part above it is the shin and the one above that the thigh (hips > leg_l > shin_l > foot_l), all three unturned at rest. ' +
  '"walk": { "legs": ["foot_l", "foot_r"], "stride": 12, "lift": 2, "stance": 0.6, "event": "step", "arms": ["arm_l", "arm_r"] } makes a whole walk cycle over the clip\'s duration: each foot stands for `stance` of the cycle (0.6 walks, 0.35 runs) while it travels `stride` model units back, then swings forward `lift` high. It lands on its heel and leaves from its toe (the foot part\'s own shapes say where the sole, heel and toe are; the ankle is lifted so the sole never goes under the ground; "roll": false keeps the feet level, "heel" and "toe" are the degrees). The hips rise over the standing leg and sink when both feet are down (`bob`: 0.8; 0 keeps them level, which reads as a creep) and lean towards the standing foot (`sway`, model units). `arms` names the upper-arm parts in the order of the legs: each swings back as the leg on its side comes forward (`arm_swing` degrees, 26; `elbow`, 14, bends the part below it). The answer says which foot lands when and the speed at which the feet do not slide (stride / (stance x duration), in world units a second): move the entity at that speed (at another playback rate r it is that speed x r: the answer lists a few rates). ' +
  '"ik": { "foot_l": [[t, x, y, z], [0.25, -2, 1, -4], ...] } places an ankle at points in the model\'s space over time (a fifth number tips the foot about its ankle, degrees: positive points the toes down, and the toes or the heel then reach below the ankle\'s sole height, so lift the ankle as well); it goes straight between them. A foot that stands keeps its x and z in the world: while it is down give it the same x and a z that goes back at one steady speed (the speed the entity moves at), or the answer warns that it slides. Position keys of the parts above the leg in the same clip (hips that bob) are taken into account. `walk` and `ik` are not kept in the file. ';
