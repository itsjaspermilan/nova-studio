// Editing a mesh element: moving points, extruding and deleting faces, subdividing, welding and mirroring.
// Every function returns a new element and leaves its input alone. Faces are lists of point numbers,
// counter-clockwise seen from outside; deleting points renumbers the rest.

import { MAX_PARTS, fitBounds, partAt, uniqueSiblingName, walk, type Cube, type MeshFace, type ModelDoc, type Part, type Path, type Vec3 } from "./model-doc";
import { polyNormal, solidOf } from "./model-mesh";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];

export const isMesh = (c: Cube) => c.shape === "mesh";

function finish(c: Cube): Cube {
  fitBounds(c);
  delete c.rotation;
  return c;
}

/// An editable copy of any element: its points and polygons as they are drawn now (turn and size included).
export function toMesh(c: Cube): Cube {
  if (isMesh(c)) return clone(c);
  const solid = solidOf(c);
  const out: Cube = { ...(c.name ? { name: c.name } : {}), shape: "mesh", from: [0, 0, 0], size: [0, 0, 0], color: c.color, verts: solid.verts, polys: [] };
  for (const p of solid.polys) {
    const face: MeshFace = { v: p.v };
    const colour = (p.face ? c.faces?.[p.face] : undefined) ?? c.color;
    if (colour !== c.color) face.color = colour;
    if (p.smooth) face.smooth = true;
    out.polys!.push(face);
  }
  return finish(out);
}

/// A single square facing up, 8 units wide: a starting point to extrude into anything.
export function freshMesh(color = "#c9d1d9"): Cube {
  return finish({ shape: "mesh", from: [0, 0, 0], size: [0, 0, 0], color, verts: [[-4, 0, 4], [4, 0, 4], [4, 0, -4], [-4, 0, -4]], polys: [{ v: [0, 1, 2, 3] }] });
}

export function moveVerts(c: Cube, indices: number[], delta: Vec3): Cube {
  const out = clone(c);
  for (const i of new Set(indices)) if (out.verts?.[i]) out.verts[i] = add(out.verts[i]!, delta);
  return finish(out);
}

export function setVert(c: Cube, index: number, to: Vec3): Cube {
  const out = clone(c);
  if (out.verts?.[index]) out.verts[index] = [...to];
  return finish(out);
}

export const faceCentre = (c: Cube, face: number): Vec3 => {
  const f = c.polys?.[face];
  if (!f) return [0, 0, 0];
  let sum: Vec3 = [0, 0, 0];
  for (const i of f.v) sum = add(sum, c.verts![i]!);
  return scale(sum, 1 / f.v.length);
};

/// The unit normal of a face (pointing out of the solid).
export function faceNormal(c: Cube, face: number): Vec3 {
  const f = c.polys?.[face];
  if (!f) return [0, 1, 0];
  const n = polyNormal(c.verts!, f.v);
  const l = Math.hypot(...n);
  return l > 1e-12 ? scale(n, 1 / l) : [0, 1, 0];
}

/// Pushes a face out along its normal by `distance` (negative digs in), adding walls around it.
/// The face itself becomes the new cap; the result says which points that cap uses.
export function extrudeFace(c: Cube, face: number, distance: number): { cube: Cube; points: number[] } {
  const out = clone(c);
  const f = out.polys?.[face];
  if (!f || !Number.isFinite(distance)) return { cube: out, points: [] };
  const n = scale(faceNormal(out, face), distance);
  const old = [...f.v];
  const fresh = old.map((i) => out.verts!.push(add(out.verts![i]!, n)) - 1);
  for (let i = 0; i < old.length; i++) {
    const j = (i + 1) % old.length;
    // The same winding serves digging in: the sign of the distance already turns the wall's normal round.
    out.polys!.push({ v: [old[i]!, old[j]!, fresh[j]!, fresh[i]!], ...(f.color ? { color: f.color } : {}) });
  }
  f.v = fresh;
  return { cube: finish(out), points: fresh };
}

/// Drops points that no face uses and renumbers the rest.
export function compact(c: Cube): Cube {
  const out = clone(c);
  const used = new Set(out.polys!.flatMap((f) => f.v));
  const remap = new Map<number, number>();
  const verts: Vec3[] = [];
  out.verts!.forEach((p, i) => {
    if (used.has(i)) {
      remap.set(i, verts.length);
      verts.push(p);
    }
  });
  out.verts = verts;
  for (const f of out.polys!) f.v = f.v.map((i) => remap.get(i)!);
  return finish(out);
}

export function deleteFaces(c: Cube, faces: number[]): Cube {
  const out = clone(c);
  const gone = new Set(faces);
  out.polys = out.polys!.filter((_, i) => !gone.has(i));
  return compact(out);
}

/// Removes points and every face that used them.
export function deleteVerts(c: Cube, points: number[]): Cube {
  const out = clone(c);
  const gone = new Set(points);
  out.polys = out.polys!.filter((f) => !f.v.some((i) => gone.has(i)));
  const survivors = new Map<number, number>();
  const verts: Vec3[] = [];
  out.verts!.forEach((p, i) => {
    if (!gone.has(i)) {
      survivors.set(i, verts.length);
      verts.push(p);
    }
  });
  out.verts = verts;
  for (const f of out.polys) f.v = f.v.map((i) => survivors.get(i)!);
  return compact(out);
}

/// A face between points the user picked (at least three), turned to face away from the middle of the mesh.
export function addFace(c: Cube, points: number[]): Cube {
  const out = clone(c);
  const ok = points.length >= 3 && new Set(points).size === points.length && points.every((i) => !!out.verts?.[i]);
  if (!ok) return finish(out);
  const v = [...points];
  const n = polyNormal(out.verts!, v);
  const mid = out.verts!.length ? out.verts!.reduce<Vec3>((s, p) => add(s, p), [0, 0, 0]) : ([0, 0, 0] as Vec3);
  const centre = scale(mid, 1 / out.verts!.length);
  const there = scale(v.reduce<Vec3>((s, i) => add(s, out.verts![i]!), [0, 0, 0]), 1 / v.length);
  const away = sub(there, centre);
  if (n[0] * away[0] + n[1] * away[1] + n[2] * away[2] < 0) v.reverse();
  out.polys!.push({ v });
  return finish(out);
}

export function flipFaces(c: Cube, faces: number[]): Cube {
  const out = clone(c);
  for (const i of faces) if (out.polys?.[i]) out.polys[i]!.v.reverse();
  return finish(out);
}

export function setFaceColors(c: Cube, faces: number[], color: string): Cube {
  const out = clone(c);
  for (const i of faces) if (out.polys?.[i]) out.polys[i]!.color = color;
  return finish(out);
}

export function setSmooth(c: Cube, faces: number[], smooth: boolean): Cube {
  const out = clone(c);
  for (const i of faces) if (out.polys?.[i]) {
    if (smooth) out.polys[i]!.smooth = true;
    else delete out.polys[i]!.smooth;
  }
  return finish(out);
}

/// Splits each chosen face (all by default) into one quad per corner, around a new point in its middle.
export function subdivide(c: Cube, faces?: number[]): Cube {
  const out = clone(c);
  const chosen = new Set(faces ?? out.polys!.map((_, i) => i));
  const middles = new Map<string, number>();
  const middle = (a: number, b: number) => {
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    let m = middles.get(key);
    if (m === undefined) {
      m = out.verts!.push(scale(add(out.verts![a]!, out.verts![b]!), 0.5)) - 1;
      middles.set(key, m);
    }
    return m;
  };
  const polys: MeshFace[] = [];
  out.polys!.forEach((f, i) => {
    if (!chosen.has(i)) return void polys.push(f);
    const k = f.v.length;
    const centre = out.verts!.push(scale(f.v.reduce<Vec3>((s, p) => add(s, out.verts![p]!), [0, 0, 0]), 1 / k)) - 1;
    for (let j = 0; j < k; j++) {
      const piece: MeshFace = { v: [f.v[j]!, middle(f.v[j]!, f.v[(j + 1) % k]!), centre, middle(f.v[(j + k - 1) % k]!, f.v[j]!)] };
      if (f.color) piece.color = f.color;
      if (f.smooth) piece.smooth = true;
      polys.push(piece);
    }
  });
  out.polys = polys;
  return finish(out);
}

/// Joins points closer together than `distance`, and drops faces that collapse.
export function weld(c: Cube, distance = 0.001): Cube {
  const out = clone(c);
  const verts = out.verts!;
  const target = verts.map((_, i) => i);
  for (let i = 0; i < verts.length; i++) {
    if (target[i] !== i) continue;
    for (let j = i + 1; j < verts.length; j++) if (target[j] === j && Math.hypot(...sub(verts[i]!, verts[j]!)) <= distance) target[j] = i;
  }
  const polys: MeshFace[] = [];
  for (const f of out.polys!) {
    const v: number[] = [];
    for (const i of f.v) {
      const t = target[i]!;
      if (!v.includes(t)) v.push(t);
    }
    if (v.length >= 3) polys.push({ ...f, v });
  }
  out.polys = polys;
  return compact(out);
}

/// How many points `weld` would join, so the editor can say so.
export function weldable(c: Cube, distance = 0.001): number {
  return (c.verts?.length ?? 0) - (weld(c, distance).verts?.length ?? 0);
}

export type Axis = 0 | 1 | 2;

/// The element reflected across the plane through the part's origin that is square to `axis` (0 = x, 1 = y, 2 = z).
/// Boxes, cylinders and spheres stay what they are; everything else becomes an editable mesh.
export function mirrorElement(c: Cube, axis: Axis): Cube {
  const shape = c.shape ?? "box";
  if (shape === "box" || shape === "cylinder" || shape === "sphere") {
    const out = clone(c);
    out.from[axis] = -(c.from[axis]! + c.size[axis]!);
    if (out.rotation?.some((n) => n !== 0)) {
      // A reflection turns the opposite way about every axis but its own.
      out.rotation = out.rotation.map((d, a) => (a === axis ? d : -d)) as Vec3;
    }
    if (axis === 0 && out.faces) swapFaces(out, "east", "west");
    if (axis === 1 && out.faces) swapFaces(out, "up", "down");
    if (axis === 2 && out.faces) swapFaces(out, "south", "north");
    return out;
  }
  const out = toMesh(c);
  out.verts = out.verts!.map((p) => p.map((x, a) => (a === axis ? -x : x)) as Vec3);
  for (const f of out.polys!) f.v.reverse();
  return finish(out);
}

function swapFaces(c: Cube, a: keyof NonNullable<Cube["faces"]>, b: keyof NonNullable<Cube["faces"]>) {
  const faces = c.faces!;
  const [ca, cb] = [faces[a], faces[b]];
  delete faces[a];
  delete faces[b];
  if (ca) faces[b] = ca;
  if (cb) faces[a] = cb;
}

/// A mirrored copy of a part (with its shapes and child parts) next to the original, reflected across the plane through
/// its parent's origin that is square to `axis`. Animation keys are not copied.
export function mirrorPart(doc: ModelDoc, parts: number[], axis: Axis): { doc: ModelDoc; path: Path } | null {
  const next = clone(doc);
  const original = partAt(next, parts);
  if (!original || walk(doc).length + walkCount(original) > MAX_PARTS) return null;
  const flip = (p: Part) => {
    p.origin[axis] = -p.origin[axis]!;
    if (p.origin[axis] === 0) p.origin[axis] = 0; // no negative zero in the file
    p.rotation = p.rotation.map((d, a) => (a === axis ? d : -d || 0)) as Vec3;
    p.cubes = p.cubes.map((c) => mirrorElement(c, axis));
    p.children.forEach(flip);
  };
  const twin = clone(original);
  flip(twin);
  const siblings = parts.length > 1 ? partAt(next, parts.slice(0, -1))!.children : next.parts;
  twin.name = uniqueSiblingName(siblings, `${original.name} mirror`);
  siblings.push(twin);
  return { doc: next, path: { parts: [...parts.slice(0, -1), siblings.length - 1] } };
}

const walkCount = (p: Part): number => 1 + p.children.reduce((n, c) => n + walkCount(c), 0);
