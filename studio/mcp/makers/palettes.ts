// The named palettes every maker shares, so a game's art agrees with itself: the same grass, wood, stone and outline in
// the tiles, the characters, the creatures and the icons. A palette is a set of materials (each a ramp of five shades,
// dark to light), an outline colour and a light that everything drawn for it is tinted towards.
//
// Every palette also carries two ACCENTS: the colours of things that glow (a neon sign, an enemy's tell, a pickup, a lit
// visor). The city palettes ("gutter market", "bloom labs", "hollow line", "spire") are dark streets where only those two
// colours shine, and the makers use them for every glow: accent 1 for the first thing that matters, accent 2 for the second.

import { colourOf, hex, isHex, mix, ramp, rampOf, toHex, type Ramp, type Rgba } from "./paint";

export const MATERIALS = [
  "grass", "path", "sand", "water", "stone", "wood", "brick", "leaf", "trunk", "roof", "rock", "plaster", "flower", "flower2", "flower3", "metal", "gold",
  // the city's: a wet street, cast concrete, floor plate, window glass, small floor tiles, polished stone, old iron
  "asphalt", "concrete", "plate", "glass", "tile", "marble", "rust",
] as const;
export type Material = (typeof MATERIALS)[number];

export interface Palette {
  name: string;
  outline: Rgba;
  mat: Record<Material, Ramp>;
  /// What sprites (characters, creatures, icons) are tinted towards, and how far (0 to 1): moonlight at night, lamp light in a dungeon.
  light: Rgba;
  amount: number;
  /// The two glow colours, each a ramp whose middle shade (2) is the colour itself: accent[0] is accent 1.
  accent: [Ramp, Ramp];
  /// A dark city palette: its tiles and sprites are drawn for a night street (rim light on sprites, the city's terrains
  /// and props when a tileset names none).
  city: boolean;
}

type Shades = string | [string, string, string, string, string];
type Recipe = { outline: string; light?: [string, number]; accent?: [string, string]; city?: boolean } & Record<Material, Shades>;

const MEADOW: Recipe = {
  outline: "#2b2438",
  grass: "#63b24c", path: "#d2aa6c", sand: "#ecd9a0", water: "#4593dc", stone: "#9ca2ae", wood: "#b47c48", brick: "#b9573f",
  leaf: "#3f9349", trunk: "#7c5435", roof: "#cb5540", rock: "#8f95a0", plaster: "#e8dcc0", flower: "#f0596d", flower2: "#f7d84c", flower3: "#f4f1ea",
  metal: "#b9c0cc", gold: "#e9b63a",
  asphalt: "#5a5e6a", concrete: "#a4a29a", plate: "#8e96a4", glass: "#8cc4dc", tile: "#dcdcd2", marble: "#e8e4dc", rust: "#9c5c3a",
  accent: ["#ffd23c", "#4fd8ff"],
};

// The four districts of a drowned city. Dark ground, two neon colours each, everything else held back so that what glows
// is what matters. Shades are written out where a plain ramp would go muddy in the dark.
const GUTTER: Recipe = {
  outline: "#0a0912", light: ["#3a2c6c", 0.16], city: true, accent: ["#ff3fa4", "#35e6ff"],
  asphalt: ["#0f121c", "#171b29", "#20263a", "#2f3850", "#4a5878"],
  concrete: ["#1e202b", "#2c2f3d", "#3c4052", "#545a70", "#737a92"],
  plate: ["#1c202b", "#2a303e", "#3a4254", "#55607a", "#7a87a2"],
  glass: ["#14202c", "#1f3242", "#2d485c", "#4a7088", "#86b0c4"],
  tile: ["#1b1d27", "#272a37", "#343848", "#4b5064", "#666c84"],
  marble: ["#3a3c4c", "#5a5c6e", "#7c7e90", "#a2a4b4", "#c6c8d4"],
  rust: ["#24120e", "#3e2016", "#5c3222", "#80492e", "#a46a44"],
  grass: "#2e4436", path: "#433d4c", sand: "#56505e", water: ["#0a1222", "#111d33", "#1a2a46", "#2a4064", "#4a6a96"], stone: "#464a5c",
  wood: "#56402f", brick: "#563240", leaf: "#2a5444", trunk: "#382b28", roof: ["#1e1424", "#2e1e36", "#42294c", "#5c3a66", "#7c5088"],
  rock: "#44465a", plaster: "#5e5c6e", flower: "#b02e66", flower2: "#c8a040", flower3: "#c4cada", metal: ["#2c303c", "#454b5c", "#646c80", "#8c96aa", "#c0c8d8"], gold: "#b88c34",
};

const RECIPES: Record<string, Recipe> = {
  "bright meadow": MEADOW,
  autumn: {
    ...MEADOW, outline: "#33222b", light: ["#d9903a", 0.07],
    grass: "#b0a44c", path: "#b98c5a", sand: "#dcc48e", water: "#4f88ba", leaf: "#d9762d", trunk: "#614331", roof: "#8f4039", brick: "#a8553c",
    flower: "#c9412f", flower2: "#e8b03a", flower3: "#f0e0c0", plaster: "#e3d2ae",
  },
  desert: {
    ...MEADOW, outline: "#3b2a2a", light: ["#f2c070", 0.07],
    grass: "#cbb86c", path: "#c99158", sand: "#f1d48e", water: "#41b2c2", stone: "#c6a880", wood: "#a8733f", brick: "#cb7c4d", leaf: "#7fa24a",
    trunk: "#86603a", roof: "#b7693f", rock: "#b28e68", plaster: "#f3e4c2", flower: "#e8594a", flower2: "#f0a83a", flower3: "#f6efe0",
  },
  snow: {
    ...MEADOW, outline: "#27304a", light: ["#cfe0ff", 0.08],
    grass: "#e6edf5", path: "#b3a48f", sand: "#cdd7e6", water: "#74b8e2", stone: "#909cb2", wood: "#8c674a", brick: "#9c5c54", leaf: "#3f7c6c",
    trunk: "#5f4a3e", roof: "#5c719c", rock: "#98a4b8", plaster: "#dfe3ea", flower: "#d95c7a", flower2: "#8fb8e8", flower3: "#ffffff",
  },
  dungeon: {
    ...MEADOW, outline: "#17131f", light: ["#3a3448", 0.12],
    grass: "#4e6d4c", path: "#6d5c4c", sand: "#8c7d64", water: "#31617c", stone: "#6f6a7a", wood: "#70523a", brick: "#6c515c", leaf: "#3e5e46",
    trunk: "#4a382c", roof: "#4c465a", rock: "#5e5a6a", plaster: "#8e867a", flower: "#b0485c", flower2: "#c9a03c", flower3: "#b8b4c4",
    metal: "#8f96a6", gold: "#c9982f", accent: ["#ffb03a", "#7ad0ff"],
  },
  night: { ...MEADOW, outline: "#141228", light: ["#28386c", 0.3], accent: ["#ffd86a", "#8ab8ff"] },
  // street level: rain on blue-black asphalt; magenta and cyan
  "gutter market": GUTTER,
  // a sunken biotech campus: teal-grey glass, pale tile; acid green and violet
  "bloom labs": {
    ...GUTTER, outline: "#081012", light: ["#1c4a48", 0.14], accent: ["#a6ff2e", "#a35cff"],
    asphalt: ["#0e1616", "#172222", "#213030", "#304444", "#4a6262"],
    concrete: ["#1a2424", "#283636", "#384a4a", "#506666", "#728a88"],
    plate: ["#1a2426", "#273538", "#36494c", "#506a6c", "#7a9698"],
    glass: ["#0e2226", "#163438", "#204a4e", "#3a7276", "#7cb6b4"],
    tile: ["#34423f", "#4c5c59", "#667873", "#8a9c96", "#b2c2bb"],
    marble: ["#3e4a4a", "#5a6868", "#7a8a88", "#a0b0ac", "#c6d4d0"],
    rust: ["#1e1a12", "#34301c", "#4c4626", "#6a6234", "#8a8248"],
    grass: "#36603a", leaf: "#2e6a3c", water: ["#071a18", "#0d2a26", "#153e38", "#265a50", "#468a7a"], metal: ["#283436", "#40504e", "#5e706e", "#8aa09c", "#bcd0ca"],
    roof: ["#12201e", "#1c302e", "#284442", "#3a5e5a", "#527c76"], flower: "#8c3ac8", flower2: "#b8d040",
  },
  // an abandoned metro held by rebels: soot, concrete, rust; amber and red
  "hollow line": {
    ...GUTTER, outline: "#0e0a08", light: ["#4a2c18", 0.14], accent: ["#ffaa1e", "#ff3a2a"],
    asphalt: ["#110e0d", "#1b1716", "#262120", "#383130", "#544a46"],
    concrete: ["#221e1c", "#332e2a", "#46403b", "#625a53", "#867c72"],
    plate: ["#1e1a18", "#2d2825", "#3e3834", "#5a524c", "#7e746c"],
    glass: ["#141616", "#202426", "#2e3436", "#4a5254", "#76807e"],
    tile: ["#211c1a", "#302a27", "#413a36", "#5a524c", "#787068"],
    marble: ["#383230", "#544c48", "#726864", "#968a84", "#b8aca4"],
    rust: ["#260f08", "#43190c", "#642812", "#8a3c1c", "#b0582c"],
    grass: "#3a3a2a", leaf: "#3a4228", water: ["#0a0c0e", "#121619", "#1c2226", "#2c3438", "#4a5458"], metal: ["#2a2624", "#443e3a", "#645c56", "#8c827a", "#b8aea4"],
    roof: ["#1c1210", "#2c1c18", "#3e2822", "#583830", "#764c40"], gold: "#c08a2a", flower: "#b8402a",
  },
  // the corporate floors: white marble in pale gold light, shadows cold blue; white and gold
  spire: {
    ...GUTTER, outline: "#141a30", light: ["#ffe8b0", 0.06], accent: ["#f4f8ff", "#ffc23a"],
    asphalt: ["#2a3248", "#3c4660", "#525e7c", "#76829e", "#a2acc4"],
    concrete: ["#4a5470", "#6a7490", "#8c96b0", "#b2bace", "#d8dce8"],
    plate: ["#3a4460", "#56607c", "#76809c", "#9ea8c0", "#c8cede"],
    glass: ["#24324e", "#34486c", "#4a6690", "#7a98bc", "#bcd0e6"],
    tile: ["#4c5878", "#7a86a4", "#a8b2c8", "#ccd2e0", "#eceef4"],
    marble: ["#4a5878", "#8a98b8", "#ccd2e2", "#e8ebf2", "#ffffff"],
    rust: ["#4a3a2a", "#6c5438", "#8e7046", "#b29458", "#d6b878"],
    grass: "#4c7a5a", leaf: "#3e7058", water: ["#1a2a48", "#26406a", "#36588c", "#5a80b0", "#9ab8dc"], stone: "#9aa4bc",
    wood: "#7a5a40", metal: ["#3c4660", "#66708c", "#9aa4bc", "#c8d0e0", "#f2f4fa"], gold: ["#6a4a18", "#9a7024", "#cc9a34", "#e8c25a", "#fbe6a0"],
    roof: ["#2a3450", "#3e4a6a", "#56648a", "#7a88aa", "#a6b2cc"], plaster: "#d8dce6", flower: "#c84a5a", flower2: "#e8c25a", flower3: "#f4f6fa",
  },
};

export const PALETTE_NAMES = Object.keys(RECIPES);
/// The four city palettes, one for each district of a drowned city.
export const CITY_PALETTES = PALETTE_NAMES.filter((n) => RECIPES[n]!.city);

/// Night is the meadow by moonlight: every material darkened and pulled towards blue.
const moonlit = (c: Rgba): Rgba => {
  const m = mix(c, hex("#1c2a5c"), 0.5);
  return [Math.round(m[0] * 0.74), Math.round(m[1] * 0.8), Math.round(m[2] * 0.96), 255];
};

const shadesOf = (v: Shades, night: boolean): Ramp => (Array.isArray(v) ? (v.map((c) => hex(c)) as Ramp) : ramp(night ? moonlit(hex(v)) : hex(v)));

function build(name: string, recipe: Recipe, ramps: Partial<Record<Material, Ramp>> = {}): Palette {
  const night = name === "night";
  const mat = {} as Record<Material, Ramp>;
  for (const m of MATERIALS) mat[m] = ramps[m] ?? shadesOf(recipe[m], night);
  const [a1, a2] = recipe.accent ?? MEADOW.accent!;
  return {
    name, outline: hex(recipe.outline), mat, light: hex(recipe.light?.[0] ?? "#ffffff"), amount: recipe.light?.[1] ?? 0,
    accent: [ramp(hex(a1)), ramp(hex(a2))], city: !!recipe.city,
  };
}

const PALETTE_HELP = `a palette is one of ${PALETTE_NAMES.map((n) => `"${n}"`).join(", ")}, or your own: { "base": "autumn", "grass": "#88aa33", "water": ["#1b2f5c", "#27488a", "#3565b8", "#5f8fd8", "#a8c8f0"], "outline": "#201828", "accent": "#ff3fa4", "accent2": "#35e6ff" } (any of ${MATERIALS.join(", ")}; one colour, or five shades dark to light; "accent" and "accent2" are the two glow colours)`;

/// The palette a recipe names: a name, or an object that starts from one and replaces some materials.
export function paletteOf(given: unknown): Palette {
  if (given === undefined || given === null || given === "") return build("bright meadow", MEADOW);
  if (typeof given === "string") {
    const key = given.trim().toLowerCase().replace(/[_-]/g, " ");
    const hit = RECIPES[key] ?? RECIPES[PALETTE_NAMES.find((n) => n.split(" ").includes(key)) ?? ""];
    if (!hit) throw new Error(`there is no palette '${given}': ${PALETTE_HELP}`);
    return build(PALETTE_NAMES.find((n) => RECIPES[n] === hit)!, hit);
  }
  if (typeof given !== "object" || Array.isArray(given)) throw new Error(`palette is ${JSON.stringify(given)}: ${PALETTE_HELP}`);
  const o = given as Record<string, unknown>;
  const base = paletteOf(o.base ?? "bright meadow");
  const unknown = Object.keys(o).filter((k) => !["base", "outline", "light", "name", "accent", "accent2", "accent1", ...MATERIALS].includes(k));
  if (unknown.length) throw new Error(`palette has "${unknown.join('", "')}", which is not a material: ${PALETTE_HELP}`);
  const out: Palette = { ...base, name: typeof o.name === "string" ? o.name : `${base.name} (changed)`, mat: { ...base.mat }, accent: [...base.accent] };
  for (const m of MATERIALS) if (o[m] !== undefined) out.mat[m] = rampOf(o[m], `palette.${m}`);
  if (o.outline !== undefined) out.outline = colourOf(o.outline, "palette.outline");
  if (isHex(o.light)) {
    out.light = hex(o.light);
    out.amount = Math.max(out.amount, 0.1);
  }
  const first = o.accent ?? o.accent1;
  if (first !== undefined) out.accent[0] = ramp(colourOf(first, "palette.accent"));
  if (o.accent2 !== undefined) out.accent[1] = ramp(colourOf(o.accent2, "palette.accent2"));
  return out;
}

/// A sprite's colour as this palette's light shows it.
export const lit = (p: Palette, c: Rgba): Rgba => (p.amount ? mix(c, [p.light[0], p.light[1], p.light[2], c[3]], p.amount) : c);
export const litRamp = (p: Palette, c: Rgba): Ramp => ramp(lit(p, c));

/// Accent 1 or 2 by number, or a colour written out ("#ff3fa4", "cyan"); null when nothing was given.
export function accentOf(p: Palette, given: unknown, what: string): Ramp | null {
  if (given === undefined || given === null || given === "") return null;
  const s = String(given).trim().toLowerCase().replace(/[\s_]/g, "");
  if (s === "1" || s === "accent" || s === "accent1") return p.accent[0];
  if (s === "2" || s === "accent2") return p.accent[1];
  if (s === "cyan") return ramp(hex("#35e6ff"));
  if (s === "magenta") return ramp(hex("#ff3fa4"));
  if (s === "acid" || s === "lime") return ramp(hex("#a6ff2e"));
  if (s === "amber") return ramp(hex("#ffaa1e"));
  return ramp(colourOf(given, `${what} (1 or 2 for the palette's accents, or a colour)`));
}

/// The palettes in words, for a tool's description and its answers.
export function describePalette(p: Palette): string {
  const mats: Material[] = p.city ? ["asphalt", "concrete", "plate", "glass", "tile", "marble"] : ["grass", "path", "water", "stone", "wood", "leaf"];
  return `palette "${p.name}": outline ${toHex(p.outline)}, ${mats.map((m) => `${m} ${toHex(p.mat[m][2])}`).join(", ")}${p.city ? `, accent 1 ${toHex(p.accent[0][2])}, accent 2 ${toHex(p.accent[1][2])}` : ""}`;
}
