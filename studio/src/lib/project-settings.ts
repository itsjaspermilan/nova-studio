// The project's settings page works on `nova.json` as text: every change parses it, changes one key and writes it back in the same order, so a
// hand-written file keeps its shape (and its unknown keys). docs/project-format.md describes the keys; these functions check what the runtime checks.

export type Json = Record<string, unknown>;

export function parseManifest(text: string): { ok: true; obj: Json } | { ok: false; error: string } {
  try {
    const v: unknown = JSON.parse(text);
    if (!v || typeof v !== "object" || Array.isArray(v)) return { ok: false, error: "nova.json must be an object." };
    return { ok: true, obj: v as Json };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const write = (obj: Json) => `${JSON.stringify(obj, null, 2)}\n`;

/// Sets one top-level key (or removes it when `value` is undefined). Returns the new text, or the same text when the file is not valid JSON.
export function setKey(text: string, key: string, value: unknown): string {
  const p = parseManifest(text);
  if (!p.ok) return text;
  if (value === undefined) delete p.obj[key];
  else p.obj[key] = value;
  return write(p.obj);
}

export const GRAPHICS_KEYS = ["hdr", "msaa", "shadow_cascades", "ibl", "anisotropy"] as const;
export type GraphicsKey = (typeof GRAPHICS_KEYS)[number];

/// Sets one graphics option; the `graphics` section is removed when nothing is left in it.
export function setGraphics(text: string, key: GraphicsKey, value: unknown): string {
  const p = parseManifest(text);
  if (!p.ok) return text;
  const g: Json = { ...((p.obj.graphics as Json | undefined) ?? {}) };
  if (value === undefined) delete g[key];
  else g[key] = value;
  if (Object.keys(g).length) p.obj.graphics = g;
  else delete p.obj.graphics;
  return write(p.obj);
}

export interface Problem {
  field: string;
  message: string;
}

/// What the runtime would refuse or warn about in the settings (a subset it checks at load; the runtime stays the judge).
export function checkSettings(obj: Json, files: string[]): Problem[] {
  const out: Problem[] = [];
  const name = obj.name;
  if (typeof name !== "string" || name.trim().length < 1 || name.length > 80) out.push({ field: "name", message: "The game's name must be 1 to 80 characters." });
  if (obj.format !== 1) out.push({ field: "format", message: "format must be 1." });
  const entry = obj.entry ?? "main.lua";
  if (typeof entry !== "string" || !entry.endsWith(".lua")) out.push({ field: "entry", message: "The entry script must be a .lua file." });
  else if (files.length && !files.includes(entry)) out.push({ field: "entry", message: `${entry} is not in the project.` });
  const wh = obj.world_height;
  if (wh !== undefined && (typeof wh !== "number" || !Number.isInteger(wh) || wh < 0 || wh > 4320)) out.push({ field: "world_height", message: "world_height is a whole number from 0 (the screen's own size) to 4320." });
  const sf = obj.sprite_filter;
  if (sf !== undefined && sf !== "pixel" && sf !== "smooth") out.push({ field: "sprite_filter", message: 'sprite_filter is "pixel" or "smooth".' });
  const g = obj.graphics as Json | undefined;
  if (g !== undefined && (typeof g !== "object" || Array.isArray(g) || g === null)) out.push({ field: "graphics", message: "graphics must be a set of options." });
  else if (g) {
    if (g.msaa !== undefined && ![1, 2, 4].includes(g.msaa as number)) out.push({ field: "graphics.msaa", message: "msaa is 1, 2 or 4." });
    if (g.shadow_cascades !== undefined && !(Number.isInteger(g.shadow_cascades) && (g.shadow_cascades as number) >= 0 && (g.shadow_cascades as number) <= 4)) out.push({ field: "graphics.shadow_cascades", message: "shadow_cascades is 0 to 4." });
    if (g.anisotropy !== undefined && ![1, 2, 4, 8, 16].includes(g.anisotropy as number)) out.push({ field: "graphics.anisotropy", message: "anisotropy is 1, 2, 4, 8 or 16." });
  }
  const input = obj.input;
  if (input !== undefined) {
    if (!input || typeof input !== "object" || Array.isArray(input)) out.push({ field: "input", message: "input must be a set of actions." });
    else {
      for (const a of actionsOf(obj)) {
        const all = a.axis ? [...a.negative, ...a.positive] : a.sources;
        for (const s of all) if (!isValidSource(s)) out.push({ field: `input.${a.name}`, message: `"${s}" is not a source the game knows.` });
        if (!a.axis && a.sources.length === 0) out.push({ field: `input.${a.name}`, message: `${a.name} has nothing bound.` });
      }
    }
  }
  return out;
}

// ---- input actions ------------------------------------------------------------------------------------

export interface Action {
  name: string;
  axis: boolean;
  /// Buttons: the sources that press it.
  sources: string[];
  /// Axes: the sources that push it down and up.
  negative: string[];
  positive: string[];
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export function actionsOf(obj: Json): Action[] {
  const input = obj.input;
  if (!input || typeof input !== "object" || Array.isArray(input)) return [];
  return Object.entries(input as Json).map(([name, v]) => {
    const axis = !!v && typeof v === "object" && !Array.isArray(v);
    const o = (axis ? v : {}) as Json;
    return { name, axis, sources: axis ? [] : strings(v), negative: strings(o.negative), positive: strings(o.positive) };
  });
}

export const PAD_BUTTONS = ["south", "east", "west", "north", "l1", "r1", "l2", "r2", "start", "select", "thumb_l", "thumb_r", "dpad_up", "dpad_down", "dpad_left", "dpad_right"];
export const PAD_AXES = ["left_x", "left_y", "right_x", "right_y", "l2", "r2"];
export const MOUSE_BUTTONS = ["left", "right", "middle"];
export const TOUCH_ZONES = ["left", "right", "drag_x", "drag_y"];

/// True for a source the runtime accepts (docs/project-format.md, "Sources").
export function isValidSource(s: string): boolean {
  const i = s.indexOf(":");
  if (i < 0) return false;
  const kind = s.slice(0, i);
  const name = s.slice(i + 1);
  if (kind === "key") return /^[A-Za-z][A-Za-z0-9]*$/.test(name) && name.length > 0;
  if (/^pad[1-4]?$/.test(kind)) return PAD_BUTTONS.includes(name);
  if (/^axis[1-4]?$/.test(kind)) return PAD_AXES.includes(name.replace(/[+-]$/, ""));
  if (kind === "mouse") return MOUSE_BUTTONS.includes(name);
  if (kind === "touch") return TOUCH_ZONES.includes(name);
  return false;
}

/// The source for a pressed key (from `KeyboardEvent.code`, which is what the runtime's key names are).
export const sourceFromKeyCode = (code: string): string | null => (/^[A-Za-z][A-Za-z0-9]*$/.test(code) ? `key:${code}` : null);

const PAD_WORDS: Record<string, string> = { south: "bottom button (B)", east: "right button (A)", west: "left button (Y)", north: "top button (X)", l1: "L", r1: "R", l2: "ZL", r2: "ZR", start: "+", select: "−", thumb_l: "left stick click", thumb_r: "right stick click", dpad_up: "D-pad up", dpad_down: "D-pad down", dpad_left: "D-pad left", dpad_right: "D-pad right" };
const AXIS_WORDS: Record<string, string> = { left_x: "left stick left-right", left_y: "left stick up-down", right_x: "right stick left-right", right_y: "right stick up-down", l2: "ZL trigger", r2: "ZR trigger" };

/// A source in plain words ("Key W", "Gamepad bottom button (B)", "Left stick left-right, right half only"); the id itself when it is not known.
export function describeSource(s: string): string {
  const i = s.indexOf(":");
  const kind = s.slice(0, i);
  const name = s.slice(i + 1);
  const player = /^(pad|axis)([1-4])$/.exec(kind);
  const who = player ? ` (player ${player[2]})` : "";
  if (kind === "key") return `Key ${name.replace(/^Key|^Digit/, "").replace(/([a-z])([A-Z])/g, "$1 $2")}`;
  if (kind.startsWith("pad")) return `Gamepad ${PAD_WORDS[name] ?? name}${who}`;
  if (kind.startsWith("axis")) {
    const base = name.replace(/[+-]$/, "");
    const dir = name.endsWith("+") ? ", positive side only" : name.endsWith("-") ? ", negative side only" : "";
    return `${AXIS_WORDS[base] ?? base}${dir}${who}`;
  }
  if (kind === "mouse") return `Mouse ${name} button`;
  if (kind === "touch") return `Touch: ${name.replace("_", " ")}`;
  return s;
}

const inputOf = (obj: Json): Json => ((obj.input && typeof obj.input === "object" && !Array.isArray(obj.input) ? obj.input : {}) as Json);

/// Replaces (or adds) one action's bindings. `binding` is a list for a button, or the two lists for an axis.
export function setAction(text: string, name: string, binding: string[] | { negative: string[]; positive: string[] }): string {
  const p = parseManifest(text);
  if (!p.ok) return text;
  p.obj.input = { ...inputOf(p.obj), [name]: binding };
  return write(p.obj);
}

export function removeAction(text: string, name: string): string {
  const p = parseManifest(text);
  if (!p.ok) return text;
  const input = { ...inputOf(p.obj) };
  delete input[name];
  if (Object.keys(input).length) p.obj.input = input;
  else delete p.obj.input;
  return write(p.obj);
}

/// Renames an action in place (its place in the list stays). Returns the same text when the new name is taken or not a name.
export function renameAction(text: string, from: string, to: string): string {
  const p = parseManifest(text);
  if (!p.ok || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(to)) return text;
  const input = inputOf(p.obj);
  if (!(from in input) || (to !== from && to in input)) return text;
  p.obj.input = Object.fromEntries(Object.entries(input).map(([k, v]) => [k === from ? to : k, v]));
  return write(p.obj);
}

/// Adds a source to a button, or to one side of an axis (no repeats).
export function addSource(text: string, name: string, source: string, side?: "negative" | "positive"): string {
  const p = parseManifest(text);
  if (!p.ok) return text;
  const a = actionsOf(p.obj).find((x) => x.name === name);
  if (!a) return text;
  if (a.axis) {
    const s = side ?? "positive";
    const next = { negative: [...a.negative], positive: [...a.positive] };
    if (!next[s].includes(source)) next[s].push(source);
    return setAction(text, name, next);
  }
  return a.sources.includes(source) ? text : setAction(text, name, [...a.sources, source]);
}

export function removeSource(text: string, name: string, source: string, side?: "negative" | "positive"): string {
  const p = parseManifest(text);
  if (!p.ok) return text;
  const a = actionsOf(p.obj).find((x) => x.name === name);
  if (!a) return text;
  if (a.axis) {
    const s = side ?? "positive";
    return setAction(text, name, { negative: a.negative.filter((x) => s !== "negative" || x !== source), positive: a.positive.filter((x) => s !== "positive" || x !== source) });
  }
  return setAction(text, name, a.sources.filter((x) => x !== source));
}

/// Other actions that use the same source (for a "this key is also used for…" note). Axes' two sides count.
export function usedBy(obj: Json, source: string, except?: string): string[] {
  return actionsOf(obj)
    .filter((a) => a.name !== except && [...a.sources, ...a.negative, ...a.positive].includes(source))
    .map((a) => a.name);
}
