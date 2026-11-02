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
const KEY_ORDER = ["version", "background", "width", "height", "objects", "images", "texts", "tilemaps", "kind", "image", "text", "name", "x", "y", "z", "scale", "depth", "layer", "color", "props"];

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

export function boundsOf(scene: Scene, ref: Ref, sizes: Sizes): Box {
  const item = itemAt(scene, ref);
  if (!item) return { x: 0, y: 0, w: 0, h: 0 };
  if (ref.kind === "objects") return { x: item.x, y: item.y, w: OBJECT_BOX, h: OBJECT_BOX };
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
export function hitTest(scene: Scene, x: number, y: number, sizes: Sizes): Ref | null {
  const order = drawOrder(scene);
  for (let i = order.length - 1; i >= 0; i--) {
    const b = boundsOf(scene, order[i]!, sizes);
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
