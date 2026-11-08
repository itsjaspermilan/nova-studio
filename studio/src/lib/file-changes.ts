// What changed in the project's files between two listings: by each file's size and time (FileEntry.modified), so a
// picture, sound or model changed by another program is noticed without reading it.

import type { FileEntry } from "./types";

export interface FileDiff {
  /// Files there both times whose size or time differs.
  changed: string[];
  added: string[];
  removed: string[];
  /// All three together.
  all: string[];
}

/// Each path's stamp: its size and time for a file, "dir" for a folder.
export function stampsOf(files: FileEntry[]): Map<string, string> {
  return new Map(files.map((f) => [f.path, f.dir ? "dir" : `${f.size}:${f.modified ?? ""}`]));
}

/// The difference between earlier stamps and a new listing. The first listing (no earlier stamps) is no change.
export function diffFiles(before: Map<string, string>, files: FileEntry[]): FileDiff {
  const changed: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  if (before.size) {
    const now = stampsOf(files);
    for (const [path, stamp] of now) {
      const old = before.get(path);
      if (old === undefined) added.push(path);
      else if (old !== stamp) changed.push(path);
    }
    for (const path of before.keys()) if (!now.has(path)) removed.push(path);
  }
  return { changed, added, removed, all: [...changed, ...added, ...removed] };
}
