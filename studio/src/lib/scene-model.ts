// The scene editor's data model: a parsed `*.scene.json` plus pure edit operations.
// Every edit returns a new scene so undo is just keeping the old one. Unknown or unedited parts
// (tilemaps, props, future keys) pass through untouched.

export type ItemKind = "objects" | "images" | "texts";
export interface Ref {
  kind: ItemKind;
  index: number;
}
export type Item = Record<string, unknown> & { x: number; y: number };
export interface Scene {
  version: number;
  background?: number[];
  width?: number;
  height?: number;
  objects?: Item[];
  images?: Item[];
  texts?: Item[];
  [key: string]: unknown;
}
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
/// Natural pixel sizes of images by project path, once they have loaded.
export type Sizes = ReadonlyMap<string, { w: number; h: number }>;
/// What is known about an entity kind's picture: its size on screen units and where its pivot sits (fractions).
export interface KindInfo {
  w: number;
  h: number;
  px: number;
  py: number;
}
export type Kinds = ReadonlyMap<string, KindInfo>;

export const DEFAULT_WORLD = { width: 960, height: 540 };
export const OBJECT_BOX = 32;
const KINDS: ItemKind[] = ["objects", "images", "texts"];

export type Parsed = { ok: true; scene: Scene } | { ok: false; error: string };

export function parseScene(text: string): Parsed {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `not valid JSON: ${e instanceof Error ? e.message : e}` };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "a scene file is a JSON object" };
  const scene = value as Scene;
  for (const kind of KINDS) {
    const list = scene[kind];
    if (list === undefined) continue;
    if (!Array.isArray(list)) return { ok: false, error: `"${kind}" must be a list` };
    for (const [i, item] of list.entries()) {
      if (!item || typeof item !== "object" || typeof (item as Item).x !== "number" || typeof (item as Item).y !== "number") {
        return { ok: false, error: `${kind}[${i}] needs numeric "x" and "y"` };
      }
    }
  }
  return { ok: true, scene };
}

/// Key order the runtime docs use, so saved files stay tidy and diff well.
const KEY_ORDER = ["version", "background", "width", "height", "camera", "objects", "images", "texts", "tilemaps", "kind", "image", "text", "name", "x", "y", "z", "scale", "depth", "layer", "color", "props"];

const isPrimitive = (v: unknown) => v === null || typeof v !== "object";
const inline = (v: unknown): string => (Array.isArray(v) ? `[${v.map(inline).join(", ")}]` : JSON.stringify(v));

function write(value: unknown, indent: string, top: boolean): string {
  if (isPrimitive(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    // Lists of numbers, and rows of numbers (tile maps), stay compact.
    if (value.every((v) => isPrimitive(v) || (Array.isArray(v) && v.every(isPrimitive))) && value.every(isPrimitive)) return inline(value);
    const inner = `${indent}  `;
    return `[\n${value.map((v) => inner + (Array.isArray(v) && v.every(isPrimitive) ? inline(v) : write(v, inner, false))).join(",\n")}\n${indent}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
  entries.sort(([a], [b]) => {
    const rank = (k: string) => (KEY_ORDER.includes(k) ? KEY_ORDER.indexOf(k) : KEY_ORDER.length);
    return rank(a) - rank(b);
  });
  if (entries.length === 0) return "{}";
  // Small leaf objects (one scene item) sit on one line; the top level and containers are expanded.
  const compact = !top && entries.every(([, v]) => isPrimitive(v) || (Array.isArray(v) && v.every(isPrimitive)) || (typeof v === "object" && v !== null && !Array.isArray(v) && Object.values(v).every(isPrimitive)));
  if (compact) {
    const body = entries.map(([k, v]) => `${JSON.stringify(k)}: ${isPrimitive(v) ? JSON.stringify(v) : Array.isArray(v) ? inline(v) : write(v, "", false)}`).join(", ");
    if (body.length <= 100) return `{ ${body} }`;
  }
  const inner = `${indent}  `;
  return `{\n${entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${write(v, inner, false)}`).join(",\n")}\n${indent}}`;
}

export function serializeScene(scene: Scene): string {
  return `${write(scene, "", true)}\n`;
}

export const worldSize = (scene: Scene) => ({ width: scene.width ?? DEFAULT_WORLD.width, height: scene.height ?? DEFAULT_WORLD.height });

export function itemAt(scene: Scene, ref: Ref): Item | undefined {
  return scene[ref.kind]?.[ref.index];
}

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

export function boundsOf(scene: Scene, ref: Ref, sizes: Sizes, kinds?: Kinds): Box {
  const item = itemAt(scene, ref);
  if (!item) return { x: 0, y: 0, w: 0, h: 0 };
  if (ref.kind === "objects") {
    // An entity with a sprite occupies the sprite's size around its pivot (centred unless it has one).
    const k = kinds?.get(String(item.kind));
    return k ? { x: item.x - k.px * k.w, y: item.y - k.py * k.h, w: k.w, h: k.h } : { x: item.x, y: item.y, w: OBJECT_BOX, h: OBJECT_BOX };
  }
  if (ref.kind === "images") {
    const size = sizes.get(String(item.image)) ?? { w: OBJECT_BOX, h: OBJECT_BOX };
    const scale = num(item.scale, 1);
    return { x: item.x, y: item.y, w: size.w * scale, h: size.h * scale };
  }
  const scale = num(item.scale, 1);
  const text = String(item.text ?? "");
  const lines = text.split("\n");
  const longest = Math.max(1, ...lines.map((l) => l.length));
  return { x: item.x, y: item.y, w: longest * 8 * scale, h: lines.length * 8 * scale };
}

/// Everything in draw order, back to front: world images, objects, then UI images and text.
export function drawOrder(scene: Scene): Ref[] {
  const refs: Ref[] = [];
  const images = (scene.images ?? []).map((item, index) => ({ item, ref: { kind: "images" as const, index } }));
  const layer = (name: string) => images.filter(({ item }) => (item.layer ?? "world") === name).sort((a, b) => num(b.item.depth, 0) - num(a.item.depth, 0));
  refs.push(...layer("world").map((i) => i.ref));
  (scene.objects ?? []).forEach((_, index) => refs.push({ kind: "objects", index }));
  refs.push(...layer("ui").map((i) => i.ref));
  (scene.texts ?? []).forEach((_, index) => refs.push({ kind: "texts", index }));
  return refs;
}

/// The topmost item under a world point.
export function hitTest(scene: Scene, x: number, y: number, sizes: Sizes, kinds?: Kinds): Ref | null {
  const order = drawOrder(scene);
  for (let i = order.length - 1; i >= 0; i--) {
    const b = boundsOf(scene, order[i]!, sizes, kinds);
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return order[i]!;
  }
  return null;
}

// Scenes are plain JSON, and JSON round-trips also copy reactive proxies, which structuredClone rejects.
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const clone = (scene: Scene): Scene => copy(scene);

export function snap(value: number, grid: number): number {
  return grid > 0 ? Math.round(value / grid) * grid : Math.round(value);
}

export function moveTo(scene: Scene, ref: Ref, x: number, y: number): Scene {
  const next = clone(scene);
  const item = itemAt(next, ref);
  if (item) {
    item.x = x;
    item.y = y;
  }
  return next;
}

export function setField(scene: Scene, ref: Ref, key: string, value: unknown): Scene {
  const next = clone(scene);
  const item = itemAt(next, ref);
  if (!item) return scene;
  if (value === undefined || value === "" || value === null) delete item[key];
  else item[key] = value;
  return next;
}

/// The 3D camera a scene starts with (the runtime's defaults when the scene says nothing).
export interface Camera3 {
  eye: [number, number, number];
  target: [number, number, number];
  fov: number;
}
export const DEFAULT_CAMERA3: Camera3 = { eye: [0, 6, 12], target: [0, 0, 0], fov: 60 };
export const cameraOf = (scene: Scene): Camera3 => {
  const c = scene.camera as Partial<Camera3> | undefined;
  const point = (p: unknown, fallback: [number, number, number]): [number, number, number] =>
    Array.isArray(p) && p.length === 3 && p.every((n) => typeof n === "number" && Number.isFinite(n)) ? [p[0], p[1], p[2]] : fallback;
  return { eye: point(c?.eye, DEFAULT_CAMERA3.eye), target: point(c?.target, DEFAULT_CAMERA3.target), fov: typeof c?.fov === "number" && c.fov >= 10 && c.fov <= 150 ? c.fov : DEFAULT_CAMERA3.fov };
};
/// Gives the scene a 3D camera (or, with undefined, none).
export function setCamera(scene: Scene, camera: Camera3 | undefined): Scene {
  const next = clone(scene);
  if (!camera) delete next.camera;
  else next.camera = { eye: [...camera.eye], target: [...camera.target], fov: Math.min(150, Math.max(10, camera.fov)) };
  return next;
}

/// Where an object stands in 3D: x across, y up, z towards the viewer.
export const positionOf = (item: Item): [number, number, number] => [item.x, item.y, typeof item.z === "number" ? item.z : 0];
export function moveTo3(scene: Scene, ref: Ref, p: [number, number, number]): Scene {
  const next = clone(scene);
  const item = itemAt(next, ref);
  if (!item || !p.every(Number.isFinite)) return scene;
  [item.x, item.y] = [p[0], p[1]];
  if (p[2] === 0) delete item.z;
  else item.z = p[2];
  return next;
}

export function setSceneField(scene: Scene, key: "background" | "width" | "height", value: number[] | number | undefined): Scene {
  const next = clone(scene);
  if (value === undefined) delete next[key];
  else (next as Record<string, unknown>)[key] = value;
  return next;
}

/// A name that no object, image or text in the scene uses yet: `crate`, `crate2`, `crate3`...
export function uniqueName(scene: Scene, base: string): string {
  const clean = base.replace(/[^A-Za-z0-9_]/g, "_").replace(/^[^A-Za-z]+/, "") || "item";
  const used = new Set(KEYS_WITH_NAMES(scene));
  if (!used.has(clean)) return clean;
  let n = 2;
  while (used.has(`${clean}${n}`)) n++;
  return `${clean}${n}`;
}
const KEYS_WITH_NAMES = (scene: Scene): string[] => {
  const names: string[] = [];
  for (const kind of [...KINDS, "tilemaps"] as const) {
    for (const item of (scene[kind] as Record<string, unknown>[] | undefined) ?? []) if (typeof item.name === "string") names.push(item.name);
  }
  return names;
};

export function addItem(scene: Scene, kind: ItemKind, item: Item): { scene: Scene; ref: Ref } {
  const next = clone(scene);
  const list = (next[kind] ??= []);
  list.push(item);
  return { scene: next, ref: { kind, index: list.length - 1 } };
}

export function removeItem(scene: Scene, ref: Ref): Scene {
  const next = clone(scene);
  const list = next[ref.kind];
  if (list) {
    list.splice(ref.index, 1);
    if (list.length === 0) delete next[ref.kind];
  }
  return next;
}

export function duplicateItem(scene: Scene, ref: Ref, offset = 16): { scene: Scene; ref: Ref } | null {
  const item = itemAt(scene, ref);
  if (!item) return null;
  const twin = copy(item);
  twin.x += offset;
  twin.y += offset;
  if (typeof twin.name === "string") twin.name = uniqueName(scene, twin.name);
  return addItem(scene, ref.kind, twin);
}

export function sameRef(a: Ref | null, b: Ref | null): boolean {
  return !!a && !!b && a.kind === b.kind && a.index === b.index;
}

/// Where a removed item's selection should go afterwards: the same kind, one earlier (or none).
export function afterRemoval(scene: Scene, ref: Ref): Ref | null {
  const remaining = scene[ref.kind]?.length ?? 0;
  return remaining === 0 ? null : { kind: ref.kind, index: Math.min(ref.index, remaining - 1) };
}

export class History {
  #past: Scene[] = [];
  #future: Scene[] = [];
  get canUndo() {
    return this.#past.length > 0;
  }
  get canRedo() {
    return this.#future.length > 0;
  }
  /// Remember `before` as the state to return to; any redo history is dropped.
  record(before: Scene) {
    this.#past.push(before);
    if (this.#past.length > 200) this.#past.shift();
    this.#future = [];
  }
  undo(current: Scene): Scene | null {
    const previous = this.#past.pop();
    if (!previous) return null;
    this.#future.push(current);
    return previous;
  }
  redo(current: Scene): Scene | null {
    const next = this.#future.pop();
    if (!next) return null;
    this.#past.push(current);
    return next;
  }
  clear() {
    this.#past = [];
    this.#future = [];
  }
}

// ---- properties of objects ---------------------------------------------------------------------

export type PropValue = string | number | boolean;

/// What a person typed into a property box: a number, true/false, or text (put quotes round
/// something that looks like a number to keep it text).
export function parsePropValue(raw: string): PropValue {
  const t = raw.trim();
  if (/^-?(\d+\.?\d*|\.\d+)$/.test(t)) return Number(t);
  if (t === "true") return true;
  if (t === "false") return false;
  if (t.length >= 2 && (t[0] === '"' || t[0] === "'") && t.at(-1) === t[0]) return t.slice(1, -1);
  return raw;
}

export function showPropValue(v: unknown): string {
  return typeof v === "string" ? (parsePropValue(v) === v ? v : JSON.stringify(v)) : JSON.stringify(v);
}

/// The simple (text, number, true/false) properties of an object; nested tables are left to the JSON view.
export function propsOf(scene: Scene, ref: Ref): { key: string; value: unknown; simple: boolean }[] {
  const props = itemAt(scene, ref)?.props;
  if (!props || typeof props !== "object") return [];
  return Object.entries(props as Record<string, unknown>).map(([key, value]) => ({ key, value, simple: ["string", "number", "boolean"].includes(typeof value) }));
}

/// Sets, changes or (with undefined) removes a property; an empty `props` is dropped.
export function setProp(scene: Scene, ref: Ref, key: string, value: PropValue | undefined): Scene {
  const next = clone(scene);
  const item = itemAt(next, ref);
  if (!item || !key.trim()) return scene;
  const props = { ...((item.props as Record<string, unknown> | undefined) ?? {}) };
  if (value === undefined) delete props[key];
  else props[key] = value;
  if (Object.keys(props).length === 0) delete item.props;
  else item.props = props;
  return next;
}

export function renameProp(scene: Scene, ref: Ref, from: string, to: string): Scene {
  const item = itemAt(scene, ref);
  const props = item?.props as Record<string, unknown> | undefined;
  const name = to.trim();
  if (!props || !(from in props) || !name || name === from || name in props) return scene;
  const next = clone(scene);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries((itemAt(next, ref)!.props as Record<string, unknown>))) out[k === from ? name : k] = v;
  itemAt(next, ref)!.props = out;
  return next;
}

// ---- tile maps ---------------------------------------------------------------------------------

export interface Tilemap {
  name?: string;
  tileset: { image: string; tile_width: number; tile_height: number };
  x?: number;
  y?: number;
  depth?: number;
  solid?: number[];
  tiles: number[][];
  [key: string]: unknown;
}
export const EMPTY_TILE = -1;
export const MAX_MAP_SIDE = 1000;

export const tilemaps = (scene: Scene): Tilemap[] => (Array.isArray(scene.tilemaps) ? (scene.tilemaps as Tilemap[]) : []);

export function mapSize(m: Tilemap): { cols: number; rows: number } {
  return { cols: Math.max(0, ...m.tiles.map((r) => r.length)), rows: m.tiles.length };
}

/// The grid cell under a world point, or null outside the map.
export function cellAt(m: Tilemap, x: number, y: number): { col: number; row: number } | null {
  const { cols, rows } = mapSize(m);
  const col = Math.floor((x - (m.x ?? 0)) / m.tileset.tile_width);
  const row = Math.floor((y - (m.y ?? 0)) / m.tileset.tile_height);
  return col >= 0 && row >= 0 && col < cols && row < rows ? { col, row } : null;
}

export function tilemapBox(m: Tilemap): Box {
  const { cols, rows } = mapSize(m);
  return { x: m.x ?? 0, y: m.y ?? 0, w: cols * m.tileset.tile_width, h: rows * m.tileset.tile_height };
}

/// An empty map, named uniquely, appended to the scene.
export function addTilemap(scene: Scene, image: string, tileW: number, tileH: number, cols: number, rows: number): { scene: Scene; index: number } {
  const next = clone(scene);
  const c = Math.max(1, Math.min(MAX_MAP_SIDE, Math.floor(cols)));
  const r = Math.max(1, Math.min(MAX_MAP_SIDE, Math.floor(rows)));
  const map: Tilemap = {
    name: uniqueName(scene, "ground"),
    tileset: { image, tile_width: tileW, tile_height: tileH },
    x: 0,
    y: 0,
    depth: 100,
    solid: [],
    tiles: Array.from({ length: r }, () => Array(c).fill(EMPTY_TILE)),
  };
  const list = (next.tilemaps = [...tilemaps(next), map]);
  return { scene: next, index: list.length - 1 };
}

/// Makes the grid exactly `cols` by `rows`, keeping what fits and filling new cells with empty.
export function resizeTilemap(scene: Scene, index: number, cols: number, rows: number): Scene {
  if (!tilemaps(scene)[index]) return scene;
  const next = clone(scene);
  const m = tilemaps(next)[index]!;
  const c = Math.max(1, Math.min(MAX_MAP_SIDE, Math.floor(cols)));
  const r = Math.max(1, Math.min(MAX_MAP_SIDE, Math.floor(rows)));
  m.tiles = Array.from({ length: r }, (_, y) => Array.from({ length: c }, (_, x) => m.tiles[y]?.[x] ?? EMPTY_TILE));
  return next;
}

/// Sets one cell; painting past the right or bottom edge grows the map.
export function paintTile(scene: Scene, index: number, col: number, row: number, tile: number): Scene {
  const current = tilemaps(scene)[index];
  if (!current || col < 0 || row < 0 || col >= MAX_MAP_SIDE || row >= MAX_MAP_SIDE) return scene;
  const { cols, rows } = mapSize(current);
  let next = col >= cols || row >= rows ? resizeTilemap(scene, index, Math.max(cols, col + 1), Math.max(rows, row + 1)) : clone(scene);
  const m = tilemaps(next)[index]!;
  if (m.tiles[row]![col] === tile) return next === scene ? scene : next;
  m.tiles[row]![col] = tile;
  return next;
}

/// Replaces the connected run of the same tile (4-way) with `tile`.
export function fillTiles(scene: Scene, index: number, col: number, row: number, tile: number): Scene {
  const current = tilemaps(scene)[index];
  const target = current?.tiles[row]?.[col];
  if (!current || target === undefined || target === tile) return scene;
  const next = clone(scene);
  const m = tilemaps(next)[index]!;
  const stack: [number, number][] = [[col, row]];
  while (stack.length) {
    const [c, r] = stack.pop()!;
    if (m.tiles[r]?.[c] !== target) continue;
    m.tiles[r]![c] = tile;
    stack.push([c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]);
  }
  return next;
}

/// Adds or removes a tile number from the map's solid list (what `slide()` and `solid_at` treat as walls).
export function toggleSolid(scene: Scene, index: number, tile: number): Scene {
  if (!tilemaps(scene)[index] || tile < 0) return scene;
  const next = clone(scene);
  const m = tilemaps(next)[index]!;
  const solid = new Set(m.solid ?? []);
  if (!solid.delete(tile)) solid.add(tile);
  m.solid = [...solid].sort((a, b) => a - b);
  return next;
}

export function removeTilemap(scene: Scene, index: number): Scene {
  if (!tilemaps(scene)[index]) return scene;
  const next = clone(scene);
  const list = tilemaps(next);
  list.splice(index, 1);
  if (list.length === 0) delete next.tilemaps;
  return next;
}

// ---- placing scenery in a 3D level ------------------------------------------------------------------------------------

/// `count` points spread evenly over a disc (radius 0 gives its centre), from random numbers 0 to 1.
export function scatterPoints(centre: [number, number], radius: number, count: number, rng: () => number): [number, number][] {
  if (radius <= 0 || count <= 1) return [[centre[0], centre[1]]];
  return Array.from({ length: Math.min(count, 200) }, () => {
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(rng()) * radius;
    return [centre[0] + Math.cos(a) * d, centre[1] + Math.sin(a) * d] as [number, number];
  });
}

/// Puts a kind of object on the ground (y = 0) at each (x, z). `vary` gives each a random turn and a size of 0.8 to 1.3, so a
/// stand of trees does not look stamped. Returns the new scene and the objects' places in the list.
export function placeObjects(scene: Scene, kind: string, points: [number, number][], rng: () => number, vary = true): { scene: Scene; indexes: number[] } {
  const next = clone(scene);
  const list = (next.objects ??= []);
  const indexes: number[] = [];
  const r1 = (n: number) => Math.round(n * 10) / 10;
  for (const [x, z] of points) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    const item: Item = { kind, x: r1(x), y: 0 };
    if (z !== 0) item.z = r1(z);
    if (vary) item.props = { ry: Math.round(rng() * Math.PI * 2 * 1000) / 1000, sx: Math.round((0.8 + rng() * 0.5) * 100) / 100 };
    indexes.push(list.push(item) - 1);
  }
  return { scene: next, indexes };
}

/// Removes the objects standing within `radius` of the ground point (x, z) (at least 1 m, so a click can pick off one).
/// `kinds` limits it to those kinds; null takes anything. Returns the new scene and how many went.
export function eraseNear(scene: Scene, at: [number, number], radius: number, kinds: ReadonlySet<string> | null): { scene: Scene; removed: number } {
  const reach = Math.max(1, radius);
  const keep = (scene.objects ?? []).filter((o) => {
    if (kinds && !kinds.has(String(o.kind))) return true;
    const [x, , z] = positionOf(o);
    return Math.hypot(x - at[0], z - at[1]) > reach;
  });
  const removed = (scene.objects ?? []).length - keep.length;
  if (!removed) return { scene, removed: 0 };
  const next = clone(scene);
  next.objects = keep.map((o) => ({ ...o }));
  return { scene: next, removed };
}

/// The ground points that are not on a road: more than `clear` metres from every object whose kind has "road" in its name
/// (road pieces are placed along a circuit, so this keeps trees and rocks off the tarmac while painting).
export function offRoad(scene: Scene, points: [number, number][], clear = 8): [number, number][] {
  const road = (scene.objects ?? []).filter((o) => String(o.kind).includes("road")).map((o) => positionOf(o));
  if (!road.length) return points;
  const near2 = clear * clear;
  return points.filter(([x, z]) => !road.some((r) => (r[0] - x) ** 2 + (r[2] - z) ** 2 < near2));
}
