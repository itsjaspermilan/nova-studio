// The sprite tools: a sheet drawn with text (whole, or a few frames at a time), and a magnified picture of any sheet.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { encodePng } from "../src/lib/png-encode";
import { newRaster, type Raster, type Rgba } from "../src/lib/pixels";
import { parseSheetJson, SHEET_COLUMNS, tagSequence, type SheetJson, type Tag } from "../src/lib/sprite-doc";
import { parseTileset, serializeTileset, newTileset } from "../src/lib/tileset";
import { checker, DIM, fill, fit, INK, label, outline, PAPER, paste, readPng } from "./draw";

type Args = Record<string, any>;
type Put = (rel: string, data: string | Uint8Array) => void;

const ENVELOPE =
  'frames is a list of frames; a frame is a list of rows, every row a string of the same length, one character per pixel. A tiny example: ' +
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
  return r;
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
  if (adding && existsSync(setPath)) {
    const t = parseTileset(readFileSync(setPath, "utf8"));
    if (t.ok) {
      Object.assign(names, t.doc.names);
      solid = t.doc.solid;
    }
  }

  const errors: string[] = [];
  const first = adding ? (a.at !== undefined ? Number(a.at) : old.length) : 0;
  if (!Number.isInteger(first) || first < 0 || first > old.length) throw new Error(`"at" is the frame number to write from, 0 to ${old.length} (the sheet has ${old.length} frames; ${old.length} adds to the end)`);
  const result: Raster[] = adding ? [...old] : [];
  const given: { rows?: string[]; spec?: Args; name?: string }[] = [];
  a.frames.forEach((frame: unknown, i: number) => {
    const where = `frame ${first + i}`;
    if (typeof frame === "string") given.push({ rows: frame.split("\n") });
    else if (Array.isArray(frame)) {
      if (frame.some((row) => typeof row !== "string")) errors.push(`${where}: every row must be a string of characters (got ${short(JSON.stringify(frame.find((row) => typeof row !== "string")))})`);
      given.push({ rows: frame.map(String) });
    } else if (frame && typeof frame === "object") {
      const o = frame as Args;
      if (o.rows !== undefined) given.push({ rows: Array.isArray(o.rows) ? o.rows.map(String) : String(o.rows).split("\n"), name: o.name });
      else if (o.copy !== undefined) given.push({ spec: o, name: o.name });
      else {
        errors.push(`${where}: a frame given as an object needs "rows" (a list of strings) or "copy" (a frame number or name to copy, with "flip": "x"|"y", "rotate": 90|180|270, "recolor": { "#from": "#to" })`);
        given.push({});
      }
    } else {
      errors.push(`${where} is ${JSON.stringify(frame)}, not a list of rows`);
      given.push({});
    }
  });
  if (errors.length) throw new Error(`${errors.join("\n")}\n${ENVELOPE}`);

  // the frame size: the sheet's when adding, else the first drawn frame's
  let fw = oldJson && adding ? oldJson.frame_width : 0, fh = oldJson && adding ? oldJson.frame_height : 0;
  if (!fw) {
    const drawn = given.find((g) => g.rows);
    if (drawn) {
      fh = drawn.rows!.length;
      fw = [...(drawn.rows![0] ?? "")].length;
    } else if (oldJson) {
      fw = oldJson.frame_width;
      fh = oldJson.frame_height;
    }
  }
  if (!fw || !fh) throw new Error(`a frame needs rows of at least one character. ${ENVELOPE}`);

  const byName = (n: string): number => {
    const hit = Object.entries(names).find(([, v]) => v === n);
    return hit ? Number(hit[0]) : -1;
  };
  given.forEach((g, i) => {
    const index = first + i;
    const where = `frame ${index}${g.name ? ` ("${g.name}")` : ""}`;
    let picture: Raster | null = null;
    if (g.rows) {
      const rows = g.rows;
      if (rows.length !== fh) errors.push(`${where} has ${rows.length} rows, wanted ${fh}`);
      picture = newRaster(fw, fh);
      rows.forEach((row, y) => {
        const chars = [...row];
        if (chars.length !== fw) errors.push(`${where} row ${y} has ${chars.length} characters, wanted ${fw}: "${row}"`);
        chars.forEach((ch, x) => {
          if (ch === "." || ch === " ") return;
          const c = hexColour(palette[ch]);
          if (!c) errors.push(`${where} row ${y} column ${x}: '${ch}' is not in the palette${palette[ch] !== undefined ? ` as a colour (it is ${JSON.stringify(palette[ch])}; use "#rrggbb" or "#rrggbbaa")` : ""}`);
          else if (x < fw && y < fh) picture!.data.set(c, (y * fw + x) * 4);
        });
      });
    } else if (g.spec) {
      const from = typeof g.spec.copy === "string" && !/^\d+$/.test(g.spec.copy) ? byName(g.spec.copy) : Number(g.spec.copy);
      const src = from >= 0 && from < result.length ? result[from] : !adding && from >= 0 && from < old.length && from >= first + i ? undefined : undefined;
      if (!src) errors.push(`${where}: "copy": ${JSON.stringify(g.spec.copy)} is not a frame that exists yet (frames 0 to ${result.length - 1}${Object.keys(names).length ? `, or a name: ${Object.values(names).join(", ")}` : ""})`);
      else picture = transform(src, g.spec, where, errors);
    }
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
    put(`sprites/${name}.tileset.json`, serializeTileset({ ...newTileset(fw, fh), names, solid: [...new Set(solid)].sort((x, y) => x - y) }));
  }
  const named = Object.keys(names).length ? `\nnames: ${Object.entries(names).map(([k, v]) => `${k} ${v}`).join(", ")}` : "";
  return {
    text: `sprites/${name}.png: ${result.length} frame(s) of ${fw}x${fh}${adding ? ` (frames ${first} to ${first + given.length - 1} written)` : ""}; the sheet is ${columns} across, so frame n (and tile n of a tilemap) is at column n % ${columns}, row floor(n / ${columns})${named}`,
    picture: spritePicture(sheet, json, names),
  };
}

/// The picture `sprite_write` and `sprite_preview` return: every frame enlarged on a checker background, outlined, with its number (and name) under it,
/// and one strip per animation with its frames in the order they play and how long each shows.
export function spritePicture(sheet: Raster, json: SheetJson, names: Record<string, string> = {}): Raster {
  const frames = cut(sheet, json);
  const fw = json.frame_width, fh = json.frame_height;
  const tags = (json.tags ?? []) as Tag[];
  const perRow = Math.min(frames.length, fw <= 24 ? 16 : 8);
  const longestStrip = Math.max(0, ...tags.map((t) => tagSequence({ direction: "forward", loop: true, ...t }).length));
  const across = Math.max(perRow, Math.min(longestStrip, 16));
  const scale = Math.max(1, Math.min(12, Math.floor(1400 / (across * (fw + 2))), Math.floor(480 / fh) || 1));
  const cw = fw * scale + 2, chh = fh * scale + 2;
  const hasNames = Object.keys(names).length > 0;
  const textScale = cw >= 60 ? 2 : 1;
  const cap = (hasNames ? 2 : 1) * (9 * textScale) + 4;
  const gap = 6;
  const cellW = Math.max(cw, 6 * textScale * 3) + gap;
  const sheetRows = Math.ceil(frames.length / perRow);
  const stripH = 9 * textScale + 4 + chh + 9 * textScale + 6;
  const width = gap + Math.max(perRow, Math.min(longestStrip, 16)) * cellW;
  const height = gap + 9 * textScale + 4 + sheetRows * (chh + cap + gap) + tags.length * (stripH + gap);
  const out = newRaster(Math.max(width, 260), height);
  fill(out, 0, 0, out.w, out.h, PAPER);
  label(out, gap, gap, fit(`${json.image ?? "sheet"}: ${frames.length} frames of ${fw}x${fh}, x${scale}`, out.w - gap * 2, textScale), INK, textScale, false);
  const drawFrame = (f: number, x: number, y: number) => {
    checker(out, x + 1, y + 1, fw * scale, fh * scale, Math.max(4, scale));
    if (frames[f]) paste(out, frames[f]!, x + 1, y + 1, scale);
    outline(out, x, y, cw, chh, [240, 200, 60, 255]);
  };
  let y = gap + 9 * textScale + 4;
  frames.forEach((_, f) => {
    const x = gap + (f % perRow) * cellW, fy = y + Math.floor(f / perRow) * (chh + cap + gap);
    drawFrame(f, x, fy);
    label(out, x, fy + chh + 2, String(f), INK, textScale, false);
    if (names[f]) label(out, x, fy + chh + 2 + 9 * textScale, fit(names[f]!, cellW - 2, textScale), DIM, textScale, false);
  });
  y += sheetRows * (chh + cap + gap);
  for (const t of tags) {
    const seq = tagSequence({ direction: "forward", loop: true, ...t });
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
  return out;
}

/// `sprite_preview`: the picture of a sprite of the project (a `.sprite.json` sheet, or a plain PNG).
export function previewSprite(root: string, name: string): { text: string; picture: Raster } {
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
  let tile: { w: number; h: number } | null = null;
  if (existsSync(setPath)) {
    const t = parseTileset(readFileSync(setPath, "utf8"));
    if (t.ok) {
      names = t.doc.names;
      tile = { w: t.doc.tile_width, h: t.doc.tile_height };
    }
  }
  json ??= { frame_width: tile?.w ?? sheet.w, frame_height: tile?.h ?? sheet.h, image: `${base}.png` };
  const columns = Math.max(1, Math.min(json.columns ?? 9999, Math.floor(sheet.w / json.frame_width)));
  const count = Math.min(json.frames ?? 9999, columns * Math.floor(sheet.h / json.frame_height));
  const tags = (json.tags ?? []).map((t) => `${t.name} ${t.from}-${t.to}`).join(", ");
  return {
    text: `sprites/${base}.png: ${sheet.w}x${sheet.h} pixels, ${count} frame(s) of ${json.frame_width}x${json.frame_height}, ${columns} across${tags ? `; animations: ${tags}` : "; no animations"}${Object.keys(names).length ? `; names: ${Object.entries(names).map(([k, v]) => `${k} ${v}`).join(", ")}` : ""}`,
    picture: spritePicture(sheet, { ...json, columns, frames: count }, names),
  };
}
