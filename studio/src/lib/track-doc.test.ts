import { describe, expect, it } from "vitest";
import {
  ROADSIDE, addPoint, analyse, buildTrack, withRandomRoute, withTheme, callOut, movePoint, newTrack, parseTrack, pointAt, removePoint, serializeTrack, setField, trackName, drawable, type Point, type TrackDoc,
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
      { readFile: async (p) => written.get(p) ?? null, writeFile: async (p, t) => void written.set(p, t), writeModel: async (p, u) => void written.set(p, u.slice(0, 30)) },
      "my_stage", { ...stage(), trees: ["pine"] },
    );
    expect([...written.keys()]).toEqual(["tracks/my_stage.track.json", "scenes/my_stage.scene.json", "models/road_my_stage.glb"]);
    expect(report).toMatch(/^my_stage: /);
    expect(parseTrack(written.get("tracks/my_stage.track.json")!).ok).toBe(true);
    // the road is a placed object of the scene, naming its model
    const objects = JSON.parse(written.get("scenes/my_stage.scene.json")!).objects;
    expect(objects.filter((o: { kind: string }) => o.kind === "road")).toEqual([{ kind: "road", x: 0, y: 0, z: 0, props: { model: "road_my_stage" } }]);
    await expect(writeTrack({ readFile: async () => null, writeFile: async () => {}, writeModel: async () => {} }, "../x", stage())).rejects.toMatch(/Track names/);
  });
  it("keeps the named objects of the scene it replaces, and nothing else of it", () => {
    const d = { ...stage(), trees: ["pine"] };
    const first = JSON.parse(buildTrack(d).scene);
    first.objects.push({ kind: "race", name: "race", x: 1, y: 0, props: { grip: 0.8, sky: { top: [1, 2, 3] } } }, { kind: "pine", x: 500, y: 0 });
    const again = JSON.parse(buildTrack({ ...d, sections: 3 }, JSON.stringify(first)).scene);
    expect(again.objects[0]).toEqual({ kind: "race", name: "race", x: 1, y: 0, props: { grip: 0.8, sky: { top: [1, 2, 3] } } });
    expect(again.objects.filter((o: { x: number }) => o.x === 500)).toHaveLength(0);
    expect(again.objects.filter((o: { kind: string }) => o.kind === "section_gate")).toHaveLength(3);
    expect(buildTrack(d, "not a scene").scene).toBe(buildTrack(d).scene);
  });
  it("narrows the road and changes its surface in a zone: the waypoints, the barriers, a wall and the road mesh follow", () => {
    const loop = { ...newTrack(), control: [[0, -200], [0, 300], [40, 380], [120, 420], [300, 420], [380, 380], [420, 300], [420, -200], [380, -280], [300, -320], [120, -320], [40, -280]] as Point[] };
    const zoned = { ...loop, zones: [{ from: 100, to: 300, width: 8, road: "road_gravel" as const, wall: "barrier_wall" }] };
    const parsed = parseTrack(serializeTrack(zoned));
    expect(parsed.ok && parsed.doc.zones).toEqual(zoned.zones);
    expect(serializeTrack(loop)).not.toContain("zones"); // (a track without zones keeps its text)
    const objects: { kind: string; x: number; z: number; props?: Record<string, unknown> }[] = JSON.parse(buildTrack(zoned).scene).objects;
    const wps = objects.filter((o) => o.kind === "waypoint");
    const inZone = wps.filter((o) => o.props!.road === "road_gravel");
    expect(inZone.length).toBeGreaterThan(15);
    expect(inZone.every((o) => o.props!.w === 4)).toBe(true);
    expect(wps.filter((o) => o.props!.w === undefined).length).toBeGreaterThan(wps.length / 2); // (elsewhere the road is as it was)
    const walls = objects.filter((o) => o.kind === "barrier_wall");
    expect(walls.length).toBeGreaterThan(60);
    const line = analyse(zoned)!.line;
    for (const w of walls) expect(Math.min(...line.map((q) => Math.hypot(q.x - w.x, q.z - w.z)))).toBeLessThan(5.5);
    // the road mesh: narrower and gravel-coloured in the zone, so not the plain one
    expect(buildTrack(zoned).glb.length).toBe(buildTrack(loop).glb.length);
    expect(Buffer.compare(Buffer.from(buildTrack(zoned).glb), Buffer.from(buildTrack(loop).glb))).not.toBe(0);
    // a pit row, a gantry and light posts when the roadside has them
    const dressed = JSON.parse(buildTrack({ ...loop, roadside: { ...ROADSIDE, garage: "garage", garages: 4, office: "pits_office", gantry: "gantry", post: "light_post" } }).scene).objects as { kind: string }[];
    expect(dressed.filter((o) => o.kind === "garage")).toHaveLength(4);
    for (const k of ["pits_office", "gantry", "light_post"]) expect(dressed.some((o) => o.kind === k), k).toBe(true);
  });
  it("lays out the roadside and a crowd from the waypoints, clear of the road", () => {
    const loop = { ...newTrack(), control: [[0, -200], [0, 300], [40, 380], [120, 420], [300, 420], [380, 380], [420, 300], [420, -200], [380, -280], [300, -320], [120, -320], [40, -280]] as Point[] };
    const kinds = ["fan_a", "fan_b"];
    const d = { ...loop, roadside: { ...ROADSIDE }, crowd: { kind: kinds, size: 2 } };
    const scene = JSON.parse(buildTrack(d).scene);
    const objects: { kind: string; x: number; z: number; props?: Record<string, number> }[] = scene.objects;
    for (const k of ["grandstand", "tent_long", "banner_green", "flag_green", "billboard", "pylon"]) expect(objects.some((o) => o.kind === k), k).toBe(true);
    const people = objects.filter((o) => kinds.includes(o.kind));
    expect(people.length).toBeGreaterThan(40);
    const line = analyse(d)!.line;
    for (const p of people) {
      expect(Math.min(...line.map((q) => Math.hypot(q.x - p.x, q.z - p.z)))).toBeGreaterThan(8.5);
      expect(p.props!.sx).toBeGreaterThan(1.8);
      expect([0.9, 1.1]).toContain(p.props!.rate);
    }
    // the rest of the scene is as it was without them
    const plain = JSON.parse(buildTrack(loop).scene).objects;
    expect(objects.slice(0, plain.length)).toEqual(plain);
    expect(JSON.parse(buildTrack({ ...d, roadside: null, crowd: { kind: [], size: 1 } }).scene).objects).toEqual(plain);
  });
});

describe("a made-up route", () => {
  const base = newTrack();
  it("is the same for the same seed and different for another", () => {
    const a = withRandomRoute(base, { length: 2000, curviness: 0.5, seed: 9 });
    const b = withRandomRoute(base, { length: 2000, curviness: 0.5, seed: 9 });
    const c = withRandomRoute(base, { length: 2000, curviness: 0.5, seed: 10 });
    expect(a.doc.control).toEqual(b.doc.control);
    expect(a.doc.control).not.toEqual(c.doc.control);
  });
  it("passes the editor's own checks, as a circuit and as a stage, for many seeds", () => {
    for (const open of [false, true]) {
      for (let seed = 1; seed <= 25; seed++) {
        const { doc, ok } = withRandomRoute({ ...base, open }, { length: open ? 3000 : 2000, curviness: 0.6, seed });
        const s = analyse(doc)!;
        expect(ok, `seed ${seed}`).toBe(true);
        expect(s.warnings, `seed ${seed}`).toEqual([]);
        expect(s.minRadius).toBeGreaterThanOrEqual(15);
        expect(Math.abs(s.length - (open ? 3000 : 2000))).toBeLessThan((open ? 3000 : 2000) * 0.15);
      }
    }
  });
  it("starts at the origin heading along +z, and drops the zones of the old route", () => {
    const { doc } = withRandomRoute({ ...base, zones: [{ from: 10, to: 50, width: 9 }] }, { length: 1500, curviness: 0.3, seed: 3 });
    expect(doc.control[0]).toEqual([0, 0]);
    expect(Math.abs(doc.control[1]![0])).toBeLessThan(0.2);
    expect(doc.control[1]![1]).toBeGreaterThan(10);
    expect(doc.zones).toEqual([]);
  });
  it("builds a scene and a road like any other track", () => {
    const { doc } = withRandomRoute(withTheme(base, "desert"), { length: 1800, curviness: 0.7, seed: 4 });
    expect(doc.road).toBe("road_sand");
    const files = buildTrack(doc, null, "made");
    expect(files.glb.byteLength).toBeGreaterThan(1000);
    expect(JSON.parse(files.scene).objects.length).toBeGreaterThan(50);
  });
});
