// The sprite tools: a sheet drawn with text (whole, or a few frames at a time), and a magnified picture of any sheet.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { encodePng } from "../src/lib/png-encode";
import { newRaster, type Raster, type Rgba } from "../src/lib/pixels";
import { parseSheetJson, SHEET_COLUMNS, tagSequence, type SheetJson, type Tag } from "../src/lib/sprite-doc";
import { parseTileset, serializeTileset, newTileset } from "../src/lib/tileset";
import { tileFor, type Terrain } from "../src/lib/autotile";
import { checker, DIM, fill, fit, INK, label, outline, PAPER, paste, readPng } from "./draw";

type Args = Record<string, any>;
type Put = (rel: string, data: string | Uint8Array) => void;

const ENVELOPE =
  'frames is a list of frames; a frame is a list of rows, every row a string, one character per pixel (a row that is short is filled with transparent on the right). A tiny example: ' +
  '{ "name": "dot", "palette": { "r": "#ff0000", "w": "#ffffff" }, "frames": [ [".rr.", "rwwr", "rwwr", ".rr."], [".rr.", "rrrr", "rrrr", ".rr."] ], "animations": [ { "name": "blink", "from": 0, "to": 1 } ] }';

const short = (s: string) => (s.length > 40 ? `${s.slice(0, 37)}...` : s);

function hexColour(text: unknown): Rgba | null {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(String(text ?? ""));
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, m[2] ? parseInt(m[2], 16) : 255];
}

/// The frames of a sheet as separate pictures, cut the way the game cuts them.
function cut(sheet: Raster, json: SheetJson): Raster[] {
  const fw = json.frame_width, fh = json.frame_height;
  const fitCols = Math.max(1, Math.floor(sheet.w / fw));
  const columns = Math.max(1, Math.min(json.columns ?? fitCols, fitCols));
  const count = Math.min(json.frames ?? columns * Math.floor(sheet.h / fh), columns * Math.floor(sheet.h / fh));
  const out: Raster[] = [];
  for (let f = 0; f < count; f++) {
    const r = newRaster(fw, fh);
    const ox = (f % columns) * fw, oy = Math.floor(f / columns) * fh;
    for (let y = 0; y < fh; y++) r.data.set(sheet.data.subarray(((oy + y) * sheet.w + ox) * 4, ((oy + y) * sheet.w + ox + fw) * 4), y * fw * 4);
    out.push(r);
  }
  return out;
}

function transform(src: Raster, spec: Args, where: string, errors: string[]): Raster {
  let r = src;
  const map = (fn: (x: number, y: number, w: number, h: number) => [number, number], w = r.w, h = r.h) => {
    const out = newRaster(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const [sx, sy] = fn(x, y, w, h);
        out.data.set(r.data.subarray((sy * r.w + sx) * 4, (sy * r.w + sx) * 4 + 4), (y * w + x) * 4);
      }
    }
    r = out;
  };
  const flip = spec.flip === true ? "x" : String(spec.flip ?? "");
  if (spec.flip_x || flip.includes("x")) map((x, y, w) => [w - 1 - x, y]);
  if (spec.flip_y || flip.includes("y")) map((x, y, _w, h) => [x, h - 1 - y]);
  const turn = ((Number(spec.rotate ?? 0) % 360) + 360) % 360;
  if (turn % 90 !== 0) errors.push(`${where}: "rotate" is 90, 180 or 270 (clockwise), got ${spec.rotate}`);
  else if (turn && turn !== 180 && r.w !== r.h) errors.push(`${where}: a frame that is not square (${r.w}x${r.h}) can only be rotated by 180`);
  else if (turn === 90) map((x, y, _w, h) => [y, h - 1 - x]);
  else if (turn === 180) map((x, y, w, h) => [w - 1 - x, h - 1 - y]);
  else if (turn === 270) map((x, y, w) => [w - 1 - y, x]);
  if (spec.recolor ?? spec.recolour) {
    const pairs: [Rgba, Rgba][] = [];
    for (const [from, to] of Object.entries((spec.recolor ?? spec.recolour) as Record<string, string>)) {
      const a = hexColour(from), b = hexColour(to);
      if (!a || !b) errors.push(`${where}: "recolor" maps one "#rrggbb" to another, got ${JSON.stringify(from)}: ${JSON.stringify(to)}`);
      else pairs.push([a, b]);
    }
    const out = newRaster(r.w, r.h);
    out.data.set(r.data);
    for (let i = 0; i < out.data.length; i += 4) {
      if (!out.data[i + 3]) continue;
      const hit = pairs.find(([a]) => a[0] === out.data[i] && a[1] === out.data[i + 1] && a[2] === out.data[i + 2]);
      if (hit) out.data.set([hit[1][0], hit[1][1], hit[1][2], hit[1][3] === 255 ? out.data[i + 3]! : hit[1][3]], i);
    }
    r = out;
  }
  if (spec.silhouette !== undefined && spec.silhouette !== false) {
    // every drawn pixel in one colour: a white copy of a frame to show for a moment when it is hit
    const c = hexColour(spec.silhouette === true ? "#ffffff" : spec.silhouette);
    if (!c) errors.push(`${where}: "silhouette" is a colour ("#ffffff") or true for white, got ${JSON.stringify(spec.silhouette)}`);
    else {
      const out = newRaster(r.w, r.h);
      out.data.set(r.data);
      for (let i = 0; i < out.data.length; i += 4) if (out.data[i + 3]) out.data.set([c[0], c[1], c[2]], i);
      r = out;
    }
  }
  return r;
}

// ---- shapes, mirroring and outlines inside a frame ---------------------------------------------------------------
// A frame may be { rows?, shapes?, mirror?, outline?, name? }: the rows are drawn first, then the shapes in order, then the
// left half is mirrored onto the right (`mirror: "x"`; "y" the top onto the bottom), then every see-through pixel beside a
// drawn one gets the outline colour. Colours are palette characters ("." erases) or "#rrggbb".

const FRAME_KEYS = ["rows", "name", "copy", "flip", "flip_x", "flip_y", "rotate", "recolor", "recolour", "silhouette", "shapes", "mirror", "outline"];
const SHAPE_HELP =
  'a list of { "rect": [x, y, w, h] }, { "line": [x0, y0, x1, y1] }, { "circle": [cx, cy, r] } or { "ellipse": [cx, cy, rx, ry] }, each with "color": a palette character or "#rrggbb" ("." erases) and, for all but the line, "fill": false for the edge only';

interface Shape {
  kind: "rect" | "line" | "circle" | "ellipse";
  at: number[];
  color: unknown;
  fill: boolean;
}
interface Draw {
  shapes: Shape[];
  mirror: string;
  outline?: unknown;
}

function drawOf(o: Args, where: string, errors: string[]): Draw {
  const shapes: Shape[] = [];
  if (o.shapes !== undefined && !Array.isArray(o.shapes)) errors.push(`${where}: "shapes" is ${SHAPE_HELP}`);
  for (const [n, s] of (Array.isArray(o.shapes) ? o.shapes : []).entries()) {
    const kinds = (["rect", "line", "circle", "ellipse"] as const).filter((k) => s && typeof s === "object" && s[k] !== undefined);
    const need = { rect: 4, line: 4, circle: 3, ellipse: 4 };
    const kind = kinds[0];
    if (kinds.length !== 1 || !kind) {
      errors.push(`${where} shape ${n} is ${short(JSON.stringify(s))}: a shape is one of ${SHAPE_HELP}`);
      continue;
    }
    const at = s[kind];
    if (!Array.isArray(at) || at.length !== need[kind] || !at.every((v: unknown) => typeof v === "number" && Number.isFinite(v))) {
      errors.push(`${where} shape ${n}: "${kind}" takes ${need[kind]} numbers (${{ rect: "x, y, w, h", line: "x0, y0, x1, y1", circle: "cx, cy, r", ellipse: "cx, cy, rx, ry" }[kind]}), got ${short(JSON.stringify(at))}`);
      continue;
    }
    if (s.color === undefined && s.colour === undefined) {
      errors.push(`${where} shape ${n}: give its "color" (a palette character, or "#rrggbb")`);
      continue;
    }
    shapes.push({ kind, at, color: s.color ?? s.colour, fill: s.fill !== false });
  }
  const mirror = o.mirror === true ? "x" : String(o.mirror ?? "");
  if (o.mirror !== undefined && !/^(x|y|xy|yx)$/.test(mirror)) errors.push(`${where}: "mirror" is "x" (the left half onto the right), "y" (the top half onto the bottom) or "xy", got ${JSON.stringify(o.mirror)}`);
  return { shapes, mirror: /^(x|y|xy|yx)$/.test(mirror) ? mirror : "", outline: o.outline };
}

/// The value that comes up most often (the bigger one when two tie); 0 for an empty list.
function commonest(values: number[]): number {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = 0, bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount || (c === bestCount && v > best)) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

function applyDraw(r: Raster, d: Draw, colourOf: (c: unknown) => Rgba | "clear" | null, where: string, errors: string[]) {
  const set = (x: number, y: number, c: Rgba | "clear") => {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= r.w || y >= r.h) return;
    r.data.set(c === "clear" ? [0, 0, 0, 0] : c, (y * r.w + x) * 4);
  };
  const colour = (given: unknown, what: string): Rgba | "clear" | null => {
    const c = colourOf(given);
    if (!c) errors.push(`${where} ${what}: ${JSON.stringify(given)} is not a palette character nor "#rrggbb"`);
    return c;
  };
  d.shapes.forEach((s, n) => {
    const c = colour(s.color, `shape ${n}`);
    if (!c) return;
    const [p, q, u, v] = s.at as [number, number, number, number];
    if (s.kind === "rect") {
      for (let y = q; y < q + v; y++) for (let x = p; x < p + u; x++) if (s.fill || x === p || y === q || x === p + u - 1 || y === q + v - 1) set(x, y, c);
    } else if (s.kind === "line") {
      const steps = Math.max(Math.abs(u - p), Math.abs(v - q), 1);
      for (let i = 0; i <= steps; i++) set(p + ((u - p) * i) / steps, q + ((v - q) * i) / steps, c);
    } else {
      // a circle or an ellipse about (cx, cy), where a whole number is the middle of a pixel (so [4, 4, 2] is five pixels
      // across) and a half is the line between two ([3.5, 3.5, 2] is four across); the edge is the pixels that are in and
      // have a neighbour that is not
      const rx = u, ry = s.kind === "circle" ? u : v;
      const round = (centre: number) => 0.5 - Math.abs(centre - Math.round(centre));
      const inside = (x: number, y: number) => ((x - p) / (rx + round(p))) ** 2 + ((y - q) / (ry + round(q))) ** 2 <= 1;
      for (let y = Math.floor(q - ry); y <= Math.ceil(q + ry); y++) {
        for (let x = Math.floor(p - rx); x <= Math.ceil(p + rx); x++) {
          if (!inside(x, y)) continue;
          if (s.fill || !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) set(x, y, c);
        }
      }
    }
  });
  const copy = (fx: number, fy: number, tx: number, ty: number) => r.data.copyWithin((ty * r.w + tx) * 4, (fy * r.w + fx) * 4, (fy * r.w + fx) * 4 + 4);
  if (d.mirror.includes("x")) for (let y = 0; y < r.h; y++) for (let x = 0; x < Math.floor(r.w / 2); x++) copy(x, y, r.w - 1 - x, y);
  if (d.mirror.includes("y")) for (let y = 0; y < Math.floor(r.h / 2); y++) for (let x = 0; x < r.w; x++) copy(x, y, x, r.h - 1 - y);
  if (d.outline !== undefined && d.outline !== false) {
    const c = colour(d.outline, "outline");
    if (c && c !== "clear") {
      const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < r.w && y < r.h && r.data[(y * r.w + x) * 4 + 3]! > 0;
      const edge: [number, number][] = [];
      for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) if (!solid(x, y) && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) edge.push([x, y]);
      for (const [x, y] of edge) set(x, y, c);
    }
  }
}

/// `sprite_write`: see the tool's description in server.ts.
export function writeSprite(root: string, name: string, a: Args, put: Put): { text: string; picture: Raster } {
  const pngPath = join(root, `sprites/${name}.png`), jsonPath = join(root, `sprites/${name}.sprite.json`), setPath = join(root, `sprites/${name}.tileset.json`);
  if (!Array.isArray(a.frames) || !a.frames.length) throw new Error(`frames needs at least one frame. ${ENVELOPE}`);
  if (a.palette !== undefined && (typeof a.palette !== "object" || !a.palette || Array.isArray(a.palette))) throw new Error(`palette maps one character to a colour. ${ENVELOPE}`);
  const palette: Record<string, string> = a.palette ?? {};
  const adding = a.append === true || a.at !== undefined;

  // what is there already (when frames are added to it or copied from it)
  let old: Raster[] = [];
  let oldJson: SheetJson | null = null;
  if (existsSync(pngPath) && existsSync(jsonPath)) {
    const parsed = parseSheetJson(readFileSync(jsonPath, "utf8"));
    if (parsed.ok) {
      oldJson = parsed.json;
      old = cut(readPng(pngPath), parsed.json);
    }
  }
  if (adding && !oldJson) throw new Error(`there is no sprites/${name}.sprite.json to add frames to: write the first frames without "append" or "at"`);
  const names: Record<string, string> = {};
  let solid: number[] = [];
  let terrains: Terrain[] = [];
  if (adding && existsSync(setPath)) {
    const t = parseTileset(readFileSync(setPath, "utf8"));
    if (t.ok) {
      Object.assign(names, t.doc.names);
      solid = t.doc.solid;
      terrains = t.doc.terrains; // (a made tileset's terrains stay when tiles are added or redrawn)
    }
  }

  const errors: string[] = [];
  const first = adding ? (a.at !== undefined ? Number(a.at) : old.length) : 0;
  if (!Number.isInteger(first) || first < 0 || first > old.length) throw new Error(`"at" is the frame number to write from, 0 to ${old.length} (the sheet has ${old.length} frames; ${old.length} adds to the end)`);
  const result: Raster[] = adding ? [...old] : [];
  const given: { rows?: string[]; spec?: Args; name?: string; draw?: Draw }[] = [];
  a.frames.forEach((frame: unknown, i: number) => {
    const where = `frame ${first + i}`;
    if (typeof frame === "string") given.push({ rows: frame.split("\n") });
    else if (Array.isArray(frame)) {
      if (frame.some((row) => typeof row !== "string")) errors.push(`${where}: every row must be a string of characters (got ${short(JSON.stringify(frame.find((row) => typeof row !== "string")))})`);
      given.push({ rows: frame.map(String) });
    } else if (frame && typeof frame === "object") {
      const o = frame as Args;
      const unknown = Object.keys(o).filter((k) => !FRAME_KEYS.includes(k));
      if (unknown.length) errors.push(`${where} has "${unknown.join('", "')}", which a frame does not have (it has ${FRAME_KEYS.join(", ")})`);
      const draw = drawOf(o, where, errors);
      if (o.rows !== undefined) given.push({ rows: Array.isArray(o.rows) ? o.rows.map(String) : String(o.rows).split("\n"), name: o.name, draw });
      else if (o.copy !== undefined) given.push({ spec: o, name: o.name, draw });
      else if (draw.shapes.length) given.push({ name: o.name, draw });
      else {
        errors.push(`${where}: a frame given as an object needs "rows" (a list of strings), "shapes" (${SHAPE_HELP}) or "copy" (a frame number or name to copy, with "flip": "x"|"y", "rotate": 90|180|270, "recolor": { "#from": "#to" })`);
        given.push({});
      }
    } else {
      errors.push(`${where} is ${JSON.stringify(frame)}, not a list of rows`);
      given.push({});
    }
  });
  if (errors.length) throw new Error(`${errors.join("\n")}\n${ENVELOPE}`);

  // The frame size: the sheet's when adding, else `size`, else the commonest among the frames drawn (so one short row or
  // one frame a row short is named as the odd one out, whichever frame it is). A frame that is mirrored may give only
  // its left (or top) half, so it is counted only when no whole frame says the size.
  let fw = oldJson && adding ? oldJson.frame_width : 0, fh = oldJson && adding ? oldJson.frame_height : 0;
  if (a.size !== undefined) {
    const s = Array.isArray(a.size) ? a.size.map(Number) : [];
    if (s.length !== 2 || !s.every((v: number) => Number.isInteger(v) && v >= 1 && v <= 512)) throw new Error(`"size" is the frame size [width, height] in pixels, like [16, 16] (got ${JSON.stringify(a.size)})`);
    if (fw && (s[0] !== fw || s[1] !== fh)) throw new Error(`"size" is [${s.join(", ")}] but the sheet's frames are ${fw}x${fh}: frames added to a sheet have its size`);
    [fw, fh] = s as [number, number];
  }
  if (!fw) {
    const whole = given.filter((g) => g.rows);
    const widths = whole.filter((g) => !g.draw?.mirror.includes("x")).flatMap((g) => g.rows!.map((r) => [...r].length));
    const heights = whole.filter((g) => !g.draw?.mirror.includes("y")).map((g) => g.rows!.length);
    const halfW = whole.filter((g) => g.draw?.mirror.includes("x")).flatMap((g) => g.rows!.map((r) => [...r].length));
    const halfH = whole.filter((g) => g.draw?.mirror.includes("y")).map((g) => g.rows!.length);
    fw = commonest(widths) || commonest(halfW) * 2;
    fh = commonest(heights) || commonest(halfH) * 2;
    if ((!fw || !fh) && oldJson) {
      fw = oldJson.frame_width;
      fh = oldJson.frame_height;
    }
  }
  if (!fw || !fh) throw new Error(`the frame size is not known: give rows of at least one character, or "size": [width, height] for frames made only of shapes. ${ENVELOPE}`);

  const byName = (n: string): number => {
    const hit = Object.entries(names).find(([, v]) => v === n);
    return hit ? Number(hit[0]) : -1;
  };
  const colourOf = (ch: unknown): Rgba | "clear" | null => {
    if (ch === "." || ch === " ") return "clear";
    return hexColour(typeof ch === "string" && ch.startsWith("#") ? ch : palette[String(ch)]);
  };
  const padded: string[] = [];
  given.forEach((g, i) => {
    const index = first + i;
    const where = `frame ${index}${g.name ? ` ("${g.name}")` : ""}`;
    let picture: Raster | null = null;
    if (g.rows) {
      const rows = g.rows;
      const halfRows = g.draw?.mirror.includes("y") && rows.length <= Math.ceil(fh / 2);
      const halfCols = g.draw?.mirror.includes("x");
      if (rows.length !== fh && !halfRows) errors.push(`${where} has ${rows.length} rows, wanted ${fh}${a.size || (oldJson && adding) ? "" : " (the commonest among the frames given; frames are numbered from 0)"}`);
      picture = newRaster(fw, fh);
      const short: number[] = [];
      rows.forEach((row, y) => {
        const chars = [...row];
        if (chars.length > fw) errors.push(`${where} row ${y} has ${chars.length} characters, wanted ${fw}: "${row}"`);
        else if (chars.length < fw && !(halfCols && chars.length <= Math.ceil(fw / 2))) short.push(y);
        chars.forEach((ch, x) => {
          if (ch === "." || ch === " ") return;
          const c = hexColour(palette[ch]);
          if (!c) errors.push(`${where} row ${y} column ${x}: '${ch}' is not in the palette${palette[ch] !== undefined ? ` as a colour (it is ${JSON.stringify(palette[ch])}; use "#rrggbb" or "#rrggbbaa")` : ""}`);
          else if (x < fw && y < fh) picture!.data.set(c, (y * fw + x) * 4);
        });
      });
      if (short.length) padded.push(`frame ${index} row${short.length > 1 ? "s" : ""} ${short.join(", ")}`);
    } else if (g.spec) {
      const from = typeof g.spec.copy === "string" && !/^\d+$/.test(g.spec.copy) ? byName(g.spec.copy) : Number(g.spec.copy);
      const src = from >= 0 && from < result.length ? result[from] : undefined;
      if (!src) errors.push(`${where}: "copy": ${JSON.stringify(g.spec.copy)} is not a frame that exists yet (frames 0 to ${result.length - 1}${Object.keys(names).length ? `, or a name: ${Object.values(names).join(", ")}` : ""})`);
      else picture = transform(src, g.spec, where, errors);
    } else if (g.draw) picture = newRaster(fw, fh);
    if (picture && g.draw) applyDraw(picture, g.draw, colourOf, where, errors);
    if (picture) result[index] = picture;
    else if (!result[index]) result[index] = newRaster(fw, fh);
    if (g.name !== undefined) names[index] = String(g.name);
  });
  // too many palette complaints are one mistake repeated: keep the list readable
  if (errors.length) {
    const shown = errors.slice(0, 24);
    throw new Error(`${shown.join("\n")}${errors.length > shown.length ? `\n... and ${errors.length - shown.length} more` : ""}`);
  }
  if (Array.isArray(a.names)) a.names.forEach((n: unknown, i: number) => n && (names[first + i] = String(n)));
  else if (a.names && typeof a.names === "object") for (const [k, v] of Object.entries(a.names)) names[k] = String(v);
  for (const k of Object.keys(names)) if (Number(k) >= result.length) delete names[k];
  if (Array.isArray(a.solid)) {
    solid = a.solid.map((s: unknown) => (typeof s === "string" && !/^\d+$/.test(s) ? byName(s) : Number(s)));
    const bad = a.solid.filter((_: unknown, i: number) => !(solid[i]! >= 0 && solid[i]! < result.length));
    if (bad.length) throw new Error(`"solid" names frames that do not exist: ${bad.join(", ")}`);
  }

  const columns = Math.min(result.length, SHEET_COLUMNS);
  const sheet = newRaster(columns * fw, Math.ceil(result.length / columns) * fh);
  result.forEach((f, i) => {
    const ox = (i % columns) * fw, oy = Math.floor(i / columns) * fh;
    for (let y = 0; y < fh; y++) sheet.data.set(f.data.subarray(y * fw * 4, (y + 1) * fw * 4), ((oy + y) * sheet.w + ox) * 4);
  });
  const keep = adding && oldJson ? oldJson : null;
  const tags = a.animations?.length ? a.animations : keep?.tags;
  const json: SheetJson = {
    ...(keep ?? {}),
    version: 1,
    image: `${name}.png`,
    frame_width: fw,
    frame_height: fh,
    columns,
    frames: result.length,
    frame_duration_ms: a.frame_ms ?? keep?.frame_duration_ms ?? 100,
    ...(tags?.length ? { tags } : {}),
  };
  if (keep?.durations_ms && keep.durations_ms.length !== result.length) delete json.durations_ms;
  for (const t of json.tags ?? []) {
    if (typeof t?.name !== "string" || !Number.isInteger(t.from) || !Number.isInteger(t.to) || t.from < 0 || t.to < t.from || t.to >= result.length) {
      throw new Error(`animation ${JSON.stringify(t)} is not valid: it needs "name", and "from" and "to" frame numbers inside 0 to ${result.length - 1} (for example { "name": "walk", "from": 0, "to": 3 })`);
    }
  }
  const text = `${JSON.stringify(json, null, 2)}\n`;
  const ok = parseSheetJson(text);
  if (!ok.ok) throw new Error(ok.error);
  put(`sprites/${name}.png`, encodePng(sheet));
  put(`sprites/${name}.sprite.json`, text);
  if (Object.keys(names).length || solid.length || existsSync(setPath)) {
    put(`sprites/${name}.tileset.json`, serializeTileset({ ...newTileset(fw, fh), names, solid: [...new Set(solid)].sort((x, y) => x - y), terrains }));
  }
  const named = namesText(names, terrains).replace(/^; /, "\n");
  const filled = padded.length ? `\nshort rows were filled with transparent on the right, up to ${fw} wide: ${padded.slice(0, 12).join("; ")}${padded.length > 12 ? `; and ${padded.length - 12} more frames` : ""}` : "";
  return {
    text: `sprites/${name}.png: ${result.length} frame(s) of ${fw}x${fh}${adding ? ` (frames ${first} to ${first + given.length - 1} written)` : ""}${result.length > 1 ? `; the sheet is ${columns} across (16 at most), so frame n (and tile n of a tilemap) is at column n % ${columns}, row floor(n / ${columns})` : ""}${named}${filled}`,
    picture: spritePicture(sheet, json, names, terrains),
  };
}

/// The names of a sheet's frames in words; a terrain's joining tiles are given as one range.
export function namesText(names: Record<string, string>, terrains: Terrain[] = []): string {
  const inTerrain = new Set(terrains.flatMap((t) => t.tiles));
  const plain = Object.entries(names).filter(([k]) => !inTerrain.has(Number(k)));
  const parts: string[] = [];
  if (plain.length) parts.push(`names: ${plain.map(([k, v]) => `${k} ${v}`).join(", ")}`);
  if (terrains.length) parts.push(`terrains: ${terrains.map((t) => `${t.name} (tiles ${Math.min(...t.tiles.filter((x) => x >= 0))}-${Math.max(...t.tiles)})`).join(", ")}`);
  return parts.length ? `; ${parts.join("; ")}` : "";
}

/// The picture `sprite_write` and `sprite_preview` return: every frame enlarged on a checker background, outlined, with its number (and name) under it,
/// and one strip per animation with its frames in the order they play and how long each shows.
export function spritePicture(sheet: Raster, json: SheetJson, names: Record<string, string> = {}, terrains: Terrain[] = []): Raster {
  const frames = cut(sheet, json);
  const fw = json.frame_width, fh = json.frame_height;
  const tags = json.tags ?? [];
  // A terrain's 16 or 47 joining tiles are shown as one painted sample instead of one by one (the grid keeps the rest,
  // each under its own tile number).
  const inTerrain = new Set(terrains.flatMap((t) => t.tiles));
  const shown = frames.map((_, f) => f).filter((f) => !inTerrain.has(f));
  if (!shown.length) shown.push(...frames.map((_, f) => f));
  const perRow = Math.min(shown.length, fw <= 24 ? 16 : 8);
  const longestStrip = Math.max(0, ...tags.map((t) => tagSequence({ ...t, direction: t.direction ?? "forward", loop: t.loop ?? true }).length));
  const across = Math.max(perRow, Math.min(longestStrip, 16));
  const scale = Math.max(1, Math.min(12, Math.floor(1400 / (across * (fw + 2))), Math.floor(480 / fh) || 1));
  const cw = fw * scale + 2, chh = fh * scale + 2;
  const hasNames = Object.keys(names).length > 0;
  const textScale = cw >= 60 ? 2 : 1;
  const cap = (hasNames ? 2 : 1) * (9 * textScale) + 4;
  const gap = 6;
  const cellW = Math.max(cw, 6 * textScale * 3) + gap;
  const sheetRows = Math.ceil(shown.length / perRow);
  const stripH = 9 * textScale + 4 + chh + 9 * textScale + 6;
  const width = gap + Math.max(perRow, Math.min(longestStrip, 16)) * cellW;
  const SAMPLE = ["......", ".XXX..", "XXXXX.", "XX.XXX", "XXXXXX", ".XX.X.", "......"];
  const sampleScale = Math.max(1, Math.min(scale, 3));
  const sampleW = SAMPLE[0]!.length * fw * sampleScale + gap * 2, sampleH = SAMPLE.length * fh * sampleScale + 9 * 2 + 10;
  const samplesPerRow = Math.max(1, Math.floor(Math.max(width, 260) / sampleW));
  const sampleRows = Math.ceil(terrains.length / samplesPerRow);
  const height = gap + 9 * textScale + 4 + sheetRows * (chh + cap + gap) + tags.length * (stripH + gap) + (terrains.length ? 9 * 2 + 6 + sampleRows * sampleH : 0);
  const out = newRaster(Math.max(width, 260), height);
  fill(out, 0, 0, out.w, out.h, PAPER);
  label(out, gap, gap, fit(`${json.image ?? "sheet"}: ${frames.length} frames of ${fw}x${fh}, x${scale}`, out.w - gap * 2, textScale), INK, textScale, false);
  const drawFrame = (f: number, x: number, y: number) => {
    checker(out, x + 1, y + 1, fw * scale, fh * scale, Math.max(4, scale));
    if (frames[f]) paste(out, frames[f]!, x + 1, y + 1, scale);
    outline(out, x, y, cw, chh, [240, 200, 60, 255]);
  };
  let y = gap + 9 * textScale + 4;
  shown.forEach((f, i) => {
    const x = gap + (i % perRow) * cellW, fy = y + Math.floor(i / perRow) * (chh + cap + gap);
    drawFrame(f, x, fy);
    label(out, x, fy + chh + 2, String(f), INK, textScale, false);
    if (names[f]) label(out, x, fy + chh + 2 + 9 * textScale, fit(names[f]!, cellW - 2, textScale), DIM, textScale, false);
  });
  y += sheetRows * (chh + cap + gap);
  for (const t of tags) {
    const seq = tagSequence({ ...t, direction: t.direction ?? "forward", loop: t.loop ?? true });
    const ms = (f: number) => json.durations_ms?.[f] ?? json.frame_duration_ms ?? 100;
    const total = seq.reduce((s, f) => s + ms(f), 0);
    label(out, gap, y, fit(`${t.name}: frames ${t.from}-${t.to}${t.direction && t.direction !== "forward" ? ` ${t.direction}` : ""}, ${total} ms${t.loop === false ? ", once" : ", loops"}`, out.w - gap * 2, textScale), [130, 210, 255, 255], textScale, false);
    seq.slice(0, 16).forEach((f, i) => {
      const x = gap + i * cellW;
      drawFrame(f, x, y + 9 * textScale + 4);
      label(out, x, y + 9 * textScale + 4 + chh + 2, fit(`${f} ${ms(f)}ms`, cellW - 2, textScale), DIM, textScale, false);
    });
    y += stripH + gap;
  }
  if (terrains.length) {
    label(out, gap, y, fit("terrains: scene_write paints with them (each shown as a sample; its joining tiles are not in the grid above)", out.w - gap * 2, 2), [130, 210, 255, 255], 2, false);
    y += 9 * 2 + 6;
    terrains.forEach((t, n) => {
      const sx = gap + (n % samplesPerRow) * sampleW, sy = y + Math.floor(n / samplesPerRow) * sampleH;
      const member = (c: number, r: number) => SAMPLE[r]?.[c] === "X";
      checker(out, sx, sy, SAMPLE[0]!.length * fw * sampleScale, SAMPLE.length * fh * sampleScale, 4);
      for (let r = 0; r < SAMPLE.length; r++) for (let c = 0; c < SAMPLE[0]!.length; c++) {
        if (!member(c, r)) continue;
        const tile = tileFor(t, member, c, r);
        if (frames[tile]) paste(out, frames[tile]!, sx + c * fw * sampleScale, sy + r * fh * sampleScale, sampleScale);
      }
      const used = t.tiles.filter((x) => x >= 0);
      label(out, sx, sy + SAMPLE.length * fh * sampleScale + 3, fit(`${t.name} ${Math.min(...used)}-${Math.max(...used)}`, sampleW - gap, 2), INK, 2, false);
    });
  }
  return out;
}

/// One frame of a sheet, big: every pixel a square with a grid between, the columns numbered along the top and the rows
/// down the left (from 0, as `sprite_write` counts them), so a pixel can be named and fixed. The text gives the frame back
/// as rows of characters with a palette, ready to edit and give to `sprite_write` with `at`.
export function frameCloseUp(sheet: Raster, json: SheetJson, f: number, zoom?: number): { picture: Raster; rows: string[]; palette: Record<string, string>; zoom: number } {
  const frames = cut(sheet, json);
  const frame = frames[f];
  if (!frame) throw new Error(`there is no frame ${f}: the sheet has frames 0 to ${frames.length - 1}`);
  const fw = frame.w, fh = frame.h;
  const z = Math.max(2, Math.min(48, Math.round(zoom ?? Math.floor(640 / Math.max(fw, fh)))));
  const left = 22, top = 14, pad = 6;
  const out = newRaster(left + fw * z + pad, top + fh * z + pad);
  fill(out, 0, 0, out.w, out.h, PAPER);
  checker(out, left, top, fw * z, fh * z, Math.max(2, Math.floor(z / 2)));
  paste(out, frame, left, top, z);
  if (z >= 6) {
    for (let x = 0; x <= fw; x++) fill(out, left + x * z, top, 1, fh * z, [0, 0, 0, x % 8 === 0 ? 150 : 60]);
    for (let y = 0; y <= fh; y++) fill(out, left, top + y * z, fw * z, 1, [0, 0, 0, y % 8 === 0 ? 150 : 60]);
  }
  const every = z >= 14 ? 1 : z >= 7 ? 2 : 4;
  for (let x = 0; x < fw; x += every) label(out, left + x * z + Math.max(0, Math.floor((z - String(x).length * 6) / 2)), 3, String(x), x % 8 === 0 ? INK : DIM, 1, false);
  for (let y = 0; y < fh; y += every) label(out, 2, top + y * z + Math.max(0, Math.floor((z - 8) / 2)), String(y), y % 8 === 0 ? INK : DIM, 1, false);
  outline(out, left - 1, top - 1, fw * z + 2, fh * z + 2, [240, 200, 60, 255]);
  // the frame as text: a letter per colour, by first appearance
  const letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const palette: Record<string, string> = {};
  const letterOf = new Map<string, string>();
  const rows: string[] = [];
  for (let y = 0; y < fh; y++) {
    let row = "";
    for (let x = 0; x < fw; x++) {
      const o = (y * fw + x) * 4;
      const [r, g, b, al] = [frame.data[o]!, frame.data[o + 1]!, frame.data[o + 2]!, frame.data[o + 3]!];
      if (!al) {
        row += ".";
        continue;
      }
      const hex = `#${[r, g, b, ...(al === 255 ? [] : [al])].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
      let ch = letterOf.get(hex);
      if (!ch) {
        ch = letters[letterOf.size] ?? "?";
        letterOf.set(hex, ch);
        if (ch !== "?") palette[ch] = hex;
      }
      row += ch;
    }
    rows.push(row);
  }
  return { picture: out, rows, palette, zoom: z };
}

/// `sprite_preview`: the picture of a sprite of the project (a `.sprite.json` sheet, or a plain PNG).
export function previewSprite(root: string, name: string, opts: { frame?: unknown; zoom?: unknown } = {}): { text: string; picture: Raster } {
  const base = name.replace(/^sprites\//, "").replace(/\.(png|sprite\.json)$/i, "");
  const pngPath = join(root, `sprites/${base}.png`), jsonPath = join(root, `sprites/${base}.sprite.json`), setPath = join(root, `sprites/${base}.tileset.json`);
  let json: SheetJson | null = null;
  if (existsSync(jsonPath)) {
    const p = parseSheetJson(readFileSync(jsonPath, "utf8"));
    if (!p.ok) throw new Error(`sprites/${base}.sprite.json: ${p.error}`);
    json = p.json;
  }
  const image = json?.image ? join(root, "sprites", json.image) : pngPath;
  if (!existsSync(image)) throw new Error(`there is no sprites/${base}.png`);
  const sheet = readPng(image);
  let names: Record<string, string> = {};
  let terrains: Terrain[] = [];
  let tile: { w: number; h: number } | null = null;
  if (existsSync(setPath)) {
    const t = parseTileset(readFileSync(setPath, "utf8"));
    if (t.ok) {
      names = t.doc.names;
      terrains = t.doc.terrains;
      tile = { w: t.doc.tile_width, h: t.doc.tile_height };
    }
  }
  json ??= { frame_width: tile?.w ?? sheet.w, frame_height: tile?.h ?? sheet.h, image: `${base}.png` };
  const columns = Math.max(1, Math.min(json.columns ?? 9999, Math.floor(sheet.w / json.frame_width)));
  const count = Math.min(json.frames ?? 9999, columns * Math.floor(sheet.h / json.frame_height));
  const tags = (json.tags ?? []).map((t) => `${t.name} ${t.from}-${t.to}`).join(", ");
  if (opts.frame !== undefined && opts.frame !== null) {
    const byName = Object.entries(names).find(([, v]) => v === opts.frame);
    const f = byName ? Number(byName[0]) : Number(opts.frame);
    if (!Number.isInteger(f) || f < 0 || f >= count) throw new Error(`"frame" is a frame number from 0 to ${count - 1}${Object.keys(names).length ? `, or a name (${Object.values(names).join(", ")})` : ""}, got ${JSON.stringify(opts.frame)}`);
    const close = frameCloseUp(sheet, { ...json, columns, frames: count }, f, opts.zoom === undefined ? undefined : Number(opts.zoom));
    const uses = (json.tags ?? []).filter((t) => f >= t.from && f <= t.to).map((t) => t.name);
    return {
      text:
        `sprites/${base}.png frame ${f}${names[f] ? ` ("${names[f]}")` : ""} of ${count}: ${json.frame_width}x${json.frame_height} pixels, enlarged x${close.zoom}${uses.length ? `; in the animation${uses.length > 1 ? "s" : ""} ${uses.join(", ")}` : ""}\n` +
        `columns are numbered along the top and rows down the left, from 0, as sprite_write's messages count them; the checks are see-through\n` +
        `as text, to edit and give back with sprite_write { "name": "${base}", "at": ${f}, "palette": ..., "frames": [rows] }:\n` +
        `palette: ${JSON.stringify(close.palette)}\n${close.rows.map((r) => `  "${r}"`).join(",\n")}`,
      picture: close.picture,
    };
  }
  return {
    text: `sprites/${base}.png: ${sheet.w}x${sheet.h} pixels, ${count} frame(s) of ${json.frame_width}x${json.frame_height}, ${columns} across${tags ? `; animations: ${tags}` : "; no animations"}${namesText(names, terrains)}`,
    picture: spritePicture(sheet, { ...json, columns, frames: count }, names, terrains),
  };
}
