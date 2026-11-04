// Copies models from a Kenney kit (CC0, https://kenney.nl/assets) into a project's models/ folder, ready for the runtime:
// the kit's .glb files point at Textures/colormap.png, and the runtime reads a .glb on its own (see the TODO), so the texture is
// embedded; two extensions that only restate the defaults or that the runtime warns about are dropped.
//
//   node scripts/kenney.mjs <unzipped kit folder> <project folder> <model name> [options]...
//   node scripts/kenney.mjs <kit> <project> <name> [<name>...]            (several names: plain copies)
//
// Options (for one model name):
//   --as <name>             save it as models/<name>.glb
//   --fit <x|y|z>=<metres>  scale it (the geometry itself, not a node) so that its extent on that axis is that long
//   --rename a=b,c=d        rename nodes (the runtime's parts are the nodes: a script turns "wheel_fl", not "wheel-front-right")
//   --pivot-wheels          for nodes named like wheels: move the node's origin to the wheel's middle, so that it spins and
//                           steers about its own centre (the kit puts the origin on the car's side of the wheel)
//   --turn <degrees>        turn it about the up axis (a quarter turn at a time is exact)
//   --centre                put the middle of its footprint (x and z) at the origin; the kit's pieces carry an offset to a tile corner
//   --centre-axles          (with --pivot-wheels) move it along z so that the wheels' middle is the origin, as a driving script expects
//   --collider x:z:r        a circle on the ground the model blocks (metres, after the scale); repeat it for more
//
// A model name is the file's name without .glb; it is looked for anywhere under the kit (a "GLB format" or "GLTF format"
// folder first). Put the kit's License.txt in licenses/ yourself (see licenses/kenney-kits.txt).
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const positional = [];
const opt = { colliders: [], rename: {} };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--as") opt.as = args[++i];
  else if (a === "--fit") opt.fit = args[++i];
  else if (a === "--rename") for (const kv of args[++i].split(",")) { const [k, v] = kv.split("="); opt.rename[k] = v; }
  else if (a === "--pivot-wheels") opt.pivotWheels = true;
  else if (a === "--turn") opt.turn = Number(args[++i]);
  else if (a === "--centre") opt.centre = true;
  else if (a === "--centre-axles") opt.centreAxles = true;
  else if (a === "--collider") opt.colliders.push(args[++i].split(":").map(Number));
  else positional.push(a);
}
const [kit, project, ...names] = positional;
if (!kit || !project || names.length === 0) {
  throw new Error("usage: node scripts/kenney.mjs <unzipped kit folder> <project folder> <model name>... [options]");
}
if ((opt.as || opt.fit || opt.colliders.length) && names.length !== 1) throw new Error("--as, --fit and --collider need exactly one model name");
const out = path.join(project, "models");
const pad = (b, fill) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4, fill)]);

function find(name) {
  const hits = [];
  (function walk(d) {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (f === name + ".glb") hits.push(p);
    }
  })(kit);
  hits.sort((a, b) => Number(/GLB|GLTF/i.test(b)) - Number(/GLB|GLTF/i.test(a)));
  if (!hits.length) throw new Error(`no ${name}.glb under ${kit}`);
  return hits[0];
}

/** The box around all the meshes at their nodes' places (nodes with a translation, and the turn about up that --turn gives). */
/** The turn about the up axis a node's rotation holds (these kits only turn about up). */
const yawOf = (n) => (n.rotation ? 2 * Math.atan2(n.rotation[1], n.rotation[3]) : 0);

function bounds(json) {
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (const n of json.nodes) {
    if (n.mesh == null) continue;
    const t = n.translation || [0, 0, 0];
    const yaw = yawOf(n);
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    for (const p of json.meshes[n.mesh].primitives) {
      const a = json.accessors[p.attributes.POSITION];
      for (const x of [a.min[0], a.max[0]]) for (const z of [a.min[2], a.max[2]]) {
        const corner = [x * c + z * sn + t[0], 0, -x * sn + z * c + t[2]];
        lo[0] = Math.min(lo[0], corner[0]); hi[0] = Math.max(hi[0], corner[0]);
        lo[2] = Math.min(lo[2], corner[2]); hi[2] = Math.max(hi[2], corner[2]);
      }
      lo[1] = Math.min(lo[1], a.min[1] + t[1]); hi[1] = Math.max(hi[1], a.max[1] + t[1]);
    }
  }
  return { lo, hi };
}

/** Turns the roots about the up axis (their places turn too). */
function turn(json, degrees) {
  const yaw = (degrees * Math.PI) / 180, c = Math.cos(yaw), sn = Math.sin(yaw);
  for (const i of json.scenes[0].nodes) {
    const n = json.nodes[i];
    const t = n.translation || [0, 0, 0];
    n.translation = [t[0] * c + t[2] * sn, t[1], -t[0] * sn + t[2] * c];
    const total = yawOf(n) + yaw;
    n.rotation = [0, Math.sin(total / 2), 0, Math.cos(total / 2)];
  }
}

/** Moves the roots along z so that the middle of the wheels (nodes named wheel_*) is at the origin. */
function centreAxles(json) {
  const wheels = json.scenes[0].nodes.map((i) => json.nodes[i]).filter((n) => /^wheel/i.test(n.name) && n.mesh == null);
  if (!wheels.length) return;
  const mean = wheels.reduce((sum, n) => sum + n.translation[2], 0) / wheels.length;
  for (const i of json.scenes[0].nodes) {
    const n = json.nodes[i];
    const t = n.translation || [0, 0, 0];
    n.translation = [t[0], t[1], t[2] - mean];
  }
}

/** Moves the roots so that the middle of the footprint is at the origin. */
function centre(json) {
  const { lo, hi } = bounds(json);
  const dx = (lo[0] + hi[0]) / 2, dz = (lo[2] + hi[2]) / 2;
  for (const i of json.scenes[0].nodes) {
    const n = json.nodes[i];
    const t = n.translation || [0, 0, 0];
    n.translation = [t[0] - dx, t[1], t[2] - dz];
  }
}

/** Multiplies every position (and the accessors' ranges and the nodes' places) by `s`. */
function scaleGeometry(json, bin, s) {
  const done = new Set();
  for (const mesh of json.meshes) {
    for (const p of mesh.primitives) {
      const idx = p.attributes.POSITION;
      if (done.has(idx)) continue;
      done.add(idx);
      const acc = json.accessors[idx];
      const view = json.bufferViews[acc.bufferView];
      const stride = view.byteStride || 12;
      const base = (view.byteOffset || 0) + (acc.byteOffset || 0);
      for (let i = 0; i < acc.count; i++) for (let k = 0; k < 3; k++) {
        const at = base + i * stride + k * 4;
        bin.writeFloatLE(bin.readFloatLE(at) * s, at);
      }
      acc.min = acc.min.map((v) => v * s);
      acc.max = acc.max.map((v) => v * s);
    }
  }
  for (const n of json.nodes) if (n.translation) n.translation = n.translation.map((v) => v * s);
}

/** Each wheel node becomes a parent at the wheel's middle with the mesh node as its child, so spin and steer are about the middle. */
function pivotWheels(json) {
  const roots = json.scenes[0].nodes;
  for (const i of [...roots]) {
    const n = json.nodes[i];
    if (n.mesh == null || !/wheel/i.test(n.name)) continue;
    const a = json.accessors[json.meshes[n.mesh].primitives[0].attributes.POSITION];
    const centre = [0, 1, 2].map((k) => (a.min[k] + a.max[k]) / 2);
    const t = n.translation || [0, 0, 0];
    const parent = { name: n.name, translation: [t[0] + centre[0], t[1] + centre[1], t[2] + centre[2]], children: [] };
    n.name = n.name + "_mesh";
    n.translation = centre.map((v) => -v);
    json.nodes.push(parent);
    parent.children.push(i);
    roots[roots.indexOf(i)] = json.nodes.length - 1;
  }
}

fs.mkdirSync(out, { recursive: true });
for (const name of names) {
  const file = find(name);
  const b = fs.readFileSync(file);
  const jsonLen = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + jsonLen).toString().trim());
  const binStart = 20 + jsonLen + 8;
  let bin = Buffer.from(b.subarray(binStart, binStart + b.readUInt32LE(20 + jsonLen)));
  for (const n of json.nodes) if (n.name in opt.rename) n.name = opt.rename[n.name];
  if (opt.fit) {
    const [axis, metres] = opt.fit.split("=");
    const k = "xyz".indexOf(axis);
    const { lo, hi } = bounds(json);
    scaleGeometry(json, bin, Number(metres) / (hi[k] - lo[k]));
  }
  if (opt.pivotWheels) pivotWheels(json);
  if (opt.centreAxles) centreAxles(json);
  if (opt.turn) turn(json, opt.turn);
  if (opt.centre) centre(json);
  if (opt.colliders.length) json.scenes[0].extras = { nova: { colliders: opt.colliders } };
  for (const image of json.images || []) {
    if (!image.uri) continue;
    const candidates = [path.join(path.dirname(file), image.uri), path.join(kit, image.uri)];
    const found = candidates.find((c) => fs.existsSync(c));
    if (!found) throw new Error(`${name}: texture ${image.uri} not found`);
    const png = fs.readFileSync(found);
    const offset = pad(bin, 0).length;
    bin = Buffer.concat([pad(bin, 0), png]);
    json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: png.length });
    delete image.uri;
    image.bufferView = json.bufferViews.length - 1;
    image.mimeType = "image/png";
  }
  const DROP = ["KHR_texture_transform", "KHR_materials_unlit"];
  for (const m of json.materials || []) {
    for (const holder of [m, ...Object.values(m.pbrMetallicRoughness || {}), m.normalTexture, m.occlusionTexture, m.emissiveTexture]) {
      if (holder && typeof holder === "object" && holder.extensions) {
        for (const e of DROP) delete holder.extensions[e];
        if (!Object.keys(holder.extensions).length) delete holder.extensions;
      }
    }
  }
  for (const key of ["extensionsUsed", "extensionsRequired"]) {
    if (json[key]) json[key] = json[key].filter((e) => !DROP.includes(e));
    if (json[key] && !json[key].length) delete json[key];
  }
  json.buffers[0].byteLength = pad(bin, 0).length;
  const j = pad(Buffer.from(JSON.stringify(json)), 0x20);
  const bn = pad(bin, 0);
  const head = Buffer.alloc(12);
  head.write("glTF", 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + 8 + j.length + 8 + bn.length, 8);
  const c0 = Buffer.alloc(8);
  c0.writeUInt32LE(j.length, 0);
  c0.write("JSON", 4);
  const c1 = Buffer.alloc(8);
  c1.writeUInt32LE(bn.length, 0);
  c1.write("BIN\0", 4);
  const target = opt.as || name;
  fs.writeFileSync(path.join(out, target + ".glb"), Buffer.concat([head, c0, j, c1, bn]));
  console.log(`${name} -> models/${target}.glb`.padEnd(48), bn.length, "bytes of data");
}
