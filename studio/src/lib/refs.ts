// When a file or folder is renamed, find the places in the project's text files that name it and
// work out the edited text. Pure: the store decides what to read, ask and write.

import { STRING_ARGUMENTS, type Kind } from "./completions";

export interface RefEdit {
  file: string;
  count: number;
  text: string;
}

const isText = (path: string) => /\.(lua|json)$/i.test(path);
const strip = (name: string, ...exts: string[]) => {
  for (const e of exts) if (name.toLowerCase().endsWith(e)) return name.slice(0, -e.length);
  return name;
};

/// The short name scripts can use for a project file, and what kind of name it is.
export function shortName(path: string): { kind: Kind; name: string } | null {
  const lower = path.toLowerCase();
  const under = (folder: string) => path.slice(folder.length);
  if (path.startsWith("sprites/") && lower.endsWith(".png")) return { kind: "images", name: strip(under("sprites/"), ".png") };
  if (lower.endsWith(".sprite.json")) return { kind: "images", name: strip(path.slice(path.lastIndexOf("/") + 1), ".sprite.json") };
  if (path.startsWith("models/") && lower.endsWith(".glb")) return { kind: "models", name: strip(under("models/"), ".glb") };
  for (const f of ["sounds/", "music/"]) if (path.startsWith(f) && (lower.endsWith(".wav") || lower.endsWith(".ogg"))) return { kind: "sounds", name: strip(under(f), ".wav", ".ogg") };
  if (path.startsWith("fonts/") && /\.(ttf|otf)$/i.test(path)) return { kind: "fonts", name: strip(under("fonts/"), ".ttf", ".otf") };
  if (path.startsWith("scenes/") && lower.endsWith(".lua")) return { kind: "scenes", name: strip(under("scenes/"), ".lua").replaceAll("/", ".") };
  if (path.startsWith("entities/") && lower.endsWith(".lua")) return { kind: "entities", name: strip(under("entities/"), ".lua").replaceAll("/", ".") };
  return null;
}

const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

/// `target` written relative to the folder `from`, with `..` where needed.
export function relativeTo(from: string, target: string): string {
  const a = from ? from.split("/") : [];
  const b = target.split("/");
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...Array(a.length - i).fill(".."), ...b.slice(i)].join("/");
}

function resolveRelative(folder: string, ref: string): string {
  const out = folder ? folder.split("/") : [];
  for (const part of ref.split("/")) {
    if (part === "..") out.pop();
    else if (part !== "." && part !== "") out.push(part);
  }
  return out.join("/");
}

/// A moved path: `old` itself, or something inside it when a folder moved.
export const moved = (path: string, from: string, to: string): string | null => (path === from ? to : path.startsWith(`${from}/`) ? to + path.slice(from.length) : null);

/// Files (`from` is a file or a folder; `files` are the project's files before the rename).
export function planRename(from: string, to: string, files: ReadonlyMap<string, string>, allPaths: string[]): RefEdit[] {
  // Every file that moves, with its new place.
  const moves = allPaths.map((p) => [p, moved(p, from, to)] as const).filter((m): m is readonly [string, string] => m[1] !== null);
  const edits: RefEdit[] = [];

  for (const [file, text] of files) {
    if (!isText(file)) continue;
    const folder = dirOf(file);
    const isSheet = file.endsWith(".sprite.json");
    let count = 0;
    let out = text;

    // Quoted strings: full project paths, a sheet's relative image, and short names after known calls.
    out = out.replace(/(["'])([^"'\n]*)\1/g, (whole, quote: string, inner: string, offset: number) => {
      for (const [oldPath, newPath] of moves) {
        if (inner === oldPath) {
          count++;
          return `${quote}${newPath}${quote}`;
        }
      }
      if (isSheet && /"image"\s*:\s*$/.test(out.slice(Math.max(0, offset - 20), offset))) {
        // The picture may move, the sheet may move, or both: recompute the relative name from the final places.
        const target = resolveRelative(folder, inner);
        const rel = relativeTo(dirOf(moved(file, from, to) ?? file), moved(target, from, to) ?? target);
        if (rel !== inner) {
          count++;
          return `${quote}${rel}${quote}`;
        }
        return whole;
      }
      if (file.endsWith(".lua")) {
        const before = out.slice(0, offset);
        const lineBefore = before.slice(before.lastIndexOf("\n") + 1);
        const kind = STRING_ARGUMENTS.find(([pattern]) => pattern.test(lineBefore))?.[1];
        if (kind) {
          for (const [oldPath, newPath] of moves) {
            const a = shortName(oldPath);
            const b = shortName(newPath);
            if (a && b && a.kind === kind && a.name === inner) {
              count++;
              return `${quote}${b.name}${quote}`;
            }
          }
        }
      } else if (file.endsWith(".scene.json") && /"kind"\s*:\s*$/.test(out.slice(Math.max(0, offset - 20), offset))) {
        for (const [oldPath, newPath] of moves) {
          const a = shortName(oldPath);
          const b = shortName(newPath);
          if (a?.kind === "entities" && b && a.name === inner) {
            count++;
            return `${quote}${b.name}${quote}`;
          }
        }
      }
      return whole;
    });

    if (count > 0 && out !== text) edits.push({ file, count, text: out });
  }
  return edits;
}
