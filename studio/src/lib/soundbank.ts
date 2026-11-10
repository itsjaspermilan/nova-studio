// The soundbank: every sound and music file in the project, where each is used (by the Lua code, by a random group, by an animation's sound track),
// which are not used at all, which names the code asks for that do not exist, and what the sounds cost on a handheld (memory once decoded, voices).

import type { FileEntry } from "./types";

export interface SoundEntry {
  path: string;
  /// The short name the game uses: the path without its folder and extension (`sounds/jump.wav` is "jump").
  name: string;
  kind: "effect" | "music";
  size: number;
  /// Decoded size in memory, estimated: a WAV decodes to what it is (as 16-bit stereo); an Ogg is much smaller on disk than in memory.
  memory: number;
  /// Files whose code names it, groups that include it.
  usedBy: string[];
  inGroups: string[];
  streamed: boolean;
}

export interface Soundbank {
  sounds: SoundEntry[];
  unused: SoundEntry[];
  /// Names the code asks for (play("x")) that no sound, music or group file has: file and name.
  missing: { file: string; name: string }[];
  groups: { path: string; name: string; sounds: string[] }[];
  totalMemory: number;
}

const AUDIO = /\.(wav|ogg)$/i;
export const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");

/// Roughly how much memory a file takes once the runtime has decoded it: WAV bytes are PCM already (the runtime keeps 16-bit stereo, so 8-bit mono is
/// four times bigger and 16-bit stereo the same); an Ogg of music is streamed from disk and costs a few hundred KB of buffer; an Ogg effect is decoded to about 11 times its size.
export function estimateMemory(path: string, size: number, kind: "effect" | "music"): number {
  if (/\.wav$/i.test(path)) return size;
  if (kind === "music") return 256 * 1024;
  return size * 11;
}

/// The sound names a piece of Lua code plays: `nova.sound.play("x"`, `nova.music.play("x"`, and `sound = "x"` in a table (an animation track or an entity setting).
export function soundNamesIn(lua: string): { name: string; music: boolean }[] {
  const out: { name: string; music: boolean }[] = [];
  for (const m of lua.matchAll(/\bnova\.(sound|music)\.play\(\s*(["'])((?:(?!\2).)+)\2/g)) out.push({ name: m[3]!, music: m[1] === "music" });
  for (const m of lua.matchAll(/\b(?:sound|music)\s*=\s*(["'])((?:(?!\1).)+)\1/g)) out.push({ name: m[2]!, music: /\bmusic\s*=/.test(m[0]) });
  return out;
}

/// `sources` maps each text file that might name sounds (Lua, animation and scene JSON) to its text; `groups` maps a group file to its parsed sounds.
export function buildSoundbank(files: FileEntry[], sources: { path: string; text: string }[], groups: { path: string; sounds: string[] }[]): Soundbank {
  const audio = files.filter((f) => !f.dir && AUDIO.test(f.path));
  const entries: SoundEntry[] = audio.map((f) => {
    const kind: SoundEntry["kind"] = f.path.startsWith("music/") ? "music" : "effect";
    return { path: f.path, name: baseName(f.path), kind, size: f.size, memory: estimateMemory(f.path, f.size, kind), usedBy: [], inGroups: [], streamed: kind === "music" && /\.ogg$/i.test(f.path) };
  });
  const byName = new Map<string, SoundEntry[]>();
  for (const e of entries) (byName.get(e.name) ?? byName.set(e.name, []).get(e.name)!).push(e);
  const groupNames = new Set(groups.map((g) => baseName(g.path).replace(/\.group$/, "")));
  const missing: Soundbank["missing"] = [];
  for (const src of sources) {
    const names = src.path.endsWith(".lua") ? soundNamesIn(src.text) : jsonSoundNames(src.text);
    for (const { name } of names) {
      const hit = byName.get(name) ?? byName.get(baseName(name));
      if (hit) {
        for (const e of hit) if (!e.usedBy.includes(src.path)) e.usedBy.push(src.path);
      } else if (!groupNames.has(name) && !missing.some((m) => m.file === src.path && m.name === name)) missing.push({ file: src.path, name });
    }
  }
  const named: Soundbank["groups"] = groups.map((g) => ({ path: g.path, name: baseName(g.path).replace(/\.group$/, ""), sounds: g.sounds }));
  for (const g of named) for (const s of g.sounds) for (const e of byName.get(s) ?? []) if (!e.inGroups.includes(g.name)) e.inGroups.push(g.name);
  // a sound in a group is used when the group is
  for (const g of named) {
    const users = sources.filter((s) => (s.path.endsWith(".lua") ? soundNamesIn(s.text) : jsonSoundNames(s.text)).some((n) => n.name === g.name)).map((s) => s.path);
    if (users.length) for (const s of g.sounds) for (const e of byName.get(s) ?? []) for (const u of users) if (!e.usedBy.includes(u)) e.usedBy.push(u);
  }
  entries.sort((a, b) => b.memory - a.memory);
  return { sounds: entries, unused: entries.filter((e) => !e.usedBy.length && !e.inGroups.length), missing, groups: named, totalMemory: entries.reduce((n, e) => n + e.memory, 0) };
}

/// The sounds a JSON document names: the `"sound": "x"` of an animation's sound track or an object's setting.
export function jsonSoundNames(text: string): { name: string; music: boolean }[] {
  const out: { name: string; music: boolean }[] = [];
  for (const m of text.matchAll(/"(sound|music)"\s*:\s*"([^"]+)"/g)) out.push({ name: m[2]!, music: m[1] === "music" });
  return out;
}

export const MEMORY_BUDGET = { comfortable: 32 * 1024 * 1024, limit: 96 * 1024 * 1024 };
export const MAX_VOICES = 32;

export function budgetWords(totalMemory: number): { state: "fine" | "heavy" | "over"; text: string } {
  const mb = (totalMemory / 1048576).toFixed(1);
  if (totalMemory > MEMORY_BUDGET.limit) return { state: "over", text: `${mb} MB of sound in memory: more than a handheld should hold (about ${MEMORY_BUDGET.limit / 1048576} MB). Make long sounds Ogg music, or shorten them.` };
  if (totalMemory > MEMORY_BUDGET.comfortable) return { state: "heavy", text: `${mb} MB of sound in memory: past the comfortable ${MEMORY_BUDGET.comfortable / 1048576} MB.` };
  return { state: "fine", text: `${mb} MB of sound in memory, well inside what a handheld can hold.` };
}

/// Plain-words hints per sound: a long WAV that should be Ogg music, a very big effect.
export function hintFor(e: SoundEntry): string | null {
  if (e.kind === "effect" && /\.wav$/i.test(e.path) && e.size > 2 * 1024 * 1024) return "A long WAV: if it is music, put it in music/ as an Ogg so it streams instead of living in memory.";
  if (e.kind === "effect" && e.memory > 8 * 1024 * 1024) return "Very big for an effect (over 8 MB once decoded).";
  return null;
}

/// A group file's text for some sound names (the studio's Make a group button writes this).
export function groupFileText(sounds: string[], opts: { volume?: [number, number]; pitch?: [number, number]; pan?: [number, number]; noRepeat?: boolean } = {}): string {
  const o: Record<string, unknown> = { sounds };
  if (opts.volume) o.volume = opts.volume;
  if (opts.pitch) o.pitch = opts.pitch;
  if (opts.pan) o.pan = opts.pan;
  if (opts.noRepeat) o.no_repeat = true;
  return `${JSON.stringify(o, null, 2)}\n`;
}

export function parseGroup(text: string): { sounds: string[] } | null {
  try {
    const v = JSON.parse(text) as { sounds?: unknown };
    return Array.isArray(v?.sounds) && v.sounds.every((s) => typeof s === "string") ? { sounds: v.sounds as string[] } : null;
  } catch {
    return null;
  }
}
