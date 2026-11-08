// Rebuilds four of Pine Ridge Rally's models as Nova models the studio's model editor opens (2026-11-07): the checkered flag and the fence
// (Kenney's Racing Kit, CC0, painted with a picture: a checker and a see-through chain-link net) and the grass and flower tufts (made by
// scripts/hills/make-foliage.mjs with colours that fade from base to tip). A Nova model has one colour per face and no see-through
// pictures, so the shapes are kept and the paint becomes faces: the flag's cloth is cut into its squares, the net into thin crossing
// strands, and each blade of grass into a darker lower part and a lighter tip. Written through the MCP server's `model_write`, like the
// other rally models.
//
//   node scripts/rally/props-models.mjs
//
// It reads the original .glb files, so it is a one-off for the rally: once a model has its .model.json, that file is the model (edit it in
// the studio), and this script leaves the model alone. Grass and flowers are read from examples/hill-run/models, which has the same tufts.
import fs from "node:fs";
import { join } from "node:path";
import { withServer, GAME } from "./mcp.mjs";

const HILLS = join(GAME, "../hill-run/models");
const U = 16; // model units in a metre (the model's scale is 1/16)

// ---- reading a .glb ------------------------------------------------------------------------------------------------------------------
function readGlb(path) {
  const b = fs.readFileSync(path);
  const len = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + len).toString());
  const bin = b.subarray(20 + len + 8);
  const read = (i) => {
    const a = json.accessors[i], v = json.bufferViews[a.bufferView];
    const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
    const o = bin.byteOffset + (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const T = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array }[a.componentType];
    const flat = new T(bin.buffer.slice(o, o + a.count * n * T.BYTES_PER_ELEMENT));
    return Array.from({ length: a.count }, (_, k) => (n === 1 ? flat[k] : Array.from(flat.subarray(k * n, k * n + n))));
  };
  // every primitive with its node's translation added (the kit's nodes are only moved, never turned or scaled)
  const prims = [];
  const visit = (i, at) => {
    const node = json.nodes[i];
    const t = node.translation ?? [0, 0, 0];
    const here = [at[0] + t[0], at[1] + t[1], at[2] + t[2]];
    if (node.mesh !== undefined) for (const p of json.meshes[node.mesh].primitives) {
      const pos = read(p.attributes.POSITION).map((q) => [q[0] + here[0], q[1] + here[1], q[2] + here[2]]);
      const mat = json.materials?.[p.material ?? -1];
      prims.push({
        pos, uv: p.attributes.TEXCOORD_0 !== undefined ? read(p.attributes.TEXCOORD_0) : null,
        colors: p.attributes.COLOR_0 !== undefined ? read(p.attributes.COLOR_0) : null,
        index: p.indices !== undefined ? read(p.indices) : pos.map((_, k) => k),
        material: mat?.name ?? "", base: mat?.pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1, 1],
      });
    }
    for (const c of node.children ?? []) visit(c, here);
  };
  for (const r of json.scenes[json.scene ?? 0].nodes) visit(r, [0, 0, 0]);
  return { prims, colliders: json.scenes[json.scene ?? 0].extras?.nova?.colliders ?? [] };
}

// ---- colours: the game's light is linear, the editor's colours are sRGB --------------------------------------------------------------
const toSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const hex = (rgb) => `#${rgb.slice(0, 3).map((c) => Math.round(Math.min(1, Math.max(0, toSrgb(c))) * 255).toString(16).padStart(2, "0")).join("")}`;
const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);

// ---- building a mesh shape -----------------------------------------------------------------------------------------------------------
function meshBuilder() {
  const verts = [], polys = [], keys = new Map();
  const r3 = (x) => Math.round(x * U * 1000) / 1000;
  const v = (p) => {
    const q = [r3(p[0]), r3(p[1]), r3(p[2])];
    const k = q.join(",");
    if (!keys.has(k)) { keys.set(k, verts.length); verts.push(q); }
    return keys.get(k);
  };
  return {
    poly(points, color) { polys.push({ v: points.map(v), color }); },
    /// Both sides of a face (the renderer draws only the front of each).
    both(points, color) { this.poly(points, color); this.poly([...points].reverse(), color); },
    shape(name) {
      // the most common colour is the shape's own; faces of other colours keep theirs
      const count = new Map();
      for (const p of polys) count.set(p.color, (count.get(p.color) ?? 0) + 1);
      const color = [...count].sort((a, b) => b[1] - a[1])[0][0];
      const lo = [0, 1, 2].map((i) => Math.min(...verts.map((q) => q[i]))), hi = [0, 1, 2].map((i) => Math.max(...verts.map((q) => q[i])));
      return {
        name, shape: "mesh", from: lo, size: hi.map((h, i) => Math.round((h - lo[i]) * 1000) / 1000), color, verts,
        polys: polys.map((p) => (p.color === color ? { v: p.v } : p)),
      };
    },
  };
}

const model = (name, cubes, colliders = []) => ({
  version: 1, scale: 1 / U,
  parts: [{ name, origin: [0, 0, 0], rotation: [0, 0, 0], cubes, children: [] }],
  ...(colliders.length ? { colliders: colliders.map(([x, z, r]) => ({ x: x * U, z: z * U, r: r * U })) } : {}),
});

/// The triangles of a primitive as they are, in its material's colour.
function plain(m, prim, color = hex(prim.base)) {
  for (let i = 0; i < prim.index.length; i += 3) m.poly([prim.index[i], prim.index[i + 1], prim.index[i + 2]].map((k) => prim.pos[k]), color);
}

// ---- grass and flowers: every triangle kept; a blade whose colour fades from base to tip becomes a lower part and a tip ----------------
function tuft(name) {
  const { prims } = readGlb(join(HILLS, `${name}.glb`));
  const m = meshBuilder();
  for (const prim of prims) {
    for (let i = 0; i < prim.index.length; i += 3) {
      const ids = [prim.index[i], prim.index[i + 1], prim.index[i + 2]];
      const p = ids.map((k) => prim.pos[k]), c = ids.map((k) => prim.colors[k]);
      const same = (a, b) => a.every((x, j) => Math.abs(x - b[j]) < 1e-6);
      if (same(c[0], c[1]) && same(c[1], c[2])) { m.poly(p, hex(c[0])); continue; }
      // the tip is the corner whose colour the other two do not share; go round the triangle from it, keeping the winding
      const t = same(c[1], c[2]) ? 0 : same(c[0], c[2]) ? 1 : 2;
      const [a, b] = [(t + 1) % 3, (t + 2) % 3];
      const half = (k) => mix(p[k], p[t], 0.5);
      m.poly([p[t], half(a), half(b)], hex(mix(c[a], c[t], 0.75)));
      m.poly([half(a), p[a], p[b], half(b)], hex(mix(c[a], c[t], 0.25)));
    }
  }
  return model(name, [m.shape(name)]);
}

// ---- the checkered flag: the kit's pole as it is, and the cloth cut into the picture's squares --------------------------------------
function flag() {
  const src = readGlb(join(GAME, "models/flag_checkers.glb"));
  const [cloth, ...pole] = src.prims;
  const shapes = pole.map((p, i) => {
    const m = meshBuilder();
    plain(m, p, p.material === "_defaultMat" ? "#ffffff" : hex(p.base));
    return m.shape(`pole ${i + 1}`);
  });
  // the cloth is a wavy sheet: columns of points from its top edge to its bottom, ordered by the picture's u (one u across the cloth is
  // four squares; v runs down it, four squares to one v)
  const cols = new Map();
  cloth.pos.forEach((q, k) => {
    const u = Math.round(cloth.uv[k][0] * 1e4) / 1e4;
    const c = cols.get(u) ?? { u, top: null, bottom: null };
    if (cloth.uv[k][1] < 0.5) c.top = q; else c.bottom = q;
    c.vBottom = Math.max(c.vBottom ?? 0, cloth.uv[k][1]);
    cols.set(u, c);
  });
  let list = [...cols.values()].filter((c) => c.top && c.bottom).sort((a, b) => a.u - b.u);
  const u0 = list[0].u, vMax = Math.max(...list.map((c) => c.vBottom));
  // a column exactly where each square ends across the cloth, between the two nearest
  const at = (u) => {
    const j = list.findIndex((c) => c.u >= u);
    if (j <= 0) return list[Math.max(j, 0)];
    const a = list[j - 1], b = list[j], f = (u - a.u) / (b.u - a.u);
    return { u, top: mix(a.top, b.top, f), bottom: mix(a.bottom, b.bottom, f) };
  };
  for (let s = 1; s < 4; s++) if (!list.some((c) => Math.abs(c.u - (u0 + s / 4)) < 1e-4)) list.push(at(u0 + s / 4));
  list = list.sort((a, b) => a.u - b.u);
  const rows = [];
  for (let v = 0; v < vMax - 1e-6; v += 0.25) rows.push(v);
  rows.push(vMax);
  const m = meshBuilder();
  const point = (c, v) => mix(c.top, c.bottom, v / vMax);
  for (let i = 0; i + 1 < list.length; i++) {
    const a = list[i], b = list[i + 1];
    const col = Math.floor((a.u - u0) * 4 + 1e-6);
    for (let r = 0; r + 1 < rows.length; r++) {
      const row = Math.floor(rows[r] * 4 + 1e-6);
      m.both([point(a, rows[r]), point(b, rows[r]), point(b, rows[r + 1]), point(a, rows[r + 1])], (col + row) % 2 === 0 ? "#ffffff" : "#1e1e1e");
    }
  }
  return model("flag_checkers", [m.shape("cloth"), ...shapes], src.colliders);
}

// ---- the fence: the kit's posts as they are, and the chain-link net as thin crossing strands ------------------------------------------
function fence() {
  const src = readGlb(join(GAME, "models/fence.glb"));
  const frame = src.prims.find((p) => p.material === "grey"), net = src.prims.find((p) => p.material === "net");
  const posts = meshBuilder();
  plain(posts, frame);
  // the net's sheet: the middle of the fence between the posts
  const pts = net.index.map((k) => net.pos[k]);
  const sheet = pts.filter((q) => Math.abs(q[2] - pts.reduce((s, p) => s + p[2], 0) / pts.length) < 0.02);
  const xs = (sheet.length ? sheet : pts).map((q) => q[0]), ys = (sheet.length ? sheet : pts).map((q) => q[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const z = (sheet.length ? sheet : pts)[0][2];
  const STEP = 0.2945, W = 0.02; // a diamond 0.29 m across (the picture's four to a tile), strands 2 cm wide
  const m = meshBuilder();
  for (const dir of [1, -1]) {
    // lines x - dir*y = c, from one edge of the sheet to another
    for (let c = Math.ceil((x0 - (dir > 0 ? y1 : -y0)) / STEP) * STEP; c <= x1 - (dir > 0 ? y0 : -y1); c += STEP) {
      const ends = [];
      for (const y of [y0, y1]) { const x = c + dir * y; if (x >= x0 - 1e-9 && x <= x1 + 1e-9) ends.push([x, y]); }
      for (const x of [x0, x1]) { const y = (x - c) / dir; if (y > y0 + 1e-9 && y < y1 - 1e-9) ends.push([x, y]); }
      if (ends.length < 2) continue;
      const [p, q] = ends;
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len < 0.01) continue;
      const n = [-(q[1] - p[1]) / len * W / 2, (q[0] - p[0]) / len * W / 2];
      m.both([[p[0] + n[0], p[1] + n[1], z], [p[0] - n[0], p[1] - n[1], z], [q[0] - n[0], q[1] - n[1], z], [q[0] + n[0], q[1] + n[1], z]], "#ffffff");
    }
  }
  return model("fence", [posts.shape("posts"), m.shape("net")], src.colliders);
}

const made = [];
for (const [name, make] of [["flag_checkers", flag], ["fence", fence], ["grass", () => tuft("grass")], ["flowers", () => tuft("flowers")]]) {
  if (fs.existsSync(join(GAME, `models/${name}.model.json`))) { console.log(`${name}: has its .model.json already, left alone`); continue; }
  made.push([name, make()]);
}
await withServer(async (nova) => {
  for (const [name, doc] of made) console.log(await nova.call("model_write", { name, model: doc }));
});
