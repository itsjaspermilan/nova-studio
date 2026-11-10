// A menu or HUD file (`menus/<name>.menu.json`, docs/menus.md): a tree of nodes, each `{ "kind": "button", "text": "Play", "id": "play", ... }` with
// `children`. This is the studio's side of it: reading and writing the file, editing the tree (add, remove, move, wrap), what each kind may have,
// and checks in plain words. The runtime lays it out; nothing here guesses at pixels.

export type Path = number[];

export interface MenuNode {
  kind: string;
  text?: string;
  id?: string;
  children?: MenuNode[];
  [prop: string]: unknown;
}

export type PropType = "text" | "number" | "size" | "bool" | "choice";
export interface PropSpec {
  key: string;
  label: string;
  type: PropType;
  choices?: string[];
  help?: string;
}

export const ANCHORS = ["center", "top", "bottom", "left", "right", "topleft", "topright", "bottomleft", "bottomright"];
const ALIGN = ["start", "center", "end", "stretch"];
const JUSTIFY = ["start", "center", "end", "between"];
const STYLES = ["title", "heading", "body", "small", "label"];

export interface KindSpec {
  kind: string;
  title: string;
  help: string;
  /// Holds other nodes.
  container: boolean;
  /// What the second entry of the node means in a script, shown as "Text" for kinds that have one.
  text?: string;
  props: PropSpec[];
}

const size = (key: string, label: string): PropSpec => ({ key, label, type: "size", help: 'A number of units, "50%" of the room there is, or "fill"' });
const num = (key: string, label: string, help?: string): PropSpec => ({ key, label, type: "number", help });
const bool = (key: string, label: string, help?: string): PropSpec => ({ key, label, type: "bool", help });
const choice = (key: string, label: string, choices: string[], help?: string): PropSpec => ({ key, label, type: "choice", choices, help });
const txt = (key: string, label: string, help?: string): PropSpec => ({ key, label, type: "text", help });

const PLACE: PropSpec[] = [choice("anchor", "Anchor", ANCHORS, "Where it sits on the screen or inside a stack"), num("x", "Nudge x"), num("y", "Nudge y")];
const BOX: PropSpec[] = [size("w", "Width"), size("h", "Height"), num("grow", "Grow", "Share of the room left over along a row or column")];
const INSIDE: PropSpec[] = [num("gap", "Gap between"), num("pad", "Padding"), choice("align", "Align across", ALIGN), choice("justify", "Space along", JUSTIFY)];
const FOCUS: PropSpec[] = [bool("disabled", "Greyed out", "Shown dim and skipped by the focus"), bool("focusable", "Takes the focus")];

export const KINDS: KindSpec[] = [
  { kind: "column", title: "Column", help: "Children one under another", container: true, props: [...INSIDE, ...BOX, ...PLACE, num("visible", "Rows shown", "Shows this many and scrolls the rest")] },
  { kind: "row", title: "Row", help: "Children side by side", container: true, props: [...INSIDE, ...BOX, ...PLACE] },
  { kind: "grid", title: "Grid", help: "Children in columns", container: true, props: [num("columns", "Columns"), num("cell_w", "Cell width"), num("cell_h", "Cell height"), bool("flow", "Left and right step in reading order"), ...INSIDE, ...BOX, ...PLACE, num("visible", "Rows shown")] },
  { kind: "stack", title: "Stack", help: "Children on top of each other, each placed by its own anchor (a HUD)", container: true, props: [...BOX, ...PLACE] },
  { kind: "panel", title: "Panel", help: "A column on the theme's panel", container: true, props: [...INSIDE, ...BOX, ...PLACE] },
  { kind: "button", title: "Button", help: "Something to press; with an id, a script hears it", container: true, text: "Words on the button", props: [txt("value", "Value on the right"), bool("adjust", "Left and right change it"), ...FOCUS, ...BOX] },
  { kind: "text", title: "Text", help: "Words in a style of the theme", container: false, text: "The words", props: [choice("style", "Style", STYLES), num("size", "Size"), choice("align", "Align", ["left", "center", "right"]), bool("wrap", "Wrap to its width"), ...BOX, ...PLACE] },
  { kind: "image", title: "Picture", help: "A picture from sprites/", container: false, text: "Picture name", props: [num("frame", "Frame"), num("scale", "Scale"), ...BOX, ...PLACE] },
  { kind: "box", title: "Empty box", help: "A rectangle of a size that the game draws into", container: false, props: [...BOX, ...PLACE] },
  { kind: "space", title: "Space", help: "Room between things; with no size it takes the rest", container: false, props: [size("w", "Width"), size("h", "Height")] },
  { kind: "prompt", title: "Pad prompt", help: "A pad button and what it does", container: false, text: "What it does", props: [txt("button", "Button (a, b, x, y, start…)")] },
  { kind: "hints", title: "Hints row", help: "A row of pad buttons and what each does", container: false, props: [...PLACE] },
];

export const kindSpec = (kind: string): KindSpec | undefined => KINDS.find((k) => k.kind === kind);

/// The settings every kind may have beside its own (the ones people reach for most: what the script calls it, a fade and a shift).
export const COMMON: PropSpec[] = [txt("id", "Name (id)", "What a script calls it; buttons need one to be heard"), num("alpha", "Fade", "0 invisible, 1 solid"), num("dx", "Shift x while drawn"), num("dy", "Shift y while drawn")];

// ---- reading and writing ---------------------------------------------------------------------

export function parseMenu(text: string): { ok: true; root: MenuNode } | { ok: false; error: string } {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const check = (n: unknown, at: string): string | null => {
    if (!n || typeof n !== "object" || Array.isArray(n)) return `${at} must be an object`;
    const o = n as MenuNode;
    if (typeof o.kind !== "string" || !o.kind) return `${at} needs a "kind"`;
    if (o.children !== undefined) {
      if (!Array.isArray(o.children)) return `${at}.children must be a list`;
      for (const [i, c] of o.children.entries()) {
        const bad = check(c, `${at}.children[${i}]`);
        if (bad) return bad;
      }
    }
    return null;
  };
  const bad = check(v, "the menu");
  return bad ? { ok: false, error: bad } : { ok: true, root: v as MenuNode };
}

const FIRST = ["kind", "id", "text"];
/// The file text: kind, id and text first, then the other settings in a steady order, and the children last.
export function serializeMenu(root: MenuNode): string {
  const order = (n: MenuNode): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const k of FIRST) if (n[k] !== undefined) out[k] = n[k];
    for (const k of Object.keys(n).filter((k) => !FIRST.includes(k) && k !== "children").sort()) out[k] = n[k];
    if (n.children?.length) out.children = n.children.map(order);
    return out;
  };
  return `${JSON.stringify(order(root), null, 2)}\n`;
}

export function newMenu(): MenuNode {
  return {
    kind: "panel",
    id: "menu",
    anchor: "center",
    w: 360,
    children: [
      { kind: "text", text: "MY MENU", style: "heading", align: "center" },
      { kind: "button", text: "Play", id: "play" },
      { kind: "button", text: "Quit", id: "quit" },
    ],
  };
}

export function newNode(kind: string): MenuNode {
  switch (kind) {
    case "button": return { kind, text: "Button", id: "button" };
    case "text": return { kind, text: "Text", style: "body" };
    case "image": return { kind, text: "ui/icon", w: 32, h: 32 };
    case "space": return { kind, h: 16 };
    case "grid": return { kind, columns: 2, children: [] };
    case "hints": return { kind, items: [["a", "Accept"], ["b", "Back"]] };
    case "prompt": return { kind, text: "Accept", button: "a" };
    case "box": return { kind, w: 100, h: 60 };
    case "stack": return { kind, w: "100%", h: "100%", children: [] };
    default: return { kind, children: [] };
  }
}

// ---- editing the tree (each returns a new tree) -------------------------------------------------

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

export function nodeAt(root: MenuNode, path: Path): MenuNode | undefined {
  let n: MenuNode | undefined = root;
  for (const i of path) n = n?.children?.[i];
  return n;
}

const edit = (root: MenuNode, path: Path, fn: (n: MenuNode) => void): MenuNode => {
  const next = clone(root);
  const n = nodeAt(next, path);
  if (n) fn(n);
  return next;
};

/// Sets or (with undefined, null or "") removes one setting.
export function setProp(root: MenuNode, path: Path, key: string, value: unknown): MenuNode {
  if (key === "children") return root;
  return edit(root, path, (n) => {
    if (value === undefined || value === null || value === "") delete n[key];
    else n[key] = value;
    if (key === "kind" && !kindSpec(String(value))?.container && n.children && !n.children.length) delete n.children;
  });
}

export function addChild(root: MenuNode, path: Path, node: MenuNode, at?: number): { root: MenuNode; path: Path } {
  const parent = nodeAt(root, path);
  if (!parent || !(kindSpec(parent.kind)?.container ?? true)) return { root, path };
  const next = clone(root);
  const p = nodeAt(next, path)!;
  p.children ??= [];
  const index = at === undefined ? p.children.length : Math.max(0, Math.min(at, p.children.length));
  p.children.splice(index, 0, clone(node));
  return { root: next, path: [...path, index] };
}

/// A new node next to the selected one (after it), or inside it when it can hold things and `inside` is set.
export function addNear(root: MenuNode, path: Path, node: MenuNode, inside: boolean): { root: MenuNode; path: Path } {
  const sel = nodeAt(root, path);
  if (!sel) return { root, path };
  if (inside && (kindSpec(sel.kind)?.container ?? true)) return addChild(root, path, node);
  if (!path.length) return addChild(root, path, node);
  return addChild(root, path.slice(0, -1), node, path[path.length - 1]! + 1);
}

export function removeNode(root: MenuNode, path: Path): { root: MenuNode; path: Path } {
  if (!path.length) return { root, path };
  const next = clone(root);
  const parent = nodeAt(next, path.slice(0, -1))!;
  parent.children!.splice(path[path.length - 1]!, 1);
  if (!parent.children!.length) delete parent.children;
  const i = path[path.length - 1]!;
  const left = parent.children?.length ?? 0;
  return { root: next, path: left === 0 ? path.slice(0, -1) : [...path.slice(0, -1), Math.min(i, left - 1)] };
}

export function moveNode(root: MenuNode, path: Path, by: number): { root: MenuNode; path: Path } {
  if (!path.length) return { root, path };
  const i = path[path.length - 1]!;
  const parent = nodeAt(root, path.slice(0, -1));
  const j = i + by;
  if (!parent?.children || j < 0 || j >= parent.children.length) return { root, path };
  const next = clone(root);
  const list = nodeAt(next, path.slice(0, -1))!.children!;
  [list[i], list[j]] = [list[j]!, list[i]!];
  return { root: next, path: [...path.slice(0, -1), j] };
}

export function duplicateNode(root: MenuNode, path: Path): { root: MenuNode; path: Path } {
  const n = nodeAt(root, path);
  if (!n || !path.length) return { root, path };
  const copy = clone(n);
  // (an id names one thing: the copy gets a number)
  const used = new Set(allIds(root));
  const renumber = (x: MenuNode) => {
    if (x.id) {
      let id = x.id;
      let k = 2;
      while (used.has(id)) id = `${x.id}${k++}`;
      used.add(id);
      x.id = id;
    }
    x.children?.forEach(renumber);
  };
  renumber(copy);
  return addChild(root, path.slice(0, -1), copy, path[path.length - 1]! + 1);
}

/// Puts the selected node inside a new container of a kind (a row round two buttons, a panel round a column).
export function wrapIn(root: MenuNode, path: Path, kind: string): { root: MenuNode; path: Path } {
  const n = nodeAt(root, path);
  if (!n || !(kindSpec(kind)?.container ?? false)) return { root, path };
  const next = clone(root);
  const wrapper: MenuNode = { kind, children: [clone(n)] };
  if (!path.length) return { root: wrapper, path: [0] };
  const list = nodeAt(next, path.slice(0, -1))!.children!;
  list[path[path.length - 1]!] = wrapper;
  return { root: next, path: [...path, 0] };
}

/// Takes the selected container away and leaves its children where it was.
export function unwrap(root: MenuNode, path: Path): { root: MenuNode; path: Path } {
  const n = nodeAt(root, path);
  if (!n?.children?.length || !path.length) return { root, path };
  const next = clone(root);
  const list = nodeAt(next, path.slice(0, -1))!.children!;
  list.splice(path[path.length - 1]!, 1, ...clone(n.children));
  return { root: next, path };
}

// ---- checks and words ------------------------------------------------------------------------------

export function allIds(root: MenuNode): string[] {
  const out: string[] = [];
  const walk = (n: MenuNode) => {
    if (n.id) out.push(n.id);
    n.children?.forEach(walk);
  };
  walk(root);
  return out;
}

export interface Problem {
  path: Path;
  message: string;
}

/// What is wrong or likely to go wrong, in plain words, with the node it is about.
export function checkMenu(root: MenuNode): Problem[] {
  const out: Problem[] = [];
  const seen = new Map<string, Path>();
  const walk = (n: MenuNode, path: Path) => {
    const spec = kindSpec(n.kind);
    if (!spec) out.push({ path, message: `“${n.kind}” is not a kind the engine knows (use ${KINDS.map((k) => k.kind).join(", ")}).` });
    if (n.id) {
      if (seen.has(n.id)) out.push({ path, message: `The name “${n.id}” is used twice; a script cannot tell them apart.` });
      else seen.set(n.id, path);
    } else if (n.kind === "button") out.push({ path, message: "A button without an id is named by where it is, which changes when things are added. Give it an id." });
    if (spec && !spec.container && n.children?.length) out.push({ path, message: `A ${spec.title.toLowerCase()} cannot hold other things.` });
    if (n.anchor !== undefined && !ANCHORS.includes(String(n.anchor))) out.push({ path, message: `“${String(n.anchor)}” is not an anchor (use ${ANCHORS.join(", ")}).` });
    if (n.kind === "hints" && !(Array.isArray(n.items) && n.items.every((i) => Array.isArray(i) && i.length === 2 && i.every((s) => typeof s === "string")))) out.push({ path, message: "Hints need a list of [button, words] pairs." });
    for (const k of ["w", "h"]) {
      const v = n[k];
      if (v !== undefined && !(typeof v === "number" || (typeof v === "string" && (v === "fill" || /^\d+(\.\d+)?%$/.test(v))))) out.push({ path, message: `${k === "w" ? "Width" : "Height"} is a number, a percentage like "50%", or "fill".` });
    }
    n.children?.forEach((c, i) => walk(c, [...path, i]));
  };
  walk(root, []);
  return out;
}

/// One line for the outline: the kind, and the words or the name.
export function labelOf(n: MenuNode): string {
  const spec = kindSpec(n.kind);
  const what = n.text ?? n.id ?? "";
  return `${spec?.title ?? n.kind}${what ? ` · ${what.length > 28 ? `${what.slice(0, 27)}…` : what}` : ""}`;
}

/// Every node with its path and depth, in reading order (for the outline).
export function flatten(root: MenuNode): { node: MenuNode; path: Path; depth: number }[] {
  const out: { node: MenuNode; path: Path; depth: number }[] = [];
  const walk = (n: MenuNode, path: Path) => {
    out.push({ node: n, path, depth: path.length });
    n.children?.forEach((c, i) => walk(c, [...path, i]));
  };
  walk(root, []);
  return out;
}
