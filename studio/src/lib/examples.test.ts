import { inflateSync } from "node:zlib";
import type { Raster } from "./pixels";
// The studio's editors against real projects: everything in the shipped examples (some made by the MCP server, some by hand)
// must open in the editor that owns it, save back the same, and, for models, export the same `.glb` that is committed.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { exportGlb } from "./glb";
import { parseModel, serializeModel } from "./model-doc";
import { bakeAll, fitPicture } from "./model-uv";
import { parseScene, serializeScene, boundsOf, drawOrder, hitTest } from "./scene-model";
import { fromJson, render, toJson } from "./sfx";
import { parseSong, serializeSong } from "./song";
import { parseSheetJson } from "./sprite-doc";
import { resolveEntity } from "./entity-info";
import { groupResources } from "./resources";
import { buildModel } from "./model-three";
import { importGlb } from "./glb-import";
import { buildTrack, parseTrack, roadOf, sceneOf, serializeTrack, trackName } from "./track-doc";

const root = new URL("../../../examples/", import.meta.url).pathname;
const projects = readdirSync(root).filter((d) => existsSync(join(root, d, "nova.json")));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : [join(dir, n)]));
}
const text = (p: string) => readFileSync(p, "utf8");

/// An 8-bit RGBA PNG as written by png-encode.ts (no interlacing), read back with Node's zlib.
function readPng(path: string): Raster {
  const b = readFileSync(path);
  let w = 0, h = 0, at = 8;
  const idat: Buffer[] = [];
  while (at < b.length) {
    const len = b.readUInt32BE(at);
    const type = b.toString("latin1", at + 4, at + 8);
    const body = b.subarray(at + 8, at + 8 + len);
    if (type === "IHDR") {
      [w, h] = [body.readUInt32BE(0), body.readUInt32BE(4)];
      if (body[8] !== 8 || body[9] !== 6 || body[12] !== 0) throw new Error(`${path}: not an 8-bit RGBA PNG`);
    } else if (type === "IDAT") idat.push(body);
    at += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const out = new Uint8ClampedArray(w * h * 4);
  const stride = w * 4;
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)]!;
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x]!;
      const a = x >= 4 ? out[y * stride + x - 4]! : 0;
      const up = y > 0 ? out[(y - 1) * stride + x]! : 0;
      const ul = x >= 4 && y > 0 ? out[(y - 1) * stride + x - 4]! : 0;
      let pred = 0;
      if (filter === 1) pred = a;
      else if (filter === 2) pred = up;
      else if (filter === 3) pred = (a + up) >> 1;
      else if (filter === 4) {
        const p = a + up - ul, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - ul);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? up : ul;
      }
      out[y * stride + x] = (v + pred) & 255;
    }
  }
  return { w, h, data: out };
}

describe.each(projects)("the editors on examples/%s", (name) => {
  const base = join(root, name);
  const all = files(base).map((p) => relative(base, p));
  const ending = (suffix: string) => all.filter((f) => f.endsWith(suffix));

  it("open every model, save it back unchanged and export the glb that is committed", () => {
    for (const f of ending(".model.json")) {
      const parsed = parseModel(text(join(base, f)));
      expect(parsed.ok, `${f}: ${parsed.ok ? "" : parsed.error}`).toBe(true);
      if (!parsed.ok) continue;
      expect(serializeModel(parsed.doc), `${f} saves back as it was`).toBe(text(join(base, f)));
      const glbPath = join(base, f.replace(/\.model\.json$/, ".glb"));
      expect(existsSync(glbPath), `${f} has its glb`).toBe(true);
      // (a painted model exports its own picture; one with no picture yet, its colours baked fresh)
      const png = join(base, f.replace(/\.model\.json$/, ".texture.png"));
      const image = parsed.doc.texture ? fitPicture(parsed.doc, existsSync(png) ? readPng(png) : bakeAll(parsed.doc)) : undefined;
      expect(Buffer.compare(Buffer.from(exportGlb(parsed.doc, image)), readFileSync(glbPath)), `${f} exports the committed glb`).toBe(0);
    }
  });

  it("open every scene layout and save it back unchanged", () => {
    for (const f of ending(".scene.json")) {
      const parsed = parseScene(text(join(base, f)));
      expect(parsed.ok, `${f}: ${parsed.ok ? "" : parsed.error}`).toBe(true);
      if (!parsed.ok) continue;
      const saved = serializeScene(parsed.scene);
      // nothing is lost on a save; a file made by the studio's own tools also keeps its exact text (a hand-written one may be re-ordered)
      expect(JSON.parse(saved), `${f} keeps all its data`).toEqual(JSON.parse(text(join(base, f))));
      if (name === "pine-ridge-rally") expect(saved, `${f} saves back as it was`).toBe(text(join(base, f)));
    }
  });

  it("open every track, save it back unchanged, and make the committed road and the scene's route from it", () => {
    const route = (scene: string) => (JSON.parse(scene).objects as { kind: string }[]).filter((o) => ["waypoint", "grid_slot", "section_gate", "start_arch", "road_start"].includes(o.kind));
    for (const f of ending(".track.json")) {
      const parsed = parseTrack(text(join(base, f)));
      expect(parsed.ok, `${f}: ${parsed.ok ? "" : parsed.error}`).toBe(true);
      if (!parsed.ok) continue;
      expect(serializeTrack(parsed.doc), `${f} saves back as it was`).toBe(text(join(base, f)));
      const track = trackName(f);
      const made = buildTrack(parsed.doc);
      // the scene may have been edited since it was made (scenery moved, added or taken away), but the route the cars drive is the track's
      expect(route(made.scene), `${f}: the scene's waypoints, grid and gates are the track's`).toEqual(route(text(join(base, sceneOf(track)))));
      expect(Buffer.compare(Buffer.from(made.glb), readFileSync(join(base, roadOf(track)))), `${f} makes the committed road`).toBe(0);
    }
  });

  it("open every song, sound effect and sprite sheet", () => {
    for (const f of ending(".song.json")) {
      const parsed = parseSong(text(join(base, f)));
      expect(parsed.ok, `${f}`).toBe(true);
      if (parsed.ok) expect(serializeSong(parsed.song), `${f} saves back as it was`).toBe(text(join(base, f)));
    }
    for (const f of ending(".sfx.json")) {
      const params = fromJson(text(join(base, f)));
      expect(params, f).not.toBeNull();
      expect(text(join(base, f)), `${f} saves back as it was`).toBe(toJson(params!));
      expect(render(params!).channels[0]!.length).toBeGreaterThan(0);
    }
    for (const f of ending(".sprite.json")) {
      const parsed = parseSheetJson(text(join(base, f)));
      expect(parsed.ok, `${f}`).toBe(true);
      if (parsed.ok) expect(existsSync(join(base, f, "..", parsed.json.image ?? "")), `${f}'s picture`).toBe(true);
    }
  });

  it("show every file in the resource tree under a group", () => {
    const entries = all.map((path) => ({ path, dir: false, size: 1 }));
    const grouped = groupResources(entries);
    const shown = new Set(grouped.flatMap((g) => g.items.flatMap((i) => i.files)));
    for (const f of all) if (!f.startsWith("build/") && !f.endsWith("README.md")) expect(shown.has(f), `${f} is shown somewhere`).toBe(true);
  });

  it("learn which model each entity draws", async () => {
    const read = async (p: string) => (existsSync(join(base, p)) ? text(join(base, p)) : null);
    for (const f of ending(".lua").filter((f) => f.startsWith("entities/"))) {
      const kind = f.slice("entities/".length, -".lua".length).replaceAll("/", ".");
      const look = await resolveEntity(kind, read);
      // (only the entity's own declaration: a file may name other models elsewhere, in a particle spec for one)
      const source = text(join(base, f));
      const start = source.search(/nova\.entity/);
      const end = source.slice(Math.max(start, 0)).search(/\n(function|local|return)\b/);
      const declaration = start < 0 ? "" : source.slice(start, end < 0 ? undefined : start + end);
      const declared = /\bmodel\s*=\s*["']([^"']+)["']/.exec(declaration)?.[1];
      if (declared) expect(look.model, `${f}`).toBe(declared);
    }
  });
});

describe("a big 3D scene", () => {
  const scenePath = join(root, "pine-ridge-rally/scenes/pine_ridge.scene.json");
  const parsed = existsSync(scenePath) ? parseScene(text(scenePath)) : null;

  it.runIf(!!parsed?.ok)("is quick to hit-test, order and draw in the 2D editor's maths", () => {
    const scene = (parsed as { ok: true; scene: Parameters<typeof drawOrder>[0] }).scene;
    const started = performance.now();
    for (let i = 0; i < 20; i++) {
      for (const ref of drawOrder(scene)) boundsOf(scene, ref, new Map());
      hitTest(scene, 100, 100, new Map());
    }
    expect((performance.now() - started) / 20, "milliseconds for one redraw's worth of work").toBeLessThan(40);
  });

  it.runIf(!!parsed?.ok)("builds its 3D view quickly, reusing each model's geometry", () => {
    const scene = (parsed as { ok: true; scene: { objects?: { kind: string }[] } }).scene;
    const kinds = [...new Set((scene.objects ?? []).map((o) => o.kind))];
    const docs = new Map<string, ReturnType<typeof buildModel>>();
    for (const kind of kinds) {
      const file = join(root, `pine-ridge-rally/models/${kind}.model.json`);
      if (existsSync(file)) {
        const m = parseModel(text(file));
        if (m.ok) docs.set(kind, buildModel(m.doc));
      } else if (existsSync(file.replace(/\.model\.json$/, ".glb"))) {
        // a plain .glb (a kit's model): the scene view reads it into a model (see model-load.ts)
        const g = importGlb(new Uint8Array(readFileSync(file.replace(/\.model\.json$/, ".glb"))));
        if (g.ok) docs.set(kind, buildModel(g.doc));
      }
    }
    const started = performance.now();
    let geometries = new Set<unknown>();
    const group: unknown[] = [];
    for (const o of scene.objects ?? []) {
      const base = docs.get(o.kind);
      if (!base) continue;
      const copy = base.clone(true);
      copy.traverse((n) => "geometry" in n && geometries.add((n as { geometry: unknown }).geometry));
      group.push(copy);
    }
    expect(performance.now() - started).toBeLessThan(500);
    expect(geometries.size, "geometries are shared between copies of a model").toBeLessThanOrEqual(kinds.length * 8);
    expect(group.length).toBeGreaterThan(1000);
  });
});
