// What the makers' test files share (makers.test.ts and the makers-*.test.ts beside it). The slowest of the makers' tests (every
// detailed figure, every song) are in files of their own because vitest runs the tests of one file one after another and the
// files side by side: in one file they took nearly three minutes while the rest of the studio's tests were long done.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect } from "vitest";
import { parseSong, serializeSong } from "../../src/lib/song";
import { parseSheetJson } from "../../src/lib/sprite-doc";
import { parseTileset } from "../../src/lib/tileset";
import { call } from "../server";

/// A new empty project folder for each test of the file that calls it, and the calls the tests make in it.
export function makersFolder() {
  let dir = "";
  beforeEach(() => (dir = mkdtempSync(join(tmpdir(), "nova-makers-test-"))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  // (the first line of an answer with a picture is its path: the tests read what follows it; one test checks the line)
  const text = (r: ReturnType<typeof call>) => (r.content[0] as { text: string }).text.replace(/^picture: [^\n]*\n/, "");
  const use = (name: string, args: Record<string, unknown> = {}, project = dir) => call(name, { project, ...args });
  const bytes = (rel: string, project = dir) => readFileSync(join(project, rel));
  const sheet = (name: string) => {
    const p = parseSheetJson(bytes(`sprites/${name}.sprite.json`).toString());
    if (!p.ok) throw new Error(p.error);
    return p.json;
  };
  const tileset = (name: string) => {
    const p = parseTileset(bytes(`sprites/${name}.tileset.json`).toString());
    if (!p.ok) throw new Error(p.error);
    return p.doc;
  };
  /// The same call in a second folder: what it writes must be the same, byte for byte.
  const again = (tool: string, args: Record<string, unknown>, files: string[]) => {
    const other = mkdtempSync(join(tmpdir(), "nova-makers-again-"));
    try {
      use(tool, args, other);
      for (const f of files) expect(bytes(f, other).equals(bytes(f)), `${f} is the same when made again`).toBe(true);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  };
  return { folder: () => dir, text, use, bytes, sheet, tileset, again };
}
export type Makers = ReturnType<typeof makersFolder>;

export const CITY_DIRS = ["down", "left", "right", "up"];

/// Whether a picture (or a part of it) has the colour in it: exactly, or within `near` (light blended over what is under it).
export const accentIn = (png: { w: number; h: number; data: Uint8Array | Uint8ClampedArray }, hexColour: string, x0 = 0, y0 = 0, w = png.w, h = png.h, near = 0) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hexColour.slice(i, i + 2), 16));
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const o = (y * png.w + x) * 4;
    if (png.data[o + 3]! > 0 && Math.abs(png.data[o]! - r!) + Math.abs(png.data[o + 1]! - g!) + Math.abs(png.data[o + 2]! - b!) <= near) return true;
  }
  return false;
};

/// One frame of a sheet as its own pixels.
export const frameOf = (png: { w: number; data: Uint8Array | Uint8ClampedArray }, json: { columns?: number; frame_width: number; frame_height: number }, n: number) => {
  const c = json.columns!, fw = json.frame_width, fh = json.frame_height, out = new Uint8Array(fw * fh * 4);
  for (let y = 0; y < fh; y++) out.set(png.data.subarray(((Math.floor(n / c) * fh + y) * png.w + (n % c) * fw) * 4, ((Math.floor(n / c) * fh + y) * png.w + (n % c) * fw + fw) * 4), y * fw * 4);
  return out;
};

/// The share of a frame's edge pixels (solid, beside see-through) that are not dark: an outline is closed when it is
/// small. A little light is allowed: the glow round a lit baton or visor spills over the outline on purpose.
export const lightEdge = (f: Uint8Array, w: number, h: number) => {
  let edge = 0, light = 0;
  const a = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : f[(y * w + x) * 4 + 3]!);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (a(x, y) < 250 || ![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => a(x + dx!, y + dy!) < 60)) continue;
    edge++;
    const o = (y * w + x) * 4;
    if (Math.max(f[o]!, f[o + 1]!, f[o + 2]!) > 100) light++;
  }
  return edge ? light / edge : 0;
};

/// song_make of one mood: it passes sound_report, loops, and stays an ordinary song (makers-songs*.test.ts).
export function checkMood(m: Makers, mood: string) {
  const { text, use, bytes } = m;
  const name = mood.replace(/ /g, "_");
  const said = text(use("song_make", { name, mood }));
  expect(said, mood).not.toContain("WARNING");
  expect(said, mood).toMatch(/loop seam: matches|the end meets the start/);
  const parsed = parseSong(bytes(`music/${name}.song.json`).toString());
  if (!parsed.ok) throw new Error(parsed.error);
  expect(parsed.song.tracks.map((t) => t.name).filter((n) => n !== "arp" && n !== "bass_hi")).toEqual(["melody", "harmony", "bass", "drums"]);
  expect(parsed.song.tracks.some((t) => t.name === "arp"), mood).toBe(mood.startsWith("synthwave"));
  // the fuller voices, not the chip voice and the chip kit: and the report finds nothing to advise
  expect(parsed.song.tracks.find((t) => t.name === "bass")!.wave, mood).toBe("saw");
  expect(["studio", "punch"]).toContain(parsed.song.tracks.find((t) => t.kind === "drums")!.kit);
  expect(said, mood).not.toContain("advice:");
  for (const t of parsed.song.tracks) {
    expect(t.notes.length, `${mood} ${t.name}`).toBeGreaterThan(2);
    // (a song plays its intro once and loops from the first A: every part sounds where the loop starts)
    const from = parsed.song.loop?.from ?? 0;
    expect(t.notes.some((n) => n.step === from), `${mood} ${t.name} sounds where the loop starts`).toBe(true);
    for (const n of t.notes) expect(n.step + n.len).toBeLessThanOrEqual(parsed.song.length);
  }
  // the bass stays where a small speaker can play it
  expect(Math.min(...parsed.song.tracks.find((t) => t.name === "bass")!.notes.map((n) => n.pitch))).toBeGreaterThanOrEqual(43);
  // a real song form by default: an intro, then A, B, a break and A again, 32 bars or more, a loop of 45 seconds or more
  if (mood !== "victory jingle") {
    const s = parsed.song;
    expect(s.length / 16, mood).toBeGreaterThanOrEqual(32);
    expect(s.loop, mood).toEqual({ from: 64, to: s.length });
    expect(((s.loop!.to - s.loop!.from) * 15) / s.bpm, mood).toBeGreaterThanOrEqual(45);
    expect(s.markers!.map((m) => m.name).slice(0, 3), mood).toEqual(["intro", "A", "B"]);
    expect(said, mood).toMatch(/the game loops from the first A/);
  }
  // it can be given back to song_write as it is: it reads and writes back unchanged (song_write itself, which renders the
  // whole minute again, is called once in makers-songs.test.ts, not once a mood: that render doubled the test's time)
  expect(serializeSong(parsed.song), mood).toBe(bytes(`music/${name}.song.json`).toString());
}

/// character_make in the detailed style with each of these parts: every one draws its whole sheet (makers-people*.test.ts).
export function drawsEveryPart(m: Makers, parts: Record<string, string>[]) {
  for (const part of parts) {
    m.use("character_make", { name: "p", style: "detailed", palette: "gutter market", ...part });
    expect(m.sheet("p").frames, JSON.stringify(part)).toBe(140);
  }
}
