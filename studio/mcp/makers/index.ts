// The makers: tools that produce ordinary Nova files (the same sprite, tileset, sound and song files a person could have
// made in the studio) from a short recipe. One module each; a new maker is a module here and a `tool(...)` below.
// Every maker is repeatable (the same recipe and `seed` give the same files), shares the palettes of palettes.ts, and
// returns the picture or report its matching preview tool would. What they make is changed afterwards with the ordinary
// tools: sprite_write (`at`, `append`), scene_write, sfx_write, song_write.

import type { Raster } from "../../src/lib/pixels";
import { BUILDS, CHARACTER_SIZES, HAIR_STYLES, HATS, ITEMS, makeCharacter, OUTFITS, SKINS } from "./character";
import { CITY_CREATURE_NAMES, CREATURES, makeCreature } from "./creature";
import { CITY_ITEM_NAMES, CLASSIC_ITEM_NAMES, makeItems } from "./items";
import { DYES } from "./paint";
import { makeSong, MOOD_NAMES, MOODS } from "./song";
import { MATERIALS, PALETTE_NAMES } from "./palettes";
import { makeTileset, PROP_NAMES, TERRAIN_NAMES, TILE_SIZES } from "./tileset";
import { register3d } from "./index3d";
import { registerRacing } from "./index-racing";
import { STYLE_OPTION } from "./style";
import { ARM_COUNTS, EXPRESSIONS, HD_HATS_MORE, HD_ITEMS_MORE, HD_OUTFITS_MORE, POSES, STANCES, VISORS } from "./character-hd";

/// character_make's "style": the detailed figure is its own size (the shared description is the tiles').
const CHARACTER_STYLE = {
  type: "string",
  description:
    '"detailed": a bold cartoon figure about 44x64 pixels in 96x96 frames, drawn with sx = 1.5 (96 units high on the screen; a 32 px tile is 48), with a face that changes (eyes, brows, a mouth), hard cel shading in three tones, a two-pixel outline, a neon rim; its own parts besides the classic ones (stance, pose, expression, visor, arms, hologram, hat_color; the outfits, hats and items marked detailed). "classic" (when left out) is the 16 px look.',
};

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
      style: STYLE_OPTION,
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

  const picture = (label: string, r: { text: string; picture: Raster }): Result => ({ text: r.text, images: [h.keepPicture(label, r.picture)] });

  h.tool(
    "character_make",
    "Make a top-down character sheet from parts, instead of drawing forty frames: `sprites/<name>.png` and `.sprite.json`. " +
      `Parts: build (${BUILDS.join(", ")}), skin (${Object.keys(SKINS).join(", ")}, or a colour), hair (${HAIR_STYLES.join(", ")}) and hair_color, outfit (${OUTFITS.join(", ")}; detailed also ${HD_OUTFITS_MORE.join(", ")}) with outfit_color and trim_color (belt, trousers, hem), hat (${HATS.join(", ")}; detailed also ${HD_HATS_MORE.join(", ")}), item (${ITEMS.join(", ")}; detailed also ${HD_ITEMS_MORE.join(", ")}: what it swings). Colours are "#rrggbb" or a word (${Object.keys(DYES).slice(0, 12).join(", ")}, ...). ` +
      'It draws idle (2 frames), a 4-frame walk, a 3-frame swing with the item and a hurt frame, each facing down, left, right and up, tagged "idle_down", "walk_left", "attack_right", "hurt_up" and so on, so an entity plays them by name: self:play("walk_" .. dir). ' +
      `The body is ${CHARACTER_SIZES.join(" or ")} pixels (\`size\`), drawn in the middle of a 32x32 or 48x48 frame so the swing has room: the answer gives the pivot (the feet) and the feet's hitbox to put in the entity, and both are in the .sprite.json. ` +
      "It returns the same picture as sprite_preview (every frame, and a strip per animation). The sheet is an ordinary sprite afterwards: fix a frame with sprite_write `at`.",
    {
      name: { type: "string", description: 'The sprite\'s name ("hero").' },
      size: { type: "string", description: `The body's size: ${CHARACTER_SIZES.map((s) => `"${s}"`).join(" or ")} ("16x24" when left out; at "sx": 3 that is 72 units of the 540 the screen is high).` },
      build: { type: "string", description: BUILDS.join(", ") },
      skin: { type: "string", description: `${Object.keys(SKINS).join(", ")}, or "#rrggbb"; detailed also chrome (an android: a shine, a jaw seam, eyes lit in glow_color).` },
      hair: { type: "string", description: HAIR_STYLES.join(", ") },
      hair_color: { type: "string" },
      outfit: { type: "string", description: OUTFITS.join(", ") },
      outfit_color: { type: "string" },
      trim_color: { type: "string", description: "The belt and trousers, a robe's hem, a cap." },
      shoe_color: { type: "string" },
      hat: { type: "string", description: `${HATS.join(", ")}. The city's: visor (a lit band across the eyes), mohawk (the haircut), riot_helmet (a dark dome with a lit strip and a face shield), gas_mask, cyber_eye (one lit eye).` },
      item: { type: "string", description: `What the swing is made with: ${ITEMS.join(", ")}. The city's are carried in every frame: baton (its shaft lit in glow_color; its swing leaves an arc in that colour), pipe (the same arc), pistol and rifle (aimed: their attack raises, fires with a flash at the muzzle, and kicks), shield (a riot shield held in front; the attack is a bash), bottle (thrown).` },
      glow_color: { type: "string", description: 'What glows on the city parts (a visor, a long coat\'s hem, a riot_armor\'s strip, a baton, a gas mask\'s lenses, a muzzle flash, the swing\'s arc): 1 or 2 for the palette\'s accents, or a colour ("#35e6ff", "cyan"). Accent 1 when left out.' },
      hat_color: { type: "string", description: "Detailed style: the headgear's colour (a bandana, a cap, a fedora, a hood). The trim colour when left out (a bellhop cap and a hood: the outfit's)." },
      stance: { type: "string", description: `Detailed style: how the body stands: ${STANCES.join(", ")} (upright when left out; a stout build is heavy). hunched: shoulders up and forward, knees bent (a Scrapper); lanky: tall and narrow; heavy: broad and low; proud: chest out, chin up.` },
      pose: { type: "string", description: `Detailed style: where the hands are at rest and walking: ${POSES.join(", ")}. low: the item held low at the side (the runner's baton); shoulder: over the shoulder (a pipe, a wrench); cocked: raised back to throw (a bottle, a mine); wide: both arms out wide, hands open (a barker); guard: up in front (a shield, a tray); aim: both hands forward (pistol and rifle get it when left out; shield and tray get guard; the rest low).` },
      expression: { type: "string", description: `Detailed style: the face at rest: ${EXPRESSIONS.join(", ")} (neutral when left out). The face changes by itself: gritted teeth winding up, a yell in the smear, shock and then a wince when hurt.` },
      visor: { type: "string", description: `Detailed style, with hat "visor": ${VISORS.join(" or ")}. "up" (pushed up onto the forehead, the face shows; when left out) or "down" (over the eyes, a glint).` },
      arms: { type: "number", description: `Detailed style: ${ARM_COUNTS.join(", ")} arms (2 when left out); the extra pairs hang lower, splayed, each with a small blade (a Splicer).` },
      hologram: { type: "boolean", description: "Detailed style: draw the figure as a hologram in the glow colour, scan lines across it, standing on its projector (a Tout)." },
      palette: PALETTE,
      style: CHARACTER_STYLE,
    },
    ["name"],
    (a) => {
      const root = h.root(a);
      const name = h.safeName(a.name, "Sprite");
      return picture(`character-${name}`, makeCharacter(name, a, (rel, data) => h.put(root, rel, data)));
    },
  );

  h.tool(
    "creature_make",
    `Make a creature's sprite sheet from an archetype: ${CREATURES.join(", ")}. \`sprites/<name>.png\` and \`.sprite.json\` with "idle" (2 frames), "move" (4) and "hit" (a white copy to show for a moment when it is hurt). ` +
      "`color` and `second_color` (eyes, markings) recolour it: the same slime in green, blue and red is three enemies. `size` is the frame in pixels (16, 24 or 32). " +
      `The city's archetypes (${CITY_CREATURE_NAMES.join(", ")}) are drawn at their own size with the states their job needs (turret: idle, turn, fire; bloom_pod and vending_mimic: closed, open; mine: idle, armed; spore_hound: leap; crane_arm: base, arm, then its magnet's idle and move), and each has a "tell" frame, its outline and lights flashing in \`glow_color\`, to show just before it attacks. The vending_mimic shut is exactly tileset_make's vending_machine in the same palette. ` +
      "The answer gives the pivot and hitbox for its entity. It returns the same picture as sprite_preview; the sheet is an ordinary sprite afterwards.",
    {
      name: { type: "string" },
      kind: { type: "string", description: CREATURES.join(", ") },
      color: { type: "string", description: '"#rrggbb" or a colour word (red, blue, purple, bone, ...). Each kind has its own when left out.' },
      second_color: { type: "string" },
      glow_color: { type: "string", description: "The city archetypes' lights and their tell: 1 or 2 for the palette's accents, or a colour. Accent 1 when left out." },
      size: { type: "number", description: "16 (when left out), 24 or 32; a city archetype is its own size when left out (16, 24 or 32) and may be made 48." },
      facings: { type: "boolean", description: 'Detailed style: draw every animation and the tell facing down, left, right and up ("move_down" ... "tell_up"), for a creature that runs or flies in four directions on a top-down street (the rat_drone, the drones, the spore_hound); without it a creature is drawn from the side and faces left with flip_x. Never turn a side view with `angle`.' },
      palette: PALETTE,
      style: STYLE_OPTION,
    },
    ["name", "kind"],
    (a) => {
      const root = h.root(a);
      const name = h.safeName(a.name, "Sprite");
      return picture(`creature-${name}`, makeCreature(name, a, (rel, data) => h.put(root, rel, data)));
    },
  );

  h.tool(
    "items_make",
    `Make the item icons of an adventure as one sheet of 16x16 frames, \`sprites/<name>.png\`: ${CLASSIC_ITEM_NAMES.join(", ")}; with a city palette (or named in \`items\`) the city's: ${CITY_ITEM_NAMES.join(", ")}. Every frame is named; "coin" is tagged as a spinning animation, "chest" as the chest opening, "prompt" as the interact ring's pulse. ` +
      "Draw one by its frame number, or make an entity of one (the answer shows how). It returns the same picture as sprite_preview; add your own icons afterwards with sprite_write `append`.",
    {
      name: { type: "string", description: 'The sheet\'s name ("items").' },
      palette: PALETTE,
      style: STYLE_OPTION,
      items: { type: "array", items: { type: "string" }, description: `Only these icons, from all of both sets (the palette's set when left out: the city's for a city palette).` },
    },
    ["name"],
    (a) => {
      const root = h.root(a);
      const name = h.safeName(a.name, "Sprite");
      return picture(`items-${name}`, makeItems(name, a, (rel, data) => h.put(root, rel, data)));
    },
  );

  h.tool(
    "song_make",
    `Make a short looping song from a mood: ${MOOD_NAMES.map((n) => `"${n}" (${MOODS[n]!.what})`).join("; ")}. ` +
      "It writes `music/<name>.song.json` and the `.ogg` the game streams, exactly as song_write does: a melody, a bass, a harmony part (and in the synthwave moods a fast arpeggio) and drums that follow one chord progression and come round to the start, in the fuller voices (detuned saws through moving filters, a sub, echo and room, the studio or punch drum kit, ducking under the kick, a compressor and limiter on the master), not the chip voice. " +
      "`key` (\"C\", \"A minor\") and `tempo` (beats a minute) change it; `seed` gives another tune in the same mood. It returns the song's sound_report (level, loop seam, warnings) and its picture. " +
      'The song is an ordinary one afterwards: read_file the .song.json, change notes or instruments, and give it to song_write. In Lua: nova.music.play("<name>", { volume = 0.35 }).',
    {
      name: { type: "string", description: 'The song\'s name ("village").' },
      mood: { type: "string", description: MOOD_NAMES.join(", ") },
      key: { type: "string", description: 'The key note, with "minor" or "major" to go against the mood\'s own: "C", "A minor", "F# major".' },
      tempo: { type: "number", description: "Beats a minute, 40 to 240 (each mood has its own when left out)." },
      seed: SEED,
    },
    ["name", "mood"],
    (a) => {
      const name = h.safeName(a.name, "Song");
      const made = makeSong(a);
      const wrote = h.call("song_write", { project: a.project, name, song: made.song });
      const report = h.call("sound_report", { project: a.project, sound: `music/${name}`, loop: true });
      const text = `${typeof wrote === "string" ? wrote : wrote.text}\n${made.said.replace("<name>", name)}\n${typeof report === "string" ? report : report.text}`;
      return { text, images: typeof report === "string" ? [] : report.images };
    },
  );

  const three = register3d(h, PALETTE, SEED);
  const racing = registerRacing(h, SEED);

  return {
    ...three,
    ...racing,
    song_make: { name: "village", mood: "calm village" },
    tileset_make: { name: "tiles", palette: "bright meadow" },
    character_make: { name: "hero", hair: "short", hair_color: "brown", outfit: "tunic", outfit_color: "green", item: "sword" },
    creature_make: { name: "slime", kind: "slime", color: "green" },
    items_make: { name: "items" },
  };
}
