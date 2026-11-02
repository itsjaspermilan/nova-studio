// The model editor's data: a tree of parts, each holding coloured cubes. It is saved as
// `models/<name>.model.json` and exported to the `.glb` the game loads. One unit is one
// "pixel" of the model; `scale` converts units to the game's world units on export.

export type Vec3 = [number, number, number];
export type Face = "east" | "west" | "up" | "down" | "south" | "north";
export const FACES: Face[] = ["east", "west", "up", "down", "south", "north"];

export interface Cube {
  name?: string;
  /// Corner with the smallest x, y, z, in the part's own space.
  from: Vec3;
  size: Vec3;
  /// Colour of all faces, `#rrggbb` or `#rrggbbaa`.
  color: string;
  /// Colours of individual faces, overriding `color`.
  faces?: Partial<Record<Face, string>>;
}

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
}

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
  let parts = 0;
  let cubes = 0;
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
      if (!c || !isVec3(c.from) || !isVec3(c.size)) return `${at}.cubes[${i}] needs "from" and "size" as three numbers`;
      if (c.size.some((n) => n < 0)) return `${at}.cubes[${i}].size cannot be negative`;
      if (!isColor(c.color)) return `${at}.cubes[${i}].color must be like #c9d1d9`;
      for (const [f, col] of Object.entries(c.faces ?? {})) {
        if (!FACES.includes(f as Face) || !isColor(col)) return `${at}.cubes[${i}].faces.${f} is not a face with a #rrggbb colour`;
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
          if (key.t <= last) return { ok: false, error: `${tat}.keys must be in time order, one per time` };
          last = key.t;
        }
      }
    }
  }
  return { ok: true, doc: { version: 1, scale: o.scale ?? DEFAULT_SCALE, parts: o.parts as Part[], ...(clips && clips.length ? { clips: clips as Clip[] } : {}) } };
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

export function serializeModel(doc: ModelDoc): string {
  const vec = (v: Vec3) => `[${v.join(", ")}]`;
  const cube = (c: Cube) => {
    const parts = [...(c.name ? [`"name": ${JSON.stringify(c.name)}`] : []), `"from": ${vec(c.from)}`, `"size": ${vec(c.size)}`, `"color": "${c.color}"`];
    if (c.faces && Object.keys(c.faces).length) parts.push(`"faces": ${JSON.stringify(c.faces)}`);
    return `{ ${parts.join(", ")} }`;
  };
  const part = (p: Part, indent: string): string => {
    const i2 = `${indent}  `;
    const lines = [`${i2}"name": ${JSON.stringify(p.name)}`, `${i2}"origin": ${vec(p.origin)}`, `${i2}"rotation": ${vec(p.rotation)}`];
    lines.push(p.cubes.length ? `${i2}"cubes": [\n${p.cubes.map((c) => `${i2}  ${cube(c)}`).join(",\n")}\n${i2}]` : `${i2}"cubes": []`);
    lines.push(p.children.length ? `${i2}"children": [\n${p.children.map((c) => `${i2}  ${part(c, `${i2}  `)}`).join(",\n")}\n${i2}]` : `${i2}"children": []`);
    return `{\n${lines.join(",\n")}\n${indent}}`;
  };
  const body = doc.parts.length ? `[\n${doc.parts.map((p) => `    ${part(p, "    ")}`).join(",\n")}\n  ]` : "[]";
  const clip = (c: Clip) => {
    const track = (t: Track) => `        { "part": ${JSON.stringify(t.part)}, "prop": "${t.prop}", "keys": [${t.keys.map((k) => `{ "t": ${k.t}, "value": ${vec(k.value)} }`).join(", ")}] }`;
    const tracks = c.tracks.length ? `[\n${c.tracks.map(track).join(",\n")}\n      ]` : "[]";
    return `    {\n      "name": ${JSON.stringify(c.name)},\n      "duration": ${c.duration},\n      "loop": ${c.loop},\n      "tracks": ${tracks}\n    }`;
  };
  const clips = doc.clips?.length ? `,\n  "clips": [\n${doc.clips.map(clip).join(",\n")}\n  ]` : "";
  return `{\n  "version": 1,\n  "scale": ${doc.scale},\n  "parts": ${body}${clips}\n}\n`;
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

const uniqueSiblingName = (siblings: Part[], base: string) => {
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
    Object.assign(c, clone(change));
    c.size = c.size.map((n) => Math.max(0, n)) as Vec3;
  });
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
    const twin = clone(c);
    twin.from = [twin.from[0] + 2, twin.from[1], twin.from[2] + 2];
    p.cubes.push(twin);
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
