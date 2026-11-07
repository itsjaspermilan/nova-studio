import { describe, expect, it } from "vitest";
import {
  addPoint, analyse, buildTrack, callOut, movePoint, newTrack, parseTrack, pointAt, removePoint, serializeTrack, setField, trackName, drawable, type TrackDoc,
} from "./track-doc";
import { writeTrack } from "./track-write";
import { parseScene } from "./scene-model";
// @ts-ignore (plain JavaScript)
import { centreline, curvature, tightest } from "../../../scripts/lib/trackgen.mjs";

const stage = (): TrackDoc => ({
  ...newTrack(), open: true,
  control: [[0, -100], [0, 0], [0, 100], [40, 180], [120, 210], [200, 180], [240, 100], [300, 60]],
});

describe("editing", () => {
  it("adds a point on the end, or between its neighbours when clicked near the route", () => {
    const d = newTrack();
    const far = addPoint(d, 500, 500);
    expect(far.index).toBe(d.control.length);
    expect(far.doc.control.at(-1)).toEqual([500, 500]);
    // a click just beside the first stretch (0,-60)->(0,40) goes in after point 1
    const near = addPoint(d, 8, -10);
    expect(near.index).toBe(1);
    expect(near.doc.control[1]).toEqual([8, -10]);
    expect(near.doc.control).toHaveLength(d.control.length + 1);
    expect(d.control).toHaveLength(8); // the old document is unchanged
  });
  it("on a stage the stretch from the last point back to the first does not count", () => {
    const d = stage();
    const r = addPoint(d, 150, -100, 30); // near neither end stretch, but close to the first point: still the end
    expect(r.index).toBe(d.control.length);
  });
  it("moves and removes points, keeping at least two", () => {
    const d = newTrack();
    expect(movePoint(d, 2, 33.33, 44.44).control[2]).toEqual([33.3, 44.4]);
    expect(movePoint(d, 99, 1, 1)).toBe(d);
    expect(removePoint(d, 0).control).toHaveLength(7);
    expect(removePoint({ ...d, control: [[0, 0], [1, 1]] }, 0).control).toHaveLength(2);
  });
  it("finds the nearest point within reach", () => {
    const d = newTrack();
    expect(pointAt(d, 2, -58, 10)).toBe(0);
    expect(pointAt(d, 300, 300, 10)).toBe(-1);
  });
});

describe("statistics", () => {
  it("uses the shared generator's route, curvature and closest approach", () => {
    const d = newTrack();
    const s = analyse(d)!;
    const line = centreline(d.control, 5, false);
    expect(s.line).toEqual(line);
    expect(s.curv).toEqual(curvature(line, 5, false));
    expect(s.closest).toBe(tightest(line, 5));
    expect(s.length).toBe(line.length * 5);
    expect(s.minRadius).toBe(Math.round(1 / Math.max(...s.curv.map(Math.abs))));
  });
  it("warns about a tight bend and about a road that comes near itself", () => {
    const tight: TrackDoc = { ...newTrack(), control: [[0, 0], [60, 0], [60, 8], [0, 8]] };
    expect(analyse(tight)!.warnings.join(" ")).toMatch(/tight/);
    const folded: TrackDoc = { ...newTrack(), control: [[0, 0], [200, 0], [200, 60], [0, 60], [0, 30], [100, 30]], open: true };
    const w = analyse(folded)!;
    expect(w.closest).not.toBeNull();
    expect(w.closest!).toBeLessThan(40);
    expect(w.warnings.join(" ")).toMatch(/touch itself/);
    expect(analyse(newTrack())!.warnings).toEqual([]);
  });
  it("needs enough points to draw", () => {
    expect(drawable({ ...newTrack(), control: [[0, 0], [5, 5]] })).toBe(false);
    expect(analyse({ ...newTrack(), control: [[0, 0], [5, 5]] })).toBeNull();
    expect(drawable({ ...stage(), control: [[0, 0], [5, 5]] })).toBe(true);
  });
  it("marks the start, the finish and equally spaced gates on a stage", () => {
    const d = stage();
    const s = analyse(d)!;
    expect(s.marks.start).toBe(8); // 40 m of lead-in at 5 m
    expect(s.marks.finish).toBe(s.line.length - 1 - 18);
    expect(s.marks.gates).toHaveLength(d.sections);
    expect(s.marks.gates.at(-1)).toBe(s.marks.finish);
    const gaps = s.marks.gates.map((g, i) => g - (i ? s.marks.gates[i - 1]! : s.marks.start));
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1);
    expect(analyse(newTrack())!.marks).toEqual({ start: 0, finish: null, gates: [] });
  });
  it("lists corners as pace notes with a direction and a grade", () => {
    const s = analyse(stage())!;
    expect(s.corners.length).toBeGreaterThan(0);
    for (const c of s.corners) {
      expect(c.grade).toBeGreaterThanOrEqual(1);
      expect(c.grade).toBeLessThanOrEqual(6);
      expect(c.s).toBeGreaterThanOrEqual(0);
    }
    expect(callOut({ s: 0, left: true, grade: 3 })).toBe("Left 3");
    expect(callOut({ s: 0, left: false, grade: 5 })).toBe("Right 5");
  });
});

describe("the .track.json file", () => {
  it("round-trips", () => {
    const d: TrackDoc = { ...stage(), road: "road_gravel", sections: 4, seed: 12, trees: ["pine", "birch"], small: ["bush"], rock: ["rock"], density: 0.55, rocks: 0.1, lamps: true };
    const text = serializeTrack(d);
    const back = parseTrack(text);
    expect(back).toEqual({ ok: true, doc: d });
    expect(serializeTrack((back as { doc: TrackDoc }).doc)).toBe(text);
    expect(text.endsWith("\n")).toBe(true);
  });
  it("fills in defaults, clamps, and refuses what it cannot read", () => {
    const p = parseTrack(JSON.stringify({ control: [[0, 0], [1, 2]], sections: 99, road: "lava", density: 7 }));
    expect(p.ok && p.doc.sections).toBe(20);
    expect(p.ok && p.doc.road).toBe("road_asphalt");
    expect(p.ok && p.doc.density).toBe(1);
    expect(parseTrack("nope").ok).toBe(false);
    expect(parseTrack("[]").ok).toBe(false);
    expect(parseTrack(JSON.stringify({ control: [[0]] })).ok).toBe(false);
    expect(parseTrack(JSON.stringify({})).ok).toBe(false);
  });
  it("names a track from its path", () => {
    expect(trackName("tracks/pine_ridge.track.json")).toBe("pine_ridge");
  });
  it("setField returns a changed copy", () => {
    const d = newTrack();
    expect(setField(d, "open", true).open).toBe(true);
    expect(d.open).toBe(false);
  });
});

describe("generating", () => {
  it("makes a valid scene with the gates and a glb", () => {
    const f = buildTrack({ ...stage(), trees: ["pine"], density: 0.5 });
    const scene = parseScene(f.scene);
    expect(scene.ok).toBe(true);
    const kinds = (scene.ok ? scene.scene.objects ?? [] : []).map((o) => o.kind);
    expect(kinds.filter((k) => k === "section_gate")).toHaveLength(5);
    expect(kinds).toContain("pine");
    expect(String.fromCharCode(...f.glb.subarray(0, 4))).toBe("glTF");
    expect(() => buildTrack({ ...newTrack(), control: [[0, 0], [1, 1]] })).toThrow();
  });
  it("is the same for the same settings", () => {
    const d = { ...stage(), trees: ["pine"] };
    expect(buildTrack(d).scene).toBe(buildTrack(d).scene);
  });
  it("writes the track, the scene and the road through the backend's file calls", async () => {
    const written = new Map<string, string>();
    const report = await writeTrack(
      { writeFile: async (p, t) => void written.set(p, t), writeModel: async (p, u) => void written.set(p, u.slice(0, 30)) },
      "my_stage", { ...stage(), trees: ["pine"] },
    );
    expect([...written.keys()]).toEqual(["tracks/my_stage.track.json", "scenes/my_stage.scene.json", "models/road_my_stage.glb"]);
    expect(report).toMatch(/^my_stage: /);
    expect(parseTrack(written.get("tracks/my_stage.track.json")!).ok).toBe(true);
    await expect(writeTrack({ writeFile: async () => {}, writeModel: async () => {} }, "../x", stage())).rejects.toMatch(/Track names/);
  });
});
