// Makes Hill Run's level (examples/hill-run): a hilly field as one glTF model (`models/hills.glb`, vertex colours by slope and
// height) and `lib/level.lua` (where the gems, the start and the flag are, and the bot's route). Everything is arithmetic, so the
// same file comes out every time:   node scripts/hills/make-hills.mjs
//
// What is in it, to find out what a capsule on triangles can and cannot do:
//   - a meadow of gentle rolling hills (slopes up to about 12 degrees) round the start,
//   - a hill 24 m high with a cliff band round its top (74 degrees: too steep to stand on, so it slides you down) and a notch
//     in the cliff that is a path up (37 degrees),
//   - a staircase of 20 steps (0.3 m high, 1 m deep) up to a platform 6 m up,
//   - blocks to step on, to jump on and to give up on (0.3, 0.8 and 1.6 m).
import fs from "node:fs";

const SIZE = 160, STEP = 1, N = SIZE / STEP;
const PEAK = [50, -50], R = 48;
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function height(x, z) {
  let h = 1.5 * Math.sin(x * 0.08) * Math.cos(z * 0.07) + 0.8 * Math.sin((x + z) * 0.15);
  const dx = x - PEAK[0], dz = z - PEAK[1], r = Math.hypot(dx, dz);
  h += 24 * sstep(0, 1, 1 - r / R);
  // the cliff band round the top, with a notch toward the start (the direction from the peak to the origin)
  const theta = Math.atan2(dz, dx), toStart = Math.atan2(-PEAK[1], -PEAK[0]);
  let d = Math.abs(theta - toStart); d = Math.min(d, 2 * Math.PI - d);
  const notch = 1 - sstep(10 * Math.PI / 180, 18 * Math.PI / 180, d);
  // 7 m more at the top: a cliff 3 m wide round it, except in the notch, where it is a long ramp instead
  const cliff = 1 - sstep(17.5, 20.5, r), ramp = 1 - sstep(6, 34, r);
  h += 7 * (cliff * (1 - notch) + ramp * notch);
  return h;
}

// ---- the heightfield ----
const positions = [], colors = [], indices = [];
const idx = (i, j) => i * (N + 1) + j;
const hf = [];
for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
  const x = -SIZE / 2 + i * STEP, z = -SIZE / 2 + j * STEP;
  hf.push([x, height(x, z), z]);
}
function normalAt(x, z) {
  const e = 0.5;
  const nx = height(x - e, z) - height(x + e, z), nz = height(x, z - e) - height(x, z + e);
  const l = Math.hypot(nx, 2 * e, nz);
  return [nx / l, 2 * e / l, nz / l];
}
const rnd = (x, z) => { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); };
function colour(x, y, z, ny) {
  if (ny < 0.64) { const g = 0.36 + 0.08 * rnd(x, z); return [g + 0.06, g, g - 0.04]; }            // rock
  const t = Math.min(1, y / 30), v = 0.9 + 0.2 * rnd(x * 3, z * 3);
  return [(0.26 + 0.3 * t) * v, (0.55 + 0.12 * t) * v, (0.2 + 0.28 * t) * v];                      // grass, paler higher up
}
const normals = [];
for (const [x, y, z] of hf) {
  const n = normalAt(x, z);
  positions.push(x, y, z); normals.push(...n); colors.push(...colour(x, y, z, n[1]), 1);
}
for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
  const a = idx(i, j), b = idx(i + 1, j), c = idx(i, j + 1), d = idx(i + 1, j + 1);
  // up-facing: x grows with i and z with j, so a, c, b has the normal up
  indices.push(a, c, b, b, c, d);
}

// ---- boxes (with real vertical faces) ----
const BOXES = [];
function box(x0, y0, z0, x1, y1, z1, rgb) {
  BOXES.push([x0, z0, x1, z1]);
  const faces = [
    [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0]],
    [[x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0], [-1, 0, 0]],
    [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0]],
    [[x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [0, -1, 0]],
    [[x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [x0, y0, z1], [0, 0, 1]],
    [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [0, 0, -1]],
  ];
  for (const f of faces) {
    const base = positions.length / 3;
    for (let k = 0; k < 4; k++) { positions.push(...f[k]); normals.push(...f[4]); colors.push(...rgb, 1); }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}
const STONE = [0.62, 0.58, 0.5], STONE2 = [0.5, 0.48, 0.44];
// the staircase: 20 steps from x = -50 to -30, 10 m wide, each 0.3 m higher than the one before, from the ground at its foot
const base = height(-51, 0);
for (let s = 0; s < 20; s++) box(-50 + s, base - 1, -5, -49 + s, base + 0.3 * (s + 1), 5, s % 2 ? STONE : STONE2);
box(-30, base - 1, -5, -20, base + 6, 5, STONE);                     // the platform at the top
// blocks near the start: a step, a jump, a wall
box(6, height(6, 6) - 1, 4, 8, height(6, 6) + 0.3, 6, STONE2);
box(12, height(12, 6) - 1, 4, 14, height(12, 6) + 0.8, 6, STONE);
box(18, height(18, 6) - 1, 4, 20, height(18, 6) + 1.6, 6, STONE2);
// a tower to climb: 4 m across and 12 m high, with a gem on top
const TOWER = { x: 26, z: 14, base: height(26, 14), top: height(26, 14) + 12 };
box(24, height(24, 12) - 1, 12, 28, TOWER.top, 16, STONE);

// ---- the glb ----
const f32 = (a) => Buffer.from(new Float32Array(a).buffer);
const bin = Buffer.concat([f32(positions), f32(normals), f32(colors), Buffer.from(new Uint32Array(indices).buffer)]);
const vc = positions.length / 3;
const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
for (let i = 0; i < vc; i++) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], positions[i * 3 + k]); hi[k] = Math.max(hi[k], positions[i * 3 + k]); }
const json = {
  asset: { version: "2.0", generator: "scripts/hills/make-hills.mjs" },
  scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: "hills", mesh: 0 }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 }, indices: 3, material: 0 }] }],
  materials: [{ name: "ground", pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 } }],
  accessors: [
    { bufferView: 0, componentType: 5126, count: vc, type: "VEC3", min: lo, max: hi },
    { bufferView: 1, componentType: 5126, count: vc, type: "VEC3" },
    { bufferView: 2, componentType: 5126, count: vc, type: "VEC4" },
    { bufferView: 3, componentType: 5125, count: indices.length, type: "SCALAR" },
  ],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: vc * 12 },
    { buffer: 0, byteOffset: vc * 12, byteLength: vc * 12 },
    { buffer: 0, byteOffset: vc * 24, byteLength: vc * 16 },
    { buffer: 0, byteOffset: vc * 40, byteLength: indices.length * 4 },
  ],
  buffers: [{ byteLength: bin.length }],
};
let js = Buffer.from(JSON.stringify(json));
js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
const pad = Buffer.alloc((4 - (bin.length % 4)) % 4);
const body = Buffer.concat([bin, pad]);
const header = Buffer.alloc(12); header.write("glTF", 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + js.length + 8 + body.length, 8);
const ch = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.write(type, 4); return b; };
fs.writeFileSync("examples/hill-run/models/hills.glb", Buffer.concat([header, ch(js.length, "JSON"), js, ch(body.length, "BIN\0"), body]));

// ---- the level file ----
const at = (x, z, up = 1.0) => `{ x = ${x.toFixed(2)}, y = ${(height(x, z) + up).toFixed(2)}, z = ${z.toFixed(2)} }`;

const stairH = (x) => base + 0.3 * (Math.floor(x + 50) + 1);
const gems = [[26, 14, TOWER.top + 1], [8, -6], [-14, 14], [-35, 0, stairH(-35) + 1], [-25, 0, base + 7], [30, -20], [40, -42], [22, -22], [60, -30], [58, -60], [48, -48]];
const toStart = Math.atan2(-PEAK[1], -PEAK[0]);
const pathPoints = [];
for (const r of [60, 50, 40, 30, 24, 20, 16, 10, 5]) pathPoints.push([PEAK[0] + Math.cos(toStart) * r, PEAK[1] + Math.sin(toStart) * r]);
let lua = "-- Made by scripts/hills/make-hills.mjs: where things are in the hill field. Do not edit by hand.\nreturn {\n";
lua += `  boxes = {\n` + BOXES.map(([a, b, c, d]) => `    { ` + [a, b, c, d].map((v) => v.toFixed(1)).join(", ") + ` },`).join("\n") + `\n  },\n`;
lua += `  tower = { x = ${TOWER.x}, z = ${TOWER.z}, base = ${TOWER.base.toFixed(2)}, top = ${TOWER.top.toFixed(2)} },\n`;
lua += `  start = ${at(0, 0, 0.1)},\n  flag = ${at(PEAK[0], PEAK[1], 0)},\n`;
lua += "  gems = {\n" + gems.map(([x, z, y]) => `    ${y ? `{ x = ${x}, y = ${y}, z = ${z} }` : at(x, z)},`).join("\n") + "\n  },\n";
lua += "  -- the bot: the start, the foot of the stairs, the stairs, the notch in the cliff, up the path to the flag\n  route = {\n";
lua += "    { x = 0, z = 0 }, { x = -15, z = -10 }, { x = -56, z = -10 }, { x = -54, z = 0 }, { x = -25, z = 0 },\n";
lua += pathPoints.map(([x, z]) => `    { x = ${x.toFixed(1)}, z = ${z.toFixed(1)} },`).join("\n") + "\n    { x = " + PEAK[0] + ", z = " + PEAK[1] + " },\n  },\n";
lua += `  peak = { x = ${PEAK[0]}, z = ${PEAK[1]} },\n  size = ${SIZE},\n}\n`;
fs.writeFileSync("examples/hill-run/lib/level.lua", lua);
console.log(`hills.glb: ${vc} vertices, ${indices.length / 3} triangles; summit ${height(PEAK[0], PEAK[1]).toFixed(1)} m`);
