// Shape keys: named alternative positions of a mesh's points (a smile, a blink, a door ajar). The game blends them by name
// (`nova.model(id, x, y, z, { morph = { smile = 0.6 } })`), the file carries them as glTF morph targets. Pure functions on a mesh element.

import type { Cube, ModelDoc, Part, Vec3 } from "./model-doc";
import { walk } from "./model-doc";

export const MAX_SHAPE_KEYS = 8;
export const MAX_KEY_NAME = 24;

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/// A name the game can use as a table key and the file can hold: letters, digits, underscore, dash and space, up to 24 characters.
export const validKeyName = (n: string) => n.trim().length > 0 && n.length <= MAX_KEY_NAME && /^[A-Za-z0-9_ -]+$/.test(n);

/// The shape keys of a part's shapes, in the order they first appear.
export function partShapeNames(part: Part): string[] {
  const out: string[] = [];
  for (const c of part.cubes) for (const s of c.shapes ?? []) if (!out.includes(s.name)) out.push(s.name);
  return out;
}

/// The shape keys of the whole model.
export function shapeKeyNames(doc: ModelDoc): string[] {
  const out: string[] = [];
  for (const { part } of walk(doc)) for (const n of partShapeNames(part)) if (!out.includes(n)) out.push(n);
  return out;
}

/// A new shape key that starts as a copy of the shape's points as they are. The shape as it was when the name is taken or unusable, or it has the most keys.
export function addShapeKey(c: Cube, name: string): Cube {
  if (c.shape !== "mesh" || !c.verts || !validKeyName(name) || (c.shapes ?? []).some((s) => s.name === name) || (c.shapes?.length ?? 0) >= MAX_SHAPE_KEYS) return c;
  return { ...c, shapes: [...(c.shapes ?? []), { name, verts: clone(c.verts) as Vec3[] }] };
}

export function removeShapeKey(c: Cube, name: string): Cube {
  if (!c.shapes?.some((s) => s.name === name)) return c;
  const shapes = c.shapes.filter((s) => s.name !== name);
  const out = { ...c, shapes: shapes.length ? shapes : undefined };
  if (!shapes.length) delete out.shapes;
  return out;
}

export function renameShapeKey(c: Cube, from: string, to: string): Cube {
  if (!c.shapes?.some((s) => s.name === from) || !validKeyName(to) || c.shapes.some((s) => s.name === to)) return c;
  return { ...c, shapes: c.shapes.map((s) => (s.name === from ? { ...s, name: to } : s)) };
}

/// Swaps the shape's points with a key's: afterwards the points are the key's and the key holds what the points were. Used to edit a key with the ordinary point tools;
/// doing it again puts everything back.
export function swapWithKey(c: Cube, name: string): Cube {
  const k = c.shapes?.find((s) => s.name === name);
  if (!k || !c.verts || k.verts.length !== c.verts.length) return c;
  return { ...c, verts: clone(k.verts) as Vec3[], shapes: c.shapes!.map((s) => (s.name === name ? { ...s, verts: clone(c.verts!) as Vec3[] } : s)) };
}

/// Starts editing a key: the points and the key are swapped and the shape is marked (see `Cube.keyEdit`), so the ordinary tools change the key.
export function beginKeyEdit(c: Cube, name: string): Cube {
  if (c.keyEdit !== undefined) return c;
  const swapped = swapWithKey(c, name);
  return swapped === c ? c : { ...swapped, keyEdit: name };
}

/// Ends it: the swap is undone and the marker removed.
export function endKeyEdit(c: Cube): Cube {
  if (c.keyEdit === undefined) return c;
  const back = swapWithKey({ ...c }, c.keyEdit);
  const out = { ...back };
  delete out.keyEdit;
  return out;
}

/// The shape with its keys blended in by weight (a key at 1 puts the points where it has them), for drawing a preview. The keys are dropped from the result.
export function blendShapeKeys(c: Cube, weights: Record<string, number>): Cube {
  if (!c.shapes?.length || !c.verts) return c;
  const verts = clone(c.verts) as Vec3[];
  for (const s of c.shapes) {
    const w = weights[s.name] ?? 0;
    if (!w || s.verts.length !== verts.length) continue;
    s.verts.forEach((p, i) => {
      for (let a = 0; a < 3; a++) verts[i]![a] = verts[i]![a]! + (p[a]! - c.verts![i]![a]!) * w;
    });
  }
  const out = { ...c, verts };
  delete out.shapes;
  return out;
}

/// Where each emitted vertex of the shape moves at weight 1 (x, y, z per vertex, scaled), in the order the exporter writes the shape's vertices (polygon by polygon, corner by
/// corner); zeros when the shape has no such key. Null when the shape has no points or has modifiers (a modifier changes the points the key was made for).
export function shapeDeltas(c: Cube, name: string, scale: number): number[] | null {
  if (c.shape !== "mesh" || !c.verts || !c.polys || c.modifiers?.length) return null;
  const key = c.shapes?.find((s) => s.name === name && s.verts.length === c.verts!.length);
  const out: number[] = [];
  for (const poly of c.polys) {
    for (const i of poly.v) {
      const p = c.verts[i]!;
      const q = key ? key.verts[i]! : p;
      out.push((q[0] - p[0]) * scale, (q[1] - p[1]) * scale, (q[2] - p[2]) * scale);
    }
  }
  return out;
}
