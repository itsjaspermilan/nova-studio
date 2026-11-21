// surface_make, road_make, land_make: the ground and road pictures, a track's road and the land under it, as makers any 3D game can call
// (first Pine Ridge Rally's scripts/rally/surfaces.mjs, roads.mjs and land.mjs). They keep the track format of the studio's track editor
// (tracks/<name>.track.json, studio/src/lib/track-doc.ts; docs/track-editor.md) and write the same road the editor and track_write write.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Raster } from "../../src/lib/pixels";
import { parseTrack, roadOf, serializeTrack, trackOf } from "../../src/lib/track-doc";
import type { Host } from "./index";
// @ts-ignore (plain JavaScript)
import { makeSurfaces, SURFACES } from "./surface.mjs";
// @ts-ignore
import { GROUNDS, landGlb } from "./land.mjs";
// @ts-ignore (shared with the studio's track editor)
import { roadGlb } from "../../../scripts/lib/trackgen.mjs";

type Args = Record<string, any>;
type Result = string | { text: string; images?: string[] };
const text = (r: Result) => (typeof r === "string" ? r : r.text);
const images = (r: Result) => (typeof r === "string" ? [] : (r.images ?? []));

const ROAD_KINDS = ["road_asphalt", "road_dirt", "road_gravel", "road_snow", "road_sand"];
/// What each picture is, for the answer.
const SAYS: Record<string, string> = {
  ground_grass: "grass, 64 m across: lush, dry and dark patches, bare earth", ground_autumn: "fallen leaves over tired grass, 64 m", ground_sand: "sand with wind ripples and stony ground, 64 m", ground_snow: "snow drifts with blue hollows, 64 m",
  grass_detail: "blades of grass, 4 m (detail)", leaves_detail: "fallen leaves, 4 m (detail)", sand_detail: "grains and pebbles, 4 m (detail)", snow_detail: "snow crystals, 4 m (detail)", road_grain: "a road's grit, 4 m (detail)",
  road: "the road sheet: a 12 m column for each of asphalt (a worn racing line, rubber, cracks, sealed patches, skid marks, a dusty shoulder and a gravel verge breaking up into the grass), dirt, gravel, snow and sand (wheel ruts, a crown, stones, washboard), then the painted lines; 64 m along, repeating",
};

/// Puts every picture in one sheet, each shrunk to `tile` pixels, four across.
function sheet(pics: { w: number; h: number; px: Uint8Array }[], tile = 200): Raster {
  const cols = Math.min(4, pics.length), rows = Math.ceil(pics.length / cols), gap = 6, W = cols * (tile + gap) + gap, H = rows * (tile + gap) + gap;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) data.set([28, 30, 36, 255], i * 4);
  pics.forEach((p, n) => {
    const ox = gap + (n % cols) * (tile + gap), oy = gap + Math.floor(n / cols) * (tile + gap);
    for (let y = 0; y < tile; y++) for (let x = 0; x < tile; x++) {
      const sx = Math.floor((x / tile) * p.w), sy = Math.floor((y / tile) * p.h), k = (sy * p.w + sx) * 4, a = p.px[k + 3]! / 255, o = ((oy + y) * W + ox + x) * 4;
      // (see-through edges over a grass green, as on the ground)
      for (let c = 0; c < 3; c++) data[o + c] = p.px[k + c]! * a + [79, 138, 60][c]! * (1 - a);
      data[o + 3] = 255;
    }
  });
  return { w: W, h: H, data };
}

export function registerGround(h: Host, SEED: unknown): Record<string, Args> {
  /// Makes the surface pictures named into the project, merging their means into textures/means.json; returns what was made.
  const surfaces = (a: Args, names: string[]) => {
    const root = h.root(a);
    const made: { name: string; w: number; h: number; px: Uint8Array }[] = [];
    const means = makeSurfaces(names, { seed: a.seed ?? 1, road: a.road ?? {} }, (name: string, bytes: Uint8Array, w: number, hh: number, px: Uint8Array) => {
      h.put(root, `textures/${name}.png`, bytes);
      made.push({ name, w, h: hh, px });
    });
    if (Object.keys(means).length) {
      const file = join(root, "textures", "means.json");
      const old = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
      // (in the order the pictures are listed, as the first file had them)
      const all = { ...old, ...means }, ordered = Object.fromEntries(SURFACES.filter((s: string) => all[s]).map((s: string) => [s, all[s]]));
      h.put(root, "textures/means.json", `${JSON.stringify(ordered, null, 2)}\n`);
    }
    return made;
  };
  const need = (a: Args, names: string[]) => {
    const root = h.root(a), missing = names.filter((n) => !existsSync(join(root, "textures", `${n}.png`)));
    const meansFile = join(root, "textures", "means.json");
    const meansOf = existsSync(meansFile) ? JSON.parse(readFileSync(meansFile, "utf8")) : {};
    for (const n of names) if (n.startsWith("ground_") && !meansOf[n] && !missing.includes(n)) missing.push(n);
    if (missing.length) surfaces({ project: a.project }, missing);
    return missing;
  };

  h.tool(
    "surface_make",
    `Make the pictures that texture a 3D game's ground and roads, from noise (nothing taken from anywhere): \`textures/<name>.png\`. Surfaces: ${SURFACES.map((s: string) => `${s} (${SAYS[s]})`).join("; ")}. ` +
      "A base picture multiplies the model's own colours (white changes nothing; its alpha is a road's ragged edge); a detail picture (…_detail, road_grain) is fine grain repeating every 4 m that averages to mid-grey far away. The ground pictures' mean colours go to textures/means.json (land_make divides its tint by them, so the ground keeps its colour). " +
      "land_make and road_make (textured) name these files, and make the ones they need when they are missing. `seed` 1 is the set first made for Pine Ridge Rally; another seed is another pattern of the same. `road`: { line (how dark the worn racing line is: 1, 0 for none, up to 2), cracks (0 to 20; 5), patches (sealed patches, 0 to 2; 2), skids (skid marks, 0 to 3; 3) }. It returns every picture made, shrunk side by side.",
    {
      surfaces: { type: "array", items: { type: "string" }, description: `Which (all when left out): ${SURFACES.join(", ")}.` },
      road: { type: "object", description: "The road sheet's wear: { line, cracks, patches, skids }." },
      seed: SEED,
    },
    [],
    (a) => {
      const names: string[] = a.surfaces ?? SURFACES;
      for (const n of names) if (!SURFACES.includes(n)) throw new Error(`there is no surface "${n}"; the surfaces are ${SURFACES.join(", ")}`);
      const r = a.road ?? {};
      const bad = Object.keys(r).filter((k) => !["line", "cracks", "patches", "skids"].includes(k));
      if (bad.length) throw new Error(`road has ${bad.join(", ")}; it takes line, cracks, patches, skids`);
      const road = { line: Math.max(0, Math.min(2, Number(r.line ?? 1))), cracks: Math.max(0, Math.min(20, Math.round(Number(r.cracks ?? 5)))), patches: Math.max(0, Math.min(2, Math.round(Number(r.patches ?? 2)))), skids: Math.max(0, Math.min(3, Math.round(Number(r.skids ?? 3)))) };
      const made = surfaces({ ...a, road }, names);
      return {
        text: [`made ${made.length} picture${made.length === 1 ? "" : "s"} in textures/ (seed ${a.seed ?? 1}):`, ...made.map((m) => `  ${m.name}.png ${m.w}x${m.h}: ${SAYS[m.name]}`), "the picture shows them in that order, left to right, shrunk"].join("\n"),
        images: [h.keepPicture("surfaces", sheet(made.map((m) => ({ w: m.w, h: m.h, px: m.px }))))],
      };
    },
  );

  h.tool(
    "road_make",
    "Make a racing route's road as one ribbon mesh, `models/road_<name>.glb` (the same road the studio's track editor and track_write write: a crowned surface with painted edges, verges, a skirt down to the ground), WITHOUT touching its scene: from the saved track (`track`: its name, tracks/<name>.track.json; `tracks`: several, or \"all\") or from `control` points given here (a closed circuit, or `open`: true for a stage; [x, z] in metres) with `name`. " +
      `\`road\`: ${ROAD_KINDS.join(", ")} (the colours); \`zones\`: [{ from, to, road?, width? }] stretches with their own surface or width (metres along the route). \`textured\`: true lays texture coordinates and names textures/road.png and road_grain.png (made with surface_make when the project has none): the worn racing line, cracks, ruts and ragged edges of the road sheet; with a saved track it also sets "textured" in the track file, as the track editor does. ` +
      "Draw it with nova.model(\"road_<name>\", 0, 0, 0). Use track_write for the whole course (scene, gates, scenery); use this after changing a track by hand or to give a game's own route a road. It returns the road from above.",
    {
      track: { type: "string", description: "A saved track's name (tracks/<name>.track.json)." },
      tracks: { type: ["array", "string"], items: { type: "string" }, description: 'Several saved tracks, or "all".' },
      name: { type: "string", description: "With `control`: the road's name (models/road_<name>.glb)." },
      control: { type: "array", items: { type: "array", items: { type: "number" } }, description: "[x, z] points the road passes through (at least four)." },
      open: { type: "boolean" },
      road: { type: "string", description: ROAD_KINDS.join(", ") },
      zones: { type: "array", items: { type: "object" } },
      textured: { type: "boolean" },
      preview: { type: "boolean", description: "false: no picture." },
    },
    [],
    (a) => {
      const root = h.root(a);
      const jobs: { name: string; control: number[][]; road: string; open: boolean; zones: Args[]; textured: boolean }[] = [];
      if (a.control !== undefined) {
        if (a.track !== undefined || a.tracks !== undefined) throw new Error("give `control` (with `name`) or saved `track`/`tracks`, not both");
        if (!Array.isArray(a.control) || a.control.length < 4 || a.control.some((p: unknown) => !Array.isArray(p) || p.length !== 2)) throw new Error("control needs at least four [x, z] points");
        if (a.road !== undefined && !ROAD_KINDS.includes(a.road)) throw new Error(`road is ${ROAD_KINDS.join(", ")}`);
        jobs.push({ name: h.safeName(a.name, "Road"), control: a.control, road: a.road ?? "road_asphalt", open: a.open === true, zones: a.zones ?? [], textured: a.textured === true });
      } else {
        const dir = join(root, "tracks");
        const all = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".track.json")).map((f) => f.replace(/\.track\.json$/, "")).sort() : [];
        const names: string[] = a.tracks === "all" ? all : Array.isArray(a.tracks) ? a.tracks : a.track !== undefined ? [a.track] : [];
        if (!names.length) throw new Error(`say which road: \`track\` (${all.join(", ") || "this project has no tracks/"}), \`tracks\` ("all"), or \`control\` points with a \`name\``);
        for (const n of names) {
          const file = join(root, trackOf(n));
          if (!existsSync(file)) throw new Error(`there is no ${trackOf(n)} (the tracks: ${all.join(", ") || "none"})`);
          let raw = readFileSync(file, "utf8");
          if (a.textured === true && !/"textured":\s*true/.test(raw)) {
            // (where the editor writes it: the last setting before the control points)
            const p = parseTrack(raw);
            if (!p.ok) throw new Error(`${trackOf(n)}: ${p.error}`);
            const doc = { ...p.doc, textured: true };
            raw = serializeTrack(doc as never);
            h.put(root, trackOf(n), raw);
          }
          const t = JSON.parse(raw);
          jobs.push({ name: n, control: t.control, road: t.road ?? "road_asphalt", open: t.open === true, zones: t.zones ?? [], textured: t.textured === true });
        }
      }
      const madeSurfaces = jobs.some((j) => j.textured) ? need(a, ["road", "road_grain"]) : [];
      const lines: string[] = [];
      for (const j of jobs) {
        const glb = roadGlb(j.control, j.road, j.open, j.zones, j.textured);
        h.put(root, roadOf(j.name), glb);
        lines.push(`${roadOf(j.name)}: ${j.open ? "a stage" : "a circuit"} of ${j.control.length} control points, ${j.road}${j.zones.length ? `, ${j.zones.length} zones` : ""}${j.textured ? ", textured (textures/road.png, road_grain.png)" : ""}, ${Math.round(glb.length / 1024)} KB`);
      }
      if (madeSurfaces.length) lines.push(`made ${madeSurfaces.map((s) => `textures/${s}.png`).join(", ")} with surface_make (the project had none)`);
      lines.push(`in Lua: nova.model("road_${jobs[0]!.name}", 0, 0, 0)`);
      const shown = a.preview === false ? "" : h.call("model_preview", { project: a.project, name: `road_${jobs[0]!.name}`, yaw: 25, pitch: 55 });
      return { text: [...lines, text(shown).split("\n").slice(-1)[0] ?? ""].join("\n"), images: images(shown) };
    },
  );

  h.tool(
    "land_make",
    `Make the ground under a racing game's circuits: \`models/<name>.glb\`, a grid of small squares (\`cells\` x \`cells\` squares of \`cell\` metres: 50 of 16 when left out, 800 m across) that the hills of nova.terrain lift vertex by vertex, textured with a base picture every \`tile\` metres (64) and a detail picture \`repeat\` times in it (8). \`ground\`: ${Object.keys(GROUNDS).join(", ")} (its tint and pictures; the pictures are made with surface_make when the project has none); \`color\` changes the tint. ` +
      "Draw it at the camera, snapped to a whole tile so the picture does not slide: nova.model(\"<name>\", math.floor(cx / 64 + 0.5) * 64, 0, math.floor(cz / 64 + 0.5) * 64). It is a plain .glb made here (no .model.json: the model editor does not draw grids of this size), the same file every time. It returns the ground from above.",
    {
      name: { type: "string", description: 'The model\'s name ("land").' },
      ground: { type: "string", description: Object.keys(GROUNDS).join(", ") },
      color: { type: "string", description: 'The tint, "#rrggbb" (the ground\'s own when left out).' },
      cells: { type: "number", description: "Squares along each side (10 to 120; 50)." },
      cell: { type: "number", description: "Each square's side in metres (2 to 32; 16)." },
      tile: { type: "number", description: "Metres the base picture covers (64)." },
      repeat: { type: "number", description: "Times the detail picture repeats in one tile (8)." },
      preview: { type: "boolean", description: "false: no picture." },
    },
    ["name"],
    (a) => {
      const root = h.root(a);
      const name = h.safeName(a.name, "Model");
      const g = GROUNDS[a.ground ?? "grass"];
      if (!g) throw new Error(`ground is ${Object.keys(GROUNDS).join(", ")}, not ${JSON.stringify(a.ground)}`);
      if (a.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(a.color)) throw new Error('color is "#rrggbb"');
      const made = need(a, [g.base, g.detail]);
      const means = JSON.parse(readFileSync(join(root, "textures", "means.json"), "utf8"));
      const o = { cells: Math.max(10, Math.min(120, Math.round(Number(a.cells ?? 50)))), cell: Math.max(2, Math.min(32, Number(a.cell ?? 16))), tile: Number(a.tile ?? 64), repeat: Number(a.repeat ?? 8) };
      const glb = landGlb({ ...g, colour: a.color ?? g.colour }, means, o);
      h.put(root, `models/${name}.glb`, glb);
      const shown = a.preview === false ? "" : h.call("model_preview", { project: a.project, name, yaw: 30, pitch: 40 });
      return {
        text: [`models/${name}.glb: ${a.ground ?? "grass"} ground, ${o.cells} x ${o.cells} squares of ${o.cell} m (${o.cells * o.cell} m across, centred on the origin, 0.25 under it), textures/${g.base}.png every ${o.tile} m and ${g.detail}.png ${o.repeat} times in each`, ...(made.length ? [`made ${made.map((s) => `textures/${s}.png`).join(", ")} with surface_make (the project had none)`] : []), text(shown).split("\n").slice(-1)[0] ?? ""].join("\n"),
        images: images(shown),
      };
    },
  );

  return {
    surface_make: { surfaces: ["ground_grass", "grass_detail", "road", "road_grain"] },
    road_make: { name: "loop", control: [[0, 60], [55, 30], [50, -40], [0, -60], [-50, -40], [-55, 30]], textured: true },
    land_make: { name: "land", ground: "grass" },
  };
}
