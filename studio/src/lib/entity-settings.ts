// An entity's typed settings, as its Lua file declares them (`settings = { speed = { 4, min = 0, max = 10 } }`), read the
// way the framework reads them (crates/nova-runtime/lua/framework.lua, `declare_setting`), so the scene editor's
// inspector can show a slider, a colour picker or a list instead of a plain box.

import { isTable, toJson, UNKNOWN, type LuaTable, type LuaValue } from "./lua-table";

export type SettingType = "number" | "boolean" | "text" | "choice" | "colour" | "vector" | "object" | "sprite" | "sound" | "music" | "model";

export interface Setting {
  name: string;
  type: SettingType;
  /// The default as JSON (a colour as "#rrggbb"); undefined when none is given (an object reference left empty).
  default?: unknown;
  min?: number;
  max?: number;
  step?: number;
  choices?: (string | number)[];
  help?: string;
  /// How many numbers a vector has (2 to 4).
  size?: number;
  /// What is wrong with the declaration, if anything (the game stops with the same complaint).
  problem?: string;
}

const TYPES: SettingType[] = ["number", "boolean", "text", "choice", "colour", "vector", "object", "sprite", "sound", "music", "model"];
const KEYS = new Set(["type", "min", "max", "step", "choices", "help"]);

const hex2 = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");

/// "#f80", "#ff8800", "#ff8800cc" or [255, 136, 0(, 204)] as [r, g, b(, a)]; null when it is not a colour.
export function colourOf(v: unknown): number[] | null {
  if (typeof v === "string") {
    let h = /^#([0-9a-fA-F]+)$/.exec(v)?.[1];
    if (!h) return null;
    if (h.length === 3) h = [...h].map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    return h.match(/../g)!.map((x) => parseInt(x, 16));
  }
  if (Array.isArray(v) && (v.length === 3 || v.length === 4) && v.every((x) => typeof x === "number")) return v.map((x) => Math.max(0, Math.min(255, x)));
  return null;
}

/// A colour as "#rrggbb" (with alpha when it has one below 255), for the colour picker and for writing.
export const colourHex = (rgba: number[]) => `#${rgba.slice(0, 3).map(hex2).join("")}${rgba.length > 3 && rgba[3]! < 255 ? hex2(rgba[3]!) : ""}`;

/// One setting from its Lua declaration (a table whose first entry is the default, or a plain default).
export function declareSetting(name: string, decl: LuaValue): Setting {
  const table: LuaTable = isTable(decl) ? decl : { list: [decl], fields: new Map() };
  const problems: string[] = [];
  if (table.list.length > 1) problems.push("only the default comes first; a list as the default goes in its own braces: { { 0, 0 } }");
  for (const k of table.fields.keys()) if (!KEYS.has(k)) problems.push(`unknown '${k}'`);
  const f = (k: string) => table.fields.get(k);
  const num = (k: string) => {
    const v = f(k);
    if (v === undefined) return undefined;
    if (typeof v === "number") return v;
    if (v !== UNKNOWN) problems.push(`${k} must be a number`);
    return undefined;
  };
  const raw = table.list[0];
  let def = raw === UNKNOWN ? undefined : toJson(raw ?? undefined);
  let type = f("type");
  if (type === "color") type = "colour";
  const choicesRaw = f("choices");
  if (type === undefined || type === UNKNOWN) {
    if (choicesRaw !== undefined) type = "choice";
    else if (typeof def === "number") type = "number";
    else if (typeof def === "boolean") type = "boolean";
    else if (typeof def === "string") type = "text";
    else if (Array.isArray(def)) type = "vector";
    else type = "text";
  }
  const s: Setting = { name, type: TYPES.includes(type as SettingType) ? (type as SettingType) : "text" };
  if (!TYPES.includes(type as SettingType)) problems.push(`unknown type '${String(type)}'`);
  s.min = num("min");
  s.max = num("max");
  s.step = num("step");
  if (s.min !== undefined && s.max !== undefined && s.min > s.max) problems.push("min is bigger than max");
  if (s.step !== undefined && s.step <= 0) problems.push("step must be more than 0");
  const help = f("help");
  if (typeof help === "string") s.help = help;
  if (s.type === "choice") {
    const list = toJson(choicesRaw);
    s.choices = Array.isArray(list) ? list.filter((c): c is string | number => typeof c === "string" || typeof c === "number") : [];
    if (!s.choices.length) problems.push("choices must be a list");
    if (def === undefined) def = s.choices[0];
  }
  if (s.type === "vector") s.size = Array.isArray(def) ? Math.max(2, Math.min(4, def.length)) : 2;
  if (s.type === "colour" && def !== undefined) {
    const c = colourOf(def);
    def = c ? colourHex(c) : def;
  }
  if (def !== undefined) {
    s.default = def;
    const bad = settingProblem(s, def);
    if (bad) problems.push(`the default ${bad}`);
  }
  for (const k of Object.keys(s) as (keyof Setting)[]) if (s[k] === undefined) delete s[k];
  if (problems.length) s.problem = problems.join("; ");
  return s;
}

/// The settings a spec declares (the `settings` field of the table given to `nova.entity`), in the order written.
export function settingsOf(spec: LuaTable): Setting[] | undefined {
  const decl = spec.fields.get("settings");
  if (!isTable(decl)) return undefined;
  return [...decl.fields].map(([name, d]) => declareSetting(name, d));
}

/// A parent's settings with a child's: the child's replace the parent's of the same name, and a child's plain field of that
/// name (`speed = 80`) changes only the default.
export function mergeSettings(parent: Setting[] | undefined, own: Setting[] | undefined, fields: Record<string, unknown> = {}): Setting[] | undefined {
  if (!parent?.length && !own?.length) return undefined;
  const out = new Map<string, Setting>();
  for (const s of parent ?? []) out.set(s.name, s);
  for (const s of own ?? []) out.set(s.name, s);
  for (const [k, v] of Object.entries(fields)) {
    const s = out.get(k);
    if (s && v !== undefined) out.set(k, { ...s, default: s.type === "colour" && colourOf(v) ? colourHex(colourOf(v)!) : v });
  }
  return [...out.values()];
}

/// What is wrong with a value for this setting (in the framework's words), or null when it is fine. Out of the limits
/// is fine here: the game keeps it within them.
export function settingProblem(s: Setting, v: unknown): string | null {
  switch (s.type) {
    case "number": return typeof v === "number" ? null : "must be a number";
    case "boolean": return typeof v === "boolean" ? null : "must be true or false";
    case "choice": return (s.choices ?? []).includes(v as string) ? null : `must be one of ${(s.choices ?? []).map((c) => JSON.stringify(c)).join(", ")}`;
    case "colour": return colourOf(v) ? null : "must be a colour";
    case "vector": return Array.isArray(v) && v.length === (s.size ?? 2) && v.every((x) => typeof x === "number") ? null : `must be a list of ${s.size ?? 2} numbers`;
    default: return typeof v === "string" ? null : s.type === "text" ? "must be text" : `must be the name of ${s.type === "object" ? "an" : "a"} ${s.type}`;
  }
}

/// Keeps a number within the setting's limits, as the game will.
export const clampTo = (s: Setting, v: number) => Math.min(s.max ?? Infinity, Math.max(s.min ?? -Infinity, v));


/// The prop to write for a new value (a colour as "#rrggbb"). A value equal to the default is still written: some games read a
/// level's props straight from the file (`nova.scene_data`), where nothing fills in defaults. Undefined leaves the prop out.
export function propFor(s: Setting, v: unknown): unknown {
  if (v === undefined) return undefined;
  if (s.type === "colour") {
    const c = colourOf(v);
    return c ? colourHex(c) : v;
  }
  if ((s.type === "object" || s.type === "sprite" || s.type === "sound" || s.type === "music" || s.type === "model") && v === "" && s.default === undefined) return undefined;
  return v;
}

const stripExt = (p: string, ...exts: string[]) => {
  for (const e of exts) if (p.toLowerCase().endsWith(e)) return p.slice(0, p.length - e.length);
  return p;
};

/// The names a reference setting can pick from: sprites, sounds, music and models by the names a game uses for them
/// (`"player"` for sprites/player.png), or the named objects of the scene.
export function referenceNames(type: SettingType, files: string[], objectNames: string[] = []): string[] {
  const out = new Set<string>();
  for (const path of [...files].sort()) {
    const lower = path.toLowerCase();
    if (type === "sprite") {
      if (lower.endsWith(".sprite.json")) out.add(stripExt(path.slice(path.lastIndexOf("/") + 1), ".sprite.json"));
      else if (lower.endsWith(".png") && path.startsWith("sprites/")) out.add(stripExt(path.slice(8), ".png"));
    } else if (type === "sound" && path.startsWith("sounds/") && /\.(wav|ogg|sfx\.json)$/.test(lower)) {
      out.add(stripExt(path.slice(7), ".wav", ".ogg", ".sfx.json"));
    } else if (type === "music" && path.startsWith("music/") && /\.(wav|ogg|song\.json)$/.test(lower)) {
      out.add(stripExt(path.slice(6), ".wav", ".ogg", ".song.json"));
    } else if (type === "model" && path.startsWith("models/") && /\.(glb|model\.json)$/.test(lower)) {
      out.add(stripExt(path.slice(7), ".glb", ".model.json"));
    }
  }
  if (type === "object") for (const n of objectNames) out.add(n);
  return [...out].sort((a, b) => a.localeCompare(b));
}
