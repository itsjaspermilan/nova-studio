// The timeline editor's data model: a parsed `animations/<name>.anim.json` (format: docs/project-format.md, checked by the
// runtime's anim.rs, played by lua/anim.lua) plus pure edit operations. Every edit returns a new document, so undo keeps
// the old one. `sample` works out a track's value at a time exactly as the game does, for the editor's preview.

export type TrackType = "value" | "event" | "sound";
export type Ease = string | [number, number, number, number];
export type Value = number | number[];

export interface ValueKey {
  time: number;
  value: Value;
  ease?: Ease;
}
export interface EventKey {
  time: number;
  call: string;
  args?: unknown[];
}
export interface SoundKey {
  time: number;
  sound: string;
  volume?: number;
  pitch?: number;
  pan?: number;
}
export type Key = ValueKey | EventKey | SoundKey;

export interface Track {
  type?: TrackType;
  name?: string;
  target?: string;
  field?: string;
  relative?: boolean;
  keys: Key[];
}
export interface AnimDoc {
  version: number;
  length: number;
  loop?: boolean;
  notes?: string;
  tracks: Track[];
}

/// The easings a key can name, as the runtime knows them (anim.rs EASES), with plain words for the menu.
export const EASES: { id: string; label: string }[] = [
  { id: "linear", label: "Steady (linear)" },
  { id: "step", label: "Jump (hold, then step)" },
  { id: "in_quad", label: "Speed up (in quad)" },
  { id: "out_quad", label: "Slow down (out quad)" },
  { id: "in_out_quad", label: "Speed up, slow down (in-out quad)" },
  { id: "in_cubic", label: "Speed up more (in cubic)" },
  { id: "out_cubic", label: "Slow down more (out cubic)" },
  { id: "in_out_cubic", label: "Smooth (in-out cubic)" },
  { id: "in_sine", label: "Gentle start (in sine)" },
  { id: "out_sine", label: "Gentle stop (out sine)" },
  { id: "in_out_sine", label: "Gentle both (in-out sine)" },
  { id: "in_back", label: "Wind up (in back)" },
  { id: "out_back", label: "Overshoot (out back)" },
  { id: "in_out_back", label: "Wind up, overshoot (in-out back)" },
  { id: "out_bounce", label: "Bounce (out bounce)" },
  { id: "out_elastic", label: "Spring (out elastic)" },
];
const EASE_IDS = new Set(EASES.map((e) => e.id));
/// Fields people animate most, offered in the track menu (any number field works).
export const COMMON_FIELDS = ["x", "y", "z", "angle", "ry", "sx", "sy", "alpha", "tint"];
/// Fields of the "camera" target.
export const CAMERA_FIELDS = ["x", "y", "eye_x", "eye_y", "eye_z", "target_x", "target_y", "target_z", "fov"];
export const MAX_TRACKS = 256;

export const typeOf = (t: Track): TrackType => t.type ?? "value";
export const targetOf = (t: Track): string => t.target ?? "self";
/// What the track list shows for a track.
export function trackLabel(t: Track): string {
  if (t.name) return t.name;
  const type = typeOf(t);
  if (type === "sound") return "Sounds";
  if (type === "event") return `${targetOf(t)} · calls`;
  return `${targetOf(t)}.${t.field ?? "?"}`;
}

export const animName = (path: string) => path.replace(/^animations\//, "").replace(/\.anim\.json$/i, "");
export const animOf = (name: string) => `animations/${name}.anim.json`;

export function newAnim(): AnimDoc {
  return {
    version: 1,
    length: 1,
    loop: false,
    tracks: [{ target: "self", field: "x", relative: true, keys: [{ time: 0, value: 0, ease: "out_quad" }, { time: 1, value: 100 }] }],
  };
}

export type Parsed = { ok: true; doc: AnimDoc } | { ok: false; error: string };

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/// Reads a file loosely (what the runtime would refuse shows in the Problems panel); fills `length` when it is missing.
export function parseAnim(text: string): Parsed {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `not valid JSON: ${e instanceof Error ? e.message : e}` };
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return { ok: false, error: "an animation file is a JSON object" };
  const doc = v as AnimDoc;
  if (doc.version !== 1) return { ok: false, error: `"version" must be 1` };
  if (doc.tracks === undefined) doc.tracks = [];
  if (!Array.isArray(doc.tracks)) return { ok: false, error: `"tracks" must be a list` };
  for (const [i, t] of doc.tracks.entries()) {
    if (!t || typeof t !== "object") return { ok: false, error: `tracks[${i}] must be an object` };
    if (t.keys === undefined) t.keys = [];
    if (!Array.isArray(t.keys)) return { ok: false, error: `tracks[${i}].keys must be a list` };
    for (const [j, k] of t.keys.entries()) if (!k || typeof k !== "object" || !isNum(k.time)) return { ok: false, error: `tracks[${i}].keys[${j}] needs a "time"` };
  }
  if (!isNum(doc.length)) doc.length = Math.max(0.1, ...doc.tracks.flatMap((t) => t.keys.map((k) => k.time)));
  return { ok: true, doc };
}

const show = (v: unknown) => (Array.isArray(v) && v.every(isNum) ? `[${v.join(", ")}]` : JSON.stringify(v));
/// The file as people read it: one line per key.
export function serializeAnim(doc: AnimDoc): string {
  const head: Record<string, unknown> = { version: 1, length: doc.length };
  if (doc.loop) head.loop = true;
  else head.loop = false;
  if (doc.notes) head.notes = doc.notes;
  const lines = Object.entries(head).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
  const tracks = doc.tracks.map((t) => {
    const { keys, ...rest } = t;
    const fields = Object.entries(rest).filter(([, v]) => v !== undefined).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`);
    const body = keys.map((k) => `        { ${Object.entries(k).filter(([, v]) => v !== undefined).map(([p, v]) => `${JSON.stringify(p)}: ${show(v)}`).join(", ")} }`).join(",\n");
    return `    {\n      ${[...fields, `"keys": [${keys.length ? `\n${body}\n      ` : ""}]`].join(",\n      ")}\n    }`;
  });
  return `{\n${lines.join("\n")}\n  "tracks": [${tracks.length ? `\n${tracks.join(",\n")}\n  ` : ""}]\n}\n`;
}

// ---- curves: the same formulas as crates/nova-runtime/lua/timers.lua ------------------------------------------------
const EASE_FN: Record<string, (t: number) => number> = {
  linear: (t) => t,
  in_quad: (t) => t * t,
  out_quad: (t) => 1 - (1 - t) * (1 - t),
  in_out_quad: (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  in_cubic: (t) => t * t * t,
  out_cubic: (t) => 1 - (1 - t) ** 3,
  in_out_cubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  in_sine: (t) => 1 - Math.cos((t * Math.PI) / 2),
  out_sine: (t) => Math.sin((t * Math.PI) / 2),
  in_out_sine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  in_back: (t) => 2.70158 * t * t * t - 1.70158 * t * t,
  in_out_back: (t) => {
    const c2 = 1.70158 * 1.525;
    return t < 0.5 ? ((2 * t) ** 2 * ((c2 + 1) * 2 * t - c2)) / 2 : ((2 * t - 2) ** 2 * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2;
  },
  out_elastic: (t) => (t <= 0 ? 0 : t >= 1 ? 1 : 2 ** (-10 * t) * Math.sin(((t * 10 - 0.75) * (2 * Math.PI)) / 3) + 1),
  out_back: (t) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2,
  out_bounce: (t) => {
    const n1 = 7.5625, d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
};

/// A CSS-style cubic-bezier(x1, y1, x2, y2) at x (the same search as lua/anim.lua).
export function bezier([x1, y1, x2, y2]: [number, number, number, number], x: number): number {
  const X = (s: number) => ((1 - 3 * x2 + 3 * x1) * s + (3 * x2 - 6 * x1)) * s * s + 3 * x1 * s;
  const Y = (s: number) => ((1 - 3 * y2 + 3 * y1) * s + (3 * y2 - 6 * y1)) * s * s + 3 * y1 * s;
  let s = x;
  for (let i = 0; i < 8; i++) {
    const d = 3 * (1 - 3 * x2 + 3 * x1) * s * s + 2 * (3 * x2 - 6 * x1) * s + 3 * x1;
    if (Math.abs(d) < 1e-6) break;
    const next = s - (X(s) - x) / d;
    if (next < 0 || next > 1) break;
    s = next;
  }
  if (Math.abs(X(s) - x) > 1e-4) {
    let lo = 0, hi = 1;
    s = x;
    for (let i = 0; i < 30; i++) {
      if (X(s) < x) lo = s;
      else hi = s;
      s = (lo + hi) / 2;
    }
  }
  return Y(s);
}

/// How far (0 at the key, 1 at the next; it may overshoot) a key's ease has gone at fraction k of the way.
export function eased(e: Ease | undefined, k: number): number {
  if (Array.isArray(e)) return bezier(e, k);
  if (e === "step") return 0;
  return (EASE_FN[e ?? "linear"] ?? EASE_FN.linear!)(k);
}
export const knownEase = (e: unknown): boolean => (Array.isArray(e) ? e.length === 4 && e.every(isNum) : typeof e === "string" && EASE_IDS.has(e));

const EPS = 1e-7;
const byTime = (keys: Key[]) => [...keys].sort((a, b) => a.time - b.time);

/// A value track's value at time t (first key's before it, last key's after), or null for a track with no keys.
export function sample(track: Track, t: number): Value | null {
  const keys = byTime(track.keys) as ValueKey[];
  if (!keys.length) return null;
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1]!.time <= t + EPS) i++;
  const a = keys[i]!, b = keys[i + 1];
  let k = 0;
  if (b && t > a.time && b.time > a.time) k = eased(a.ease, (t - a.time) / (b.time - a.time));
  if (typeof a.value === "number") return b && k !== 0 ? a.value + ((b.value as number) - a.value) * k : a.value;
  return a.value.map((v, j) => (b && k !== 0 ? v + (((b.value as number[])[j] ?? v) - v) * k : v));
}

/// Event and sound keys passed going from a to b (a < b: in (a, b]; `closed` includes a), for the preview's beeps and flashes.
export function crossed(doc: AnimDoc, a: number, b: number, closed = false): { track: number; key: number }[] {
  const out: { track: number; key: number }[] = [];
  doc.tracks.forEach((t, ti) => {
    if (typeOf(t) === "value") return;
    t.keys.forEach((k, ki) => {
      if ((k.time > a + EPS || (closed && k.time >= a - EPS)) && k.time <= b + EPS) out.push({ track: ti, key: ki });
    });
  });
  return out.sort((x, y) => doc.tracks[x.track]!.keys[x.key]!.time - doc.tracks[y.track]!.keys[y.key]!.time);
}

// ---- edits -------------------------------------------------------------------------------------------------------------
const round = (t: number) => Math.round(t * 1000) / 1000;
/// A time kept within the animation, rounded to a millisecond, and to `snap` seconds when it is above 0.
export function snapTime(t: number, length: number, snap = 0): number {
  const s = snap > 0 ? Math.round(t / snap) * snap : t;
  return round(Math.max(0, Math.min(length, s)));
}

const withTrack = (doc: AnimDoc, i: number, f: (t: Track) => Track): AnimDoc => ({ ...doc, tracks: doc.tracks.map((t, j) => (j === i ? f(t) : t)) });

export function addTrack(doc: AnimDoc, track: Track): { doc: AnimDoc; index: number } {
  if (doc.tracks.length >= MAX_TRACKS) return { doc, index: doc.tracks.length - 1 };
  return { doc: { ...doc, tracks: [...doc.tracks, track] }, index: doc.tracks.length };
}
export const removeTrack = (doc: AnimDoc, i: number): AnimDoc => ({ ...doc, tracks: doc.tracks.filter((_, j) => j !== i) });
export function moveTrack(doc: AnimDoc, i: number, by: number): AnimDoc {
  const j = i + by;
  if (j < 0 || j >= doc.tracks.length) return doc;
  const tracks = [...doc.tracks];
  [tracks[i], tracks[j]] = [tracks[j]!, tracks[i]!];
  return { ...doc, tracks };
}
/// Sets one of a track's own settings (target, field, relative, name); undefined removes it.
export function setTrackField(doc: AnimDoc, i: number, key: "target" | "field" | "relative" | "name", value: string | boolean | undefined): AnimDoc {
  return withTrack(doc, i, (t) => {
    const next: Track = { ...t };
    if (value === undefined || value === "") delete next[key];
    else (next as unknown as Record<string, unknown>)[key] = value;
    return next;
  });
}

/// A new key for a track at time t: a value track's takes the value the track has there, so adding a key changes nothing yet.
export function keyFor(track: Track, t: number, sounds: string[] = []): Key {
  const type = typeOf(track);
  if (type === "event") return { time: t, call: (track.keys.at(-1) as EventKey | undefined)?.call ?? "on_key" };
  if (type === "sound") return { time: t, sound: (track.keys.at(-1) as SoundKey | undefined)?.sound ?? sounds[0] ?? "sound" };
  const v = sample(track, t);
  const field = track.field ?? "";
  const fallback: Value = /^(tint|color)$/.test(field) ? [255, 255, 255] : field === "alpha" || field === "sx" || field === "sy" ? 1 : 0;
  return { time: t, value: v === null ? fallback : Array.isArray(v) ? v.map((n) => Math.round(n * 1000) / 1000) : Math.round(v * 1000) / 1000 };
}

/// Adds a key, keeping the keys in time order; returns where it went.
export function addKey(doc: AnimDoc, ti: number, key: Key): { doc: AnimDoc; index: number } {
  const keys = byTime([...doc.tracks[ti]!.keys, key]);
  return { doc: withTrack(doc, ti, (t) => ({ ...t, keys })), index: keys.indexOf(key) };
}
export const removeKey = (doc: AnimDoc, ti: number, ki: number): AnimDoc => withTrack(doc, ti, (t) => ({ ...t, keys: t.keys.filter((_, j) => j !== ki) }));
/// Moves a key to a new time and puts the keys back in order; returns the key's new index.
export function moveKey(doc: AnimDoc, ti: number, ki: number, time: number): { doc: AnimDoc; index: number } {
  const moved = { ...doc.tracks[ti]!.keys[ki]!, time } as Key;
  const keys = byTime(doc.tracks[ti]!.keys.map((k, j) => (j === ki ? moved : k)));
  return { doc: withTrack(doc, ti, (t) => ({ ...t, keys })), index: keys.indexOf(moved) };
}
/// Changes some of a key's settings (not its time: use moveKey); an undefined value removes the setting.
export function setKey(doc: AnimDoc, ti: number, ki: number, patch: Record<string, unknown>): AnimDoc {
  return withTrack(doc, ti, (t) => ({
    ...t,
    keys: t.keys.map((k, j) => {
      if (j !== ki) return k;
      const next: Record<string, unknown> = { ...k, ...patch };
      for (const [p, v] of Object.entries(patch)) if (v === undefined) delete next[p];
      return next as unknown as Key;
    }),
  }));
}
export function setLength(doc: AnimDoc, length: number): AnimDoc {
  const last = Math.max(0, ...doc.tracks.flatMap((t) => t.keys.map((k) => k.time)));
  return { ...doc, length: round(Math.max(0.05, last, Math.min(3600, length))) };
}
export const setLoop = (doc: AnimDoc, loop: boolean): AnimDoc => ({ ...doc, loop });

/// Reads a value typed in the inspector: "12.5" or "255, 180, 60" (a list, for colours); null when it is not one.
export function parseValue(raw: string): Value | null {
  const parts = raw.split(/[\s,]+/).filter(Boolean).map(Number);
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return null;
  return parts.length === 1 && !raw.includes(",") ? parts[0]! : parts;
}
export const showValue = (v: Value | null | undefined): string => (v == null ? "" : Array.isArray(v) ? v.map((n) => +n.toFixed(3)).join(", ") : String(+v.toFixed(3)));

/// What the runtime would refuse, said plainly, for the editor to show before the game is run (anim.rs is the real check).
export function problems(doc: AnimDoc): string[] {
  const out: string[] = [];
  doc.tracks.forEach((t, i) => {
    const label = `${i + 1} (${trackLabel(t)})`;
    const type = typeOf(t);
    if (type === "value") {
      if (!t.field || !/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(t.field)) out.push(`Track ${label}: the field must be a name like x or hud.alpha.`);
      const kinds = new Set((t.keys as ValueKey[]).map((k) => (Array.isArray(k.value) ? k.value.length : 0)));
      if (kinds.size > 1) out.push(`Track ${label}: every key needs the same kind of value (all numbers, or all lists of the same length).`);
      for (const k of t.keys as ValueKey[]) if (k.ease !== undefined && !knownEase(k.ease)) out.push(`Track ${label}: unknown ease at ${k.time} s.`);
    } else if (type === "event") {
      for (const k of t.keys as EventKey[]) if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k.call ?? "")) out.push(`Track ${label}: the function name at ${k.time} s must be letters, digits and _.`);
    }
    for (const k of t.keys) if (k.time > doc.length + 1e-9) out.push(`Track ${label}: a key at ${k.time} s is after the end (${doc.length} s).`);
  });
  return out;
}
