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

export function previewModel(root: string, name: string, a: Args, run: Run, keep: (label: string, picture: Raster) => string): { text: string; images: string[] } {
  const glb = join(root, `models/${name}.glb`);
  if (!existsSync(glb)) throw new Error(`there is no models/${name}.glb (model_write makes it)`);
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
local f, duration = 0, 0
local clips = nova.model_clips(name)
local listed = {}
for _, c in ipairs(clips) do listed[#listed + 1] = string.format("%s %.2fs", c.name, c.duration) end
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
  local mid = size / 2
  local d = distance or (close and size * 3.6 or 4)
  nova.clear(120, 150, 190)
  nova.light { dir = { -0.5, -1, -0.4 }, ambient = { 110, 115, 130 } }
  nova.camera(d * math.sin(yaw) * math.cos(pitch), mid + d * math.sin(pitch), d * math.cos(yaw) * math.cos(pitch), 0, mid, 0, fov)
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
    for part, p in pairs(pose) do parts[#parts + 1] = string.format("%s=%.3f", part, p.y) end
    table.sort(parts)
    nova.log(string.format("POSE %d %.3f %s", m[2], t, table.concat(parts, " ")))
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
    const poses = log.filter((l) => l.startsWith("POSE ")).map((l) => {
      const [, i, t, ...parts] = l.split(" ");
      return { i: Number(i), t: Number(t), parts: Object.fromEntries(parts.map((p) => [p.slice(0, p.lastIndexOf("=")), Number(p.slice(p.lastIndexOf("=") + 1))])) as Record<string, number> };
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
    lines.push(`preview of ${name}, ${what}; framed for a height of ${size.toFixed(2)} world units${a.size === undefined ? " (guessed from its joints: pass `size` if it is cut off or small)" : ""}; each picture ${tw}x${th}`);
    lines.push(`clips: ${clips || "none"}`);
    for (const v of views) if (v.says) lines.push(`${v.name}: ${v.says}`);
    if (close) lines.push("the dark lines are the ground (y = 0): one across the picture, one from front to back. Feet that float or sink show against them.");
    // how high each part's joint is, moment by moment: the lowest parts (feet) first
    if (posed && poses.length) {
      const names = Object.keys(poses[0]!.parts);
      const lowest = (n: string) => Math.min(...poses.map((p) => p.parts[n] ?? 0));
      const shown = names.sort((x, y) => lowest(x) - lowest(y)).slice(0, a.parts === "all" ? 200 : 8);
      const wide = Math.max(...shown.map((n) => n.length), 4);
      lines.push(`height of each part's joint above the ground (world units; the ${shown.length} lowest${names.length > shown.length ? ` of ${names.length}: parts: "all" lists every one` : ""}). A joint is where the part turns (an ankle, not a sole):`);
      lines.push(`  ${"time".padEnd(wide)}  ${poses.map((p) => p.t.toFixed(2).padStart(6)).join(" ")}`);
      for (const n of shown) lines.push(`  ${n.padEnd(wide)}  ${poses.map((p) => (p.parts[n] ?? 0).toFixed(3).padStart(6)).join(" ")}`);
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
