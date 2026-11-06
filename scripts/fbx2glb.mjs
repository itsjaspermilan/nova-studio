// Turns a skinned, animated character from binary FBX files into one .glb the runtime reads (mesh with a skin, the skeleton as
// nodes, the animations as glTF animations, the skin texture embedded). Written for Kenney's "Animated Characters" kits (CC0:
// one model file, one file per animation, PNG skins); other FBX characters of the same kind (a mesh skinned to limb nodes, with
// Euler-angle keyframes) should work too.
//
//   node scripts/fbx2glb.mjs <model.fbx> <out.glb> [--texture skin.png] [--anim name=file.fbx]... [--height 1.8]
//
// What it does, and what it leaves out: nodes get FBX's local transform (T * PreRotation * R * PostRotation^-1 * S; pivots and
// offsets are ignored), the mesh is triangulated and its vertices are put where the bind pose puts them (so the node transform of
// the mesh does not matter), up to four joint weights a vertex, normals and UVs per polygon corner (UV v flipped for glTF),
// animation curves are sampled at the union of their key times (linear between keys; Euler angles become quaternions). The model
// is scaled so that it is `--height` metres tall (the scale goes on the top-level nodes, which scales the whole rig). Not read:
// cubic key tangents, blend shapes, several skins, materials beyond the base-colour picture, vertex colours.
import fs from "node:fs";
import { parseFbx, child, childrenOf } from "./fbx.mjs";

const args = process.argv.slice(2);
const positional = [], anims = [];
let texture = null, height = 1.8;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--texture") texture = args[++i];
  else if (args[i] === "--height") height = Number(args[++i]);
  else if (args[i] === "--anim") { const [name, file] = args[++i].split("="); anims.push({ name, file }); }
  else positional.push(args[i]);
}
if (positional.length < 2) { console.error("usage: node scripts/fbx2glb.mjs <model.fbx> <out.glb> [--texture skin.png] [--anim name=file.fbx]... [--height 1.8]"); process.exit(1); }

// ---- small maths: matrices are column-major arrays of 16, quaternions are [x, y, z, w] ----
const mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function invert(m) {
  const inv = new Array(16), a = m;
  inv[0] = a[5]*a[10]*a[15]-a[5]*a[11]*a[14]-a[9]*a[6]*a[15]+a[9]*a[7]*a[14]+a[13]*a[6]*a[11]-a[13]*a[7]*a[10];
  inv[4] = -a[4]*a[10]*a[15]+a[4]*a[11]*a[14]+a[8]*a[6]*a[15]-a[8]*a[7]*a[14]-a[12]*a[6]*a[11]+a[12]*a[7]*a[10];
  inv[8] = a[4]*a[9]*a[15]-a[4]*a[11]*a[13]-a[8]*a[5]*a[15]+a[8]*a[7]*a[13]+a[12]*a[5]*a[11]-a[12]*a[7]*a[9];
  inv[12] = -a[4]*a[9]*a[14]+a[4]*a[10]*a[13]+a[8]*a[5]*a[14]-a[8]*a[6]*a[13]-a[12]*a[5]*a[10]+a[12]*a[6]*a[9];
  inv[1] = -a[1]*a[10]*a[15]+a[1]*a[11]*a[14]+a[9]*a[2]*a[15]-a[9]*a[3]*a[14]-a[13]*a[2]*a[11]+a[13]*a[3]*a[10];
  inv[5] = a[0]*a[10]*a[15]-a[0]*a[11]*a[14]-a[8]*a[2]*a[15]+a[8]*a[3]*a[14]+a[12]*a[2]*a[11]-a[12]*a[3]*a[10];
  inv[9] = -a[0]*a[9]*a[15]+a[0]*a[11]*a[13]+a[8]*a[1]*a[15]-a[8]*a[3]*a[13]-a[12]*a[1]*a[11]+a[12]*a[3]*a[9];
  inv[13] = a[0]*a[9]*a[14]-a[0]*a[10]*a[13]-a[8]*a[1]*a[14]+a[8]*a[2]*a[13]+a[12]*a[1]*a[10]-a[12]*a[2]*a[9];
  inv[2] = a[1]*a[6]*a[15]-a[1]*a[7]*a[14]-a[5]*a[2]*a[15]+a[5]*a[3]*a[14]+a[13]*a[2]*a[7]-a[13]*a[3]*a[6];
  inv[6] = -a[0]*a[6]*a[15]+a[0]*a[7]*a[14]+a[4]*a[2]*a[15]-a[4]*a[3]*a[14]-a[12]*a[2]*a[7]+a[12]*a[3]*a[6];
  inv[10] = a[0]*a[5]*a[15]-a[0]*a[7]*a[13]-a[4]*a[1]*a[15]+a[4]*a[3]*a[13]+a[12]*a[1]*a[7]-a[12]*a[3]*a[5];
  inv[14] = -a[0]*a[5]*a[14]+a[0]*a[6]*a[13]+a[4]*a[1]*a[14]-a[4]*a[2]*a[13]-a[12]*a[1]*a[6]+a[12]*a[2]*a[5];
  inv[3] = -a[1]*a[6]*a[11]+a[1]*a[7]*a[10]+a[5]*a[2]*a[11]-a[5]*a[3]*a[10]-a[9]*a[2]*a[7]+a[9]*a[3]*a[6];
  inv[7] = a[0]*a[6]*a[11]-a[0]*a[7]*a[10]-a[4]*a[2]*a[11]+a[4]*a[3]*a[10]+a[8]*a[2]*a[7]-a[8]*a[3]*a[6];
  inv[11] = -a[0]*a[5]*a[11]+a[0]*a[7]*a[9]+a[4]*a[1]*a[11]-a[4]*a[3]*a[9]-a[8]*a[1]*a[7]+a[8]*a[3]*a[5];
  inv[15] = a[0]*a[5]*a[10]-a[0]*a[6]*a[9]-a[4]*a[1]*a[10]+a[4]*a[2]*a[9]+a[8]*a[1]*a[6]-a[8]*a[2]*a[5];
  const det = a[0]*inv[0]+a[1]*inv[4]+a[2]*inv[8]+a[3]*inv[12];
  if (Math.abs(det) < 1e-30) throw new Error("a matrix cannot be inverted");
  return inv.map((v) => v / det);
}
const transformPoint = (m, p) => [m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12], m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13], m[2]*p[0]+m[6]*p[1]+m[10]*p[2]+m[14]];
const transformDir = (m, p) => [m[0]*p[0]+m[4]*p[1]+m[8]*p[2], m[1]*p[0]+m[5]*p[1]+m[9]*p[2], m[2]*p[0]+m[6]*p[1]+m[10]*p[2]];
const qmul = (a, b) => [a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1], a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0], a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3], a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];
const qconj = (q) => [-q[0], -q[1], -q[2], q[3]];
const axisQ = (axis, deg) => { const h = (deg * Math.PI) / 360, s = Math.sin(h), q = [0, 0, 0, Math.cos(h)]; q[axis] = s; return q; };
// FBX rotation orders: the axes are turned in the order named (XYZ: x first), so the quaternion is the product the other way round
const ORDERS = [[0, 1, 2], [0, 2, 1], [1, 2, 0], [1, 0, 2], [2, 0, 1], [2, 1, 0]];
function eulerQ(deg, order = 0) {
  const [a, b, c] = ORDERS[order] ?? ORDERS[0];
  return qmul(axisQ(c, deg[c]), qmul(axisQ(b, deg[b]), axisQ(a, deg[a])));
}

// ---- reading the FBX ----
function load(file) {
  const fbx = parseFbx(fs.readFileSync(file));
  const objects = fbx.roots.find((r) => r.name === "Objects");
  const byId = new Map();
  for (const o of objects.children) byId.set(o.props[0], o);
  const connections = fbx.roots.find((r) => r.name === "Connections").children.map((c) => ({ kind: c.props[0], child: c.props[1], parent: c.props[2], prop: c.props[3] }));
  return { fbx, objects, byId, connections };
}
const kind = (o) => o.props[2];
const nameOf = (o) => String(o.props[1]).split("\0")[0];
function prop(o, name, fallback) {
  const p = child(o, "Properties70")?.children.find((c) => c.props[0] === name);
  return p ? p.props.slice(4) : fallback;
}

const main = load(positional[0]);
const models = main.objects.children.filter((o) => o.name === "Model");
const modelIds = new Set(models.map((m) => m.props[0]));
const parentOf = new Map();
for (const c of main.connections) if (c.kind === "OO" && modelIds.has(c.child) && modelIds.has(c.parent)) parentOf.set(c.child, c.parent);

// the scale that makes the character `height` tall is worked out from the bind pose below; it goes on the top-level nodes
const meshModel = models.find((m) => kind(m) === "Mesh");
const skin = main.objects.children.find((o) => o.name === "Deformer" && kind(o) === "Skin");
const geometry = main.objects.children.find((o) => o.name === "Geometry" && kind(o) === "Mesh");
if (!meshModel || !skin || !geometry) throw new Error("the model needs a Mesh with a Skin deformer");
const clusters = main.connections.filter((c) => c.kind === "OO" && c.parent === skin.props[0]).map((c) => main.byId.get(c.child)).filter((o) => o && o.name === "Deformer");
const clusterBone = (cl) => main.connections.find((c) => c.kind === "OO" && c.parent === cl.props[0] && modelIds.has(c.child))?.child;

// nodes: every Model except the mesh; the mesh node goes at the scene root (a skinned mesh is placed by its joints)
const nodeModels = models.filter((m) => m !== meshModel);
const index = new Map(nodeModels.map((m, i) => [m.props[0], i]));
const local = (m) => {
  const t = prop(m, "Lcl Translation", [0, 0, 0]), r = prop(m, "Lcl Rotation", [0, 0, 0]), s = prop(m, "Lcl Scaling", [1, 1, 1]);
  const order = prop(m, "RotationOrder", [0])[0] ?? 0;
  const pre = prop(m, "PreRotation", null), post = prop(m, "PostRotation", null);
  let q = eulerQ(r, order);
  if (pre) q = qmul(eulerQ(pre, order), q);
  if (post) q = qmul(q, qconj(eulerQ(post, order)));
  return { t: [...t], q, s: [...s], order, pre: pre && eulerQ(pre, order), post: post && eulerQ(post, order) };
};
const locals = nodeModels.map(local);
const topLevel = nodeModels.map((m) => !parentOf.has(m.props[0]) || !index.has(parentOf.get(m.props[0])));
// world matrices of the nodes at bind (the rest pose in the file), to work out the size
const toMatrix = (l) => {
  const [x, y, z, w] = l.q, [sx, sy, sz] = l.s;
  const m = [(1-2*(y*y+z*z))*sx, (2*(x*y+z*w))*sx, (2*(x*z-y*w))*sx, 0, (2*(x*y-z*w))*sy, (1-2*(x*x+z*z))*sy, (2*(y*z+x*w))*sy, 0, (2*(x*z+y*w))*sz, (2*(y*z-x*w))*sz, (1-2*(x*x+y*y))*sz, 0, l.t[0], l.t[1], l.t[2], 1];
  return m;
};
const cluster0 = clusters[0];
// where the mesh sits at bind: the bind pose's matrix for it (a cluster's own "Transform" can leave out the scale the model has), else the cluster's
const bindPose = main.objects.children.find((o) => o.name === "Pose");
const poseNode = bindPose && childrenOf(bindPose, "PoseNode").find((n) => child(n, "Node")?.props[0] === meshModel.props[0]);
const meshBind = poseNode ? child(poseNode, "Matrix").props[0] : child(cluster0, "Transform").props[0];
const positionsRaw = child(geometry, "Vertices").props[0];
let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
for (let i = 0; i < positionsRaw.length; i += 3) {
  const p = transformPoint(meshBind, [positionsRaw[i], positionsRaw[i + 1], positionsRaw[i + 2]]);
  for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
}
// which axis is up: the one with the FBX's UpAxis (0 x, 1 y, 2 z)
const gs = main.fbx.roots.find((r) => r.name === "GlobalSettings");
const upAxis = child(gs, "Properties70").children.find((p) => p.props[0] === "UpAxis")?.props[4] ?? 1;
const k = height / (hi[upAxis] - lo[upAxis]);
console.log(`bind pose is ${(hi[upAxis] - lo[upAxis]).toFixed(2)} units tall: scaling by ${k.toFixed(5)} to ${height} m`);
nodeModels.forEach((_, i) => { if (topLevel[i]) { locals[i].t = locals[i].t.map((v) => v * k); locals[i].s = locals[i].s.map((v) => v * k); } });

// ---- the mesh ----
const S = [k, 0, 0, 0, 0, k, 0, 0, 0, 0, k, 0, 0, 0, 0, 1];
const bake = mul(S, meshBind);
const polyIndex = child(geometry, "PolygonVertexIndex").props[0];
const layer = (name) => child(geometry, name);
const normalLayer = layer("LayerElementNormal"), uvLayer = layer("LayerElementUV");
const normals = child(normalLayer, "Normals").props[0];
const normalIdx = child(normalLayer, "NormalsIndex")?.props[0];
const uvs = child(uvLayer, "UV").props[0], uvIdx = child(uvLayer, "UVIndex")?.props[0];
const positions = [], normalsOut = [], uvOut = [], origin = [], indices = [], seen = new Map();
let corner = 0, polygon = [];
function vertex(cornerIndex, vi) {
  const ni = normalIdx ? normalIdx[cornerIndex] : cornerIndex, ui = uvIdx ? uvIdx[cornerIndex] : cornerIndex;
  const key = `${vi}/${ni}/${ui}`;
  let id = seen.get(key);
  if (id === undefined) {
    id = positions.length / 3;
    const p = transformPoint(bake, [positionsRaw[vi * 3], positionsRaw[vi * 3 + 1], positionsRaw[vi * 3 + 2]]);
    positions.push(...p);
    const n = transformDir(meshBind, [normals[ni * 3], normals[ni * 3 + 1], normals[ni * 3 + 2]]);
    const l = Math.hypot(...n) || 1;
    normalsOut.push(n[0] / l, n[1] / l, n[2] / l);
    uvOut.push(uvs[ui * 2], 1 - uvs[ui * 2 + 1]);
    origin.push(vi);
    seen.set(key, id);
  }
  return id;
}
for (const raw of polyIndex) {
  const last = raw < 0, vi = last ? ~raw : raw;
  polygon.push(vertex(corner++, vi));
  if (last) {
    for (let i = 1; i + 1 < polygon.length; i++) indices.push(polygon[0], polygon[i], polygon[i + 1]);
    polygon = [];
  }
}
// the winding: FBX polygons are counter-clockwise like glTF's, but the bake may have flipped the handedness (it does not, here)
// ---- the skin ----
const joints = clusters.map((cl) => index.get(clusterBone(cl)));
if (joints.some((j) => j === undefined)) throw new Error("a cluster's bone is not a node");
const influence = Array.from({ length: positionsRaw.length / 3 }, () => []);
clusters.forEach((cl, ji) => {
  const ix = child(cl, "Indexes")?.props[0] ?? [], ws = child(cl, "Weights")?.props[0] ?? [];
  ix.forEach((v, n) => influence[v].push([ji, ws[n]]));
});
const jointsOut = new Uint16Array(positions.length / 3 * 4), weightsOut = new Float32Array(positions.length / 3 * 4);
origin.forEach((vi, v) => {
  const top = influence[vi].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const sum = top.reduce((s, e) => s + e[1], 0) || 1;
  top.forEach((e, n) => { jointsOut[v * 4 + n] = e[0]; weightsOut[v * 4 + n] = e[1] / sum; });
});
const ibm = [];
for (const cl of clusters) {
  const link = child(cl, "TransformLink").props[0];
  ibm.push(...invert(mul(S, link)));
}

// ---- the animations ----
const KTIME = 46186158000;
function readAnimation(file, name) {
  const a = load(file);
  const stacks = a.objects.children.filter((o) => o.name === "AnimationStack");
  const curveNodes = a.objects.children.filter((o) => o.name === "AnimationCurveNode");
  const aModels = new Map(a.objects.children.filter((o) => o.name === "Model").map((m) => [nameOf(m), m]));
  const nameById = new Map([...aModels.values()].map((m) => [m.props[0], nameOf(m)]));
  // use the stack that has curves (some files carry an empty "default" one beside the take)
  const layerOfStack = (s) => a.connections.filter((c) => c.kind === "OO" && c.parent === s.props[0]).map((c) => c.child);
  let best = null, longest = -1;
  for (const s of stacks) {
    const layers = layerOfStack(s);
    const nodes = curveNodes.filter((cn) => a.connections.some((c) => c.kind === "OO" && c.child === cn.props[0] && layers.includes(c.parent)));
    let end = 0;
    for (const cn of nodes) for (const c of a.connections) if (c.kind === "OP" && c.parent === cn.props[0]) { const cv = a.byId.get(c.child); if (cv && cv.name === "AnimationCurve") { const kt = child(cv, "KeyTime").props[0]; end = Math.max(end, kt[kt.length - 1]); } }
    if (end > longest) { best = nodes; longest = end; }
  }
  const channels = [];
  let duration = 0;
  for (const cn of best) {
    const target = a.connections.find((c) => c.kind === "OP" && c.child === cn.props[0] && nameById.has(c.parent));
    if (!target) continue;
    const boneName = nameById.get(target.parent);
    const node = nodeModels.findIndex((m) => nameOf(m) === boneName);
    if (node < 0) continue;
    const path = target.prop === "Lcl Translation" ? "translation" : target.prop === "Lcl Rotation" ? "rotation" : target.prop === "Lcl Scaling" ? "scale" : null;
    if (!path) continue;
    const axes = [null, null, null];
    for (const c of a.connections) if (c.kind === "OP" && c.parent === cn.props[0]) {
      const cv = a.byId.get(c.child);
      if (cv && cv.name === "AnimationCurve") axes["XYZ".indexOf(String(c.prop).slice(-1))] = { t: child(cv, "KeyTime").props[0].map((v) => v / KTIME), v: child(cv, "KeyValueFloat").props[0] };
    }
    const rest = path === "translation" ? locals[node].t.map((v) => (topLevel[node] ? v / k : v)) : path === "scale" ? locals[node].s.map((v) => (topLevel[node] ? v / k : v)) : prop(nodeModels[node], "Lcl Rotation", [0, 0, 0]);
    const times = [...new Set(axes.flatMap((x) => (x ? x.t : [])))].sort((p, q) => p - q);
    if (!times.length) continue;
    const sample = (x, i, t) => {
      if (!x) return rest[i];
      if (t <= x.t[0]) return x.v[0];
      if (t >= x.t[x.t.length - 1]) return x.v[x.v.length - 1];
      let j = 0; while (x.t[j + 1] < t) j++;
      return x.v[j] + (x.v[j + 1] - x.v[j]) * ((t - x.t[j]) / (x.t[j + 1] - x.t[j] || 1));
    };
    const values = [];
    let prev = null;
    for (const t of times) {
      const v = [0, 1, 2].map((i) => sample(axes[i], i, t));
      if (path === "rotation") {
        let q = eulerQ(v, locals[node].order);
        if (locals[node].pre) q = qmul(locals[node].pre, q);
        if (locals[node].post) q = qmul(q, qconj(locals[node].post));
        if (prev && prev[0]*q[0]+prev[1]*q[1]+prev[2]*q[2]+prev[3]*q[3] < 0) q = q.map((x) => -x);
        prev = q; values.push(...q);
      } else if (path === "translation" && topLevel[node]) values.push(...v.map((x) => x * k));
      else if (path === "scale" && topLevel[node]) values.push(...v.map((x) => x * k));
      else values.push(...v);
    }
    channels.push({ node, path, times, values });
    duration = Math.max(duration, times[times.length - 1]);
  }
  console.log(`animation ${name}: ${channels.length} channels, ${duration.toFixed(2)} s`);
  return { name, channels };
}
const animations = anims.map((a) => readAnimation(a.file, a.name));

// ---- the glb ----
const chunks = [];
const views = [], accessors = [];
function add(data, componentType, type, count, extra = {}, target) {
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  while (chunks.reduce((s, c) => s + c.length, 0) % 4) chunks.push(Buffer.alloc(1));
  const offset = chunks.reduce((s, c) => s + c.length, 0);
  chunks.push(buf);
  views.push({ buffer: 0, byteOffset: offset, byteLength: buf.length, ...(target ? { target } : {}) });
  accessors.push({ bufferView: views.length - 1, componentType, count, type, ...extra });
  return accessors.length - 1;
}
const bounds = (arr, n) => { const mn = new Array(n).fill(1e30), mx = new Array(n).fill(-1e30); for (let i = 0; i < arr.length; i += n) for (let j = 0; j < n; j++) { mn[j] = Math.min(mn[j], arr[i + j]); mx[j] = Math.max(mx[j], arr[i + j]); } return { min: mn, max: mx }; };
const aPos = add(new Float32Array(positions), 5126, "VEC3", positions.length / 3, bounds(positions, 3), 34962);
const aNor = add(new Float32Array(normalsOut), 5126, "VEC3", normalsOut.length / 3, {}, 34962);
const aUv = add(new Float32Array(uvOut), 5126, "VEC2", uvOut.length / 2, {}, 34962);
const aJoints = add(jointsOut, 5123, "VEC4", jointsOut.length / 4, {}, 34962);
const aWeights = add(weightsOut, 5126, "VEC4", weightsOut.length / 4, {}, 34962);
const aIdx = add(new Uint32Array(indices), 5125, "SCALAR", indices.length, {}, 34963);
const aIbm = add(new Float32Array(ibm), 5126, "MAT4", clusters.length);
const nodes = nodeModels.map((m, i) => {
  const l = locals[i], n = { name: nameOf(m) };
  if (l.t.some((v) => v !== 0)) n.translation = l.t;
  if (Math.abs(l.q[3]) < 0.99999) n.rotation = l.q;
  if (l.s.some((v) => Math.abs(v - 1) > 1e-6)) n.scale = l.s;
  const kids = nodeModels.map((c, j) => (parentOf.get(c.props[0]) === m.props[0] ? j : -1)).filter((j) => j >= 0);
  if (kids.length) n.children = kids;
  return n;
});
const meshNode = nodes.length;
nodes.push({ name: nameOf(meshModel), mesh: 0, skin: 0 });
const gltfAnimations = animations.map((a) => ({
  name: a.name,
  samplers: a.channels.map((c) => ({ input: add(new Float32Array(c.times), 5126, "SCALAR", c.times.length, { min: [c.times[0]], max: [c.times[c.times.length - 1]] }), output: add(new Float32Array(c.values), 5126, c.path === "rotation" ? "VEC4" : "VEC3", c.times.length), interpolation: "LINEAR" })),
  channels: a.channels.map((c, i) => ({ sampler: i, target: { node: c.node, path: c.path } })),
}));
const json = {
  asset: { version: "2.0", generator: "scripts/fbx2glb.mjs" },
  scene: 0, scenes: [{ nodes: [...nodeModels.map((_, i) => i).filter((i) => topLevel[i]), meshNode] }],
  nodes,
  meshes: [{ name: nameOf(meshModel), primitives: [{ attributes: { POSITION: aPos, NORMAL: aNor, TEXCOORD_0: aUv, JOINTS_0: aJoints, WEIGHTS_0: aWeights }, indices: aIdx, material: 0 }] }],
  skins: [{ joints, inverseBindMatrices: aIbm, skeleton: joints[0] }],
  materials: [{ name: "skin", pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1, ...(texture ? { baseColorTexture: { index: 0 } } : {}) } }],
  animations: gltfAnimations.length ? gltfAnimations : undefined,
  accessors, bufferViews: views,
};
if (texture) {
  const png = fs.readFileSync(texture);
  while (chunks.reduce((s, c) => s + c.length, 0) % 4) chunks.push(Buffer.alloc(1));
  const offset = chunks.reduce((s, c) => s + c.length, 0);
  chunks.push(png);
  views.push({ buffer: 0, byteOffset: offset, byteLength: png.length });
  json.images = [{ bufferView: views.length - 1, mimeType: "image/png" }];
  json.samplers = [{ magFilter: 9728, minFilter: 9728, wrapS: 10497, wrapT: 10497 }];
  json.textures = [{ source: 0, sampler: 0 }];
}
let bin = Buffer.concat(chunks);
bin = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
json.buffers = [{ byteLength: bin.length }];
let js = Buffer.from(JSON.stringify(json));
js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
const header = Buffer.alloc(12); header.write("glTF", 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8);
const ch = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.write(type, 4); return b; };
fs.writeFileSync(positional[1], Buffer.concat([header, ch(js.length, "JSON"), js, ch(bin.length, "BIN\0"), bin]));
console.log(`${positional[1]}: ${positions.length / 3} vertices, ${indices.length / 3} triangles, ${nodes.length} nodes, ${joints.length} joints, ${animations.length} animations`);
