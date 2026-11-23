// What can hide the postmaster from the camera (lib/occluders.lua reads lib/occluders_data.lua, which this writes). Run from the
// repository's root, after tools/models.mjs and tools/scene.mjs:  scripts/env.sh node examples/mountain-post/tools/occluders.mjs
// For each kind of scenery that is big enough to stand between the camera and a person (tree crowns, the masses of forest, the
// post office with its porch roof, the cabins, the workshop) the shape of its model is read from its .glb and kept as a stack of thin
// bands (every BAND metres of height: the extent of its vertices in that band, as a box on the ground and as a radius round its axis).
// The instances are read from the valley's scene file. Grass, ferns, bushes, rocks, fences, small props, people and the van are not here.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const GAME = join(dirname(fileURLToPath(import.meta.url)), "..");
const BAND = 0.5;
// round: a solid of revolution (trees, the round and tall masses); else boxes turned with the piece
const KINDS = {
  pine: "round", pine2: "round", pine3: "round", larch: "round", larch_small: "round", birch: "round",
  forest_tall: "round", forest_round: "round", forest_long: "box",
  post_office: "box", cabin_hazel: "box", cabin_pip: "box", workshop: "box",
};

// ---- a .glb's triangles' vertices in model space -------------------------------------------------------------------------------------
function glbPoints(file) {
  const b = readFileSync(file);
  const jlen = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + jlen).toString("utf8"));
  const bin = b.subarray(20 + jlen + 8);
  const mul = (a, m) => { const r = new Array(16).fill(0); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) r[j * 4 + i] += a[k * 4 + i] * m[j * 4 + k]; return r; };
  const local = (n) => {
    if (n.matrix) return n.matrix;
    const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1], [sx, sy, sz] = n.scale ?? [1, 1, 1], [tx, ty, tz] = n.translation ?? [0, 0, 0];
    return [
      (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
      2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
      2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
      tx, ty, tz, 1,
    ];
  };
  const pts = [];
  const visit = (i, parent) => {
    const n = json.nodes[i], m = mul(parent, local(n));
    if (n.mesh !== undefined) {
      for (const prim of json.meshes[n.mesh].primitives) {
        const a = json.accessors[prim.attributes.POSITION], v = json.bufferViews[a.bufferView];
        const off = (v.byteOffset ?? 0) + (a.byteOffset ?? 0), stride = v.byteStride ?? 12;
        const vert = [];
        for (let k = 0; k < a.count; k++) {
          const p = [0, 1, 2].map((c) => bin.readFloatLE(off + k * stride + c * 4));
          vert.push([0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]));
        }
        let idx = vert.map((_, k) => k);
        if (prim.indices !== undefined) {
          const ia = json.accessors[prim.indices], iv = json.bufferViews[ia.bufferView], io = (iv.byteOffset ?? 0) + (ia.byteOffset ?? 0);
          const size = ia.componentType === 5125 ? 4 : ia.componentType === 5123 ? 2 : 1;
          idx = Array.from({ length: ia.count }, (_, k) => (size === 4 ? bin.readUInt32LE(io + k * 4) : size === 2 ? bin.readUInt16LE(io + k * 2) : bin[io + k]));
        }
        // (points over the whole surface of every triangle, about 0.2 m apart: a roof with a vertex at each corner fills its bands too)
        for (let t = 0; t + 2 < idx.length; t += 3) {
          const A = vert[idx[t]], B = vert[idx[t + 1]], C = vert[idx[t + 2]];
          const len = Math.max(Math.hypot(...B.map((x, i) => x - A[i])), Math.hypot(...C.map((x, i) => x - A[i])), Math.hypot(...C.map((x, i) => x - B[i])));
          const n = Math.min(60, Math.max(1, Math.ceil(len / 0.2)));
          for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) pts.push(A.map((x, d) => x + ((B[d] - x) * i + (C[d] - x) * j) / n));
        }
      }
    }
    for (const c of n.children ?? []) visit(c, m);
  };
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const i of json.scenes[json.scene ?? 0].nodes) visit(i, I);
  return pts;
}

const r2 = (v) => Math.round(v * 100) / 100;
const profiles = {};
for (const kind of Object.keys(KINDS)) {
  const pts = glbPoints(join(GAME, "models", `${kind}.glb`));
  let top = 0;
  for (const p of pts) if (p[1] > top) top = p[1];
  // (the surface's points binned by band: the extent of each as a box and as a radius round the axis)
  const bins = Array.from({ length: Math.ceil(top / BAND) }, () => [1e9, -1e9, 1e9, -1e9, 0, 0]);
  for (const p of pts) {
    const b = bins[Math.min(bins.length - 1, Math.max(0, Math.floor(p[1] / BAND)))];
    b[0] = Math.min(b[0], p[0]); b[1] = Math.max(b[1], p[0]); b[2] = Math.min(b[2], p[2]); b[3] = Math.max(b[3], p[2]);
    b[4] = Math.max(b[4], Math.hypot(p[0], p[2])); b[5]++;
  }
  const bands = bins.map((b) => (b[5] ? b.slice(0, 5).map(r2) : null));
  profiles[kind] = { round: KINDS[kind] === "round", top: r2(top), bands };
}

const scene = JSON.parse(readFileSync(join(GAME, "scenes", "valley.scene.json"), "utf8"));
const inst = scene.objects.filter((o) => KINDS[o.kind] && !o.name?.startsWith("lod_"));

let out = `-- GENERATED by tools/occluders.mjs (from the models' .glb and scenes/valley.scene.json): do not edit. What can hide a person from the camera:\n`;
out += `-- each kind's shape as bands ${BAND} m high ({ x0, x1, z0, z1, radius }, metres at scale 1, nil where the model is empty), and every piece placed.\n`;
out += `return {\n  band = ${BAND},\n  kinds = {\n`;
for (const [k, p] of Object.entries(profiles)) {
  out += `    ${k} = { round = ${p.round}, top = ${p.top}, bands = { ${p.bands.map((b) => (b ? `{${b.join(",")}}` : "false")).join(", ")} } },\n`;
}
out += `  },\n  -- kind, x, z, turn (ry), size (sx)\n  pieces = {\n`;
for (const o of inst) out += `    { "${o.kind}", ${o.x}, ${o.z}, ${o.props?.ry ?? 0}, ${o.props?.sx ?? 1} },\n`;
out += `  },\n}\n`;
writeFileSync(join(GAME, "lib", "occluders_data.lua"), out);
console.log(`occluders: ${inst.length} pieces of ${Object.keys(profiles).length} kinds`);
