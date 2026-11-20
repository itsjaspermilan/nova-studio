// The scene tools: tile layers typed as rows of characters with a legend, and a picture of a scene file without playing the game.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { newRaster, type Raster, type Rgba } from "../src/lib/pixels";
import { parseScene, tilemaps, type Scene, type Tilemap } from "../src/lib/scene-model";
import { parseSheetJson } from "../src/lib/sprite-doc";
import { parseTileset } from "../src/lib/tileset";
import { DIM, fill, fit, INK, label, outline, PAPER, paste, readPng, textSize } from "./draw";

type Args = Record<string, any>;

const TILE_EXAMPLE =
  'A tile layer: { "name": "ground", "tileset": { "image": "sprites/tiles.png", "tile_width": 16, "tile_height": 16 }, "legend": { ".": -1, "g": 0, "W": "wall" }, "solid": ["W"], "tiles": ["WWWW", "W.gW", "WWWW"] } ' +
  "(rows top first, one character per tile; a legend value is a tile number, -1 for empty, or a tile name from sprite_write's `names`; rows of numbers are accepted too).";

function imageFile(root: string, image: string): string {
  const rel = /\.png$/i.test(image) ? image : `sprites/${image}.png`;
  return join(root, rel);
}

function tilesetNames(root: string, image: string): Record<string, number> {
  const side = imageFile(root, image).replace(/\.png$/i, ".tileset.json");
  const out: Record<string, number> = {};
  if (existsSync(side)) {
    const t = parseTileset(readFileSync(side, "utf8"));
    if (t.ok) for (const [k, v] of Object.entries(t.doc.names)) out[v] = Number(k);
  }
  return out;
}

/// Turns tile layers written with characters and a legend into the numbers the scene file holds, and checks every layer: all mistakes come back at
/// once, each with its layer, row and column. The scene given is changed in place.
export function expandTileLayers(root: string, scene: Args): void {
  if (scene.tilemaps === undefined) return;
  if (!Array.isArray(scene.tilemaps)) throw new Error(`"tilemaps" must be a list. ${TILE_EXAMPLE}`);
  const errors: string[] = [];
  scene.tilemaps.forEach((tm: Args, i: number) => {
    const where = `tilemaps[${i}]${tm?.name ? ` ("${tm.name}")` : ""}`;
    if (!tm || typeof tm !== "object") return errors.push(`${where} is not an object. ${TILE_EXAMPLE}`);
    const ts = tm.tileset;
    if (!ts || typeof ts.image !== "string" || !(ts.tile_width > 0) || !(ts.tile_height > 0)) return errors.push(`${where} needs "tileset": { "image", "tile_width", "tile_height" }. ${TILE_EXAMPLE}`);
    if (!Array.isArray(tm.tiles) || !tm.tiles.length) return errors.push(`${where} needs "tiles": a list of rows. ${TILE_EXAMPLE}`);
    const names = tilesetNames(root, ts.image);
    const file = imageFile(root, ts.image);
    let count = Infinity;
    if (existsSync(file)) {
      try {
        const img = readPng(file);
        count = Math.floor(img.w / ts.tile_width) * Math.floor(img.h / ts.tile_height);
      } catch {
        // the check will say what is wrong with the picture
      }
    }
    const known = Object.keys(names).length ? ` (the tileset's names: ${Object.keys(names).join(", ")})` : " (the tileset has no names: give them with sprite_write's `names`)";
    const tileOf = (v: unknown, what: string): number | null => {
      if (typeof v === "number" && Number.isInteger(v) && v >= -1) return v;
      if (typeof v === "string" && /^-?\d+$/.test(v)) return Number(v);
      if (typeof v === "string" && v in names) return names[v]!;
      errors.push(`${where} ${what}: ${JSON.stringify(v)} is not a tile number (-1 is empty) or a tile name${known}`);
      return null;
    };
    const legend: Record<string, number> = { ".": -1, " ": -1 };
    if (tm.legend !== undefined) {
      if (!tm.legend || typeof tm.legend !== "object" || Array.isArray(tm.legend)) errors.push(`${where}: "legend" maps one character to a tile, like { ".": -1, "g": 0, "W": "wall" }`);
      else {
        for (const [ch, v] of Object.entries(tm.legend)) {
          if ([...ch].length !== 1) errors.push(`${where} legend: "${ch}" must be one character`);
          const t = tileOf(v, `legend "${ch}"`);
          if (t !== null) legend[ch] = t;
        }
      }
    }
    const rows: number[][] = [];
    let width = -1;
    tm.tiles.forEach((row: unknown, r: number) => {
      let out: number[] = [];
      if (typeof row === "string") {
        [...row].forEach((ch, c) => {
          if (ch in legend) out.push(legend[ch]!);
          else {
            errors.push(`${where} row ${r} column ${c}: '${ch}' is not in the legend (${Object.keys(legend).filter((k) => k !== " ").join(" ")})`);
            out.push(-1);
          }
        });
      } else if (Array.isArray(row)) {
        out = row.map((v, c) => tileOf(v, `row ${r} column ${c}`) ?? -1);
      } else errors.push(`${where} row ${r} is ${JSON.stringify(row)}: a row is a string of legend characters or a list of tile numbers`);
      if (width < 0) width = out.length;
      else if (out.length !== width) errors.push(`${where} row ${r} has ${out.length} tiles, wanted ${width} (the length of row 0)${typeof row === "string" ? `: "${row}"` : ""}`);
      out.forEach((t, c) => {
        if (t >= count) errors.push(`${where} row ${r} column ${c}: tile ${t} is outside the tileset (${ts.image} has ${count} tiles, 0 to ${count - 1})`);
      });
      rows.push(out);
    });
    tm.tiles = rows;
    if (Array.isArray(tm.solid)) {
      tm.solid = tm.solid
        .map((s: unknown) => (typeof s === "string" && [...s].length === 1 && s in legend && !/^\d$/.test(s) ? legend[s]! : tileOf(s, "solid")))
        .filter((t: number | null) => t !== null && t >= 0);
    }
    delete tm.legend;
  });
  if (errors.length) {
    const shown = errors.slice(0, 24);
    throw new Error(`${shown.join("\n")}${errors.length > shown.length ? `\n... and ${errors.length - shown.length} more` : ""}`);
  }
}

interface KindLook {
  sheet?: Raster;
  fw: number;
  fh: number;
  px: number;
  py: number;
  hitbox?: number[];
  sprite?: string;
  frame?: number;
  sx?: number;
  sy?: number;
}

/// What an entity kind looks like, as far as its file says without running it: `sprite = "name"`, `pivot = { a, b }` and a box `hitbox = { x, y, w, h }`.
function lookOf(root: string, kind: string, cache: Map<string, KindLook>): KindLook {
  const hit = cache.get(kind);
  if (hit) return hit;
  const look: KindLook = { fw: 0, fh: 0, px: 0.5, py: 0.5 };
  const file = join(root, "entities", `${kind.replace(/\./g, "/")}.lua`);
  if (existsSync(file)) {
    const src = readFileSync(file, "utf8");
    const sprite = /\bsprite\s*=\s*"([^"]+)"/.exec(src)?.[1];
    const pivot = /\bpivot\s*=\s*\{\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\}/.exec(src);
    const box = /\bhitbox\s*=\s*\{\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\}/.exec(src);
    if (pivot) [look.px, look.py] = [Number(pivot[1]), Number(pivot[2])];
    if (box) look.hitbox = box.slice(1, 5).map(Number);
    const frame = /\bframe\s*=\s*(\d+)/.exec(src);
    if (frame) look.frame = Number(frame[1]);
    const sx = /\bsx\s*=\s*(-?[\d.]+)/.exec(src), sy = /\bsy\s*=\s*(-?[\d.]+)/.exec(src);
    if (sx) look.sx = Number(sx[1]);
    if (sy) look.sy = Number(sy[1]);
    if (sprite) {
      look.sprite = sprite;
      const png = imageFile(root, sprite);
      if (existsSync(png)) {
        try {
          look.sheet = readPng(png);
          look.fw = look.sheet.w;
          look.fh = look.sheet.h;
          const side = png.replace(/\.png$/i, ".sprite.json");
          if (existsSync(side)) {
            const p = parseSheetJson(readFileSync(side, "utf8"));
            if (p.ok) [look.fw, look.fh] = [p.json.frame_width, p.json.frame_height];
          }
        } catch {
          look.sheet = undefined;
        }
      }
    }
  }
  cache.set(kind, look);
  return look;
}

const niceStep = (min: number): number => {
  for (const s of [1, 2, 4, 5, 8, 10, 16, 20, 25, 32, 40, 50, 64, 80, 100, 128, 160, 200, 250, 320, 400, 500, 640, 800, 1000, 2000, 5000]) if (s >= min) return s;
  return 10000;
};

/// A 2D room that is smaller than the screen, in words (nothing for a 3D scene, a scene with no room of its own, or a
/// room that fills the screen). The room is the scene's `width` and `height` and its tile layers.
export function roomWarning(scene: Scene): string | null {
  const maps = tilemaps(scene);
  if (scene.camera && !maps.length) return null;
  let w = typeof scene.width === "number" ? scene.width : 0, h = typeof scene.height === "number" ? scene.height : 0;
  let tile = 0;
  for (const m of maps) {
    const s = m.tileset.scale ?? 1;
    const cols = Math.max(0, ...m.tiles.map((r) => r.length));
    w = Math.max(w, (m.x ?? 0) + cols * m.tileset.tile_width * s);
    h = Math.max(h, (m.y ?? 0) + m.tiles.length * m.tileset.tile_height * s);
    tile = Math.max(tile, m.tileset.tile_width * s);
  }
  if (!w || !h || (w >= 960 && h >= 540)) return null;
  const need = tile ? ` (${Math.ceil(960 / tile)} x ${Math.ceil(540 / tile)} tiles of ${tile} units fill it)` : "";
  return `the room is ${w} x ${h} units, smaller than the screen (960 x 540): it is drawn in the middle with the scene's background colour around it. That suits a small interior; to fill the screen make it at least 960 x 540${need}, or give the tile layer a bigger "scale".`;
}

/// `scene_preview`: draws a scene file as a map. Returns the picture and a description in words.
export function previewScene(root: string, name: string, opts: { grid?: boolean; labels?: boolean; zoom?: number; area?: number[] } = {}): { text: string; picture: Raster | null } {
  const short = name.replace(/^scenes\//, "").replace(/\.scene\.json$/, "");
  const file = join(root, `scenes/${short.replace(/\./g, "/")}.scene.json`);
  if (!existsSync(file)) throw new Error(`there is no scenes/${short}.scene.json`);
  const parsed = parseScene(readFileSync(file, "utf8"));
  if (!parsed.ok) throw new Error(`scenes/${short}.scene.json: ${parsed.error}`);
  return drawScene(root, short, parsed.scene, opts);
}

export function drawScene(root: string, short: string, scene: Scene, opts: { grid?: boolean; labels?: boolean; zoom?: number; area?: number[] } = {}): { text: string; picture: Raster | null } {
  const maps = tilemaps(scene);
  const objects = (scene.objects ?? []) as Args[];
  const images = (scene.images ?? []) as Args[];
  const texts = (scene.texts ?? []) as Args[];
  const lines: string[] = [];
  // (the screen is always 540 units high, 960 wide at 16:9; nova.json's world_height is only how many pixels the world is drawn with)
  const worldHeight = 540;
  const viewW = Math.round((worldHeight * 16) / 9);
  if (scene.camera && !maps.length) {
    lines.push(`scenes/${short}.scene.json is a 3D scene (it has a "camera"): ${objects.length} objects. A map picture is for 2D scenes; use the play tool to look at it.`);
    const kinds = new Map<string, number>();
    for (const o of objects) kinds.set(String(o.kind), (kinds.get(String(o.kind)) ?? 0) + 1);
    lines.push(`kinds: ${[...kinds].map(([k, n]) => `${k} x${n}`).join(", ")}`);
    return { text: lines.join("\n"), picture: null };
  }

  // the world's box: the scene's size, every tile layer and everything placed
  const cache = new Map<string, KindLook>();
  let x0 = 0, y0 = 0, x1 = typeof scene.width === "number" ? scene.width : 0, y1 = typeof scene.height === "number" ? scene.height : 0;
  const grow = (ax: number, ay: number, bx: number, by: number) => {
    x0 = Math.min(x0, ax);
    y0 = Math.min(y0, ay);
    x1 = Math.max(x1, bx);
    y1 = Math.max(y1, by);
  };
  const mapInfo = maps.map((m) => {
    const s = m.tileset.scale ?? 1;
    const tw = m.tileset.tile_width * s, th = m.tileset.tile_height * s;
    const cols = Math.max(0, ...m.tiles.map((r) => r.length)), rows = m.tiles.length;
    grow(m.x ?? 0, m.y ?? 0, (m.x ?? 0) + cols * tw, (m.y ?? 0) + rows * th);
    return { m, tw, th, cols, rows, s };
  });
  const boxOf = (o: Args) => {
    const look = lookOf(root, String(o.kind), cache);
    const sx = Math.abs(Number(o.props?.sx ?? look.sx ?? 1)), sy = Math.abs(Number(o.props?.sy ?? look.sy ?? 1));
    const w = (look.sheet ? look.fw : (mapInfo[0]?.tw ?? 32)) * sx, h = (look.sheet ? look.fh : (mapInfo[0]?.th ?? 32)) * sy;
    const px = look.sheet ? look.px : 0.5, py = look.sheet ? look.py : 0.5;
    return { look, x: o.x - w * px, y: o.y - h * py, w, h, sx, sy };
  };
  for (const o of objects) {
    const b = boxOf(o);
    grow(b.x, b.y, b.x + b.w, b.y + b.h);
  }
  if (x1 <= x0 || y1 <= y0) grow(0, 0, viewW, worldHeight);
  if (opts.area?.length === 4) [x0, y0, x1, y1] = [opts.area[0]!, opts.area[1]!, opts.area[0]! + opts.area[2]!, opts.area[1]! + opts.area[3]!];
  const ww = x1 - x0, wh = y1 - y0;
  const zoom = opts.zoom ?? (ww <= 1600 ? Math.max(1, Math.min(6, Math.floor(1600 / ww), Math.floor(1100 / wh) || 1)) : 1600 / ww);
  const left = 40, top = 22;
  const out = newRaster(left + Math.ceil(ww * zoom) + 8, top + Math.ceil(wh * zoom) + 8);
  fill(out, 0, 0, out.w, out.h, PAPER);
  const bg = Array.isArray(scene.background) ? scene.background : [20, 22, 28];
  const X = (wx: number) => left + (wx - x0) * zoom, Y = (wy: number) => top + (wy - y0) * zoom;
  fill(out, left, top, Math.ceil(ww * zoom), Math.ceil(wh * zoom), [bg[0] ?? 0, bg[1] ?? 0, bg[2] ?? 0, 255]);
  const clip = { x: left, y: top, w: Math.ceil(ww * zoom), h: Math.ceil(wh * zoom) };
  // (drawing happens on a canvas of the map's own size, then goes into the picture, so nothing spills over the rulers)
  const canvas = newRaster(clip.w, clip.h);
  fill(canvas, 0, 0, clip.w, clip.h, [bg[0] ?? 0, bg[1] ?? 0, bg[2] ?? 0, 255]);
  const CX = (wx: number) => (wx - x0) * zoom, CY = (wy: number) => (wy - y0) * zoom;

  // tile layers, the furthest back first
  const order = [...mapInfo].sort((a, b) => (b.m.depth ?? 0) - (a.m.depth ?? 0));
  lines.push(`scenes/${short}.scene.json: world ${ww} x ${wh} units from (${x0}, ${y0}); the view is ${viewW} x ${worldHeight}; picture at x${Math.round(zoom * 100) / 100}`);
  const small = roomWarning(scene);
  if (small) lines.push(`warning: ${small}`);
  for (const { m, tw, th, cols, rows, s } of order) {
    const file = imageFile(root, m.tileset.image);
    let sheet: Raster | null = null;
    try {
      if (existsSync(file)) sheet = readPng(file);
    } catch {
      sheet = null;
    }
    const perRow = sheet ? Math.max(1, Math.floor(sheet.w / m.tileset.tile_width)) : 1;
    const solid = new Set(m.solid ?? []);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < (m.tiles[r]?.length ?? 0); c++) {
        const t = m.tiles[r]![c]!;
        if (t < 0) continue;
        const dx = CX((m.x ?? 0) + c * tw), dy = CY((m.y ?? 0) + r * th);
        if (sheet) paste(canvas, sheet, dx, dy, s * zoom, { x: (t % perRow) * m.tileset.tile_width, y: Math.floor(t / perRow) * m.tileset.tile_height, w: m.tileset.tile_width, h: m.tileset.tile_height });
        else {
          fill(canvas, dx, dy, tw * zoom, th * zoom, [60 + ((t * 53) % 120), 60 + ((t * 97) % 120), 60 + ((t * 31) % 120), 255]);
          if (tw * zoom >= 14) label(canvas, dx + 1, dy + 1, String(t), INK, 1);
        }
        if (solid.has(t) && opts.grid !== false) outline(canvas, dx, dy, Math.ceil(tw * zoom), Math.ceil(th * zoom), [255, 80, 80, 110]);
      }
    }
    // the layer as text, so that it can be read (and written back) without the picture
    const names = tilesetNames(root, m.tileset.image);
    const nameOf = new Map(Object.entries(names).map(([k, v]) => [v, k]));
    const used = [...new Set(m.tiles.flat())].filter((t) => t >= 0).sort((a, b) => a - b);
    const pool = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#@%&*+=?";
    const charOf = new Map<number, string>([[-1, "."]]);
    const taken = new Set<string>(".");
    for (const t of used) {
      const n = nameOf.get(t);
      const want = n ? [n[0]!.toUpperCase(), n[0]!.toLowerCase()] : [];
      const ch = [...want, ...pool].find((ch) => !taken.has(ch));
      if (ch) {
        charOf.set(t, ch);
        taken.add(ch);
      }
    }
    lines.push(`tile layer${m.name ? ` "${m.name}"` : ""}: ${cols} x ${rows} tiles of ${tw} x ${th} at (${m.x ?? 0}, ${m.y ?? 0}), depth ${m.depth ?? 0}, tileset ${m.tileset.image}${sheet ? "" : " (PICTURE MISSING: drawn as numbered blocks)"}${solid.size ? `, solid tiles ${[...solid].join(" ")} (outlined red)` : ""}`);
    if (used.length <= pool.length && cols <= 200 && rows <= 120) {
      lines.push(`  legend: . empty, ${used.map((t) => `${charOf.get(t)} ${t}${nameOf.has(t) ? ` ${nameOf.get(t)}` : ""}${solid.has(t) ? " (solid)" : ""}`).join(", ")}`);
      m.tiles.forEach((row, r) => lines.push(`  ${String(r).padStart(3)} ${row.map((t) => charOf.get(t) ?? "?").join("")}`));
    }
  }

  // world pictures, then objects (the furthest back first; the same depth in file order)
  for (const im of images.filter((i) => i.layer !== "ui")) {
    const file = join(root, String(im.image));
    if (!existsSync(file)) continue;
    try {
      const pic = readPng(file);
      const s = Number(im.scale ?? 1);
      paste(canvas, pic, CX(im.x - (pic.w * s) / 2), CY(im.y - (pic.h * s) / 2), s * zoom);
    } catch {
      // a picture that cannot be read is left out
    }
  }
  const placed = objects.map((o, i) => ({ o, i, b: boxOf(o) }));
  const text = zoom >= 3 ? 2 : 1;
  const marks: { x: number; y: number; text: string; colour: Rgba }[] = [];
  for (const { o, i, b } of [...placed].sort((p, q) => Number(q.o.props?.depth ?? 0) - Number(p.o.props?.depth ?? 0) || p.i - q.i)) {
    const dx = CX(b.x), dy = CY(b.y), dw = Math.max(2, b.w * zoom), dh = Math.max(2, b.h * zoom);
    if (b.look.sheet) {
      const frame = Number(o.props?.frame ?? b.look.frame ?? 0);
      const perRow = Math.max(1, Math.floor(b.look.sheet.w / b.look.fw));
      paste(canvas, b.look.sheet, dx, dy, b.sx * zoom, { x: (frame % perRow) * b.look.fw, y: Math.floor(frame / perRow) * b.look.fh, w: b.look.fw, h: b.look.fh }, Number(o.props?.sx ?? b.look.sx ?? 1) < 0 || o.props?.flip_x === true);
      if (opts.grid !== false) outline(canvas, dx, dy, Math.ceil(dw), Math.ceil(dh), [255, 255, 255, 70]);
    } else {
      fill(canvas, dx, dy, dw, dh, [255, 170, 40, 70]);
      outline(canvas, dx, dy, Math.ceil(dw), Math.ceil(dh), [255, 170, 40, 255]);
      line2(canvas, dx, dy, dx + dw - 1, dy + dh - 1, [255, 170, 40, 160]);
    }
    if (b.look.hitbox && opts.grid !== false) {
      const [hx, hy, hw, hh] = b.look.hitbox as [number, number, number, number];
      outline(canvas, CX(o.x + hx * b.sx), CY(o.y + hy * b.sy), Math.ceil(hw * b.sx * zoom), Math.ceil(hh * b.sy * zoom), [80, 255, 120, 200]);
    }
    // the position itself: a small cross
    fill(canvas, CX(o.x) - 2, CY(o.y), 5, 1, [255, 60, 200, 255]);
    fill(canvas, CX(o.x), CY(o.y) - 2, 1, 5, [255, 60, 200, 255]);
    const title = o.name ? `${o.name}:${o.kind}` : String(o.kind);
    marks.push({ x: dx, y: dy - 9 * text, text: title, colour: b.look.sheet ? INK : [255, 200, 110, 255] });
  }
  for (const t of texts) {
    const s = Math.max(1, Math.round((Number(t.scale ?? 2) * 8 * zoom) / 9));
    label(canvas, CX(t.x), CY(t.y), String(t.text ?? ""), [150, 220, 255, 255], Math.min(4, s));
  }
  // the view's size, for scale (a dashed box from the world's corner)
  if (opts.grid !== false && (ww > viewW || wh > worldHeight)) {
    for (let i = 0; i < viewW * zoom; i += 8) {
      fill(canvas, i, Math.min(clip.h - 1, worldHeight * zoom - 1), 4, 1, [255, 255, 255, 150]);
    }
    for (let i = 0; i < worldHeight * zoom; i += 8) fill(canvas, Math.min(clip.w - 1, viewW * zoom - 1), i, 1, 4, [255, 255, 255, 150]);
  }
  // the grid: tile lines when there are tiles, else every 32 units
  const cell = mapInfo[0] ? { w: mapInfo[0].tw, h: mapInfo[0].th, x: mapInfo[0].m.x ?? 0, y: mapInfo[0].m.y ?? 0 } : { w: 32, h: 32, x: 0, y: 0 };
  if (opts.grid !== false && cell.w * zoom >= 6) {
    for (let gx = cell.x + Math.ceil((x0 - cell.x) / cell.w) * cell.w; gx <= x1; gx += cell.w) fill(canvas, CX(gx), 0, 1, clip.h, [255, 255, 255, 26]);
    for (let gy = cell.y + Math.ceil((y0 - cell.y) / cell.h) * cell.h; gy <= y1; gy += cell.h) fill(canvas, 0, CY(gy), clip.w, 1, [255, 255, 255, 26]);
  }
  if (opts.labels !== false) {
    // labels last, nudged down when two would sit on each other
    const used: { x: number; y: number; w: number; h: number }[] = [];
    for (const m of marks) {
      const size = textSize(m.text, text);
      let y = Math.max(0, m.y);
      const x = Math.max(0, Math.min(clip.w - size.w, m.x));
      for (let tries = 0; tries < 6 && used.some((u) => x < u.x + u.w && u.x < x + size.w && y < u.y + u.h && u.y < y + size.h); tries++) y += size.h + 2;
      used.push({ x, y, w: size.w, h: size.h });
      label(canvas, x, y, m.text, m.colour, text);
    }
  }
  paste(out, canvas, left, top, 1);
  outline(out, left - 1, top - 1, clip.w + 2, clip.h + 2, [90, 96, 110, 255]);
  // rulers: world coordinates along the top and the left
  const stepX = niceStep(Math.max(cell.w, 46 / zoom)), stepY = niceStep(Math.max(cell.h, 14 / zoom));
  const sx = cell.w > 1 && stepX % cell.w !== 0 ? Math.ceil(stepX / cell.w) * cell.w : stepX;
  const sy = cell.h > 1 && stepY % cell.h !== 0 ? Math.ceil(stepY / cell.h) * cell.h : stepY;
  for (let gx = Math.ceil(x0 / sx) * sx; gx <= x1; gx += sx) {
    fill(out, X(gx), top - 4, 1, 4, DIM);
    label(out, X(gx) + 2, 4, String(gx), DIM, 1, false);
  }
  for (let gy = Math.ceil(y0 / sy) * sy; gy <= y1; gy += sy) {
    fill(out, left - 4, Y(gy), 4, 1, DIM);
    label(out, 2, Y(gy) + 2, fit(String(gy), left - 4), DIM, 1, false);
  }

  if (objects.length) {
    lines.push(`objects (${objects.length}): name:kind at x, y${placed.some((p) => !p.b.look.sheet) ? " (kinds without a sprite are orange boxes one tile big)" : ""}`);
    for (const { o, b } of placed.slice(0, 200)) {
      const cellText = mapInfo[0] ? ` (tile ${Math.floor((o.x - cell.x) / cell.w)}, ${Math.floor((o.y - cell.y) / cell.h)})` : "";
      const props = o.props && Object.keys(o.props).length ? ` ${JSON.stringify(o.props)}` : "";
      lines.push(`  ${o.name ? `${o.name}:` : ""}${o.kind} at ${o.x}, ${o.y}${cellText}${b.look.sprite ? "" : existsSync(join(root, "entities", `${String(o.kind).replace(/\./g, "/")}.lua`)) ? " [no sprite]" : " [NO entities/" + o.kind + ".lua]"}${props}`);
    }
    if (placed.length > 200) lines.push(`  ... and ${placed.length - 200} more`);
  }
  if (images.length) lines.push(`pictures (${images.length}): ${images.map((i) => `${i.image} at ${i.x}, ${i.y}${i.layer === "ui" ? " (ui, not drawn here)" : ""}`).join("; ")}`);
  if (texts.length) lines.push(`texts (${texts.length}, on the screen, not in the world): ${texts.map((t) => `"${t.text}" at ${t.x}, ${t.y}`).join("; ")}`);
  lines.push("in the picture: rulers are world units; pink cross = an object's x, y; white outline = its sprite; green = its hitbox; red = solid tiles; dashed = one screen");
  return { text: lines.join("\n"), picture: out };
}

function line2(r: Raster, x0: number, y0: number, x1: number, y1: number, c: Rgba) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= n; i++) fill(r, Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), 1, 1, c);
}

export type { Tilemap };
