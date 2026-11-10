// Palettes kept in the project (`palettes.json` at its top) so that Sprites and Model draw from the same colours, and so that they travel with the project and its
// version history instead of staying on one computer.

import { normalizeHex, MAX_PALETTE, type Palette } from "./palette";

export const PROJECT_PALETTES_PATH = "palettes.json";
export const MAX_PROJECT_PALETTES = 32;

export type ParsedProjectPalettes = { ok: true; palettes: Palette[] } | { ok: false; error: string };

export function parseProjectPalettes(text: string): ParsedProjectPalettes {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `palettes.json is not valid JSON: ${e instanceof Error ? e.message : e}` };
  }
  const list = (v as { palettes?: unknown })?.palettes;
  if (!Array.isArray(list) || list.length > MAX_PROJECT_PALETTES) return { ok: false, error: `palettes.json needs a "palettes" list of up to ${MAX_PROJECT_PALETTES}` };
  const out: Palette[] = [];
  for (const [i, p] of (list as { name?: unknown; colors?: unknown }[]).entries()) {
    if (!p || typeof p.name !== "string" || !p.name.trim() || !Array.isArray(p.colors) || p.colors.length > MAX_PALETTE) return { ok: false, error: `palettes[${i}] needs a name and up to ${MAX_PALETTE} colours` };
    if (out.some((q) => q.name === p.name)) return { ok: false, error: `two palettes are called "${p.name}"` };
    const colors: string[] = [];
    for (const c of p.colors) {
      const hex = typeof c === "string" ? normalizeHex(c) : null;
      if (!hex) return { ok: false, error: `palettes[${i}] has a colour that is not like #rrggbb` };
      if (!colors.includes(hex)) colors.push(hex);
    }
    out.push({ name: p.name.trim(), colors });
  }
  return { ok: true, palettes: out };
}

export function serializeProjectPalettes(palettes: Palette[]): string {
  const rows = palettes.slice(0, MAX_PROJECT_PALETTES).map((p) => `    { "name": ${JSON.stringify(p.name)}, "colors": ${JSON.stringify(p.colors)} }`);
  return `{\n  "version": 1,\n  "palettes": [\n${rows.join(",\n")}\n  ]\n}\n`;
}

/// The project's palettes with `add` put in: a palette of the same name is replaced, the others kept, up to the limit.
export function withPalettes(project: Palette[], add: Palette[]): Palette[] {
  const out = [...project];
  for (const p of add) {
    const at = out.findIndex((q) => q.name === p.name);
    if (at >= 0) out[at] = p;
    else if (out.length < MAX_PROJECT_PALETTES) out.push(p);
  }
  return out;
}
