// What the studio can learn about an entity class by reading its Lua file, without running it: which
// sprite it uses and its pivot, following `nova.entity(require("entities.parent"), { ... })` up the chain.
// This is a best-effort reading of the common shapes, not a Lua parser; anything it cannot tell is left out.
// Its `settings` (typed fields a scene may set, see entity-settings.ts) are read with a small reader of plain Lua tables.

import { mergeSettings, settingsOf, type Setting } from "./entity-settings";
import { parseLuaTable, toJson } from "./lua-table";

export interface EntityLook {
  sprite?: string;
  /// A 3D model: `models/<name>.glb`, drawn in the scene's 3D view.
  model?: string;
  pivot?: [number, number];
  /// The sprite's drawn size per pixel (`sx`, `sy` in the spec): 0.5 for a picture made at twice the size it is shown.
  scale?: [number, number];
  screen?: boolean;
  /// The settings a scene may give it, with the parent's, in the order written.
  settings?: Setting[];
}

/// The table literal handed to `nova.entity`, as text, or null when the file has none.
function specOf(source: string): { spec: string; parent?: string } | null {
  const clean = source.replace(/--\[\[[\s\S]*?\]\]/g, "").replace(/--[^\n]*/g, "");
  const call = /nova\.entity\s*(\(\s*require\s*\(\s*["']([\w.]+)["']\s*\)\s*,\s*)?(\(\s*)?\{/.exec(clean);
  if (!call) return null;
  const start = clean.indexOf("{", call.index);
  let depth = 0;
  for (let i = start; i < clean.length; i++) {
    if (clean[i] === "{") depth++;
    else if (clean[i] === "}" && --depth === 0) return { spec: clean.slice(start + 1, i), parent: call[2] };
  }
  return null;
}

/// Top-level `key = value` text in a table body (nested tables are skipped).
function topLevel(spec: string): string {
  let depth = 0;
  let out = "";
  for (const ch of spec) {
    if (ch === "{") depth++;
    if (depth === 0) out += ch;
    else if (ch === "}") depth--;
    if (ch === "}" && depth === 0) out += "}";
  }
  return out;
}

/// What one file says, before its parent is looked at: `fields` are the spec's plain values (a child's `speed = 80` is a new
/// default for the parent's setting).
export function parseEntitySource(source: string): { look: EntityLook; parent?: string; fields?: Record<string, unknown> } | null {
  const found = specOf(source);
  if (!found) return null;
  const look: EntityLook = {};
  const sprite = /\bsprite\s*=\s*["']([^"']+)["']/.exec(topLevel(found.spec));
  if (sprite) look.sprite = sprite[1];
  const model = /\bmodel\s*=\s*["']([^"']+)["']/.exec(topLevel(found.spec));
  if (model) look.model = model[1];
  const pivot = /\bpivot\s*=\s*\{\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\}/.exec(found.spec);
  if (pivot) look.pivot = [Number(pivot[1]), Number(pivot[2])];
  const sx = /\bsx\s*=\s*([\d.]+)/.exec(topLevel(found.spec));
  const sy = /\bsy\s*=\s*([\d.]+)/.exec(topLevel(found.spec));
  if (sx || sy) look.scale = [Number((sx ?? sy)![1]), Number((sy ?? sx)![1])];
  const screen = /\bscreen\s*=\s*(true|false)/.exec(topLevel(found.spec));
  if (screen) look.screen = screen[1] === "true";
  const table = parseLuaTable(`{${found.spec}}`);
  const settings = table ? settingsOf(table) : undefined;
  if (settings) look.settings = settings;
  const fields: Record<string, unknown> = {};
  for (const [k, v] of table?.fields ?? []) if (k !== "settings") { const j = toJson(v); if (j !== undefined) fields[k] = j; }
  return Object.keys(fields).length ? { look, parent: found.parent, fields } : { look, parent: found.parent };
}

/// `enemies.grub` is `entities/enemies/grub.lua`.
export const entityPath = (kind: string) => `entities/${kind.replaceAll(".", "/")}.lua`;

/// The look of an entity kind, taking what a parent class provides for anything the child leaves out.
export async function resolveEntity(kind: string, read: (path: string) => Promise<string | null>, depth = 0): Promise<EntityLook> {
  if (depth > 5) return {};
  const source = await read(entityPath(kind));
  const parsed = source ? parseEntitySource(source) : null;
  if (!parsed) return {};
  const inherited = parsed.parent ? await resolveEntity(parsed.parent.replace(/^entities\./, ""), read, depth + 1) : {};
  const look: EntityLook = { ...inherited, ...parsed.look };
  const settings = mergeSettings(inherited.settings, parsed.look.settings, parsed.fields);
  if (settings) look.settings = settings;
  return look;
}
