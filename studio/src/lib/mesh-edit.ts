// Editing a mesh element: moving points, extruding and deleting faces, subdividing, welding and mirroring.
// Every function returns a new element and leaves its input alone. Faces are lists of point numbers,
// counter-clockwise seen from outside; deleting points renumbers the rest.

import { MAX_PARTS, fitBounds, movedCube, namesOf, partAt, uniqueSiblingName, walk, type Cube, type MeshFace, type ModelDoc, type Part, type Path, type Vec3 } from "./model-doc";
import { polyNormal, rotationMatrix, solidOf } from "./model-mesh";

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

/// Pushes a face out along its normal by `distance` (negative digs in), adding walls around it. `shrink` (0 to 0.95)
/// pulls the new face's points towards its middle by that fraction: with a distance of 0 that is an inset, with both a taper.
/// The face itself becomes the new cap; the result says which points that cap uses.
export function extrudeFace(c: Cube, face: number, distance: number, shrink = 0): { cube: Cube; points: number[] } {
  const out = clone(c);
  const f = out.polys?.[face];
  if (!f || !Number.isFinite(distance)) return { cube: out, points: [] };
  const n = scale(faceNormal(out, face), distance);
  const old = [...f.v];
  const mid = faceCentre(out, face);
  const t = Math.min(0.95, Math.max(0, Number.isFinite(shrink) ? shrink : 0));
  const fresh = old.map((i) => {
    const p = out.verts![i]!;
    const pulled: Vec3 = t ? [p[0] + (mid[0] - p[0]) * t, p[1] + (mid[1] - p[1]) * t, p[2] + (mid[2] - p[2]) * t] : p;
    return out.verts!.push(add(pulled, n)) - 1;
  });
  for (let i = 0; i < old.length; i++) {
    const j = (i + 1) % old.length;
    // The same winding serves digging in: the sign of the distance already turns the wall's normal round.
    out.polys!.push({ v: [old[i]!, old[j]!, fresh[j]!, fresh[i]!], ...(f.color ? { color: f.color } : {}) });
  }
  f.v = fresh;
  return { cube: finish(out), points: fresh };
}

/// Cuts a ring of four-sided faces in two: the cut crosses the edges `way` and `way + 2` of `face` (way 0 or 1), runs on
/// through each neighbouring four-sided face, and stops where the ring closes or meets a face of another shape.
/// `at` (0 to 1) is how far along each crossed edge the cut falls. Returns the cut's new points.
export function loopCut(c: Cube, face: number, way: 0 | 1, at = 0.5): { cube: Cube; points: number[] } {
  const out = clone(c);
  const polys = out.polys!;
  if (!polys[face] || polys[face]!.v.length !== 4) return { cube: out, points: [] };
  const key = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
  const sharing = new Map<string, number[]>();
  polys.forEach((p, i) => p.v.forEach((a, k) => {
    const e = key(a, p.v[(k + 1) % p.v.length]!);
    sharing.set(e, [...(sharing.get(e) ?? []), i]);
  }));
  // each visited face and the position (0 or 1) of its first crossed edge; the second is two further on
  const visited = new Map<number, number>();
  const walk = (start: number, crossing: number, enter: number) => {
    let cur = start;
    let k = crossing;
    // leave through the edge at k; the face beyond it is entered across the edge it shares
    for (;;) {
      const p = polys[cur]!;
      const exit = key(p.v[k]!, p.v[(k + 1) % 4]!);
      const next = (sharing.get(exit) ?? []).find((i) => i !== cur);
      if (next === undefined || polys[next]!.v.length !== 4 || visited.has(next)) return;
      const q = polys[next]!;
      const entry = q.v.findIndex((a, m) => key(a, q.v[(m + 1) % 4]!) === exit);
      visited.set(next, entry % 2);
      k = (entry + 2) % 4; // out of the opposite edge
      cur = next;
      void enter;
    }
  };
  visited.set(face, way);
  walk(face, (way + 2) % 4, 0);
  walk(face, way, 0);
  const middles = new Map<string, number>();
  const middle = (a: number, b: number) => {
    const e = key(a, b);
    let m = middles.get(e);
    if (m === undefined) {
      const [lo, hi] = a < b ? [a, b] : [b, a];
      const [p, q] = [out.verts![lo]!, out.verts![hi]!];
      m = out.verts!.push([p[0] + (q[0] - p[0]) * at, p[1] + (q[1] - p[1]) * at, p[2] + (q[2] - p[2]) * at]) - 1;
      middles.set(e, m);
    }
    return m;
  };
  const result: typeof polys = [];
  polys.forEach((p, i) => {
    const way0 = visited.get(i);
    if (way0 === undefined) return void result.push(p);
    const [a, b, cc, d] = way0 === 0 ? p.v : [p.v[1]!, p.v[2]!, p.v[3]!, p.v[0]!];
    // crossed edges are a-b and cc-d; the cut joins their middles
    const m1 = middle(a!, b!);
    const m2 = middle(cc!, d!);
    const extra = p.color ? { color: p.color } : {};
    const smooth = p.smooth ? { smooth: true } : {};
    result.push({ v: [a!, m1, m2, d!], ...extra, ...smooth }, { v: [m1, b!, cc!, m2], ...extra, ...smooth });
  });
  out.polys = result;
  return { cube: finish(out), points: [...middles.values()] };
}

/// Moves points, and with symmetry also the point on the other side of the mirror plane (square to `axis`, through the
/// origin) by the reflected amount. A point on the plane only slides along it.
export function moveVertsSymmetric(c: Cube, indices: number[], delta: Vec3, axis: Axis, eps = 0.01): Cube {
  const out = clone(c);
  const verts = out.verts ?? [];
  const chosen = new Set(indices);
  const twinOf = (i: number): number => {
    const p = verts[i]!;
    const r: Vec3 = [...p] as Vec3;
    r[axis] = -r[axis];
    return verts.findIndex((q, j) => j !== i && Math.hypot(q[0] - r[0], q[1] - r[1], q[2] - r[2]) <= eps);
  };
  const moves = new Map<number, Vec3>();
  const mirrored: Vec3 = [...delta] as Vec3;
  mirrored[axis] = -mirrored[axis];
  for (const i of chosen) {
    if (!verts[i]) continue;
    const onPlane = Math.abs(verts[i]![axis]) <= eps;
    if (onPlane) {
      const d: Vec3 = [...delta] as Vec3;
      d[axis] = 0;
      moves.set(i, d);
      continue;
    }
    moves.set(i, delta);
    const twin = twinOf(i);
    if (twin >= 0 && !chosen.has(twin)) moves.set(twin, mirrored);
  }
  for (const [i, d] of moves) verts[i] = add(verts[i]!, d);
  return finish(out);
}
/// Drops points that no face uses and renumbers the rest. `map[old]` is the new number (or -1 for a dropped point).
export function compactWithMap(c: Cube): { cube: Cube; map: number[] } {
  const out = clone(c);
  const used = new Set(out.polys!.flatMap((f) => f.v));
  const map: number[] = out.verts!.map(() => -1);
  const verts: Vec3[] = [];
  out.verts!.forEach((p, i) => {
    if (used.has(i)) {
      map[i] = verts.length;
      verts.push(p);
    }
  });
  out.verts = verts;
  for (const f of out.polys!) f.v = f.v.map((i) => map[i]!);
  return { cube: finish(out), map };
}

/// Drops points that no face uses and renumbers the rest.
export function compact(c: Cube): Cube {
  return compactWithMap(c).cube;
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
    // A painted box shows the same texels reflected (round shapes simply share theirs).
    if (out.texture && shape === "box") out.texture = { ...out.texture, mirror: (out.texture.mirror ?? 0) ^ (1 << axis) || undefined };
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

/// Every point of a mesh moved by a 4x4 matrix (column-major, the way three.js stores one): a move, turn or resize made with
/// the viewport handles. Flipping handedness (a negative resize) turns the faces inside out, so their order is reversed back.
export function transformMesh(c: Cube, m: number[]): Cube {
  const out = clone(c);
  out.verts = (out.verts ?? []).map((p) => [m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2] + m[12]!, m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2] + m[13]!, m[2]! * p[0] + m[6]! * p[1] + m[10]! * p[2] + m[14]!] as Vec3);
  const det = m[0]! * (m[5]! * m[10]! - m[9]! * m[6]!) - m[4]! * (m[1]! * m[10]! - m[9]! * m[2]!) + m[8]! * (m[1]! * m[6]! - m[5]! * m[2]!);
  if (det < 0) for (const f of out.polys ?? []) f.v.reverse();
  return finish(out);
}

/// Moves a part's pivot (its origin, the point it turns about) to `to`, in its parent's space, without moving anything you
/// can see: the part's shapes and child parts shift the opposite way inside it. Animation keys follow so clips still play
/// the same way.
export function movePivot(doc: ModelDoc, parts: number[], to: Vec3): ModelDoc | null {
  const next = clone(doc);
  const part = partAt(next, parts);
  if (!part || !to.every((n) => Number.isFinite(n))) return null;
  const d = sub(to, part.origin);
  if (d.every((n) => n === 0)) return null;
  // the same step seen from inside the part, which may be turned: R^-1 d (R is a rotation, so its inverse is its transpose)
  const r = rotationMatrix(part.rotation);
  const inside: Vec3 = [r[0]! * d[0] + r[3]! * d[1] + r[6]! * d[2], r[1]! * d[0] + r[4]! * d[1] + r[7]! * d[2], r[2]! * d[0] + r[5]! * d[1] + r[8]! * d[2]];
  const back = scale(inside, -1);
  part.origin = [...to];
  part.cubes = part.cubes.map((c) => movedCube(c, back));
  for (const child of part.children) child.origin = add(child.origin, back);
  const mine = namesOf(next, parts);
  for (const clip of next.clips ?? []) {
    for (const track of clip.tracks) {
      if (track.prop !== "position") continue;
      const own = track.part.length === mine.length && track.part.every((n, i) => n === mine[i]);
      const child = track.part.length === mine.length + 1 && mine.every((n, i) => n === track.part[i]);
      if (own) for (const k of track.keys) k.value = add(k.value, d);
      else if (child) for (const k of track.keys) k.value = add(k.value, back);
    }
  }
  return next;
}

/// Every edge of a mesh once, as `[a, b]` with a < b, with how many faces share it (1 = the mesh is open there).
export function edgesOf(c: Cube): { a: number; b: number; faces: number }[] {
  const seen = new Map<string, { a: number; b: number; faces: number }>();
  for (const p of c.polys ?? []) {
    p.v.forEach((x, k) => {
      const y = p.v[(k + 1) % p.v.length]!;
      const [a, b] = x < y ? [x, y] : [y, x];
      const e = seen.get(`${a},${b}`);
      if (e) e.faces++;
      else seen.set(`${a},${b}`, { a, b, faces: 1 });
    });
  }
  return [...seen.values()];
}

const lerp = (p: Vec3, q: Vec3, t: number): Vec3 => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
const rotated = <T,>(list: T[], at: number): T[] => [...list.slice(at), ...list.slice(0, at)];

/// Chamfers the edge between points `a` and `b`: it is replaced by a narrow face, each of its two neighbours losing `fraction`
/// (0 to 0.5) of the length of their next edge. The edge must join two faces, and the faces at each end must be three in all,
/// as at the corner of a box; otherwise the mesh is left alone and this returns null. The result says which points are new.
export function bevelEdge(c: Cube, a: number, b: number, fraction = 0.25): { cube: Cube; points: number[] } | null {
  const out = clone(c);
  const polys = out.polys ?? [];
  const verts = out.verts ?? [];
  const t = Math.min(0.5, Math.max(0.02, fraction));
  const along = (p: { v: number[] }, x: number, y: number) => {
    const i = p.v.indexOf(x);
    return i >= 0 && p.v[(i + 1) % p.v.length] === y ? i : -1;
  };
  const i1 = polys.findIndex((p) => along(p, a, b) >= 0);
  const i2 = polys.findIndex((p) => along(p, b, a) >= 0);
  if (i1 < 0 || i2 < 0 || i1 === i2) return null;
  const around = (v: number) => polys.map((p, i) => (p.v.includes(v) ? i : -1)).filter((i) => i >= 0);
  const [fa, fb] = [around(a), around(b)];
  if (fa.length !== 3 || fb.length !== 3) return null;
  const sa = fa.find((i) => i !== i1 && i !== i2)!;
  const sb = fb.find((i) => i !== i1 && i !== i2)!;
  // F1 runs ... pa, a, b, nb ...; F2 runs ... pb, b, a, na ...
  const f1 = rotated(polys[i1]!.v, along(polys[i1]!, a, b));
  const f2 = rotated(polys[i2]!.v, along(polys[i2]!, b, a));
  const [pa, nb] = [f1.at(-1)!, f1[2]!];
  const [pb, na] = [f2.at(-1)!, f2[2]!];
  const push = (p: Vec3) => verts.push(p) - 1;
  const a1 = push(lerp(verts[a]!, verts[pa]!, t));
  const b1 = push(lerp(verts[b]!, verts[nb]!, t));
  const b2 = push(lerp(verts[b]!, verts[pb]!, t));
  const a2 = push(lerp(verts[a]!, verts[na]!, t));
  polys[i1]!.v = [a1, b1, ...f1.slice(2).filter((v) => v !== b)];
  polys[i2]!.v = [b2, a2, ...f2.slice(2).filter((v) => v !== a)];
  const swap = (face: number, old: number, pair: [number, number], first: boolean) => {
    const p = polys[face]!.v;
    const k = p.indexOf(old);
    const [x, y] = first ? pair : [pair[1], pair[0]];
    p.splice(k, 1, x, y);
  };
  {
    const p = polys[sa]!.v;
    const k = p.indexOf(a);
    // seen along the face, the corner at a is entered from na and left towards pa, or the other way round
    swap(sa, a, [a2, a1], p[(k + 1) % p.length] === pa);
  }
  {
    const p = polys[sb]!.v;
    const k = p.indexOf(b);
    swap(sb, b, [b1, b2], p[(k - 1 + p.length) % p.length] === nb);
  }
  polys.push({ v: [b1, a1, a2, b2], ...(polys[i1]!.color ? { color: polys[i1]!.color } : {}) });
  const { cube, map } = compactWithMap(out);
  return { cube, points: [a1, b1, b2, a2].map((i) => map[i]!) };
}

/// Pulls an open edge (one face only) away from its face, in the face's plane, by `distance`, adding a face that joins the
/// old edge to the new one. Returns the new points, or null for an edge that is not on the open boundary.
export function extrudeEdge(c: Cube, a: number, b: number, distance: number): { cube: Cube; points: number[] } | null {
  const out = clone(c);
  const polys = out.polys ?? [];
  const verts = out.verts ?? [];
  if (!Number.isFinite(distance) || distance === 0) return null;
  const owners = polys.map((p, i) => ({ p, i })).filter(({ p }) => p.v.includes(a) && p.v.includes(b));
  if (owners.length !== 1) return null;
  const { p, i } = owners[0]!;
  const k = p.v.indexOf(a);
  const forward = p.v[(k + 1) % p.v.length] === b; // the face goes a -> b, else b -> a
  const [from, to] = forward ? [a, b] : [b, a];
  const e = sub(verts[to]!, verts[from]!);
  const n = faceNormal(out, i);
  let dir: Vec3 = [e[1] * n[2] - e[2] * n[1], e[2] * n[0] - e[0] * n[2], e[0] * n[1] - e[1] * n[0]];
  const l = Math.hypot(...dir);
  if (l < 1e-12) return null;
  dir = scale(dir, 1 / l);
  const middle = scale(add(verts[from]!, verts[to]!), 0.5);
  const away = sub(middle, faceCentre(out, i));
  if (dir[0] * away[0] + dir[1] * away[1] + dir[2] * away[2] < 0) dir = scale(dir, -1);
  const push = (q: Vec3) => verts.push(q) - 1;
  const na = push(add(verts[from]!, scale(dir, distance)));
  const nb = push(add(verts[to]!, scale(dir, distance)));
  // the new face runs the opposite way along the old edge, so the two faces agree
  polys.push({ v: [to, from, na, nb], ...(p.color ? { color: p.color } : {}) });
  return { cube: finish(out), points: [na, nb] };
}
