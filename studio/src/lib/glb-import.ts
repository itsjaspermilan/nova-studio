// Reads a binary glTF (.glb) into an editable model: its node tree becomes parts, each mesh primitive a free mesh (points welded
// where they coincide, a triangle per face, flat colours from vertex colours or the material), and its animations become clips.
// Textures, skins and morph targets are not imported (shapes keep flat colours; a skinned model comes in as rigid parts).

import { DEFAULT_SCALE, MAX_CLIPS, MAX_FACES, MAX_KEYS, MAX_PARTS, MAX_TOTAL_VERTS, MAX_VERTS, fitBounds, uniqueSiblingName, type Clip, type Cube, type MeshFace, type ModelDoc, type Part, type Prop, type Track, type Vec3 } from "./model-doc";

/// Model units per glTF unit: the editor's default scale makes a 16-unit shape one glTF unit.
const UNITS = 1 / DEFAULT_SCALE;

type Json = Record<string, any>;

export type Imported = { ok: true; doc: ModelDoc; notes: string[] } | { ok: false; error: string };

const COMPONENT: Record<number, { size: number; read: (v: DataView, at: number) => number; max: number }> = {
  5120: { size: 1, read: (v, a) => v.getInt8(a), max: 127 },
  5121: { size: 1, read: (v, a) => v.getUint8(a), max: 255 },
  5122: { size: 2, read: (v, a) => v.getInt16(a, true), max: 32767 },
  5123: { size: 2, read: (v, a) => v.getUint16(a, true), max: 65535 },
  5125: { size: 4, read: (v, a) => v.getUint32(a, true), max: 4294967295 },
  5126: { size: 4, read: (v, a) => v.getFloat32(a, true), max: 1 },
};
const WIDTH: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

export function quaternionToEuler(q: [number, number, number, number]): Vec3 {
  const [x, y, z, w] = q;
  const n = Math.hypot(x, y, z, w) || 1;
  const [qx, qy, qz, qw] = [x / n, y / n, z / n, w / n];
  // rotation matrix entries, then three.js's decomposition for the XYZ order
  const m11 = 1 - 2 * (qy * qy + qz * qz);
  const m12 = 2 * (qx * qy - qz * qw);
  const m13 = 2 * (qx * qz + qy * qw);
  const m22 = 1 - 2 * (qx * qx + qz * qz);
  const m23 = 2 * (qy * qz - qx * qw);
  const m32 = 2 * (qy * qz + qx * qw);
  const m33 = 1 - 2 * (qx * qx + qy * qy);
  const ey = Math.asin(Math.max(-1, Math.min(1, m13)));
  let ex: number, ez: number;
  if (Math.abs(m13) < 0.9999999) {
    ex = Math.atan2(-m23, m33);
    ez = Math.atan2(-m12, m11);
  } else {
    ex = Math.atan2(m32, m22);
    ez = 0;
  }
  const deg = (r: number) => Math.round(((r * 180) / Math.PI) * 1000) / 1000 || 0;
  return [deg(ex), deg(ey), deg(ez)];
}

/// Translation, rotation and scale from a column-major 4x4 matrix.
function decompose(m: number[]): { t: Vec3; q: [number, number, number, number]; s: Vec3 } {
  const s: Vec3 = [Math.hypot(m[0]!, m[1]!, m[2]!), Math.hypot(m[4]!, m[5]!, m[6]!), Math.hypot(m[8]!, m[9]!, m[10]!)];
  const r = [m[0]! / s[0], m[1]! / s[0], m[2]! / s[0], m[4]! / s[1], m[5]! / s[1], m[6]! / s[1], m[8]! / s[2], m[9]! / s[2], m[10]! / s[2]];
  // quaternion from the rotation matrix (columns r0..2)
  const trace = r[0]! + r[4]! + r[8]!;
  let q: [number, number, number, number];
  if (trace > 0) {
    const k = Math.sqrt(trace + 1) * 2;
    q = [(r[5]! - r[7]!) / k, (r[6]! - r[2]!) / k, (r[1]! - r[3]!) / k, 0.25 * k];
  } else if (r[0]! > r[4]! && r[0]! > r[8]!) {
    const k = Math.sqrt(1 + r[0]! - r[4]! - r[8]!) * 2;
    q = [0.25 * k, (r[3]! + r[1]!) / k, (r[6]! + r[2]!) / k, (r[5]! - r[7]!) / k];
  } else if (r[4]! > r[8]!) {
    const k = Math.sqrt(1 + r[4]! - r[0]! - r[8]!) * 2;
    q = [(r[3]! + r[1]!) / k, 0.25 * k, (r[7]! + r[5]!) / k, (r[6]! - r[2]!) / k];
  } else {
    const k = Math.sqrt(1 + r[8]! - r[0]! - r[4]!) * 2;
    q = [(r[6]! + r[2]!) / k, (r[7]! + r[5]!) / k, 0.25 * k, (r[1]! - r[3]!) / k];
  }
  return { t: [m[12]!, m[13]!, m[14]!], q, s };
}

const toHex = (r: number, g: number, b: number, a = 255) => {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}${a < 255 ? h(a) : ""}`;
};
const srgb = (c: number) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const round = (n: number) => Math.round(n * 1000) / 1000;

export function importGlb(bytes: Uint8Array): Imported {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 20 || view.getUint32(0, true) !== 0x46546c67) return { ok: false, error: "this is not a binary glTF (.glb) file" };
  if (view.getUint32(4, true) !== 2) return { ok: false, error: "only glTF version 2 can be read" };
  let json: Json | null = null;
  let bin: Uint8Array | null = null;
  for (let at = 12; at + 8 <= bytes.length; ) {
    const len = view.getUint32(at, true);
    const type = view.getUint32(at + 4, true);
    const body = bytes.subarray(at + 8, at + 8 + len);
    if (type === 0x4e4f534a) {
      try {
        json = JSON.parse(new TextDecoder().decode(body));
      } catch {
        return { ok: false, error: "the file's description is damaged" };
      }
    } else if (type === 0x004e4942 && !bin) bin = body;
    at += 8 + len + ((4 - (len % 4)) % 4);
  }
  if (!json) return { ok: false, error: "the file has no glTF description" };
  const notes: string[] = [];
  const buffer = bin ?? new Uint8Array(0);
  const dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  const accessor = (index: number): { values: number[]; width: number; count: number } | null => {
    const a = json!.accessors?.[index];
    const comp = a && COMPONENT[a.componentType];
    const width = a && WIDTH[a.type];
    if (!a || !comp || !width || a.sparse || a.bufferView === undefined) return null;
    const bv = json!.bufferViews?.[a.bufferView];
    if (!bv || (bv.buffer ?? 0) !== 0) return null;
    const stride = bv.byteStride || comp.size * width;
    const start = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
    if (start + stride * (a.count - 1) + comp.size * width > buffer.length) return null;
    const values: number[] = [];
    for (let i = 0; i < a.count; i++) for (let k = 0; k < width; k++) {
      const raw = comp.read(dv, start + i * stride + k * comp.size);
      values.push(a.normalized && a.componentType !== 5126 ? Math.max(raw / comp.max, -1) : raw);
    }
    return { values, width, count: a.count };
  };

  let totalVerts = 0;
  /// One mesh primitive as a free mesh, with its points welded where they coincide.
  const primitive = (prim: Json, name: string, scale: Vec3): Cube | null => {
    if ((prim.mode ?? 4) !== 4) {
      notes.push(`"${name}": only triangle meshes are imported`);
      return null;
    }
    const pos = prim.attributes?.POSITION !== undefined ? accessor(prim.attributes.POSITION) : null;
    if (!pos || pos.width !== 3) {
      notes.push(`"${name}": a mesh without readable points was skipped`);
      return null;
    }
    const index = prim.indices !== undefined ? accessor(prim.indices)?.values : Array.from({ length: pos.count }, (_, i) => i);
    if (!index || index.length % 3 !== 0) {
      notes.push(`"${name}": a mesh without readable triangles was skipped`);
      return null;
    }
    const colours = prim.attributes?.COLOR_0 !== undefined ? accessor(prim.attributes.COLOR_0) : null;
    const material = prim.material !== undefined ? json!.materials?.[prim.material] : undefined;
    const factor: number[] = material?.pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1, 1];
    const tint = [srgb(factor[0]!) / 255, srgb(factor[1]!) / 255, srgb(factor[2]!) / 255, factor[3]!];
    const colourAt = (vi: number): [number, number, number, number] => {
      const c = colours ? colours.values.slice(vi * colours.width, vi * colours.width + 4) : [1, 1, 1, 1];
      const a = colours && colours.width === 4 ? c[3]! : 1;
      // vertex colours are taken as they are (Nova's exporter stores them as the sRGB bytes); the material's tint is linear
      return [255 * c[0]! * tint[0]!, 255 * c[1]! * tint[1]!, 255 * c[2]! * tint[2]!, 255 * a * tint[3]!];
    };
    const verts: Vec3[] = [];
    const seen = new Map<string, number>();
    const weld = (vi: number): number => {
      const p: Vec3 = [pos.values[vi * 3]! * scale[0] * UNITS, pos.values[vi * 3 + 1]! * scale[1] * UNITS, pos.values[vi * 3 + 2]! * scale[2] * UNITS];
      const key = p.map((x) => Math.round(x * 1e4)).join(",");
      let n = seen.get(key);
      if (n === undefined) {
        n = verts.length;
        verts.push(p.map(round) as Vec3);
        seen.set(key, n);
      }
      return n;
    };
    const faces: { v: number[]; colour: string }[] = [];
    for (let i = 0; i < index.length; i += 3) {
      const [a, b, c] = [weld(index[i]!), weld(index[i + 1]!), weld(index[i + 2]!)];
      if (a === b || b === c || a === c) continue; // collapsed by the welding
      const cs = [colourAt(index[i]!), colourAt(index[i + 1]!), colourAt(index[i + 2]!)];
      const avg = [0, 1, 2, 3].map((k) => (cs[0]![k]! + cs[1]![k]! + cs[2]![k]!) / 3) as [number, number, number, number];
      faces.push({ v: [a, b, c], colour: toHex(avg[0], avg[1], avg[2], avg[3]) });
    }
    if (!faces.length) return null;
    if (verts.length > MAX_VERTS || faces.length > MAX_FACES || totalVerts + verts.length > MAX_TOTAL_VERTS) {
      notes.push(`"${name}" is too big to import (${verts.length} points, ${faces.length} faces) and was skipped`);
      return null;
    }
    totalVerts += verts.length;
    // the commonest colour is the mesh's own; faces of another colour carry theirs
    const counts = new Map<string, number>();
    for (const f of faces) counts.set(f.colour, (counts.get(f.colour) ?? 0) + 1);
    const base = [...counts].sort((x, y) => y[1] - x[1])[0]![0];
    const polys: MeshFace[] = faces.map((f) => (f.colour === base ? { v: f.v } : { v: f.v, color: f.colour }));
    const cube: Cube = { shape: "mesh", ...(name ? { name } : {}), from: [0, 0, 0], size: [0, 0, 0], color: base, verts, polys };
    fitBounds(cube);
    return cube;
  };

  const nodes: Json[] = json.nodes ?? [];
  let parts = 0;
  const nameChain = new Map<number, string[]>(); // node -> part names from the top
  const visiting = new Set<number>();
  const build = (index: number, siblings: Part[], parentChain: string[]): Part | null => {
    const node = nodes[index];
    if (!node || visiting.has(index)) return null;
    if (++parts > MAX_PARTS) return null;
    visiting.add(index);
    const local = node.matrix && node.matrix.length === 16 ? decompose(node.matrix) : null;
    const t: Vec3 = local ? local.t : (node.translation ?? [0, 0, 0]);
    const q = local ? local.q : ((node.rotation as [number, number, number, number] | undefined) ?? [0, 0, 0, 1]);
    const s: Vec3 = local ? local.s : (node.scale ?? [1, 1, 1]);
    const name = uniqueSiblingName(siblings, String(node.name ?? "").trim() || (node.mesh !== undefined ? String(json!.meshes?.[node.mesh]?.name ?? "part") : "part"));
    const part: Part = { name, origin: t.map((x: number) => round(x * UNITS)) as Vec3, rotation: quaternionToEuler(q), cubes: [], children: [] };
    siblings.push(part);
    const chain = [...parentChain, name];
    nameChain.set(index, chain);
    if (node.skin !== undefined) notes.push(`"${name}" is skinned: its bones are not imported, only its shape`);
    if (node.mesh !== undefined) {
      const mesh = json!.meshes?.[node.mesh];
      for (const [k, prim] of (mesh?.primitives ?? []).entries()) {
        const cube = primitive(prim, (mesh.primitives.length > 1 ? `${mesh.name ?? name} ${k + 1}` : (mesh.name ?? "")) as string, s);
        if (cube) part.cubes.push(cube);
      }
    }
    if (s.some((x) => Math.abs(x - 1) > 1e-6) && node.children?.length) notes.push(`"${name}" is resized and has child parts: the children are not resized with it`);
    for (const child of node.children ?? []) build(child, part.children, chain);
    visiting.delete(index);
    return part;
  };
  const roots: number[] = json.scenes?.[json.scene ?? 0]?.nodes ?? nodes.map((_, i) => i).filter((i) => !nodes.some((n) => n.children?.includes(i)));
  const top: Part[] = [];
  for (const root of roots) build(root, top, []);
  if (parts > MAX_PARTS) return { ok: false, error: `the model has more than ${MAX_PARTS} parts` };
  if (!top.length) return { ok: false, error: "the model has nothing in it" };
  if ((json.textures?.length ?? 0) > 0) notes.push("textures are not imported: shapes keep flat colours (paint a new texture in the Texture tab)");

  // animations: translation, rotation and scale of nodes that became parts
  const clips: Clip[] = [];
  for (const [ai, anim] of (json.animations ?? []).entries()) {
    if (clips.length >= MAX_CLIPS) break;
    const tracks: Track[] = [];
    let duration = 0;
    for (const ch of anim.channels ?? []) {
      const chain = nameChain.get(ch.target?.node);
      const prop: Prop | undefined = ({ translation: "position", rotation: "rotation", scale: "scale" } as Record<string, Prop>)[ch.target?.path];
      const sampler = anim.samplers?.[ch.sampler];
      if (!chain || !prop || !sampler) continue;
      const times = accessor(sampler.input);
      const out = accessor(sampler.output);
      if (!times || !out) continue;
      const interp = sampler.interpolation ?? "LINEAR";
      const stride = interp === "CUBICSPLINE" ? 3 : 1; // value is the middle of in-tangent, value, out-tangent
      if (interp === "CUBICSPLINE") notes.push(`animation "${anim.name ?? ai}": curved keys were read as straight`);
      // times keep four decimals (a step is baked just before the next key), and must go strictly forward
      const keys: Track["keys"] = [];
      times.values.slice(0, MAX_KEYS).forEach((time, i) => {
        const t = Math.round(time * 10000) / 10000;
        if (t < 0 || (keys.length && t <= keys[keys.length - 1]!.t)) return;
        const at = (i * stride + (stride === 3 ? 1 : 0)) * out.width;
        const v = out.values.slice(at, at + out.width);
        const value: Vec3 = prop === "rotation" ? quaternionToEuler(v as [number, number, number, number]) : (v.slice(0, 3).map((x) => round(prop === "position" ? x * UNITS : x)) as Vec3);
        keys.push({ t, value, ...(interp === "STEP" ? { ease: "step" as const } : {}) });
      });
      if (!keys.length) continue;
      duration = Math.max(duration, keys[keys.length - 1]!.t);
      tracks.push({ part: chain, prop, keys });
    }
    if (tracks.length) clips.push({ name: String(anim.name ?? `clip${clips.length + 1}`), duration: Math.max(0.1, Math.min(600, duration || 1)), loop: true, tracks });
  }
  // two clips may share a name: keep names unique
  const used = new Set<string>();
  for (const c of clips) {
    let n = c.name;
    for (let k = 2; used.has(n); k++) n = `${c.name}${k}`;
    c.name = n;
    used.add(n);
  }
  return { ok: true, doc: { version: 1, scale: DEFAULT_SCALE, parts: top, ...(clips.length ? { clips } : {}) }, notes };
}
