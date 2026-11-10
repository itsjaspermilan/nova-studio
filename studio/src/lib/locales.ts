// Languages: `locales/<code>.json` is a flat object of key to text, one file per language (docs/project-format.md, "Languages"). The studio shows all of
// them as one table, a row per key and a column per language, so a missing line is easy to see. Pure functions; the editor keeps the state.

export interface LocaleTable {
  /// Language codes, in the order of the columns.
  languages: string[];
  /// Keys in the order of the rows.
  keys: string[];
  /// text[language][key]; a key a language does not have is simply absent.
  text: Record<string, Record<string, string>>;
}

export const isLanguageCode = (s: string) => /^[A-Za-z0-9_-]{1,16}$/.test(s);
export const isKey = (s: string) => s.length > 0 && s.length <= 120 && !/[\s"\\]/.test(s);

export function parseLocale(text: string): { ok: true; map: Record<string, string> } | { ok: false; error: string } {
  let v: unknown;
  try {
    v = JSON.parse(text || "{}");
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return { ok: false, error: "A language file is an object of text." };
  const map: Record<string, string> = {};
  for (const [k, t] of Object.entries(v)) {
    if (typeof t !== "string") return { ok: false, error: `"${k}" must be text.` };
    map[k] = t;
  }
  return { ok: true, map };
}

/// The table for a set of files. The rows follow the first language that has each key, so a new key lands where its author put it.
export function buildTable(files: { code: string; text: string }[]): { table: LocaleTable; errors: { code: string; error: string }[] } {
  const table: LocaleTable = { languages: [], keys: [], text: {} };
  const errors: { code: string; error: string }[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    const p = parseLocale(f.text);
    if (!p.ok) {
      errors.push({ code: f.code, error: p.error });
      continue;
    }
    table.languages.push(f.code);
    table.text[f.code] = p.map;
    for (const k of Object.keys(p.map)) if (!seen.has(k)) (seen.add(k), table.keys.push(k));
  }
  return { table, errors };
}

/// The file text for one language: keys in row order, empty texts left out (so "missing" stays visible in the table and the game falls back).
export function serialize(t: LocaleTable, lang: string): string {
  const o: Record<string, string> = {};
  for (const k of t.keys) {
    const v = t.text[lang]?.[k];
    if (v) o[k] = v;
  }
  return `${JSON.stringify(o, null, 2)}\n`;
}

const copy = (t: LocaleTable): LocaleTable => ({ languages: [...t.languages], keys: [...t.keys], text: Object.fromEntries(Object.entries(t.text).map(([l, m]) => [l, { ...m }])) });

export function setText(t: LocaleTable, lang: string, key: string, value: string): LocaleTable {
  if (!t.languages.includes(lang) || !t.keys.includes(key)) return t;
  const n = copy(t);
  if (value === "") delete n.text[lang]![key];
  else n.text[lang]![key] = value;
  return n;
}

export function addKey(t: LocaleTable, key: string, at?: number): LocaleTable {
  if (!isKey(key) || t.keys.includes(key)) return t;
  const n = copy(t);
  n.keys.splice(at ?? n.keys.length, 0, key);
  return n;
}

export function renameKey(t: LocaleTable, from: string, to: string): LocaleTable {
  if (from === to || !isKey(to) || !t.keys.includes(from) || t.keys.includes(to)) return t;
  const n = copy(t);
  n.keys = n.keys.map((k) => (k === from ? to : k));
  for (const l of n.languages) {
    const m = n.text[l]!;
    if (from in m) {
      m[to] = m[from]!;
      delete m[from];
    }
  }
  return n;
}

export function deleteKey(t: LocaleTable, key: string): LocaleTable {
  if (!t.keys.includes(key)) return t;
  const n = copy(t);
  n.keys = n.keys.filter((k) => k !== key);
  for (const l of n.languages) delete n.text[l]![key];
  return n;
}

export function addLanguage(t: LocaleTable, code: string): LocaleTable {
  if (!isLanguageCode(code) || t.languages.includes(code)) return t;
  const n = copy(t);
  n.languages.push(code);
  n.text[code] = {};
  return n;
}

export function removeLanguage(t: LocaleTable, code: string): LocaleTable {
  if (!t.languages.includes(code)) return t;
  const n = copy(t);
  n.languages = n.languages.filter((l) => l !== code);
  delete n.text[code];
  return n;
}

/// The cells with no text, for every language after the first (the first is the one the game falls back to).
export function missing(t: LocaleTable): { lang: string; key: string }[] {
  const out: { lang: string; key: string }[] = [];
  for (const l of t.languages) for (const k of t.keys) if (!t.text[l]?.[k]) out.push({ lang: l, key: k });
  return out;
}

export const placeholders = (text: string): string[] => [...new Set([...text.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]!))].sort();

/// Texts whose {names} differ from the first language's text for the same key (a translator dropped or invented one).
export function placeholderProblems(t: LocaleTable): { lang: string; key: string; message: string }[] {
  const base = t.languages[0];
  if (!base) return [];
  const out: { lang: string; key: string; message: string }[] = [];
  for (const k of t.keys) {
    const want = placeholders(t.text[base]?.[k] ?? "");
    for (const l of t.languages.slice(1)) {
      const mine = t.text[l]?.[k];
      if (!mine) continue;
      const have = placeholders(mine);
      if (want.length && want.join() !== have.join()) out.push({ lang: l, key: k, message: `uses {${have.join("}, {")}} but ${base} uses {${want.join("}, {")}}` });
      else if (!want.length && have.length) out.push({ lang: l, key: k, message: `has {${have.join("}, {")}} that ${base} does not` });
    }
  }
  return out;
}

/// Keys the game uses with nova.t that no language has, and keys no code uses: found by reading the Lua files for `nova.t("key"`.
export function keysUsed(luaSources: string[]): string[] {
  const out = new Set<string>();
  for (const s of luaSources) for (const m of s.matchAll(/\bnova\.t\(\s*(["'])((?:(?!\1).)+)\1/g)) out.add(m[2]!);
  return [...out].sort();
}

const csvCell = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/// The table as CSV (a header row `key,en,fr…`), for a translator who works in a spreadsheet.
export function toCsv(t: LocaleTable): string {
  const rows = [["key", ...t.languages], ...t.keys.map((k) => [k, ...t.languages.map((l) => t.text[l]?.[k] ?? "")])];
  return `${rows.map((r) => r.map(csvCell).join(",")).join("\n")}\n`;
}

/// Reads that CSV back: the header names the languages (new codes are added, unknown keys become rows). Returns null for a file that is not that shape.
export function fromCsv(t: LocaleTable, csv: string): LocaleTable | null {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i]!;
    if (quoted) {
      if (c === '"' && csv[i + 1] === '"') (cell += '"', i++);
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") (row.push(cell), (cell = ""));
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && csv[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((x) => x !== "") || row.length > 1) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== "" || row.length) (row.push(cell), rows.push(row));
  const header = rows[0];
  if (!header || header[0] !== "key" || header.length < 2) return null;
  const codes = header.slice(1);
  if (!codes.every(isLanguageCode)) return null;
  let n = t;
  for (const code of codes) n = addLanguage(n, code);
  for (const r of rows.slice(1)) {
    const key = r[0] ?? "";
    if (!isKey(key)) continue;
    n = addKey(n, key);
    codes.forEach((code, i) => {
      const v = r[i + 1];
      if (v !== undefined) n = setText(n, code, key, v);
    });
  }
  return n;
}
