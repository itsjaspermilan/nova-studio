// The Nova MCP server: lets an AI assistant (or a script) make a Nova project the way the studio does, through the same
// code the studio's editors use. It makes the plain files a person would: models (`.model.json` + `.glb`), sound effects
// (`.sfx.json` + `.wav`), songs (`.song.json` + `.ogg`), pixel sprites (`.sprite.json` + `.png`), scene layouts
// (`.scene.json`), and text files such as Lua. It can also check a project, run it headless and hand back a screenshot.
//
// It speaks MCP (JSON-RPC, one message per line) over stdin and stdout and has no dependencies. Build and run:
//   scripts/nova-mcp.sh            (bundles this file to build/nova-mcp.mjs, then serves)
// Every file operation stays inside the project folder.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { exportGlb } from "../src/lib/glb";
import { bakeAll, fitPicture } from "../src/lib/model-uv";
import { countCubes, cubeAt, parseModel, serializeModel, setCube, walk } from "../src/lib/model-doc";
import { autoWeights } from "../src/lib/model-skin";
import { meshOf } from "../src/lib/model-mesh";
import { evaluate } from "../src/lib/modifiers";
import { encodePng } from "../src/lib/png-encode";
import { type Raster } from "../src/lib/pixels";
import { searchApi } from "./api";
import { pngOf } from "./draw";
import { previewModel } from "./models";
import { playGame, ROUTE_HELP } from "./play";
import { previewSprite, writeSprite } from "./sprites";
import { PRESETS, DEFAULTS, RANGES, WAVES, cleanArpNotes, fromJson as sfxFromJson, render, toJson, type SfxParams } from "../src/lib/sfx";
import { decodeWav, encodeWav, type Sound } from "../src/lib/wav";
import { drumTrack, parseSong, renderSong, serializeSong, songSeconds, synthTrack } from "../src/lib/song";
import { analyse, describe, mixTable, spectrogram, stack } from "./sound";
import { parseScene, serializeScene, tilemaps } from "../src/lib/scene-model";
import { drawScene, expandTileLayers, previewScene } from "./scenes";
// @ts-ignore (plain JavaScript, shared with Pine Ridge Rally's track script)
import { heightmapFromTrack } from "../../scripts/lib/heightmap.mjs";
import { ascii as trackMap } from "../../scripts/lib/trackgen.mjs";
import { analyse as analyseTrack, buildTrack, newTrack, parseTrack, roadOf, sceneOf, serializeTrack, trackOf } from "../src/lib/track-doc";

// ---- where things are ----------------------------------------------------------------------------------------------
const here = dirname(fileURLToPath(import.meta.url));
const repo = process.env.NOVA_REPO ?? resolve(here, here.endsWith("mcp") ? "../.." : "..");
const novaBin = process.env.NOVA_BIN ?? join(repo, "target/release/nova");
const oggBin = process.env.NOVA_OGG_BIN ?? join(repo, "target/release/nova-ogg");

type Args = Record<string, any>;
type Result = string | { text: string; images?: string[] };

function projectRoot(args: Args): string {
  const root = String(args.project ?? process.env.NOVA_PROJECT ?? "");
  if (!root) throw new Error("say which project: pass `project` (a folder path) or start the server with NOVA_PROJECT set");
  return resolve(root);
}

/// A path inside the project, or an error.
function inside(root: string, rel: string): string {
  const full = resolve(root, rel);
  if (full !== root && !full.startsWith(root + sep)) throw new Error(`'${rel}' is outside the project folder`);
  return full;
}

/// The files the tool call in progress has written (for the activity log).
let written: string[] = [];

function put(root: string, rel: string, data: string | Uint8Array): string {
  const full = inside(root, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, data);
  if (!written.includes(rel)) written.push(rel);
  return rel;
}

const ACTIVITY = ".nova/activity.jsonl";
const ACTIVITY_KEEP = 200;

/// One line per tool call in `<project>/.nova/activity.jsonl`: when, which tool, the files it wrote and the first line of what it said.
/// The studio's Activity panel shows it, so a person can watch an assistant work. It keeps the newest 200 calls.
function logActivity(args: Args, tool: string, note: string, error: boolean) {
  try {
    const root = projectRoot(args);
    if (!existsSync(root)) return;
    const full = inside(root, ACTIVITY);
    mkdirSync(dirname(full), { recursive: true });
    const entry = { t: Date.now(), tool, files: written.filter((f) => f !== ACTIVITY), note: note.split("\n")[0]!.slice(0, 200), ...(error ? { error: true } : {}) };
    let lines: string[] = existsSync(full) ? readFileSync(full, "utf8").split("\n").filter(Boolean) : [];
    lines.push(JSON.stringify(entry));
    if (lines.length > ACTIVITY_KEEP * 2) lines = lines.slice(-ACTIVITY_KEEP);
    writeFileSync(full, `${lines.join("\n")}\n`);
  } catch {
    // keeping a log must never stop a tool from working
  }
}

/// Saves a picture a tool made in the temporary folder and returns where (tool results name their pictures by file).
function keepPicture(label: string, picture: Raster): string {
  const file = join(tmpdir(), `nova-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}.png`);
  writeFileSync(file, pngOf(picture));
  return file;
}

const safeName = (name: unknown, what: string): string => {
  const n = String(name ?? "").trim();
  if (!/^[A-Za-z0-9_-]+$/.test(n)) throw new Error(`${what} names use letters, numbers, - and _ (got '${n}')`);
  return n;
};

const asJson = (v: unknown): unknown => (typeof v === "string" ? JSON.parse(v) : v);

function run(bin: string, args: string[], timeout = 120_000) {
  if (!existsSync(bin)) throw new Error(`${bin} is not built yet: run \`scripts/env.sh cargo build --release -p nova-runtime\` (and \`-p nova-studio --bin nova-ogg\` for music)`);
  const r = spawnSync(bin, args, { encoding: "utf8", timeout, maxBuffer: 32 << 20 });
  return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}

// ---- the tools -----------------------------------------------------------------------------------------------------
interface Tool {
  name: string;
  description: string;
  properties: Record<string, unknown>;
  required?: string[];
  handler: (args: Args) => Result;
}
const project = { type: "string", description: "The project folder (absolute path). Defaults to the NOVA_PROJECT the server was started with." };
const tools: Tool[] = [];
const tool = (name: string, description: string, properties: Record<string, unknown>, required: string[], handler: (a: Args) => Result) =>
  tools.push({ name, description, properties: { project, ...properties }, required, handler });

tool(
  "api",
  "Look up the Lua API (nova.*) by word instead of reading the long reference: returns the signatures, option tables and descriptions of what matches, best first. `query` is one or more words, all of which must match: \"camera\", \"model clip\", \"tilemap solid\", \"sound volume\", \"walls\", \"nova.cam.follow\". With no query it lists the groups (Drawing, Scenes and entities, Entity methods, Input, Sound, 3D, Physics, ...) and the fields every entity has; `group` lists everything in one group. It reads the same file the studio's autocomplete does, which a test keeps in step with the real API. Start here; docs/agent-guide.md says how the pieces fit, docs/project-format.md is the full reference.",
  { query: { type: "string" }, group: { type: "string", description: 'Only this group, for example "Entity methods" or "Sound".' }, limit: { type: "number", description: "How many entries to show in full (12)." } },
  [],
  (a) => searchApi(String(a.query ?? ""), a.limit ?? 12, a.group ? String(a.group) : undefined),
);

tool("project_create", "Create a new Nova project folder with nova.json and an empty main.lua (nothing is overwritten).", { name: { type: "string", description: "The game's name." } }, ["name"], (a) => {
  const root = projectRoot(a);
  if (existsSync(join(root, "nova.json"))) throw new Error(`${root} already has a nova.json`);
  put(root, "nova.json", `${JSON.stringify({ format: 1, name: String(a.name) }, null, 2)}\n`);
  if (!existsSync(join(root, "main.lua"))) put(root, "main.lua", "-- Entry point: start the first scene.\nnova.start(\"title\")\n");
  return `created ${root}`;
});

tool("project_info", "List the project's files, grouped the way the studio's resource tree shows them (sprites, models, scenes, entities, sounds, music, scripts).", {}, [], (a) => {
  const root = projectRoot(a);
  const files: string[] = [];
  const visit = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".") || e.name === "build") continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) visit(full);
      else files.push(relative(root, full));
    }
  };
  visit(root);
  files.sort();
  const groups: Record<string, string[]> = {};
  for (const f of files) {
    const g = f.includes("/") ? f.slice(0, f.indexOf("/")) : "(root)";
    (groups[g] ??= []).push(g === "(root)" ? f : f.slice(g.length + 1));
  }
  const nova = existsSync(join(root, "nova.json")) ? readFileSync(join(root, "nova.json"), "utf8") : "(no nova.json)";
  return `${root}\nnova.json: ${nova.replace(/\s+/g, " ")}\n\n${Object.entries(groups).map(([g, l]) => `${g}/ (${l.length}): ${l.join(", ")}`).join("\n")}`;
});

tool("read_file", "Read a text file from the project.", { path: { type: "string" } }, ["path"], (a) => readFileSync(inside(projectRoot(a), a.path), "utf8"));

tool("write_file", "Write a text file in the project (Lua scripts, JSON, notes). Folders are created. Use the specialised tools for models, sounds, music, sprites and scenes.", { path: { type: "string" }, text: { type: "string" } }, ["path", "text"], (a) => {
  const root = projectRoot(a);
  const p = String(a.path);
  if (/\.(glb|wav|ogg|png)$/i.test(p)) throw new Error("binary files are made by the model, sound, song and sprite tools");
  if (/\.model\.json$/.test(p) || /\.song\.json$/.test(p) || /\.sfx\.json$/.test(p)) throw new Error("use model_write, song_write or sfx_write so the game's own file (glb, ogg, wav) is made too");
  put(root, p, String(a.text));
  return `wrote ${p} (${String(a.text).length} characters)`;
});

tool(
  "model_write",
  "Write a 3D model: `models/<name>.model.json` (what the studio's model editor edits) and the `models/<name>.glb` the game loads. `model` is the studio's model document: " +
    '{ "version": 1, "scale": 0.0625, "parts": [ { "name", "origin": [x,y,z], "rotation": [degrees], "cubes": [ { "shape": "box|wedge|pyramid|cylinder|cone|sphere|mesh", "from": [x,y,z], "size": [w,h,d], "color": "#rrggbb", "faces"?: {...}, "rotation"?, "segments"?, "smooth"? } ], "children": [ ...parts ] } ], "clips"?: [...], "texture"?: { "size": [w,h] } }. ' +
    "Units: 16 model units = 1 world unit at the default scale. y is up. Parts turn about their origin (wheels, doors). See docs/project-format.md.",
  {
    name: { type: "string" },
    model: { type: ["object", "string"], description: "The model document (an object, or its JSON as text)." },
    bend: { type: "boolean", description: 'Give every free-mesh shape that has no skin automatic weights, as the editor\'s "Bend with the parts around it" button does: the shape then bends with its part, the part above it and the parts below it when they are posed or animated (a sleeve at the elbow). Make such limbs as meshes with several rings of points across the joint.' },
  },
  ["name", "model"],
  (a) => {
    const root = projectRoot(a);
    const name = safeName(a.name, "Model");
    const parsed = parseModel(typeof a.model === "string" ? a.model : JSON.stringify(a.model));
    if (!parsed.ok) throw new Error(`the model is not valid: ${parsed.error}`);
    let doc = parsed.doc;
    let skinned = 0;
    if (a.bend) {
      for (const { part, parts } of walk(doc)) {
        for (let i = 0; i < part.cubes.length; i++) {
          const path = { parts, cube: i };
          const cube = cubeAt(doc, path);
          if (!cube || cube.shape !== "mesh" || cube.skin) continue;
          const skin = autoWeights(doc, path);
          if (skin) {
            doc = setCube(doc, path, { ...cube, skin });
            skinned++;
          }
        }
      }
    }
    // make everything first, so a model that cannot be exported leaves nothing half written
    const image = doc.texture ? fitPicture(doc, bakeAll(doc)) : undefined;
    const glb = exportGlb(doc, image);
    if (image) put(root, `models/${name}.texture.png`, encodePng(image));
    put(root, `models/${name}.model.json`, serializeModel(doc));
    put(root, `models/${name}.glb`, glb);
    let triangles = 0;
    for (const { part } of walk(doc)) for (const c of part.cubes) triangles += meshOf(evaluate(c, "render")).indices.length / 3;
    return `models/${name}.model.json and models/${name}.glb: ${walk(doc).length} parts, ${countCubes(doc)} shapes, ${triangles} triangles${skinned ? `, ${skinned} bending` : ""}, ${glb.length} bytes. In Lua: nova.model("${name}", x, y, z)`;
  },
);

tool(
  "model_preview",
  "Render a picture of a model of this project (headless, in the game's own renderer) and return it. Use it to look at what you made: at rest, posed by an animation clip, or as a strip of a clip. Angles in degrees. " +
    "At rest: `yaw`, `pitch`, `distance` place the camera (the default looks from the front right, a little above). The answer lists the model's clips. " +
    "Posed: `clip` and `time` (seconds) show the model as that clip poses it at that moment. " +
    "A strip: `clip` and `strip: 8` return ONE picture with eight moments across the clip (2 to 16), a row from the front and a row from the side by default (`views`: front, side, left, back, top, quarter, or a yaw in degrees), the time under each, on a ground line at y = 0, so a walk can be read like a film strip and feet that float or sink can be seen. " +
    "With a clip the text also gives the height of each part's joint above the ground at every moment (the lowest parts, the feet, first), so \"the feet meet the ground\" can be checked in numbers. " +
    "Which way a turn goes (the model file's `rotation`, a clip's rotation keys, and rx, ry, rz in Lua; right-handed, y up, the model's front is +z): +x tips the top of a part towards the front (a leg hanging down swings back; an arm raised forward is a negative x turn); +y turns the part's front towards the model's +x side (to the viewer's right when seen from the front); +z tips the top of a part towards the model's -x side (a limb hanging down swings out towards +x).",
  {
    name: { type: "string" },
    clip: { type: "string", description: "Pose the model by this animation clip." },
    time: { type: "number", description: "Seconds into the clip (0 when left out). With `strip`, every moment is at this time." },
    strip: { type: ["number", "boolean"], description: "Show this many moments across the clip in one picture (true is 8)." },
    views: { type: "array", items: { type: ["string", "number"] }, description: 'The sides to look from, one row each: "front", "side" (the +x side), "left", "back", "top", "quarter", or a yaw in degrees. A strip shows front and side.' },
    yaw: { type: "number", description: "Turn around the model (0 = from the front, +z). Used when no `views` are given." },
    pitch: { type: "number" },
    distance: { type: "number", description: "World units from the model's middle." },
    size: { type: "number", description: "Roughly the model's height in world units (for framing). 1.5 for a plain picture; with a clip or views it is guessed from the joints." },
    width: { type: "number", description: "Of each picture (640; 240 in a strip)." },
    height: { type: "number", description: "Of each picture (480; 300 in a strip)." },
    parts: { type: "string", description: '"all": list the joint height of every part, not just the eight lowest.' },
  },
  ["name"],
  (a) => previewModel(projectRoot(a), safeName(a.name, "Model"), a, (args, timeout) => run(novaBin, args, timeout), keepPicture),
);

tool(
  "sfx_write",
  `Write a sound effect: \`sounds/<name>.sfx.json\` (the sound editor's settings) and \`sounds/<name>.wav\`. Start from a preset (${Object.keys(PRESETS).join(", ")}) and/or give parameters: ` +
    Object.entries(RANGES).map(([k, r]) => `${k} ${r.min}..${r.max}`).join(", ") + `, wave (${WAVES.join("|")}), seed. ` +
    "What they mean: the sound lasts attack + sustain + decay seconds (at most 4). `freq` is the pitch in Hz at the start (440 is the A above middle C; 880 an octave up); `slide` bends it by octaves per second (negative falls: a laser, a fall), `freqLimit` cuts the sound off when the pitch falls below it. " +
    "For the `noise` wave `freq` is how often the noise takes a new random value, so it sets the colour, not a pitch, and most of the energy lies below about half of it: 3000 (the top) is a bright crunch (a hit, an explosion, steps on gravel), 800 to 1500 a duller rattle, and below about 200 a rumble of slow thuds that small speakers cannot play (a footstep at freq 30 to 70 is nearly inaudible on a handheld: use 1500 to 3000 with a short decay, and a `highpass` of 500 or more for a hiss). " +
    "`arpSemitones` jumps the pitch once after `arpTime` seconds (a coin: 12). For a little tune give `arpNotes`, semitones from `freq`, one every `arpTime` seconds after the first note: { \"freq\": 523, \"arpTime\": 0.11, \"arpNotes\": [4, 7, 12], \"sustain\": 0.4 } is a four-note rising fanfare (one envelope over the whole tune; for separate notes with their own attack write a short song with song_write and play it as a sound). " +
    "`punch` adds a loud start, `lowpass` and `highpass` (Hz) soften or thin it, `duty` is the square wave's width (0.5 hollow, 0.1 thin and nasal). It returns the sound_report of what it made (level, where the energy sits, warnings). In Lua: nova.sound.play(\"<name>\", { volume = 0.8, pitch = 1.1 }).",
  { name: { type: "string" }, preset: { type: "string" }, params: { type: "object" } },
  ["name"],
  (a) => {
    const root = projectRoot(a);
    const name = safeName(a.name, "Sound");
    const base = a.preset ? PRESETS[String(a.preset)] : DEFAULTS;
    if (!base) throw new Error(`unknown preset '${a.preset}' (${Object.keys(PRESETS).join(", ")})`);
    const known = new Set([...Object.keys(RANGES), "wave", "seed", "arpNotes"]);
    const unknown = Object.keys(a.params ?? {}).filter((k) => !known.has(k));
    if (unknown.length) throw new Error(`params has "${unknown.join('", "')}", which the synth does not have (it has ${[...known].join(", ")})`);
    const p: SfxParams = { ...base, ...(a.params ?? {}) };
    if (!WAVES.includes(p.wave)) throw new Error(`wave must be one of ${WAVES.join(", ")}`);
    for (const [k, r] of Object.entries(RANGES)) {
      const v = (p as any)[k];
      if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`${k} must be a number`);
      (p as any)[k] = Math.min(r.max, Math.max(r.min, v));
    }
    if (p.arpNotes !== undefined) {
      const notes = cleanArpNotes(p.arpNotes);
      if (!notes) throw new Error('arpNotes is a list of semitones from freq, like [4, 7, 12] (up to 16 notes)');
      p.arpNotes = notes;
    }
    const sound = render(p);
    const bytes = encodeWav(sound);
    put(root, `sounds/${name}.sfx.json`, toJson(p));
    put(root, `sounds/${name}.wav`, bytes);
    const report = describe(analyse(`sounds/${name}.wav`, sound));
    return `sounds/${name}.wav: ${(sound.channels[0]!.length / sound.rate).toFixed(2)} s\n${report}`;
  },
);

/// Finds a sound of the project by name or path and decodes it: the file the game plays when there is one, else the editor's
/// settings rendered (`.sfx.json`, `.song.json`). A path given whole (starting with /) may be any sound file that can be read.
function loadSound(root: string, given: string): { name: string; sound: Sound; music: boolean; file: string } {
  const tries: string[] = [];
  const absolute = given.startsWith("/");
  if (absolute) {
    // any sound file the caller can read: one the command line wrote (`--audio-out`), a recording, another project's
    const full = resolve(given);
    if (!/\.(wav|ogg|sfx\.json|song\.json)$/i.test(full)) throw new Error(`'${given}' is not a sound file: a path given whole must end in .wav or .ogg (or .sfx.json, .song.json)`);
    if (!existsSync(full)) throw new Error(`there is no file '${given}'`);
    tries.push(full);
  } else {
    const base = given.replace(/\.(wav|ogg|sfx\.json|song\.json)$/i, "");
    const hasExt = base !== given;
    if (hasExt) for (const dir of given.includes("/") ? [""] : ["", "sounds/", "music/"]) tries.push(inside(root, `${dir}${given}`));
    for (const dir of given.includes("/") ? [""] : ["sounds/", "music/"]) {
      for (const ext of [".wav", ".ogg", ".sfx.json", ".song.json"]) tries.push(inside(root, `${dir}${base}${ext}`));
    }
  }
  const file = tries.find((f) => existsSync(f));
  if (!file) {
    const have = ["sounds", "music"].flatMap((d) => (existsSync(join(root, d)) ? readdirSync(join(root, d)).filter((f) => /\.(wav|ogg)$/i.test(f)).map((f) => `${d}/${f}`) : []));
    throw new Error(`there is no sound '${given}' (looked in sounds/ and music/ for .wav, .ogg, .sfx.json and .song.json). This project has: ${have.slice(0, 30).join(", ") || "no sounds yet"}`);
  }
  const name = file.startsWith(root + sep) ? relative(root, file) : file;
  const music = /(^|\/)music\//.test(name) || /\.song\.json$/.test(name);
  if (/\.sfx\.json$/i.test(file)) {
    const p = sfxFromJson(readFileSync(file, "utf8"));
    if (!p) throw new Error(`${name} is not a sound effect file`);
    return { name, sound: render(p), music, file };
  }
  if (/\.song\.json$/i.test(file)) {
    const parsed = parseSong(readFileSync(file, "utf8"));
    if (!parsed.ok) throw new Error(`${name}: ${parsed.error}`);
    return { name, sound: renderSong(parsed.song), music, file };
  }
  if (/\.ogg$/i.test(file)) {
    // decoded by the game's own decoder
    const dir = mkdtempSync(join(tmpdir(), "nova-wav-"));
    try {
      const out = join(dir, "sound.wav");
      const r = run(novaBin, ["wav", file, out]);
      if (!existsSync(out)) throw new Error(`${name} could not be decoded: ${r.out}`);
      return { name, sound: decodeWav(readFileSync(out)), music, file };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  return { name, sound: decodeWav(readFileSync(file)), music, file };
}

tool(
  "sound_report",
  "Hear a sound without ears: what a sound of the project is, in numbers and plain words, and a picture (its waveform over its spectrogram: time left to right, pitch upward from 40 Hz to 16 kHz, brighter is louder). " +
    "For each sound: length; peak, RMS and loudness (LUFS); how the loudness moves over time; the spectral centroid and how the energy divides between sub-bass, bass, mids, presence and air; the strongest spectral lines with their note names and share of the energy; the strongest pitch over time (a rising chirp, a tune); a reading in words (\"nearly a pure tone at 3.6 kHz\", \"mostly noise\", \"bass-heavy\", \"loudest at the start, then dying away\"); and warnings: clipping, clicks, a start or end that is not silent, silence before the sound, a piercing steady tone, energy that small speakers cannot play (below 80 Hz). " +
    "`sound` is a name or path (\"hit\", \"music/town.ogg\", \"sounds/hit.sfx.json\"); `sounds` is a list, which also gives the mix: which is loudest and by how much, so effects and music can be balanced with the `volume` option of nova.sound.play. `loop: true` also checks that the end meets the start without a click (music and .song.json files are checked as loops unless `loop` is false). " +
    "`file` is a WAV written by the play tool's `audio: true`: what a whole run sounded like. Headless runs play no sound, so this is how sound is checked.",
  {
    sound: { type: "string", description: 'A sound by name or project path: "hit", "music/town", "sounds/step.wav".' },
    sounds: { type: "array", items: { type: "string" }, description: "Several sounds: each is reported, then compared as a mix." },
    file: { type: "string", description: "A WAV file the play tool wrote (audio: true)." },
    loop: { type: "boolean", description: "Check the seam of a loop (default: yes for music, no for effects)." },
    picture: { type: "boolean", description: "false: words only." },
  },
  [],
  (a) => {
    const root = projectRoot(a);
    const names: string[] = [...(a.sound ? [String(a.sound)] : []), ...(Array.isArray(a.sounds) ? a.sounds.map(String) : []), ...(a.file ? [String(a.file)] : [])];
    if (!names.length) throw new Error('say which sound: "sound": "hit", or "sounds": ["hit", "step", "music/town"], or "file": a WAV from the play tool');
    const list = names.map((n) => {
      const s = loadSound(root, n);
      const run = a.file !== undefined && n === String(a.file); // (a recording of a run starts and stops anywhere)
      return analyse(s.name, s.sound, { loop: a.loop ?? (s.music && !run), run });
    });
    const text = [...list.map(describe), ...(list.length > 1 ? [mixTable(list)] : [])].join("\n\n");
    if (a.picture === false) return text;
    return { text, images: [keepPicture("sound", stack(list.slice(0, 4).map((s) => spectrogram(s))))] };
  },
);

tool(
  "song_write",
  "Write a song: `music/<name>.song.json` (the music editor's step sequencer) and the `music/<name>.ogg` the game streams. `song`: " +
    '{ "version": 1, "bpm": 40-240, "stepsPerBeat": 1-8, "length": steps (a bar is stepsPerBeat*4), "tracks": [ { "name", "kind": "synth"|"drums", "wave": "square|saw|triangle|sine|noise", "duty", "attack", "decay", "sustain", "release", "volume": 0-1, "pan": -1..1, "mute": false, "notes": [ { "step", "len", "pitch": midi (60 = middle C), "vel": 0-1 } ] } ] }. ' +
    "What each kind of track needs: a **synth** track needs `name`, `kind` and `notes` (wave defaults to square; attack, decay, sustain, release, volume, pan have the editor's defaults); a **drums** track needs only `name`, `kind` and `notes`: it has no wave, and a note's pitch picks the drum: 36 kick, 38 snare, 39 clap, 42 closed hat, 46 open hat, 45 tom, 49 crash (its length does not matter). A note needs `step` and `pitch`; `len` defaults to 1 step and `vel` to 0.8. " +
    "Synth tracks can take a fuller voice (leave these out for the plain chip sound): \"unison\" 1-7 detuned oscillators spread \"detune\" cents (0-60) across the stereo field, \"cutoff\" Hz low-pass with \"resonance\" 0-0.9 and \"sweep\" 0-1 (the note's envelope opens the filter by up to three octaves: plucks, bass), \"sub\" 0-1 (a sine an octave down), \"vibrato\" 0-0.5 semitones, and \"reverb\" 0-1 (the share sent to the song's room). Drum tracks can set \"kit\": \"studio\" (a kick with a click and weight, a snare with a tone and rattle, metallic hats) instead of the chip kit, and a \"reverb\" send. The song can have \"room\": { \"size\": 0-1, \"damping\": 0-1, \"mix\": 0-2 } for the reverb (default 0.55, 0.4, 1). " +
    "The song loops without a gap. In Lua: nova.music.play(\"<name>\").",
  { name: { type: "string" }, song: { type: ["object", "string"] } },
  ["name", "song"],
  (a) => {
    const root = projectRoot(a);
    const name = safeName(a.name, "Song");
    let given: any;
    try {
      given = asJson(a.song);
    } catch (e) {
      throw new Error(`the song is not valid: not valid JSON: ${e instanceof Error ? e.message : e}`);
    }
    // what a track leaves out is the editor's default for its kind (a drums track needs no wave; a note no vel or len)
    if (given && Array.isArray(given.tracks)) {
      given.tracks = given.tracks.map((t: any, i: number) => {
        if (!t || typeof t !== "object") return t;
        const base = t.kind === "drums" ? drumTrack(t.name ?? `drums ${i + 1}`) : synthTrack(t.name ?? `track ${i + 1}`);
        const notes = Array.isArray(t.notes) ? t.notes.map((n: any) => (n && typeof n === "object" ? { len: 1, vel: 0.8, ...n } : n)) : t.notes;
        return { ...base, ...t, notes };
      });
    }
    const parsed = parseSong(JSON.stringify(given));
    if (!parsed.ok) throw new Error(`the song is not valid: ${parsed.error}. A small song: { "version": 1, "bpm": 120, "stepsPerBeat": 4, "length": 16, "tracks": [ { "name": "lead", "kind": "synth", "wave": "square", "notes": [ { "step": 0, "len": 4, "pitch": 60 } ] }, { "name": "drums", "kind": "drums", "notes": [ { "step": 0, "pitch": 36 }, { "step": 4, "pitch": 38 } ] } ] }`);
    const wav = encodeWav(renderSong(parsed.song));
    put(root, `music/${name}.song.json`, serializeSong(parsed.song));
    if (!existsSync(oggBin)) {
      put(root, `music/${name}.wav`, wav);
      return `music/${name}.wav (${songSeconds(parsed.song).toFixed(1)} s); nova-ogg is not built, so it is a WAV for now (build: cargo build --release -p nova-studio --bin nova-ogg)`;
    }
    const tmp = mkdtempSync(join(tmpdir(), "nova-ogg-"));
    try {
      writeFileSync(join(tmp, "in.wav"), wav);
      const r = run(oggBin, [join(tmp, "in.wav"), inside(root, `music/${name}.ogg`)]);
      if (r.code !== 0) throw new Error(`encoding failed: ${r.out}`);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
    return `music/${name}.ogg (${songSeconds(parsed.song).toFixed(1)} s, ${statSync(inside(root, `music/${name}.ogg`)).size} bytes)`;
  },
);

tool(
  "sprite_write",
  "Write a pixel-art sprite or tileset: `sprites/<name>.png` (a sheet of frames) and `sprites/<name>.sprite.json` (frame size and named animations). Draw it with text: `palette` maps one character to a colour (\"#rrggbb\" or \"#rrggbbaa\"); '.' and ' ' are always transparent. `frames` is a list of frames, each a list of equal-length rows of characters (one character per pixel). " +
    "A frame may also be { rows: [...], name } or a copy of a frame that exists: { copy: <frame number or name>, flip: \"x\"|\"y\", rotate: 90|180|270, recolor: { \"#from\": \"#to\" }, name }. " +
    "Sheet layout: frames are packed left to right, 16 to a row, so with up to 16 frames the sheet is one row; frame n is tile n of a tilemap that uses the sheet (column n % 16, row floor(n / 16)). " +
    "Big sheets in several calls: `append: true` adds the frames to the end of the sheet that is there, `at: n` writes them from frame n (replacing those frames); the frame size, animations and names of the sheet are kept. " +
    "`names` (a list, one per frame given, or { frame number: name }) names frames; they are kept in `sprites/<name>.tileset.json` (with `solid`: the frames that block movement), and scene_write's tile `legend` can use the names. " +
    "`animations`: [{ name, from, to, direction?: \"forward\"|\"reverse\"|\"pingpong\", loop? }] by frame number. Mistakes are listed all at once, each with its frame, row and column. Returns a magnified picture of the sheet (see sprite_preview). " +
    "In Lua: nova.sprite(\"<name>\", x, y, { frame = n }), or an entity with sprite = \"<name>\" and anim = \"idle\".",
  {
    name: { type: "string" },
    palette: { type: "object", description: 'One character to one colour: { "r": "#ff0000", "s": "#00000080" }.' },
    frames: { type: "array", items: { type: ["array", "object", "string"] }, description: "Frames: each a list of rows (strings), or { rows, name }, or { copy, flip, rotate, recolor, name }." },
    animations: { type: "array", items: { type: "object" } },
    frame_ms: { type: "number", description: "How long each frame shows, milliseconds (100)." },
    append: { type: "boolean", description: "Add the frames to the end of the existing sheet." },
    at: { type: "number", description: "Write the frames into the existing sheet from this frame number." },
    names: { type: ["array", "object"], description: "Names for frames (tiles)." },
    solid: { type: "array", description: "Frames (numbers or names) that block movement, for a tileset." },
  },
  ["name", "frames"],
  (a) => {
    const root = projectRoot(a);
    const name = safeName(a.name, "Sprite");
    const r = writeSprite(root, name, a, (rel, data) => put(root, rel, data));
    return { text: r.text, images: [keepPicture(`sprite-${name}`, r.picture)] };
  },
);

tool(
  "sprite_preview",
  "Look at a sprite of the project: returns a picture of `sprites/<name>.png` magnified on a checker background, every frame outlined with its number (and name) under it, and one strip per animation with its frames in the order they play and how long each shows. The text says the sheet's size, how many frames are across, the animations and the frame names.",
  { name: { type: "string" } },
  ["name"],
  (a) => {
    const r = previewSprite(projectRoot(a), String(a.name));
    return { text: r.text, images: [keepPicture(`sprite-${String(a.name).replace(/[^A-Za-z0-9_-]/g, "_")}`, r.picture)] };
  },
);

tool(
  "scene_write",
  "Write a scene layout: `scenes/<name>.scene.json` (what the studio's scene editor edits; validated and tidied). `scene` is { version: 1, background?, width?, height?, camera?: { eye, target, fov }, objects: [ { kind, name?, x, y, z?, props? } ], images?, texts?, tilemaps? }. " +
    "`kind` is an entity in entities/ (a `name` makes the entity a field of the scene, `self.<name>`, findable with nova.named(\"<name>\"), and the entity's own `self.name`). " +
    "A tile layer (`tilemaps`) is { name?, tileset: { image: \"sprites/tiles.png\", tile_width, tile_height }, x?, y?, depth? (bigger is further back; a layer with a negative depth draws in front of the characters), solid?: [tiles], tiles: rows } where the rows may be typed as strings with a `legend`: { \"legend\": { \".\": -1, \"g\": 0, \"W\": \"wall\" }, \"solid\": [\"W\"], \"tiles\": [\"WWWW\", \"W.gW\", \"WWWW\"] } (one character per tile, top row first; a legend value is a tile number of the tileset, -1 for empty, or a tile name given with sprite_write's `names`; '.' and ' ' are empty unless the legend says otherwise; rows of numbers are accepted too). Mistakes are listed all at once with their layer, row and column. The file keeps numbers; scene_preview shows them as characters again. " +
    "For a 2D scene it returns the same picture as scene_preview (`picture: false` to skip it). In 3D, x goes across, y up, z towards the viewer; the props `ry`, `rx`, `rz` (radians) and `sx` turn and size a model entity. The scene's code goes in scenes/<name>.lua (write_file).",
  { name: { type: "string" }, scene: { type: ["object", "string"] }, picture: { type: "boolean", description: "false: do not return the map picture." } },
  ["name", "scene"],
  (a) => {
    const root = projectRoot(a);
    const name = safeName(a.name, "Scene");
    let given: unknown;
    try {
      given = asJson(a.scene);
    } catch (e) {
      throw new Error(`the scene is not valid: not valid JSON: ${e instanceof Error ? e.message : e}`);
    }
    if (given && typeof given === "object" && !Array.isArray(given)) expandTileLayers(root, given as Args);
    const parsed = parseScene(JSON.stringify(given));
    if (!parsed.ok) throw new Error(`the scene is not valid: ${parsed.error}. A scene is { "version": 1, "objects": [ { "kind": "player", "name": "hero", "x": 100, "y": 80 } ], "tilemaps": [...] }`);
    put(root, `scenes/${name}.scene.json`, serializeScene(parsed.scene));
    const said = `scenes/${name}.scene.json: ${parsed.scene.objects?.length ?? 0} objects${tilemaps(parsed.scene).length ? `, ${tilemaps(parsed.scene).length} tile layer(s)` : ""}`;
    if (a.picture === false) return said;
    const view = drawScene(root, name, parsed.scene);
    return view.picture ? { text: `${said}\n${view.text}`, images: [keepPicture(`scene-${name}`, view.picture)] } : said;
  },
);

tool(
  "scene_preview",
  "Look at a scene file without playing the game: a picture of `scenes/<name>.scene.json` as a map. Tile layers are drawn from their tilesets (solid tiles outlined red), every object is drawn where it is placed (its entity's sprite if it has one, else an orange box) with a pink cross on its x, y, its hitbox in green and its name:kind above it; the grid is the tile grid, world coordinates run along the top and left edges, and a dashed box shows the size of one screen. " +
    "The text lists each tile layer as rows of characters with a legend (ready to edit and give back to scene_write) and every object with its position, tile and props, and says which kinds have no entity file. `area`: [x, y, w, h] in world units shows a part; `zoom` sets the magnification; `grid: false` and `labels: false` give a cleaner picture.",
  { name: { type: "string" }, area: { type: "array", items: { type: "number" } }, zoom: { type: "number" }, grid: { type: "boolean" }, labels: { type: "boolean" } },
  ["name"],
  (a) => {
    const r = previewScene(projectRoot(a), String(a.name), { area: a.area, zoom: a.zoom, grid: a.grid, labels: a.labels });
    return r.picture ? { text: r.text, images: [keepPicture(`scene-${String(a.name).replace(/[^A-Za-z0-9_-]/g, "_")}`, r.picture)] } : r.text;
  },
);

tool(
  "track_write",
  "Lay out a racing route from control points: a closed circuit, or an open rally stage (`open`: true), as the plain files a person could edit, the same files the studio's track editor makes. It writes `tracks/<name>.track.json` (the route and its settings, what the track editor opens), `scenes/<name>.scene.json` (the start line and arch, a finish arch and section gates on a stage, waypoints every 10 m for the cars and the pace notes, the starting grid, and scenery along the route: trees, bushes, rocks, guardrails with chevron signs at the bends, tyres, optional street lamps, distant scenery and landmarks) and the road as one ribbon mesh, `models/road_<name>.glb` (draw it with nova.model(\"road_<name>\", 0, 0, 0)). " +
    "When `tracks/<name>.track.json` already exists it is the starting point and only the settings given here change: `{ name }` alone makes the scene and road again from the saved track. The objects of the old scene that have a `name` (settings kept in the scene, such as a game's race object) are kept; everything else in it is made anew. " +
    "`control` is a list of [x, z] points the curve passes through (metres; the route starts at the first heading to the second: for a stage give a straight lead-in). It reports the length, the tightest bend's radius (keep it above about 15 m) and the closest approach between distant parts of the route (keep it above about 40 m), and draws a map. Scenery kinds are entity names in entities/. The same settings and seed always give the same scene.",
  {
    name: { type: "string" },
    control: { type: "array", items: { type: "array", items: { type: "number" } } },
    open: { type: "boolean", description: "A point-to-point stage instead of a loop." },
    road: { type: "string", description: "road_asphalt (default), road_dirt, road_snow, road_gravel or road_sand: the ribbon's colours." },
    sections: { type: "number", description: "Sections of a stage (gates between them; the last is the finish). Default 5." },
    lead_in: { type: "number", description: "Metres of road before a stage's start line (40)." },
    runout: { type: "number", description: "Metres of road after a stage's finish line (90)." },
    seed: { type: "number" },
    trees: { type: "array", items: { type: "string" } },
    small: { type: "array", items: { type: "string" } },
    rock: { type: "array", items: { type: "string" } },
    density: { type: "number", description: "Trees per piece of road, 0 to 1 (0.4)." },
    rocks: { type: "number" },
    rail: { type: "string", description: "The barrier entity on the outside of bends (guardrail)." },
    lamps: { type: "boolean" },
    sky: { type: "array", items: { type: "number" }, description: "The scene's background colour [r, g, b]." },
    far: { type: "object", description: "Distant scenery 60 to 150 m from the road: { kind: [entity names], density: 0 to 1 per piece of road }." },
    landmarks: { type: "object", description: "Tall features well away from the road: { kind: [entity names], count, radius: metres from the route's middle }." },
    roadside: { type: ["object", "null"], description: "The life beside the road, or null for none: { stand, tent, banner, flag, boards: [two billboard kinds that take turns], pylon } (entity names): stands, tents and banners by the start, flags along the start straight, billboards on the straights, pylons on the outside of hard bends." },
    crowd: { type: "object", description: "Spectators in groups by the start, at the hard bends and along the straights: { kind: [entity names to pick from], size: their scale }." },
    textured: { type: "boolean", description: "The road gets texture coordinates and names the project's road pictures, textures/road.png (the sheet) and textures/road_grain.png (fine grain): see docs/track-editor.md, \"A textured road\". The project must have those two pictures. Default: flat colours, no pictures needed." },
    zones: { type: "array", items: { type: "object" }, description: "Stretches of the route with their own surface or width: [{ from, to (metres along the route from its first point), road?: a road kind, width?: metres across (the road is 12; 8 is narrow), wall?: an entity lining both edges }]. The roadside can also have garage, garages (how many), office, gantry and post kinds: a pit row, a gantry over the road after the line, light posts along the straights." },
  },
  ["name"],
  (a) => {
    const root = projectRoot(a);
    const name = safeName(a.name, "Track");
    const saved = join(root, trackOf(name));
    let base: Record<string, unknown> = { ...newTrack() };
    if (existsSync(saved)) {
      const p = parseTrack(readFileSync(saved, "utf8"));
      if (!p.ok) throw new Error(`${trackOf(name)}: ${p.error}`);
      base = { ...p.doc };
    } else if (a.control === undefined) throw new Error(`there is no ${trackOf(name)}: give the route's \`control\` points`);
    const given: Record<string, unknown> = { ...a, leadIn: a.lead_in };
    for (const key of ["control", "open", "road", "sections", "leadIn", "runout", "seed", "trees", "small", "rock", "density", "rocks", "rail", "lamps", "sky", "far", "landmarks", "roadside", "crowd", "zones", "textured"]) {
      if (given[key] !== undefined) base[key] = given[key];
    }
    const control = base.control as unknown[];
    if (!Array.isArray(control) || control.length < 4 || control.some((p) => !Array.isArray(p) || p.length !== 2)) throw new Error("control needs at least four [x, z] points");
    const parsed = parseTrack(JSON.stringify(base));
    if (!parsed.ok) throw new Error(parsed.error);
    const doc = parsed.doc;
    let files;
    try {
      const scenePath = join(root, sceneOf(name));
      files = buildTrack(doc, existsSync(scenePath) ? readFileSync(scenePath, "utf8") : null); // (the old scene's named objects are kept)
    } catch (e) {
      throw new Error(String(e));
    }
    put(root, trackOf(name), serializeTrack(doc));
    put(root, sceneOf(name), files.scene);
    put(root, roadOf(name), files.glb);
    const stats = analyseTrack(doc)!;
    return `${name}: ${files.report}, ${doc.control.length} control points, closest approach ${stats.closest ?? "–"} m${stats.warnings.length ? `\n${stats.warnings.join("\n")}` : ""}\n${trackMap(stats.line)}`;
  },
);

tool(
  "terrain_write",
  "Make designed ground for a route: a heightmap picture `terrain/<name>.png` (16-bit grey) from the route's control points (the same `control` and `open` as track_write) and an elevation profile along it, with the land around the road blended smoothly into rolling hills. " +
    "`profile` is a list of [metres along the route, road elevation in metres]: [[0, 0], [400, 20], [600, 24], [1000, 4]] is a road that climbs 20 m over its first 400 m, crests at 24 m and drops away (the elevations are smooth between the points, a closed circuit wraps round, and the grade is held to `max_grade`). " +
    "It returns the line to put in the scene's code: nova.terrain{ heightmap = \"terrain/<name>.png\", x = ..., z = ..., size = ..., height = ... } (the engine lifts everything drawn on the ground, the road ribbon included, by it). Heights below 0 cannot be stored, so if the land dips below 0 the whole map is raised and the report says by how much.",
  {
    name: { type: "string" },
    control: { type: "array", items: { type: "array", items: { type: "number" } } },
    open: { type: "boolean", description: "A point-to-point stage instead of a loop." },
    profile: { type: "array", items: { type: "array", items: { type: "number" } }, description: "[[distance m, elevation m], ...] along the route. Default flat at 0." },
    max_grade: { type: "number", description: "The steepest the road may climb, rise over run (0.12 is 12 %). Default 0.12." },
    hills: { type: "number", description: "How tall the surrounding hills are, metres (12)." },
    hill_wavelength: { type: "number", description: "Metres between hill crests, roughly (220)." },
    flat: { type: "number", description: "Metres from the centreline that stay level with the road (9)." },
    blend: { type: "number", description: "Metres over which the road's ground blends into the hills (80)." },
    margin: { type: "number", description: "Metres of land beyond the route's bounds (150)." },
    cell: { type: "number", description: "Metres between samples (4)." },
    seed: { type: "number" },
  },
  ["name", "control"],
  (a) => {
    const root = projectRoot(a);
    const name = safeName(a.name, "Terrain");
    const control = a.control as number[][];
    if (!Array.isArray(control) || control.length < 4 || control.some((p) => !Array.isArray(p) || p.length !== 2)) throw new Error("control needs at least four [x, z] points");
    const r = heightmapFromTrack({
      control, open: !!a.open, profile: a.profile ?? [[0, 0]], maxGrade: a.max_grade, hills: a.hills, hillWavelength: a.hill_wavelength,
      flat: a.flat, blend: a.blend, margin: a.margin, cell: a.cell, seed: a.seed ?? 1,
    });
    put(root, `terrain/${name}.png`, r.png);
    const n = (v: number) => Math.round(v * 10) / 10;
    return `terrain/${name}.png: ${r.width} x ${r.rows} samples, ${r.cell} m apart\n` +
      `nova.terrain{ heightmap = "terrain/${name}.png", x = ${r.x}, z = ${r.z}, size = ${r.size}, height = ${r.height} }\n` +
      `road: ${n(r.report.roadStart)} m at the start, ${n(r.report.roadEnd)} m at the end, from ${n(r.report.roadMin)} to ${n(r.report.roadMax)} m, steepest grade ${Math.round(r.report.maxGrade * 1000) / 10} %` +
      (r.shift > 0 ? `\nthe whole land was raised ${n(r.shift)} m so that nothing is below 0` : "") +
      `\nroad elevation every 100 m: ${r.report.profile.map((p: number[]) => p[1]).join(", ")}`;
  },
);

tool(
  "store_art",
  "Render the game's icon (512x512, `icon.png`) or box art (768x1024, `boxart.png`) into the project by running it headless: give the keys that get to the screen you want (`press`, like the screenshot tool) and how many `frames` to run. `scripts/build-apk.sh` makes the Android launcher icon from icon.png; a launcher can use boxart.png as the cover. Returns the picture.",
  {
    kind: { type: "string", enum: ["icon", "boxart"] },
    frames: { type: "number" },
    press: { type: "array", items: { type: "string" } },
    hold: { type: "array", items: { type: "string" } },
  },
  ["kind"],
  (a) => {
    const root = projectRoot(a);
    const icon = a.kind === "icon";
    const out = join(root, icon ? "icon.png" : "boxart.png");
    const extra = [...(a.press?.length ? ["--press", a.press.join(",")] : []), ...(a.hold?.length ? ["--hold", a.hold.join(",")] : [])];
    const r = run(novaBin, ["run", root, "--headless", "--frames", String(a.frames ?? 90), "--size", icon ? "512x512" : "768x1024", ...extra, "--capture", out]);
    if (!existsSync(out)) throw new Error(`no picture was made:\n${r.out}`);
    written.push(icon ? "icon.png" : "boxart.png");
    return { text: `${icon ? "icon.png (512x512)" : "boxart.png (768x1024)"} written`, images: [out] };
  },
);

tool("check", "Check the project the way the studio's Problems panel does: load it, run a few frames, and list every problem with its file and line. 'no errors' means it ran cleanly.", { frames: { type: "number" } }, [], (a) => {
  const r = run(novaBin, ["check", projectRoot(a), "--frames", String(a.frames ?? 60)]);
  return r.out || "no errors";
});

const playProperties = {
  route: { type: "array", items: { type: "object" }, description: ROUTE_HELP },
  start_scene: { type: "string", description: 'Start in this scene instead of the one main.lua names ("cave", "levels.3").' },
  lua: { type: "string", description: "Lua run once when the scene is up, before the route: place the player, give the key, set the health (nova.named('hero').x = 200)." },
  capture_at: { type: "array", items: { type: "number" }, description: "Frames to take pictures after (1 is the first frame; 60 = one second in)." },
  every: { type: "number", description: "Also take a picture every this many frames (an animation or a movement as a film strip)." },
  print: { type: "array", items: { type: "string" }, description: "Lua expressions whose values are reported at every picture and at the end: \"nova.named('hero').hp\", \"nova.count('enemy')\", \"nova.current_scene()\"." },
  frames: { type: "number", description: "Run at least this many frames (60 = one second). Default 90 without a route; with one, the route's own length." },
  seed: { type: "number", description: "The seed of math.random. Runs are repeatable: the same seed and input give the same run (1 when left out)." },
  size: { type: "string", description: 'The picture size, "WIDTHxHEIGHT". Default "960x540" (the CLI\'s own default is 1280x720). The game always sees a screen 540 units high.' },
  crop: { type: "array", items: { type: "number" }, description: "[x, y, w, h] in picture pixels: return this part of every picture." },
  zoom: { type: "number", description: "Enlarge every picture (or its crop) this many times, without blur: small pixel art read closely." },
  state: { type: "string", enum: ["end", "all", "none"], description: "The list of entities with positions: at the end (default), at every picture, or not at all." },
  audio: { type: ["boolean", "string"], description: 'true: also write what the run sounded like to a WAV file (its path is in the answer; give it to sound_report). With `out` it is <out>/run.wav; a path such as "build/run1.wav" (in the project, in a folder the game ignores) says where yourself.' },
  out: { type: "string", description: 'A folder in the project for the run\'s files: every picture taken (each `capture`, `capture_at` frame, `every` frame and the last) as its own full-size PNG named by its frame and caption (f00031-at-the-door.png), the film strip (strip.png), report.json and, with `audio: true`, run.wav. It must be a place the game does not load: under "build/", a dot-folder, or a folder listed in nova.json\'s "ignore" ("shots/run1" with { "ignore": ["shots"] }). The answer lists what was written. A run never reloads the game when files change, so writing there is safe.' },
  columns: { type: "number", description: "How many pictures across the film strip." },
  press: { type: "array", items: { type: "string" }, description: 'Taps by frame, each "source@frame", for example "key:Enter@30": the key is held for two frames from that frame. (A route is easier.)' },
  hold: { type: "array", items: { type: "string" }, description: 'Actions held every frame of the run, for example ["throttle", "steer=0.3"].' },
  width: { type: "number" },
  height: { type: "number" },
};
const playHandler = (a: Args): Result => {
  const r = playGame(projectRoot(a), a, (args, timeout) => run(novaBin, args, timeout), keepPicture);
  for (const f of r.wrote ?? []) if (!written.includes(f)) written.push(f);
  return r;
};

tool(
  "play",
  "Play the game headless along a route and see what happened: one call returns a film strip (one picture with a tile per moment, the frame number under each) and a report in words: the scene and every entity with its position at the end, the values of the Lua expressions you asked for at each picture, the game's log lines (nova.log) and the sounds it started, each with its frame, and any Lua error. " +
    "Use it to check that a level can be played: walk to the key, fight, open the chest, and read the strip. `route` drives the game with its input action names (nova.json's `input`, or the built-in left right up down a b x y start select and the axes move_x move_y). `start_scene` and `lua` begin somewhere else in some state, so a late room needs no walk. A step can walk and tap at once (`tap_every`), repeat a group of steps (`repeat`, `steps`), and steer to a point in 2D or 3D (`walk_to`). " +
    "Pictures: each step's `capture`, `capture_at` frames, `every` N frames, and always the last frame; `crop` and `zoom` look closely. Runs are repeatable (math.random is seeded). A headless run has no sound device: `audio: true` writes the run's sound to a file for sound_report. `out: \"build/run1\"` also saves every picture as its own full-size file in the project (with the strip, the report and the sound). With no options it is a picture after 90 frames.",
  playProperties,
  [],
  playHandler,
);

tool(
  "screenshot",
  "Run the project headless for some frames and return a picture of the last one (960x540 unless `size` says otherwise; the answer says the size). Keys are pressed only as `press` and `hold` say. It takes every option of `play` (a `route` of steps, `start_scene`, `lua`, `capture_at`, `every`, `print`, `crop`, `zoom`): use `play` to walk through the game and get a film strip.",
  playProperties,
  [],
  playHandler,
);

// ---- MCP over stdio ------------------------------------------------------------------------------------------------
const send = (m: unknown) => process.stdout.write(`${JSON.stringify(m)}\n`);

function call(name: string, args: Args) {
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`unknown tool '${name}'`);
  for (const key of t.required ?? []) if (args[key] === undefined) throw new Error(`'${key}' is required`);
  written = [];
  let r: Result;
  try {
    r = t.handler(args);
  } catch (e) {
    logActivity(args, name, e instanceof Error ? e.message : String(e), true);
    throw e;
  }
  logActivity(args, name, typeof r === "string" ? r : r.text, false);
  const content: unknown[] = [{ type: "text", text: typeof r === "string" ? r : r.text }];
  if (typeof r !== "string") for (const file of r.images ?? []) content.push({ type: "image", data: readFileSync(file).toString("base64"), mimeType: "image/png" });
  return { content };
}

function handle(msg: any) {
  const { id, method, params } = msg;
  if (id === undefined) return; // notifications need no answer
  try {
    if (method === "initialize") {
      send({ jsonrpc: "2.0", id, result: { protocolVersion: params?.protocolVersion ?? "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "nova", version: "0.1.0" } } });
    } else if (method === "ping") send({ jsonrpc: "2.0", id, result: {} });
    else if (method === "tools/list") {
      send({ jsonrpc: "2.0", id, result: { tools: tools.map((t) => ({ name: `nova_${t.name}`, description: t.description, inputSchema: { type: "object", properties: t.properties, required: t.required ?? [] } })) } });
    } else if (method === "tools/call") {
      const name = String(params?.name ?? "").replace(/^nova_/, "");
      try {
        send({ jsonrpc: "2.0", id, result: call(name, params?.arguments ?? {}) });
      } catch (e) {
        // a tool's own failure is a result the assistant can read and act on
        send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true } });
      }
    } else send({ jsonrpc: "2.0", id, error: { code: -32601, message: `unknown method ${method}` } });
  } catch (e) {
    send({ jsonrpc: "2.0", id, error: { code: -32603, message: e instanceof Error ? e.message : String(e) } });
  }
}

export { call, tools };

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    for (let nl = buffer.indexOf("\n"); nl >= 0; nl = buffer.indexOf("\n")) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      try {
        handle(JSON.parse(line));
      } catch (e) {
        send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: `bad message: ${e instanceof Error ? e.message : e}` } });
      }
    }
  });
}
