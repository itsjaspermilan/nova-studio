// Makes the models and pictures of examples/material-demo and the test fixture for normal maps, with no dependencies:
// a tiny PNG encoder (zlib from Node) and a GLB writer.
//   scripts/env.sh node scripts/materials/make-assets.mjs
//
// examples/material-demo/models/
//   bricks.glb  a 2 m block of bricks: a base colour picture, a normal map (the mortar is sunk) and a metallic-roughness map
//               (bricks a little shiny, mortar rough); no TANGENT, so Nova works the tangents out
//   orb.glb     a sphere of polished gold (metallic 1, roughness 0.25), no pictures
//   glow.glb    a cube that glows orange (a coloured emissiveFactor)
//   pool.glb    a 10 m square of water, 20 x 20 squares, UVs 0 to 1 (for the water shader)
//   pillar.glb  a stone pillar (for the dissolve shader)
//   ground.glb  40 m of plain grass
// examples/material-demo/sprites/noise.png   smooth noise for the dissolve shader
// crates/nova-runtime/tests/fixtures/normal_tilt_quad.glb   a 2 m quad facing +z whose normal map tips every normal up the picture
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const demo = path.join(root, "examples/material-demo");

// ---- PNG ----
const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** rgba: Uint8Array of w*h*4 */
function png(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
function picture(w, h, f) {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = f(x, y);
      out.set([c[0], c[1], c[2], c[3] ?? 255].map((v) => Math.max(0, Math.min(255, Math.round(v)))), (y * w + x) * 4);
    }
  return out;
}

// ---- noise ----
function hash(x, y, seed = 0) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function valueNoise(x, y, period, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const s = (t) => t * t * (3 - 2 * t);
  const g = (a, b) => hash(((a % period) + period) % period, ((b % period) + period) % period, seed);
  const top = g(xi, yi) + (g(xi + 1, yi) - g(xi, yi)) * s(fx);
  const bot = g(xi, yi + 1) + (g(xi + 1, yi + 1) - g(xi, yi + 1)) * s(fx);
  return top + (bot - top) * s(fy);
}
function fbm(x, y, period, seed) {
  let v = 0, a = 0.5, f = 1;
  for (let o = 0; o < 4; o++) {
    v += a * valueNoise(x * f, y * f, period * f, seed + o);
    a *= 0.5;
    f *= 2;
  }
  return v / 0.9375;
}

// ---- bricks: a height field, its colour, its normals (glTF: +x right, +y up the picture), its roughness ----
const B = 256;
const rows = 8, cols = 4; // bricks per picture
function brickAt(x, y) {
  const row = Math.floor((y / B) * rows);
  const shift = row % 2 ? 0.5 : 0;
  const u = (x / B) * cols + shift;
  const col = Math.floor(u);
  const fu = u - col, fv = (y / B) * rows - row;
  // distance to the mortar, in picture pixels
  const du = Math.min(fu, 1 - fu) * (B / cols), dv = Math.min(fv, 1 - fv) * (B / rows);
  return { row, col: ((col % cols) + cols) % cols, edge: Math.min(du, dv) };
}
function brickHeight(x, y) {
  const xw = ((x % B) + B) % B, yw = ((y % B) + B) % B;
  const { edge } = brickAt(xw, yw);
  const mortar = 3.0;
  const bevel = Math.min(1, Math.max(0, (edge - mortar) / 3));
  return bevel * (0.9 + 0.1 * fbm(xw / 16, yw / 16, 16, 7)) + 0.04 * fbm(xw / 6, yw / 6, B / 6, 3);
}
const bricksColour = picture(B, B, (x, y) => {
  const { row, col, edge } = brickAt(x, y);
  if (edge < 3) return [150, 142, 130];
  const t = hash(row, col, 11);
  const n = fbm(x / 9, y / 9, B / 9, 5);
  return [150 + 50 * t + 30 * n, 62 + 20 * t + 18 * n, 46 + 12 * t + 12 * n];
});
const bump = 6.0;
const bricksNormal = picture(B, B, (x, y) => {
  const dx = (brickHeight(x + 1, y) - brickHeight(x - 1, y)) * 0.5 * bump;
  const drow = (brickHeight(x, y + 1) - brickHeight(x, y - 1)) * 0.5 * bump;
  // up the picture is -row: n = (-dh/dx, -dh/dup, 1) = (-dh/dx, dh/drow, 1)
  const n = [-dx, drow, 1];
  const l = Math.hypot(...n);
  return n.map((v) => (v / l) * 127.5 + 127.5);
});
const bricksSurface = picture(B, B, (x, y) => {
  const { edge } = brickAt(x, y);
  // green: roughness (bricks 0.55, mortar 1), blue: metallic (none)
  const rough = edge < 3 ? 1 : 0.55 + 0.25 * fbm(x / 12, y / 12, B / 12, 9);
  return [255, rough * 255, 0];
});

// ---- GLB ----
function glb({ meshes, images = [], materials, name }) {
  const bin = [];
  let offset = 0;
  const bufferViews = [], accessors = [];
  const add = (data, target) => {
    const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    const pad = (4 - (buf.length % 4)) % 4;
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: buf.length, ...(target ? { target } : {}) });
    bin.push(buf, Buffer.alloc(pad));
    offset += buf.length + pad;
    return bufferViews.length - 1;
  };
  const accessor = (array, type, comps, extra = {}) => {
    const view = add(array, extra.index ? 34963 : 34962);
    const count = array.length / comps;
    const acc = { bufferView: view, componentType: extra.index ? 5125 : 5126, count, type };
    if (type === "VEC3" && extra.bounds) {
      const min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
      for (let i = 0; i < count; i++)
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k], array[i * 3 + k]);
          max[k] = Math.max(max[k], array[i * 3 + k]);
        }
      Object.assign(acc, { min, max });
    }
    accessors.push(acc);
    return accessors.length - 1;
  };
  const gltfMeshes = meshes.map((m) => ({
    primitives: [
      {
        attributes: {
          POSITION: accessor(new Float32Array(m.positions), "VEC3", 3, { bounds: true }),
          NORMAL: accessor(new Float32Array(m.normals), "VEC3", 3),
          ...(m.uvs ? { TEXCOORD_0: accessor(new Float32Array(m.uvs), "VEC2", 2) } : {}),
        },
        indices: accessor(new Uint32Array(m.indices), "SCALAR", 1, { index: true }),
        material: m.material,
      },
    ],
  }));
  const imageDefs = images.map((p) => ({ bufferView: add(new Uint8Array(p), null), mimeType: "image/png" }));
  const json = {
    asset: { version: "2.0", generator: "Nova scripts/materials/make-assets.mjs" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name, mesh: 0 }],
    meshes: gltfMeshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: offset }],
  };
  if (images.length) {
    json.images = imageDefs;
    json.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }];
    json.textures = images.map((_, i) => ({ source: i, sampler: 0 }));
  }
  const jsonBuf = Buffer.from(JSON.stringify(json));
  const jsonPad = Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20);
  const binBuf = Buffer.concat(bin);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  const jsonHead = Buffer.alloc(8);
  jsonHead.writeUInt32LE(jsonBuf.length + jsonPad.length, 0);
  jsonHead.writeUInt32LE(0x4e4f534a, 4);
  const binHead = Buffer.alloc(8);
  binHead.writeUInt32LE(binBuf.length, 0);
  binHead.writeUInt32LE(0x004e4942, 4);
  const total = 12 + 8 + jsonBuf.length + jsonPad.length + 8 + binBuf.length;
  header.writeUInt32LE(total, 8);
  return Buffer.concat([header, jsonHead, jsonBuf, jsonPad, binHead, binBuf]);
}

// ---- shapes ----
/** A box from (x0,y0,z0) to (x1,y1,z1), each face with UVs 0..repeat (u to the right, v down, seen from outside). */
function box([x0, y0, z0], [x1, y1, z1], repeat = 1) {
  const positions = [], normals = [], uvs = [], indices = [];
  // each face: normal, a corner at the picture's top left, the way u runs and the way v runs (down the picture)
  const faces = [
    { n: [0, 0, 1], o: [x0, y1, z1], u: [x1 - x0, 0, 0], v: [0, y0 - y1, 0] },
    { n: [0, 0, -1], o: [x1, y1, z0], u: [x0 - x1, 0, 0], v: [0, y0 - y1, 0] },
    { n: [1, 0, 0], o: [x1, y1, z1], u: [0, 0, z0 - z1], v: [0, y0 - y1, 0] },
    { n: [-1, 0, 0], o: [x0, y1, z0], u: [0, 0, z1 - z0], v: [0, y0 - y1, 0] },
    { n: [0, 1, 0], o: [x0, y1, z0], u: [x1 - x0, 0, 0], v: [0, 0, z1 - z0] },
    { n: [0, -1, 0], o: [x0, y0, z1], u: [x1 - x0, 0, 0], v: [0, 0, z0 - z1] },
  ];
  for (const f of faces) {
    const base = positions.length / 3;
    for (const [a, b] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      positions.push(f.o[0] + f.u[0] * a + f.v[0] * b, f.o[1] + f.u[1] * a + f.v[1] * b, f.o[2] + f.u[2] * a + f.v[2] * b);
      normals.push(...f.n);
      uvs.push(a * repeat, b * repeat);
    }
    // counter-clockwise seen from outside: o, o+v, o+u+v / o, o+u+v, o+u
    indices.push(base, base + 3, base + 2, base, base + 2, base + 1);
  }
  return { positions, normals, uvs, indices };
}
function sphere(r, cy, seg = 32, ring = 20) {
  const positions = [], normals = [], uvs = [], indices = [];
  for (let j = 0; j <= ring; j++) {
    const v = j / ring, th = v * Math.PI;
    for (let i = 0; i <= seg; i++) {
      const u = i / seg, ph = u * Math.PI * 2;
      const n = [Math.sin(th) * Math.cos(ph), Math.cos(th), -Math.sin(th) * Math.sin(ph)];
      positions.push(n[0] * r, n[1] * r + cy, n[2] * r);
      normals.push(...n);
      uvs.push(u, v);
    }
  }
  for (let j = 0; j < ring; j++)
    for (let i = 0; i < seg; i++) {
      const a = j * (seg + 1) + i, b = a + seg + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  return { positions, normals, uvs, indices };
}
function cylinder(r, h, seg = 24) {
  const positions = [], normals = [], uvs = [], indices = [];
  for (let k = 0; k <= 1; k++)
    for (let i = 0; i <= seg; i++) {
      const u = i / seg, a = u * Math.PI * 2;
      positions.push(Math.cos(a) * r, k * h, -Math.sin(a) * r);
      normals.push(Math.cos(a), 0, -Math.sin(a));
      uvs.push(u * 2, (1 - k) * 3);
    }
  for (let i = 0; i < seg; i++) {
    const a = i, b = i + seg + 1;
    indices.push(a, a + 1, b + 1, a, b + 1, b);
  }
  // the top: a fan
  const top = positions.length / 3;
  positions.push(0, h, 0);
  normals.push(0, 1, 0);
  uvs.push(0.5, 0.5);
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    positions.push(Math.cos(a) * r, h, -Math.sin(a) * r);
    normals.push(0, 1, 0);
    uvs.push(0.5 + Math.cos(a) * 0.5, 0.5 - Math.sin(a) * 0.5);
  }
  for (let i = 0; i < seg; i++) indices.push(top, top + 1 + i, top + 2 + i);
  return { positions, normals, uvs, indices };
}
function grid(size, n) {
  const positions = [], normals = [], uvs = [], indices = [];
  for (let j = 0; j <= n; j++)
    for (let i = 0; i <= n; i++) {
      positions.push((i / n - 0.5) * size, 0, (j / n - 0.5) * size);
      normals.push(0, 1, 0);
      uvs.push(i / n, j / n);
    }
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i, b = a + n + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  return { positions, normals, uvs, indices };
}

const write = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  console.log(path.relative(root, file), data.length, "bytes");
};

write(
  path.join(demo, "models/bricks.glb"),
  glb({
    name: "bricks",
    meshes: [{ ...box([-1, 0, -1], [1, 2, 1]), material: 0 }],
    images: [png(B, B, bricksColour), png(B, B, bricksNormal), png(B, B, bricksSurface)],
    materials: [
      {
        name: "bricks",
        pbrMetallicRoughness: {
          baseColorTexture: { index: 0 },
          metallicRoughnessTexture: { index: 2 },
          metallicFactor: 0,
          roughnessFactor: 1,
        },
        normalTexture: { index: 1, scale: 1 },
      },
    ],
  }),
);
write(
  path.join(demo, "models/orb.glb"),
  glb({
    name: "orb",
    meshes: [{ ...sphere(0.7, 0.7), uvs: undefined, material: 0 }],
    materials: [{ name: "gold", pbrMetallicRoughness: { baseColorFactor: [1.0, 0.71, 0.29, 1], metallicFactor: 1, roughnessFactor: 0.25 } }],
  }),
);
write(
  path.join(demo, "models/glow.glb"),
  glb({
    name: "glow",
    meshes: [{ ...box([-0.35, 0, -0.35], [0.35, 0.7, 0.35]), uvs: undefined, material: 0 }],
    materials: [
      {
        name: "lamp",
        pbrMetallicRoughness: { baseColorFactor: [0.3, 0.2, 0.15, 1], metallicFactor: 0, roughnessFactor: 0.6 },
        emissiveFactor: [1.0, 0.45, 0.1],
      },
    ],
  }),
);
write(
  path.join(demo, "models/pool.glb"),
  glb({
    name: "pool",
    meshes: [{ ...grid(10, 20), material: 0 }],
    materials: [{ name: "water", pbrMetallicRoughness: { baseColorFactor: [0.16, 0.42, 0.62, 1], metallicFactor: 0, roughnessFactor: 0.2 } }],
  }),
);
write(
  path.join(demo, "models/pillar.glb"),
  glb({
    name: "pillar",
    meshes: [{ ...cylinder(0.45, 2.4), material: 0 }],
    materials: [{ name: "stone", pbrMetallicRoughness: { baseColorFactor: [0.78, 0.74, 0.68, 1], metallicFactor: 0, roughnessFactor: 1 } }],
  }),
);
write(
  path.join(demo, "models/ground.glb"),
  glb({
    name: "ground",
    meshes: [{ ...grid(40, 8), uvs: undefined, material: 0 }],
    materials: [{ name: "grass", pbrMetallicRoughness: { baseColorFactor: [0.33, 0.5, 0.27, 1], metallicFactor: 0, roughnessFactor: 1 } }],
  }),
);
const N = 64;
write(
  path.join(demo, "sprites/noise.png"),
  png(N, N, picture(N, N, (x, y) => {
    const v = fbm(x / 8, y / 8, N / 8, 21) * 255;
    return [v, v, v];
  })),
);

// the test fixture: a quad facing +z (u right, v down the world's y), every normal tipped up the picture: n = (0, 0.6, 0.8)
const tilt = picture(4, 4, () => [127.5, 0.6 * 127.5 + 127.5, 0.8 * 127.5 + 127.5]);
const quad = {
  positions: [-1, 1, 0, 1, 1, 0, 1, -1, 0, -1, -1, 0],
  normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
  uvs: [0, 0, 1, 0, 1, 1, 0, 1],
  indices: [0, 3, 2, 0, 2, 1],
};
const white = picture(4, 4, () => [200, 200, 200]);
write(
  path.join(root, "crates/nova-runtime/tests/fixtures/normal_tilt_quad.glb"),
  glb({
    name: "quad",
    meshes: [{ ...quad, material: 0 }],
    images: [png(4, 4, white), png(4, 4, tilt)],
    materials: [{ name: "tilted", pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 1 }, normalTexture: { index: 1 } }],
  }),
);
