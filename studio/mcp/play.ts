// The play tool: one headless run of the game along a route, returned as a film strip and a report in words.
// It writes a play plan (crates/nova-runtime/src/playtest.rs) and reads back the pictures and report.json the run made.

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { Raster } from "../src/lib/pixels";
import { contactSheet, cropZoom, pngOf, readPng } from "./draw";

type Args = Record<string, any>;
type Run = (args: string[], timeout?: number) => { code: number; out: string };

export const ROUTE_HELP =
  'A route is a list of steps played in order, using the game\'s input action names: { "hold": ["right"], "frames": 40 } holds for 40 frames (60 = one second; "move_x=-1" sets an axis, "key:Enter" holds a key); ' +
  '{ "press": "a" } taps (three frames); { "wait": 20 } lets time pass; { "hold": ["right"], "until": "nova.named(\'hero\').x > 300", "max": 300 } holds until a Lua expression is true (at most `max` frames, 600 by default; a warning says when it never was, unless the step has "may_time_out": true); ' +
  '{ "lua": "nova.named(\'hero\').hp = 1" } runs Lua at that moment (if it fails, the answer says so with the step\'s number and the run goes on); any step may add "capture": "a caption" to take a picture when it ends. ' +
  'Walking and acting at once: { "hold": ["right"], "tap": "a", "tap_every": 30, "until": "..." } taps `a` every 30 frames for as long as the step lasts. ' +
  'Repeating: { "repeat": 5, "steps": [ {...}, {...} ] } plays a group of steps five times; with "until" the group stops as soon as the expression is true, in the middle of a step too (up to 100 rounds when `repeat` is left out); "repeat" on a plain step plays that step again. Steps in a group are reported as "step 3.2 (round 4 of 5)". ' +
  'Walking to a place: { "walk_to": [x, y], "who": "hero" } steers an entity to a point and ends when it is within `radius` (12 units; in a 3D game the point is [x, z] on the ground and the radius 0.5). `who` is a scene object\'s name or a tag (left out: the one named or tagged hero or player, or what the 2D camera follows). ' +
  "It drives the axes move_x, move_y and the buttons left, right, up, down together (\"axes\": [x, y] and \"dirs\": [left, right, up, down] name other actions) and measures each frame which way the walker really went, so it also works when the stick is relative to a turned camera. It walks straight, without path finding: round a wall takes two walk_to steps. It gives up with a warning that says where the walker is when it stops getting nearer for two seconds, or after `max` frames (600). \"plane\": \"xy\" or \"xz\" says which fields the point is in when the guess (xz for an entity with a model) is wrong. " +
  "`crop`, `zoom`, `every`, `capture_at` and `print` are options of the whole call, not of a step.";

const STEP_KEYS = ["hold", "press", "tap", "tap_every", "frames", "wait", "until", "max", "may_time_out", "quiet", "capture", "lua", "repeat", "steps", "walk_to", "who", "radius", "plane", "axes", "dirs"];

function checkSteps(steps: unknown, where: string) {
  if (!Array.isArray(steps)) throw new Error(`${where || "route"} must be a list of steps. ${ROUTE_HELP}`);
  steps.forEach((s, i) => {
    const label = `route step ${where}${i + 1}`;
    if (!s || typeof s !== "object" || Array.isArray(s)) throw new Error(`${label} is ${JSON.stringify(s)}, not an object. ${ROUTE_HELP}`);
    const unknown = Object.keys(s).filter((k) => !STEP_KEYS.includes(k));
    if (unknown.length) {
      const top = unknown.filter((k) => ["crop", "zoom", "every", "capture_at", "print", "seed", "size", "state"].includes(k));
      throw new Error(`${label} has "${unknown.join('", "')}", which a step does not have${top.length ? ` ("${top.join('", "')}" ${top.length > 1 ? "are options" : "is an option"} of the whole play call: put ${top.length > 1 ? "them" : "it"} beside "route")` : ""}. ${ROUTE_HELP}`);
    }
    if (s.walk_to !== undefined && !(Array.isArray(s.walk_to) && s.walk_to.length === 2 && s.walk_to.every((v: unknown) => typeof v === "number"))) {
      throw new Error(`${label}: walk_to is a point, [x, y] in a 2D game or [x, z] on the ground of a 3D one (got ${JSON.stringify(s.walk_to)})`);
    }
    if (s.steps !== undefined) checkSteps(s.steps, `${where}${i + 1}.`);
  });
}

function sizeOf(a: Args): [number, number] {
  if (typeof a.size === "string") {
    const m = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(a.size.trim());
    if (!m) throw new Error(`size is "WIDTHxHEIGHT", like "960x540" (got ${JSON.stringify(a.size)})`);
    return [Number(m[1]), Number(m[2])];
  }
  if (Array.isArray(a.size) && a.size.length === 2) return [Number(a.size[0]), Number(a.size[1])];
  return [Number(a.width ?? 960), Number(a.height ?? 540)];
}

const round = (v: unknown) => (typeof v === "number" ? Math.round(v * 10) / 10 : v);
const round2 = (v: unknown) => (typeof v === "number" ? Math.round(v * 100) / 100 : v);

/// Where an entity is, as text: `x, y` in a flat game; `x, y, z` (y is up) when it has a z.
const place = (e: Args) => (e.z !== undefined ? `${round2(e.x)}, ${round2(e.y)}, ${round2(e.z)}` : `${round(e.x)}, ${round(e.y)}`);

function stateLines(state: Args | undefined, all: boolean): string[] {
  if (!state || !Array.isArray(state.entities)) return [];
  const out: string[] = [];
  const cam = Array.isArray(state.camera) ? `, camera at ${round(state.camera[0])}, ${round(state.camera[1])}` : "";
  if (state.scene === undefined && !state.entities.length) return ["(no scene: this game draws by itself, without nova.start, so there are no entities to list)"];
  const list: Args[] = state.entities;
  const deep = list.some((e) => e.z !== undefined);
  out.push(`scene ${state.scene ?? "(none)"}${cam}, ${state.count ?? state.entities.length} entities alive${deep ? " (positions are x, y, z; y is up)" : ""}`);
  const show = (e: Args) => `${e.name ? `${e.name}:` : ""}${e.kind} at ${place(e)}${e.anim ? ` anim ${e.anim}` : ""}${e.frame !== undefined ? ` frame ${e.frame}` : ""}${e.hidden ? " (hidden)" : ""}`;
  if (!all) {
    const named = list.filter((e) => e.name);
    if (named.length) out.push(`  ${named.slice(0, 12).map(show).join("; ")}`);
    return out;
  }
  // every entity when there are few; otherwise the named ones, then a count of each kind with where the first few are
  if (list.length <= 40) for (const e of list) out.push(`  ${show(e)}`);
  else {
    for (const e of list.filter((x) => x.name)) out.push(`  ${show(e)}`);
    const kinds = new Map<string, Args[]>();
    for (const e of list.filter((x) => !x.name)) kinds.set(e.kind, [...(kinds.get(e.kind) ?? []), e]);
    for (const [kind, es] of kinds) out.push(`  ${kind} x${es.length}: ${es.slice(0, 6).map(place).join(" | ")}${es.length > 6 ? " ..." : ""}`);
  }
  return out;
}

/// A place in the project a run may write to: a folder (or file) that is not part of the game, so its pictures do not
/// become sprites: under build/, a dot-folder, or something nova.json's "ignore" lists.
function ignoredPlace(root: string, given: unknown, what: string): string {
  const rel = String(given).replace(/\/+$/, "");
  const full = resolve(root, rel);
  if (full === root || !full.startsWith(root + sep)) throw new Error(`${what} "${rel}" must be a path inside the project folder, such as "shots/run1" or "build/run1"`);
  const path = relative(root, full).split(sep).join("/");
  const top = path.split("/")[0]!;
  let ignore: string[] = [];
  try {
    const list = JSON.parse(readFileSync(join(root, "nova.json"), "utf8")).ignore;
    if (Array.isArray(list)) ignore = list.map(String);
  } catch {
    // (no manifest, or not JSON: nothing is ignored)
  }
  const ignored = top === "build" || path.split("/").some((p) => p.startsWith(".")) || ignore.some((e) => path === e || path.startsWith(`${e}/`));
  if (!ignored) {
    throw new Error(`${what} "${path}" is in a folder the game loads, so the pictures would become sprites of the game: use "build/${path}", or add "${top}" to nova.json's "ignore" list ({ "ignore": ["${top}"] }) and call again`);
  }
  return full;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

/// Runs the game headless as the arguments say and returns the words and the picture file.
export function playGame(root: string, a: Args, run: Run, keep: (label: string, picture: Raster) => string): { text: string; images: string[]; wrote?: string[] } {
  const [w, h] = sizeOf(a);
  if (!(w >= 64 && h >= 64 && w <= 3840 && h <= 2160)) throw new Error(`the picture size must be from 64x64 to 3840x2160 (got ${w}x${h})`);
  const outDir = a.out !== undefined && a.out !== null && a.out !== "" ? ignoredPlace(root, a.out, "out") : null;
  const audioFile = typeof a.audio === "string" && a.audio ? ignoredPlace(root, a.audio, "audio") : null;
  if (audioFile && !/\.wav$/i.test(audioFile)) throw new Error(`audio "${a.audio}" must end in .wav (or pass audio: true with \`out\`, which writes <out>/run.wav)`);
  const dir = mkdtempSync(join(tmpdir(), "nova-play-"));
  try {
    const route: Args[] = a.route ?? a.steps ?? [];
    checkSteps(route, "");
    const frames = a.frames ?? (route.length ? undefined : 90);
    const plan = {
      out: join(dir, "out"),
      steps: route,
      capture_at: a.capture_at ?? [],
      every: a.every ?? 0,
      print: a.print ?? [],
      ...(frames !== undefined ? { frames } : {}),
      ...(a.start_scene ? { start_scene: String(a.start_scene) } : {}),
      ...(a.lua ? { lua: String(a.lua) } : {}),
      ...(a.seed !== undefined ? { seed: Number(a.seed) } : {}),
    };
    const last = join(dir, "last.png");
    const wav = audioFile ?? (a.audio ? (outDir ? join(outDir, "run.wav") : join(tmpdir(), `nova-run-${Date.now()}.wav`)) : null);
    if (wav) mkdirSync(dirname(wav), { recursive: true });
    const cli = ["run", root, "--headless", "--size", `${w}x${h}`, "--capture", last];
    writeFileSync(join(dir, "plan.json"), JSON.stringify(plan));
    cli.push("--play", join(dir, "plan.json"));
    if (a.press?.length) cli.push("--press", a.press.join(","));
    if (a.hold?.length) cli.push("--hold", a.hold.join(","));
    if (wav) cli.push("--audio-out", wav);
    const r = run(cli, 300_000);
    const reportFile = join(dir, "out", "report.json");
    const report: Args | null = existsSync(reportFile) ? JSON.parse(readFileSync(reportFile, "utf8")) : null;
    const captures: Args[] = report?.captures ?? [];
    if (!existsSync(last) && !captures.length) throw new Error(`no picture was made:\n${r.out}`);

    const lines: string[] = [];
    const ran = report?.frames ?? frames;
    lines.push(`ran ${ran} frames (${(ran / 60).toFixed(1)} s of game time) at ${w}x${h}${a.seed !== undefined ? `, seed ${a.seed}` : ""}`);
    const stepErrors: string[] = report?.step_errors ?? [];
    const problem = report?.error ?? (r.code !== 0 && !stepErrors.length ? r.out.split("\n").filter((l) => /error|nova:/i.test(l)).slice(0, 4).join("\n") : null);
    if (problem) lines.push(`ERROR: ${problem}`);
    for (const e of stepErrors) lines.push(`ERROR in ${e} (the run went on: the pictures and values after it are of a run in which this did not happen)`);
    for (const wn of report?.warnings ?? []) lines.push(`warning: ${wn}`);
    for (const n of report?.notes ?? []) lines.push(`note: ${n}`);

    // the pictures: every capture, then the last frame unless a capture already shows it
    const crop = (p: Raster) => (a.crop || a.zoom ? cropZoom(p, a.crop, a.zoom ?? 1) : p);
    let tiles: { picture: Raster; caption: string }[] = [];
    const singles: { file: string; frame: number; label: string }[] = [];
    let shown = -1;
    for (const c of captures) {
      if (!existsSync(c.file)) continue;
      if (c.frame === shown) {
        // two reasons for a picture of the same frame: one tile, both captions
        if (c.label) tiles[tiles.length - 1]!.caption += ` ${c.label}`;
        continue;
      }
      shown = c.frame;
      tiles.push({ picture: crop(readPng(c.file)), caption: `f${c.frame}${c.label ? ` ${c.label}` : ""}` });
      singles.push({ file: c.file, frame: c.frame, label: c.label ?? "" });
    }
    if (existsSync(last) && !captures.some((c) => c.frame === ran)) {
      tiles.push({ picture: crop(readPng(last)), caption: captures.length ? `f${ran} end` : `f${ran}` });
      singles.push({ file: last, frame: ran, label: captures.length ? "end" : "" });
    }
    const wrote: string[] = [];
    const rel = (full: string) => relative(root, full).split(sep).join("/");
    if (outDir) {
      // every picture of the run as its own full-size file, where the caller said
      mkdirSync(outDir, { recursive: true });
      for (const s of singles) {
        const name = `f${String(s.frame).padStart(5, "0")}${s.label && slug(s.label) ? `-${slug(s.label)}` : ""}.png`;
        copyFileSync(s.file, join(outDir, name));
        wrote.push(rel(join(outDir, name)));
      }
      if (report) {
        // (the report's pictures are named as the files written here, not as the run's temporary ones)
        const fileOf = new Map(singles.map((s, i) => [s.frame, wrote[i]]));
        const kept = { ...report, captures: captures.map((c) => ({ ...c, file: fileOf.get(c.frame) })) };
        writeFileSync(join(outDir, "report.json"), `${JSON.stringify(kept, null, 2)}\n`);
      }
    }
    const max = 24;
    if (tiles.length > max) {
      const stride = Math.ceil(tiles.length / max);
      lines.push(`${tiles.length} pictures were taken; every ${stride}${stride === 2 ? "nd" : stride === 3 ? "rd" : "th"} is shown (ask for fewer with capture_at or a bigger every)`);
      tiles = tiles.filter((_, i) => i % stride === 0 || i === tiles.length - 1);
    }
    const images: string[] = [];
    if (tiles.length === 1) images.push(keep("shot", tiles[0]!.picture));
    else if (tiles.length > 1) {
      const strip = contactSheet(tiles, { columns: a.columns });
      images.push(keep("strip", strip));
      if (outDir) writeFileSync(join(outDir, "strip.png"), pngOf(strip));
      lines.push(`the picture is a film strip of ${tiles.length} moments, left to right, top to bottom, the frame number under each`);
    }
    if (a.crop || a.zoom) lines.push(`each picture is ${a.crop ? `the part [${a.crop.join(", ")}]` : "the whole frame"}${a.zoom ? ` enlarged x${a.zoom}` : ""}`);

    const which = a.state ?? "end";
    for (const c of captures) {
      const prints = (c.prints ?? []).map((p: Args) => `${p.expr} = ${p.value}`);
      const st = which === "all" ? stateLines(c.state, true) : [];
      if (prints.length || st.length) {
        lines.push(`f${c.frame}${c.label ? ` "${c.label}"` : ""}:${prints.length ? ` ${prints.join("; ")}` : ""}`);
        lines.push(...st.map((s) => `  ${s}`));
      }
    }
    if (report) {
      const prints = (report.end?.prints ?? []).map((p: Args) => `${p.expr} = ${p.value}`);
      lines.push(`at the end (f${ran}):${prints.length ? ` ${prints.join("; ")}` : ""}`);
      if (which !== "none") lines.push(...stateLines(report.end?.state, true).map((s) => `  ${s}`));
      const log: Args[] = report.log ?? [];
      if (log.length) {
        lines.push(`log (${log.length} lines from nova.log, with the frame):`);
        for (const l of log.slice(0, 80)) lines.push(`  f${l.frame} ${l.text}`);
        if (log.length > 80) lines.push(`  ... and ${log.length - 80} more`);
      } else lines.push("log: nothing (nova.log(text) writes lines here)");
      const sounds: Args[] = report.sounds ?? [];
      if (sounds.length) {
        const shownSounds = sounds.slice(0, 60).map((s) => `f${s.frame} ${s.text}`);
        lines.push(`sounds started (${sounds.length}): ${shownSounds.join(", ")}${sounds.length > 60 ? ", ..." : ""}`);
      } else lines.push("sounds started: none");
      if (wav && existsSync(wav)) {
        // beside the sound, the sounds the run started with their frames: sound_report names them at a click
        writeFileSync(wav.replace(/\.wav$/i, ".sounds.json"), `${JSON.stringify({ frames: ran, fps: 60, sounds }, null, 1)}\n`);
      }
    } else {
      lines.push(...r.out.split("\n").slice(-3));
    }
    if (wav && existsSync(wav)) {
      const said = wav.startsWith(root + sep) ? rel(wav) : wav;
      if (wav.startsWith(root + sep)) wrote.push(said);
      lines.push(`what the run sounded like: ${said} (sound_report { "file": "${said}" } describes it, and names the sounds that started at any click)`);
    } else lines.push("a headless run plays no sound (pass audio: true to get the run's sound as a file for sound_report)");
    if (outDir) {
      const pictures = wrote.filter((f) => f.endsWith(".png"));
      lines.push(`${pictures.length} full-size picture${pictures.length === 1 ? "" : "s"} in ${rel(outDir)}/: ${pictures.map((f) => f.slice(rel(outDir).length + 1)).join(", ")}${tiles.length > 1 ? "; the film strip is strip.png" : ""}; the whole report is report.json`);
    } else if (images.length) lines.push(`saved at ${images[0]}`);
    return { text: lines.join("\n"), images, wrote };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
