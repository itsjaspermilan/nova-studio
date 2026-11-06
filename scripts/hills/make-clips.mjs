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
const CLIPS = [{ name: "climb", duration: 1.2, pose: climb }, { name: "glide", duration: 1.6, pose: glide }];

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
      const total = new Map(); // D_total per node (the accumulated turn in model space)
      for (const i of order) {
        const own = pose[nodes[i].name] ? euler(pose[nodes[i].name]) : [0, 0, 0, 1];
        const up = parent.has(i) ? total.get(parent.get(i)) : [0, 0, 0, 1];
        total.set(i, qmul(own, up));
        // the node's new world rotation is total * restWorld; its local rotation is the parent's new world undone
        const world = qmul(total.get(i), restWorld.get(i));
        const parentWorld = parent.has(i) ? qmul(total.get(parent.get(i)), restWorld.get(parent.get(i))) : [0, 0, 0, 1];
        let local = norm(qmul(qinv(parentWorld), world));
        const prev = rot.get(i).slice(-4);
        if (prev.length && prev[0]*local[0]+prev[1]*local[1]+prev[2]*local[2]+prev[3]*local[3] < 0) local = local.map((v) => -v);
        rot.get(i).push(...local);
      }
    }
    const samplers = [], channels = [];
    const input = add(new Float32Array(times), 5126, "SCALAR", times.length, { min: [0], max: [times[times.length - 1]] });
    for (const i of order) {
      if (!pose0Has(clip, nodes[i].name) && !isAncestorPosed(i)) continue;
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
