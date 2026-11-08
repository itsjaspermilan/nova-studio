// Reads a Lua table constructor of plain values ({ 4, min = 0, help = "fast", choices = { "a", "b" } }) without running
// any Lua. Text, numbers, true/false and nested tables are read; anything else (a variable, a call, arithmetic) is
// skipped and marked as `UNKNOWN`, so one clever value never hides the plain ones around it.

export const UNKNOWN: unique symbol = Symbol("not a plain value");
export type LuaValue = string | number | boolean | null | LuaTable | typeof UNKNOWN;
export interface LuaTable {
  /// Positional entries, in order (the first is `list[0]`).
  list: LuaValue[];
  /// `name = value` and `["name"] = value` entries, in the order written.
  fields: Map<string, LuaValue>;
}

type Token = { t: "str"; v: string } | { t: "num"; v: number } | { t: "name"; v: string } | { t: "sym"; v: string } | { t: "end" };

const ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r", a: "\x07", b: "\b", f: "\f", v: "\v", "\\": "\\", '"': '"', "'": "'", "\n": "\n" };

/// The source as tokens, with comments dropped.
function tokens(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const longBracket = (at: number): { level: number; start: number } | null => {
    const m = /^\[(=*)\[/.exec(src.slice(at, at + 64));
    return m ? { level: m[1]!.length, start: at + m[0].length } : null;
  };
  const longEnd = (from: number, level: number) => {
    const close = `]${"=".repeat(level)}]`;
    const end = src.indexOf(close, from);
    return end < 0 ? { body: src.slice(from), next: src.length } : { body: src.slice(from, end), next: end + close.length };
  };
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) { i++; continue; }
    if (src.startsWith("--", i)) {
      const lb = longBracket(i + 2);
      if (lb) i = longEnd(lb.start, lb.level).next;
      else { const nl = src.indexOf("\n", i); i = nl < 0 ? src.length : nl + 1; }
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let v = "";
      while (j < src.length && src[j] !== c && src[j] !== "\n") {
        if (src[j] === "\\" && j + 1 < src.length) {
          const e = src[j + 1]!;
          if (/\d/.test(e)) {
            const m = /^\d{1,3}/.exec(src.slice(j + 1))![0];
            v += String.fromCharCode(Number(m));
            j += 1 + m.length;
            continue;
          }
          if (e === "x") { v += String.fromCharCode(parseInt(src.slice(j + 2, j + 4), 16) || 0); j += 4; continue; }
          v += ESCAPES[e] ?? e;
          j += 2;
          continue;
        }
        v += src[j];
        j++;
      }
      out.push({ t: "str", v });
      i = j + 1;
      continue;
    }
    if (c === "[") {
      const lb = longBracket(i);
      if (lb) {
        const { body, next } = longEnd(lb.start, lb.level);
        out.push({ t: "str", v: body.replace(/^\r?\n/, "") });
        i = next;
        continue;
      }
    }
    const num = /^(0[xX][0-9a-fA-F]+|(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?)/.exec(src.slice(i, i + 64));
    if (num && /[\d.]/.test(c) && !(c === "." && !/\d/.test(src[i + 1] ?? ""))) {
      out.push({ t: "num", v: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i, i + 256));
    if (name) {
      out.push({ t: "name", v: name[0] });
      i += name[0].length;
      continue;
    }
    const sym = /^(\.\.\.|\.\.|==|~=|<=|>=|<<|>>|\/\/|::|.)/s.exec(src.slice(i, i + 3))![0];
    out.push({ t: "sym", v: sym });
    i += sym.length;
  }
  out.push({ t: "end" });
  return out;
}

class Reader {
  i = 0;
  constructor(readonly toks: Token[]) {}
  peek(ahead = 0) { return this.toks[Math.min(this.i + ahead, this.toks.length - 1)]!; }
  next() { return this.toks[Math.min(this.i++, this.toks.length - 1)]!; }
  isSym(v: string, ahead = 0) { const t = this.peek(ahead); return t.t === "sym" && t.v === v; }

  /// A whole expression up to the next `,` `;` or closing bracket at this level.
  value(): LuaValue {
    const start = this.i;
    const first = this.simple();
    if (first !== UNKNOWN && this.atEnd()) return first;
    // not a plain value: skip the rest of the expression
    this.i = start;
    let depth = 0;
    while (this.peek().t !== "end") {
      const t = this.peek();
      if (t.t === "sym" && (t.v === "{" || t.v === "(" || t.v === "[")) depth++;
      else if (t.t === "sym" && (t.v === "}" || t.v === ")" || t.v === "]")) {
        if (depth === 0) break;
        depth--;
      } else if (depth === 0 && t.t === "sym" && (t.v === "," || t.v === ";")) break;
      this.next();
    }
    return UNKNOWN;
  }

  atEnd() { const t = this.peek(); return t.t === "end" || (t.t === "sym" && [",", ";", "}", "]"].includes(t.v)); }

  simple(): LuaValue {
    const t = this.next();
    if (t.t === "str" || t.t === "num") return t.v;
    if (t.t === "name") {
      if (t.v === "true") return true;
      if (t.v === "false") return false;
      if (t.v === "nil") return null;
      return UNKNOWN;
    }
    if (t.t === "sym" && t.v === "-" && this.peek().t === "num") return -(this.next() as { v: number }).v;
    if (t.t === "sym" && t.v === "{") return this.table();
    return UNKNOWN;
  }

  /// After the opening `{`.
  table(): LuaTable {
    const out: LuaTable = { list: [], fields: new Map() };
    while (this.peek().t !== "end" && !this.isSym("}")) {
      const t = this.peek();
      if (t.t === "name" && this.isSym("=", 1)) {
        this.i += 2;
        out.fields.set(t.v, this.value());
      } else if (this.isSym("[")) {
        this.next();
        const key = this.value();
        if (this.isSym("]")) this.next();
        if (this.isSym("=")) this.next();
        const v = this.value();
        if (typeof key === "string") out.fields.set(key, v);
        else if (typeof key === "number" && Number.isInteger(key) && key >= 1) out.list[key - 1] = v;
      } else {
        out.list.push(this.value());
      }
      if (this.isSym(",") || this.isSym(";")) this.next();
      else if (!this.isSym("}")) this.next(); // something unexpected: step over it rather than loop
    }
    if (this.isSym("}")) this.next();
    return out;
  }
}

/// Reads `{ ... }` (the text must start with the opening brace, after any spaces and comments).
export function parseLuaTable(src: string): LuaTable | null {
  const r = new Reader(tokens(src));
  if (!r.isSym("{")) return null;
  r.next();
  return r.table();
}

export const isTable = (v: LuaValue | undefined): v is LuaTable => typeof v === "object" && v !== null;

/// A plain value as JSON (a table with only positional entries is a list, one with only names an object); null when
/// it has anything that is not plain.
export function toJson(v: LuaValue | undefined): unknown {
  if (v === undefined || v === UNKNOWN) return undefined;
  if (!isTable(v)) return v;
  if (v.fields.size === 0) {
    const list = v.list.map(toJson);
    return list.some((x) => x === undefined) ? undefined : list;
  }
  if (v.list.length) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, x] of v.fields) {
    const j = toJson(x);
    if (j === undefined) return undefined;
    out[k] = j;
  }
  return out;
}
