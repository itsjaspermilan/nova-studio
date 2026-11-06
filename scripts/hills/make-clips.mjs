// Adds animations the kit does not have to the converted protagonists (examples/hill-run/models/*.glb): `climb` and `glide`.
//
// A clip is posed in model space (x is the character's left, y up, z forward) with rotations of whole bones about their own joints,
// added up down the chain (a forearm turns with its upper arm, as the pose is made by turning the upper arm and then the forearm).
// The script works out each bone's local rotation from the rest pose, which is what glTF animation channels hold, and samples
// the pose every 1/30 s.  Written so that a new clip is a few lines: a function from time to {bone: [rx, ry, rz] degrees}.
//
//   node scripts/hills/make-clips.mjs [model.glb ...]      (default: the four in examples/hill-run/models)
import fs from "node:fs";

const files = process.argv.slice(2).length ? process.argv.slice(2) : ["skater_male", "skater_female", "criminal", "cyborg"].map((n) => `examples/hill-run/models/${n}.glb`);

// ---- quaternions [x, y, z, w] ----
const qmul = (a, b) => [a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1], a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0], a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3], a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];
const qinv = (q) => [-q[0], -q[1], -q[2], q[3]];
const axisQ = (axis, deg) => { const h = (deg * Math.PI) / 360, q = [0, 0, 0, Math.cos(h)]; q[axis] = Math.sin(h); return q; };
// degrees about x, then y, then z, in model space
const euler = ([x, y, z]) => qmul(axisQ(2, z), qmul(axisQ(1, y), axisQ(0, x)));
const norm = (q) => { const l = Math.hypot(...q) || 1; return q.map((v) => v / l); };

// ---- vectors, 3x3 turns and matrices (column-major 4x4 arrays) for the arm IK ----
const vsub = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const vadd = (a, b) => [a[0]+b[0], a[1]+b[1], a[2]+b[2]];
const vscale = (a, k) => [a[0]*k, a[1]*k, a[2]*k];
const vdot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const vcross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const vlen = (a) => Math.hypot(...a);
const vnorm = (a) => { const l = vlen(a) || 1; return [a[0]/l, a[1]/l, a[2]/l]; };
const m4mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c*4+r] += a[k*4+r] * b[c*4+k]; return o; };
const m4from = (t, q, sc) => { const [x, y, z, w] = q, [sx, sy, sz] = sc; return [(1-2*(y*y+z*z))*sx, 2*(x*y+z*w)*sx, 2*(x*z-y*w)*sx, 0, 2*(x*y-z*w)*sy, (1-2*(x*x+z*z))*sy, 2*(y*z+x*w)*sy, 0, 2*(x*z+y*w)*sz, 2*(y*z-x*w)*sz, (1-2*(x*x+y*y))*sz, 0, t[0], t[1], t[2], 1]; };
const m4point = (m, p) => [m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12], m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13], m[2]*p[0]+m[6]*p[1]+m[10]*p[2]+m[14]];
// the quaternion of the rotation whose columns are the three axes f1, f2, f3
function quatFromAxes(f1, f2, f3) {
  const m00 = f1[0], m10 = f1[1], m20 = f1[2], m01 = f2[0], m11 = f2[1], m21 = f2[2], m02 = f3[0], m12 = f3[1], m22 = f3[2];
  const tr = m00 + m11 + m22;
  let q;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s]; }
  else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]; }
  else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s]; }
  else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s]; }
  return norm(q);
}
const frame = (v, a) => { const f1 = vnorm(v), f2 = vnorm(vsub(a, vscale(f1, vdot(a, f1)))); return [f1, f2, vcross(f1, f2)]; };
// the turn that takes the frame (vRest, aRest) to the frame (v, a): their axes as columns, new times old transposed
function frameTurn(vRest, aRest, v, a) {
  const [r1, r2, r3] = frame(vRest, aRest), [n1, n2, n3] = frame(v, a);
  const col = (j) => [0, 1, 2].map((i) => n1[i]*r1[j] + n2[i]*r2[j] + n3[i]*r3[j]);
  return quatFromAxes(col(0), col(1), col(2));
}
const slerp = (a, b, t) => {
  let d = a[0]*b[0] + a[1]*b[1] + a[2]*b[2] + a[3]*b[3];
  const sign = d < 0 ? -1 : 1; d *= sign;
  if (d > 0.9995) return norm(a.map((v, i) => v + (sign * b[i] - v) * t));
  const th = Math.acos(d), s = Math.sin(th);
  return norm(a.map((v, i) => (v * Math.sin((1 - t) * th) + sign * b[i] * Math.sin(t * th)) / s));
};

// ---- the poses ----
const D = (v) => v;
// climbing: facing the wall, the arms reach up one after the other, the legs step up, the body leans in a little
function climb(t) {
  const p = (t / 1.2) * 2 * Math.PI, a = Math.sin(p), b = -a; // a: the left side reaches, b: the right
  const reach = (s) => 0.5 + 0.5 * s; // 0 (pulled down) to 1 (reached)
  const arm = (side, s) => { // side 1 is the left arm (along +x); 90 is straight up, 15 is out to the side: reached high or pulled in
    const up = 15 + 75 * reach(s);
    return [-90, -side * (6 + 10 * reach(s)), side * up]; // (turned a quarter about the arm first, so that the palms face forward, at the wall)
  };
  const forearm = (side, s) => [0, 0, side * 85 * (1 - reach(s))]; // bent up when pulled in, straight when reached
  const leg = (s) => { const r = reach(s); return [-20 - 50 * r, 0, 0]; }; // thigh forward
  const knee = (s) => { const r = reach(s); return [20 + 65 * r, 0, 0]; };  // shin back
  return {
    HipsCtrl: [0, 0, 0],
    Spine: [14 + 2 * a, 6 * a, 0],
    Chest: [6, -8 * a, 0],
    Head: [-20, 0, 0],
    LeftArm: arm(1, a), RightArm: arm(-1, b),
    LeftForeArm: forearm(1, a), RightForeArm: forearm(-1, b),
    LeftUpLeg: leg(-a), RightUpLeg: leg(-b),
    LeftLeg: knee(-a), RightLeg: knee(-b),
    LeftFoot: [10, 0, 0], RightFoot: [10, 0, 0],
    _move: { Hips: [0, 0.025 * Math.sin(2 * p), 0] },
  };
}
// gliding: hanging from a canopy overhead, both arms up and a little forward, the legs trailing and swaying
function glide(t) {
  const p = (t / 1.6) * 2 * Math.PI, s = Math.sin(p), c = Math.cos(p);
  return {
    Spine: [10 + 2 * s, 0, 3 * c],
    Chest: [4, 0, 0],
    Head: [-12 + 3 * s, 0, 0],
    LeftArm: [-90, -18, 84], RightArm: [-90, 18, -84], // palms forward, round the canopy's lines
    LeftForeArm: [0, 0, 4], RightForeArm: [0, 0, -4],
    LeftUpLeg: [14 + 6 * s, 0, -3], RightUpLeg: [10 - 6 * s, 0, 3],
    LeftLeg: [30 + 8 * c, 0, 0], RightLeg: [26 - 8 * c, 0, 0],
    LeftFoot: [18, 0, 0], RightFoot: [18, 0, 0],
    _move: { Hips: [0, 0.015 * s, 0] },
  };
}
// getting up over the top of a climb (what the research on ledge climbs in games says, and what this does):
//  - the hands are held ON the edge the whole way up (inverse kinematics: the arms are solved each frame to reach the edge, so the
//    hands stay where they are while the body rises past them: hanging, a chin-up that brings the chest to the ledge, then pushing
//    up on straight arms), instead of arms waving about in the air;
//  - the body moves in two parts, up and then onto the ledge (the game moves the capsule by the same two functions, rise and
//    forward below, so that the clip and the movement agree);
//  - one clip is made for each height of ledge (a clip for one height looks wrong on another): `mantle` for a ledge 1.5 m above the
//    feet (about the hands' reach with the arms up: these arms are short) and `mantle_low` for one 1.15 m up; the game picks the nearer and moves by the real height;
//  - legs: hanging, a knee swung up onto the ledge, the push, standing; the chest leans in as it is pulled up.
// Crude on purpose (the owner can tune the poses in Nova's editor): the arms' ends are held by IK, the rest is key poses.
// key poses with a straight line between them
function keyed(keys) {
  return (t) => {
    let i = 0;
    while (i + 2 < keys.length && t > keys[i + 1].t) i++;
    const a = keys[i], b = keys[i + 1];
    const f = Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t)));
    const out = {};
    for (const bone of new Set([...Object.keys(a.pose), ...Object.keys(b.pose)])) {
      if (bone.startsWith("_")) continue;
      const p = a.pose[bone] ?? [0, 0, 0], q = b.pose[bone] ?? [0, 0, 0];
      out[bone] = p.map((v, k) => v + (q[k] - v) * f);
    }
    return out;
  };
}
const smooth = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
const WALL = 0.37; // from the middle of the body to the face of the wall, in metres (the capsule is 0.35 wide)
export const mantleRise = (R, t) => R * smooth(t / 0.65);
export const mantleForward = (t) => (t < 0.5 ? 0 : Math.min(2.2 * (t - 0.5), 1.1));
function makeMantle(R) {
  const fk = keyed([
    { t: 0.0, pose: { Spine: [8, 0, 0], Head: [-20, 0, 0], LeftUpLeg: [-8, 0, 0], RightUpLeg: [-8, 0, 0], LeftLeg: [14, 0, 0], RightLeg: [14, 0, 0], LeftFoot: [14, 0, 0], RightFoot: [14, 0, 0] } },
    { t: 0.35, pose: { Spine: [52, 0, 0], Chest: [18, 0, 0], Head: [-38, 0, 0], LeftUpLeg: [-70, 0, 0], RightUpLeg: [-16, 0, 0], LeftLeg: [90, 0, 0], RightLeg: [30, 0, 0] } },
    { t: 0.65, pose: { Spine: [44, 0, 0], Chest: [14, 0, 0], Head: [-28, 0, 0], LeftArm: [-90, 0, -35], RightArm: [-90, 0, 35], LeftUpLeg: [-95, 0, 0], RightUpLeg: [-26, 0, 0], LeftLeg: [105, 0, 0], RightLeg: [50, 0, 0] } },
    { t: 1.0, pose: { Spine: [4, 0, 0], LeftArm: [0, 0, -75], RightArm: [0, 0, 75] } },
  ]);
  return (t) => {
    const rise = mantleRise(R, t), fwd = mantleForward(t);
    const hand = (side) => ({ target: [side * 0.21, R - rise + 0.02, WALL + 0.03 - fwd], pole: [side * 0.45, -1, -0.5] });
    const weight = 1 - smooth((t - 0.72) / 0.2);
    return { ...fk(t), _ik: { weight, left: hand(1), right: hand(-1) } };
  };
}
const mantle = makeMantle(1.5);
const mantleLow = makeMantle(1.15);
const CLIPS = [{ name: "climb", duration: 1.2, pose: climb }, { name: "glide", duration: 1.6, pose: glide }, { name: "mantle", duration: 1.0, pose: mantle }, { name: "mantle_low", duration: 1.0, pose: mantleLow }];

for (const file of files) {
  const b = fs.readFileSync(file);
  const jl = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + jl).toString());
  let bin = b.subarray(20 + jl + 8, 20 + jl + 8 + b.readUInt32LE(20 + jl));
  const nodes = json.nodes;
  const parent = new Map();
  nodes.forEach((n, i) => (n.children || []).forEach((c) => parent.set(c, i)));
  const byName = new Map(nodes.map((n, i) => [n.name, i]));
  const rest = nodes.map((n) => n.rotation || [0, 0, 0, 1]);
  // rest world rotations, top down
  const order = [];
  const seen = new Set();
  const visit = (i) => { if (seen.has(i)) return; if (parent.has(i)) visit(parent.get(i)); seen.add(i); order.push(i); };
  nodes.forEach((_, i) => visit(i));
  const restWorld = new Map();
  for (const i of order) restWorld.set(i, parent.has(i) ? qmul(restWorld.get(parent.get(i)), rest[i]) : rest[i]);

  // the arms at rest (the T-pose): where the shoulder, elbow and wrist are, for the IK
  const restM = new Map();
  for (const i of order) { const lm = m4from(nodes[i].translation || [0, 0, 0], rest[i], nodes[i].scale || [1, 1, 1]); restM.set(i, parent.has(i) ? m4mul(restM.get(parent.get(i)), lm) : lm); }
  const worldPos = (name) => m4point(restM.get(byName.get(name)), [0, 0, 0]);
  const armRest = {};
  for (const side of ["Left", "Right"]) {
    const p0 = worldPos(side + "Arm"), p1 = worldPos(side + "ForeArm"), p2 = worldPos(side + "Hand");
    armRest[side] = { L1: vlen(vsub(p1, p0)), L2: vlen(vsub(p2, p1)), v1: vnorm(vsub(p1, p0)), v2: vnorm(vsub(p2, p1)) };
  }

  const chunks = [bin];
  let length = bin.length;
  const add = (data, componentType, type, count, extra = {}) => {
    while (length % 4) { chunks.push(Buffer.alloc(1)); length++; }
    const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    json.bufferViews.push({ buffer: 0, byteOffset: length, byteLength: buf.length });
    json.accessors.push({ bufferView: json.bufferViews.length - 1, componentType, count, type, ...extra });
    chunks.push(buf); length += buf.length;
    return json.accessors.length - 1;
  };
  json.animations = (json.animations || []).filter((a) => !CLIPS.some((c) => c.name === a.name));
  for (const clip of CLIPS) {
    const frames = Math.round(clip.duration * 30) + 1;
    const times = Array.from({ length: frames }, (_, f) => f / 30);
    const rot = new Map(), trans = new Map();
    for (const i of order) rot.set(i, []);
    for (const t of times) {
      const pose = clip.pose(t);
      const ik = pose._ik; // { weight, left: { target, pole }, right: {...} }: hands held to places in model space (the edge of a ledge)
      const total = new Map(); // D_total per node (the accumulated turn in model space)
      const posed = new Map(); // the posed world matrix of each node
      const ikTotal = new Map();
      for (const i of order) {
        const name = nodes[i].name;
        const own = pose[name] ? euler(pose[name]) : [0, 0, 0, 1];
        const up = parent.has(i) ? total.get(parent.get(i)) : [0, 0, 0, 1];
        let tot = qmul(own, up);
        // an arm held to a target: solve the two bones to reach it, and blend that with the pose by the weight
        const arm = ik && /^(Left|Right)(Arm|ForeArm)$/.test(name) ? name.match(/^(Left|Right)(Arm|ForeArm)/) : null;
        if (arm) {
          const side = arm[1] === "Left" ? 1 : -1, goal = ik[arm[1].toLowerCase()];
          if (arm[2] === "Arm") {
            const parentM = posed.get(parent.get(i));
            const S = m4point(parentM, nodes[i].translation || [0, 0, 0]);
            const rk = armRest[arm[1]];
            const toTarget = vsub(goal.target, S);
            const d = Math.min(Math.max(vlen(toTarget), 0.05), (rk.L1 + rk.L2) * 0.999);
            const u = vnorm(toTarget);
            const a = (rk.L1 * rk.L1 - rk.L2 * rk.L2 + d * d) / (2 * d);
            const h = Math.sqrt(Math.max(rk.L1 * rk.L1 - a * a, 0));
            const pv = vnorm(vsub(goal.pole, vscale(u, vdot(goal.pole, u))));
            const E = vadd(vadd(S, vscale(u, a)), vscale(pv, h));
            const H = vadd(S, vscale(u, d));
            const v1 = vnorm(vsub(E, S)), v2 = vnorm(vsub(H, E));
            let axis = vcross(v1, v2);
            if (vlen(axis) < 1e-3) axis = vcross(v1, pv);
            const aNew = vscale(vnorm(axis), -side);
            ikTotal.set(arm[1], { arm: frameTurn(rk.v1, [0, 1, 0], v1, aNew), fore: frameTurn(rk.v2, [0, 1, 0], v2, aNew) });
          }
          tot = slerp(tot, ikTotal.get(arm[1])[arm[2] === "Arm" ? "arm" : "fore"], ik.weight);
        }
        total.set(i, tot);
        // the node's new world rotation is total * restWorld; its local rotation is the parent's new world undone
        const world = qmul(tot, restWorld.get(i));
        const parentWorld = parent.has(i) ? qmul(total.get(parent.get(i)), restWorld.get(parent.get(i))) : [0, 0, 0, 1];
        let local = norm(qmul(qinv(parentWorld), world));
        const prev = rot.get(i).slice(-4);
        if (prev.length && prev[0]*local[0]+prev[1]*local[1]+prev[2]*local[2]+prev[3]*local[3] < 0) local = local.map((v) => -v);
        rot.get(i).push(...local);
        const localM = m4from(nodes[i].translation || [0, 0, 0], local, nodes[i].scale || [1, 1, 1]);
        posed.set(i, parent.has(i) ? m4mul(posed.get(parent.get(i)), localM) : localM);
      }
    }
    const samplers = [], channels = [];
    const input = add(new Float32Array(times), 5126, "SCALAR", times.length, { min: [0], max: [times[times.length - 1]] });
    for (const i of order) {
      const ikArm = clip.pose(0)._ik && /^(Left|Right)(Arm|ForeArm)$/.test(nodes[i].name); // (an arm held by IK moves whatever the pose keys say)
      if (!pose0Has(clip, nodes[i].name) && !ikArm && !isAncestorPosed(i)) continue;
      samplers.push({ input, output: add(new Float32Array(rot.get(i)), 5126, "VEC4", times.length), interpolation: "LINEAR" });
      channels.push({ sampler: samplers.length - 1, target: { node: i, path: "rotation" } });
    }
    // small movements of a bone (the hips' bob)
    const move = clip.pose(0)._move || {};
    for (const [name, _] of Object.entries(move)) {
      const i = byName.get(name);
      const base = nodes[i].translation || [0, 0, 0];
      const values = times.flatMap((t) => { const d = clip.pose(t)._move[name]; return [base[0] + d[0], base[1] + d[1], base[2] + d[2]]; });
      samplers.push({ input, output: add(new Float32Array(values), 5126, "VEC3", times.length), interpolation: "LINEAR" });
      channels.push({ sampler: samplers.length - 1, target: { node: i, path: "translation" } });
    }
    json.animations.push({ name: clip.name, samplers, channels });
    function pose0Has(c, n) { return Object.hasOwn(c.pose(0), n); }
    function isAncestorPosed(i) { // every bone below a posed one turns with it in the world, but its local rotation stays the rest: no channel
      return false;
    }
  }
  bin = Buffer.concat(chunks);
  bin = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
  json.buffers = [{ byteLength: bin.length }];
  let js = Buffer.from(JSON.stringify(json));
  js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12); header.write("glTF", 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8);
  const ch = (len, type) => { const x = Buffer.alloc(8); x.writeUInt32LE(len, 0); x.write(type, 4); return x; };
  fs.writeFileSync(file, Buffer.concat([header, ch(js.length, "JSON"), js, ch(bin.length, "BIN\0"), bin]));
  console.log(`${file}: clips ${json.animations.map((a) => a.name).join(", ")}`);
}
