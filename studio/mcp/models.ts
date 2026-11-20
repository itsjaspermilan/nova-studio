// model_preview: a model drawn by the game's own renderer, at rest or posed by a clip at a time, and as a strip: several
// moments of a clip side by side, from the front and the side, on a ground line, with the time under each.

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Raster } from "../src/lib/pixels";
import { contactSheet, readPng } from "./draw";

type Args = Record<string, any>;
type Run = (args: string[], timeout?: number) => { code: number; out: string };

const VIEWS: Record<string, { yaw: number; pitch: number; says: string }> = {
  front: { yaw: 0, pitch: 0, says: "from the front (the camera on +z; the model's +x is on the right of the picture)" },
  side: { yaw: 90, pitch: 0, says: "from the model's +x side (its front, +z, is on the left of the picture)" },
  right: { yaw: 90, pitch: 0, says: "from the model's +x side (its front, +z, is on the left of the picture)" },
  left: { yaw: -90, pitch: 0, says: "from the model's -x side (its front, +z, is on the right of the picture)" },
  back: { yaw: 180, pitch: 0, says: "from behind" },
  top: { yaw: 0, pitch: 89, says: "from above (the model's front, +z, is towards the bottom of the picture)" },
  quarter: { yaw: 35, pitch: 22, says: "from the front right, a little above" },
};

const lua = (v: unknown): string => (typeof v === "string" ? JSON.stringify(v) : String(v));

export interface Bounds {
  min: [number, number, number];
  max: [number, number, number];
}

/// The box round a model at rest, in world units, read from its .glb: every mesh's own box (glTF keeps the smallest and
/// largest position of each) carried through the nodes above it. Nothing when the file cannot be read that way.
export function glbBounds(bytes: Uint8Array): Bounds | null {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(0, true) !== 0x46546c67) return null;
    const length = view.getUint32(12, true);
    const gltf = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length)));
    type M = number[]; // (4x4, column-major, as glTF has them)
    const identity: M = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const times = (a: M, b: M): M => {
      const out = new Array(16).fill(0);
      for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r]! * b[c * 4 + k]!;
      return out;
    };
    const local = (n: any): M => {
      if (Array.isArray(n.matrix)) return n.matrix;
      const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
      const [sx, sy, sz] = n.scale ?? [1, 1, 1];
      const [tx, ty, tz] = n.translation ?? [0, 0, 0];
      return [
        (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
        2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
        2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
        tx, ty, tz, 1,
      ];
    };
    const out: Bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    const visit = (index: number, above: M) => {
      const node = gltf.nodes?.[index];
      if (!node) return;
      const world = times(above, local(node));
      const mesh = node.mesh !== undefined ? gltf.meshes?.[node.mesh] : undefined;
      // (a skinned mesh's points are in the model's own space: its node's place does not move them)
      const m = node.skin !== undefined ? identity : world;
      for (const prim of mesh?.primitives ?? []) {
        const acc = gltf.accessors?.[prim.attributes?.POSITION];
        if (!acc?.min || !acc?.max) continue;
        for (let corner = 0; corner < 8; corner++) {
          const p = [0, 1, 2].map((k) => ((corner >> k) & 1 ? acc.max[k] : acc.min[k]) as number);
          for (let k = 0; k < 3; k++) {
            const v = m[k]! * p[0]! + m[4 + k]! * p[1]! + m[8 + k]! * p[2]! + m[12 + k]!;
            out.min[k] = Math.min(out.min[k]!, v);
            out.max[k] = Math.max(out.max[k]!, v);
          }
        }
      }
      for (const child of node.children ?? []) visit(child, world);
    };
    for (const root of gltf.scenes?.[gltf.scene ?? 0]?.nodes ?? []) visit(root, identity);
    return Number.isFinite(out.min[0]) ? out : null;
  } catch {
    return null;
  }
}

const sizeText = (b: Bounds) => `${(b.max[0] - b.min[0]).toFixed(2)} wide (x), ${(b.max[1] - b.min[1]).toFixed(2)} high (y), ${(b.max[2] - b.min[2]).toFixed(2)} deep (z), from y ${b.min[1].toFixed(2)} to ${b.max[1].toFixed(2)}`;

/// Several models in one picture, all at one scale (that of the largest), each from the same side, with its name and size.
export function previewModels(root: string, names: string[], a: Args, run: Run, keep: (label: string, picture: Raster) => string): { text: string; images: string[] } {
  if (!names.length) throw new Error('names is a list of model names, like ["tree", "rock", "arch"]');
  if (names.length > 24) throw new Error(`names has ${names.length} models; one sheet shows up to 24`);
  for (const key of ["clip", "strip", "time"]) if (a[key] !== undefined) throw new Error(`\`${key}\` is for one model (name), not for a sheet of several (names)`);
  const bounds = names.map((n) => {
    const file = join(root, `models/${n}.glb`);
    if (!existsSync(file)) throw new Error(`there is no models/${n}.glb (model_write makes it)`);
    return glbBounds(readFileSync(file));
  });
  // one scale: the camera as far from each as the largest needs
  const radius = Math.max(...bounds.map((b) => (b ? Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) / 2 : 1)), 0.05);
  const tw = Number(a.width ?? 320), th = Number(a.height ?? 240);
  const tiles: { picture: Raster; caption: string }[] = [];
  const lines: string[] = [];
  let scratch: string[] = [];
  const hold = (_: string, picture: Raster) => {
    tiles.push({ picture, caption: "" });
    return "";
  };
  names.forEach((n, i) => {
    const r = previewModel(root, n, { ...a, names: undefined, width: tw, height: th, fit_radius: radius }, run, hold);
    tiles[tiles.length - 1]!.caption = n;
    scratch = r.text.split("\n");
    lines.push(`  ${n}: ${bounds[i] ? sizeText(bounds[i]!) : "size unknown"}; ${scratch.find((l) => l.startsWith("clips: ")) ?? "clips: none"}`);
  });
  const sheet = contactSheet(tiles, { columns: a.columns, maxWidth: 1920 });
  const file = keep("models", sheet);
  return {
    text: [`${names.length} models at one scale (the largest, ${(radius * 2).toFixed(2)} world units corner to corner, fills its picture), each ${tw}x${th}, from yaw ${Number(a.yaw ?? 35)}, pitch ${Number(a.pitch ?? 22)}; sizes in world units:`, ...lines, `saved at ${file}`].join("\n"),
    images: [file],
  };
}

export function previewModel(root: string, name: string, a: Args, run: Run, keep: (label: string, picture: Raster) => string): { text: string; images: string[] } {
  const glb = join(root, `models/${name}.glb`);
  if (!existsSync(glb)) throw new Error(`there is no models/${name}.glb (model_write makes it)`);
  const bounds = glbBounds(readFileSync(glb));
  const dir = mkdtempSync(join(tmpdir(), "nova-preview-"));
  try {
    mkdirSync(join(dir, "models"));
    copyFileSync(glb, join(dir, "models", `${name}.glb`));
    // (a model's picture, when it has one, sits beside it)
    for (const extra of [`models/${name}.texture.png`]) if (existsSync(join(root, extra))) copyFileSync(join(root, extra), join(dir, extra));
    if (existsSync(join(root, "textures"))) {
      // models lit by their glTF material name pictures in textures/
      try {
        mkdirSync(join(dir, "textures"));
        for (const f of readdirNames(join(root, "textures"))) copyFileSync(join(root, "textures", f), join(dir, "textures", f));
      } catch {
        // a picture that cannot be copied only changes the look
      }
    }
    writeFileSync(join(dir, "nova.json"), '{"format":1,"name":"preview"}');

    const strip = a.strip === true ? 8 : Number(a.strip ?? 0);
    if (strip && !(strip >= 2 && strip <= 16)) throw new Error("strip is how many moments of the clip to show, from 2 to 16 (true is 8)");
    if (strip && !a.clip) throw new Error("a strip shows moments of a clip: give `clip` too (the model's clips are listed when you call model_preview without one)");
    const viewNames: (string | number)[] = a.views ?? (a.view !== undefined ? [a.view] : strip ? ["front", "side"] : []);
    const views = viewNames.map((v) => {
      if (typeof v === "number") return { name: `yaw ${v}`, yaw: v, pitch: Number(a.pitch ?? 0), says: `from yaw ${v} degrees` };
      const known = VIEWS[String(v)];
      if (!known) throw new Error(`view '${v}' is not one of ${Object.keys(VIEWS).join(", ")} (or a yaw in degrees)`);
      return { name: String(v), ...known };
    });
    const posed = a.clip !== undefined;
    const close = views.length > 0; // (a named view is drawn nearly without perspective, so a ground line is a straight line)
    if (!views.length) views.push({ name: "", yaw: Number(a.yaw ?? 35), pitch: Number(a.pitch ?? 22), says: "" });
    const fov = close ? 20 : 45;
    const tw = Number(a.width ?? (strip ? 240 : 640)), th = Number(a.height ?? (strip ? 300 : 480));

    // the moments: one per view and time
    const count = strip || 1;
    const moments: { view: number; i: number }[] = [];
    views.forEach((_, v) => {
      for (let i = 0; i < count; i++) moments.push({ view: v, i });
    });
    const script = `
local name = ${lua(name)}
local clip, at, count = ${posed ? lua(String(a.clip)) : "nil"}, ${a.time === undefined ? "nil" : Number(a.time)}, ${count}
local size, distance = ${a.size === undefined ? "nil" : Number(a.size)}, ${a.distance === undefined ? "nil" : Number(a.distance)}
local views = { ${views.map((v) => `{ ${v.yaw}, ${v.pitch} }`).join(", ")} }
local moments = { ${moments.map((m) => `{ ${m.view + 1}, ${m.i} }`).join(", ")} }
local fov, close = ${fov}, ${close}
-- the box round the model at rest: the camera never comes so near that a corner of it leaves the picture
local bmin, bmax = ${bounds ? `{ ${bounds.min.join(", ")} }, { ${bounds.max.join(", ")} }` : "nil, nil"}
local half = math.atan(math.tan(math.rad(fov) / 2) * math.min(1, ${tw} / ${th}))
local forced, sized, grow = ${a.fit_radius === undefined ? "nil" : Number(a.fit_radius)}, ${a.size !== undefined || close}, ${posed ? 1.2 : 1.06}
local function fit_distance(tx, ty, tz)
  if forced then return forced * 1.06 / math.sin(half) end
  if not bmin then return 0 end
  local r = 0
  for i = 0, 7 do
    local x = (i % 2 == 0) and bmin[1] or bmax[1]
    local y = ((i // 2) % 2 == 0) and bmin[2] or bmax[2]
    local z = ((i // 4) % 2 == 0) and bmin[3] or bmax[3]
    r = math.max(r, math.sqrt((x - tx) ^ 2 + (y - ty) ^ 2 + (z - tz) ^ 2))
  end
  return r * grow / math.sin(half)
end
local f, duration = 0, 0
local clips = nova.model_clips(name)
local listed = {}
for _, c in ipairs(clips) do
  local events = {}
  for _, e in ipairs(c.events or {}) do events[#events + 1] = string.format("%s at %.2f", e.name, e.t) end
  listed[#listed + 1] = string.format("%s %.2fs%s", c.name, c.duration, #events > 0 and (" (events: " .. table.concat(events, "; ") .. ")") or "")
end
nova.log("CLIPS " .. table.concat(listed, ", "))
if clip then
  local found
  for _, c in ipairs(clips) do if c.name == clip then found = c end end
  if not found then error("the model has no clip '" .. clip .. "' (its clips: " .. (#listed > 0 and table.concat(listed, ", ") or "none") .. ")", 0) end
  duration = found.duration
end
-- how tall it is, as far as its joints say (a model of one part has only its origin: say its size then)
local top = 0
for _, p in pairs(nova.model_pose(name)) do top = math.max(top, p.y) end
if not size then size = (close or clip) and top > 0.3 and top * 1.3 or 1.5 end
nova.log(string.format("SIZE %.3f", size))
local function time_of(i)
  if at then return at end
  if count <= 1 then return 0 end
  return duration * i / (count - 1)
end
function update(dt)
  f = f + 1
  local m = moments[math.min(#moments, (f + 1) // 2)]
  local yaw, pitch = math.rad(views[m[1]][1]), math.rad(views[m[1]][2])
  local tx, mid, tz = 0, size / 2, 0
  if bmin and not close then tx, mid, tz = (bmin[1] + bmax[1]) / 2, (bmin[2] + bmax[2]) / 2, (bmin[3] + bmax[3]) / 2 end
  local d = distance or math.max(fit_distance(tx, mid, tz), (sized or not bmin) and (close and size * 3.6 or 4) or 0)
  nova.clear(120, 150, 190)
  nova.light { dir = { -0.5, -1, -0.4 }, ambient = { 110, 115, 130 } }
  nova.camera(tx + d * math.sin(yaw) * math.cos(pitch), mid + d * math.sin(pitch), tz + d * math.cos(yaw) * math.cos(pitch), tx, mid, tz, fov)
  if close then
    -- the ground: a line across the picture under the feet, and one from front to back
    local l = size * 2
    nova.line3(-l, 0, 0, l, 0, 0, { color = { 40, 60, 40 }, width = size * 0.008 })
    nova.line3(0, 0, -l, 0, 0, l, { color = { 40, 60, 40 }, width = size * 0.008 })
  end
  local t = time_of(m[2])
  local opts = clip and { clip = clip, time = t, loop = false } or nil
  nova.model(name, 0, 0, 0, opts)
  if f % 2 == 1 and m[1] == 1 then
    local pose = nova.model_pose(name, opts)
    local parts = {}
    -- each part's joint height and, when it has shapes of its own, how low they reach (a part that only carries a skinned
    -- mesh is left out: its triangles follow other parts, which are listed)
    for part, p in pairs(pose) do
      if not p.skin then parts[#parts + 1] = string.format("%s=%.3f/%s", part:gsub("[ =/|]", "_"), p.y, p.low and string.format("%.3f", p.low) or "-") end
    end
    table.sort(parts)
    nova.log(string.format("POSE|%d|%.3f|%s", m[2], t, table.concat(parts, "|")))
  end
end
`;
    writeFileSync(join(dir, "main.lua"), script);
    const frames = moments.length * 2;
    const out = join(dir, "out");
    writeFileSync(join(dir, "plan.json"), JSON.stringify({ out, frames, capture_at: moments.map((_, i) => i * 2 + 2) }));
    const r = run(["run", dir, "--headless", "--size", `${tw}x${th}`, "--play", join(dir, "plan.json")]);
    const reportFile = join(out, "report.json");
    if (!existsSync(reportFile)) throw new Error(`no picture was made:\n${r.out}`);
    const report = JSON.parse(readFileSync(reportFile, "utf8"));
    if (report.error) throw new Error(String(report.error));
    const log: string[] = (report.log ?? []).map((l: Args) => String(l.text));
    const clips = log.find((l) => l.startsWith("CLIPS "))?.slice(6) || "";
    const size = Number(log.find((l) => l.startsWith("SIZE "))?.slice(5) ?? a.size ?? 1.5);
    const poses = log.filter((l) => l.startsWith("POSE|")).map((l) => {
      const [, i, t, ...parts] = l.split("|");
      const joint: Record<string, number> = {}, low: Record<string, number> = {};
      for (const p of parts) {
        const name = p.slice(0, p.lastIndexOf("="));
        const [j, lo] = p.slice(p.lastIndexOf("=") + 1).split("/");
        joint[name] = Number(j);
        if (lo !== undefined && lo !== "-") low[name] = Number(lo);
      }
      return { i: Number(i), t: Number(t), parts: joint, low };
    });
    const captures: Args[] = report.captures ?? [];
    const tiles = captures.map((c, k) => {
      const m = moments[k]!;
      const t = poses.find((p) => p.i === m.i)?.t ?? 0;
      return { picture: readPng(c.file), caption: strip ? `${views[m.view]!.name} ${t.toFixed(2)}s` : views.length > 1 ? views[m.view]!.name : "" };
    });
    if (!tiles.length) throw new Error(`no picture was made:\n${r.out}`);
    const lines: string[] = [];
    const what = posed ? `clip ${a.clip}${strip ? `, ${strip} moments from 0 to ${poses.at(-1)?.t.toFixed(2)} s` : ` at ${(poses[0]?.t ?? 0).toFixed(2)} s`}` : "at rest";
    lines.push(`preview of ${name}, ${what}; framed for a height of ${size.toFixed(2)} world units${a.size === undefined ? " (guessed from its joints)" : ""}; each picture ${tw}x${th}`);
    if (bounds) lines.push(`size at rest: ${sizeText(bounds)} (world units); the camera stands back as far as the whole of it needs, so nothing is cut off`);
    lines.push(`clips: ${clips || "none"}`);
    for (const v of views) if (v.says) lines.push(`${v.name}: ${v.says}`);
    if (close) lines.push("the dark lines are the ground (y = 0): one across the picture, one from front to back. Feet that float or sink show against them.");
    // how high each part is, moment by moment: the parts that come lowest (the feet) first
    if (posed && poses.length) {
      const names = Object.keys(poses[0]!.parts);
      // (a part with shapes is ranked by the lowest point of them, one without by its joint)
      const reach = (p: (typeof poses)[number], n: string) => p.low[n] ?? p.parts[n] ?? 0;
      const lowest = (n: string) => Math.min(...poses.map((p) => reach(p, n)));
      const shown = names.sort((x, y) => lowest(x) - lowest(y)).slice(0, a.parts === "all" ? 200 : 8);
      const wide = Math.max(...shown.map((n) => n.length), 11);
      const row = (label: string, kind: string, values: (number | undefined)[]) => `  ${label.padEnd(wide)}  ${kind.padEnd(6)} ${values.map((v) => (v === undefined ? "-" : v.toFixed(3)).padStart(6)).join(" ")}`;
      lines.push(`heights above the ground at each moment (world units, y up; the ${shown.length} parts that come lowest${names.length > shown.length ? ` of ${names.length}: parts: "all" lists every one` : ""}). What each row is:`);
      lines.push("  whole model, lowest: the lowest point of anything in the model. 0.000 stands on the ground; above 0 the whole figure floats; below 0 something is sunk into the ground.");
      lines.push("  <part>, lowest: the lowest point of that part's own shapes in the pose (for a foot, its sole). The foot that stands should read about 0.000, the one that swings above it.");
      lines.push("  <part>, joint: the height of the point the part turns about (for a foot, the ankle; for a shin, the knee). It does not say where the part's shapes end.");
      lines.push(row("time (s)", "", poses.map((p) => p.t)).replace(/(\d\.\d\d)\d/g, " $1"));
      if (poses.some((p) => Object.keys(p.low).length)) lines.push(row("whole model", "lowest", poses.map((p) => (Object.keys(p.low).length ? Math.min(...Object.values(p.low)) : undefined))));
      for (const n of shown) {
        if (poses.some((p) => p.low[n] !== undefined)) lines.push(row(n, "lowest", poses.map((p) => p.low[n])));
        lines.push(row(poses.some((p) => p.low[n] !== undefined) ? "" : n, "joint", poses.map((p) => p.parts[n])));
      }
    }
    const picture = tiles.length === 1 ? tiles[0]!.picture : contactSheet(tiles, { columns: strip || tiles.length, maxWidth: 1920 });
    const file = keep(`preview-${name}`, picture);
    lines.push(`saved at ${file}`);
    return { text: lines.join("\n"), images: [file] };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function readdirNames(dir: string): string[] {


  return readdirSync(dir).filter((f) => /\.(png|ktx2)$/i.test(f));
}
