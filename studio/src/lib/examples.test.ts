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

const root = new URL("../../../examples/", import.meta.url).pathname;
const projects = readdirSync(root).filter((d) => existsSync(join(root, d, "nova.json")));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : [join(dir, n)]));
}
const text = (p: string) => readFileSync(p, "utf8");

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
      const image = parsed.doc.texture ? fitPicture(parsed.doc, bakeAll(parsed.doc)) : undefined;
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
