// The model editor's data: a tree of parts, each holding coloured cubes. It is saved as
// `models/<name>.model.json` and exported to the `.glb` the game loads. One unit is one
// "pixel" of the model; `scale` converts units to the game's world units on export.

export type Vec3 = [number, number, number];
export type Face = "east" | "west" | "up" | "down" | "south" | "north";
export const FACES: Face[] = ["east", "west", "up", "down", "south", "north"];

/// What an element is. Every shape but `mesh` fills its box (`from`, `size`); a `mesh` is free points and faces.
export type Shape = "box" | "wedge" | "pyramid" | "cylinder" | "cone" | "sphere" | "mesh";
export const SHAPES: Shape[] = ["box", "wedge", "pyramid", "cylinder", "cone", "sphere", "mesh"];
export const MIN_SEGMENTS = 3;
export const MAX_SEGMENTS = 64;
export const DEFAULT_SEGMENTS = 16;
export const MAX_VERTS = 20000;
export const MAX_FACES = 20000;
export const MAX_TOTAL_VERTS = 60000;
export const MAX_BONES = 64;

/// A flat polygon of a mesh: point numbers in counter-clockwise order seen from outside.
export interface MeshFace {
  v: number[];
  /// Overrides the element's colour.
  color?: string;
  /// Shade smoothly across its shared points instead of flat.
  smooth?: boolean;
}

/// One solid in a part. (Named "cube" for the first shape it had; the file key is still `cubes`.)
export interface Cube {
  name?: string;
  shape?: Shape;
  /// Corner with the smallest x, y, z, in the part's own space. For a mesh this is derived from its points.
  from: Vec3;
  size: Vec3;
  /// Turn about the box's centre, degrees, X then Y then Z. Meshes carry their turn in their points.
  rotation?: Vec3;
  /// Sides around a cylinder, cone or sphere.
  segments?: number;
  /// Round shapes shade smoothly unless this is false.
  smooth?: boolean;
  /// Colour of all faces, `#rrggbb` or `#rrggbbaa`.
  color: string;
  /// Colours of individual faces, overriding `color`.
  faces?: Partial<Record<Face, string>>;
  /// Mesh only: the points, in the part's space, and the polygons between them.
  verts?: Vec3[];
  polys?: MeshFace[];
  /// Mesh only: makes the mesh bend with the model's parts.
  skin?: Skin;
  /// Present when the shape is painted with the model's texture: where its unwrapped faces sit in the picture
  /// (the top-left of its block of texels) and how many texels one model unit gets (default 1).
  /// `mirror` (a box mirrored by "Mirror copy"): bits 1, 2 and 4 for x, y and z, showing the same texels reflected.
  /// `faces` places single faces of a box, wedge or pyramid anywhere in the picture: `[x, y, width, height]` in texels, instead of
  /// the automatic layout inside the block. A negative width or height runs the other way from the corner, flipping the face.
  texture?: { at: [number, number]; scale?: number; mirror?: number; faces?: Partial<Record<Face, [number, number, number, number]>> };
}

/// A mesh that bends with the parts it is attached to (the model's skeleton is its part tree): every point follows up to four parts,
/// each with a weight, and the weights of a point add up to 1. `bones` names the parts as paths of part names joined by "/"
/// ("body/arm"); `weights[i]` is the `[bone number, weight]` pairs of point i.
export interface Skin {
  bones: string[];
  weights: [number, number][][];
}

export type TextureInfo = { size: [number, number] };
export const MIN_TEXTURE = 8;
export const MAX_TEXTURE = 1024;

export interface Part {
  name: string;
  /// Where the part's own origin (its pivot) sits inside its parent.
  origin: Vec3;
  /// Rotation about the pivot, degrees, applied X then Y then Z.
  rotation: Vec3;
  cubes: Cube[];
  children: Part[];
}

export type Prop = "position" | "rotation" | "scale";
export const PROPS: Prop[] = ["position", "rotation", "scale"];

/// A value at a time. Position is the part's pivot position in model units, rotation is degrees (X then Y then Z),
/// scale is a factor per axis.
export interface Key {
  t: number;
  value: Vec3;
  /// How the value blends from this key to the next: straight (the default), held until the next key (`step`), or easing in,
  /// out, or both.
  ease?: Ease;
}

export type Ease = "linear" | "step" | "in" | "out" | "inout";
export const EASES: Ease[] = ["linear", "step", "in", "out", "inout"];

/// The keys of one property of one part. `part` is the chain of part names from the top, e.g. ["body", "wheel"].
export interface Track {
  part: string[];
  prop: Prop;
  keys: Key[];
}

/// A named animation. Properties a clip does not key stay as authored.
export interface Clip {
  name: string;
  duration: number;
  loop: boolean;
  tracks: Track[];
}

export interface ModelDoc {
  version: 1;
  /// Set when the model has a texture, painted in `models/<name>.texture.png` at this size.
  texture?: TextureInfo;
  /// World units per model unit when exported (1/16 makes a 16-unit cube one world unit).
  scale: number;
  parts: Part[];
  clips?: Clip[];
}

export const MAX_CLIPS = 64;
export const MAX_KEYS = 512;

/// A path to a node: part indices from the root, then optionally a cube index.
export interface Path {
  parts: number[];
  cube?: number;
}

export const DEFAULT_SCALE = 1 / 16;
export const MAX_PARTS = 512;
export const MAX_CUBES = 4096;

export const newModel = (): ModelDoc => ({
  version: 1,
  scale: DEFAULT_SCALE,
  parts: [{ name: "body", origin: [0, 0, 0], rotation: [0, 0, 0], cubes: [{ from: [-8, 0, -8], size: [16, 16, 16], color: "#c9d1d9" }], children: [] }],
});

const isVec3 = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n));
const isColor = (c: unknown) => typeof c === "string" && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(c);

/// Why a mesh element's points and polygons are not usable, or null.
function checkMesh(c: Cube, at: string): string | null {
  if (!Array.isArray(c.verts) || c.verts.length > MAX_VERTS || !c.verts.every(isVec3)) return `${at}.verts must be a list of up to ${MAX_VERTS} points, each three numbers`;
  if (!Array.isArray(c.polys) || c.polys.length > MAX_FACES) return `${at}.polys must be a list of up to ${MAX_FACES} polygons`;
  for (const [j, f] of c.polys.entries()) {
    if (!f || !Array.isArray(f.v) || f.v.length < 3 || f.v.length > 64) return `${at}.polys[${j}].v needs at least three point numbers`;
    if (!f.v.every((n) => Number.isInteger(n) && n >= 0 && n < c.verts!.length)) return `${at}.polys[${j}].v refers to a point that does not exist`;
    if (new Set(f.v).size !== f.v.length) return `${at}.polys[${j}].v uses a point twice`;
    if (f.color !== undefined && !isColor(f.color)) return `${at}.polys[${j}].color must be like #c9d1d9`;
    if (f.smooth !== undefined && typeof f.smooth !== "boolean") return `${at}.polys[${j}].smooth must be true or false`;
  }
  return null;
}

/// Why a mesh's skin is not usable, or null.
function checkSkin(c: Cube, at: string): string | null {
  const s = c.skin;
  if (!s || !Array.isArray(s.bones) || s.bones.length === 0 || s.bones.length > MAX_BONES || !s.bones.every((b) => typeof b === "string" && b.length > 0)) return `${at}.skin.bones must be a list of up to ${MAX_BONES} part names (like "body/arm")`;
  if (!Array.isArray(s.weights) || s.weights.length !== c.verts!.length) return `${at}.skin.weights needs one entry for each of the mesh's ${c.verts!.length} points`;
  for (const [i, w] of s.weights.entries()) {
    if (!Array.isArray(w) || w.length === 0 || w.length > 4) return `${at}.skin.weights[${i}] must list one to four [bone, weight] pairs`;
    let total = 0;
    for (const pair of w) {
      if (!Array.isArray(pair) || pair.length !== 2 || !Number.isInteger(pair[0]) || pair[0] < 0 || pair[0] >= s.bones.length || !(typeof pair[1] === "number" && pair[1] >= 0 && pair[1] <= 1)) return `${at}.skin.weights[${i}] has a pair that is not [bone number, weight from 0 to 1]`;
      total += pair[1];
    }
    if (Math.abs(total - 1) > 0.01) return `${at}.skin.weights[${i}] adds up to ${Math.round(total * 1000) / 1000}, not 1`;
  }
  return null;
}

/// Sets a mesh element's `from` and `size` to the box around its points.
export function fitBounds(c: Cube) {
  const v = c.verts ?? [];
  if (!v.length) {
    c.from = [0, 0, 0];
    c.size = [0, 0, 0];
    return;
  }
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of v) for (let a = 0; a < 3; a++) {
    lo[a] = Math.min(lo[a]!, p[a]!);
    hi[a] = Math.max(hi[a]!, p[a]!);
  }
  c.from = lo;
  c.size = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
}

export type Parsed = { ok: true; doc: ModelDoc } | { ok: false; error: string };

export function parseModel(text: string): Parsed {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `not valid JSON: ${e instanceof Error ? e.message : e}` };
  }
  const o = v as Partial<ModelDoc>;
  if (!o || typeof o !== "object" || !Array.isArray(o.parts)) return { ok: false, error: 'a model file has a "parts" list' };
  if (o.scale !== undefined && !(typeof o.scale === "number" && o.scale > 0 && o.scale < 1000)) return { ok: false, error: '"scale" must be a positive number' };
  if (o.texture !== undefined) {
    const size = (o.texture as Partial<TextureInfo> | null)?.size;
    const side = (n: unknown) => typeof n === "number" && Number.isInteger(n) && n >= MIN_TEXTURE && n <= MAX_TEXTURE;
    if (!Array.isArray(size) || size.length !== 2 || !size.every(side)) return { ok: false, error: `"texture.size" must be two whole numbers from ${MIN_TEXTURE} to ${MAX_TEXTURE}` };
  }
  let parts = 0;
  let cubes = 0;
  let verts = 0;
  const check = (p: unknown, at: string): string | null => {
    const part = p as Part;
    if (!part || typeof part !== "object") return `${at} must be an object`;
    if (typeof part.name !== "string" || !part.name.trim()) return `${at} needs a name`;
    if (!isVec3(part.origin)) return `${at}.origin must be three numbers`;
    if (!isVec3(part.rotation)) return `${at}.rotation must be three numbers`;
    if (!Array.isArray(part.cubes) || !Array.isArray(part.children)) return `${at} needs "cubes" and "children" lists`;
    if (++parts > MAX_PARTS) return `more than ${MAX_PARTS} parts`;
    for (const [i, c] of part.cubes.entries()) {
      if (++cubes > MAX_CUBES) return `more than ${MAX_CUBES} cubes`;
      const cat = `${at}.cubes[${i}]`;
      if (!c || typeof c !== "object") return `${cat} must be an object`;
      const shape = c.shape ?? "box";
      if (!SHAPES.includes(shape)) return `${cat}.shape must be one of ${SHAPES.join(", ")}`;
      if (!isColor(c.color)) return `${cat}.color must be like #c9d1d9`;
      for (const [f, col] of Object.entries(c.faces ?? {})) {
        if (!FACES.includes(f as Face) || !isColor(col)) return `${cat}.faces.${f} is not a face with a #rrggbb colour`;
      }
      if (c.segments !== undefined && !(Number.isInteger(c.segments) && c.segments >= MIN_SEGMENTS && c.segments <= MAX_SEGMENTS)) return `${cat}.segments must be a whole number from ${MIN_SEGMENTS} to ${MAX_SEGMENTS}`;
      if (c.smooth !== undefined && typeof c.smooth !== "boolean") return `${cat}.smooth must be true or false`;
      if (c.rotation !== undefined && !isVec3(c.rotation)) return `${cat}.rotation must be three numbers`;
      if (c.texture !== undefined) {
        const t = c.texture;
        if (!t || !Array.isArray(t.at) || t.at.length !== 2 || !t.at.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0)) return `${cat}.texture.at must be two numbers, 0 or more`;
        if (t.scale !== undefined && !(typeof t.scale === "number" && t.scale > 0 && t.scale <= 64)) return `${cat}.texture.scale must be a number above 0 and at most 64`;
        if (t.mirror !== undefined && !(Number.isInteger(t.mirror) && t.mirror >= 0 && t.mirror <= 7)) return `${cat}.texture.mirror must be a whole number from 0 to 7`;
        for (const [f, r] of Object.entries(t.faces ?? {})) {
          if (!FACES.includes(f as Face) || !Array.isArray(r) || r.length !== 4 || !r.every((n) => typeof n === "number" && Number.isFinite(n)) || r[2] === 0 || r[3] === 0 || Math.min(r[0]!, r[0]! + r[2]!) < 0 || Math.min(r[1]!, r[1]! + r[3]!) < 0) return `${cat}.texture.faces.${f} must be a face name with [x, y, width, height] in texels: a size of 0 is no use, and a negative one turns the face over`;
        }
        if (!o.texture) return `${cat} has a texture but the model has none: add "texture": { "size": [64, 64] }`;
      }
      if (shape === "mesh") {
        if (c.rotation?.some((n) => n !== 0)) return `${cat}.rotation is not used on a mesh: turn its points instead`;
        const bad = checkMesh(c, cat);
        if (bad) return bad;
        verts += c.verts!.length;
        if (verts > MAX_TOTAL_VERTS) return `more than ${MAX_TOTAL_VERTS} mesh points in all`;
        const badSkin = c.skin === undefined ? null : checkSkin(c, cat);
        if (badSkin) return badSkin;
        fitBounds(c);
      } else {
        if (c.skin !== undefined) return `${cat}.skin is only for a mesh`;
        if (!isVec3(c.from) || !isVec3(c.size)) return `${cat} needs "from" and "size" as three numbers`;
        if (c.size.some((n) => n < 0)) return `${cat}.size cannot be negative`;
      }
    }
    for (const [i, child] of part.children.entries()) {
      const bad = check(child, `${at}.children[${i}]`);
      if (bad) return bad;
    }
    return null;
  };
  for (const [i, p] of o.parts.entries()) {
    const bad = check(p, `parts[${i}]`);
    if (bad) return { ok: false, error: bad };
  }
  const clips = o.clips;
  if (clips !== undefined) {
    if (!Array.isArray(clips) || clips.length > MAX_CLIPS) return { ok: false, error: `"clips" must be a list of up to ${MAX_CLIPS}` };
    for (const [i, c] of clips.entries()) {
      const at = `clips[${i}]`;
      if (!c || typeof c.name !== "string" || !c.name.trim()) return { ok: false, error: `${at} needs a name` };
      if (!(typeof c.duration === "number" && c.duration > 0 && c.duration <= 600)) return { ok: false, error: `${at}.duration must be a number of seconds above 0` };
      if (typeof c.loop !== "boolean" || !Array.isArray(c.tracks)) return { ok: false, error: `${at} needs "loop" (true or false) and a "tracks" list` };
      for (const [j, tr] of c.tracks.entries()) {
        const tat = `${at}.tracks[${j}]`;
        if (!tr || !Array.isArray(tr.part) || tr.part.length === 0 || !tr.part.every((n) => typeof n === "string")) return { ok: false, error: `${tat}.part must be a list of part names` };
        if (!PROPS.includes(tr.prop)) return { ok: false, error: `${tat}.prop must be position, rotation or scale` };
        if (!Array.isArray(tr.keys) || tr.keys.length > MAX_KEYS) return { ok: false, error: `${tat}.keys must be a list of up to ${MAX_KEYS}` };
        let last = -1;
        for (const [k, key] of tr.keys.entries()) {
          if (!key || typeof key.t !== "number" || !(key.t >= 0) || !isVec3(key.value)) return { ok: false, error: `${tat}.keys[${k}] needs "t" (seconds) and "value" as three numbers` };
          if (key.ease !== undefined && !EASES.includes(key.ease)) return { ok: false, error: `${tat}.keys[${k}].ease must be one of ${EASES.join(", ")}` };
          if (key.t <= last) return { ok: false, error: `${tat}.keys must be in time order, one per time` };
          last = key.t;
        }
      }
    }
  }
  return { ok: true, doc: { version: 1, scale: o.scale ?? DEFAULT_SCALE, ...(o.texture ? { texture: { size: [...o.texture.size] as [number, number] } } : {}), parts: o.parts as Part[], ...(clips && clips.length ? { clips: clips as Clip[] } : {}) } };
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

export function serializeModel(doc: ModelDoc): string {
  const vec = (v: Vec3) => `[${v.join(", ")}]`;
  const vec2 = (v: number[]) => `[${v.join(", ")}]`;
  const cube = (c: Cube, indent: string) => {
    const shape = c.shape ?? "box";
    const parts = [...(c.name ? [`"name": ${JSON.stringify(c.name)}`] : [])];
    if (shape !== "box") parts.push(`"shape": "${shape}"`);
    if (shape !== "mesh") parts.push(`"from": ${vec(c.from)}`, `"size": ${vec(c.size)}`);
    if (c.rotation?.some((n) => n !== 0)) parts.push(`"rotation": ${vec(c.rotation)}`);
    if (c.segments !== undefined) parts.push(`"segments": ${c.segments}`);
    if (c.smooth === false) parts.push(`"smooth": false`);
    parts.push(`"color": "${c.color}"`);
    if (c.faces && Object.keys(c.faces).length) parts.push(`"faces": ${JSON.stringify(c.faces)}`);
    if (c.texture) parts.push(`"texture": { "at": ${vec2(c.texture.at)}${c.texture.scale !== undefined && c.texture.scale !== 1 ? `, "scale": ${c.texture.scale}` : ""}${c.texture.mirror ? `, "mirror": ${c.texture.mirror}` : ""}${c.texture.faces && Object.keys(c.texture.faces).length ? `, "faces": ${JSON.stringify(c.texture.faces)}` : ""} }`);
    if (shape === "mesh") {
      const i2 = `${indent}  `;
      const verts = (c.verts ?? []).map((p) => `${i2}  ${vec(p)}`).join(",\n");
      const polys = (c.polys ?? []).map((f) => `${i2}  ${JSON.stringify(f)}`).join(",\n");
      parts.push(`"verts": [${verts ? `\n${verts}\n${i2}` : ""}]`, `"polys": [${polys ? `\n${polys}\n${i2}` : ""}]`);
      if (c.skin) {
        const rows = c.skin.weights.map((w) => `${i2}  ${JSON.stringify(w.map(([b, x]) => [b, Math.round(x * 10000) / 10000]))}`).join(",\n");
        parts.push(`"skin": { "bones": ${JSON.stringify(c.skin.bones)}, "weights": [${rows ? `\n${rows}\n${i2}` : ""}] }`);
      }
      return `{\n${parts.map((x) => `${i2}${x}`).join(",\n")}\n${indent}}`;
    }
    return `{ ${parts.join(", ")} }`;
  };
  const part = (p: Part, indent: string): string => {
    const i2 = `${indent}  `;
    const lines = [`${i2}"name": ${JSON.stringify(p.name)}`, `${i2}"origin": ${vec(p.origin)}`, `${i2}"rotation": ${vec(p.rotation)}`];
    lines.push(p.cubes.length ? `${i2}"cubes": [\n${p.cubes.map((c) => `${i2}  ${cube(c, `${i2}  `)}`).join(",\n")}\n${i2}]` : `${i2}"cubes": []`);
    lines.push(p.children.length ? `${i2}"children": [\n${p.children.map((c) => `${i2}  ${part(c, `${i2}  `)}`).join(",\n")}\n${i2}]` : `${i2}"children": []`);
    return `{\n${lines.join(",\n")}\n${indent}}`;
  };
  const body = doc.parts.length ? `[\n${doc.parts.map((p) => `    ${part(p, "    ")}`).join(",\n")}\n  ]` : "[]";
  const clip = (c: Clip) => {
    const track = (t: Track) => `        { "part": ${JSON.stringify(t.part)}, "prop": "${t.prop}", "keys": [${t.keys.map((k) => `{ "t": ${k.t}, "value": ${vec(k.value)}${k.ease && k.ease !== "linear" ? `, "ease": "${k.ease}"` : ""} }`).join(", ")}] }`;
    const tracks = c.tracks.length ? `[\n${c.tracks.map(track).join(",\n")}\n      ]` : "[]";
    return `    {\n      "name": ${JSON.stringify(c.name)},\n      "duration": ${c.duration},\n      "loop": ${c.loop},\n      "tracks": ${tracks}\n    }`;
  };
  const clips = doc.clips?.length ? `,\n  "clips": [\n${doc.clips.map(clip).join(",\n")}\n  ]` : "";
  const texture = doc.texture ? `,\n  "texture": { "size": ${vec2(doc.texture.size)} }` : "";
  return `{\n  "version": 1,\n  "scale": ${doc.scale}${texture},\n  "parts": ${body}${clips}\n}\n`;
}

// ---- navigating and editing ----------------------------------------------------------------------

export function partAt(doc: ModelDoc, parts: number[]): Part | undefined {
  let list = doc.parts;
  let found: Part | undefined;
  for (const i of parts) {
    found = list[i];
    if (!found) return undefined;
    list = found.children;
  }
  return found;
}

export const cubeAt = (doc: ModelDoc, path: Path): Cube | undefined => (path.cube === undefined ? undefined : partAt(doc, path.parts)?.cubes[path.cube]);
export const samePath = (a: Path | null, b: Path | null) => !!a && !!b && a.cube === b.cube && a.parts.length === b.parts.length && a.parts.every((n, i) => n === b.parts[i]);

/// Every part with its path, depth first.
export function walk(doc: ModelDoc): { part: Part; parts: number[]; depth: number }[] {
  const out: { part: Part; parts: number[]; depth: number }[] = [];
  const visit = (list: Part[], prefix: number[]) =>
    list.forEach((part, i) => {
      const parts = [...prefix, i];
      out.push({ part, parts, depth: prefix.length });
      visit(part.children, parts);
    });
  visit(doc.parts, []);
  return out;
}

export function countCubes(doc: ModelDoc): number {
  return walk(doc).reduce((n, { part }) => n + part.cubes.length, 0);
}

function edit(doc: ModelDoc, parts: number[], change: (p: Part) => void): ModelDoc {
  const next = clone(doc);
  const part = partAt(next, parts);
  if (!part) return doc;
  change(part);
  return next;
}

export const uniqueSiblingName = (siblings: Part[], base: string) => {
  const used = new Set(siblings.map((p) => p.name));
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}${n}`)) n++;
  return `${base}${n}`;
};

/// A new empty part under `parent` (or at the top when `parent` is empty).
export function addPart(doc: ModelDoc, parent: number[], name = "part"): { doc: ModelDoc; path: Path } {
  if (walk(doc).length >= MAX_PARTS) return { doc, path: { parts: parent } };
  const next = clone(doc);
  const siblings = parent.length ? partAt(next, parent)?.children : next.parts;
  if (!siblings) return { doc, path: { parts: parent } };
  siblings.push({ name: uniqueSiblingName(siblings, name), origin: [0, 0, 0], rotation: [0, 0, 0], cubes: [], children: [] });
  return { doc: next, path: { parts: [...parent, siblings.length - 1] } };
}

export function addCube(doc: ModelDoc, parts: number[], cube?: Partial<Cube>): { doc: ModelDoc; path: Path } {
  if (countCubes(doc) >= MAX_CUBES || !partAt(doc, parts)) return { doc, path: { parts } };
  let index = 0;
  const next = edit(doc, parts, (p) => {
    p.cubes.push({ from: [-4, 0, -4], size: [8, 8, 8], color: "#c9d1d9", ...clone(cube ?? {}) });
    index = p.cubes.length - 1;
  });
  return { doc: next, path: { parts, cube: index } };
}

export function updateCube(doc: ModelDoc, path: Path, change: Partial<Cube>): ModelDoc {
  if (path.cube === undefined) return doc;
  return edit(doc, path.parts, (p) => {
    const c = p.cubes[path.cube!];
    if (!c) return;
    const before = { from: [...c.from] as Vec3, size: [...c.size] as Vec3 };
    Object.assign(c, clone(change));
    if (c.shape === "mesh") {
      // Moving or resizing a mesh carries its points along.
      if (change.from || change.size) remapVerts(c, before.from, before.size);
      delete c.rotation;
    } else c.size = c.size.map((n) => Math.max(0, n)) as Vec3;
  });
}

/// Maps a mesh's points from the box (from, size) it had onto the box it has now.
function remapVerts(c: Cube, from: Vec3, size: Vec3) {
  c.size = c.size.map((n) => Math.max(0, n)) as Vec3;
  c.verts = (c.verts ?? []).map((p) => p.map((x, a) => (size[a]! > 1e-9 ? c.from[a]! + ((x - from[a]!) / size[a]!) * c.size[a]! : x - from[a]! + c.from[a]!)) as Vec3);
}

/// Replaces one element with another (an edit made elsewhere, like extruding a mesh).
export function setCube(doc: ModelDoc, path: Path, cube: Cube): ModelDoc {
  if (path.cube === undefined) return doc;
  return edit(doc, path.parts, (p) => {
    if (p.cubes[path.cube!]) p.cubes[path.cube!] = clone(cube);
  });
}

/// A copy of an element moved by `d`.
export function movedCube(c: Cube, d: Vec3): Cube {
  const twin = clone(c);
  twin.from = [twin.from[0] + d[0], twin.from[1] + d[1], twin.from[2] + d[2]];
  if (twin.verts) twin.verts = twin.verts.map((p) => [p[0] + d[0], p[1] + d[1], p[2] + d[2]] as Vec3);
  return twin;
}

export function setFaceColor(doc: ModelDoc, path: Path, face: Face | "all", color: string): ModelDoc {
  if (path.cube === undefined || !isColor(color)) return doc;
  return edit(doc, path.parts, (p) => {
    const c = p.cubes[path.cube!];
    if (!c) return;
    if (face === "all") {
      c.color = color;
      delete c.faces;
    } else (c.faces ??= {})[face] = color;
  });
}

/// The chain of part names for an index path ("body", "wheel").
export function namesOf(doc: ModelDoc, parts: number[]): string[] {
  const out: string[] = [];
  let list = doc.parts;
  for (const i of parts) {
    const p = list[i];
    if (!p) break;
    out.push(p.name);
    list = p.children;
  }
  return out;
}

const startsWith = (path: string[], prefix: string[]) => prefix.length <= path.length && prefix.every((n, i) => n === path[i]);

export function updatePart(doc: ModelDoc, parts: number[], change: Partial<Pick<Part, "name" | "origin" | "rotation">>): ModelDoc {
  const before = namesOf(doc, parts);
  const out = edit(doc, parts, (p) => {
    if (change.name !== undefined && change.name.trim()) p.name = change.name.trim();
    if (change.origin) p.origin = [...change.origin];
    if (change.rotation) p.rotation = [...change.rotation];
  });
  // Tracks follow a renamed part (and everything under it).
  const after = namesOf(out, parts);
  if (out !== doc && out.clips?.length && before.at(-1) !== after.at(-1)) {
    for (const c of out.clips) for (const t of c.tracks) if (startsWith(t.part, before)) t.part = [...after, ...t.part.slice(before.length)];
  }
  return out;
}

export function removeNode(doc: ModelDoc, path: Path): ModelDoc {
  const next = clone(doc);
  if (path.cube !== undefined) {
    const p = partAt(next, path.parts);
    if (!p || !p.cubes[path.cube]) return doc;
    p.cubes.splice(path.cube, 1);
    return next;
  }
  if (path.parts.length === 0) return doc;
  const parent = path.parts.length > 1 ? partAt(next, path.parts.slice(0, -1))?.children : next.parts;
  const index = path.parts.at(-1)!;
  if (!parent?.[index]) return doc;
  const gone = namesOf(doc, path.parts);
  parent.splice(index, 1);
  // Tracks of the removed part (and its children) go with it.
  for (const c of next.clips ?? []) c.tracks = c.tracks.filter((t) => !startsWith(t.part, gone));
  return next;
}

/// A copy of a cube (nudged so it is visible) or of a whole part with its children.
export function duplicateNode(doc: ModelDoc, path: Path): { doc: ModelDoc; path: Path } | null {
  const next = clone(doc);
  if (path.cube !== undefined) {
    const p = partAt(next, path.parts);
    const c = p?.cubes[path.cube];
    if (!p || !c) return null;
    p.cubes.push(movedCube(c, [2, 0, 2]));
    return { doc: next, path: { parts: path.parts, cube: p.cubes.length - 1 } };
  }
  const part = partAt(next, path.parts);
  if (!part || path.parts.length === 0) return null;
  const siblings = path.parts.length > 1 ? partAt(next, path.parts.slice(0, -1))!.children : next.parts;
  const twin = clone(part);
  twin.name = uniqueSiblingName(siblings, part.name);
  siblings.push(twin);
  return { doc: next, path: { parts: [...path.parts.slice(0, -1), siblings.length - 1] } };
}

/// Where selection should go after a node is removed: the previous sibling, else the parent, else nothing.
export function afterRemoval(doc: ModelDoc, path: Path): Path | null {
  if (path.cube !== undefined) {
    const n = partAt(doc, path.parts)?.cubes.length ?? 0;
    return n ? { parts: path.parts, cube: Math.min(path.cube, n - 1) } : { parts: path.parts };
  }
  const parent = path.parts.slice(0, -1);
  const siblings = parent.length ? partAt(doc, parent)?.children : doc.parts;
  if (siblings?.length) return { parts: [...parent, Math.min(path.parts.at(-1)!, siblings.length - 1)] };
  return parent.length ? { parts: parent } : null;
}

export class History {
  #past: ModelDoc[] = [];
  #future: ModelDoc[] = [];
  get canUndo() {
    return this.#past.length > 0;
  }
  get canRedo() {
    return this.#future.length > 0;
  }
  record(before: ModelDoc) {
    this.#past.push(before);
    if (this.#past.length > 200) this.#past.shift();
    this.#future = [];
  }
  undo(current: ModelDoc): ModelDoc | null {
    const p = this.#past.pop();
    if (!p) return null;
    this.#future.push(current);
    return p;
  }
  redo(current: ModelDoc): ModelDoc | null {
    const n = this.#future.pop();
    if (!n) return null;
    this.#past.push(current);
    return n;
  }
}

export function hexToRgba(hex: string): [number, number, number, number] {
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, hex.length === 9 ? parseInt(hex.slice(7, 9), 16) : 255];
}

export const faceColor = (c: Cube, f: Face) => c.faces?.[f] ?? c.color;
