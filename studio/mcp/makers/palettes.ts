// The named palettes every maker shares, so a game's art agrees with itself: the same grass, wood, stone and outline in
// the tiles, the characters, the creatures and the icons. A palette is a set of materials (each a ramp of five shades,
// dark to light), an outline colour and a light that everything drawn for it is tinted towards.

import { colourOf, hex, isHex, mix, ramp, rampOf, toHex, type Ramp, type Rgba } from "./paint";

export const MATERIALS = ["grass", "path", "sand", "water", "stone", "wood", "brick", "leaf", "trunk", "roof", "rock", "plaster", "flower", "flower2", "flower3", "metal", "gold"] as const;
export type Material = (typeof MATERIALS)[number];

export interface Palette {
  name: string;
  outline: Rgba;
  mat: Record<Material, Ramp>;
  /// What sprites (characters, creatures, icons) are tinted towards, and how far (0 to 1): moonlight at night, lamp light in a dungeon.
  light: Rgba;
  amount: number;
}

type Recipe = { outline: string; light?: [string, number] } & Record<Material, string>;

const MEADOW: Recipe = {
  outline: "#2b2438",
  grass: "#63b24c", path: "#d2aa6c", sand: "#ecd9a0", water: "#4593dc", stone: "#9ca2ae", wood: "#b47c48", brick: "#b9573f",
  leaf: "#3f9349", trunk: "#7c5435", roof: "#cb5540", rock: "#8f95a0", plaster: "#e8dcc0", flower: "#f0596d", flower2: "#f7d84c", flower3: "#f4f1ea",
  metal: "#b9c0cc", gold: "#e9b63a",
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
    metal: "#8f96a6", gold: "#c9982f",
  },
  night: { ...MEADOW, outline: "#141228", light: ["#28386c", 0.3] },
};

export const PALETTE_NAMES = Object.keys(RECIPES);

/// Night is the meadow by moonlight: every material darkened and pulled towards blue.
const moonlit = (c: Rgba): Rgba => {
  const m = mix(c, hex("#1c2a5c"), 0.5);
  return [Math.round(m[0] * 0.74), Math.round(m[1] * 0.8), Math.round(m[2] * 0.96), 255];
};

function build(name: string, recipe: Recipe, ramps: Partial<Record<Material, Ramp>> = {}): Palette {
  const night = name === "night";
  const mat = {} as Record<Material, Ramp>;
  for (const m of MATERIALS) mat[m] = ramps[m] ?? ramp(night ? moonlit(hex(recipe[m])) : hex(recipe[m]));
  return { name, outline: hex(recipe.outline), mat, light: hex(recipe.light?.[0] ?? "#ffffff"), amount: recipe.light?.[1] ?? 0 };
}

const PALETTE_HELP = `a palette is one of ${PALETTE_NAMES.map((n) => `"${n}"`).join(", ")}, or your own: { "base": "autumn", "grass": "#88aa33", "water": ["#1b2f5c", "#27488a", "#3565b8", "#5f8fd8", "#a8c8f0"], "outline": "#201828" } (any of ${MATERIALS.join(", ")}; one colour, or five shades dark to light)`;

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
  const unknown = Object.keys(o).filter((k) => !["base", "outline", "light", "name", ...MATERIALS].includes(k));
  if (unknown.length) throw new Error(`palette has "${unknown.join('", "')}", which is not a material: ${PALETTE_HELP}`);
  const out: Palette = { ...base, name: typeof o.name === "string" ? o.name : `${base.name} (changed)`, mat: { ...base.mat } };
  for (const m of MATERIALS) if (o[m] !== undefined) out.mat[m] = rampOf(o[m], `palette.${m}`);
  if (o.outline !== undefined) out.outline = colourOf(o.outline, "palette.outline");
  if (isHex(o.light)) {
    out.light = hex(o.light);
    out.amount = Math.max(out.amount, 0.1);
  }
  return out;
}

/// A sprite's colour as this palette's light shows it.
export const lit = (p: Palette, c: Rgba): Rgba => (p.amount ? mix(c, [p.light[0], p.light[1], p.light[2], c[3]], p.amount) : c);
export const litRamp = (p: Palette, c: Rgba): Ramp => ramp(lit(p, c));

/// The palettes in words, for a tool's description and its answers.
export function describePalette(p: Palette): string {
  return `palette "${p.name}": outline ${toHex(p.outline)}, ${(["grass", "path", "water", "stone", "wood", "leaf"] as Material[]).map((m) => `${m} ${toHex(p.mat[m][2])}`).join(", ")}`;
}
