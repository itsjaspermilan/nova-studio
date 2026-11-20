// The play tool: one headless run of the game along a route, returned as a film strip and a report in words.
// It writes a play plan (crates/nova-runtime/src/playtest.rs) and reads back the pictures and report.json the run made.

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { Raster } from "../src/lib/pixels";
import { contactSheet, cropZoom, pngOf, readPng } from "./draw";
import { unknownKeys } from "./keys";

type Args = Record<string, any>;
type Run = (args: string[], timeout?: number) => { code: number; out: string };

export const ROUTE_HELP =
  'A route is a list of steps played in order, using the game\'s input action names: { "hold": ["right"], "frames": 40 } holds for 40 frames (60 = one second; "move_x=-1" sets an axis, "key:Enter" holds a key); ' +
  '{ "press": "a" } taps (three frames); { "wait": 20 } lets time pass; { "hold": ["right"], "until": "nova.named(\'hero\').x > 300", "max": 300 } holds until a Lua expression is true (at most `max` frames, 600 by default; a warning says when it never was, unless the step has "may_time_out": true); ' +
  '{ "lua": "nova.named(\'hero\').hp = 1" } runs Lua at that moment (if it fails, the answer says so with the step\'s number and the run goes on); any step may add "capture": "a caption" to take a picture when it ends (a step that ends because something came true, an `until`, a `walk_to`, a `fight`, is pictured one frame later, when the game has drawn what changed). ' +
  "Holding a direction button also sets the axis that shares its keys, and the other way round (`up` and `move_y` = -1), as a keyboard or a stick does, so a hold moves the hero whichever of the two the code reads; a hold that nothing in the game read is reported. " +
  'Walking and acting at once: { "hold": ["right"], "tap": "a", "tap_every": 30, "until": "..." } taps `a` every 30 frames for as long as the step lasts. ' +
  'Repeating: { "repeat": 5, "steps": [ {...}, {...} ] } plays a group of steps five times; with "until" the group stops as soon as the expression is true, in the middle of a step too (up to 100 rounds when `repeat` is left out); "repeat" on a plain step plays that step again. Steps in a group are reported as "step 3.2 (round 4 of 5)". ' +
  'Walking to a place: { "walk_to": [x, y], "who": "hero" } steers an entity to a point and ends when it is within `radius` (12 units; in a 3D game the point is [x, z] on the ground and the radius 0.5). It finds a way round what is solid: in 2D the solid tiles of the scene and the entities tagged "solid" ("avoid": ["solid", "water"] names other tags), tried with the walker\'s own hitbox; in 3D what nova.solid, nova.walls and nova.scenery hold, tried on a grid of half metres. When nothing solid is known it walks straight ("straight": true asks for that), and the answer says which it did. ' +
  'Walking to a thing: { "walk_to": "chest" } (a scene object\'s name, a tag or a kind: the nearest one) walks into it: until the two hitboxes overlap (which is when on_collide_<tag> runs: a door, a pickup; a thing that is gone afterwards was reached) or, for a solid thing, until the walker stands against it and can get no nearer, and says how far apart the hitboxes ended: use it before a press that needs the hero next to something ("reach": 8 ends it that many units apart instead; in 3D it is 0.3). ' +
  '`who` is a scene object\'s name or a tag (left out: the one named or tagged hero or player, or what the 2D camera follows). ' +
  'Fighting: { "fight": "enemy", "attack": "a", "max": 600 } goes to the nearest entity with that tag, taps `attack` (every `attack_every` frames, 20) while its hitbox is within `range` (the walker\'s own size; 1.5 in 3D), then the next, until none is left or `max` frames have passed; the answer says how many were beaten, with how many attacks, and what it cost the hero. ' +
  "walk_to and fight drive the axes move_x, move_y and the buttons left, right, up, down together (\"axes\": [x, y] and \"dirs\": [left, right, up, down] name other actions) and measure each frame which way the walker really went, so they also work when the stick is relative to a turned camera. A walk gives up with a warning that says where the walker is when it stops getting nearer for two seconds, or after `max` frames (600). \"plane\": \"xy\" or \"xz\" says which fields the point is in when the guess (xz for an entity with a model) is wrong. " +
  "`crop`, `crop_to`, `view`, `zoom`, `every`, `capture_at`, `print`, `invincible`, `stop_on_fail` and `overlay` are options of the whole call, not of a step.";

export const STEP_KEYS = ["hold", "press", "tap", "tap_every", "frames", "wait", "until", "max", "may_time_out", "quiet", "capture", "lua", "repeat", "steps", "walk_to", "who", "radius", "reach", "straight", "avoid", "plane", "axes", "dirs", "fight", "attack", "attack_every", "range"];
const CALL_KEYS = ["crop", "crop_to", "crop_margin", "view", "zoom", "every", "capture_at", "print", "seed", "size", "state", "invincible", "god", "stop_on_fail", "overlay", "compare", "out", "audio", "start_scene"];

function checkSteps(steps: unknown, where: string) {
  if (!Array.isArray(steps)) throw new Error(`${where || "route"} must be a list of steps. ${ROUTE_HELP}`);
  steps.forEach((s, i) => {
    const label = `route step ${where}${i + 1}`;
    if (!s || typeof s !== "object" || Array.isArray(s)) throw new Error(`${label} is ${JSON.stringify(s)}, not an object. ${ROUTE_HELP}`);
    const moved = Object.fromEntries(CALL_KEYS.map((k) => [k, `\`${k}\` beside "route" (it is an option of the whole play call, not of a step)`]));
    const unknown = unknownKeys(s, STEP_KEYS, "a route step", { ...moved, to: "walk_to", goto: "walk_to", target: "walk_to", button: "attack", time: "frames", duration: "frames", timeout: "max", must: "`stop_on_fail` beside \"route\" (an option of the whole play call)", until_blocked: "`walk_to` with the thing's name (it walks until it touches it)" });
    if (unknown.length) throw new Error(`${label}: ${unknown.join("; ")}. ${ROUTE_HELP}`);
    const point = Array.isArray(s.walk_to) && s.walk_to.length === 2 && s.walk_to.every((v: unknown) => typeof v === "number");
    if (s.walk_to !== undefined && !point && !(typeof s.walk_to === "string" && s.walk_to)) {
      throw new Error(`${label}: walk_to is a point, [x, y] in a 2D game or [x, z] on the ground of a 3D one, or the name or tag of an entity to walk up to ("chest") (got ${JSON.stringify(s.walk_to)})`);
    }
    if (s.fight !== undefined && !(typeof s.fight === "string" && s.fight)) throw new Error(`${label}: fight is the tag of the entities to fight, like "enemy" (got ${JSON.stringify(s.fight)})`);
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

/// What the renderer was given for a 3D frame, in words: whether shadows are on and how many models cast them, where the
/// sun points, the fog, and where the camera is. Nothing for a flat game.
export function renderLine(r: Args | undefined): string | null {
  if (!r || !r.three_d) return null;
  const v = (a: number[]) => a.map((n) => round2(n)).join(", ");
  const d: number[] = r.light?.direction ?? [0, -1, 0];
  const eye: number[] = r.camera?.eye ?? [0, 0, 0], target: number[] = r.camera?.target ?? [0, 0, 0];
  // the sun's light travels along `d`; a shadow falls on the far side of its caster as the camera sees it when the light
  // travels away from the camera
  const view = [target[0]! - eye[0]!, target[2]! - eye[2]!];
  const along = view[0]! * d[0]! + view[1]! * d[2]!;
  const flat = Math.hypot(view[0]!, view[1]!) * Math.hypot(d[0]!, d[2]!);
  const side = flat < 1e-6 ? "" : along / flat > 0.5 ? " (the sun is behind the camera, so shadows fall away from it, behind the things that cast them: hard to see)" : along / flat < -0.5 ? " (the sun is in front of the camera: shadows fall towards it)" : " (the sun is to the side: shadows fall across the picture)";
  const shadows = r.shadows ? `shadows ON (strength ${r.shadows.strength}, radius ${r.shadows.radius} m round the camera's target, ${r.shadows.casters} of ${r.models} models drawn cast one)${side}` : "shadows OFF (nova.shadows{ radius = 30, strength = 0.8 } turns them on)";
  const ambient: number[] = r.light?.ambient ?? [];
  const bright = ambient.length ? Math.round((ambient.reduce((s, n) => s + n, 0) / ambient.length) * 255) : 0;
  return `render: ${shadows}; sun travels along ${v(d)}, ambient about ${bright} of 255${r.shadows && bright > 110 && r.shadows.strength < 0.8 ? " (a bright ambient with a low strength makes faint shadows)" : ""}; fog ${r.fog ? `${r.fog.near} to ${r.fog.far} m` : "off"}; camera eye ${v(eye)} looking at ${v(target)}, fov ${r.camera?.fov}`;
}

/// A place in the project a run may write to: a folder (or file) that is not part of the game, so its pictures do not
/// become sprites: under build/, a dot-folder, or something nova.json's "ignore" lists.
export function ignoredPlace(root: string, given: unknown, what: string): string {
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

/// How much of a picture differs from another of the same size: the share of pixels, how different they are, and where.
export function pictureDifference(a: Raster, b: Raster): { share: number; mean: number; box: [number, number, number, number] | null } {
  if (a.w !== b.w || a.h !== b.h) return { share: 1, mean: 255, box: [0, 0, a.w - 1, a.h - 1] };
  let changed = 0, sum = 0, x0 = a.w, y0 = a.h, x1 = -1, y1 = -1;
  for (let y = 0; y < a.h; y++) {
    for (let x = 0; x < a.w; x++) {
      const i = (y * a.w + x) * 4;
      const d = Math.max(Math.abs(a.data[i]! - b.data[i]!), Math.abs(a.data[i + 1]! - b.data[i + 1]!), Math.abs(a.data[i + 2]! - b.data[i + 2]!));
      if (d > 6) {
        changed++;
        sum += d;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return { share: changed / (a.w * a.h), mean: changed ? sum / changed : 0, box: changed ? [x0, y0, x1, y1] : null };
}

interface Ran {
  r: { code: number; out: string };
  report: Args | null;
  captures: Args[];
  last: string;
  ran: number;
}

/// Runs the game headless as the arguments say and returns the words and the picture file.
export function playGame(root: string, a: Args, run: Run, keep: (label: string, picture: Raster) => string): { text: string; images: string[]; wrote?: string[] } {
  const [w, h] = sizeOf(a);
  if (!(w >= 64 && h >= 64 && w <= 3840 && h <= 2160)) throw new Error(`the picture size must be from 64x64 to 3840x2160 (got ${w}x${h})`);
  const outDir = a.out !== undefined && a.out !== null && a.out !== "" ? ignoredPlace(root, a.out, "out") : null;
  const audioFile = typeof a.audio === "string" && a.audio ? ignoredPlace(root, a.audio, "audio") : null;
  if (audioFile && !/\.wav$/i.test(audioFile)) throw new Error(`audio "${a.audio}" must end in .wav (or pass audio: true with \`out\`, which writes <out>/run.wav)`);
  const overlay: string[] = a.overlay === true ? ["hitboxes", "solids", "names"] : typeof a.overlay === "string" ? [a.overlay] : Array.isArray(a.overlay) ? a.overlay.map(String) : [];
  for (const o of overlay) if (!["hitboxes", "solids", "names"].includes(o)) throw new Error(`overlay has "${o}"; it is a list of "hitboxes", "solids" and "names" (or true for all three)`);
  const compare: { lua: string; each_frame: boolean; label: string } | null =
    typeof a.compare === "string" && a.compare ? { lua: a.compare, each_frame: false, label: a.compare }
    : a.compare && typeof a.compare === "object" && typeof a.compare.lua === "string" ? { lua: a.compare.lua, each_frame: !!(a.compare.each_frame ?? a.compare.every_frame), label: String(a.compare.label ?? a.compare.lua) }
    : null;
  if (a.compare !== undefined && a.compare !== null && !compare) throw new Error('compare is the Lua that makes the second run different: "nova.shadows(nil)", or { "lua": "nova.shadows(nil)", "each_frame": true, "label": "no shadows" } when the scene\'s own code would set it back every frame');
  if (compare && typeof a.compare === "object") {
    const unknown = unknownKeys(a.compare, ["lua", "each_frame", "every_frame", "label"], "compare");
    if (unknown.length) throw new Error(unknown.join("; "));
  }
  const VIEW_HELP = 'view is { "follow": "hero", "from": "side", "distance": 4 }: the pictures of a 3D game from beside an entity (a name, tag or kind); from "side" (+x), "left" (-x), "front" (+z), "back" (-z), "top" or "quarter"; distance in metres (4); height above its middle (0.3)';
  if (a.view !== undefined && a.view !== null) {
    if (typeof a.view !== "object" || Array.isArray(a.view) || typeof a.view.follow !== "string" || !a.view.follow) throw new Error(`${VIEW_HELP} (got ${JSON.stringify(a.view)})`);
    const unknown = unknownKeys(a.view, ["follow", "from", "distance", "height"], "view");
    if (unknown.length) throw new Error(`${unknown.join("; ")}. ${VIEW_HELP}`);
  }
  if (a.crop_to !== undefined && !(typeof a.crop_to === "string" && a.crop_to)) throw new Error(`crop_to is the name, tag or kind of the entity to crop every picture to, like "hero" (got ${JSON.stringify(a.crop_to)})`);
  if (a.crop_to && a.crop) throw new Error("crop and crop_to both say what part of the pictures to keep: give one of them");
  if (a.crop_margin !== undefined && !(typeof a.crop_margin === "number" && a.crop_margin >= 0)) throw new Error("crop_margin is the room round the crop_to entity, in picture pixels (0 or more)");
  const dir = mkdtempSync(join(tmpdir(), "nova-play-"));
  try {
    const route: Args[] = a.route ?? a.steps ?? [];
    checkSteps(route, "");
    const frames = a.frames ?? (route.length ? undefined : 90);
    const wav = audioFile ?? (a.audio ? (outDir ? join(outDir, "run.wav") : join(tmpdir(), `nova-run-${Date.now()}.wav`)) : null);
    if (wav) mkdirSync(dirname(wav), { recursive: true });
    const once = (name: string, extra: Args, sound: string | null): Ran => {
      const plan = {
        out: join(dir, name),
        steps: route,
        capture_at: a.capture_at ?? [],
        every: a.every ?? 0,
        print: a.print ?? [],
        ...(frames !== undefined ? { frames } : {}),
        ...(a.start_scene ? { start_scene: String(a.start_scene) } : {}),
        ...(a.lua ? { lua: String(a.lua) } : {}),
        ...(a.seed !== undefined ? { seed: Number(a.seed) } : {}),
        ...(a.invincible || a.god ? { invincible: true } : {}),
        ...(a.who ? { who: String(a.who) } : {}),
        ...(a.stop_on_fail ? { stop_on_fail: true } : {}),
        ...(overlay.length ? { overlay } : {}),
        ...(a.view ? { view: a.view } : {}),
        ...(a.crop_to ? { crop_to: String(a.crop_to) } : {}),
        ...extra,
      };
      const last = join(dir, `${name}-last.png`);
      const cli = ["run", root, "--headless", "--size", `${w}x${h}`, "--capture", last];
      writeFileSync(join(dir, `${name}.json`), JSON.stringify(plan));
      cli.push("--play", join(dir, `${name}.json`));
      if (a.press?.length) cli.push("--press", a.press.join(","));
      if (a.hold?.length) cli.push("--hold", a.hold.join(","));
      if (sound) cli.push("--audio-out", sound);
      const r = run(cli, 300_000);
      const reportFile = join(dir, name, "report.json");
      const report: Args | null = existsSync(reportFile) ? JSON.parse(readFileSync(reportFile, "utf8")) : null;
      const captures: Args[] = report?.captures ?? [];
      if (!existsSync(last) && !captures.length) throw new Error(`no picture was made:\n${r.out}`);
      return { r, report, captures, last, ran: report?.frames ?? frames };
    };
    const { r, report, captures, last, ran } = once("out", {}, wav);

    const lines: string[] = [];
    lines.push(`ran ${ran} frames (${(ran / 60).toFixed(1)} s of game time) at ${w}x${h}${a.seed !== undefined ? `, seed ${a.seed}` : ""}`);
    const stepErrors: string[] = report?.step_errors ?? [];
    const problem = report?.error ?? (r.code !== 0 && !stepErrors.length ? r.out.split("\n").filter((l) => /error|nova:/i.test(l)).slice(0, 4).join("\n") : null);
    if (problem) lines.push(`ERROR: ${problem}`);
    if (report?.stopped) lines.push(`STOPPED: ${report.stopped}`);
    for (const e of stepErrors) lines.push(`ERROR in ${e}${report?.stopped ? "" : " (the run went on: the pictures and values after it are of a run in which this did not happen)"}`);
    for (const wn of report?.warnings ?? []) lines.push(`warning: ${wn}`);
    for (const s of report?.route ?? []) lines.push(`route: ${s}`);
    for (const n of report?.notes ?? []) lines.push(`note: ${n}`);
    const render = renderLine(report?.end?.render);
    if (render) lines.push(render);

    // the pictures: every capture, then the last frame unless a capture already shows it
    // `crop_to`: one size of crop for the whole run (the biggest box the entity had, with the margin round it), moved to
    // where the entity is in each picture, so the strip's tiles line up
    const boxes = (run: Ran): (number[] | null)[] => [...run.captures.map((c) => c.box ?? null), run.report?.end_box ?? null];
    let cropSize: [number, number] | null = null;
    let margin = 0;
    if (a.crop_to) {
      const found = boxes({ r, report, captures, last, ran }).filter((b): b is number[] => Array.isArray(b));
      if (found.length) {
        const bw = Math.max(...found.map((b) => b[2]! - b[0]!)), bh = Math.max(...found.map((b) => b[3]! - b[1]!));
        margin = a.crop_margin ?? Math.max(24, Math.round(Math.max(bw, bh) * 0.5));
        cropSize = [Math.min(w, Math.ceil(bw + 2 * margin)), Math.min(h, Math.ceil(bh + 2 * margin))];
      } else lines.push(`warning: crop_to '${a.crop_to}' was on none of the pictures, so they are not cropped`);
    }
    const cropFor = (box: number[] | null | undefined): number[] | undefined => {
      if (a.crop) return a.crop;
      if (!cropSize) return undefined;
      const [cw, ch] = cropSize;
      const cx = box ? (box[0]! + box[2]!) / 2 : w / 2, cy = box ? (box[1]! + box[3]!) / 2 : h / 2;
      return [Math.round(Math.max(0, Math.min(w - cw, cx - cw / 2))), Math.round(Math.max(0, Math.min(h - ch, cy - ch / 2))), cw, ch];
    };
    const crop = (p: Raster, box?: number[] | null) => (a.crop || a.zoom || cropSize ? cropZoom(p, cropFor(box), a.zoom ?? 1) : p);
    const gather = (run: Ran) => {
      const tiles: { picture: Raster; caption: string; frame: number }[] = [];
      const singles: { file: string; frame: number; label: string }[] = [];
      let shown = -1;
      for (const c of run.captures) {
        if (!existsSync(c.file)) continue;
        if (c.frame === shown) {
          // two reasons for a picture of the same frame: one tile, both captions
          if (c.label) tiles[tiles.length - 1]!.caption += ` ${c.label}`;
          continue;
        }
        shown = c.frame;
        tiles.push({ picture: crop(readPng(c.file), c.box), caption: `f${c.frame}${c.label ? ` ${c.label}` : ""}`, frame: c.frame });
        singles.push({ file: c.file, frame: c.frame, label: c.label ?? "" });
      }
      if (existsSync(run.last) && !run.captures.some((c) => c.frame === run.ran)) {
        tiles.push({ picture: crop(readPng(run.last), run.report?.end_box), caption: run.captures.length ? `f${run.ran} end` : `f${run.ran}`, frame: run.ran });
        singles.push({ file: run.last, frame: run.ran, label: run.captures.length ? "end" : "" });
      }
      return { tiles, singles };
    };
    let { tiles, singles } = gather({ r, report, captures, last, ran });
    const wrote: string[] = [];
    const rel = (full: string) => relative(root, full).split(sep).join("/");
    const fileName = (s: { frame: number; label: string }) => `f${String(s.frame).padStart(5, "0")}${s.label && slug(s.label) ? `-${slug(s.label)}` : ""}.png`;
    if (outDir) {
      // every picture of the run as its own full-size file, where the caller said
      mkdirSync(outDir, { recursive: true });
      // (this run only: an earlier run's pictures in the same folder, with other frame numbers, would read as this one's)
      for (const old of readdirSync(outDir)) if (/^(f\d{5}[^/]*|strip(-\d+|-compare)?)\.png$/.test(old)) rmSync(join(outDir, old));
      for (const s of singles) {
        copyFileSync(s.file, join(outDir, fileName(s)));
        wrote.push(rel(join(outDir, fileName(s))));
      }
      if (report) {
        // (the report's pictures are named as the files written here, not as the run's temporary ones)
        const fileOf = new Map(singles.map((s, i) => [s.frame, wrote[i]]));
        const kept = { ...report, captures: captures.map((c) => ({ ...c, file: fileOf.get(c.frame) })) };
        writeFileSync(join(outDir, "report.json"), `${JSON.stringify(kept, null, 2)}\n`);
      }
    }
    // Never dropped in silence: a run with more pictures than one strip holds gets several strips (pages), every picture in
    // one of them; only past PAGES strips are pictures left out, and then the first line of the answer says so.
    const PER = 24, PAGES = 4;
    const all = tiles;
    const images: string[] = [];
    let leftOut = "";
    if (tiles.length > PER * PAGES) {
      const stride = Math.ceil(tiles.length / (PER * PAGES));
      let where = outDir ? `${rel(outDir)}/` : "";
      if (!outDir) {
        const keepDir = join(tmpdir(), `nova-run-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
        mkdirSync(keepDir, { recursive: true });
        for (const s of singles) copyFileSync(s.file, join(keepDir, fileName(s)));
        where = `${keepDir}/`;
      }
      tiles = tiles.filter((_, i) => i % stride === 0 || i === tiles.length - 1);
      leftOut = (`WARNING: PICTURES LEFT OUT: the film strips show ${tiles.length} of the ${all.length} pictures taken (every ${stride}${stride === 2 ? "nd" : stride === 3 ? "rd" : "th"}, and the last), because ${PER * PAGES} is the most that are shown; all ${all.length} are in ${where} as full-size files named by frame. Take fewer (\`capture_at\`, a bigger \`every\`) or play the run in parts`);
    }
    if (tiles.length === 1) images.push(keep("shot", tiles[0]!.picture));
    else if (tiles.length > 1) {
      const pages: (typeof tiles)[] = [];
      for (let i = 0; i < tiles.length; i += PER) pages.push(tiles.slice(i, i + PER));
      pages.forEach((page, i) => {
        const strip = page.length === 1 ? page[0]!.picture : contactSheet(page, { columns: a.columns });
        images.push(keep(i ? `strip-${i + 1}` : "strip", strip));
        if (outDir) {
          const name = i ? `strip-${i + 1}.png` : "strip.png";
          writeFileSync(join(outDir, name), pngOf(strip));
          if (i) wrote.push(rel(join(outDir, name)));
        }
      });
      if (pages.length > 1) {
        lines.unshift(`${tiles.length} pictures in ${pages.length} film strips of up to ${PER} (${pages.map((p) => `${p[0]!.caption.split(" ")[0]} to ${p[p.length - 1]!.caption.split(" ")[0]}`).join("; ")}): ${pages.length} pictures come back, in order${outDir ? `, saved as strip.png, ${pages.slice(1).map((_, i) => `strip-${i + 2}.png`).join(", ")}` : ""}.${leftOut ? "" : " None is left out"}`);
        lines.push(`the pictures are ${pages.length} film strips of ${tiles.length} moments in all, left to right, top to bottom, the frame number under each`);
      } else lines.push(`the picture is a film strip of ${tiles.length} moments, left to right, top to bottom, the frame number under each`);
    }
    if (leftOut) lines.unshift(leftOut);
    if (cropSize) {
      const where = captures.filter((c) => c.box).map((c) => `f${c.frame} [${cropFor(c.box)!.join(", ")}]`);
      lines.push(`each picture is the part round '${a.crop_to}' (${cropSize[0]}x${cropSize[1]} pixels, ${margin} round the largest box it had${a.zoom ? `, enlarged x${a.zoom}` : ""}), moved with it: ${where.slice(0, 12).join(", ")}${where.length > 12 ? ", ..." : ""}`);
      const missing = captures.filter((c) => !c.box).map((c) => `f${c.frame}`);
      if (missing.length) lines.push(`warning: '${a.crop_to}' is not on the picture${missing.length > 1 ? "s" : ""} ${missing.join(", ")}: ${missing.length > 1 ? "they show" : "it shows"} the middle`);
    } else if (a.crop || a.zoom) lines.push(`each picture is ${a.crop ? `the part [${a.crop.join(", ")}]` : "the whole frame"}${a.zoom ? ` enlarged x${a.zoom}` : ""}`);
    const views = captures.filter((c) => c.view);
    if (a.view && views.length) {
      const v = views[0]!.view;
      lines.push(`the pictures are from beside '${a.view.follow}' (from ${a.view.from ?? "side"}, ${a.view.distance ?? 4} m away), not from the game's camera; the first from ${v.eye.join(", ")} looking at ${v.target.join(", ")}`);
    }

    if (compare) {
      // the same run again with one difference, and how much of each picture it changed
      const second = once("other", compare.each_frame ? { lua_each_frame: compare.lua } : { lua: `${a.lua ? `${a.lua}\n` : ""}${compare.lua}` }, null);
      const other = gather(second);
      lines.push(`compare: the run again with \`${compare.label}\` (${compare.each_frame ? "run before every frame" : "run once, when the scene is up"}); the second picture is that run's strip. Pixels that differ (a channel by more than 6 of 255):`);
      const byFrame = new Map(other.tiles.map((t) => [t.frame, t]));
      let most = 0;
      for (const t of all) {
        const o = byFrame.get(t.frame);
        if (!o) {
          lines.push(`  ${t.caption}: no picture of this frame in the second run (it ran ${second.ran} frames)`);
          continue;
        }
        const d = pictureDifference(t.picture, o.picture);
        most = Math.max(most, d.share);
        lines.push(`  ${t.caption}: ${(d.share * 100).toFixed(d.share < 0.01 ? 2 : 1)} % of pixels differ${d.box ? `, by ${Math.round(d.mean)} of 255 on average, within x ${d.box[0]}..${d.box[2]}, y ${d.box[1]}..${d.box[3]}` : ""}`);
      }
      if (most === 0) lines.push(`  nothing changed in any picture: \`${compare.label}\` has no visible effect here${compare.each_frame ? "" : ' (if the scene\'s own code sets it again every frame, use { "lua": ..., "each_frame": true })'}`);
      const secondErrors: string[] = [...(second.report?.step_errors ?? []), ...(second.report?.error ? [second.report.error] : [])];
      for (const e of secondErrors.filter((e) => !stepErrors.includes(e))) lines.push(`  ERROR in the second run: ${e}`);
      const renderB = renderLine(second.report?.end?.render);
      if (renderB && renderB !== render) lines.push(`  second run, ${renderB}`);
      let shownB = other.tiles;
      if (shownB.length > PER) {
        const stride = Math.ceil(shownB.length / PER);
        shownB = shownB.filter((_, i) => i % stride === 0 || i === shownB.length - 1);
      }
      if (shownB.length) {
        const strip = shownB.length === 1 ? shownB[0]!.picture : contactSheet(shownB, { columns: a.columns });
        images.push(keep("strip-compare", strip));
        if (outDir) {
          writeFileSync(join(outDir, "strip-compare.png"), pngOf(strip));
          wrote.push(rel(join(outDir, "strip-compare.png")));
        }
      }
    }

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
      const pictures = wrote.filter((f) => f.endsWith(".png") && !f.endsWith("strip-compare.png"));
      lines.push(`${pictures.length} full-size picture${pictures.length === 1 ? "" : "s"} in ${rel(outDir)}/: ${pictures.map((f) => f.slice(rel(outDir).length + 1)).join(", ")}${tiles.length > 1 ? "; the film strip is strip.png" : ""}${compare ? "; the second run's is strip-compare.png" : ""}; the whole report is report.json`);
    } else if (images.length) lines.push(`saved at ${images.join(" and ")}`);
    return { text: lines.join("\n"), images, wrote };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
