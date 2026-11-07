// The ranges of mountains behind each of Pine Ridge Rally's countries (models/skyline_*.glb): two rings of faceted ridges round the camera, a near
// one lower and a far one taller, drawn centred on the camera so that they stay on the horizon. Each is a ridge line made from noise (forest:
// rolling hills with rocky, snow-capped peaks; desert: mesas and buttes in red bands; snow: tall alpine peaks; night: dark silhouettes), a flat
// face to each facet, coloured by height. Written as glTF directly.
//
//   node scripts/rally/skyline.mjs [project folder]
import fs from "node:fs";
import path from "node:path";

const project = process.argv[2] ?? "examples/pine-ridge-rally";

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// smooth 1-D noise on the circle: a table of random values, interpolated (so that the ring closes)
function circleNoise(seed, cells) {
  const r = rng(seed);
  const table = Array.from({ length: cells }, () => r());
  return (u) => { // u in 0..1 round the circle
    const x = u * cells, i = Math.floor(x) % cells, f = x - Math.floor(x);
    const a = table[i], b = table[(i + 1) % cells], t = f * f * (3 - 2 * f);
    return a + (b - a) * t;
  };
}

const KINDS = {
  forest: {
    // rolling hills with a few rocky peaks, green below and grey above, snow on the highest
    heights: (u, n1, n2, n3) => 30 + 55 * n1(u) + 30 * n2(u) + 40 * Math.max(0, n3(u) - 0.55) ** 1.5 * 6,
    colour: (t, h, rand) => (h > 110 ? [0.78, 0.8, 0.86] : t > 0.7 ? [0.34, 0.33, 0.34] : t > 0.38 ? [0.16, 0.3, 0.16] : [0.1, 0.22, 0.12]),
  },
  desert: {
    // flat-topped mesas and buttes in steps
    heights: (u, n1, n2) => { const v = 0.6 * n1(u) + 0.4 * n2(u); return 18 + Math.floor(v * 4.2) * 17 + 8 * n2(u * 3 % 1); },
    colour: (t, h, rand) => { const band = Math.floor(t * 6 + rand() * 0.4); return [[0.5, 0.22, 0.14], [0.66, 0.34, 0.2], [0.78, 0.5, 0.3], [0.6, 0.3, 0.18], [0.72, 0.42, 0.24], [0.82, 0.58, 0.36]][band % 6]; },
    flat: true,
  },
  snow: {
    heights: (u, n1, n2, n3) => 55 + 80 * n1(u) ** 1.3 + 35 * n2(u) + 10 * n3(u),
    colour: (t, h, rand) => (t > 0.45 ? [0.92, 0.95, 1.0] : t > 0.2 ? [0.55, 0.6, 0.68] : [0.28, 0.32, 0.4]),
  },
  night: {
    heights: (u, n1, n2, n3) => 40 + 70 * n1(u) + 30 * n2(u) + 25 * n3(u),
    colour: (t, h, rand) => (t > 0.75 ? [0.06, 0.08, 0.14] : [0.025, 0.035, 0.07]),
  },
};

function ring(kind, R, scale, seed, cols = 160) {
  const k = KINDS[kind];
  const n1 = circleNoise(seed, 7), n2 = circleNoise(seed + 1, 17), n3 = circleNoise(seed + 2, 41);
  const rand = rng(seed + 9);
  const H = [];
  for (let i = 0; i < cols; i++) H.push(Math.max(10, k.heights(i / cols, n1, n2, n3) * scale));
  // a smoother ridge for the faces in between (a mesa keeps its steps)
  const tris = [];
  const point = (i, row) => {
    const a = (i / cols) * Math.PI * 2, h = H[i % cols];
    // rows: 0 the foot (under the ground), 1 a shoulder, 2 the ridge; the faces lean in as they rise
    const lean = [1.12, 1.0, k.flat ? 0.98 : 0.94][row], up = [-12, 0.5 * h, h][row];
    const wob = row === 1 ? 1 + (rand() - 0.5) * 0.08 : 1;
    return [Math.cos(a) * R * lean * wob, up, Math.sin(a) * R * lean * wob];
  };
  const shoulder = []; // (a fixed set of points, so that the neighbours share them)
  const P = [];
  for (let i = 0; i <= cols; i++) P.push([point(i, 0), point(i, 1), point(i, 2)]);
  for (let i = 0; i < cols; i++) {
    const a = P[i], b = P[i + 1];
    for (let row = 0; row < 2; row++) {
      const t = (row + 0.5) / 2;
      const h = (H[i] + H[(i + 1) % cols]) / 2;
      // two triangles per quad, the diagonal alternating
      const q = [a[row], b[row], b[row + 1], a[row + 1]];
      const idx = i % 2 ? [[0, 1, 2], [0, 2, 3]] : [[0, 1, 3], [1, 2, 3]];
      for (const tri of idx) tris.push({ p: tri.map((j) => q[j]), c: k.colour(t * (h / 130 + 0.4), h, rand).map((x) => x * (0.92 + rand() * 0.16)) });
    }
  }
  return tris;
}

function glb(tris) {
  const positions = [], normals = [], colors = [], indices = [];
  for (const { p, c } of tris) {
    const u = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]], v = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const len = Math.hypot(...n) || 1;
    n = n.map((x) => x / len);
    // the camera is inside the ring: a face is wound counter-clockwise as seen from the middle, and its normal points at the middle
    const mid = [(p[0][0] + p[1][0] + p[2][0]) / 3, 0, (p[0][2] + p[1][2] + p[2][2]) / 3];
    const facesIn = n[0] * -mid[0] + n[2] * -mid[2] > 0;
    const order = facesIn ? [0, 1, 2] : [0, 2, 1];
    const nIn = facesIn ? n : n.map((x) => -x);
    const base = positions.length / 3;
    for (const j of order) { positions.push(...p[j]); normals.push(...nIn); colors.push(...c, 1); }
    indices.push(base, base + 1, base + 2);
  }
  const P = new Float32Array(positions), N = new Float32Array(normals), C = new Float32Array(colors), I = new Uint32Array(indices);
  const parts = [P, N, C, I].map((a) => Buffer.from(a.buffer));
  const offsets = []; let at = 0;
  for (const b of parts) { offsets.push(at); at += b.length; }
  const bin = Buffer.concat(parts);
  const xs = [], ys = [], zs = [];
  for (let k = 0; k < positions.length; k += 3) { xs.push(positions[k]); ys.push(positions[k + 1]); zs.push(positions[k + 2]); }
  const json = {
    asset: { version: "2.0", generator: "nova scripts/rally/skyline.mjs" },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: "skyline", mesh: 0 }],
    meshes: [{ name: "skyline", primitives: [{ attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 }, indices: 3, mode: 4 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: positions.length / 3, type: "VEC3", min: [Math.min(...xs), Math.min(...ys), Math.min(...zs)], max: [Math.max(...xs), Math.max(...ys), Math.max(...zs)] },
      { bufferView: 1, componentType: 5126, count: positions.length / 3, type: "VEC3" },
      { bufferView: 2, componentType: 5126, count: positions.length / 3, type: "VEC4" },
      { bufferView: 3, componentType: 5125, count: indices.length, type: "SCALAR" },
    ],
    bufferViews: parts.map((b, i) => ({ buffer: 0, byteOffset: offsets[i], byteLength: b.length, target: i === 3 ? 34963 : 34962 })),
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

let seed = 11;
for (const kind of Object.keys(KINDS)) {
  const tris = [...ring(kind, 330, 1.25, seed, 180), ...ring(kind, 255, 0.8, seed + 50, 150)];
  fs.writeFileSync(path.join(project, "models", `skyline_${kind}.glb`), glb(tris));
  seed += 7;
}
console.log("wrote skyline_forest, skyline_desert, skyline_snow, skyline_night");
