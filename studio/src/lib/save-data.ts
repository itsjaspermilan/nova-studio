// The save-data inspector's pure side: reading a `save.json` (`{ "format": 1, "data": { ... } }`, see crates/nova-runtime/src/save.rs) into one row per
// key, changing a key's value from text the person typed, and putting the file back together. The backend checks again before it writes.

export interface SaveRow {
  key: string;
  kind: "number" | "string" | "boolean" | "list" | "table" | "null";
  /// One short line for the list.
  preview: string;
  /// The value as editable JSON.
  json: string;
}

export const MAX_KEY_CHARS = 128;
export const MAX_BYTES = 1 << 20;

export type ParsedSave = { ok: true; data: Record<string, unknown> } | { ok: false; error: string };

export function parseSave(text: string): ParsedSave {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `Not valid JSON: ${e instanceof Error ? e.message : e}` };
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return { ok: false, error: "A save is an object." };
  const o = v as Record<string, unknown>;
  if (o.format !== 1) return { ok: false, error: `"format" must be 1 (it is ${o.format === undefined ? "missing" : JSON.stringify(o.format)}).` };
  if (!o.data || typeof o.data !== "object" || Array.isArray(o.data)) return { ok: false, error: '"data" must be an object of values.' };
  return { ok: true, data: o.data as Record<string, unknown> };
}

const kindOf = (v: unknown): SaveRow["kind"] => (v === null ? "null" : Array.isArray(v) ? "list" : typeof v === "object" ? "table" : (typeof v as "number" | "string" | "boolean"));

function preview(v: unknown, kind: SaveRow["kind"]): string {
  if (kind === "string") return JSON.stringify((v as string).length > 60 ? `${(v as string).slice(0, 57)}…` : v);
  if (kind === "list") return `${(v as unknown[]).length} item${(v as unknown[]).length === 1 ? "" : "s"}`;
  if (kind === "table") return `${Object.keys(v as object).length} key${Object.keys(v as object).length === 1 ? "" : "s"}`;
  return String(v);
}

export function rowsOf(data: Record<string, unknown>): SaveRow[] {
  return Object.keys(data)
    .sort((a, b) => a.localeCompare(b))
    .map((key) => {
      const v = data[key];
      const kind = kindOf(v);
      return { key, kind, preview: preview(v, kind), json: JSON.stringify(v, null, kind === "list" || kind === "table" ? 2 : 0) };
    });
}

const write = (data: Record<string, unknown>) => `${JSON.stringify({ format: 1, data }, null, 2)}\n`;

/// Sets one key from the value as typed. Text that is JSON (a number, true, a quoted string, a list or table) is used as that; anything else
/// is taken as a plain string, so typing `hello` for a string works. `null` is refused: a save holds numbers, text, true/false, lists and tables.
export function withValue(text: string, key: string, typed: string): { ok: true; text: string } | { ok: false; error: string } {
  const p = parseSave(text);
  if (!p.ok) return p;
  if (key.length < 1 || [...key].length > MAX_KEY_CHARS) return { ok: false, error: `A key is 1 to ${MAX_KEY_CHARS} characters.` };
  let value: unknown;
  const t = typed.trim();
  try {
    value = JSON.parse(t);
  } catch {
    value = typed;
  }
  if (value === null) return { ok: false, error: "A save cannot hold null; delete the key instead." };
  const next = write({ ...p.data, [key]: value });
  if (new TextEncoder().encode(next).length > MAX_BYTES) return { ok: false, error: `That would make the save bigger than ${MAX_BYTES >> 10} KiB.` };
  return { ok: true, text: next };
}

export function withoutKey(text: string, key: string): string {
  const p = parseSave(text);
  if (!p.ok || !(key in p.data)) return text;
  const { [key]: _gone, ...rest } = p.data;
  return write(rest);
}

export const EMPTY_SAVE = `${JSON.stringify({ format: 1, data: {} }, null, 2)}\n`;
