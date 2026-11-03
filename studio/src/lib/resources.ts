// The project as a person thinks of it, like Game Maker's resource tree: Sprites, Models, Scenes, Entities, Sounds...
// Behind each item are the plain files the game reads. A sprite is its `.sprite.json` plus the picture it cuts up,
// a model is its `.model.json` plus the `.glb` and texture exported from it, a scene is its Lua and its layout. The
// studio shows one item and moves, renames and deletes the files together.

import type { FileEntry } from "./types";

export type ResourceKind = "sprite" | "model" | "scene" | "entity" | "sound" | "song" | "script" | "image" | "font" | "project" | "file";

export interface Resource {
  kind: ResourceKind;
  /// The name shown: the path inside the group's folder, without extensions.
  name: string;
  /// The file a click opens (the editor for the resource).
  path: string;
  /// A second file the item can also open as code (a scene's Lua).
  code?: string;
  /// Every file that belongs to it, the one a click opens first.
  files: string[];
}

export interface ResourceGroup {
  id: string;
  title: string;
  icon: string;
  items: Resource[];
  /// Where new files of this group go, for groups made of plain files.
  folder?: string;
}

const GROUPS: { id: string; title: string; icon: string; folder?: string; always: boolean }[] = [
  { id: "sprites", title: "Sprites", icon: "◫", folder: "sprites", always: true },
  { id: "models", title: "3D Models", icon: "◆", folder: "models", always: true },
  { id: "scenes", title: "Scenes", icon: "▦", folder: "scenes", always: true },
  { id: "entities", title: "Entities", icon: "☺", folder: "entities", always: true },
  { id: "sounds", title: "Sounds", icon: "♪", folder: "sounds", always: true },
  { id: "music", title: "Music", icon: "♫", folder: "music", always: true },
  { id: "scripts", title: "Scripts", icon: "☾", always: false },
  { id: "images", title: "Images", icon: "▣", always: false },
  { id: "fonts", title: "Fonts", icon: "A", always: false },
  { id: "project", title: "Project", icon: "⚙", always: false },
  { id: "other", title: "Other files", icon: "·", always: false },
];

const norm = (parts: string[]) => {
  const out: string[] = [];
  for (const p of parts) p === ".." ? out.pop() : p !== "." && p !== "" && out.push(p);
  return out.join("/");
};
/// A path relative to a JSON file's folder, as a project path.
export const resolveFrom = (file: string, relative: string) => norm([...file.split("/").slice(0, -1), ...relative.split("/")]);

const within = (path: string, folder: string) => (path.startsWith(`${folder}/`) ? path.slice(folder.length + 1) : path);
const stripExt = (path: string, ...exts: string[]) => {
  const lower = path.toLowerCase();
  for (const e of exts) if (lower.endsWith(e)) return path.slice(0, path.length - e.length);
  return path;
};

/// `images` maps each `.sprite.json` to the picture it names (from its "image" key); a sprite whose file is not known
/// is taken to use `<name>.png`.
export function groupResources(entries: FileEntry[], images: Map<string, string> = new Map()): ResourceGroup[] {
  const files = entries.filter((e) => !e.dir).map((e) => e.path);
  const has = new Set(files);
  const claimed = new Set<string>();
  const byGroup = new Map<string, Resource[]>(GROUPS.map((g) => [g.id, []]));
  const add = (group: string, r: Resource) => {
    for (const f of r.files) claimed.add(f);
    byGroup.get(group)!.push(r);
  };
  const existing = (...paths: (string | undefined)[]) => paths.filter((p): p is string => !!p && has.has(p));

  for (const path of files) {
    const lower = path.toLowerCase();
    if (lower.endsWith(".sprite.json")) {
      const stem = path.slice(0, -".sprite.json".length);
      const named = images.get(path);
      add("sprites", { kind: "sprite", name: within(stem, "sprites"), path, files: [path, ...existing(named ?? `${stem}.png`, `${stem}.layers.json`)] });
    } else if (lower.endsWith(".model.json")) {
      const stem = path.slice(0, -".model.json".length);
      add("models", { kind: "model", name: within(stem, "models"), path, files: [path, ...existing(`${stem}.glb`, `${stem}.texture.png`)] });
    } else if (lower.endsWith(".sfx.json")) {
      const stem = path.slice(0, -".sfx.json".length);
      add("sounds", { kind: "sound", name: within(stem, "sounds"), path, files: [path, ...existing(`${stem}.wav`)] });
    } else if (lower.endsWith(".song.json")) {
      const stem = path.slice(0, -".song.json".length);
      add("music", { kind: "song", name: within(stem, "music"), path, files: [path, ...existing(`${stem}.ogg`, `${stem}.wav`)] });
    } else if (lower.endsWith(".scene.json")) {
      const stem = path.slice(0, -".scene.json".length);
      const lua = existing(`${stem}.lua`)[0];
      add("scenes", { kind: "scene", name: within(stem, "scenes"), path, code: lua, files: [path, ...(lua ? [lua] : [])] });
    }
  }

  for (const path of files) {
    if (claimed.has(path)) continue;
    const lower = path.toLowerCase();
    const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".") + 1) : "";
    if (lower === "nova.json") add("project", { kind: "project", name: "Game settings", path, files: [path] });
    else if (ext === "lua" && path.startsWith("scenes/")) add("scenes", { kind: "scene", name: within(stripExt(path, ".lua"), "scenes"), path, files: [path] });
    else if (ext === "lua" && path.startsWith("entities/")) add("entities", { kind: "entity", name: within(stripExt(path, ".lua"), "entities"), path, files: [path] });
    else if (ext === "lua") add("scripts", { kind: "script", name: stripExt(path, ".lua"), path, files: [path] });
    else if (ext === "png" && path.startsWith("sprites/")) add("sprites", { kind: "sprite", name: within(stripExt(path, ".png"), "sprites"), path, files: [path] });
    else if (ext === "png") add("images", { kind: "image", name: stripExt(path, ".png"), path, files: [path] });
    else if (ext === "glb") add("models", { kind: "model", name: within(stripExt(path, ".glb"), "models"), path, files: [path] });
    else if ((ext === "wav" || ext === "ogg") && path.startsWith("music/")) add("music", { kind: "song", name: within(stripExt(path, ".wav", ".ogg"), "music"), path, files: [path] });
    else if (ext === "wav" || ext === "ogg") add("sounds", { kind: "sound", name: within(stripExt(path, ".wav", ".ogg"), "sounds"), path, files: [path] });
    else if (ext === "ttf" || ext === "otf") add("fonts", { kind: "font", name: path.slice(path.lastIndexOf("/") + 1), path, files: [path] });
    else if (ext !== "json" || !path.endsWith(".layers.json")) add("other", { kind: "file", name: path, path, files: [path] });
  }

  return GROUPS.map((g) => ({ id: g.id, title: g.title, icon: g.icon, folder: g.folder, items: byGroup.get(g.id)!.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })), always: g.always }))
    .filter((g) => g.always || g.items.length)
    .map(({ always: _always, ...g }) => g);
}

/// Where each of a resource's files goes when the item is renamed to `name` (inside the same folder): files named
/// after the item follow it; a picture with another name (a sprite's `hero_sheet.png`) keeps its name, which the
/// sprite's JSON refers to.
export function renamePlan(resource: Resource, name: string): [string, string][] {
  const stem = (p: string) => p.slice(0, p.length - (p.toLowerCase().endsWith(".sprite.json") ? ".sprite.json".length : p.toLowerCase().endsWith(".model.json") ? ".model.json".length : p.toLowerCase().endsWith(".sfx.json") ? ".sfx.json".length : p.toLowerCase().endsWith(".song.json") ? ".song.json".length : p.toLowerCase().endsWith(".scene.json") ? ".scene.json".length : p.includes(".") ? p.length - p.lastIndexOf(".") : 0));
  const primaryStem = stem(resource.path);
  const dir = primaryStem.includes("/") ? primaryStem.slice(0, primaryStem.lastIndexOf("/") + 1) : "";
  const oldBase = primaryStem.slice(dir.length);
  return resource.files
    .filter((f) => f.startsWith(`${dir}${oldBase}.`) || f.startsWith(`${dir}${oldBase}_`))
    .map((f) => [f, `${dir}${name}${f.slice(dir.length + oldBase.length)}`] as [string, string])
    .filter(([a, b]) => a !== b);
}
