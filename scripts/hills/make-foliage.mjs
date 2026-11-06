// Makes the foliage models for Hill Run (examples/hill-run/models): a tuft of grass, a flower tuft and a bush, as plain
// vertex-coloured glTF (no textures), small enough to scatter by the thousand. Blades are drawn from both sides (the renderer
// culls back faces), thin, and coloured from a dark base to a bright tip, so that the wind (which bends a vertex by its height)
// and the light do the rest.   node scripts/hills/make-foliage.mjs
import fs from "node:fs";

let seed = 11;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

function mesh() { return { positions: [], normals: [], colors: [], indices: [] }; }
function tri(m, a, b, c, ca, cb, cc) {
  const n = (() => { const u = [b[0]-a[0], b[1]-a[1], b[2]-a[2]], v = [c[0]-a[0], c[1]-a[1], c[2]-a[2]]; const x = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]]; const l = Math.hypot(...x) || 1; return x.map((q) => q / l); })();
  for (const side of [1, -1]) { // both sides: a second copy facing the other way
    const base = m.positions.length / 3;
    const order = side === 1 ? [[a, ca], [b, cb], [c, cc]] : [[a, ca], [c, cc], [b, cb]];
    for (const [p, col] of order) { m.positions.push(...p); m.normals.push(n[0] * side, n[1] * side, n[2] * side); m.colors.push(...col, 1); }
    m.indices.push(base, base + 1, base + 2);
  }
}
// ---- a tuft of grass: blades leaning out from the middle ----
function grass(blades, height, colorBase, colorTip, flower) {
  const m = mesh();
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2 + rnd() * 0.5, r = 0.02 + rnd() * 0.08;
    const h = height * (0.7 + rnd() * 0.6), lean = 0.08 + rnd() * 0.2, w = 0.035 + rnd() * 0.02;
    const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
    const px = -Math.sin(a), pz = Math.cos(a);
    const tipX = cx + Math.cos(a) * lean * h, tipZ = cz + Math.sin(a) * lean * h;
    const v = 0.85 + rnd() * 0.3;
    const cb = colorBase.map((x) => x * v), ct = colorTip.map((x) => x * v);
    tri(m, [cx - px * w, 0, cz - pz * w], [cx + px * w, 0, cz + pz * w], [tipX, h, tipZ], cb, cb, ct);
  }
  if (flower) { // a few blades are stems with a small coloured head: a diamond at the top
    for (let i = 0; i < 3; i++) {
      const a = rnd() * Math.PI * 2, x = Math.cos(a) * 0.1, z = Math.sin(a) * 0.1, h = height * (0.9 + rnd() * 0.3);
      const sc = [0.2, 0.5, 0.15];
      tri(m, [x - 0.012, 0, z], [x + 0.012, 0, z], [x, h, z], sc, sc, sc);
      const head = flower[i % flower.length], s = 0.05;
      tri(m, [x - s, h, z], [x + s, h, z], [x, h + s * 1.6, z], head, head, head);
      tri(m, [x, h, z - s], [x, h, z + s], [x, h + s * 1.6, z], head, head, head);
    }
  }
  return m;
}
// ---- a bush: three lumpy blobs ----
function blob(m, cx, cy, cz, r, color, detail = 2) {
  // an octahedron split `detail` times, pushed out to a sphere
  let faces = [[[1,0,0],[0,1,0],[0,0,1]],[[0,1,0],[-1,0,0],[0,0,1]],[[-1,0,0],[0,-1,0],[0,0,1]],[[0,-1,0],[1,0,0],[0,0,1]],[[0,1,0],[1,0,0],[0,0,-1]],[[-1,0,0],[0,1,0],[0,0,-1]],[[0,-1,0],[-1,0,0],[0,0,-1]],[[1,0,0],[0,-1,0],[0,0,-1]]];
  const mid = (p, q) => { const x = [(p[0]+q[0])/2, (p[1]+q[1])/2, (p[2]+q[2])/2]; const l = Math.hypot(...x); return x.map((v) => v / l); };
  for (let d = 0; d < detail; d++) faces = faces.flatMap(([a, b, c]) => { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); return [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]]; });
  for (const f of faces) {
    const pts = f.map((p) => { const j = 0.88 + 0.24 * rnd(); return [cx + p[0] * r * j, cy + p[1] * r * j * 0.85, cz + p[2] * r * j]; });
    const n = (() => { const u = pts[1].map((v, i) => v - pts[0][i]), w = pts[2].map((v, i) => v - pts[0][i]); const x = [u[1]*w[2]-u[2]*w[1], u[2]*w[0]-u[0]*w[2], u[0]*w[1]-u[1]*w[0]]; const l = Math.hypot(...x) || 1; return x.map((q) => q / l); })();
    const base = m.positions.length / 3;
    for (const p of pts) { m.positions.push(...p); m.normals.push(...n); const shade = 0.75 + 0.5 * Math.max(0, (p[1] - cy) / r); m.colors.push(color[0] * shade, color[1] * shade, color[2] * shade, 1); }
    m.indices.push(base, base + 1, base + 2);
  }
}
function bush() {
  const m = mesh();
  blob(m, 0, 0.45, 0, 0.55, [0.2, 0.46, 0.16]);
  blob(m, 0.42, 0.34, 0.12, 0.4, [0.24, 0.5, 0.18]);
  blob(m, -0.3, 0.36, -0.3, 0.42, [0.18, 0.42, 0.14]);
  return m;
}

function glb(m, file) {
  const f32 = (a) => Buffer.from(new Float32Array(a).buffer);
  const bin = Buffer.concat([f32(m.positions), f32(m.normals), f32(m.colors), Buffer.from(new Uint32Array(m.indices).buffer)]);
  const vc = m.positions.length / 3;
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (let i = 0; i < vc; i++) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], m.positions[i * 3 + k]); hi[k] = Math.max(hi[k], m.positions[i * 3 + k]); }
  const json = {
    asset: { version: "2.0", generator: "scripts/hills/make-foliage.mjs" },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: file.split("/").pop().replace(".glb", ""), mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 }, indices: 3, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 } }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: vc, type: "VEC3", min: lo, max: hi },
      { bufferView: 1, componentType: 5126, count: vc, type: "VEC3" },
      { bufferView: 2, componentType: 5126, count: vc, type: "VEC4" },
      { bufferView: 3, componentType: 5125, count: m.indices.length, type: "SCALAR" },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: vc * 12 }, { buffer: 0, byteOffset: vc * 12, byteLength: vc * 12 },
      { buffer: 0, byteOffset: vc * 24, byteLength: vc * 16 }, { buffer: 0, byteOffset: vc * 40, byteLength: m.indices.length * 4 },
    ],
    buffers: [{ byteLength: bin.length }],
  };
  let js = Buffer.from(JSON.stringify(json));
  js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const body = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
  const header = Buffer.alloc(12); header.write("glTF", 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + js.length + 8 + body.length, 8);
  const ch = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.write(type, 4); return b; };
  fs.writeFileSync(file, Buffer.concat([header, ch(js.length, "JSON"), js, ch(body.length, "BIN\0"), body]));
  console.log(`${file}: ${vc} vertices, ${m.indices.length / 3} triangles`);
}
const dir = "examples/hill-run/models";
glb(grass(8, 0.42, [0.1, 0.27, 0.07], [0.5, 0.78, 0.22]), `${dir}/grass.glb`);
glb(grass(7, 0.55, [0.12, 0.3, 0.08], [0.62, 0.82, 0.3], [[0.95, 0.85, 0.25], [0.9, 0.35, 0.45], [0.95, 0.95, 0.9]]), `${dir}/flowers.glb`);
glb(bush(), `${dir}/bush.glb`);
