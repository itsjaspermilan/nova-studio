// A tileset's studio-side description, kept beside its picture: `tiles.png` and `tiles.tileset.json`. The picture is what the game draws; this file
// holds what the studio knows about it: names for tiles, which are solid (a new tile map starts with them as its solid list), and the terrains that
// paint with auto-tiling (lib/autotile.ts). The game never reads it; the scene files carry the tile numbers and the solid list.

import { layoutTiles, tileCountOf, type Terrain, type TerrainMode } from "./autotile";
import type { Raster } from "./pixels";

export interface TilesetDoc {
  version: 1;
  tile_width: number;
  tile_height: number;
  /// Tile numbers that block movement.
  solid: number[];
  /// Tiles that mirror what stands above them (puddles, water): a painted layer carries the ones it uses as its `reflect` list (2D
  /// reflections, `nova.reflections`). Left out when there are none.
  reflect?: number[];
  /// Names for tiles that have one, by tile number.
  names: Record<string, string>;
  terrains: Terrain[];
}

export const MAX_TILE = 1024;

export function newTileset(tileW: number, tileH: number): TilesetDoc {
  return { version: 1, tile_width: tileW, tile_height: tileH, solid: [], names: {}, terrains: [] };
}

/// How many tiles a picture holds (whole tiles only), and how many of them are in a row.
export function gridOf(imageW: number, imageH: number, tileW: number, tileH: number): { columns: number; rows: number; count: number } {
  const columns = Math.max(0, Math.floor(imageW / Math.max(1, tileW)));
  const rows = Math.max(0, Math.floor(imageH / Math.max(1, tileH)));
  return { columns, rows, count: columns * rows };
}

export type ParsedTileset = { ok: true; doc: TilesetDoc } | { ok: false; error: string };

export function parseTileset(text: string): ParsedTileset {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `not valid JSON: ${e instanceof Error ? e.message : e}` };
  }
  const o = v as Partial<TilesetDoc>;
  if (!o || typeof o !== "object") return { ok: false, error: "a tileset file is an object" };
  const size = (n: unknown) => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 1024;
  if (!size(o.tile_width) || !size(o.tile_height)) return { ok: false, error: '"tile_width" and "tile_height" must be whole numbers from 1 to 1024' };
  const tile = (n: unknown) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n < MAX_TILE;
  if (o.solid !== undefined && (!Array.isArray(o.solid) || !o.solid.every(tile))) return { ok: false, error: '"solid" is a list of tile numbers' };
  if (o.reflect !== undefined && (!Array.isArray(o.reflect) || !o.reflect.every(tile))) return { ok: false, error: '"reflect" is a list of tile numbers' };
  const names: Record<string, string> = {};
  if (o.names !== undefined) {
    if (!o.names || typeof o.names !== "object" || Array.isArray(o.names)) return { ok: false, error: '"names" maps tile numbers to names' };
    for (const [k, n] of Object.entries(o.names)) {
      if (!/^\d+$/.test(k) || typeof n !== "string") return { ok: false, error: `"names" has a bad entry: ${k}` };
      if (n.trim()) names[k] = n.trim();
    }
  }
  const terrains: Terrain[] = [];
  for (const [i, raw] of (Array.isArray(o.terrains) ? o.terrains : []).entries()) {
    const t = raw as Partial<Terrain>;
    if (!t || typeof t.name !== "string" || !t.name.trim()) return { ok: false, error: `terrains[${i}] needs a name` };
    if (t.mode !== "edges" && t.mode !== "blob") return { ok: false, error: `terrains[${i}].mode must be "edges" or "blob"` };
    if (!Array.isArray(t.tiles) || t.tiles.length !== tileCountOf(t.mode) || !t.tiles.every((n) => n === -1 || tile(n))) return { ok: false, error: `terrains[${i}].tiles must be ${tileCountOf(t.mode)} tile numbers (-1 for none)` };
    terrains.push({ name: t.name.trim(), mode: t.mode, tiles: [...t.tiles] });
  }
  const reflect = [...new Set(o.reflect ?? [])].sort((a, b) => a - b);
  return { ok: true, doc: { version: 1, tile_width: o.tile_width!, tile_height: o.tile_height!, solid: [...new Set(o.solid ?? [])].sort((a, b) => a - b), ...(reflect.length ? { reflect } : {}), names, terrains } };
}

export function serializeTileset(doc: TilesetDoc): string {
  const names = Object.entries(doc.names).sort((a, b) => Number(a[0]) - Number(b[0]));
  const terrains = doc.terrains.map((t) => `    { "name": ${JSON.stringify(t.name)}, "mode": "${t.mode}", "tiles": [${t.tiles.join(", ")}] }`);
  return [
    "{",
    '  "version": 1,',
    `  "tile_width": ${doc.tile_width},`,
    `  "tile_height": ${doc.tile_height},`,
    `  "solid": [${doc.solid.join(", ")}],`,
    ...(doc.reflect?.length ? [`  "reflect": [${doc.reflect.join(", ")}],`] : []),
    `  "names": {${names.length ? `\n${names.map(([k, n]) => `    "${k}": ${JSON.stringify(n)}`).join(",\n")}\n  ` : ""}},`,
    `  "terrains": [${terrains.length ? `\n${terrains.join(",\n")}\n  ` : ""}]`,
    "}",
    "",
  ].join("\n");
}

const unique = (n: number[]) => [...new Set(n)].sort((a, b) => a - b);

export function toggleSolidTile(doc: TilesetDoc, tile: number): TilesetDoc {
  const set = new Set(doc.solid);
  if (!set.delete(tile)) set.add(tile);
  return { ...doc, solid: unique([...set]) };
}

export function setTileName(doc: TilesetDoc, tile: number, name: string): TilesetDoc {
  const names = { ...doc.names };
  if (name.trim()) names[String(tile)] = name.trim();
  else delete names[String(tile)];
  return { ...doc, names };
}

/// Adds a terrain whose tiles are laid out in the tileset from `first` (see `layoutTiles`); the name gets a number if it is taken.
export function addTerrain(doc: TilesetDoc, name: string, mode: TerrainMode, first: number, columns: number, perRow = mode === "edges" ? 4 : 8): TilesetDoc {
  let unique_ = name.trim() || "terrain";
  for (let n = 2; doc.terrains.some((t) => t.name === unique_); n++) unique_ = `${name.trim() || "terrain"} ${n}`;
  return { ...doc, terrains: [...doc.terrains, { name: unique_, mode, tiles: layoutTiles(mode, first, perRow, columns) }] };
}

export function removeTerrain(doc: TilesetDoc, index: number): TilesetDoc {
  return { ...doc, terrains: doc.terrains.filter((_, i) => i !== index) };
}

/// Puts a tile into one slot of a terrain (-1 to leave the slot empty).
export function setTerrainSlot(doc: TilesetDoc, index: number, slot: number, tile: number): TilesetDoc {
  const t = doc.terrains[index];
  if (!t || slot < 0 || slot >= t.tiles.length) return doc;
  const tiles = [...t.tiles];
  tiles[slot] = tile;
  return { ...doc, terrains: doc.terrains.map((x, i) => (i === index ? { ...x, tiles } : x)) };
}

/// Groups of tiles that look exactly the same (so one can be dropped), as lists of tile numbers; tiles that are empty are not listed.
export function duplicateTiles(picture: Raster, tileW: number, tileH: number): number[][] {
  const { columns, count } = gridOf(picture.w, picture.h, tileW, tileH);
  const seen = new Map<string, number[]>();
  for (let n = 0; n < count; n++) {
    const [cx, cy] = [(n % columns) * tileW, Math.floor(n / columns) * tileH];
    let key = "";
    let visible = false;
    for (let y = 0; y < tileH; y++) {
      for (let x = 0; x < tileW; x++) {
        const i = ((cy + y) * picture.w + cx + x) * 4;
        const a = picture.data[i + 3]!;
        if (a) visible = true;
        key += a ? `${picture.data[i]},${picture.data[i + 1]},${picture.data[i + 2]},${a};` : ".;";
      }
    }
    if (!visible) continue;
    seen.set(key, [...(seen.get(key) ?? []), n]);
  }
  return [...seen.values()].filter((g) => g.length > 1);
}

/// The path of the description that goes with a tileset picture: `sprites/tiles.png` has `sprites/tiles.tileset.json`.
export const tilesetPathFor = (image: string) => `${image.replace(/\.png$/i, "")}.tileset.json`;
export const imagePathFor = (tilesetPath: string) => `${tilesetPath.replace(/\.tileset\.json$/i, "")}.png`;
