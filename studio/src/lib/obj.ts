// Wavefront OBJ, the plain-text model format almost every modelling program reads and writes: reading one into a model (each object or group becomes a mesh
// shape in one part; polygons of any size are kept), and writing a model out (parts' turns and positions applied, modifiers baked as they are exported).

import { MAX_CUBES, MAX_FACES, MAX_VERTS, type Cube, type MeshFace, type ModelDoc, type Part, type Vec3, DEFAULT_SCALE, walk } from "./model-doc";
import { evaluate } from "./modifiers";
import { toMesh } from "./mesh-edit";
import { rotationMatrix } from "./model-mesh";

export interface ObjImport {
  doc: ModelDoc;
  warnings: string[];
}

const COLORS = ["#c9d1d9", "#e0a070", "#8fb6e0", "#9fd0a0", "#d8b0e0", "#e0d080"];

/// Reads OBJ text into a model. `unit` is how many model units one OBJ unit becomes (16 makes an OBJ metre one world unit with the default export scale).
export function parseObj(text: string, name = "model", unit = 16): ObjImport {
  const warnings: string[] = [];
  const verts: Vec3[] = [];
  interface Group { name: string; faces: number[][] }
  const groups: Group[] = [{ name, faces: [] }];
  let current = groups[0]!;
  let skippedFaces = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    const key = parts[0]!;
    if (key === "v") {
      const [x, y, z] = parts.slice(1, 4).map(Number);
      if ([x, y, z].some((n) => n === undefined || !Number.isFinite(n))) throw new Error(`A point on the line "${line.slice(0, 40)}" is not a number.`);
      verts.push([x! * unit, y! * unit, z! * unit]);
    } else if (key === "o" || key === "g") {
      const n = parts.slice(1).join(" ").trim() || `part ${groups.length + 1}`;
      if (current.faces.length === 0 && groups.length === 1 && groups[0]!.name === name) current.name = n;
      else groups.push((current = { name: n, faces: [] }));
    } else if (key === "f") {
      const idx = parts.slice(1).map((tok) => {
        const v = Number(tok.split("/")[0]);
        if (!Number.isInteger(v) || v === 0) return NaN;
        return v > 0 ? v - 1 : verts.length + v;
      });
      if (idx.length < 3 || idx.some((i) => !(i >= 0 && i < verts.length))) {
        skippedFaces++;
        continue;
      }
      // a face that uses a point twice (a degenerate sliver) loses the repeat
      const clean = idx.filter((v, i) => v !== idx[(i + 1) % idx.length]);
      if (new Set(clean).size < 3 || new Set(clean).size !== clean.length) {
        skippedFaces++;
        continue;
      }
      if (clean.length > 64) {
        skippedFaces++;
        continue;
      }
      current.faces.push(clean);
    }
  }
  if (!verts.length || groups.every((g) => !g.faces.length)) throw new Error("There are no faces in this OBJ file.");
  if (skippedFaces) warnings.push(`${skippedFaces} face${skippedFaces === 1 ? " was" : "s were"} left out (too few points, a repeated point, or a point that does not exist).`);
  const cubes: Cube[] = [];
  let usedVerts = 0;
  for (const [gi, g] of groups.filter((x) => x.faces.length).entries()) {
    if (cubes.length >= MAX_CUBES) {
      warnings.push(`Only the first ${MAX_CUBES} objects were kept.`);
      break;
    }
    // each group keeps only the points it uses, renumbered from 0
    const map = new Map<number, number>();
    const own: Vec3[] = [];
    const polys: MeshFace[] = g.faces.slice(0, MAX_FACES).map((f) => ({ v: f.map((i) => {
      let m = map.get(i);
      if (m === undefined) (m = own.length), (own.push([...verts[i]!] as Vec3)), map.set(i, m);
      return m;
    }) }));
    if (own.length > MAX_VERTS) {
      warnings.push(`"${g.name}" has more than ${MAX_VERTS} points and was left out.`);
      continue;
    }
    if (g.faces.length > MAX_FACES) warnings.push(`"${g.name}" has more than ${MAX_FACES} faces; the rest were dropped.`);
    usedVerts += own.length;
    const c: Cube = { name: g.name, shape: "mesh", from: [0, 0, 0], size: [0, 0, 0], color: COLORS[gi % COLORS.length]!, verts: own, polys };
    cubes.push(c);
  }
  if (!cubes.length) throw new Error("No object in this OBJ file was small enough to open.");
  // the bounding box of a mesh element is derived from its points
  for (const c of cubes) {
    const lo: Vec3 = [Infinity, Infinity, Infinity];
    const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const p of c.verts!) for (let k = 0; k < 3; k++) (lo[k] = Math.min(lo[k]!, p[k]!)), (hi[k] = Math.max(hi[k]!, p[k]!));
    c.from = lo;
    c.size = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  }
  void usedVerts;
  const part: Part = { name: "body", origin: [0, 0, 0], rotation: [0, 0, 0], cubes, children: [] };
  return { doc: { version: 1, scale: DEFAULT_SCALE, parts: [part] } as ModelDoc, warnings };
}

const f = (n: number) => (Math.abs(n) < 1e-9 ? "0" : `${+n.toFixed(6)}`);

/// The model as OBJ text: one object per shape, points in world space (each part's origin and turn, parents first), scaled by the model's export scale times
/// `unit` (the default 16 turns a model of 16 units into 1 OBJ unit). Modifiers are applied as they are for the exported .glb.
export function modelToObj(doc: ModelDoc, unit = 1): string {
  const out: string[] = ["# Written by Nova Studio", "# one object per shape; units are model units times the export scale"];
  const scale = doc.scale * unit;
  // the matrix of each part: its parent's, then its own turn and shift
  type M = { r: number[]; t: Vec3 };
  const ident: M = { r: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] };
  const mul = (a: M, b: M): M => ({
    r: [
      a.r[0]! * b.r[0]! + a.r[1]! * b.r[3]! + a.r[2]! * b.r[6]!, a.r[0]! * b.r[1]! + a.r[1]! * b.r[4]! + a.r[2]! * b.r[7]!, a.r[0]! * b.r[2]! + a.r[1]! * b.r[5]! + a.r[2]! * b.r[8]!,
      a.r[3]! * b.r[0]! + a.r[4]! * b.r[3]! + a.r[5]! * b.r[6]!, a.r[3]! * b.r[1]! + a.r[4]! * b.r[4]! + a.r[5]! * b.r[7]!, a.r[3]! * b.r[2]! + a.r[4]! * b.r[5]! + a.r[5]! * b.r[8]!,
      a.r[6]! * b.r[0]! + a.r[7]! * b.r[3]! + a.r[8]! * b.r[6]!, a.r[6]! * b.r[1]! + a.r[7]! * b.r[4]! + a.r[8]! * b.r[7]!, a.r[6]! * b.r[2]! + a.r[7]! * b.r[5]! + a.r[8]! * b.r[8]!,
    ],
    t: [
      a.r[0]! * b.t[0]! + a.r[1]! * b.t[1]! + a.r[2]! * b.t[2]! + a.t[0]!,
      a.r[3]! * b.t[0]! + a.r[4]! * b.t[1]! + a.r[5]! * b.t[2]! + a.t[1]!,
      a.r[6]! * b.t[0]! + a.r[7]! * b.t[1]! + a.r[8]! * b.t[2]! + a.t[2]!,
    ],
  });
  const world = new Map<string, M>();
  let base = 0;
  let objects = 0;
  for (const { part, parts } of walk(doc)) {
    const parent = parts.length > 1 ? world.get(parts.slice(0, -1).join(",")) ?? ident : ident;
    const m = mul(parent, { r: rotationMatrix(part.rotation), t: part.origin });
    world.set(parts.join(","), m);
    for (const [ci, cube] of part.cubes.entries()) {
      const mesh = toMesh(evaluate(cube, "render"));
      if (!mesh.verts?.length || !mesh.polys?.length) continue;
      objects++;
      out.push(`o ${(cube.name ?? `${part.name}_${ci + 1}`).replace(/\s+/g, "_")}`);
      for (const p of mesh.verts) {
        const x = m.r[0]! * p[0] + m.r[1]! * p[1] + m.r[2]! * p[2] + m.t[0];
        const y = m.r[3]! * p[0] + m.r[4]! * p[1] + m.r[5]! * p[2] + m.t[1];
        const z = m.r[6]! * p[0] + m.r[7]! * p[1] + m.r[8]! * p[2] + m.t[2];
        out.push(`v ${f(x * scale)} ${f(y * scale)} ${f(z * scale)}`);
      }
      for (const poly of mesh.polys) out.push(`f ${poly.v.map((i) => i + 1 + base).join(" ")}`);
      base += mesh.verts.length;
    }
  }
  if (!objects) out.push("# (nothing to write: the model has no shapes with faces)");
  return `${out.join("\n")}\n`;
}
