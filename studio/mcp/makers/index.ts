// The makers: tools that produce ordinary Nova files (the same sprite, tileset, sound and song files a person could have
// made in the studio) from a short recipe. One module each; a new maker is a module here and a `tool(...)` below.
// Every maker is repeatable (the same recipe and `seed` give the same files), shares the palettes of palettes.ts, and
// returns the picture or report its matching preview tool would. What they make is changed afterwards with the ordinary
// tools: sprite_write (`at`, `append`), scene_write, sfx_write, song_write.

import type { Raster } from "../../src/lib/pixels";
import { MATERIALS, PALETTE_NAMES } from "./palettes";
import { makeTileset, PROP_NAMES, TERRAIN_NAMES, TILE_SIZES } from "./tileset";

type Args = Record<string, any>;
type Result = string | { text: string; images?: string[] };

export interface Host {
  tool: (name: string, description: string, properties: Record<string, unknown>, required: string[], handler: (a: Args) => Result) => void;
  root: (a: Args) => string;
  safeName: (name: unknown, what: string) => string;
  put: (root: string, rel: string, data: string | Uint8Array) => void;
  keepPicture: (label: string, picture: Raster) => string;
  /// Another tool of the server, by name (a maker that ends in an ordinary tool's work calls that tool).
  call: (name: string, args: Args) => Result;
}

const PALETTE = {
  type: ["string", "object"],
  description: `The colours: ${PALETTE_NAMES.map((n) => `"${n}"`).join(", ")} (use the same one for every maker of a game, so its art agrees), or your own: { "base": "autumn", "grass": "#88aa33", "outline": "#201828" } replaces materials of a named one (${MATERIALS.join(", ")}; each one colour, from which five shades are made, or five shades written out dark to light).`,
};
const SEED = { type: "number", description: "The same recipe and seed always make the same files; another seed is another variant (1 when left out)." };

/// Adds the makers to the server's tools and returns one working example call for each.
export function registerMakers(h: Host): Record<string, Args> {
  h.tool(
    "tileset_make",
    "Make a whole tileset from a short recipe, instead of drawing tiles row by row: `sprites/<name>.png`, `.sprite.json` and `.tileset.json`, in one of the shared palettes. " +
      `Terrains (${TERRAIN_NAMES.join(", ")}) each come with the 47 joining tiles for every edge and corner (inner and outer), a few variants so large areas are not flat, one light direction (top left) and one outline rule (ground has none, what stands on it has the palette's). ` +
      `Props are tiles too (${PROP_NAMES.join(", ")}): a tree is two tiles, its crown drawn in front of whoever walks behind. Every tile is named; solid terrains and props are marked solid. ` +
      'Then paint maps with scene_write: a layer { "tileset": "<name>", "scale": 3, "paint": { "g": "grass", "p": "path", "w": "water", "T": "tree" }, "tiles": ["gggT", "gppg", "gwwg"] } gets the right joining tile in every cell (see scene_write). ' +
      "It returns the same picture as sprite_preview: the props and variants as numbered tiles, and each terrain as a painted sample. The tileset is an ordinary one afterwards: redraw a tile with sprite_write `at`, add your own with `append`, set up more terrains in the studio.",
    {
      name: { type: "string", description: 'The tileset\'s name ("tiles").' },
      palette: PALETTE,
      tile: { type: "number", description: `The tile size in pixels: ${TILE_SIZES.join(", ")} (16 when left out, which is the size the drawings are tuned for; draw it with "scale": 3).` },
      terrains: { type: "array", items: { type: "string" }, description: `Only these terrains (all when left out): ${TERRAIN_NAMES.join(", ")}.` },
      props: { type: "array", items: { type: "string" }, description: `Only these props (all when left out): ${PROP_NAMES.join(", ")}.` },
      seed: SEED,
    },
    ["name"],
    (a) => {
      const root = h.root(a);
      const name = h.safeName(a.name, "Tileset");
      const r = makeTileset(name, a, (rel, data) => h.put(root, rel, data));
      return { text: r.text, images: [h.keepPicture(`tileset-${name}`, r.picture)] };
    },
  );

  return {
    tileset_make: { name: "tiles", palette: "bright meadow" },
  };
}
