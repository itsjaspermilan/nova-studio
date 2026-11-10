// Exports a model document as binary glTF (.glb), the format the game loads: one node per part
// (so a later bone animation can move them), one mesh per part with flat-coloured cubes baked in
// as COLOR_0 vertex colours and per-face normals.

import { settleKeyEdits, glowOf, metallicOf, namesOf, roughnessOf, walk, type Clip, type Cube, type Ease, type ModelDoc, type Part, type Track, type Vec3 } from "./model-doc";
import { BAKE_STEPS, applyEase, lerp3, slerp } from "./model-ease";
import { FACE_CORNERS, hasVolume, meshOf as solidMesh, solidOf, type Mesh } from "./model-mesh";
import { evaluate } from "./modifiers";
import { boneKey, invertAffine, transformDirection, transformPoint, worldMatrices } from "./model-skin";
import { bakeAll, bakeSurface, uvsOf } from "./model-uv";
import { partShapeNames, shapeDeltas } from "./shape-keys";
import { heightToNormal } from "./texture-bump";
import { newRaster, type Raster } from "./pixels";
import { encodePng } from "./png-encode";

export { FACE_CORNERS };

export { eulerToQuaternion } from "./model-ease";
import { eulerToQuaternion } from "./model-ease";

/// The part's solids as one set of triangles, scaled to world units.
/// A mesh that bends with the model's parts.
const isSkinned = (c: Cube) => c.shape === "mesh" && !!c.skin;

/// Appends `from` to `to` (a spread into push() overflows the call stack for a shape of more than about a hundred thousand numbers).
function append(to: number[], from: ArrayLike<number>) {
  for (let i = 0; i < from.length; i++) to.push(from[i]!);
}

function meshOf(part: Part, scale: number, tex?: Texel, keys: string[] = []): PartMesh {
  const m: PartMesh = { positions: [], normals: [], colors: [], indices: [], uvs: [], morphs: keys.map(() => []) };
  for (const cube of part.cubes) {
    if (isSkinned(cube)) continue; // drawn as a skinned mesh of its own
    const shown = evaluate(cube, "render"); // modifiers baked in
    const one = solidMesh(shown, scale);
    const base = m.positions.length / 3;
    append(m.positions, one.positions);
    append(m.normals, one.normals);
    append(m.colors, one.colors);
    for (const i of one.indices) m.indices.push(base + i);
    // shape keys: where each vertex goes at weight 1 (zeros for a shape without that key, or with modifiers)
    keys.forEach((name, k) => {
      const d = shapeDeltas(cube, name, scale);
      if (d && d.length === one.positions.length) append(m.morphs[k]!, d);
      else append(m.morphs[k]!, new Array<number>(one.positions.length).fill(0));
    });
    if (tex) {
      // Painted shapes use their texels; the rest all point at the white texel, so their colour shows as it is.
      const own = uvsOf(shown);
      const count = one.positions.length / 3;
      for (let i = 0; i < count; i++) m.uvs.push(...(own.length ? [own[i * 2]! / tex.w, own[i * 2 + 1]! / tex.rows] : [tex.whiteU, tex.whiteV]));
    }
  }
  return m;
}

type PartMesh = Pick<Mesh, "positions" | "normals" | "colors" | "indices"> & { uvs: number[]; morphs: number[][] };

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

/// The model's colours are sRGB (what the editor shows); glTF's COLOR_0 is linear light, and the game reads it so. They are written as 16-bit
/// numbers, so that dark colours come back exactly (eight bits of linear light are too coarse near black). Alpha stays as it is.
const LINEAR = Array.from({ length: 256 }, (_, v) => {
  const c = v / 255;
  return Math.round(65535 * (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
});
const linearColours = (colors: number[]) => new Uint16Array(colors.map((v, i) => (i % 4 === 3 ? v * 257 : LINEAR[v]!)));
/// `surface` is the roughness and metal picture (green and blue), written as glTF's metallic-roughness picture when the model's `texture.surface` is set: painted
/// shapes then take their roughness and metal from it, whatever numbers they carry.
export function exportGlb(source: ModelDoc, texture?: Raster, surface?: Raster): Uint8Array {
  const doc = settleKeyEdits(source);
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
  const surfaceImage = image && doc.texture?.surface ? textureForExport(doc, surface ?? bakeSurface(doc)) : undefined;
  // bumps painted in the surface picture's red channel: a normal map, flat in the white row that shapes with no texels read
  let normalImage: Raster | undefined;
  if (surfaceImage && doc.texture?.bump) {
    const [w, h] = [surfaceImage.w, surfaceImage.h - 1];
    const grey = newRaster(w, h);
    grey.data.set(surfaceImage.data.subarray(0, w * h * 4));
    const map = heightToNormal(grey, doc.texture.bump);
    normalImage = newRaster(w, h + 1);
    normalImage.data.set(map.data);
    for (let i = w * h * 4; i < normalImage.data.length; i += 4) { normalImage.data[i] = 128; normalImage.data[i + 1] = 128; normalImage.data[i + 2] = 255; normalImage.data[i + 3] = 255; }
  }
  const tex: Texel | undefined = image ? { w: image.w, rows: image.h, whiteU: 0.5 / image.w, whiteV: (image.h - 0.5) / image.h } : undefined;

  // Material 0 is the plain one; a glowing shape's material adds an emissive factor (see `glowOf`).
  const mats: { glow: number; metal: number; rough: number }[] = [];
  const materialFor = (c: Cube) => {
    const painted = !!surfaceImage && !!c.texture && hasVolume(c);
    const glow = glowOf(c), metal = painted ? 1 : metallicOf(c), rough = painted ? 1 : roughnessOf(c);
    if (glow === 0 && metal === 0 && rough === 1) return 0;
    let at = mats.findIndex((m) => m.glow === glow && m.metal === metal && m.rough === rough);
    if (at < 0) at = mats.push({ glow, metal, rough }) - 1;
    return at + 1;
  };
  let drawn = 0;
  // Node numbers follow the depth-first walk; children refer to their numbers.
  const order = walk(doc);
  const nodeOf = new Map<string, number>(order.map((o, i) => [o.parts.join("."), i]));
  for (const { part, parts } of order) {
    const node: Record<string, unknown> = { name: part.name };
    if (part.origin.some((v) => v !== 0)) node.translation = part.origin.map((v) => v * scale);
    if (part.rotation.some((v) => v !== 0)) node.rotation = eulerToQuaternion(part.rotation);
    // the part's constraints stay live in the game (a reach target is in model units: scaled to metres like the part positions)
    if (part.constraints?.length) {
      node.extras = { nova: { constraints: part.constraints.map((c) => (c.type === "reach" ? { ...c, target: c.target.map((v) => v * scale) } : c)) } };
    }
    // Shapes that glow get a material of their own (one per strength), so a part may have several primitives.
    const groups = new Map<number, Cube[]>();
    for (const c of part.cubes) {
      const key = materialFor(c);
      groups.set(key, [...(groups.get(key) ?? []), c]);
    }
    const primitives: Record<string, unknown>[] = [];
    // shape keys of this part's shapes become the mesh's morph targets (every primitive of a mesh has the same targets)
    const keyNames = partShapeNames(part).filter((n) => part.cubes.some((c) => !isSkinned(c) && !c.modifiers?.length && c.shapes?.some((k) => k.name === n)));
    for (const [material, cubes] of groups) {
      const m = meshOf({ ...part, cubes }, scale, tex, keyNames);
      if (!m.positions.length) continue;
      drawn += cubes.filter((c) => hasVolume(c) && !isSkinned(c)).length;
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
      const colView = addView(bytesOf(linearColours(m.colors)), 34962);
      const idxView = addView(bytesOf(wide ? new Uint32Array(m.indices) : new Uint16Array(m.indices)), 34963);
      const accessor = (a: Record<string, unknown>) => accessors.push(a) - 1;
      primitives.push({
        attributes: {
          POSITION: accessor({ bufferView: posView, componentType: 5126, count: vertexCount, type: "VEC3", min, max }),
          NORMAL: accessor({ bufferView: nrmView, componentType: 5126, count: vertexCount, type: "VEC3" }),
          COLOR_0: accessor({ bufferView: colView, componentType: 5123, normalized: true, count: vertexCount, type: "VEC4" }),
          ...(tex ? { TEXCOORD_0: accessor({ bufferView: addView(bytesOf(new Float32Array(m.uvs)), 34962), componentType: 5126, count: vertexCount, type: "VEC2" }) } : {}),
        },
        indices: accessor({ bufferView: idxView, componentType: wide ? 5125 : 5123, count: m.indices.length, type: "SCALAR" }),
        material,
        ...(keyNames.length
          ? {
              targets: m.morphs.map((d) => {
                const lo = [Infinity, Infinity, Infinity];
                const hi = [-Infinity, -Infinity, -Infinity];
                for (let i = 0; i < d.length; i += 3) for (let a = 0; a < 3; a++) {
                  lo[a] = Math.min(lo[a]!, d[i + a]!);
                  hi[a] = Math.max(hi[a]!, d[i + a]!);
                }
                return { POSITION: accessor({ bufferView: addView(bytesOf(new Float32Array(d)), 34962), componentType: 5126, count: vertexCount, type: "VEC3", min: lo, max: hi }) };
              }),
            }
          : {}),
      });
    }
    if (primitives.length) {
      meshes.push({ name: part.name, primitives, ...(keyNames.length ? { extras: { targetNames: keyNames } } : {}) });
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
          COLOR_0: accessor({ bufferView: addView(bytesOf(linearColours(m.colors)), 34962), componentType: 5123, normalized: true, count, type: "VEC4" }),
          ...(tex ? { TEXCOORD_0: accessor({ bufferView: addView(bytesOf(uv), 34962), componentType: 5126, count, type: "VEC2" }) } : {}),
          JOINTS_0: accessor({ bufferView: addView(bytesOf(joints), 34962), componentType: 5121, count, type: "VEC4" }),
          WEIGHTS_0: accessor({ bufferView: addView(bytesOf(weights), 34962), componentType: 5126, count, type: "VEC4" }),
        },
        indices: accessor({ bufferView: addView(bytesOf(wide ? new Uint32Array(m.indices) : new Uint16Array(m.indices)), 34963), componentType: wide ? 5125 : 5123, count: m.indices.length, type: "SCALAR" }),
        material: materialFor(cube),
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

  // Circles stay `[x, z, r]` under `colliders`; capsules and boxes have keys of their own (older readers ignore them). Lengths are in metres,
  // a box's turn in radians.
  const metres = (list: number[]) => list.map((v) => Math.round(v * 1e5) / 1e5);
  const shapeExtras = {
    ...(doc.colliders?.length ? { colliders: doc.colliders.map((c) => metres([c.x * scale, c.z * scale, c.r * scale])) } : {}),
    ...(doc.capsules?.length ? { capsules: doc.capsules.map((c) => metres([c.ax * scale, c.az * scale, c.bx * scale, c.bz * scale, c.r * scale])) } : {}),
    ...(doc.boxes?.length ? { boxes: doc.boxes.map((c) => metres([c.x * scale, c.z * scale, c.hw * scale, c.hl * scale, (c.turn * Math.PI) / 180])) } : {}),
  };
  const hasShapes = Object.keys(shapeExtras).length > 0;
  const json = {
    asset: { version: "2.0", generator: "Nova Studio" },
    scene: 0,
    scenes: [{ nodes: [...doc.parts.map((_, i) => nodeOf.get(String(i))!), ...skinNodes], ...(hasShapes ? { extras: { nova: shapeExtras } } : {}) }],
    nodes: gltfNodes,
    meshes,
    ...(skins.length ? { skins } : {}),
    materials: [
      { name: tex ? "texture" : "vertex colours", pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], ...(tex ? { baseColorTexture: { index: 0 } } : {}), ...(surfaceImage ? { metallicRoughnessTexture: { index: 1 } } : {}), metallicFactor: 0, roughnessFactor: 1 }, ...(normalImage ? { normalTexture: { index: 2 } } : {}) },
      ...mats.map((m) => ({ name: [m.glow ? `glow ${m.glow}` : "", m.metal ? `metal ${m.metal}` : "", m.rough < 1 ? `rough ${m.rough}` : ""].filter(Boolean).join(" "), pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], ...(tex ? { baseColorTexture: { index: 0 } } : {}), ...(surfaceImage ? { metallicRoughnessTexture: { index: 1 } } : {}), metallicFactor: m.metal, roughnessFactor: m.rough }, ...(normalImage ? { normalTexture: { index: 2 } } : {}), ...(m.glow ? { emissiveFactor: [m.glow, m.glow, m.glow] } : {}) })),
    ],
    ...(tex && image
      ? {
          // nearest filtering keeps painted texels crisp, linear (`texture.smooth`) blends them; the picture is clamped, not tiled
          samplers: [doc.texture?.smooth ? { magFilter: 9729, minFilter: 9729, wrapS: 33071, wrapT: 33071 } : { magFilter: 9728, minFilter: 9728, wrapS: 33071, wrapT: 33071 }],
          textures: [{ sampler: 0, source: 0 }, ...(surfaceImage ? [{ sampler: 0, source: 1 }] : []), ...(normalImage ? [{ sampler: 0, source: 2 }] : [])],
          images: [{ bufferView: addView(encodePng(image)), mimeType: "image/png" }, ...(surfaceImage ? [{ bufferView: addView(encodePng(surfaceImage)), mimeType: "image/png" }] : []), ...(normalImage ? [{ bufferView: addView(encodePng(normalImage)), mimeType: "image/png" }] : [])],
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
