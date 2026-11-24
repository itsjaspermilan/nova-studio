// The 3D makers as tools: prop3d_make, character3d_make, ground3d_make. Like the 2D makers they write ordinary files (a
// .model.json the model editor opens and the .glb the game loads, through model_write itself) and return the picture
// model_preview would.

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Host } from "./index";
import { CHARACTER3D, characterEntity, makeCharacter3d } from "./character3d";
import { encodePng } from "../../src/lib/png-encode";
import { CREATURES3D, makeCreature3d } from "./creature3d";
import { GROUND_KINDS, makeGround } from "./ground3d";
import { PALETTE_NAMES } from "./palettes";
import { makeProp, PAINTED_KINDS, PROP_KINDS, propEntity, type Prop } from "./prop3d";
import { DETAILED_KINDS, DETAILED_OF, makeScenery, speciesOf } from "./scenery";

/// A spectator's entity: it plays its idle clip (a cheer, a clap, a wave or a long look along the road), each one from its own moment.
const spectatorEntity = (name: string, says: string) => `-- ${says}.\nlocal Spectator = nova.entity { model = "${name}", on_ground = true, velocity = false }\n\nfunction Spectator:create()\n  self:play_clip("idle", { time = (self.x * 0.37 + (self.z or 0) * 0.61) % 2 })\nend\n\nreturn Spectator\n`;

type Args = Record<string, any>;
type Result = string | { text: string; images?: string[] };

const text = (r: Result) => (typeof r === "string" ? r : r.text);
const images = (r: Result) => (typeof r === "string" ? [] : (r.images ?? []));

export function register3d(h: Host, PALETTE: unknown, SEED: unknown): Record<string, Args> {
  /// Writes entities/<name>.lua unless there is one already; says which.
  const entity = (root: string, name: string, body: string, wanted: unknown): string => {
    if (wanted === false) return "";
    const rel = `entities/${name}.lua`;
    if (existsSync(join(root, rel))) return ` (${rel} was already there and is left as it is)`;
    h.put(root, rel, body);
    return ` and ${rel}`;
  };

  h.tool(
    "prop3d_make",
    "Make the things a 3D level is furnished with, instead of modelling each: `models/<name>.model.json` and `.glb` by kind and seed, in one of the shared palettes, and `entities/<name>.lua` so a scene can place it at once (`{ \"kind\": \"<name>\", \"x\", \"y\": 0, \"z\", \"props\": { \"ry\": radians, \"sx\": scale } }`). " +
      `Kinds: ${PROP_KINDS.join(", ")}: the low style, few flat faces, each a slightly different tone, sized in metres beside a hero 1.6 high, standing on y = 0. ` +
      `The detailed kinds (the scenery first made for Pine Ridge Rally: many more faces, smooth shading, real sizes): ${DETAILED_KINDS.map((k) => `${k} (${speciesOf(k).join(", ")})`).join("; ")}. A detailed kind takes \`species\` (the first when left out), \`season\` (summer, autumn, snow, night; from the palette when left out: autumn, snow, night, and desert's red rock) and \`height\` (metres; natural kinds only). \`style\`: "detailed" makes ${Object.keys(DETAILED_OF).join(", ")} the detailed ones (tree is a broadleaf, pine a conifer, bush a shrub, rock a boulder, sign a chevron, lantern a trackside lamp, arch a start arch, tower a race control tower); "painted" makes ${PAINTED_KINDS.join(", ")} soft rounded crowns (leaf clumps, ragged pine tiers) that the game paints as foliage: leaf strokes, a darker core, a sunlit rim (docs/project-format.md, "Painted surfaces"). A spectator is half life size with the clips static, idle, watch, cheer, clap and wave; its entity plays idle. ` +
      "Give one (`kind`, with `name` when it should not be the kind's own) or several at once (`kinds`: names, or { kind, name, seed, size, color } objects: `\"kinds\": [\"tree\", \"pine\", { \"kind\": \"tree\", \"name\": \"tree2\", \"seed\": 5 }, \"rock\"]`); another `seed` is another tree of the same kind. " +
      "Each model carries what it blocks on the ground (`colliders`, `boxes` or `capsules`). The entity file says how it is used: scenery that never moves (`static = true`); things you bump into and can stand on are `solid = true` (their own shape blocks bodies moved with nova.solid.move, and the follow camera); a tree blocks with its trunk and keeps the camera out of its crown; `steps` and `dais` are low enough to walk up; `gem` and `coin` turn and bob and are tagged \"pickup\"; a `lantern`'s answer says where its light goes. " +
      "It returns the same picture as model_preview (a contact sheet for several). The models are ordinary ones afterwards: read the .model.json, change it and give it to model_write.",
    {
      kind: { type: "string", description: PROP_KINDS.join(", ") },
      name: { type: "string", description: "The model's (and the entity's) name; the kind when left out." },
      kinds: { type: "array", items: { type: ["string", "object"] }, description: 'Several at once: kinds by name, or { "kind", "name", "seed", "size", "color", "species", "season", "height", "style", "colliders" } objects.' },
      species: { type: "string", description: "A detailed kind's species (see the list)." },
      season: { type: "string", description: 'A detailed kind\'s season: "summer", "autumn", "snow", "night".' },
      height: { type: "number", description: "A natural detailed kind's height in metres (its own when left out)." },
      style: { type: "string", description: '"detailed": the detailed versions of the kinds that have both. "painted": soft rounded crowns the game paints as foliage (leaf strokes, a darker core, a lit rim), for ' + PAINTED_KINDS.join(", ") + '; other kinds stay low.' },
      colliders: { type: "boolean", description: "false: no colliders added by the rule (a detailed model keeps any of its own)." },
      preview: { type: "boolean", description: "false: no picture (quicker for scripts that make many)." },
      size: { type: "string", description: 'For a rock: "small", "medium" (when left out) or "large".' },
      color: { type: "string", description: 'For a gem: its colour, "#rrggbb" (one of five by seed when left out).' },
      entity: { type: "boolean", description: "false: do not write entities/<name>.lua (it is written unless one is already there)." },
      palette: PALETTE,
      seed: SEED,
    },
    [],
    (a) => {
      const root = h.root(a);
      const list: Args[] = Array.isArray(a.kinds) && a.kinds.length ? a.kinds.map((k: unknown) => (typeof k === "string" ? { kind: k } : (k as Args))) : a.kind !== undefined ? [{ kind: a.kind, name: a.name, size: a.size, color: a.color, species: a.species, season: a.season, height: a.height }] : [];
      if (!list.length) throw new Error(`say what to make: "kind" (one of ${[...PROP_KINDS, ...DETAILED_KINDS].join(", ")}) or "kinds" (a list of them)`);
      if (list.length > 24) throw new Error(`kinds has ${list.length} entries; one call makes up to 24`);
      const made: { name: string; prop: Prop; wrote: string }[] = [];
      for (const [i, item] of list.entries()) {
        if (!item || typeof item !== "object") throw new Error(`kinds[${i}] is a kind's name or { "kind": ..., "name": ..., "seed": ... }`);
        const ITEM = ["kind", "name", "seed", "size", "color", "species", "season", "height", "style", "colliders"];
        const bad = Object.keys(item).filter((k) => !ITEM.includes(k));
        if (bad.length) throw new Error(`kinds[${i}] has "${bad.join('", "')}"; an entry takes ${ITEM.join(", ")}`);
        for (const k of Object.keys(item)) if (item[k] === undefined) delete item[k];
        const style = item.style ?? a.style, season = item.season ?? a.season, colliders = item.colliders ?? a.colliders;
        if (style !== undefined && style !== "low" && style !== "detailed" && style !== "painted") throw new Error(`style is "low" (when left out), "detailed" or "painted", not ${JSON.stringify(style)}`);
        const detailed = DETAILED_KINDS.includes(item.kind) && !(PROP_KINDS as readonly string[]).includes(item.kind) || (style === "detailed" && DETAILED_OF[item.kind] !== undefined);
        const prop = detailed
          ? makeScenery({ ...item, palette: a.palette, seed: item.seed ?? a.seed, style, season, colliders }, h.safeName(item.name ?? (style === "detailed" ? DETAILED_OF[item.kind] ?? item.kind : item.kind), "Model"))
          : makeProp({ ...item, palette: a.palette, seed: item.seed ?? a.seed, style });
        const name = h.safeName(item.name ?? prop.kind, "Model");
        if (made.some((m) => m.name === name)) throw new Error(`two entries are called "${name}": give the second its own "name"`);
        h.call("model_write", { project: a.project, name, model: prop.model });
        made.push({ name, prop, wrote: entity(root, name, prop.kind === ("spectator" as Prop["kind"]) ? spectatorEntity(name, prop.says) : propEntity(name, prop), a.entity) });
      }
      const lines = made.map(({ name, prop, wrote }) => {
        const m = prop.model;
        // (the model keeps its shapes in model units; said here in metres)
        const k = (v: number) => Math.round((v * (m.scale ?? 1 / 16)) * 1000) / 1000;
        const blocks = [
          ...(m.colliders ?? []).map((c: Args) => `circle r ${k(c.r)}${c.x || c.z ? ` at ${k(c.x)}, ${k(c.z)}` : ""}`),
          ...(m.boxes ?? []).map((b: Args) => `box ${k(b.hw * 2)} x ${k(b.hl * 2)}${b.x || b.z ? ` at ${k(b.x)}, ${k(b.z)}` : ""}`),
          ...(m.capsules ?? []).map((c: Args) => `capsule r ${k(c.r)} from ${k(c.ax)}, ${k(c.az)} to ${k(c.bx)}, ${k(c.bz)}`),
        ];
        const e = prop.entity;
        return `  ${name} (${prop.kind}): models/${name}.glb${wrote}; ${prop.size.w} x ${prop.size.h} x ${prop.size.d} m (x, y, z). ${prop.says}. Collider${blocks.length === 1 ? "" : "s"}: ${blocks.join("; ") || "none"}. Entity: ${e.spins ? `a live one tagged "${name}" and "pickup" that turns and bobs` : `nova.entity { model = "${name}", static = true${e.solid ? ", solid = true" : ""}${e.sway ? `, sway = ${e.sway}` : ""}${e.sway && prop.size.h > 1.2 ? `, lift = "upright"` : ""}, on_ground = true }`}${prop.light ? `. Light: nova.point_light(x + ${prop.light.x}, y + ${prop.light.y}, z + ${prop.light.z}, { radius = ${prop.light.radius}, color = { ${prop.light.color.join(", ")} } }) in the scene's draw, for each one placed (turned by its ry: the lamp is ${prop.light.z} in front of the post)` : ""}`;
      });
      const shown = a.preview === false ? "" : made.length === 1 ? h.call("model_preview", { project: a.project, name: made[0]!.name }) : h.call("model_preview", { project: a.project, names: made.map((m) => m.name), fit: "each" });
      return {
        text: [`made ${made.length} prop${made.length === 1 ? "" : "s"} (palette "${typeof a.palette === "string" ? a.palette : a.palette ? "your own" : "bright meadow"}", seed ${a.seed ?? 1}):`, ...lines, 'Place them in a scene (scene_write): { "kind": "<name>", "x": 4, "y": 0, "z": -6, "props": { "ry": 1.2, "sx": 1.1 } }: on_ground = true stands each on the ground under its x, z (y is the height above it; "props": { "on_ground": false } for one that should stay at its y). What is solid = true blocks nova.solid.move and the follow camera with no more code.', text(shown).split("\n").slice(-1)[0] ?? ""].join("\n"),
        images: images(shown),
      };
    },
  );

  h.tool(
    "character3d_make",
    "Make a rigged 3D person from parts, instead of modelling and animating one: `models/<name>.model.json` and `.glb`, a low-poly figure about 1.6 m high standing on y = 0 and facing +z, with limbs that bend at the elbow and knee. " +
      `Parts: build (${CHARACTER3D.builds.join(", ")}), skin (${CHARACTER3D.skins.join(", ")}, or "#rrggbb"), hair (${CHARACTER3D.hairs.join(", ")}) and hair_color, outfit (${CHARACTER3D.outfits.join(", ")}) with outfit_color, trim_color (trousers, belt) and shoe_color, hat (${CHARACTER3D.hats.join(", ")}), pack (${CHARACTER3D.packs.join(", ")}), item (${CHARACTER3D.items.join(", ")}: held in the right hand). ` +
      `\`species\` (${CHARACTER3D.species.join(", ")}) makes an animal person instead (with \`build: \"chibi\"\` a cozy villager about a metre and two heads tall, like a soft toy: a big smooth head squashed wider than tall, a small round body, short arms with round mittens and short legs swinging whole from shoulder and hip, a waddling walk, a run with the arms held straight out to the sides like wings; its clothes painted flat, an \`emblem\` on the chest). An animal person's face is flat art painted on its head (decals that hug it, in the model's texture, models/<name>.texture.png): each drawing of the eyes, brows and mouth is a part of the head, all but the first of each set hidden at rest, swapped with parts = { name = { visible = true } } for nine expressions (neutral, smile, happy, delighted, gruff, dry, sad, surprised, indignant), a blink and a talking mouth, listed in the answer: its fur (\`fur\`, \`fur2\`) and pattern, a muzzle, ears, big eyes, paws and a tail (a part, \`tail\`, that the clips swing), with a big head (\`head_scale\`, 1.5 or so; 1 is a person's); \`accessory\` (${CHARACTER3D.accessories.join(", ")}) and \`accent_color\` add one more thing. ` +
      "Clips: idle, walk, run (both loop, with a `step` event as each foot lands, the feet rolling from heel to toe on the ground, the hips rising over the standing leg, the arms swinging against the legs), jump (crouch, push off, tuck, reach for the ground: play it once while in the air), wave, attack (a swing of the right arm, with a `hit` event), hurt, trot (a brisk hurry with no arm swing, for carrying: lay carry over it), carry (both arms forward round a box at the chest: lay it over another clip's arms as a masked layer, `{ clip = \"carry\", mask = { \"arm_l\", \"arm_r\" } }`), talk (a hand that gestures with each phrase and a nodding head, loops) work (busy hands in front: sawing, fiddling with a knob, loops) and sit (on a seat with the legs out in front and both hands forward at the chest, as on a steering wheel: draw the figure a seat height up, minus its hips, and turn the arms with `parts` to steer; loops). " +
      "The answer gives the part names (to hang things on or turn: parts = { head = { ry = 0.4 } }), each clip's length and events, the speeds at which the walk and the run do not slide, the capsule for nova.solid.move, and the Lua for an entity with an animator. `entity`: \"hero\" also writes entities/hero.lua, a third-person walker (stick relative to the camera, jump, the clips blended by speed) to start from. " +
      "It returns model_preview's picture and the walk as a strip. The model is an ordinary one afterwards: read the .model.json, change a clip or a colour and give it to model_write with bend: true.",
    {
      name: { type: "string", description: 'The model\'s name ("hero").' },
      build: { type: "string", description: CHARACTER3D.builds.join(", ") },
      skin: { type: "string", description: `${CHARACTER3D.skins.join(", ")}, or "#rrggbb".` },
      hair: { type: "string", description: CHARACTER3D.hairs.join(", ") },
      hair_color: { type: "string" },
      outfit: { type: "string", description: CHARACTER3D.outfits.join(", ") },
      outfit_color: { type: "string" },
      trim_color: { type: "string", description: "The trousers and the belt." },
      shoe_color: { type: "string" },
      shirt_color: { type: "string", description: "The shirt under a vest or a cardigan, and its collar (cream when left out)." },
      skirt: { type: "boolean", description: "true: a tunic or armour gets a skirt over the legs. Everyone wears trousers unless this is given (a robe is always a long dress)." },
      hat: { type: "string", description: CHARACTER3D.hats.join(", ") },
      hat_color: { type: "string", description: "A bucket hat's, a round cap's or (on a chibi animal) a soft peaked cap's colour (the trim colour when left out)." },
      hat_size: { type: "number", description: "A bucket hat's or a chibi animal's peaked cap's size, 0.6 to 1.6 (1 when left out): on an animal's big head the bucket hat is a slouchy oversized hat and the peaked cap a soft postal cap with a short peak, both with holes for pointed ears; bigger is roomier (and broader in the brim)." },
      hat_band_color: { type: "string", description: "The band round a bucket hat's or a chibi animal's peaked cap's crown and the rims of its ear holes, and (a shade darker) the cap's peak (a shade darker than the hat when left out)." },
      hat_pin: { type: "string", description: `A small pin on the front of a bucket hat, a round cap or a chibi animal's peaked cap: ${CHARACTER3D.emblems.join(", ")}.` },
      pack: { type: "string", description: CHARACTER3D.packs.join(", ") },
      item: { type: "string", description: CHARACTER3D.items.join(", ") },
      species: { type: "string", description: `${CHARACTER3D.species.join(", ")}: an animal person (fur, muzzle, ears, tail, paws) when not human.` },
      fur: { type: "string", description: "An animal's coat, \"#rrggbb\" or a colour word (its own when left out)." },
      fur2: { type: "string", description: "An animal's lighter fur: muzzle, cheeks, the tail's tip." },
      head_scale: { type: "number", description: "The head's size against a person's, 0.8 to 2.2 (1 for a human, about 1.55 for an animal when left out)." },
      accessory: { type: "string", description: CHARACTER3D.accessories.join(", ") },
      accent_color: { type: "string", description: "The accessory's colour." },
      emblem: { type: "string", description: `A chibi's: ${CHARACTER3D.emblems.join(", ")}: painted on the chest (a postman's envelope, a radio ham's bolt).` },
      entity: { type: "string", description: 'Also write entities/<this>.lua, a third-person walker using the model ("hero"), unless there is one already.' },
      palette: PALETTE,
      seed: SEED,
    },
    ["name"],
    (a) => {
      const root = h.root(a);
      const name = h.safeName(a.name, "Model");
      const made = makeCharacter3d(a);
      // (a painted face: its picture goes beside the model, and model_write puts it in the .glb)
      const picture = made.picture ? `models/${name}.texture.png` : undefined;
      if (made.picture) h.put(root, picture!, encodePng(made.picture));
      const wrote = text(h.call("model_write", { project: a.project, name, model: made.model, bend: true, ...(picture ? { picture } : {}) }));
      const speeds: Record<string, number> = {};
      for (const m of wrote.matchAll(/clip "(\w+)": a walk[^\n]*?does not slide when the entity moves ([\d.]+) world units a second|clip "(\w+)": a walk[^\n]*?do not slide when the entity moves ([\d.]+) world units a second/g)) speeds[(m[1] ?? m[3])!] = Number(m[2] ?? m[4]);
      const walk = speeds.walk ?? made.speeds.walk!, run = speeds.run ?? made.speeds.run!, trot = speeds.trot ?? made.speeds.trot!;
      let also = "";
      if (a.entity !== undefined) {
        const ent = h.safeName(a.entity, "Entity");
        also = entity(root, ent, characterEntity(name, { walk, run }, made), true);
      }
      const still = h.call("model_preview", { project: a.project, name, view: "quarter" });
      const strip = h.call("model_preview", { project: a.project, name, clip: "walk", strip: 8 });
      const heights = text(strip).split("\n").filter((l) => /^\s+(whole model|time \(s\))/.test(l));
      return {
        text: [
          `models/${name}.model.json and models/${name}.glb${also}: ${made.says}`,
          `parts: ${made.parts.join(", ")} (hips is the root; a thing held goes in hand_r, on the back in spine)`,
          `clips: ${made.clips.map((c) => `${c.name} ${c.duration} s${c.loop ? " (loops)" : ""}${c.events.length ? ` [${c.events.join(", ")}]` : ""}`).join("; ")}`,
          `speeds at which the feet do not slide: walk ${walk} m/s, run ${run} m/s, trot ${trot} m/s (at another speed play the clip faster: speed = wanted / that)`,
          `capsule for nova.solid.move: radius ${made.capsule.radius}, height ${made.capsule.height} (the feet at the entity's y)`,
          ...(made.faces ? [made.faces] : []),
          "in an entity:",
          ...made.lua(name, { walk, run }).split("\n").map((l) => `  ${l}`),
          "the walk, eight moments (second picture); the lowest point of the whole figure at each:",
          ...heights,
          ...(/WARNING|too short/.test(wrote) ? wrote.split("\n").filter((l) => /WARNING|too short/.test(l)) : []),
        ].join("\n"),
        images: [...images(still), ...images(strip)],
      };
    },
  );

  h.tool(
    "creature3d_make",
    `Make a rigged 3D creature from an archetype: ${CREATURES3D.join(", ")}. \`models/<name>.model.json\` and \`.glb\`, low-poly like the characters, standing on y = 0 and facing +z, with clips idle, move (loops; its feet do not slide at the speed the answer gives) and hurt. \`color\` and \`second_color\` recolour it; \`size\` scales it (1 is its own size). ` +
      "It returns model_preview's picture and the move clip as a strip. An ordinary model afterwards.",
    {
      name: { type: "string" },
      kind: { type: "string", description: CREATURES3D.join(", ") },
      color: { type: "string", description: '"#rrggbb" or a colour word; each kind has its own when left out.' },
      second_color: { type: "string" },
      size: { type: "number", description: "A factor on its own size, 0.5 to 3 (1 when left out)." },
      palette: PALETTE,
      seed: SEED,
    },
    ["name", "kind"],
    (a) => {
      const name = h.safeName(a.name, "Model");
      const made = makeCreature3d(a);
      const wrote = text(h.call("model_write", { project: a.project, name, model: made.model, bend: true }));
      const m = /does not slide when the entity moves ([\d.]+) world units a second|do not slide when the entity moves ([\d.]+) world units a second/.exec(wrote);
      const speed = m ? Number(m[1] ?? m[2]) : made.speed;
      const still = h.call("model_preview", { project: a.project, name, view: "quarter" });
      const strip = h.call("model_preview", { project: a.project, name, clip: "move", strip: 8 });
      return {
        text: [
          `models/${name}.model.json and models/${name}.glb: ${made.says}`,
          `parts: ${made.parts.join(", ")}`,
          `clips: ${made.clips.map((c) => `${c.name} ${c.duration} s${c.loop ? " (loops)" : ""}`).join("; ")}`,
          `moves at ${speed} m/s without sliding (play "move" faster or slower in step with its speed)`,
          `capsule for nova.solid.move: radius ${made.capsule.radius}, height ${made.capsule.height}`,
          `in an entity: nova.entity { model = "${name}", tags = { "enemy" } }, self:play_clip("move") while it moves and self:play_clip("idle") when it stands; self.ry = math.atan(dx, dz) turns it the way it goes`,
        ].join("\n"),
        images: [...images(still), ...images(strip)],
      };
    },
  );

  h.tool(
    "ground3d_make",
    "Make the ground of a 3D level from a small map of characters, as scene_write's `paint` does in 2D: `models/<name>.model.json` and `.glb`, one mesh with gentle hills, the paths and paved places drawn into it with soft edges, and `entities/<name>.lua` (solid, so a body walks on it). " +
      `\`map\` is rows of characters, the first row furthest away (-z) and each character a square of \`cell\` metres (2); \`legend\` says what each is: ${GROUND_KINDS.join(", ")} ({ ".": "grass", "p": "path", "s": "paved", "w": "water" }; "." is grass and "p", "s", "w", "a" mean path, paved, water, sand when there is no legend). ` +
      "The middle of the map is the model's origin, so place it at 0, 0, 0 and everything else by the map: the answer gives the size and the [x, z] of each character's first square. Paths and paved places are level and a little sunk; grass rises and falls by `hills` metres (0.5; 0 is flat) away from them; water lies 0.3 lower; the edge runs on flat for `skirt` metres (40) so the level does not end in a line against the sky. " +
      "nova.solid.floor_below(x, 50, z) gives the ground's height for placing things by code; objects in a scene file stand on y = 0, which the paths and paved places are at. It returns model_preview's picture from above.",
    {
      name: { type: "string", description: 'The model\'s name ("ground").' },
      map: { type: "array", items: { type: "string" }, description: "Rows of characters, all the same length; the first row is the far edge (-z), the first character of a row the left edge (-x)." },
      legend: { type: "object", description: `What each character is: ${GROUND_KINDS.join(", ")}.` },
      cell: { type: "number", description: "The side of one character's square in metres, 1 to 8 (2 when left out)." },
      hills: { type: "number", description: "How far the grass rises and falls, in metres, 0 to 3 (0.5 when left out)." },
      skirt: { type: "number", description: "How far the ground runs on past the map's edge, in metres (40 when left out; 0 for none)." },
      painted: { type: "boolean", description: 'true: the land is painted as ground in the game (`paint: "ground"`: soft patches of warmer and cooler colour, brush strokes near the camera that fade further off, slopes facing the sun warmer; docs/project-format.md, "Painted surfaces").' },
      entity: { type: "boolean", description: "false: do not write entities/<name>.lua." },
      palette: PALETTE,
      seed: SEED,
    },
    ["name", "map"],
    (a) => {
      const root = h.root(a);
      const name = h.safeName(a.name, "Model");
      const made = makeGround(a);
      h.call("model_write", { project: a.project, name, model: made.model });
      const wrote = entity(root, name, `-- The ground: ${made.says}.\n-- solid = true: bodies moved with nova.solid.move walk on it, and the follow camera stays above it. It casts no shadow of its own.\nlocal Ground = nova.entity { model = "${name}", solid = true }\n\nfunction Ground:draw()\n  nova.model("${name}", self.x, self.y, self.z or 0, { shadow = false })\nend\n\nreturn Ground\n`, a.entity);
      const shown = h.call("model_preview", { project: a.project, name, yaw: 0, pitch: 50, distance: Math.max(made.width, made.depth * 1.4) * 1.05 });
      return {
        text: [
          `models/${name}.model.json and models/${name}.glb${wrote}: ${made.says}`,
          `the map covers x ${-made.width / 2} to ${made.width / 2}, z ${-made.depth / 2} to ${made.depth / 2} (its middle is the model's origin; a character at column c, row r is the square round x = ${-made.width / 2} + (c + 0.5) * ${made.cell}, z = ${-made.depth / 2} + (r + 0.5) * ${made.cell})`,
          ...made.where,
          `in the scene: { "kind": "${name}", "x": 0, "y": 0, "z": 0 } (first in the list). Its paths and paved places are at height 0; the grass is up to ${made.hills} higher or lower, so stand tall things on the paths or give them the ground's height: nova.solid.floor_below(x, 50, z).`,
          text(shown).split("\n").slice(-1)[0] ?? "",
        ].join("\n"),
        images: images(shown),
      };
    },
  );

  return {
    prop3d_make: { kinds: ["tree", "pine", "rock", "bush", "arch", "pillar", "gem"], palette: "bright meadow" },
    character3d_make: { name: "hero", hair: "short", hair_color: "brown", outfit: "tunic", outfit_color: "teal", pack: "backpack", entity: "hero" },
    creature3d_make: { name: "fox", kind: "quadruped", color: "orange" },
    ground3d_make: { name: "ground", map: ["........", "..pppp..", "..psspp.", "..psspp.", "...pp...", "...pp..."], legend: { ".": "grass", p: "path", s: "paved" } },
  };
}

export { PALETTE_NAMES };
