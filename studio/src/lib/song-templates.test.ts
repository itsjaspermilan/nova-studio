import { describe, expect, it } from "vitest";
import { MAX_NOTES, parseSong, renderSong, serializeSong, songSeconds } from "./song";
import { SONG_TEMPLATES, templateById } from "./song-templates";
import { integratedLufs } from "./loudness";

describe("starter songs", () => {
  it("has the blank one first and each is made once and the same every time", () => {
    expect(SONG_TEMPLATES[0]!.id).toBe("blank");
    for (const t of SONG_TEMPLATES) expect(serializeSong(t.make()), t.id).toBe(serializeSong(t.make()));
    expect(new Set(SONG_TEMPLATES.map((t) => t.id)).size).toBe(SONG_TEMPLATES.length);
    expect(templateById("nope").id).toBe("blank");
  });
  it("every one is a song the editor accepts, with notes inside it and sensible sizes", () => {
    for (const t of SONG_TEMPLATES) {
      const s = t.make();
      const back = parseSong(serializeSong(s));
      expect(back.ok, `${t.id}: ${back.ok ? "" : back.error}`).toBe(true);
      const notes = s.tracks.reduce((n, tr) => n + tr.notes.length, 0);
      expect(notes, t.id).toBeGreaterThan(8);
      expect(notes, t.id).toBeLessThan(MAX_NOTES);
      for (const tr of s.tracks) for (const n of tr.notes) {
        expect(n.step + n.len, `${t.id}/${tr.name}`).toBeLessThanOrEqual(s.length + 0);
        expect(n.vel).toBeGreaterThan(0);
        expect(n.vel).toBeLessThanOrEqual(1);
      }
    }
  });
  it("every one renders to sound that is neither silent nor clipping, of a sensible length", () => {
    for (const t of SONG_TEMPLATES) {
      const s = t.make();
      const sound = renderSong(s, 22050);
      const peak = sound.channels[0]!.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
      expect(peak, t.id).toBeGreaterThan(0.05);
      expect(peak, t.id).toBeLessThanOrEqual(1);
      expect(songSeconds(s), t.id).toBeGreaterThan(1.5);
      expect(songSeconds(s), t.id).toBeLessThan(40);
      expect(Number.isFinite(integratedLufs(sound.channels, 22050)), t.id).toBe(true);
    }
  });
});
