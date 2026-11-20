// The play tool: one headless run of the game along a route, returned as a film strip and a report in words.
// It writes a play plan (crates/nova-runtime/src/playtest.rs) and reads back the pictures and report.json the run made.

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Raster } from "../src/lib/pixels";
import { contactSheet, cropZoom, readPng } from "./draw";

type Args = Record<string, any>;
type Run = (args: string[], timeout?: number) => { code: number; out: string };

export const ROUTE_HELP =
  'A route is a list of steps played in order, using the game\'s input action names: { "hold": ["right"], "frames": 40 } holds for 40 frames (60 = one second; "move_x=-1" sets an axis, "key:Enter" holds a key); ' +
  '{ "press": "a" } taps (three frames); { "wait": 20 } lets time pass; { "hold": ["right"], "until": "nova.named(\'hero\').x > 300", "max": 300 } holds until a Lua expression is true (at most `max` frames, 600 by default; a warning says when it never was); ' +
  '{ "lua": "nova.named(\'hero\').hp = 1" } runs Lua at that moment; any step may add "capture": "a caption" to take a picture when it ends.';

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

function stateLines(state: Args | undefined, all: boolean): string[] {
  if (!state || !Array.isArray(state.entities)) return [];
  const out: string[] = [];
  const cam = Array.isArray(state.camera) ? `, camera at ${round(state.camera[0])}, ${round(state.camera[1])}` : "";
  if (state.scene === undefined && !state.entities.length) return ["(no scene: this game draws by itself, without nova.start, so there are no entities to list)"];
  out.push(`scene ${state.scene ?? "(none)"}${cam}, ${state.count ?? state.entities.length} entities alive`);
  const show = (e: Args) => `${e.name ? `${e.name}:` : ""}${e.kind} at ${round(e.x)}, ${round(e.y)}${e.z !== undefined ? `, z ${round(e.z)}` : ""}${e.anim ? ` anim ${e.anim}` : ""}${e.frame !== undefined ? ` frame ${e.frame}` : ""}${e.hidden ? " (hidden)" : ""}`;
  const list: Args[] = state.entities;
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
    for (const [kind, es] of kinds) out.push(`  ${kind} x${es.length}: ${es.slice(0, 6).map((e) => `${round(e.x)}, ${round(e.y)}`).join(" | ")}${es.length > 6 ? " ..." : ""}`);
  }
  return out;
}

/// Runs the game headless as the arguments say and returns the words and the picture file.
export function playGame(root: string, a: Args, run: Run, keep: (label: string, picture: Raster) => string): { text: string; images: string[] } {
  const [w, h] = sizeOf(a);
  if (!(w >= 64 && h >= 64 && w <= 3840 && h <= 2160)) throw new Error(`the picture size must be from 64x64 to 3840x2160 (got ${w}x${h})`);
  const dir = mkdtempSync(join(tmpdir(), "nova-play-"));
  try {
    const route: Args[] = a.route ?? a.steps ?? [];
    if (!Array.isArray(route)) throw new Error(`route must be a list of steps. ${ROUTE_HELP}`);
    route.forEach((s, i) => {
      if (!s || typeof s !== "object" || Array.isArray(s)) throw new Error(`route step ${i + 1} is ${JSON.stringify(s)}, not an object. ${ROUTE_HELP}`);
      const unknown = Object.keys(s).filter((k) => !["hold", "press", "frames", "wait", "until", "max", "capture", "lua"].includes(k));
      if (unknown.length) throw new Error(`route step ${i + 1} has "${unknown.join('", "')}", which a step does not have. ${ROUTE_HELP}`);
    });
    const scripted = true; // (a plain picture goes through a plan too, for the log and the list of entities)
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
    const wav = a.audio ? join(tmpdir(), `nova-run-${Date.now()}.wav`) : null;
    const cli = ["run", root, "--headless", "--size", `${w}x${h}`, "--capture", last];
    if (scripted) {
      writeFileSync(join(dir, "plan.json"), JSON.stringify(plan));
      cli.push("--play", join(dir, "plan.json"));
    } else {
      cli.push("--frames", String(frames));
      if (a.seed !== undefined) cli.push("--seed", String(a.seed));
    }
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
    const problem = report?.error ?? (r.code !== 0 ? r.out.split("\n").filter((l) => /error|nova:/i.test(l)).slice(0, 4).join("\n") : null);
    if (problem) lines.push(`ERROR: ${problem}`);
    for (const wn of report?.warnings ?? []) lines.push(`warning: ${wn}`);

    // the pictures: every capture, then the last frame unless a capture already shows it
    const crop = (p: Raster) => (a.crop || a.zoom ? cropZoom(p, a.crop, a.zoom ?? 1) : p);
    let tiles: { picture: Raster; caption: string }[] = [];
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
    }
    if (existsSync(last) && !captures.some((c) => c.frame === ran)) tiles.push({ picture: crop(readPng(last)), caption: captures.length ? `f${ran} end` : `f${ran}` });
    const max = 24;
    if (tiles.length > max) {
      const stride = Math.ceil(tiles.length / max);
      lines.push(`${tiles.length} pictures were taken; every ${stride}${stride === 2 ? "nd" : stride === 3 ? "rd" : "th"} is shown (ask for fewer with capture_at or a bigger every)`);
      tiles = tiles.filter((_, i) => i % stride === 0 || i === tiles.length - 1);
    }
    const images: string[] = [];
    if (tiles.length === 1) images.push(keep("shot", tiles[0]!.picture));
    else if (tiles.length > 1) {
      images.push(keep("strip", contactSheet(tiles, { columns: a.columns })));
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
        const shown = sounds.slice(0, 60).map((s) => `f${s.frame} ${s.text}`);
        lines.push(`sounds started (${sounds.length}): ${shown.join(", ")}${sounds.length > 60 ? ", ..." : ""}`);
      } else lines.push("sounds started: none");
    } else {
      lines.push(...r.out.split("\n").slice(-3));
    }
    if (wav && existsSync(wav)) lines.push(`what the run sounded like: ${wav} (sound_report { "file": "${wav}" } describes it)`);
    else lines.push("a headless run plays no sound (pass audio: true to get the run's sound as a file for sound_report)");
    if (images.length) lines.push(`saved at ${images[0]}`);
    return { text: lines.join("\n"), images };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
