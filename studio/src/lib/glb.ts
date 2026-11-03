// Exports a model document as binary glTF (.glb), the format the game loads: one node per part
// (so a later bone animation can move them), one mesh per part with flat-coloured cubes baked in
// as COLOR_0 vertex colours and per-face normals.

import { namesOf, walk, type Clip, type Cube, type Ease, type ModelDoc, type Part, type Track, type Vec3 } from "./model-doc";
import { BAKE_STEPS, applyEase, lerp3, slerp } from "./model-ease";
import { FACE_CORNERS, hasVolume, meshOf as solidMesh, solidOf, type Mesh } from "./model-mesh";
import { boneKey, invertAffine, transformDirection, transformPoint, worldMatrices } from "./model-skin";
import { bakeAll, uvsOf } from "./model-uv";
import { newRaster, type Raster } from "./pixels";
import { encodePng } from "./png-encode";

export { FACE_CORNERS };

export { eulerToQuaternion } from "./model-ease";
import { eulerToQuaternion } from "./model-ease";

/// The part's solids as one set of triangles, scaled to world units.
/// A mesh that bends with the model's parts.
const isSkinned = (c: Cube) => c.shape === "mesh" && !!c.skin;

function meshOf(part: Part, scale: number, tex?: Texel): PartMesh {
  const m: PartMesh = { positions: [], normals: [], colors: [], indices: [], uvs: [] };
  for (const cube of part.cubes) {
    if (isSkinned(cube)) continue; // drawn as a skinned mesh of its own
    const one = solidMesh(cube, scale);
    const base = m.positions.length / 3;
    m.positions.push(...one.positions);
    m.normals.push(...one.normals);
    m.colors.push(...one.colors);
    for (const i of one.indices) m.indices.push(base + i);
    if (tex) {
      // Painted shapes use their texels; the rest all point at the white texel, so their colour shows as it is.
      const own = uvsOf(cube);
      const count = one.positions.length / 3;
      for (let i = 0; i < count; i++) m.uvs.push(...(own.length ? [own[i * 2]! / tex.w, own[i * 2 + 1]! / tex.rows] : [tex.whiteU, tex.whiteV]));
    }
  }
  return m;
}

type PartMesh = Pick<Mesh, "positions" | "normals" | "colors" | "indices"> & { uvs: number[] };

/// The embedded picture is the texture plus one extra row of white at the bottom.
interface Texel {
  w: number;
  rows: number;
  whiteU: number;
  whiteV: number;
}

/// The texture with the white row added; its size is the picture's, or the model's if none was given.
export function textureForExport(doc: ModelDoc, picture?: Raster): Raster {
  const [w, h] = picture ? [picture.w, picture.h] : doc.texture!.size;
  const base = picture ?? bakeAll(doc);
  const out = newRaster(w, h + 1);
  out.data.set(base.data);
  out.data.fill(255, w * h * 4);
  return out;
}

const pad4 = (n: number) => (n + 3) & ~3;

/// The keys as the numbers glTF stores (a quaternion for a turn), with each eased segment baked into extra keys, since a glTF
/// sampler blends straight (or steps) for its whole track. Segments with no easing stay as they are.
function bakeKeys(keys: { t: number; value: Vec3; ease?: Ease }[], prop: Track["prop"], scale: number): { t: number; value: number[] }[] {
  const num = (v: Vec3): number[] => (prop === "rotation" ? eulerToQuaternion(v) : prop === "position" ? v.map((x) => x * scale) : v);
  const out: { t: number; value: number[] }[] = [];
  keys.forEach((k, i) => {
    out.push({ t: k.t, value: num(k.value) });
    const next = keys[i + 1];
    if (!next || !k.ease || k.ease === "linear") return;
    if (k.ease === "step") {
      out.push({ t: next.t - 0.0001, value: num(k.value) });
      return;
    }
    for (let n = 1; n <= BAKE_STEPS; n++) {
      const f = applyEase(k.ease, n / (BAKE_STEPS + 1));
      const value = prop === "rotation" ? slerp(eulerToQuaternion(k.value), eulerToQuaternion(next.value), f) : num(lerp3(k.value, next.value, f));
      out.push({ t: k.t + ((next.t - k.t) * n) / (BAKE_STEPS + 1), value });
    }
  });
  return out;
}

/// The track's keys with a held key at time 0 and at the clip's end, so every clip lasts its full duration.
function holdEnds(track: Track, clip: Clip) {
  const keys = track.keys.map((k) => ({ t: k.t, value: k.value, ...(k.ease ? { ease: k.ease } : {}) }));
  if (keys[0]!.t > 0) keys.unshift({ t: 0, value: keys[0]!.value });
  if (keys[keys.length - 1]!.t < clip.duration) keys.push({ t: clip.duration, value: keys[keys.length - 1]!.value });
  return keys;
}

/// `texture` is the painted picture (`models/<name>.texture.png`); without it a model that has textured shapes
/// gets their colours baked into a fresh one.
export function exportGlb(doc: ModelDoc, texture?: Raster): Uint8Array {
  const scale = doc.scale;
  const gltfNodes: Record<string, unknown>[] = [];
  const meshes: Record<string, unknown>[] = [];
  const accessors: Record<string, unknown>[] = [];
  const views: Record<string, unknown>[] = [];
  const chunks: Uint8Array[] = [];
  let offset = 0;

  const addView = (bytes: Uint8Array, target?: number) => {
    views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, ...(target ? { target } : {}) });
    const padded = new Uint8Array(pad4(bytes.length));
    padded.set(bytes);
    chunks.push(padded);
    offset += padded.length;
    return views.length - 1;
  };
  const bytesOf = (a: Float32Array | Uint8Array | Uint16Array | Uint32Array) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

  const textured = !!doc.texture && walk(doc).some(({ part }) => part.cubes.some((c) => c.texture && hasVolume(c)));
  const image = textured ? textureForExport(doc, texture) : undefined;
  const tex: Texel | undefined = image ? { w: image.w, rows: image.h, whiteU: 0.5 / image.w, whiteV: (image.h - 0.5) / image.h } : undefined;

  let drawn = 0;
  // Node numbers follow the depth-first walk; children refer to their numbers.
  const order = walk(doc);
  const nodeOf = new Map<string, number>(order.map((o, i) => [o.parts.join("."), i]));
  for (const { part, parts } of order) {
    const node: Record<string, unknown> = { name: part.name };
    if (part.origin.some((v) => v !== 0)) node.translation = part.origin.map((v) => v * scale);
    if (part.rotation.some((v) => v !== 0)) node.rotation = eulerToQuaternion(part.rotation);
    const m = meshOf(part, scale, tex);
    if (m.positions.length) {
      drawn += part.cubes.filter((c) => hasVolume(c) && !isSkinned(c)).length;
      const pos = new Float32Array(m.positions);
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < pos.length; i += 3) for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a]!, pos[i + a]!);
        max[a] = Math.max(max[a]!, pos[i + a]!);
      }
      const vertexCount = m.positions.length / 3;
      const wide = vertexCount > 65535;
      const posView = addView(bytesOf(pos), 34962);
      const nrmView = addView(bytesOf(new Float32Array(m.normals)), 34962);
      const colView = addView(bytesOf(new Uint8Array(m.colors)), 34962);
      const idxView = addView(bytesOf(wide ? new Uint32Array(m.indices) : new Uint16Array(m.indices)), 34963);
      const accessor = (a: Record<string, unknown>) => accessors.push(a) - 1;
      const primitive = {
        attributes: {
          POSITION: accessor({ bufferView: posView, componentType: 5126, count: vertexCount, type: "VEC3", min, max }),
          NORMAL: accessor({ bufferView: nrmView, componentType: 5126, count: vertexCount, type: "VEC3" }),
          COLOR_0: accessor({ bufferView: colView, componentType: 5121, normalized: true, count: vertexCount, type: "VEC4" }),
          ...(tex ? { TEXCOORD_0: accessor({ bufferView: addView(bytesOf(new Float32Array(m.uvs)), 34962), componentType: 5126, count: vertexCount, type: "VEC2" }) } : {}),
        },
        indices: accessor({ bufferView: idxView, componentType: wide ? 5125 : 5123, count: m.indices.length, type: "SCALAR" }),
        material: 0,
      };
      meshes.push({ name: part.name, primitives: [primitive] });
      node.mesh = meshes.length - 1;
    }
    const childNumbers = part.children.map((_, i) => nodeOf.get([...parts, i].join("."))!);
    if (childNumbers.length) node.children = childNumbers;
    gltfNodes.push(node);
  }
  const skinnedShapes = order.flatMap(({ part, parts }) => part.cubes.filter((c) => isSkinned(c) && hasVolume(c)).map((cube) => ({ cube, parts })));
  if (drawn + skinnedShapes.length === 0) throw new Error("the model has no shapes with volume to export");

  // Animation clips: one channel per keyed property, on the node of the part it names.
  const nodeByNames = new Map<string, number>();
  {
    const chain: string[] = [];
    for (const { part, parts, depth } of order) {
      chain.length = depth;
      chain.push(part.name);
      nodeByNames.set(chain.join("/"), nodeOf.get(parts.join("."))!);
    }
  }
  // Skinned meshes: one node each at the top, in the model's space at rest, with the part nodes as its joints.
  const skins: Record<string, unknown>[] = [];
  const skinNodes: number[] = [];
  if (skinnedShapes.length) {
    const rest = worldMatrices(doc);
    for (const { cube, parts } of skinnedShapes) {
      const skin = cube.skin!;
      const names = namesOf(doc, parts);
      const owner = rest.get(boneKey(names))!;
      const m = solidMesh(cube, 1);
      const solid = solidOf(cube);
      const order2 = solid.polys.flatMap((p) => p.v); // the point each emitted vertex came from
      const count = m.positions.length / 3;
      const pos = new Float32Array(count * 3);
      const nrm = new Float32Array(count * 3);
      const joints = new Uint8Array(count * 4);
      const weights = new Float32Array(count * 4);
      const own = tex ? uvsOf(cube) : [];
      const uv = new Float32Array(tex ? count * 2 : 0);
      for (let i = 0; i < count; i++) {
        const p = transformPoint(owner, [m.positions[i * 3]!, m.positions[i * 3 + 1]!, m.positions[i * 3 + 2]!]);
        const n = transformDirection(owner, [m.normals[i * 3]!, m.normals[i * 3 + 1]!, m.normals[i * 3 + 2]!]);
        const l = Math.hypot(...n) || 1;
        pos.set([p[0] * scale, p[1] * scale, p[2] * scale], i * 3);
        nrm.set([n[0] / l, n[1] / l, n[2] / l], i * 3);
        (skin.weights[order2[i]!] ?? [[0, 1]]).slice(0, 4).forEach(([b, w], k) => {
          joints[i * 4 + k] = b;
          weights[i * 4 + k] = w;
        });
        if (tex) uv.set(own.length ? [own[i * 2]! / tex.w, own[i * 2 + 1]! / tex.rows] : [tex.whiteU, tex.whiteV], i * 2);
      }
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < pos.length; i += 3) for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a]!, pos[i + a]!);
        max[a] = Math.max(max[a]!, pos[i + a]!);
      }
      const wide = count > 65535;
      const accessor = (a: Record<string, unknown>) => accessors.push(a) - 1;
      const primitive = {
        attributes: {
          POSITION: accessor({ bufferView: addView(bytesOf(pos), 34962), componentType: 5126, count, type: "VEC3", min, max }),
          NORMAL: accessor({ bufferView: addView(bytesOf(nrm), 34962), componentType: 5126, count, type: "VEC3" }),
          COLOR_0: accessor({ bufferView: addView(bytesOf(new Uint8Array(m.colors)), 34962), componentType: 5121, normalized: true, count, type: "VEC4" }),
          ...(tex ? { TEXCOORD_0: accessor({ bufferView: addView(bytesOf(uv), 34962), componentType: 5126, count, type: "VEC2" }) } : {}),
          JOINTS_0: accessor({ bufferView: addView(bytesOf(joints), 34962), componentType: 5121, count, type: "VEC4" }),
          WEIGHTS_0: accessor({ bufferView: addView(bytesOf(weights), 34962), componentType: 5126, count, type: "VEC4" }),
        },
        indices: accessor({ bufferView: addView(bytesOf(wide ? new Uint32Array(m.indices) : new Uint16Array(m.indices)), 34963), componentType: wide ? 5125 : 5123, count: m.indices.length, type: "SCALAR" }),
        material: 0,
      };
      meshes.push({ name: cube.name ?? "skin", primitives: [primitive] });
      // the inverse of each joint's place at rest, in the exported (scaled) space
      const ibm = new Float32Array(skin.bones.length * 16);
      skin.bones.forEach((b, i) => {
        const world = [...(rest.get(b) ?? owner)];
        world[12] = world[12]! * scale;
        world[13] = world[13]! * scale;
        world[14] = world[14]! * scale;
        ibm.set(invertAffine(world), i * 16);
      });
      skins.push({
        joints: skin.bones.map((b) => nodeByNames.get(b) ?? nodeByNames.get(boneKey(names))!),
        inverseBindMatrices: accessor({ bufferView: addView(bytesOf(ibm)), componentType: 5126, count: skin.bones.length, type: "MAT4" }),
      });
      gltfNodes.push({ name: `skin ${cube.name ?? skins.length}`, mesh: meshes.length - 1, skin: skins.length - 1 });
      skinNodes.push(gltfNodes.length - 1);
    }
  }
  const animations: Record<string, unknown>[] = [];
  for (const clip of doc.clips ?? []) {
    const samplers: Record<string, unknown>[] = [];
    const channels: Record<string, unknown>[] = [];
    for (const track of clip.tracks) {
      const node = nodeByNames.get(track.part.join("/"));
      if (node === undefined || track.keys.length === 0) continue; // a track for a part that no longer exists is skipped
      const keys = bakeKeys(holdEnds(track, clip), track.prop, scale);
      const times = new Float32Array(keys.map((k) => k.t));
      const out = new Float32Array(keys.flatMap((k) => k.value));
      const inView = addView(bytesOf(times));
      const outView = addView(bytesOf(out));
      const input = accessors.push({ bufferView: inView, componentType: 5126, count: times.length, type: "SCALAR", min: [times[0]], max: [times[times.length - 1]] }) - 1;
      const output = accessors.push({ bufferView: outView, componentType: 5126, count: keys.length, type: track.prop === "rotation" ? "VEC4" : "VEC3" }) - 1;
      samplers.push({ input, output, interpolation: "LINEAR" });
      channels.push({ sampler: samplers.length - 1, target: { node, path: track.prop === "position" ? "translation" : track.prop } });
    }
    if (channels.length) animations.push({ name: clip.name, samplers, channels });
  }

  const json = {
    asset: { version: "2.0", generator: "Nova Studio" },
    scene: 0,
    scenes: [{ nodes: [...doc.parts.map((_, i) => nodeOf.get(String(i))!), ...skinNodes] }],
    nodes: gltfNodes,
    meshes,
    ...(skins.length ? { skins } : {}),
    materials: [{ name: tex ? "texture" : "vertex colours", pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], ...(tex ? { baseColorTexture: { index: 0 } } : {}), metallicFactor: 0, roughnessFactor: 1 } }],
    ...(tex && image
      ? {
          // nearest filtering keeps painted texels crisp; the picture is clamped, not tiled
          samplers: [{ magFilter: 9728, minFilter: 9728, wrapS: 33071, wrapT: 33071 }],
          textures: [{ sampler: 0, source: 0 }],
          images: [{ bufferView: addView(encodePng(image)), mimeType: "image/png" }],
        }
      : {}),
    ...(animations.length ? { animations } : {}),
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: offset }],
  };

  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPadded = new Uint8Array(pad4(jsonBytes.length)).fill(0x20);
  jsonPadded.set(jsonBytes);
  const total = 12 + 8 + jsonPadded.length + 8 + offset;
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  v.setUint32(0, 0x46546c67, true); // "glTF"
  v.setUint32(4, 2, true);
  v.setUint32(8, total, true);
  v.setUint32(12, jsonPadded.length, true);
  v.setUint32(16, 0x4e4f534a, true); // "JSON"
  out.set(jsonPadded, 20);
  const binAt = 20 + jsonPadded.length;
  v.setUint32(binAt, offset, true);
  v.setUint32(binAt + 4, 0x004e4942, true); // "BIN\0"
  let at = binAt + 8;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
