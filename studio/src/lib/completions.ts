import apiData from "./nova-api.json";

export interface ApiEntry {
  name: string;
  kind: "function" | "namespace" | "method";
  signature: string;
  doc: string;
  group: string;
}

export const apiEntries = apiData as ApiEntry[];

export interface ProjectSymbols {
  images: Suggestion[];
  models: Suggestion[];
  sounds: Suggestion[];
  fonts: Suggestion[];
  scenes: Suggestion[];
  entities: Suggestion[];
  actions: Suggestion[];
}

export interface Suggestion {
  label: string;
  type: "function" | "namespace" | "method" | "constant" | "variable" | "keyword" | "text";
  detail?: string;
  info?: string;
}

export interface Completion {
  /// Index in the text before the cursor where the replaced text begins.
  from: number;
  options: Suggestion[];
}

export const BUILTIN_FONTS = ["sans", "rounded", "pixel", "terminal", "mono", "serif", "comic", "display", "script"];
export const BUILTIN_ACTIONS = [
  "left", "right", "up", "down", "a", "b", "x", "y", "l1", "r1", "l2", "r2", "start", "select",
  "move_x", "move_y", "look_x", "look_y", "steer", "throttle", "brake", "action",
];
const KEYWORDS = ["and", "break", "do", "else", "elseif", "end", "false", "for", "function", "if", "in", "local", "nil", "not", "or", "repeat", "return", "then", "true", "until", "while"];

const base = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const stripExt = (name: string, ...exts: string[]) => {
  for (const ext of exts) if (name.toLowerCase().endsWith(ext)) return name.slice(0, -ext.length);
  return name;
};

/// What the project contains that scripts can name, from its file list and manifest text.
export function projectSymbols(files: string[], manifestText?: string): ProjectSymbols {
  const images: Suggestion[] = [];
  const models: Suggestion[] = [];
  const sounds: Suggestion[] = [];
  const fonts: Suggestion[] = BUILTIN_FONTS.map((label) => ({ label, type: "constant", detail: "built-in font" }));
  const scenes: Suggestion[] = [];
  const entities: Suggestion[] = [];
  const seen = new Set<string>();
  const add = (list: Suggestion[], s: Suggestion) => {
    const key = `${list === images ? "i" : list === models ? "m" : list === sounds ? "s" : list === fonts ? "f" : list === scenes ? "c" : "e"}:${s.label}`;
    if (!seen.has(key)) {
      seen.add(key);
      list.push(s);
    }
  };

  for (const path of [...files].sort()) {
    const lower = path.toLowerCase();
    if (lower.endsWith(".sprite.json")) {
      add(images, { label: stripExt(base(path), ".sprite.json"), type: "constant", detail: "sprite sheet" });
      add(images, { label: path, type: "text", detail: "sprite sheet" });
    } else if (lower.endsWith(".png")) {
      add(images, { label: path, type: "text", detail: "image" });
      if (path.startsWith("sprites/")) add(images, { label: stripExt(path.slice(8), ".png"), type: "constant", detail: "image" });
    } else if (lower.endsWith(".glb")) {
      add(models, { label: path, type: "text", detail: "model" });
      if (path.startsWith("models/")) add(models, { label: stripExt(path.slice(7), ".glb"), type: "constant", detail: "model" });
    } else if (lower.endsWith(".wav") || lower.endsWith(".ogg")) {
      add(sounds, { label: path, type: "text", detail: "sound" });
      for (const folder of ["sounds/", "music/"]) {
        if (path.startsWith(folder)) add(sounds, { label: stripExt(path.slice(folder.length), ".wav", ".ogg"), type: "constant", detail: folder === "music/" ? "music" : "sound" });
      }
    } else if (lower.endsWith(".ttf") || lower.endsWith(".otf")) {
      add(fonts, { label: path, type: "text", detail: "project font" });
      if (path.startsWith("fonts/")) add(fonts, { label: stripExt(path.slice(6), ".ttf", ".otf"), type: "constant", detail: "project font" });
    } else if (lower.endsWith(".lua")) {
      if (path.startsWith("scenes/")) add(scenes, { label: stripExt(path.slice(7), ".lua").replaceAll("/", "."), type: "constant", detail: "scene" });
      if (path.startsWith("entities/")) add(entities, { label: stripExt(path.slice(9), ".lua").replaceAll("/", "."), type: "constant", detail: "entity" });
    }
  }

  const actions: Suggestion[] = BUILTIN_ACTIONS.map((label) => ({ label, type: "constant", detail: "built-in action" }));
  if (manifestText) {
    try {
      const input = JSON.parse(manifestText)?.input;
      if (input && typeof input === "object" && !Array.isArray(input)) {
        for (const name of Object.keys(input).sort()) {
          const existing = actions.findIndex((a) => a.label === name);
          const entry: Suggestion = { label: name, type: "constant", detail: "action from nova.json" };
          if (existing >= 0) actions[existing] = entry;
          else actions.unshift(entry);
        }
      }
    } catch {
      // A broken nova.json is reported by the checker; completions just skip it.
    }
  }
  return { images, models, sounds, fonts, scenes, entities, actions };
}

type Kind = keyof ProjectSymbols;

/// Calls whose first argument is a name from the project, and which kind of name.
const STRING_ARGUMENTS: [RegExp, Kind][] = [
  [/nova\.(?:ui\.)?sprite\s*\(\s*$/, "images"],
  [/nova\.model\s*\(\s*$/, "models"],
  [/nova\.(?:sound|music)\.play\s*\(\s*$/, "sounds"],
  [/nova\.spawn\s*\(\s*$/, "entities"],
  [/nova\.(?:goto_scene|start)\s*\(\s*$/, "scenes"],
  [/nova\.input\.(?:down|pressed|released|axis|bind|bindings)\s*\(\s*$/, "actions"],
  [/\bsprite\s*=\s*$/, "images"],
  [/\bimage\s*=\s*$/, "images"],
  [/\bmodel\s*=\s*$/, "models"],
  [/\bfont\s*=\s*$/, "fonts"],
];

const startsWithIgnoringCase = (label: string, prefix: string) => label.toLowerCase().startsWith(prefix.toLowerCase());

/// Completions at the end of `textBefore` (the text of the file up to the cursor).
export function complete(textBefore: string, symbols: ProjectSymbols, api: ApiEntry[] = apiEntries): Completion | null {
  const lineStart = textBefore.lastIndexOf("\n") + 1;
  const line = textBefore.slice(lineStart);

  // Inside a string given to a call that expects a project name.
  const open = /(["'])([^"'\n]*)$/.exec(line);
  if (open) {
    const before = line.slice(0, open.index);
    const typed = open[2] ?? "";
    for (const [pattern, kind] of STRING_ARGUMENTS) {
      if (pattern.test(before)) {
        const options = symbols[kind].filter((s) => startsWithIgnoringCase(s.label, typed));
        return options.length ? { from: lineStart + open.index + 1, options } : null;
      }
    }
    return null; // inside some other string: stay out of the way
  }

  // nova.something, nova.ui.something, self:method
  const member = /\b((?:nova|self)(?:\.[A-Za-z_]\w*)*)([.:])([A-Za-z_]\w*)?$/.exec(line);
  if (member) {
    const [, path = "", separator = ".", partial = ""] = member;
    const from = textBefore.length - partial.length;
    let options: Suggestion[];
    if (path === "self" && separator === ":") {
      options = api.filter((e) => e.kind === "method").map((e) => ({ label: e.name, type: "method", detail: e.signature, info: e.doc }));
    } else if (path.startsWith("nova") && separator === ".") {
      const prefix = `${path}.`;
      options = api
        .filter((e) => e.kind !== "method" && e.name.startsWith(prefix) && !e.name.slice(prefix.length).includes("."))
        .map((e) => ({ label: e.name.slice(prefix.length), type: e.kind === "namespace" ? "namespace" : "function", detail: e.signature, info: e.doc }));
    } else {
      return null;
    }
    options = options.filter((o) => startsWithIgnoringCase(o.label, partial));
    return options.length ? { from, options } : null;
  }

  // A bare word: nova, or a Lua keyword.
  const word = /(?:^|[^\w.:])([A-Za-z_]\w*)$/.exec(line);
  if (word) {
    const partial = word[1] ?? "";
    if (partial.length >= 2) {
      const options: Suggestion[] = [];
      if (startsWithIgnoringCase("nova", partial)) options.push({ label: "nova", type: "namespace", detail: "Nova's API" });
      for (const k of KEYWORDS) if (k.startsWith(partial) && k !== partial) options.push({ label: k, type: "keyword" });
      return options.length ? { from: textBefore.length - partial.length, options } : null;
    }
  }
  return null;
}

/// The dotted name (or `:method`) under a position, for hover help. `nova.ui.text` when the pointer is on `text`.
export function identifierAt(text: string, pos: number): string | null {
  const isWord = (c: string | undefined) => !!c && /[A-Za-z0-9_]/.test(c);
  let start = pos;
  let end = pos;
  while (start > 0 && (isWord(text[start - 1]) || text[start - 1] === ".")) start--;
  while (end < text.length && isWord(text[end])) end++;
  if (start === end) return null;
  const method = start > 0 && text[start - 1] === ":" ? ":" : "";
  const word = text.slice(start, end);
  return method ? `${method}${word}` : word;
}

/// The reference entry for a hovered identifier, if there is one.
export function lookup(identifier: string, api: ApiEntry[] = apiEntries): ApiEntry | null {
  if (identifier.startsWith(":")) return api.find((e) => e.kind === "method" && e.name === identifier.slice(1)) ?? null;
  return api.find((e) => e.kind !== "method" && e.name === identifier) ?? null;
}
