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
import { encodePng } from "../src/lib/png-encode";
import { newRaster } from "../src/lib/pixels";
import { PRESETS, DEFAULTS, RANGES, WAVES, render, toJson, type SfxParams } from "../src/lib/sfx";
import { encodeWav } from "../src/lib/wav";
import { parseSong, renderSong, serializeSong, songSeconds } from "../src/lib/song";
import { parseScene, serializeScene } from "../src/lib/scene-model";
import { parseSheetJson } from "../src/lib/sprite-doc";

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

function put(root: string, rel: string, data: string | Uint8Array): string {
  const full = inside(root, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, data);
  return rel;
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
    for (const { part } of walk(doc)) for (const c of part.cubes) triangles += meshOf(c).indices.length / 3;
    return `models/${name}.model.json and models/${name}.glb: ${walk(doc).length} parts, ${countCubes(doc)} shapes, ${triangles} triangles${skinned ? `, ${skinned} bending` : ""}, ${glb.length} bytes. In Lua: nova.model("${name}", x, y, z)`;
  },
);

tool(
  "model_preview",
  "Render a picture of a model of this project (headless, in the game's own renderer) and return it. Use it to look at what you made. Angles in degrees.",
  { name: { type: "string" }, yaw: { type: "number", description: "Turn around the model (0 = from the front, +z)." }, pitch: { type: "number" }, distance: { type: "number", description: "World units from the model's middle." }, size: { type: "number", description: "Roughly the model's height in world units (for centring). Default 1.5." }, width: { type: "number" }, height: { type: "number" } },
  ["name"],
  (a) => {
    const root = projectRoot(a);
    const name = safeName(a.name, "Model");
    const dir = mkdtempSync(join(tmpdir(), "nova-preview-"));
    try {
      mkdirSync(join(dir, "models"));
      writeFileSync(join(dir, "models", `${name}.glb`), readFileSync(inside(root, `models/${name}.glb`)));
      writeFileSync(join(dir, "nova.json"), '{"format":1,"name":"preview"}');
      const yaw = ((a.yaw ?? 35) * Math.PI) / 180;
      const pitch = ((a.pitch ?? 22) * Math.PI) / 180;
      const d = a.distance ?? 4;
      const mid = (a.size ?? 1.5) / 2;
      const eye = [d * Math.sin(yaw) * Math.cos(pitch), mid + d * Math.sin(pitch), d * Math.cos(yaw) * Math.cos(pitch)];
      writeFileSync(
        join(dir, "main.lua"),
        `function update(dt)\n  nova.clear(120, 150, 190)\n  nova.light { dir = { -0.5, -1, -0.4 }, ambient = { 110, 115, 130 } }\n  nova.camera(${eye.join(", ")}, 0, ${mid}, 0, 45)\n  nova.model("${name}", 0, 0, 0)\nend\n`,
      );
      const out = join(dir, "shot.png");
      const r = run(novaBin, ["run", dir, "--headless", "--frames", "3", "--size", `${a.width ?? 640}x${a.height ?? 480}`, "--capture", out]);
      if (!existsSync(out)) throw new Error(`no picture was made:\n${r.out}`);
      const keep = join(tmpdir(), `nova-preview-${name}-${Date.now()}.png`);
      writeFileSync(keep, readFileSync(out));
      return { text: `preview of ${name} (saved at ${keep})`, images: [keep] };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

tool(
  "sfx_write",
  `Write a sound effect: \`sounds/<name>.sfx.json\` (the sound editor's settings) and \`sounds/<name>.wav\`. Start from a preset (${Object.keys(PRESETS).join(", ")}) and/or give parameters: ` +
    Object.entries(RANGES).map(([k, r]) => `${k} ${r.min}..${r.max}`).join(", ") + `, wave (${WAVES.join("|")}), seed. In Lua: nova.sound.play("<name>").`,
  { name: { type: "string" }, preset: { type: "string" }, params: { type: "object" } },
  ["name"],
  (a) => {
    const root = projectRoot(a);
    const name = safeName(a.name, "Sound");
    const base = a.preset ? PRESETS[String(a.preset)] : DEFAULTS;
    if (!base) throw new Error(`unknown preset '${a.preset}' (${Object.keys(PRESETS).join(", ")})`);
    const p: SfxParams = { ...base, ...(a.params ?? {}) };
    if (!WAVES.includes(p.wave)) throw new Error(`wave must be one of ${WAVES.join(", ")}`);
    for (const [k, r] of Object.entries(RANGES)) {
      const v = (p as any)[k];
      if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`${k} must be a number`);
      (p as any)[k] = Math.min(r.max, Math.max(r.min, v));
    }
    const sound = render(p);
    const bytes = encodeWav(sound);
    put(root, `sounds/${name}.sfx.json`, toJson(p));
    put(root, `sounds/${name}.wav`, bytes);
    return `sounds/${name}.wav: ${(sound.channels[0]!.length / sound.rate).toFixed(2)} s`;
  },
);

tool(
  "song_write",
  "Write a song: `music/<name>.song.json` (the music editor's step sequencer) and the `music/<name>.ogg` the game streams. `song`: " +
    '{ "version": 1, "bpm": 40-240, "stepsPerBeat": 1-8, "length": steps (a bar is stepsPerBeat*4), "tracks": [ { "name", "kind": "synth"|"drums", "wave": "square|saw|triangle|sine|noise", "duty", "attack", "decay", "sustain", "release", "volume": 0-1, "pan": -1..1, "mute": false, "notes": [ { "step", "len", "pitch": midi (60 = middle C; for drums 36 kick, 38 snare, 42 hat...), "vel": 0-1 } ] } ] }. ' +
    "The song loops without a gap. In Lua: nova.music.play(\"<name>\").",
  { name: { type: "string" }, song: { type: ["object", "string"] } },
  ["name", "song"],
  (a) => {
    const root = projectRoot(a);
    const name = safeName(a.name, "Song");
    const parsed = parseSong(typeof a.song === "string" ? a.song : JSON.stringify(a.song));
    if (!parsed.ok) throw new Error(`the song is not valid: ${parsed.error}`);
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
  "Write a pixel-art sprite: `sprites/<name>.png` (a sheet of frames) and `sprites/<name>.sprite.json` (frame size and named animations). Draw it with text: `palette` maps one character to a colour (\"#rrggbb\" or \"#rrggbbaa\"); '.' and ' ' are always transparent. `frames` is a list of frames, each a list of equal-length rows of characters. `animations`: [{ name, from, to, direction?, loop? }] by frame number. In Lua: nova.sprite(\"<name>\", x, y, { frame = n }), or an entity with sprite = \"<name>\" and anim = \"idle\".",
  {
    name: { type: "string" },
    palette: { type: "object" },
    frames: { type: "array", items: { type: "array", items: { type: "string" } } },
    animations: { type: "array", items: { type: "object" } },
    frame_ms: { type: "number" },
  },
  ["name", "palette", "frames"],
  (a) => {
    const root = projectRoot(a);
    const name = safeName(a.name, "Sprite");
    const frames: string[][] = a.frames;
    if (!Array.isArray(frames) || !frames.length) throw new Error("frames needs at least one frame (a list of rows)");
    const fh = frames[0]!.length;
    const fw = frames[0]![0]?.length ?? 0;
    if (!fw || !fh) throw new Error("a frame needs rows of at least one character");
    const columns = Math.min(frames.length, 16);
    const rows = Math.ceil(frames.length / columns);
    const sheet = newRaster(columns * fw, rows * fh);
    const colour = (ch: string): [number, number, number, number] => {
      if (ch === "." || ch === " ") return [0, 0, 0, 0];
      const hex = String((a.palette as Record<string, string>)[ch] ?? "");
      const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex);
      if (!m) throw new Error(`'${ch}' is not in the palette (or its colour is not #rrggbb)`);
      const n = parseInt(m[1]!, 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255, m[2] ? parseInt(m[2], 16) : 255];
    };
    frames.forEach((frame, f) => {
      if (frame.length !== fh || frame.some((row) => row.length !== fw)) throw new Error(`frame ${f} is not ${fw}x${fh} characters`);
      const [ox, oy] = [(f % columns) * fw, Math.floor(f / columns) * fh];
      frame.forEach((row, y) => [...row].forEach((ch, x) => sheet.data.set(colour(ch), ((oy + y) * sheet.w + ox + x) * 4)));
    });
    const json = {
      version: 1,
      image: `${name}.png`,
      frame_width: fw,
      frame_height: fh,
      columns,
      frames: frames.length,
      frame_duration_ms: a.frame_ms ?? 100,
      ...(a.animations?.length ? { tags: a.animations } : {}),
    };
    const text = `${JSON.stringify(json, null, 2)}\n`;
    const ok = parseSheetJson(text);
    if (!ok.ok) throw new Error(ok.error);
    put(root, `sprites/${name}.png`, encodePng(sheet));
    put(root, `sprites/${name}.sprite.json`, text);
    return `sprites/${name}.png: ${frames.length} frame(s) of ${fw}x${fh}`;
  },
);

tool(
  "scene_write",
  "Write a scene layout: `scenes/<name>.scene.json` (what the studio's scene editor edits; validated and tidied). `scene` is { version: 1, background?, width?, height?, camera?: { eye, target, fov }, objects: [ { kind, name?, x, y, z?, props? } ], images?, texts?, tilemaps? }. " +
    "`kind` is an entity in entities/. In 3D, x goes across, y up, z towards the viewer; the props `ry`, `rx`, `rz` (radians) and `sx` turn and size a model entity. The scene's code goes in scenes/<name>.lua (write_file).",
  { name: { type: "string" }, scene: { type: ["object", "string"] } },
  ["name", "scene"],
  (a) => {
    const root = projectRoot(a);
    const name = safeName(a.name, "Scene");
    const parsed = parseScene(typeof a.scene === "string" ? a.scene : JSON.stringify(a.scene));
    if (!parsed.ok) throw new Error(`the scene is not valid: ${parsed.error}`);
    put(root, `scenes/${name}.scene.json`, serializeScene(parsed.scene));
    return `scenes/${name}.scene.json: ${parsed.scene.objects?.length ?? 0} objects`;
  },
);

tool("check", "Check the project the way the studio's Problems panel does: load it, run a few frames, and list every problem with its file and line. 'no errors' means it ran cleanly.", { frames: { type: "number" } }, [], (a) => {
  const r = run(novaBin, ["check", projectRoot(a), "--frames", String(a.frames ?? 60)]);
  return r.out || "no errors";
});

tool(
  "screenshot",
  "Run the project headless for some frames and return a picture of the last one. Keys are pressed only as `press` and `hold` say, so use those to get past menus and into the game.",
  {
    frames: { type: "number", description: "How many frames to run first (60 = one second). Default 90." },
    press: { type: "array", items: { type: "string" }, description: 'Taps, each "source@frame", for example "key:Enter@30": the key is held for two frames from that frame. Use them to get past menus.' },
    hold: { type: "array", items: { type: "string" }, description: 'Actions held every frame, for example ["throttle", "steer=0.3"].' },
    width: { type: "number" },
    height: { type: "number" },
  },
  [],
  (a) => {
    const root = projectRoot(a);
    const out = join(tmpdir(), `nova-shot-${Date.now()}.png`);
    const extra = [...(a.press?.length ? ["--press", a.press.join(",")] : []), ...(a.hold?.length ? ["--hold", a.hold.join(",")] : [])];
    const r = run(novaBin, ["run", root, "--headless", "--frames", String(a.frames ?? 90), "--size", `${a.width ?? 960}x${a.height ?? 540}`, ...extra, "--capture", out]);
    if (!existsSync(out)) throw new Error(`no picture was made:\n${r.out}`);
    return { text: `${r.out.split("\n").slice(-3).join("\n")}\nsaved at ${out}`, images: [out] };
  },
);

// ---- MCP over stdio ------------------------------------------------------------------------------------------------
const send = (m: unknown) => process.stdout.write(`${JSON.stringify(m)}\n`);

function call(name: string, args: Args) {
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`unknown tool '${name}'`);
  for (const key of t.required ?? []) if (args[key] === undefined) throw new Error(`'${key}' is required`);
  const r = t.handler(args);
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
