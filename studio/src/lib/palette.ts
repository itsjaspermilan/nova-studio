// Palettes: named lists of colours. Read and written in the formats other tools use (GIMP's .gpl, a plain list of hex colours as Lospec offers,
// and a small JSON), and kept in the studio between runs. Colours are always "#rrggbb".

export interface Palette {
  name: string;
  colors: string[];
}

export const MAX_PALETTE = 256;

const HEX = /^#?([0-9a-fA-F]{6})$/;
export const normalizeHex = (text: string): string | null => {
  const m = HEX.exec(text.trim());
  return m ? `#${m[1]!.toLowerCase()}` : null;
};
const unique = (colors: string[]) => [...new Set(colors)].slice(0, MAX_PALETTE);

/// GIMP's palette file: "GIMP Palette", "Name: ...", then "R G B name" lines.
export function parseGpl(text: string, fallbackName = "Palette"): Palette | null {
  const lines = text.split(/\r?\n/);
  if (!lines[0]?.trim().startsWith("GIMP Palette")) return null;
  let name = fallbackName;
  const colors: string[] = [];
  for (const line of lines.slice(1)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const n = /^Name:\s*(.+)$/i.exec(t);
    if (n) {
      name = n[1]!.trim();
      continue;
    }
    if (/^Columns:/i.test(t)) continue;
    const m = /^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})/.exec(t);
    if (!m) continue;
    const [r, g, b] = [m[1], m[2], m[3]].map((v) => Math.min(255, Number(v)));
    colors.push(`#${[r, g, b].map((v) => v!.toString(16).padStart(2, "0")).join("")}`);
  }
  return colors.length ? { name, colors: unique(colors) } : null;
}

export function toGpl(p: Palette): string {
  const rows = p.colors.map((c) => {
    const v = parseInt(c.slice(1), 16);
    return `${(v >> 16) & 255} ${(v >> 8) & 255} ${v & 255}\t${c}`;
  });
  return `GIMP Palette\nName: ${p.name}\nColumns: 8\n#\n${rows.join("\n")}\n`;
}

/// A list with one hex colour per line (Lospec's ".hex" files), or colours separated by spaces or commas.
export function parseHexList(text: string, fallbackName = "Palette"): Palette | null {
  const colors = text
    .split(/[\s,;]+/)
    .map(normalizeHex)
    .filter((c): c is string => c !== null);
  return colors.length ? { name: fallbackName, colors: unique(colors) } : null;
}

export const toHexList = (p: Palette): string => `${p.colors.map((c) => c.slice(1)).join("\n")}\n`;

/// { "name": "...", "colors": ["#rrggbb", ...] }
export function parsePaletteJson(text: string, fallbackName = "Palette"): Palette | null {
  try {
    const o = JSON.parse(text) as { name?: unknown; colors?: unknown };
    if (!o || !Array.isArray(o.colors)) return null;
    const colors = o.colors.map((c) => (typeof c === "string" ? normalizeHex(c) : null)).filter((c): c is string => c !== null);
    return colors.length ? { name: typeof o.name === "string" && o.name.trim() ? o.name.trim() : fallbackName, colors: unique(colors) } : null;
  } catch {
    return null;
  }
}

export const toPaletteJson = (p: Palette): string => `${JSON.stringify({ name: p.name, colors: p.colors }, null, 2)}\n`;

/// Reads a palette in whichever of the three formats it is in; the file's name (without its extension) is the name when the file has none.
export function parsePalette(text: string, fileName = "Palette"): Palette | null {
  const base = fileName.replace(/\.[^.]*$/, "") || "Palette";
  const body = text.trim();
  if (body.startsWith("GIMP Palette")) return parseGpl(text, base);
  if (body.startsWith("{")) return parsePaletteJson(text, base);
  return parseHexList(text, base);
}

const distance = (a: string, b: string) => {
  const [x, y] = [parseInt(a.slice(1), 16), parseInt(b.slice(1), 16)];
  const [dr, dg, db] = [((x >> 16) & 255) - ((y >> 16) & 255), ((x >> 8) & 255) - ((y >> 8) & 255), (x & 255) - (y & 255)];
  // (the eye is most sensitive to green, least to blue)
  return 0.3 * dr * dr + 0.59 * dg * dg + 0.11 * db * db;
};

/// The colour of a palette closest to a colour (the colour itself when the palette is empty).
export function nearestColor(palette: string[], color: string): string {
  let best = color;
  let bestD = Infinity;
  for (const c of palette) {
    const d = distance(c, color);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

export const BUILTIN: Palette[] = [
  {
    name: "Starter",
    colors: [
      "#000000", "#2b2b3a", "#555566", "#8a8a99", "#c4c4d0", "#ffffff", "#5b2a1a", "#8b4a2b", "#c27a3e", "#f2b66d", "#f7e3a1", "#7a1f2b", "#c1272d", "#ef5b4c", "#f79a8b", "#ffd0c4",
      "#1f3d2b", "#2f7d46", "#6cc24a", "#b8e986", "#16335c", "#2a62c9", "#4fa3ff", "#a5d4ff", "#3b1d63", "#7b3fc4", "#b78cf2", "#e0c8ff", "#0f5c5c", "#1fb5ad", "#ff7ab6", "#ffe14d",
    ],
  },
  { name: "Greys", colors: ["#000000", "#202020", "#404040", "#606060", "#808080", "#a0a0a0", "#c0c0c0", "#e0e0e0", "#ffffff"] },
];

const STORE = "nova.palettes.v1";

/// The palettes the person made or imported (the built-in ones are always there), and which is in use.
export class PaletteStore {
  user: Palette[] = [];
  current = BUILTIN[0]!.name;
  #storage: Pick<Storage, "getItem" | "setItem">;

  constructor(storage?: Pick<Storage, "getItem" | "setItem">) {
    this.#storage = storage ?? (typeof localStorage === "undefined" ? { getItem: () => null, setItem: () => {} } : localStorage);
    try {
      const raw = this.#storage.getItem(STORE);
      if (raw) {
        const s = JSON.parse(raw) as { user?: unknown; current?: unknown };
        if (Array.isArray(s.user)) this.user = s.user.map((p) => parsePaletteJson(JSON.stringify(p))).filter((p): p is Palette => p !== null);
        if (typeof s.current === "string") this.current = s.current;
      }
    } catch {
      // unreadable: the built-in palettes
    }
    if (!this.all().some((p) => p.name === this.current)) this.current = BUILTIN[0]!.name;
  }

  all(): Palette[] {
    return [...BUILTIN, ...this.user];
  }
  get(name = this.current): Palette {
    return this.all().find((p) => p.name === name) ?? BUILTIN[0]!;
  }
  isBuiltin = (name: string) => BUILTIN.some((p) => p.name === name);

  /// Adds a palette (a name that is taken gets a number) and makes it the current one. Returns the name it was saved under.
  add(p: Palette): string {
    let name = p.name.trim() || "Palette";
    for (let n = 2; this.all().some((q) => q.name === name); n++) name = `${p.name.trim() || "Palette"} ${n}`;
    this.user = [...this.user, { name, colors: unique(p.colors) }];
    this.current = name;
    this.#save();
    return name;
  }
  select(name: string) {
    if (this.all().some((p) => p.name === name)) this.current = name;
    this.#save();
  }
  /// Changes the colours of a palette of the person's own (the built-in ones are left alone).
  setColors(name: string, colors: string[]) {
    this.user = this.user.map((p) => (p.name === name ? { ...p, colors: unique(colors) } : p));
    this.#save();
  }
  remove(name: string) {
    this.user = this.user.filter((p) => p.name !== name);
    if (this.current === name) this.current = BUILTIN[0]!.name;
    this.#save();
  }

  #save() {
    try {
      this.#storage.setItem(STORE, JSON.stringify({ user: this.user, current: this.current }));
    } catch {
      // not remembered
    }
  }
}
