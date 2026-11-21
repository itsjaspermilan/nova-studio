// prop3d_make's detailed kinds: the natural and built scenery first made for Pine Ridge Rally (makers/scenery/nature.mjs, built.mjs),
// by kind, species and season. Each preset is one of the models that game ships, by its name, so a call that names the same preset
// with seed 1 writes exactly that model. A seed other than 1 grows another tree of the same species (the natural kinds; built
// things are made to measure and have no variants), `height` scales it, the palette picks the season, and the collider rule is
// prop3d's: what you would walk into blocks (a trunk, a rock, a stand), what you walk through does not (grass, flowers, a cloud).

import type { Prop } from "./prop3d";
// @ts-ignore (plain JavaScript, moved from scripts/rally)
import { BEFORE, buildPreset } from "./scenery/nature.mjs";
// @ts-ignore
import { MODELS as BUILT } from "./scenery/built.mjs";

type Args = Record<string, any>;
type Season = "summer" | "autumn" | "snow" | "night";

/// kind -> species -> season -> preset (a Pine Ridge Rally model's name). The first species and the first season are the defaults.
const NATURE: Record<string, Record<string, Partial<Record<Season, string>>>> = {
  broadleaf: { default: { summer: "nk_default", autumn: "nk_default_fall" }, oak: { summer: "nk_oak", autumn: "nk_oak_fall" }, tall: { summer: "nk_tall", autumn: "nk_tall_fall" }, fat: { summer: "nk_fat" }, thin: { summer: "nk_thin" }, birch: { summer: "birch" }, maple: { autumn: "autumn_tree" } },
  conifer: {
    tall_a: { summer: "nk_pinetall_a", snow: "nk_snow_pinetall_a", night: "nk_night_pinetall_a" }, tall_b: { summer: "nk_pinetall_b" }, tall_c: { summer: "nk_pinetall_c", snow: "nk_snow_pinetall_c", night: "nk_night_pinetall_c" }, tall_d: { summer: "nk_pinetall_d", snow: "nk_snow_pinetall_d" },
    round_a: { summer: "nk_pineround_a", snow: "nk_snow_pineround_a", night: "nk_night_pineround_a" }, round_c: { summer: "nk_pineround_c" }, round_e: { summer: "nk_pineround_e", snow: "nk_snow_pineround_e", night: "nk_night_pineround_e" },
    small_a: { summer: "nk_pinesmall_a", snow: "nk_snow_pinesmall_a", night: "nk_night_pinesmall_a" }, small_c: { summer: "nk_pinesmall_c" }, fir: { summer: "pine", snow: "pine_snow" }, spruce: { summer: "pine_dark" },
  },
  dead_tree: { tall: { summer: "nk_dead_tall" }, thin: { summer: "nk_dead_thin" } },
  shrub: { round: { summer: "bush", snow: "bush_snow" }, detailed: { summer: "nk_bush_detailed" }, large: { summer: "nk_bush_large" }, low: { summer: "nk_bush_tri" }, dry: { summer: "dry_bush" } },
  grass: { tuft: { summer: "grass" } },
  flowers: { meadow: { summer: "flowers" } },
  cactus: { saguaro: { summer: "cactus" }, tall: { summer: "nk_cactus_tall" }, short: { summer: "nk_cactus_short" } },
  boulder: {
    rock: { summer: "rock", snow: "rock_ice", autumn: "rock_red" }, large_a: { summer: "nk_rock_largeA", snow: "nk_rockice_largeA", autumn: "nk_rockred_largeA" }, large_c: { summer: "nk_rock_largeC", snow: "nk_rockice_largeC", autumn: "nk_rockred_largeC" },
    large_e: { summer: "nk_rock_largeE", snow: "nk_rockice_largeE", autumn: "nk_rockred_largeE" }, tall_b: { summer: "nk_rock_tallB", snow: "nk_rockice_tallB", autumn: "nk_rockred_tallB" }, tall_f: { summer: "nk_rock_tallF", snow: "nk_rockice_tallF", autumn: "nk_rockred_tallF" }, tall_h: { summer: "nk_rock_tallH", snow: "nk_rockice_tallH", autumn: "nk_rockred_tallH" },
  },
  log: { fallen: { summer: "nk_log" } },
  stump: { cut: { summer: "nk_stump" } },
  mesa: { red: { summer: "mesa" } },
  mountain: { range: { summer: "mountain", snow: "mountain_ice", night: "mountain_night", autumn: "mountain_red" } },
  cloud: { cumulus: { summer: "cloud" } },
};
/// kind -> species -> preset, for the built things (no seasons).
const BUILT_KINDS: Record<string, Record<string, string>> = {
  guardrail: { single: "guardrail", double: "rail_double" },
  barrier: { wall: "barrier_wall", red: "barrier_red", white: "barrier_white" },
  cone: { pylon: "pylon" },
  tyre_stack: { stack: "tires" },
  hay_bale: { bale: "hay_bale" },
  fence: { mesh: "fence" },
  chevron: { sign: "sign_chevron" },
  flag: { green: "flag_green", red: "flag_red", checkers: "flag_checkers" },
  banner: { green: "banner_green", red: "banner_red" },
  billboard: { stripes: "billboard", chequers: "billboard_low" },
  lamp: { trackside: "lamp" },
  light_post: { floodlight: "light_post" },
  arch: { start: "start_arch" },
  gantry: { truss: "gantry", round: "gantry_round" },
  grandstand: { open: "grandstand", covered: "grandstand_covered", awning: "grandstand_awning" },
  tower: { control: "tower" },
  garage: { pit: "garage" },
  pit_office: { flat: "pits_office", roof: "pits_office_roof" },
  tent: { open: "tent", long: "tent_long", closed: "tent_closed" },
  camera_tower: { scaffold: "camera_tower" },
  radar: { dish: "radar" },
  grid_box: { box: "grid_box" },
  steering_wheel: { wheel: "steering_wheel" },
  spectator: { woman_a: "crowd_fa", woman_b: "crowd_fb", woman_c: "crowd_fc", woman_d: "crowd_fd", man_a: "crowd_ma", man_b: "crowd_mb", man_c: "crowd_mc", man_d: "crowd_md" },
};
export const DETAILED_KINDS = [...Object.keys(NATURE), ...Object.keys(BUILT_KINDS)];
/// The low-style kind a detailed one stands for when both exist (prop3d_make's `style: "detailed"` turns tree into broadleaf...).
export const DETAILED_OF: Record<string, string> = { tree: "broadleaf", pine: "conifer", bush: "shrub", rock: "boulder", dead_tree: "dead_tree", grass: "grass", flowers: "flowers", log: "log", fence: "fence", arch: "arch", sign: "chevron", lantern: "lamp", tower: "tower" };
export const speciesOf = (kind: string): string[] => Object.keys(NATURE[kind] ?? BUILT_KINDS[kind] ?? {});

/// prop3d's palettes as seasons: what the trees wear and which rocks lie about.
const SEASON_OF: Record<string, Season> = { autumn: "autumn", snow: "snow", night: "night", desert: "autumn" };

/// What blocks, by kind (prop3d's rule: circles in model units round what you would walk into; nothing for what you walk through).
function collidersFor(kind: string, model: Args, scale: number): Args {
  if (model.colliders?.length || model.boxes?.length) return {};
  const pts: number[][] = [];
  for (const p of model.parts) for (const c of p.cubes) for (const v of c.verts ?? []) pts.push(v);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const v of pts) { x0 = Math.min(x0, v[0]!); x1 = Math.max(x1, v[0]!); z0 = Math.min(z0, v[2]!); z1 = Math.max(z1, v[2]!); }
  const r2 = (v: number) => Math.round(v * 100) / 100, cx = r2((x0 + x1) / 2), cz = r2((z0 + z1) / 2), half = Math.min(x1 - x0, z1 - z0) / 2;
  switch (kind) {
    case "broadleaf": case "conifer": case "dead_tree": return { colliders: [{ x: 0, z: 0, r: r2(Math.max(4, 6 * scale)) }] }; // (the trunk)
    case "boulder": case "stump": case "shrub": case "cactus": return { colliders: [{ x: cx, z: cz, r: r2(half * 0.85) }] };
    case "log": case "barrier": case "guardrail": case "grandstand": case "garage": case "pit_office": case "tent": case "billboard": case "hay_bale": case "tyre_stack": case "camera_tower": case "radar":
      return { boxes: [{ x: cx, z: cz, hw: r2((x1 - x0) / 2), hl: r2((z1 - z0) / 2), turn: 0 }] };
    case "cone": case "lamp": case "light_post": case "chevron": case "flag": case "banner": case "steering_wheel": return { colliders: [{ x: cx, z: cz, r: r2(Math.max(3, half)) }] };
    default: return {}; // grass, flowers, mesa (its own), mountain and cloud (far away), arch and gantry (driven under), spectators
  }
}
const SOLID = new Set(["broadleaf", "conifer", "dead_tree", "boulder", "stump", "cactus", "log", "barrier", "guardrail", "grandstand", "garage", "pit_office", "tent", "billboard", "hay_bale", "tyre_stack", "camera_tower", "radar", "cone", "lamp", "light_post", "chevron", "flag", "banner", "tower", "mesa", "fence"]);

/// A detailed prop: `kind` (a detailed kind, or a low one's name with style "detailed"), `species`, `season` (or from the palette), `seed`, `height` (metres).
export function makeScenery(a: Args, name: string): Prop {
  const kind = DETAILED_OF[a.kind] && a.style === "detailed" ? DETAILED_OF[a.kind]! : String(a.kind);
  const seed = a.seed === undefined ? 1 : a.seed;
  let preset: string, natural = false;
  const species = a.species ?? speciesOf(kind)[0];
  if (NATURE[kind]) {
    natural = true;
    const sp = NATURE[kind]![species];
    if (!sp) throw new Error(`a ${kind}'s species are ${speciesOf(kind).join(", ")}, not ${JSON.stringify(a.species)}`);
    const season: Season = a.season ?? SEASON_OF[typeof a.palette === "string" ? a.palette : ""] ?? "summer";
    const got = sp[season] ?? (a.season === undefined ? Object.values(sp)[0] : undefined);
    if (!got) throw new Error(`a ${species} ${kind} comes in ${Object.keys(sp).join(", ")}, not ${season}`);
    preset = got;
  } else if (BUILT_KINDS[kind]) {
    const p = BUILT_KINDS[kind]![species];
    if (!p) throw new Error(`a ${kind} comes as ${speciesOf(kind).join(", ")}, not ${JSON.stringify(a.species)}`);
    preset = p;
  } else throw new Error(`no detailed kind "${a.kind}"`);
  // the size: the preset's own, or scaled to a height in metres (natural kinds only: built things are made to measure)
  let scale = 1;
  if (a.height !== undefined) {
    if (!natural) throw new Error(`a ${kind} is built to measure: scale it where it is placed ("props": { "sx": 1.2 })`);
    const own = BEFORE[preset].hi[1] - BEFORE[preset].lo[1];
    scale = Math.max(0.25, Math.min(4, Number(a.height) / own));
  }
  // a seed is a number (1: the preset itself) or a word, which is hashed into the salt
  const salt = typeof seed === "string" ? [...seed].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619), 2166136261) >>> 0 : seed === 1 ? 0 : Math.imul(Number(seed), 2654435761) >>> 0;
  let model: Args;
  if (natural) model = buildPreset(preset, { part: name, salt, scale });
  else model = BUILT[preset]();
  const extra = a.colliders === false ? {} : collidersFor(kind, model, scale);
  model = { ...model, ...extra };
  // the box round it, in metres
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const visit = (p: Args, at: number[]) => {
    const o = [at[0]! + p.origin[0], at[1]! + p.origin[1], at[2]! + p.origin[2]];
    for (const c of p.cubes) for (const v of c.verts ?? []) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k]!, (o[k]! + v[k]) * model.scale); hi[k] = Math.max(hi[k]!, (o[k]! + v[k]) * model.scale); }
    for (const ch of p.children ?? []) visit(ch, o);
  };
  for (const p of model.parts) visit(p, [0, 0, 0]);
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const people = kind === "spectator";
  const says = `${people ? `a spectator (${species}) at half life size (place it with "props": { "sx": 2 }), with clips static, idle, watch, cheer, clap and wave` : `a detailed ${species === "default" || speciesOf(kind).length === 1 ? "" : `${species.replace(/_/g, " ")} `}${kind.replace(/_/g, " ")}`}${natural && seed !== 1 ? ` (seed ${seed})` : ""}`;
  return {
    kind: kind as Prop["kind"], model, says,
    entity: { static: !people, solid: SOLID.has(kind) && a.colliders !== false },
    size: { w: r2(hi[0]! - lo[0]!), h: r2(hi[1]! - lo[1]!), d: r2(hi[2]! - lo[2]!) },
  };
}
