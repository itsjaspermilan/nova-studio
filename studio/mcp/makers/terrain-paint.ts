// Painting a map with terrains: scene_write takes a layer as rows of characters and a `paint` legend that names terrains
// and props of the layer's tileset ("g": "grass", "w": "water", "T": "tree"), and this turns it into ordinary tile layers:
// the right joining tile for every cell, variants scattered by seed, solid terrains solid. It reads only what any tileset
// has (the names, solid tiles and terrains in its `.tileset.json`, and which tiles are see-through), so it works with a
// tileset made by tileset_make, one changed afterwards, or one drawn by hand with terrains set up in the studio.
//
// What comes out, for a layer called "ground":
//   "ground"        the ground itself: whole tiles (and under every edge tile, what lies beside it)
//   "ground_edges"  the joining tiles, see-through where the terrain beside shows
//   "ground_props"  things standing on the ground at the walkers' feet: trunks, bushes, rocks, fences, flowers
//   "ground_over"   what is drawn in front of the walkers: tree crowns
// The scene file holds only tile numbers; scene_preview shows the layers again as the painted map.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { blobMask, edgeMask, tileForMask, type Terrain } from "../../src/lib/autotile";
import { parseTileset, type TilesetDoc } from "../../src/lib/tileset";
import { readPng } from "../draw";
import { hash2 } from "./paint";

type Args = Record<string, any>;

const key = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, "_").replace(/-(?=[a-z])/g, "_");

interface Part {
  dx: number;
  dy: number;
  tile: number;
}
interface Catalog {
  doc: TilesetDoc;
  count: number;
  opaque: (tile: number) => boolean;
  /// Terrains whose whole tile covers the cell (ground), in the order they lie over each other; and those that stand on the ground (a fence).
  ground: { t: Terrain; full: number[]; index: number }[];
  standing: { t: Terrain }[];
  /// Everything else that has a name: single tiles and things of several tiles, each with its variants.
  props: Map<string, Part[][]>;
  tileOf: Map<string, number>;
}

function catalogOf(root: string, image: string, tw: number, th: number): Catalog {
  const png = join(root, image);
  const side = png.replace(/\.png$/i, ".tileset.json");
  if (!existsSync(png)) throw new Error(`there is no ${image}: make the tileset first (tileset_make, or sprite_write)`);
  const sheet = readPng(png);
  const columns = Math.floor(sheet.w / tw), count = columns * Math.floor(sheet.h / th);
  let doc: TilesetDoc = { version: 1, tile_width: tw, tile_height: th, solid: [], names: {}, terrains: [] };
  if (existsSync(side)) {
    const p = parseTileset(readFileSync(side, "utf8"));
    if (!p.ok) throw new Error(`${image.replace(/\.png$/i, ".tileset.json")}: ${p.error}`);
    doc = p.doc;
  }
  const memo = new Map<number, boolean>();
  const opaque = (tile: number): boolean => {
    if (tile < 0 || tile >= count) return false;
    let v = memo.get(tile);
    if (v === undefined) {
      v = true;
      const ox = (tile % columns) * tw, oy = Math.floor(tile / columns) * th;
      for (let y = 0; y < th && v; y++) for (let x = 0; x < tw; x++) if (sheet.data[((oy + y) * sheet.w + ox + x) * 4 + 3] !== 255) {
        v = false;
        break;
      }
      memo.set(tile, v);
    }
    return v;
  };
  const tileOf = new Map<string, number>();
  for (const [n, name] of Object.entries(doc.names)) tileOf.set(key(name), Number(n));
  const inTerrain = new Set(doc.terrains.flatMap((t) => t.tiles));
  const ground: Catalog["ground"] = [], standing: Catalog["standing"] = [];
  doc.terrains.forEach((t) => {
    const whole = tileForMask(t, t.mode === "edges" ? 15 : 255);
    if (opaque(whole)) {
      // the whole tile and its variants ("grass", "grass_2", "grass_3")
      const full = [whole];
      for (let v = 2; tileOf.has(`${key(t.name)}_${v}`); v++) full.push(tileOf.get(`${key(t.name)}_${v}`)!);
      ground.push({ t, full, index: ground.length });
    } else standing.push({ t });
  });
  const terrainNames = new Set(doc.terrains.map((t) => key(t.name)));
  const props = new Map<string, Part[][]>();
  for (const [name, tile] of tileOf) {
    if (inTerrain.has(tile) || name.includes("@")) continue;
    const variant = /^(.+)_(\d+)$/.exec(name);
    if (variant && terrainNames.has(variant[1]!)) continue; // a ground variant
    const base = variant && tileOf.has(variant[1]!) ? variant[1]! : name;
    const parts: Part[] = [{ dx: 0, dy: 0, tile }];
    for (const [other, n] of tileOf) {
      const m = /^(.+)@(-?\d+),(-?\d+)$/.exec(other);
      if (m && m[1] === name) parts.push({ dx: Number(m[2]), dy: Number(m[3]), tile: n });
    }
    props.set(base, [...(props.get(base) ?? []), parts]);
  }
  return { doc, count, opaque, ground, standing, props, tileOf };
}

type Cell =
  | { kind: "empty" }
  | { kind: "ground"; g: number }
  | { kind: "standing"; s: number; on?: string }
  | { kind: "prop"; name: string; on?: string };

const PAINT_HELP =
  '"paint" maps one character to a terrain or a prop of the tileset, like { "g": "grass", "p": "path", "w": "water", "T": "tree", "f": "flowers on grass" } ("on" names the ground under a prop; left out, it is the ground around it); "." and " " are empty';

/// Replaces every tile layer of the scene that has `paint` by the tile layers it paints. Returns a line per painted layer.
export function expandPaint(root: string, scene: Args): string[] {
  if (!Array.isArray(scene.tilemaps)) return [];
  const notes: string[] = [];
  const errors: string[] = [];
  const out: Args[] = [];
  scene.tilemaps.forEach((tm: Args, i: number) => {
    if (!tm || typeof tm !== "object") return void out.push(tm);
    // a tileset may be named: "tiles" is sprites/tiles.png with the tile size its .tileset.json (or .sprite.json) says
    if (typeof tm.tileset === "string") {
      const image = /\.png$/i.test(tm.tileset) ? tm.tileset : `sprites/${tm.tileset}.png`;
      let tw = 16, th = 16;
      for (const ext of [".tileset.json", ".sprite.json"]) {
        const f = join(root, image.replace(/\.png$/i, ext));
        if (!existsSync(f)) continue;
        try {
          const v = JSON.parse(readFileSync(f, "utf8"));
          tw = v.tile_width ?? v.frame_width ?? tw;
          th = v.tile_height ?? v.frame_height ?? th;
          break;
        } catch {
          // (the tile size stays 16)
        }
      }
      tm.tileset = { image, tile_width: tw, tile_height: th };
    }
    if (tm.scale !== undefined && tm.tileset && typeof tm.tileset === "object" && tm.tileset.scale === undefined) {
      tm.tileset.scale = tm.scale;
      delete tm.scale;
    }
    if (tm.paint === undefined) return void out.push(tm);
    const where = `tilemaps[${i}]${tm.name ? ` ("${tm.name}")` : ""}`;
    const ts = tm.tileset;
    if (!ts || typeof ts.image !== "string" || !(ts.tile_width > 0) || !(ts.tile_height > 0)) return void errors.push(`${where} needs "tileset": the tileset's name ("tiles") or { "image", "tile_width", "tile_height" }`);
    if (!tm.paint || typeof tm.paint !== "object" || Array.isArray(tm.paint)) return void errors.push(`${where}: ${PAINT_HELP}`);
    if (!Array.isArray(tm.tiles) || !tm.tiles.length || tm.tiles.some((r: unknown) => typeof r !== "string")) return void errors.push(`${where}: with "paint", "tiles" is a list of rows, each a string with one character per tile`);
    let cat: Catalog;
    try {
      cat = catalogOf(root, ts.image, ts.tile_width, ts.tile_height);
    } catch (e) {
      return void errors.push(`${where}: ${e instanceof Error ? e.message : e}`);
    }
    const known = `terrains: ${[...cat.ground.map((g) => g.t.name), ...cat.standing.map((s) => s.t.name)].join(", ") || "none (a tileset gets them from tileset_make, or in the studio's tileset editor)"}; props and tiles: ${[...cat.props.keys()].join(", ") || "none"}`;
    const groundOf = (name: string) => cat.ground.findIndex((g) => key(g.t.name) === name);

    // the legend
    const legend = new Map<string, Cell>([[".", { kind: "empty" }], [" ", { kind: "empty" }]]);
    for (const [ch, v] of Object.entries(tm.paint)) {
      if ([...ch].length !== 1) {
        errors.push(`${where} paint: "${ch}" must be one character`);
        continue;
      }
      if (v === null || v === -1 || v === "" || key(v) === "empty") {
        legend.set(ch, { kind: "empty" });
        continue;
      }
      const [what, on] = String(v).split(/\s+on\s+/i).map(key);
      if (on !== undefined && groundOf(on) < 0) errors.push(`${where} paint "${ch}": '${on}' is not a ground terrain of ${ts.image} (${cat.ground.map((g) => g.t.name).join(", ")})`);
      const g = groundOf(what!), s = cat.standing.findIndex((x) => key(x.t.name) === what);
      if (g >= 0) legend.set(ch, { kind: "ground", g });
      else if (s >= 0) legend.set(ch, { kind: "standing", s, on });
      else if (cat.props.has(what!)) legend.set(ch, { kind: "prop", name: what!, on });
      else errors.push(`${where} paint "${ch}": '${v}' is not in ${ts.image} (${known})`);
    }
    const rows: string[][] = tm.tiles.map((r: string) => [...r]);
    const cols = rows[0]!.length, nrows = rows.length;
    const cells: Cell[][] = rows.map((row, r) => {
      if (row.length !== cols) errors.push(`${where} row ${r} has ${row.length} tiles, wanted ${cols} (the length of row 0): "${row.join("")}"`);
      return Array.from({ length: cols }, (_, c) => {
        const ch = row[c] ?? ".";
        const cell = legend.get(ch);
        if (!cell) errors.push(`${where} row ${r} column ${c}: '${ch}' is not in "paint" (${[...legend.keys()].filter((k) => k !== " ").join(" ")})`);
        return cell ?? { kind: "empty" };
      });
    });
    if (errors.length) return;

    // the ground under every cell: its own terrain, or for something standing there the ground named with "on", else the
    // commonest ground beside it
    const seed = Math.floor(Number(tm.seed ?? 1)) || 0;
    const at = (c: number, r: number): Cell | undefined => cells[r]?.[c];
    const base: number[][] = cells.map((row) => row.map((cell) => (cell.kind === "ground" ? cell.g : -1)));
    const needs: [number, number, string | undefined][] = [];
    cells.forEach((row, r) => row.forEach((cell, c) => (cell.kind === "standing" || cell.kind === "prop") && needs.push([c, r, cell.on])));
    // First along the row: when the nearest painted ground to the left and to the right are the same, that is it (a window
    // between two pieces of wall, a fence across a lawn). Otherwise the commonest ground one can walk on around the cell
    // (a tree beside a hedge stands on the grass, not on the hedge; with none, as in a side view, nothing is laid under it); cells in the middle of a wood have no
    // ground beside them at first, so it spreads in from the edge.
    const walkable = (g: number) => !cat.doc.solid.includes(cat.ground[g]!.full[0]!);
    const along = (c: number, r: number, step: number): number => {
      for (let cc = c + step; cc >= 0 && cc < cols; cc += step) {
        const cell = cells[r]![cc]!;
        if (cell.kind === "ground") return cell.g;
        if (cell.kind === "empty") return -1;
      }
      return -1;
    };
    for (const [c, r, on] of needs) {
      if (on !== undefined) base[r]![c] = groundOf(on);
      else {
        const left = along(c, r, -1), right = along(c, r, 1);
        if (left >= 0 && left === right) base[r]![c] = left;
      }
    }
    for (let pass = 0; pass < cols + nrows && needs.some(([c, r]) => base[r]![c]! < 0); pass++) {
      const found: [number, number, number][] = [];
      for (const [c, r] of needs) {
        if (base[r]![c]! >= 0) continue;
        const votes = new Map<number, number>();
        for (const [dc, dr] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const g = base[r + dr!]?.[c + dc!];
          if (g !== undefined && g >= 0 && walkable(g)) votes.set(g, (votes.get(g) ?? 0) + (dc === 0 || dr === 0 ? 2 : 1));
        }
        const best = [...votes].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
        if (best) found.push([c, r, best[0]]);
      }
      if (!found.length) break;
      for (const [c, r, g] of found) base[r]![c] = g;
    }

    const blank = () => Array.from({ length: nrows }, () => new Array<number>(cols).fill(-1));
    const ground = blank(), edges = blank(), edges2 = blank(), props = blank(), over = blank();
    const variant = (list: number[], c: number, r: number, salt: number): number => {
      // every variant is as likely as another (a tileset has several plain ones for each with a tuft or a pebble)
      const h = hash2(c, r, seed + salt);
      return list[Math.min(list.length - 1, Math.floor(h * list.length))]!;
    };
    for (let r = 0; r < nrows; r++) for (let c = 0; c < cols; c++) {
      const g = base[r]![c]!;
      if (g < 0) continue;
      const me = cat.ground[g]!;
      // a terrain carries on under whatever lies over it, and past the edge of the map
      const member = (cc: number, rr: number) => {
        const other = base[rr]?.[cc];
        return other === undefined || other >= g;
      };
      const mask = me.t.mode === "edges" ? edgeMask(member, c, r) : blobMask(member, c, r);
      const whole = mask === (me.t.mode === "edges" ? 15 : 255);
      const tile = tileForMask(me.t, mask);
      if (whole || tile < 0) ground[r]![c] = variant(me.full, c, r, 0);
      else if (cat.opaque(tile)) ground[r]![c] = tile;
      else {
        // What shows through the rim is the lower ground around. When two kinds lie around (sand on one side of a path,
        // grass on the other) the higher of the two is laid as if the cell were that ground, so it gets its own edge
        // against the lower one, and the cell's own edge goes on top of both.
        const votes = new Map<number, number>();
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          const other = base[r + dr]?.[c + dc];
          if (other !== undefined && other >= 0 && other < g) votes.set(other, (votes.get(other) ?? 0) + (dc === 0 || dr === 0 ? 2 : 1));
        }
        const under = [...votes].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 2).map((v) => v[0]).sort((a, b) => a - b);
        if (under.length) ground[r]![c] = variant(cat.ground[under[0]!]!.full, c, r, 0);
        let between = -1;
        if (under.length === 2) {
          const mid = cat.ground[under[1]!]!;
          const inMid = (cc: number, rr: number) => {
            const other = base[rr]?.[cc];
            return other === undefined || other >= under[1]!;
          };
          const m = mid.t.mode === "edges" ? edgeMask(inMid, c, r) : blobMask(inMid, c, r);
          const midTile = tileForMask(mid.t, m);
          if (m === (mid.t.mode === "edges" ? 15 : 255) || cat.opaque(midTile)) ground[r]![c] = cat.opaque(midTile) && m !== (mid.t.mode === "edges" ? 15 : 255) ? midTile : variant(mid.full, c, r, 0);
          else between = midTile;
        }
        if (between >= 0) {
          edges[r]![c] = between;
          edges2[r]![c] = tile;
        } else edges[r]![c] = tile;
      }
    }
    for (let r = 0; r < nrows; r++) for (let c = 0; c < cols; c++) {
      const cell = cells[r]![c]!;
      if (cell.kind === "standing") {
        const t = cat.standing[cell.s]!.t;
        const member = (cc: number, rr: number) => {
          const other = at(cc, rr);
          return other === undefined ? cc >= 0 && cc < cols : other.kind === "standing" && other.s === cell.s;
        };
        props[r]![c] = tileForMask(t, t.mode === "edges" ? edgeMask(member, c, r) : blobMask(member, c, r));
      } else if (cell.kind === "prop") place(cell.name, c, r, 7);
    }
    function place(name: string, c: number, r: number, salt: number) {
      const variants = cat.props.get(name)!;
      const h = hash2(c, r, seed + salt);
      const parts = variants[Math.min(variants.length - 1, Math.floor(h * variants.length))]!;
      for (const p of parts) {
        const cc = c + p.dx, rr = r + p.dy;
        if (cc < 0 || rr < 0 || cc >= cols || rr >= nrows) continue;
        // a tile with nothing see-through in it (a door) takes the ground's place; the rest stand on the ground, and what
        // is above the foot is drawn in front of whoever walks behind
        if (p.dy < 0) over[rr]![cc] = p.tile;
        else if (cat.opaque(p.tile) && p.dx === 0) {
          ground[rr]![cc] = p.tile;
          edges[rr]![cc] = -1;
          edges2[rr]![cc] = -1;
        } else props[rr]![cc] = p.tile;
      }
    }
    // scatter: props strewn over the whole tiles of a ground by chance, the same for the same seed
    let strewn = 0;
    if (tm.scatter !== undefined) {
      if (!tm.scatter || typeof tm.scatter !== "object" || Array.isArray(tm.scatter)) errors.push(`${where}: "scatter" maps a prop to its chance per tile, like { "flowers": 0.05, "rock": { "chance": 0.01, "on": "path" } }`);
      else Object.entries(tm.scatter).forEach(([name, v], n) => {
        const o = (v && typeof v === "object" ? v : { chance: v }) as Args;
        const chance = Number(o.chance), on = groundOf(key(o.on ?? cat.ground[0]?.t.name));
        if (!cat.props.has(key(name))) return void errors.push(`${where} scatter: '${name}' is not a prop of ${ts.image} (${[...cat.props.keys()].join(", ")})`);
        if (!(chance >= 0 && chance <= 1) || on < 0) return void errors.push(`${where} scatter "${name}": give a chance from 0 to 1 per tile, and "on" a ground terrain (${cat.ground.map((g) => g.t.name).join(", ")})`);
        for (let r = 0; r < nrows; r++) for (let c = 0; c < cols; c++) {
          if (cells[r]![c]!.kind !== "ground" || base[r]![c] !== on || edges[r]![c]! >= 0 || edges2[r]![c]! >= 0 || props[r]![c]! >= 0 || over[r]![c]! >= 0) continue;
          if (!cat.ground[on]!.full.includes(ground[r]![c]!)) continue;
          if (hash2(c, r, seed + 100 + n * 13) < chance) {
            place(key(name), c, r, 9 + n);
            strewn++;
          }
        }
      });
    }
    if (errors.length) return;

    const name = String(tm.name ?? "ground");
    const depth = typeof tm.depth === "number" ? tm.depth : 100;
    const solidSet = new Set(cat.doc.solid);
    let blocked = 0;
    for (let r = 0; r < nrows; r++) for (let c = 0; c < cols; c++) if ([ground, edges, edges2, ...(tm.solid_props === false ? [] : [props])].some((l) => solidSet.has(l[r]![c]!))) blocked++;
    const layer = (suffix: string, tiles: number[][], d: number): Args | null => {
      const used = new Set(tiles.flat().filter((t) => t >= 0));
      if (!used.size) return null;
      const solid = suffix === "_over" || (suffix === "_props" && tm.solid_props === false) ? [] : [...used].filter((t) => solidSet.has(t)).sort((a, b) => a - b);
      return { name: `${name}${suffix}`, depth: d, tileset: { ...ts }, ...(tm.x ? { x: tm.x } : {}), ...(tm.y ? { y: tm.y } : {}), ...(solid.length ? { solid } : {}), tiles };
    };
    const made = [layer("", ground, depth), layer("_edges", edges, depth - 1), layer("_edges_2", edges2, depth - 2), layer("_props", props, depth - 3), layer("_over", over, typeof tm.over_depth === "number" ? tm.over_depth : -10000)].filter((l): l is Args => !!l);
    out.push(...made);
    notes.push(`painted "${name}": ${cols} x ${nrows} cells into ${made.length} tile layer(s) (${made.map((l) => `"${l.name}"`).join(", ")}), ${blocked} cells solid${strewn ? `, ${strewn} props scattered` : ""}, seed ${seed}`);
  });
  if (errors.length) {
    const shown = errors.slice(0, 24);
    throw new Error(`${shown.join("\n")}${errors.length > shown.length ? `\n... and ${errors.length - shown.length} more` : ""}\n${PAINT_HELP}`);
  }
  scene.tilemaps = out;
  return notes;
}

/// The tile layers of a scene read back as painted maps: for every group of layers that share a tileset and a place, the
/// rows of characters and the `paint` legend that would paint them again. Empty when no layer uses a terrain.
export function paintedText(root: string, maps: Args[]): string[] {
  const lines: string[] = [];
  const groups = new Map<string, Args[]>();
  for (const m of maps) {
    if (!m?.tileset?.image) continue;
    const k = `${m.tileset.image}|${m.x ?? 0}|${m.y ?? 0}|${m.tiles.length}|${m.tiles[0]?.length ?? 0}`;
    groups.set(k, [...(groups.get(k) ?? []), m]);
  }
  for (const layers of groups.values()) {
    const ts = layers[0]!.tileset;
    let cat: Catalog;
    try {
      cat = catalogOf(root, ts.image, ts.tile_width, ts.tile_height);
    } catch {
      continue;
    }
    if (!cat.ground.length && !cat.standing.length) continue;
    const terrainOf = new Map<number, string>();
    for (const g of cat.ground) for (const t of [...g.t.tiles, ...g.full]) terrainOf.set(t, g.t.name);
    for (const s of cat.standing) for (const t of s.t.tiles) terrainOf.set(t, s.t.name);
    const propOf = new Map<number, string>();
    for (const [name, variants] of cat.props) for (const parts of variants) propOf.set(parts[0]!.tile, name);
    const isGround = new Set(cat.ground.map((g) => g.t.name));
    const nrows = layers[0]!.tiles.length, cols = layers[0]!.tiles[0]?.length ?? 0;
    // the front-most first: a prop's foot or a fence, then an edge, then the ground
    const order = [...layers].filter((l) => (l.depth ?? 0) >= 0).sort((a, b) => (a.depth ?? 0) - (b.depth ?? 0));
    if (!order.length) continue;
    const label: string[][] = [];
    let any = false, unknown = 0;
    for (let r = 0; r < nrows; r++) {
      label.push([]);
      for (let c = 0; c < cols; c++) {
        let what = "", under = "";
        for (const l of order) {
          const t = l.tiles[r]?.[c] ?? -1;
          if (t < 0) continue;
          const name = propOf.get(t) ?? terrainOf.get(t);
          if (!name) {
            if (!what) unknown++;
            continue;
          }
          if (!what) what = name;
          else if (!under && isGround.has(name) && !isGround.has(what)) under = name;
        }
        if (what && terrainOf.size) any = true;
        label[r]!.push(what ? (under && !isGround.has(what) ? `${what} on ${under}` : what) : "");
      }
    }
    if (!any) continue;
    const pool = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#@%&*+=?";
    const chars = new Map<string, string>([["", "."]]);
    const taken = new Set(["."]);
    for (const l of [...new Set(label.flat())].filter(Boolean)) {
      const first = l[0]!;
      const ch = [isGround.has(l) ? first.toLowerCase() : first.toUpperCase(), first.toUpperCase(), first.toLowerCase(), ...pool].find((x) => !taken.has(x));
      if (!ch) continue;
      chars.set(l, ch);
      taken.add(ch);
    }
    const name = String(order[order.length - 1]!.name ?? "ground");
    lines.push(`painted map of ${layers.map((l) => `"${l.name ?? "?"}"`).join(", ")} (tileset ${ts.image}): to change it, give scene_write ONE layer { "name": "${name}", "tileset": ..., "paint": ..., "tiles": [rows] } in their place${unknown ? `; ${unknown} cells hold tiles that are not a terrain or a prop and show as '.'` : ""}`);
    lines.push(`  "paint": { ${[...chars].filter(([l]) => l).map(([l, ch]) => `"${ch}": "${l}"`).join(", ")} }`);
    label.forEach((row, r) => lines.push(`  ${String(r).padStart(3)} ${row.map((l) => chars.get(l) ?? "?").join("")}`));
  }
  return lines;
}
