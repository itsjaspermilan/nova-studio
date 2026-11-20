// Nothing is ignored in silence: the keys a caller gave that a tool (or a structure inside its arguments) does not have are
// named, each with the nearest key it does have.

/// How many single-character edits turn one word into another.
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let last = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const keep = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1));
      last = keep;
    }
  }
  return row[b.length]!;
}

/// The allowed key that a wrong one was most likely meant to be, or nothing when none is close.
export function nearest(key: string, allowed: readonly string[]): string | undefined {
  const k = key.toLowerCase().replace(/[-_]/g, "");
  if (k.length < 2) return undefined;
  let best: string | undefined;
  let score = Infinity;
  for (const a of allowed) {
    const b = a.toLowerCase().replace(/[-_]/g, "");
    const d = b === k ? 0 : (b.length > 2 && k.includes(b)) || (k.length > 2 && b.includes(k)) ? 1 : distance(k, b);
    if (d < score) [best, score] = [a, d];
  }
  return score <= (k.length <= 3 ? 1 : Math.max(2, Math.floor(k.length / 3))) ? best : undefined;
}

/// Where a key belongs when it was put one level off: `moved["scale"] = "tileset.scale"`.
export type Moved = Record<string, string>;

/// One sentence per key of `given` that is not in `allowed`: "`scale` is not an option of a tile layer; did you mean
/// `tileset.scale`?". `what` names the thing ("a route step", "play"). With `onlyLikely`, a key is only reported when
/// there is something to suggest for it (for structures that may carry keys of the caller's own).
export function unknownKeys(given: unknown, allowed: readonly string[], what: string, moved: Moved = {}, onlyLikely = false): string[] {
  if (!given || typeof given !== "object" || Array.isArray(given)) return [];
  const out: string[] = [];
  for (const key of Object.keys(given)) {
    if (allowed.includes(key)) continue;
    const hint = moved[key] ?? nearest(key, allowed);
    if (!hint && onlyLikely) continue;
    // (a hint that is one key or path is asked as a question; one that is a phrase says where the key goes)
    const said = !hint ? ` (it has: ${allowed.join(", ")})` : /^[\w.[\]]+$/.test(hint) ? `; did you mean \`${hint}\`?` : `; use ${hint}`;
    out.push(`\`${key}\` is not an option of ${what}${said}`);
  }
  return out;
}

type Args = Record<string, any>;
const list = (v: unknown): Args[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object" && !Array.isArray(x)) : []);
const object = (v: unknown): Args | null => {
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null; // (the tool itself says what is wrong with the JSON)
    }
  }
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Args) : null;
};

/// Keys that belong somewhere else than the top level of a tool's arguments, by tool.
export const MOVED: Record<string, Moved> = {
  sprite_write: { outline: "`outline` inside a frame object ({ \"rows\": [...], \"outline\": \"k\" }): each frame has its own", mirror: "`mirror` inside a frame object", shapes: "`shapes` inside a frame object", scale: "`sx`, `sy` in the entity, or `tileset.scale` in a scene's tile layer" },
  scene_write: { objects: "scene.objects", tilemaps: "scene.tilemaps", background: "scene.background" },
  play: { steps: "route", hold_frames: "frames", scene: "start_scene", captures: "capture_at", walk_to: "`walk_to` inside a step of `route`", fight: "`fight` inside a step of `route`", until: "`until` inside a step of `route`", capture: "`capture` inside a step of `route`", hitboxes: "overlay" },
  model_preview: { model: "name", zoom: "distance", angle: "yaw", frames: "strip" },
  sfx_write: { freq: "params.freq", wave: "params.wave", volume: "params.volume" },
  sound_report: { name: "sound", names: "sounds", path: "file" },
};

// The structures the tools document, with the keys each has. These files are open (a scene may carry a game's own keys,
// and the formats grow), so a key that is not here is reported, as a warning in the tool's answer, when it is a known
// misplacement (`scale` beside `tileset`) or a near miss of a key the structure has (`tile_widht`); the call still runs.
const SCENE = ["version", "background", "width", "height", "camera", "objects", "images", "texts", "tilemaps", "sky", "fog", "look", "wind"];
const OBJECT = ["kind", "name", "x", "y", "z", "props", "layer"];
const TILEMAP = ["name", "tileset", "x", "y", "depth", "solid", "tiles", "legend", "layer", "paint", "seed", "scatter"];
const TILESET = ["image", "tile_width", "tile_height", "scale"];
const FRAME = ["rows", "name", "copy", "flip", "rotate", "recolor", "silhouette", "shapes", "mirror", "outline"];
const SHAPE = ["rect", "line", "circle", "ellipse", "color", "fill"];
const ANIMATION = ["name", "from", "to", "direction", "loop"];
const SONG = ["version", "bpm", "stepsPerBeat", "length", "tracks", "room", "master", "beatsPerBar", "markers", "buses", "tempos", "meters", "loop"];
const TRACK = ["name", "kind", "wave", "duty", "attack", "decay", "sustain", "release", "volume", "pan", "mute", "solo", "notes", "unison", "detune", "cutoff", "resonance", "sweep", "sub", "vibrato", "reverb", "echo", "kit"];
const NOTE = ["step", "len", "pitch", "vel", "pan", "bend", "cut", "room"];

/// The warnings for the nested structures of one tool call (a tileset inside a scene, a sprite frame, a song's track).
export function nestedWarnings(tool: string, args: Args): string[] {
  const out: string[] = [];
  const add = (given: unknown, allowed: readonly string[], what: string, moved: Moved = {}) => out.push(...unknownKeys(given, allowed, what, moved, true));
  if (tool === "scene_write") {
    const scene = object(args.scene);
    if (!scene) return out;
    add(scene, SCENE, "a scene", { tilemap: "tilemaps", layers: "tilemaps", entities: "objects", bg: "background", size: "`width` and `height`" });
    list(scene.objects).forEach((o, i) =>
      add(o, OBJECT, `scene object ${i}${o.name ? ` ("${o.name}")` : ""}`, { type: "kind", class: "kind", entity: "kind", properties: "props", settings: "props", ry: "props.ry", rx: "props.rx", rz: "props.rz", sx: "props.sx", sy: "props.sy", scale: "props.sx", rotation: "`props.ry` (radians)", angle: "props.angle" }),
    );
    list(scene.tilemaps).forEach((t, i) => {
      const what = `tile layer ${i}${t.name ? ` ("${t.name}")` : ""}`;
      // (the makers' short form, `"tileset": "tiles"` by name, takes `scale` beside it)
      const short = typeof t.tileset === "string";
      add(t, short ? [...TILEMAP, "scale"] : TILEMAP, what, short ? { z: "depth", rows: "tiles", data: "tiles" } : { scale: "tileset.scale", image: "tileset.image", tile_width: "tileset.tile_width", tile_height: "tileset.tile_height", tile_size: "tileset.tile_width", z: "depth", rows: "tiles", data: "tiles" });
      add(t.tileset, TILESET, `the tileset of ${what}`, { solid: "`solid` beside `tileset`, on the layer", depth: "`depth` beside `tileset`, on the layer", legend: "`legend` beside `tileset`, on the layer", tile_size: "`tile_width` and `tile_height`", width: "tile_width", height: "tile_height", sprite: "image", name: "image" });
    });
  } else if (tool === "sprite_write") {
    list(args.frames).forEach((f, i) => {
      add(f, FRAME, `sprite frame ${i}`, { palette: "`palette` beside `frames` (an option of the whole call)", size: "`size` beside `frames` (an option of the whole call)", colour: "`color` inside each of the frame's shapes", color: "`color` inside each of the frame's shapes", recolour: "recolor", flip_x: "flip", pixels: "rows" });
      list(f.shapes).forEach((s, j) => add(s, SHAPE, `shape ${j} of sprite frame ${i}`, { colour: "color", filled: "fill", box: "rect", oval: "ellipse", rectangle: "rect" }));
    });
    list(args.animations).forEach((n, i) => add(n, ANIMATION, `animation ${i}`, { start: "from", end: "to", first: "from", last: "to", frames: "`from` and `to`" }));
  } else if (tool === "song_write") {
    const song = object(args.song);
    if (!song) return out;
    add(song, SONG, "a song", { tempo: "bpm", steps: "length", steps_per_beat: "stepsPerBeat" });
    list(song.tracks).forEach((t, i) => {
      add(t, TRACK, `track ${i}${t.name ? ` ("${t.name}")` : ""}`, { type: "kind", instrument: "wave", gain: "volume" });
      list(t.notes).forEach((n, j) => add(n, NOTE, `note ${j} of track ${i}`, { length: "len", duration: "len", velocity: "vel", note: "pitch", time: "step", start: "step" }));
    });
  }
  return out.slice(0, 20);
}
