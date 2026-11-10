// The arrangement: patterns (named runs of notes) and clips that place them on a track's timeline. Every edit returns a new song.
// A clip repeats its pattern to fill its length; "split" cuts a clip in two so that the second half carries on from where the first stopped.

import { MAX_CLIPS, MAX_NOTES, MAX_PATTERNS, clipNotes, type Clip, type Note, type Pattern, type Song, type Track } from "./song";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function edit(song: Song, track: number, change: (t: Track) => boolean | void): Song {
  if (!song.tracks[track]) return song;
  const next = clone(song);
  const t = next.tracks[track]!;
  if (change(t) === false) return song;
  if (t.patterns && !t.patterns.length) delete t.patterns;
  if (t.clips && !t.clips.length) delete t.clips;
  if (t.clips) t.clips.sort((a, b) => a.step - b.step);
  return next;
}

export const patternOf = (t: Track, name: string): Pattern | undefined => t.patterns?.find((p) => p.name === name);

const uniqueName = (t: Track, base: string) => {
  const used = new Set((t.patterns ?? []).map((p) => p.name));
  const b = base.trim() || "pattern";
  let name = b;
  for (let n = 2; used.has(name); n++) name = `${b}${n}`;
  return name;
};

/// Moves the notes that start in steps `from` up to `to` into a new pattern and puts one clip where they were. The pattern is `to - from` steps long.
export function makePattern(song: Song, track: number, from: number, to: number, name = "pattern"): { song: Song; name: string } | null {
  let made = "";
  const result = edit(song, track, (t) => {
    const a = Math.round(from);
    const b = Math.round(to);
    if (a < 0 || b <= a || b > song.length || (t.patterns?.length ?? 0) >= MAX_PATTERNS || (t.clips?.length ?? 0) >= MAX_CLIPS) return false;
    const inside = t.notes.filter((n) => n.step >= a && n.step < b);
    if (!inside.length) return false;
    made = uniqueName(t, name);
    t.notes = t.notes.filter((n) => !(n.step >= a && n.step < b));
    (t.patterns ??= []).push({ name: made, length: b - a, notes: inside.map((n) => ({ ...n, step: n.step - a, len: Math.min(n.len, b - n.step) })) });
    (t.clips ??= []).push({ pattern: made, step: a, len: b - a });
  });
  return result === song ? null : { song: result, name: made };
}

/// A clip of a pattern at a step, filling `len` steps (the pattern's length by default).
export function addClip(song: Song, track: number, pattern: string, step: number, len?: number): Song {
  return edit(song, track, (t) => {
    const p = patternOf(t, pattern);
    if (!p || (t.clips?.length ?? 0) >= MAX_CLIPS) return false;
    const at = clamp(Math.round(step), 0, song.length - 1);
    (t.clips ??= []).push({ pattern, step: at, len: clamp(Math.round(len ?? p.length), 1, song.length - at) });
  });
}

/// Moves a clip to a step (it stays inside the song).
export function moveClip(song: Song, track: number, index: number, step: number): Song {
  return edit(song, track, (t) => {
    const c = t.clips?.[index];
    if (!c) return false;
    c.step = clamp(Math.round(step), 0, Math.max(0, song.length - 1));
    c.len = Math.min(c.len, song.length - c.step);
  });
}

/// Sets how many steps a clip fills (longer than its pattern: it repeats; shorter: it is cut).
export function resizeClip(song: Song, track: number, index: number, len: number): Song {
  return edit(song, track, (t) => {
    const c = t.clips?.[index];
    if (!c) return false;
    c.len = clamp(Math.round(len), 1, song.length - c.step);
  });
}

/// The knife: cuts a clip at a step inside it. The second part continues the pattern from where the first stopped.
export function splitClip(song: Song, track: number, index: number, at: number): Song {
  return edit(song, track, (t) => {
    const c = t.clips?.[index];
    const p = c && patternOf(t, c.pattern);
    const cut = Math.round(at);
    if (!c || !p || cut <= c.step || cut >= c.step + c.len || t.clips!.length >= MAX_CLIPS) return false;
    const first = cut - c.step;
    const second: Clip = { ...c, step: cut, len: c.len - first, offset: ((c.offset ?? 0) + first) % p.length };
    if (!second.offset) delete second.offset;
    c.len = first;
    t.clips!.push(second);
  });
}

/// A copy of the clip placed right after it.
export function duplicateClip(song: Song, track: number, index: number): Song {
  return edit(song, track, (t) => {
    const c = t.clips?.[index];
    if (!c || t.clips!.length >= MAX_CLIPS || c.step + c.len >= song.length) return false;
    t.clips!.push({ ...c, step: c.step + c.len, len: Math.min(c.len, song.length - c.step - c.len) });
  });
}

export function deleteClip(song: Song, track: number, index: number): Song {
  return edit(song, track, (t) => {
    if (!t.clips?.[index]) return false;
    t.clips.splice(index, 1);
  });
}

export function updateClip(song: Song, track: number, index: number, change: Partial<Pick<Clip, "mute" | "color" | "pattern">>): Song {
  return edit(song, track, (t) => {
    const c = t.clips?.[index];
    if (!c || (change.pattern !== undefined && !patternOf(t, change.pattern))) return false;
    Object.assign(c, change);
    if (!c.mute) delete c.mute;
    if (!c.color) delete c.color;
  });
}

/// Turns a clip back into plain notes on the track (so it can be edited in the piano roll); null if that would pass the limit on notes.
export function unpackClip(song: Song, track: number, index: number): Song | null {
  const t = song.tracks[track];
  const c = t?.clips?.[index];
  if (!t || !c) return song;
  const notes = clipNotes(t, c, song.length);
  const total = song.tracks.reduce((n, x) => n + x.notes.length, 0) + notes.length;
  if (total > MAX_NOTES) return null;
  const seen = new Set(t.notes.map((n) => `${n.step}:${n.pitch}`));
  const fresh = notes.filter((n) => !seen.has(`${n.step}:${n.pitch}`));
  const next = deleteClip(song, track, index);
  return edit(next, track, (x) => void (x.notes = [...x.notes, ...fresh].sort((a, b) => a.step - b.step || a.pitch - b.pitch)));
}

/// Every clip of the track becomes notes and the patterns go (the arrangement is flattened); null if that would pass the limit on notes.
export function flattenTrack(song: Song, track: number): Song | null {
  const t = song.tracks[track];
  if (!t?.clips?.length) return song;
  const extra = t.clips.flatMap((c) => clipNotes(t, c, song.length));
  if (song.tracks.reduce((n, x) => n + x.notes.length, 0) + extra.length > MAX_NOTES) return null;
  const next = clone(song);
  const x = next.tracks[track]!;
  const seen = new Set(x.notes.map((n) => `${n.step}:${n.pitch}`));
  x.notes = [...x.notes, ...extra.filter((n) => !seen.has(`${n.step}:${n.pitch}`))].sort((a, b) => a.step - b.step || a.pitch - b.pitch);
  delete x.clips;
  delete x.patterns;
  return next;
}

export function renamePattern(song: Song, track: number, name: string, to: string): Song {
  return edit(song, track, (t) => {
    const p = patternOf(t, name);
    const wanted = to.trim();
    if (!p || !wanted || wanted === name || patternOf(t, wanted)) return false;
    p.name = wanted;
    for (const c of t.clips ?? []) if (c.pattern === name) c.pattern = wanted;
  });
}

/// Deletes a pattern and every clip that uses it.
export function deletePattern(song: Song, track: number, name: string): Song {
  return edit(song, track, (t) => {
    if (!patternOf(t, name)) return false;
    t.patterns = t.patterns!.filter((p) => p.name !== name);
    t.clips = (t.clips ?? []).filter((c) => c.pattern !== name);
  });
}

/// Replaces a pattern's notes (for a pattern editor); notes outside its length are dropped.
export function setPatternNotes(song: Song, track: number, name: string, notes: Note[]): Song {
  return edit(song, track, (t) => {
    const p = patternOf(t, name);
    if (!p) return false;
    p.notes = notes.filter((n) => n.step >= 0 && n.step < p.length).map((n) => ({ ...n, len: Math.min(n.len, p.length - n.step) }));
  });
}

// ---- editing a pattern in the piano roll ---------------------------------------------------------------------

/// The song as the piano roll shows it while one pattern is being edited: the track holds just that pattern's notes (as the track's own), the song is as long as the pattern,
/// and everything else is quiet (the other tracks muted, no loop region), so the roll, the ruler and Play all work on the pattern alone. Null when the pattern is not there.
export function patternView(song: Song, track: number, name: string): Song | null {
  const t = song.tracks[track];
  const p = t && patternOf(t, name);
  if (!t || !p) return null;
  const view = clone(song);
  view.length = Math.max(1, p.length);
  delete view.loop;
  if (view.tempos) view.tempos = view.tempos.filter((x) => x.step < view.length);
  if (!view.tempos?.length) delete view.tempos;
  view.markers = (view.markers ?? []).filter((m) => m.step <= view.length);
  if (!view.markers.length) delete view.markers;
  view.tracks.forEach((x, i) => {
    if (i !== track) x.mute = true;
  });
  const mine = view.tracks[track]!;
  mine.notes = clone(p.notes);
  delete mine.patterns;
  delete mine.clips;
  return view;
}

/// Puts an edited view back: the track's notes become the pattern's, a changed song length becomes the pattern's length, and the track's own settings (voice, volume, ...) carry
/// over; nothing else of the view (muted other tracks, the loop) does.
export function applyPatternView(song: Song, track: number, name: string, view: Song): Song {
  const edited = view.tracks[track];
  const t = song.tracks[track];
  const p = t && patternOf(t, name);
  if (!edited || !t || !p) return song;
  const next = clone(song);
  const nt = next.tracks[track]!;
  const settings = clone(edited) as Partial<Track>;
  delete settings.notes;
  delete settings.patterns;
  delete settings.clips;
  Object.assign(nt, settings);
  const np = patternOf(nt, name)!;
  np.length = clamp(Math.round(view.length), 1, 4096);
  np.notes = clone(edited.notes)
    .filter((n) => n.step >= 0 && n.step < np.length)
    .map((n) => ({ ...n, len: Math.min(n.len, np.length - n.step) }));
  return next;
}
