// scene_preview for a 3D scene: the scene file seen from straight above, as a plan. Every object is its model's footprint
// (the box round the model, turned and scaled as the scene places it) with its name, the solid ones marked, on a grid with
// coordinates and a scale, so that waypoints for a walk can be read off it without running the game.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { newRaster, type Raster, type Rgba } from "../src/lib/pixels";
import { DIM, fill, INK, label, line, PAPER, textSize } from "./draw";
import { glbBounds, type Bounds } from "./models";

type Args = Record<string, any>;

interface Kind {
  model: string | null;
  bounds: Bounds | null;
  /// What blocks: the model itself, another model the entity names for it (a tree's trunk), or nothing.
  solid: Bounds | null;
  why: string;
}

/// What an entity file says about its model and whether it blocks, read off its text (and the file it builds on).
function kindOf(root: string, kind: string, seen = new Set<string>()): Kind {
  const file = join(root, "entities", `${kind.replace(/\./g, "/")}.lua`);
  const text = existsSync(file) ? readFileSync(file, "utf8").replace(/--[^\n]*/g, "") : "";
  const bounds = (model: string | null) => {
    const glb = model ? join(root, "models", `${model}.glb`) : "";
    return glb && existsSync(glb) ? glbBounds(readFileSync(glb)) : null;
  };
  const parentName = /require\s*\(?\s*["']entities[./]([\w./]+)["']/.exec(text)?.[1];
  seen.add(kind);
  const parent = parentName && !seen.has(parentName) ? kindOf(root, parentName, seen) : null;
  const model = /\bmodel\s*=\s*["']([\w/-]+)["']/.exec(text)?.[1] ?? parent?.model ?? (existsSync(join(root, "models", `${kind}.glb`)) ? kind : null);
  const named = /\bsolid\w*\s*=\s*["']([\w/-]+)["']/.exec(text)?.[1];
  const off = /\bsolid\w*\s*=\s*false\b/.test(text);
  const tagged = /tags\s*=\s*\{[^}]*["']solid["']/.test(text) || /\bsolid\s*=\s*true\b/.test(text);
  const adds = /nova\.(solid\.add|walls\.(add|cuboid|set_box))|scenery\.add/.test(text);
  const own = bounds(model);
  if (named) return { model, bounds: own, solid: bounds(named) ?? own, why: `blocks with the model "${named}"` };
  if (off && !tagged) return { model, bounds: own, solid: null, why: "" };
  if (tagged || adds) return { model, bounds: own, solid: own, why: tagged ? "tagged or set solid" : "its code adds itself to what is solid" };
  if (parent?.solid && !/\bsolid\w*\s*=/.test(text) && parent.why !== "") {
    // (built on a kind that blocks, and does not say otherwise: only when the parent blocks by itself, not by a setting)
    return { model, bounds: own, solid: parent.why.startsWith("blocks with") ? null : own, why: parent.why.startsWith("blocks with") ? "" : parent.why };
  }
  return { model, bounds: own, solid: null, why: "" };
}

const SOLID: Rgba = [235, 90, 80, 255];
const SOFT: Rgba = [110, 170, 235, 255];
const BARE: Rgba = [240, 170, 60, 255];
const GRID: Rgba = [50, 56, 68, 255];
const AXIS: Rgba = [96, 104, 122, 255];

/// The plan of a 3D scene, or nothing when the scene is flat (it has no "camera").
export function planScene(root: string, name: string, opts: { area?: number[]; zoom?: number; labels?: boolean; grid?: boolean } = {}): { text: string; picture: Raster } | null {
  const short = name.replace(/\.scene\.json$/, "").replace(/^scenes\//, "");
  const file = join(root, "scenes", `${short}.scene.json`);
  if (!existsSync(file)) return null;
  let scene: Args;
  try {
    scene = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  if (!scene || typeof scene !== "object" || !scene.camera) return null;
  const objects: Args[] = Array.isArray(scene.objects) ? scene.objects.filter((o: unknown) => o && typeof o === "object") : [];
  const kinds = new Map<string, Kind>();
  const shapes = objects.map((o) => {
    const kind = String(o.kind ?? "?");
    if (!kinds.has(kind)) kinds.set(kind, kindOf(root, kind));
    const k = kinds.get(kind)!;
    const s = Number(o.props?.sx ?? o.props?.scale ?? 1) || 1, ry = Number(o.props?.ry ?? 0) || 0;
    const x = Number(o.x ?? 0), z = Number(o.z ?? 0);
    const corners = (b: Bounds | null): [number, number][] | null =>
      b &&
      ([[b.min[0], b.min[2]], [b.max[0], b.min[2]], [b.max[0], b.max[2]], [b.min[0], b.max[2]]] as [number, number][]).map(([lx, lz]) => [x + (lx * Math.cos(ry) + lz * Math.sin(ry)) * s, z + (-lx * Math.sin(ry) + lz * Math.cos(ry)) * s]);
    return { o, kind, k, x, z, foot: corners(k.bounds), block: corners(k.solid) };
  });
  // what to show: everything, with a margin, or the area asked for ([x, z, width, depth])
  const all = shapes.flatMap((s) => [[s.x, s.z] as [number, number], ...(s.foot ?? [])]);
  if (!all.length) all.push([0, 0]);
  let x0 = Math.min(...all.map((p) => p[0])), x1 = Math.max(...all.map((p) => p[0])), z0 = Math.min(...all.map((p) => p[1])), z1 = Math.max(...all.map((p) => p[1]));
  const pad = Math.max(1, (x1 - x0 + z1 - z0) * 0.04);
  [x0, x1, z0, z1] = [x0 - pad, x1 + pad, z0 - pad, z1 + pad];
  if (Array.isArray(opts.area) && opts.area.length === 4) [x0, z0, x1, z1] = [opts.area[0]!, opts.area[1]!, opts.area[0]! + opts.area[2]!, opts.area[1]! + opts.area[3]!];
  const span = Math.max(x1 - x0, z1 - z0, 0.1);
  const ppu = opts.zoom && opts.zoom > 0 ? opts.zoom : Math.max(2, Math.min(64, Math.floor(1100 / span)));
  const left = 44, top = 30, bottom = 30;
  const w = Math.min(4000, Math.ceil((x1 - x0) * ppu)), h = Math.min(4000, Math.ceil((z1 - z0) * ppu));
  const out = newRaster(left + w + 12, top + h + bottom);
  fill(out, 0, 0, out.w, out.h, PAPER);
  const px = (x: number) => left + Math.round((x - x0) * ppu), pz = (z: number) => top + Math.round((z - z0) * ppu);
  // the grid: a line every step metres, numbered along the top and the left
  const step = [1, 2, 5, 10, 20, 50, 100].find((s) => s * ppu >= 44) ?? 100;
  if (opts.grid !== false) {
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
      line(out, px(x), top, px(x), top + h, x === 0 ? AXIS : GRID);
      label(out, px(x) - textSize(String(x)).w / 2, top - 12, String(x), DIM, 1, false);
    }
    for (let z = Math.ceil(z0 / step) * step; z <= z1; z += step) {
      line(out, left, pz(z), left + w, pz(z), z === 0 ? AXIS : GRID);
      label(out, 4, pz(z) - 4, String(z), DIM, 1, false);
    }
  }
  label(out, left, 4, `x ->   (z runs down the picture: +z is towards the viewer of the default camera)   grid ${step} m`, DIM, 1, false);
  const poly = (pts: [number, number][], c: Rgba) => pts.forEach((p, i) => line(out, px(p[0]), pz(p[1]), px(pts[(i + 1) % pts.length]![0]), pz(pts[(i + 1) % pts.length]![1]), c));
  for (const s of shapes) {
    if (s.foot) poly(s.foot, s.block ? [150, 80, 76, 255] : SOFT);
    if (s.block) {
      poly(s.block, SOLID);
      // (hatched, so that what blocks reads at a glance)
      const xs = s.block.map((p) => px(p[0])), zs = s.block.map((p) => pz(p[1]));
      const [ax, bx, az, bz] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
      if (bx - ax <= 3 && bz - az <= 3) fill(out, ax, az, Math.max(2, bx - ax), Math.max(2, bz - az), SOLID);
    }
    if (!s.foot) {
      // no model to measure: a cross where it is
      line(out, px(s.x) - 4, pz(s.z), px(s.x) + 4, pz(s.z), BARE);
      line(out, px(s.x), pz(s.z) - 4, px(s.x), pz(s.z) + 4, BARE);
    } else fill(out, px(s.x) - 1, pz(s.z) - 1, 2, 2, INK);
  }
  // names: every named object, and the rest while they are few (else one of each kind)
  if (opts.labels !== false) {
    const told = new Set<string>();
    const few = shapes.length <= 60;
    for (const s of shapes) {
      const text = s.o.name ? `${s.o.name}:${s.kind}` : s.kind;
      if (!s.o.name && !few && told.has(s.kind)) continue;
      told.add(s.kind);
      label(out, px(s.x) + 4, pz(s.z) - 10, text, s.block ? [255, 190, 180, 255] : INK, 1, true);
    }
  }
  // a scale bar
  const bar = step * ppu;
  fill(out, left, top + h + 12, bar, 2, INK);
  label(out, left + bar + 6, top + h + 8, `${step} m   red: blocks (solid)   blue: its model's footprint, does not block   orange cross: no model found`, DIM, 1, false);

  const lines: string[] = [];
  const n = (v: number) => String(Math.round(v * 100) / 100);
  lines.push(`scenes/${short}.scene.json from above (a 3D scene): ${objects.length} objects, x ${n(x0)} to ${n(x1)}, z ${n(z0)} to ${n(z1)} metres, ${ppu} pixels a metre, grid ${step} m. x runs to the right and z down the picture.`);
  lines.push("Each object is the box round its model, turned and sized as placed. Red blocks the way (the entity's file tags it solid, names a model that blocks, or adds itself to nova.solid, nova.walls or the scenery); blue does not. This is read off the files: what the scene's own code makes solid (the ground, scattered scenery) is not on the plan.");
  if (scene.camera?.eye) lines.push(`the scene's camera: eye ${JSON.stringify(scene.camera.eye)}, target ${JSON.stringify(scene.camera.target ?? [0, 0, 0])}`);
  const byKind = new Map<string, typeof shapes>();
  for (const s of shapes) byKind.set(s.kind, [...(byKind.get(s.kind) ?? []), s]);
  for (const [kind, list] of byKind) {
    const k = kinds.get(kind)!;
    const b = k.bounds;
    const size = b ? `${n(b.max[0] - b.min[0])} x ${n(b.max[2] - b.min[2])} m on the ground, ${n(b.max[1] - b.min[1])} high` : existsSync(join(root, "entities", `${kind}.lua`)) ? "no model" : `NO entities/${kind}.lua`;
    const at = list.map((s) => `${s.o.name ? `${s.o.name} ` : ""}[${n(s.x)}, ${n(s.z)}]${s.o.props?.ry ? ` ry ${n(s.o.props.ry)}` : ""}`);
    lines.push(`  ${kind} x${list.length} (${size}${k.solid ? `; SOLID: ${k.why}` : ""}): ${at.slice(0, 14).join(", ")}${at.length > 14 ? `, ... ${at.length - 14} more` : ""}`);
  }
  lines.push('Points for a route are [x, z]: { "walk_to": [x, z] } in play finds its own way round what is solid in the running game.');
  return { text: lines.join("\n"), picture: out };
}
