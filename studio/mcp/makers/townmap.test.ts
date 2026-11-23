// map_make: a hand-drawn paper map of a 3D town from its scene and terrain. The same recipe gives the same bytes; the names never
// overlap each other, the icons or the other roads; every named road gets its name (a long road more than once); and the map writes
// only the words it is given: no house number, no resident's name, nothing for the player.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { releaseBinary, stableBinary } from "../binaries";
import { decodePng } from "../draw";
import { encode } from "../image";
import { makeTownMap, type MapLabel } from "./townmap";

const bin = stableBinary(releaseBinary(resolve(dirname(fileURLToPath(import.meta.url)), "../../.."), "nova"));
const haveBin = existsSync(bin);
let dir = "";

/// A small town: a long main road north to south, two lanes off it (one across a creek on a bridge), a creek, houses with numbered
/// mailboxes and residents, a post office, trees, a heightmap with a hill, and a nova.terrain line for the map to find.
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nova-townmap-"));
  for (const d of ["scenes", "terrain", "sprites"]) mkdirSync(join(dir, d), { recursive: true });
  const line = (pts: number[][], step = 5) => {
    const out: number[][] = [];
    for (let i = 1; i < pts.length; i++) {
      const [ax, az] = pts[i - 1] as [number, number], [bx, bz] = pts[i] as [number, number], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
      for (let k = 0; k < n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
    }
    out.push(pts[pts.length - 1]!);
    return out;
  };
  const objects: Record<string, unknown>[] = [
    { kind: "roadline", x: 0, y: 0, z: 0, props: { key: "high_street", label: "High Street", surface: "road", width: 6.4, points: line([[0, -300], [8, -150], [-6, 0], [4, 150], [0, 300]]) } },
    { kind: "roadline", x: 0, y: 0, z: 0, props: { key: "mill_lane", label: "Mill Lane", surface: "gravel", width: 4.6, points: line([[-4, -60], [-60, -70], [-120, -40], [-170, -10]]) } },
    { kind: "roadline", x: 0, y: 0, z: 0, props: { key: "ford_road", label: "Ford Road", surface: "gravel", width: 4.6, points: line([[2, 90], [60, 95], [120, 110], [190, 140]]) } },
    { kind: "water", name: "brook", x: 0, y: 0, z: 0, props: { key: "brook", width: 5, points: line([[95, -300], [100, 0], [92, 100], [80, 300]], 4) } },
    { kind: "bridge", name: "bridge", x: -96, y: 0, z: 104, props: { a: [86, 102], b: [106, 106] } },
    { kind: "post_office", name: "post_office", x: 22, y: 0, z: -180, props: { ry: -1.57 } },
    { kind: "cabin", name: "cabin_a", x: -175, y: 0, z: 5, props: { ry: 0 } },
    { kind: "cabin", name: "cabin_b", x: -195, y: 0, z: 150, props: { ry: 0 } },
    { kind: "mailbox", name: "mailbox_3", x: -165, y: 0, z: -2, props: { number: 3 } },
    { kind: "mailbox", name: "mailbox_7", x: -185, y: 0, z: 140, props: { number: 7 } },
    { kind: "resident", name: "Hazel Brock", x: -170, y: 0, z: 0, props: { number: 3, street: "Mill Lane" } },
    { kind: "picnic_table", name: "picnic", x: -30, y: 0, z: 200, props: { ry: 0 } },
  ];
  // trees: a deterministic scatter, kept off the roads by distance to their lines only roughly (the map thins and clears them itself)
  let s = 7;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < 700; i++) objects.push({ kind: rnd() < 0.7 ? "pine" : "birch", x: -240 + rnd() * 480, y: 0, z: -300 + rnd() * 600 });
  for (let i = 0; i < 12; i++) objects.push({ kind: "forest_mass", x: -230 + rnd() * 40, y: 0, z: -280 + i * 50, props: { sx: 1.2 } });
  writeFileSync(join(dir, "scenes/town.scene.json"), JSON.stringify({ version: 1, camera: { eye: [0, 30, -200], target: [0, 0, 0], fov: 60 }, objects }));
  // a heightmap (8-bit RGB: (R * 256 + G) / 65535 of the height), a hill in the west and a valley along the brook
  const W = 65, H = 65, data = new Uint8ClampedArray(W * H * 4);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x = -250 + (i / (W - 1)) * 500, z = -300 + (j / (H - 1)) * 600;
    const h = 0.25 + 0.5 * Math.exp(-((x + 150) ** 2 + (z - 50) ** 2) / 9000) - 0.2 * Math.exp(-((x + 100) ** 2) / 800);
    const v = Math.round(Math.max(0, Math.min(1, h)) * 65535);
    data.set([v >> 8, v & 255, 0, 255], (j * W + i) * 4);
  }
  writeFileSync(join(dir, "terrain/town.png"), encode({ w: W, h: H, data }));
  writeFileSync(join(dir, "main.lua"), 'function nova.load() nova.terrain{ heightmap = "terrain/town.png", x = -250, z = -300, size = 500, height = 40 } end\n');
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const RECIPE = {
  scene: "town", size: 700, title: "Millbrook", subtitle: "a test town", seed: 2,
  water: { names: { brook: "Mill Brook" } },
  trees: { pine: ["pine"], round: ["birch"] }, forest: { kinds: ["forest_mass"] },
  places: { post_office: { icon: "post_office", label: "Post Office" }, cabin: { icon: "house" }, bridge: { icon: "bridge" }, picnic_table: { icon: "picnic", label: "Picnic spot" } },
  areas: [{ at: [-200, 260], text: "the high wood" }],
};
const make = (extra: Record<string, unknown> = {}) => makeTownMap(dir, { ...RECIPE, ...extra }, haveBin ? bin : null);
const circlesOverlap = (a: MapLabel, b: MapLabel) => a.circles.some(([x, y, r]) => b.circles.some(([u, v, q]) => Math.hypot(x - u, y - v) < r + q - 0.5));

describe.skipIf(!haveBin)("map_make", () => {
  let first: ReturnType<typeof make>;
  beforeAll(() => {
    first = make();
  });

  it("is the same picture, byte for byte, for the same recipe and seed; another seed is another hand", () => {
    const again = make();
    expect(Buffer.from(again.files[0]![1]).equals(Buffer.from(first.files[0]![1]))).toBe(true);
    const other = make({ seed: 3 });
    expect(Buffer.from(other.files[0]![1]).equals(Buffer.from(first.files[0]![1]))).toBe(false);
    const pic = decodePng(first.files[0]![1]);
    expect(pic.h).toBe(700);
    // (the width follows the bounds: the roads and water and 40 m round them, north up)
    expect(pic.w).toBeGreaterThan(300);
    expect(pic.w).toBeLessThan(700);
    expect(first.files[0]![0]).toBe("sprites/ui/map.png");
  });

  it("names every named road along it, a long road more than once, and the brook", () => {
    for (const key of ["high_street", "mill_lane", "ford_road"]) expect(first.labels.filter((l) => l.kind === "road" && l.of === key).length, key).toBeGreaterThanOrEqual(1);
    expect(first.labels.filter((l) => l.of === "high_street").length).toBeGreaterThanOrEqual(2);
    expect(first.labels.some((l) => l.kind === "water" && l.text === "Mill Brook")).toBe(true);
    expect(first.text).not.toMatch(/NO ROOM/);
  });

  it("never letters one name over another, over an icon or over a road", () => {
    const placed = first.labels.filter((l) => l.circles.length);
    for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
      expect(circlesOverlap(placed[i]!, placed[j]!), `${placed[i]!.text} / ${placed[j]!.text}`).toBe(false);
    }
    // (the road names stand beside their roads: every circle of one is off every road's ribbon)
    expect(placed.length).toBeGreaterThanOrEqual(8);
  });

  it("writes only the words it is given: no house numbers, no residents' names, nothing for the player", () => {
    const words = first.labels.filter((l) => l.kind !== "scale").map((l) => l.text);
    expect(words).toContain("Post Office");
    expect(words).toContain("Millbrook");
    for (const w of words) {
      expect(w, w).not.toMatch(/\d/);
      expect(w.toLowerCase(), w).not.toMatch(/hazel|brock|you|destination|mailbox/);
    }
    expect(first.labels.filter((l) => l.kind === "scale").map((l) => l.text)).toEqual(["0", "50", "100 m"]);
    // the cabins are drawn (as icons) but never named
    expect(first.text).toMatch(/house/);
  });

  it("finds the terrain's heightmap in the project's Lua and draws its hills; without it, flat land", () => {
    expect(first.text).toMatch(/hills from terrain\/town\.png/);
    const flat = make({ terrain: false });
    expect(flat.text).not.toMatch(/hills from/);
    expect(Buffer.from(flat.files[0]![1]).equals(Buffer.from(first.files[0]![1]))).toBe(false);
  });

  it("refuses what it does not know, and writes smaller copies as asked", () => {
    expect(() => make({ colour: "red" })).toThrow(/`colour` is not an option of map_make/);
    expect(() => make({ palette: { paperr: "#ffffff" } })).toThrow(/palette has paperr/);
    expect(() => make({ places: { cabin: { icon: "castle" } } })).toThrow(/icon is/);
    const r = make({ sizes: [0.5] });
    expect(r.files.map((f) => f[0])[1]).toMatch(/^sprites\/ui\/map_\d+x350\.png$/);
  });

  it("text_min: no word is drawn smaller (the subtitle and the scale's numbers grow to it, the names are not shrunk below it)", () => {
    const small = make({ size: 400 }), asked = make({ size: 400, text_min: 16 });
    // (at this size the subtitle and the scale's numbers are under 16 px by themselves)
    expect(Math.min(...small.labels.map((l) => l.px ?? 99))).toBeLessThan(16);
    expect(asked.labels.length).toBeGreaterThan(8);
    for (const l of asked.labels) expect(l.px, l.text).toBeGreaterThanOrEqual(16);
    expect(asked.labels.find((l) => l.of === "subtitle")?.px).toBeGreaterThanOrEqual(16);
    expect(asked.labels.filter((l) => l.kind === "scale").every((l) => (l.px ?? 0) >= 16)).toBe(true);
  });
});
