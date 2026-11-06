// The ground under Pine Ridge Rally's circuits, as grids of small squares (models/land_*.glb): the shader lifts every vertex by the
// height of the hills under it (`nova.terrain`), so a flat plane of four corners would not follow them. 50 x 50 squares of 16 m, centred
// on the camera (the game snaps the centre to a whole square, so that the squares do not slide over the hills as the camera moves).
// Written as glTF directly: the ground has one colour, a normal straight up (the shader leans it with the slope) and no texture.
//
//   node scripts/rally/land.mjs [project folder]
import fs from "node:fs";
import path from "node:path";

const project = process.argv[2] ?? "examples/pine-ridge-rally";
const CELLS = 50, CELL = 16, TOP = -0.25;
const GROUNDS = { land_grass: "#4f8a3c", land_sand: "#d9b277", land_snow: "#eaf0f6", land_night: "#1e2a38" };

const linear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const colour = (hex) => [1, 3, 5].map((i) => linear(parseInt(hex.slice(i, i + 2), 16) / 255));

function glb(hex) {
  const n = CELLS + 1;
  const positions = new Float32Array(n * n * 3), normals = new Float32Array(n * n * 3), colors = new Float32Array(n * n * 4);
  const rgb = colour(hex);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i;
    positions.set([(i - CELLS / 2) * CELL, TOP, (j - CELLS / 2) * CELL], k * 3);
    normals.set([0, 1, 0], k * 3);
    colors.set([...rgb, 1], k * 4);
  }
  const indices = new Uint32Array(CELLS * CELLS * 6);
  let t = 0;
  for (let j = 0; j < CELLS; j++) for (let i = 0; i < CELLS; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    indices.set([a, c, b, b, c, d], t); // counter-clockwise seen from above (+y)
    t += 6;
  }
  const parts = [positions, normals, colors, indices].map((a) => Buffer.from(a.buffer));
  const offsets = [];
  let at = 0;
  for (const p of parts) { offsets.push(at); at += p.length; }
  const bin = Buffer.concat(parts);
  const json = {
    asset: { version: "2.0", generator: "nova scripts/rally/land.mjs" },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: "land", mesh: 0 }],
    meshes: [{ name: "land", primitives: [{ attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 }, indices: 3, mode: 4 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: n * n, type: "VEC3", min: [-CELLS * CELL / 2, TOP, -CELLS * CELL / 2], max: [CELLS * CELL / 2, TOP, CELLS * CELL / 2] },
      { bufferView: 1, componentType: 5126, count: n * n, type: "VEC3" },
      { bufferView: 2, componentType: 5126, count: n * n, type: "VEC4" },
      { bufferView: 3, componentType: 5125, count: indices.length, type: "SCALAR" },
    ],
    bufferViews: parts.map((p, i) => ({ buffer: 0, byteOffset: offsets[i], byteLength: p.length, target: i === 3 ? 34963 : 34962 })),
    buffers: [{ byteLength: bin.length }],
  };
  let js = Buffer.from(JSON.stringify(json));
  js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const head = Buffer.alloc(12);
  head.write("glTF", 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8);
  const c1 = Buffer.alloc(8); c1.writeUInt32LE(js.length, 0); c1.write("JSON", 4);
  const c2 = Buffer.alloc(8); c2.writeUInt32LE(bin.length, 0); c2.write("BIN\0", 4);
  return Buffer.concat([head, c1, js, c2, bin]);
}

for (const [name, hex] of Object.entries(GROUNDS)) fs.writeFileSync(path.join(project, "models", name + ".glb"), glb(hex));
console.log("wrote", Object.keys(GROUNDS).join(", "));
