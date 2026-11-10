// Standard MIDI files: writing a song as a type 1 file (a tempo and time-signature track, then one track per song track, drums on channel 10) and
// reading one back into a song. Notes are put on the song's step grid; a file with finer timing is rounded to it and the loss is reported.

import { DRUMS, MAX_NOTES, bpmAt, tempoSegments, expandClips, MAX_STEPS, MAX_TRACKS, MAX_BPM, MIN_BPM, drumTrack, synthTrack, type Note, type Song, type Track } from "./song";

const PPQ = 480;

// ---- writing --------------------------------------------------------------------------------------

const vlq = (n: number): number[] => {
  const out = [n & 0x7f];
  while ((n >>= 7) > 0) out.unshift((n & 0x7f) | 0x80);
  return out;
};
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n: number) => [(n >> 8) & 255, n & 255];
const text = (s: string) => [...new TextEncoder().encode(s)];
const chunk = (id: string, body: number[]) => [...text(id), ...u32(body.length), ...body];

interface Ev {
  tick: number;
  /// Sorting order at the same tick: note-offs before note-ons so a repeated pitch is not cut.
  order: number;
  bytes: number[];
}

function trackBytes(events: Ev[]): number[] {
  const sorted = [...events].sort((a, b) => a.tick - b.tick || a.order - b.order);
  const body: number[] = [];
  let at = 0;
  for (const e of sorted) {
    body.push(...vlq(e.tick - at), ...e.bytes);
    at = e.tick;
  }
  body.push(...vlq(0), 0xff, 0x2f, 0x00);
  return chunk("MTrk", body);
}

export function songToMidi(source: Song): Uint8Array {
  const song = expandClips(source);
  const tps = PPQ / song.stepsPerBeat; // ticks per step
  const tempo: Ev[] = [
    { tick: 0, order: 0, bytes: [0xff, 0x51, 0x03, ...u32(Math.round(60_000_000 / song.bpm)).slice(1)] },
    // time signature: beats per bar over 4; a bar of 4 steps-per-beat quarter notes
    { tick: 0, order: 0, bytes: [0xff, 0x58, 0x04, song.beatsPerBar ?? 4, 2, 24, 8] },
    { tick: 0, order: 0, bytes: [0xff, 0x03, ...vlq(5), ...text("Tempo")] },
  ];
  // (a glide is written as a tempo change at every step along it: MIDI has no ramps)
  for (const g of tempoSegments(song)) {
    if (!g.glide) continue;
    for (let s = g.from + 1; s < g.to; s++) tempo.push({ tick: Math.round(s * tps), order: 0, bytes: [0xff, 0x51, 0x03, ...u32(Math.round(60_000_000 / bpmAt(song, s))).slice(1)] });
  }
  for (const tc of song.tempos ?? []) tempo.push({ tick: Math.round(tc.step * tps), order: 0, bytes: [0xff, 0x51, 0x03, ...u32(Math.round(60_000_000 / tc.bpm)).slice(1)] });
  for (const mc of song.meters ?? []) tempo.push({ tick: Math.round(mc.step * tps), order: 0, bytes: [0xff, 0x58, 0x04, mc.beats, 2, 24, 8] });
  for (const m of song.markers ?? []) tempo.push({ tick: Math.round(m.step * tps), order: 1, bytes: [0xff, 0x06, ...vlq(text(m.name).length), ...text(m.name)] });
  const tracks: number[][] = [trackBytes(tempo)];
  let melodic = 0;
  for (const t of song.tracks) {
    const ch = t.kind === "drums" ? 9 : melodic++ % 9; // channels 1 to 9 for synths, 10 for drums (a tenth and later synth shares)
    const evs: Ev[] = [{ tick: 0, order: 0, bytes: [0xff, 0x03, ...vlq(text(t.name).length), ...text(t.name)] }];
    for (const n of t.notes) {
      const on = Math.round(n.step * tps);
      const off = Math.round((n.step + (t.kind === "drums" ? 1 : n.len)) * tps);
      const vel = Math.max(1, Math.min(127, Math.round(n.vel * 127)));
      evs.push({ tick: on, order: 2, bytes: [0x90 | ch, n.pitch & 127, vel] });
      evs.push({ tick: off, order: 1, bytes: [0x80 | ch, n.pitch & 127, 0] });
    }
    tracks.push(trackBytes(evs));
  }
  return Uint8Array.from([...chunk("MThd", [...u16(1), ...u16(tracks.length), ...u16(PPQ)]), ...tracks.flat()]);
}

// ---- reading --------------------------------------------------------------------------------------

export interface MidiImport {
  song: Song;
  /// Things the person should know: notes rounded to the grid, tracks or notes left out, a different time signature.
  warnings: string[];
}

class Reader {
  at = 0;
  constructor(public b: Uint8Array) {}
  get done() {
    return this.at >= this.b.length;
  }
  u8() {
    if (this.at >= this.b.length) throw new Error("The file ends too soon.");
    return this.b[this.at++]!;
  }
  u16() {
    return (this.u8() << 8) | this.u8();
  }
  u32() {
    return ((this.u8() << 24) | (this.u8() << 16) | (this.u8() << 8) | this.u8()) >>> 0;
  }
  vlq() {
    let n = 0;
    for (let i = 0; i < 4; i++) {
      const c = this.u8();
      n = (n << 7) | (c & 0x7f);
      if (!(c & 0x80)) return n;
    }
    throw new Error("A time value in the file is too long.");
  }
  str(len: number) {
    const s = new TextDecoder().decode(this.b.subarray(this.at, this.at + len));
    this.at += len;
    return s;
  }
}

/// The song drum pitch nearest a General MIDI drum note.
const GM_DRUMS: Record<number, number> = { 35: 36, 36: 36, 37: 38, 38: 38, 39: 39, 40: 38, 41: 45, 42: 42, 43: 45, 44: 42, 45: 45, 46: 46, 47: 45, 48: 45, 49: 49, 50: 45, 51: 49, 52: 49, 53: 49, 55: 49, 57: 49, 59: 49, 69: 42, 70: 42, 82: 42 };
const drumPitch = (p: number) => GM_DRUMS[p] ?? DRUMS.reduce((best, d) => (Math.abs(d.pitch - p) < Math.abs(best.pitch - p) ? d : best), DRUMS[0]!).pitch;

export function midiToSong(bytes: Uint8Array, stepsPerBeat = 4): MidiImport {
  const r = new Reader(bytes);
  if (r.str(4) !== "MThd") throw new Error("This is not a MIDI file (it does not start with MThd).");
  if (r.u32() < 6) throw new Error("The MIDI header is too short.");
  const format = r.u16();
  const count = r.u16();
  const division = r.u16();
  if (format > 1) throw new Error("Only MIDI files of type 0 and 1 can be read (this one is type 2).");
  if (division & 0x8000) throw new Error("This MIDI file counts time in frames (SMPTE), not beats; it cannot be read.");
  const ppq = division;
  const tps = ppq / stepsPerBeat;
  const warnings: string[] = [];
  let bpm = 120;
  let bpmSeen = false;
  let beatsPerBar = 4;
  const markers: { step: number; name: string }[] = [];
  const tempoChanges: { step: number; bpm: number }[] = [];
  const found: { name: string; drums: boolean; notes: Note[]; channel: number }[] = [];
  let rounded = 0;
  let endTick = 0;
  for (let t = 0; t < count && !r.done; t++) {
    if (r.str(4) !== "MTrk") throw new Error("A track in the MIDI file is damaged (no MTrk).");
    const len = r.u32();
    const end = r.at + len;
    let tick = 0;
    let status = 0;
    let name = "";
    const open = new Map<string, { tick: number; vel: number }>();
    const perChannel = new Map<number, { notes: { start: number; end: number; pitch: number; vel: number }[] }>();
    while (r.at < end) {
      tick += r.vlq();
      let b = r.u8();
      if (b === 0xff) {
        const type = r.u8();
        const n = r.vlq();
        if (type === 0x51 && n === 3) {
          const us = (r.u8() << 16) | (r.u8() << 8) | r.u8();
          const here = Math.round(60_000_000 / us);
          if (!bpmSeen) {
            bpm = here;
            bpmSeen = true;
          } else if (tick > 0) tempoChanges.push({ step: Math.round(tick / tps), bpm: here });
        } else if (type === 0x58 && n >= 2) {
          const num = r.u8();
          r.at += n - 1;
          if (t === 0 || format === 0) beatsPerBar = num;
        } else if (type === 0x03) name = r.str(n);
        else if (type === 0x06) markers.push({ step: Math.round(tick / tps), name: r.str(n) });
        else r.at += n;
        if (type === 0x2f) break;
        continue;
      }
      if (b === 0xf0 || b === 0xf7) {
        r.at += r.vlq();
        continue;
      }
      if (b & 0x80) status = b;
      else r.at--; // running status: the byte was data
      b = status;
      const kind = b & 0xf0;
      const ch = b & 15;
      if (kind === 0x90 || kind === 0x80) {
        const pitch = r.u8();
        const vel = r.u8();
        const key = `${ch}:${pitch}`;
        const isOn = kind === 0x90 && vel > 0;
        if (isOn) {
          open.set(key, { tick, vel });
        } else {
          const o = open.get(key);
          if (o) {
            open.delete(key);
            (perChannel.get(ch) ?? perChannel.set(ch, { notes: [] }).get(ch)!).notes.push({ start: o.tick, end: tick, pitch, vel: o.vel });
          }
        }
      } else if (kind === 0xc0 || kind === 0xd0) r.u8();
      else r.at += 2;
    }
    r.at = end;
    for (const [ch, { notes }] of perChannel) {
      const drums = ch === 9;
      const list: Note[] = [];
      for (const n of notes) {
        const step = Math.round(n.start / tps);
        const lenSteps = Math.max(1, Math.round((n.end - n.start) / tps));
        if (Math.abs(step * tps - n.start) > tps * 0.01) rounded++;
        list.push({ step, len: drums ? 1 : lenSteps, pitch: drums ? drumPitch(n.pitch) : n.pitch, vel: Math.max(0.05, Math.min(1, n.vel / 127)) });
        endTick = Math.max(endTick, n.end);
      }
      if (list.length) found.push({ name: name || (drums ? "drums" : `track ${found.length + 1}`), drums, notes: list, channel: ch });
    }
  }
  if (!found.length) throw new Error("There are no notes in this MIDI file.");
  if (bpm < MIN_BPM || bpm > MAX_BPM) {
    warnings.push(`The tempo (${bpm} BPM) is outside ${MIN_BPM} to ${MAX_BPM}, so ${bpm < MIN_BPM ? MIN_BPM : MAX_BPM} is used.`);
    bpm = Math.min(MAX_BPM, Math.max(MIN_BPM, bpm));
  }
  const bar = stepsPerBeat * beatsPerBar;
  let length = Math.max(bar, Math.ceil(endTick / tps / bar) * bar);
  if (length > MAX_STEPS) {
    warnings.push(`The piece is ${length} steps long; only the first ${MAX_STEPS} are kept.`);
    length = MAX_STEPS;
  }
  const tracks: Track[] = [];
  let notesKept = 0;
  let dropped = 0;
  for (const f of found) {
    if (tracks.length >= MAX_TRACKS) {
      dropped++;
      continue;
    }
    const t = f.drums ? drumTrack(f.name) : synthTrack(f.name, tracks.length % 2 ? "saw" : "square");
    // notes on the same step and pitch are one note; notes past the end or past the note limit are left out
    const seen = new Set<string>();
    for (const n of f.notes.sort((a, b) => a.step - b.step || a.pitch - b.pitch)) {
      if (n.step >= length || notesKept >= MAX_NOTES) continue;
      const key = `${n.step}:${n.pitch}`;
      if (seen.has(key)) continue;
      seen.add(key);
      t.notes.push({ ...n, len: Math.min(n.len, length - n.step) });
      notesKept++;
    }
    tracks.push(t);
  }
  if (dropped) warnings.push(`${dropped} track${dropped === 1 ? " was" : "s were"} left out: a song has at most ${MAX_TRACKS} tracks.`);
  if (rounded) warnings.push(`${rounded} note${rounded === 1 ? " was" : "s were"} moved to the song's grid of ${stepsPerBeat} steps a beat.`);
  const song: Song = { version: 1, bpm, stepsPerBeat, length, tracks };
  if (beatsPerBar !== 4) song.beatsPerBar = Math.min(16, Math.max(1, beatsPerBar));
  // tempo changes inside the song, on the grid, inside the allowed range, one a step
  const seenStep = new Set<number>([0]);
  const tempos = tempoChanges
    .filter((t) => t.step > 0 && t.step < length && t.bpm >= MIN_BPM && t.bpm <= MAX_BPM && !seenStep.has(t.step) && seenStep.add(t.step))
    .sort((a, b) => a.step - b.step)
    .slice(0, 64);
  if (tempos.length) song.tempos = tempos;
  if (tempoChanges.length > tempos.length) warnings.push(`${tempoChanges.length - tempos.length} tempo changes were left out (outside the song, outside ${MIN_BPM} to ${MAX_BPM}, or more than 64).`);
  const ms = markers.filter((m) => m.step >= 0 && m.step <= length).sort((a, b) => a.step - b.step).slice(0, 64);
  if (ms.length) song.markers = ms;
  return { song, warnings };
}
