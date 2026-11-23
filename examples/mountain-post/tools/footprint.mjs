// What of a model stands on the ground: the points (x, z in the model's own metres) of every vertex lower than `below` metres, read
// from its .glb with each node's place, turn and size applied, reduced to their outline on a 0.1 m grid. scene.mjs keeps these clear
// of the roads; the game's test (crates/nova-runtime/tests/mountain_post.rs) checks the same from the engine's own reading.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GAME } from "./lib.mjs";

const cache = new Map();
const mul = (a, b) => { const o = new Array(16).fill(0); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) o[i * 4 + j] += a[k * 4 + j] * b[i * 4 + k]; return o; };
function trs(n) {
  if (n.matrix) return n.matrix;
  const [tx, ty, tz] = n.translation ?? [0, 0, 0], [x, y, z, w] = n.rotation ?? [0, 0, 0, 1], [sx, sy, sz] = n.scale ?? [1, 1, 1];
  // (column-major, as glTF stores it)
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

/// The ground footprint of models/<kind>.glb: [[x, z], ...] (empty when there is no such model).
export function footprint(kind, below = 0.6) {
  if (cache.has(kind)) return cache.get(kind);
  const file = join(GAME, "models", `${kind}.glb`);
  const out = [];
  if (existsSync(file)) {
    const b = readFileSync(file), jl = b.readUInt32LE(12), json = JSON.parse(b.toString("utf8", 20, 20 + jl)), bin = 20 + jl + 8;
    const cells = new Set();
    const visit = (ni, parent) => {
      const n = json.nodes[ni], m = mul(parent, trs(n));
      if (n.mesh !== undefined) for (const pr of json.meshes[n.mesh].primitives) {
        const acc = json.accessors[pr.attributes.POSITION], view = json.bufferViews[acc.bufferView];
        const stride = view.byteStride ?? 12, base = bin + (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
        for (let i = 0; i < acc.count; i++) {
          const o = base + i * stride, x = b.readFloatLE(o), y = b.readFloatLE(o + 4), z = b.readFloatLE(o + 8);
          const wy = m[1] * x + m[5] * y + m[9] * z + m[13];
          if (wy > below) continue;
          const wx = m[0] * x + m[4] * y + m[8] * z + m[12], wz = m[2] * x + m[6] * y + m[10] * z + m[14];
          cells.add(`${Math.round(wx * 10)},${Math.round(wz * 10)}`);
        }
      }
      for (const c of n.children ?? []) visit(c, m);
    };
    const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    for (const ni of json.scenes[json.scene ?? 0].nodes) visit(ni, I);
    for (const c of cells) { const [x, z] = c.split(",").map(Number); out.push([x / 10, z / 10]); }
  }
  cache.set(kind, out);
  return out;
}

/// The footprint of a placed object in metres east and north: its model's points turned by `ry` and sized by `sx` (as nova.model
/// turns them: the model's +z faces (sin ry, cos ry) on Nova's ground, x = -E).
export function placedFootprint(kind, en, ry = 0, sx = 1) {
  const c = Math.cos(ry), s = Math.sin(ry);
  return footprint(kind).map(([x, z]) => {
    const wx = (x * c + z * s) * sx, wz = (-x * s + z * c) * sx;
    return [en[0] - wx, en[1] + wz];
  });
}
