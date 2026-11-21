// How a maker's pictures become a project's files: the same `sprites/<name>.png`, `.sprite.json` and `.tileset.json` that
// sprite_write and the sprite editor make, so everything made here can be changed afterwards with the ordinary tools.

import type { Terrain } from "../../src/lib/autotile";
import { encodePng } from "../../src/lib/png-encode";
import { newRaster, type Raster } from "../../src/lib/pixels";
import { parseSheetJson, SHEET_COLUMNS, type SheetJson } from "../../src/lib/sprite-doc";
import { newTileset, serializeTileset } from "../../src/lib/tileset";
import { namesText, spritePicture } from "../sprites";
import type { Img } from "./paint";

export type Put = (rel: string, data: string | Uint8Array) => void;

export interface Sheet {
  frames: Img[];
  /// Animations by frame number.
  tags?: { name: string; from: number; to: number; loop?: boolean; direction?: "forward" | "reverse" | "pingpong" }[];
  frame_ms?: number;
  /// How long each frame shows, when they differ (one per frame).
  durations?: number[];
  names?: Record<number, string>;
  solid?: number[];
  /// Tiles that mirror what stands above them (puddles, water), for a tileset.
  reflect?: number[];
  terrains?: Terrain[];
  /// In pixels of a frame from its top left: where it stands, and the box that collides.
  pivot?: { x: number; y: number };
  hitbox?: { x: number; y: number; w: number; h: number };
}

/// Writes the sheet and returns what sprite_preview would say and show of it.
export function writeSheet(name: string, s: Sheet, put: Put): { text: string; picture: Raster; json: SheetJson } {
  const fw = s.frames[0]!.w, fh = s.frames[0]!.h;
  const columns = Math.min(s.frames.length, SHEET_COLUMNS);
  const sheet = newRaster(columns * fw, Math.ceil(s.frames.length / columns) * fh);
  s.frames.forEach((f, i) => {
    const ox = (i % columns) * fw, oy = Math.floor(i / columns) * fh;
    for (let y = 0; y < fh; y++) sheet.data.set(f.r.data.subarray(y * fw * 4, (y + 1) * fw * 4), ((oy + y) * sheet.w + ox) * 4);
  });
  const json: SheetJson = {
    version: 1,
    image: `${name}.png`,
    frame_width: fw,
    frame_height: fh,
    columns,
    frames: s.frames.length,
    // (the game takes one or the other, not both)
    ...(s.durations ? { durations_ms: s.durations } : { frame_duration_ms: s.frame_ms ?? 100 }),
    ...(s.tags?.length ? { tags: s.tags } : {}),
    ...(s.hitbox ? { hitbox: s.hitbox } : {}),
    ...(s.pivot ? { pivot: s.pivot } : {}),
  };
  const text = `${JSON.stringify(json, null, 2)}\n`;
  const ok = parseSheetJson(text);
  if (!ok.ok) throw new Error(ok.error);
  put(`sprites/${name}.png`, encodePng(sheet));
  put(`sprites/${name}.sprite.json`, text);
  const names: Record<string, string> = {};
  for (const [k, v] of Object.entries(s.names ?? {})) names[k] = v;
  const terrains = s.terrains ?? [];
  if (Object.keys(names).length || s.solid?.length || terrains.length) {
    put(`sprites/${name}.tileset.json`, serializeTileset({ ...newTileset(fw, fh), names, solid: [...new Set(s.solid ?? [])].sort((a, b) => a - b), ...(s.reflect?.length ? { reflect: [...new Set(s.reflect)].sort((a, b) => a - b) } : {}), terrains }));
  }
  const tags = (s.tags ?? []).map((t) => `${t.name} ${t.from}-${t.to}`).join(", ");
  return {
    text: `sprites/${name}.png: ${s.frames.length} frame(s) of ${fw}x${fh}, ${columns} across${tags ? `; animations: ${tags}` : ""}${namesText(names, terrains)}`,
    picture: spritePicture(sheet, json, names, terrains),
    json,
  };
}
