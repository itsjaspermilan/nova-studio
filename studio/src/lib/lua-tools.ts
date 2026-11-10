// Code help for Lua that needs no running game: a small tokenizer (it knows strings, long strings and comments, so a name inside one is never
// taken for code), where names are defined, where they are used, a rename, a formatter and the code snippets. Pure functions; the editor calls them.

export type TokenKind = "name" | "keyword" | "number" | "string" | "comment" | "symbol";
export interface Token {
  kind: TokenKind;
  text: string;
  /// Character offset in the text, and 1-based line and column of its first character.
  from: number;
  line: number;
  col: number;
}

const KEYWORDS = new Set(["and", "break", "do", "else", "elseif", "end", "false", "for", "function", "goto", "if", "in", "local", "nil", "not", "or", "repeat", "return", "then", "true", "until", "while"]);

/// Splits Lua source into tokens. Never throws: an unclosed string or comment runs to the end of the text.
export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;
  const n = text.length;
  const push = (kind: TokenKind, from: number, to: number, startLine: number, startCol: number) => out.push({ kind, text: text.slice(from, to), from, line: startLine, col: startCol });
  const advance = (to: number) => {
    for (let k = i; k < to; k++) if (text[k] === "\n") (line++, (lineStart = k + 1));
    i = to;
  };
  const longBracket = (at: number): number => {
    // "[" "="* "[" : returns the number of "=" or -1
    if (text[at] !== "[") return -1;
    let k = at + 1;
    while (text[k] === "=") k++;
    return text[k] === "[" ? k - at - 1 : -1;
  };
  const closeOf = (from: number, level: number): number => {
    const end = text.indexOf(`]${"=".repeat(level)}]`, from);
    return end < 0 ? n : end + level + 2;
  };
  while (i < n) {
    const c = text[i]!;
    const startLine = line;
    const startCol = i - lineStart + 1;
    if (c === "\n" || c === " " || c === "\t" || c === "\r") {
      advance(i + 1);
    } else if (c === "-" && text[i + 1] === "-") {
      const level = longBracket(i + 2);
      const from = i;
      const to = level >= 0 ? closeOf(i + 4 + level, level) : (text.indexOf("\n", i) < 0 ? n : text.indexOf("\n", i));
      advance(to);
      push("comment", from, to, startLine, startCol);
    } else if (c === '"' || c === "'") {
      let k = i + 1;
      while (k < n && text[k] !== c && text[k] !== "\n") k += text[k] === "\\" ? 2 : 1;
      const to = Math.min(n, text[k] === c ? k + 1 : k);
      const from = i;
      advance(to);
      push("string", from, to, startLine, startCol);
    } else if (c === "[" && longBracket(i) >= 0) {
      const level = longBracket(i);
      const to = closeOf(i + level + 2, level);
      const from = i;
      advance(to);
      push("string", from, to, startLine, startCol);
    } else if (/[A-Za-z_]/.test(c)) {
      let k = i + 1;
      while (k < n && /[A-Za-z0-9_]/.test(text[k]!)) k++;
      const word = text.slice(i, k);
      const from = i;
      advance(k);
      push(KEYWORDS.has(word) ? "keyword" : "name", from, k, startLine, startCol);
    } else if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(text[i + 1] ?? ""))) {
      let k = i + 1;
      while (k < n && /[0-9A-Za-z_.]/.test(text[k]!)) k += /[eE]/.test(text[k]!) && /[+-]/.test(text[k + 1] ?? "") ? 2 : 1;
      const from = i;
      advance(k);
      push("number", from, k, startLine, startCol);
    } else {
      const three = text.slice(i, i + 3);
      const two = text.slice(i, i + 2);
      const len = three === "..." ? 3 : ["==", "~=", "<=", ">=", "..", "::", "//", "<<", ">>"].includes(two) ? 2 : 1;
      const from = i;
      advance(i + len);
      push("symbol", from, i, startLine, startCol);
    }
  }
  return out;
}

export type DefinitionKind = "function" | "method" | "local" | "global" | "field" | "parameter";
export interface Definition {
  name: string;
  /// For `function a.b:c()` the whole dotted name, otherwise the same as `name`.
  fullName: string;
  kind: DefinitionKind;
  path: string;
  line: number;
  col: number;
  from: number;
  /// For functions: the parameter list as written, e.g. "(x, y)".
  signature?: string;
}

const code = (tokens: Token[]) => tokens.filter((t) => t.kind !== "comment");

/// Finds the names a file defines: functions (plain, local, dotted, methods), locals, top-level assignments and parameters.
export function definitionsIn(path: string, text: string): Definition[] {
  const t = code(tokenize(text));
  const defs: Definition[] = [];
  let depth = 0;
  const at = (k: number) => t[k];
  const sig = (open: number) => {
    let k = open;
    let s = "";
    while (k < t.length && at(k)!.text !== ")") s += at(k++)!.text + (at(k - 1)!.text === "," ? " " : "");
    return `${s})`;
  };
  const params = (open: number) => {
    for (let k = open + 1; k < t.length && at(k)!.text !== ")"; k++) {
      const p = at(k)!;
      if (p.kind === "name") defs.push({ name: p.text, fullName: p.text, kind: "parameter", path, line: p.line, col: p.col, from: p.from });
    }
  };
  for (let i = 0; i < t.length; i++) {
    const tok = at(i)!;
    if (tok.kind === "keyword") {
      if (tok.text === "function") {
        // function name, a.b.c, a:b ; or an anonymous function
        const isLocal = at(i - 1)?.text === "local";
        let k = i + 1;
        const parts: Token[] = [];
        let method = false;
        while (at(k)?.kind === "name") {
          parts.push(at(k)!);
          const sep = at(k + 1)?.text;
          if (sep === "." || sep === ":") {
            if (sep === ":") method = true;
            k += 2;
          } else {
            k++;
            break;
          }
        }
        if (parts.length && at(k)?.text === "(") {
          const last = parts[parts.length - 1]!;
          defs.push({ name: last.text, fullName: parts.map((p) => p.text).join(method ? ":" : "."), kind: isLocal ? "local" : method ? "method" : "function", path, line: last.line, col: last.col, from: last.from, signature: sig(k) });
          params(k);
        } else if (at(k)?.text === "(") params(k);
        depth++;
      } else if (tok.text === "local" && at(i + 1)?.text !== "function") {
        let k = i + 1;
        while (at(k)?.kind === "name") {
          const nm = at(k)!;
          defs.push({ name: nm.text, fullName: nm.text, kind: "local", path, line: nm.line, col: nm.col, from: nm.from });
          if (at(k + 1)?.text === ",") k += 2;
          else break;
        }
      } else if (tok.text === "for") {
        let k = i + 1;
        while (at(k)?.kind === "name") {
          const nm = at(k)!;
          defs.push({ name: nm.text, fullName: nm.text, kind: "local", path, line: nm.line, col: nm.col, from: nm.from });
          if (at(k + 1)?.text === ",") k += 2;
          else break;
        }
        // (the `do` after the header opens the block)
      } else if (tok.text === "do" || tok.text === "if" || tok.text === "repeat") depth++;
      else if (tok.text === "end" || tok.text === "until") depth = Math.max(0, depth - 1);
      continue;
    }
    // a top-level assignment: Name = ... or Name.field = ...
    if (tok.kind === "name" && depth === 0 && at(i - 1)?.text !== "." && at(i - 1)?.text !== ":" && at(i - 1)?.text !== "local") {
      let k = i;
      while (at(k + 1)?.text === "." && at(k + 2)?.kind === "name") k += 2;
      if (at(k + 1)?.text === "=" && at(k)!.kind === "name") {
        const last = at(k)!;
        // (function definitions written as `name = function` count as functions)
        const isFn = at(k + 2)?.text === "function";
        const names = [] as string[];
        for (let q = i; q <= k; q += 2) names.push(at(q)!.text);
        defs.push({ name: last.text, fullName: names.join("."), kind: isFn ? "function" : k === i ? "global" : "field", path, line: last.line, col: last.col, from: last.from, signature: isFn && at(k + 3)?.text === "(" ? sig(k + 3) : undefined });
        i = k;
      }
    }
  }
  return defs;
}

export interface Reference {
  path: string;
  line: number;
  col: number;
  from: number;
  /// The line's text, trimmed, for a results list.
  preview: string;
  /// True when it is written after a dot or a colon (a field or method), false for a plain name.
  member: boolean;
}

/// Where a name is used in one file (names in strings and comments are not uses). `member` chooses plain names or fields and methods.
export function referencesIn(path: string, text: string, name: string, member: boolean | null = null): Reference[] {
  const t = code(tokenize(text));
  const lines = text.split("\n");
  const out: Reference[] = [];
  for (let i = 0; i < t.length; i++) {
    const tok = t[i]!;
    if (tok.kind !== "name" || tok.text !== name) continue;
    const isMember = t[i - 1]?.text === "." || t[i - 1]?.text === ":";
    if (member !== null && isMember !== member) continue;
    out.push({ path, line: tok.line, col: tok.col, from: tok.from, preview: (lines[tok.line - 1] ?? "").trim(), member: isMember });
  }
  return out;
}

export type SourceFiles = { path: string; text: string }[];

/// The definitions of a name across the project, the ones in `fromPath` first (a local in the file you are in wins over a global elsewhere).
export function findDefinitions(files: SourceFiles, name: string, fromPath: string): Definition[] {
  const all = files.flatMap((f) => definitionsIn(f.path, f.text)).filter((d) => d.name === name && d.kind !== "parameter");
  const params = files.filter((f) => f.path === fromPath).flatMap((f) => definitionsIn(f.path, f.text)).filter((d) => d.name === name && d.kind === "parameter");
  const rank = (d: Definition) => (d.path === fromPath ? 0 : 1) + (d.kind === "local" && d.path !== fromPath ? 5 : 0);
  return [...all].sort((a, b) => rank(a) - rank(b) || a.line - b.line).concat(params.length && !all.length ? params : []);
}

export function findReferences(files: SourceFiles, name: string, member: boolean | null = null): Reference[] {
  return files.flatMap((f) => referencesIn(f.path, f.text, name, member));
}

export const isIdentifier = (s: string) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(s) && !KEYWORDS.has(s);

export interface Rename {
  /// The files that change, with their new text.
  changes: { path: string; text: string; count: number }[];
  total: number;
}

/// Renames every plain use of a name, or every field/method use (`member`), in all the files. Names in strings and comments stay.
/// Returns null when the new name is not a valid name or is already used as a name in a way that would clash.
export function renameSymbol(files: SourceFiles, oldName: string, newName: string, member: boolean): Rename | { error: string } {
  if (!isIdentifier(newName)) return { error: `"${newName}" is not a name Lua accepts (letters, digits and _, not starting with a digit, and not a Lua word).` };
  if (oldName === newName) return { error: "That is the same name." };
  const clash = files.some((f) => referencesIn(f.path, f.text, newName, member).length > 0);
  if (clash) return { error: `"${newName}" is already used in this project, so renaming would merge two different things.` };
  const changes: Rename["changes"] = [];
  let total = 0;
  for (const f of files) {
    const refs = referencesIn(f.path, f.text, oldName, member);
    if (!refs.length) continue;
    let text = f.text;
    for (const r of [...refs].sort((a, b) => b.from - a.from)) text = text.slice(0, r.from) + newName + text.slice(r.from + oldName.length);
    changes.push({ path: f.path, text, count: refs.length });
    total += refs.length;
  }
  return { changes, total };
}

/// Foldable blocks: for each line that opens a block (function, if, for, while, do, repeat, a table), the line where it closes.
export function foldRanges(text: string): { from: number; to: number }[] {
  const t = code(tokenize(text));
  const stack: { kind: string; line: number }[] = [];
  const out: { from: number; to: number }[] = [];
  const open = (kind: string, line: number) => stack.push({ kind, line });
  const close = (line: number) => {
    const o = stack.pop();
    if (o && line > o.line) out.push({ from: o.line, to: line });
  };
  for (let i = 0; i < t.length; i++) {
    const tok = t[i]!;
    if (tok.kind === "keyword") {
      if (tok.text === "function" || tok.text === "do" || tok.text === "if" || tok.text === "repeat") open(tok.text, tok.line);
      else if (tok.text === "end" || tok.text === "until") close(tok.line);
    } else if (tok.text === "{") open("{", tok.line);
    else if (tok.text === "}") close(tok.line);
  }
  return out.sort((a, b) => a.from - b.from || b.to - a.to);
}

/// Re-indents the text by block depth (two spaces), trims trailing spaces, and makes sure it ends with one newline. The insides of long strings and
/// block comments are left as they were. It does not move code between lines.
export function formatLua(text: string, indent = "  "): string {
  const tokens = tokenize(text);
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  // which lines start inside a long string or block comment (their text is kept as written)
  const inside = new Set<number>();
  for (const tk of tokens) {
    if ((tk.kind === "string" || tk.kind === "comment") && tk.text.includes("\n")) {
      const span = tk.text.split("\n").length - 1;
      for (let k = 1; k <= span; k++) inside.add(tk.line + k);
    }
  }
  // net depth change and "line starts with a closer" per line, from the code tokens
  const firstOn = new Map<number, Token>();
  const delta = new Map<number, number>();
  let depth = 0;
  const depthAtStart: number[] = [];
  const codeTokens = tokens.filter((tk) => tk.kind !== "comment");
  const byLine = new Map<number, Token[]>();
  for (const tk of codeTokens) {
    if (!firstOn.has(tk.line)) firstOn.set(tk.line, tk);
    (byLine.get(tk.line) ?? byLine.set(tk.line, []).get(tk.line)!).push(tk);
  }
  const OPEN = new Set(["function", "do", "if", "repeat", "{", "("]);
  const CLOSE = new Set(["end", "until", "}", ")"]);
  for (let ln = 1; ln <= lines.length; ln++) {
    depthAtStart[ln] = depth;
    let d = 0;
    for (const tk of byLine.get(ln) ?? []) {
      if (OPEN.has(tk.text) && (tk.kind === "keyword" || tk.kind === "symbol")) d++;
      else if (CLOSE.has(tk.text) && (tk.kind === "keyword" || tk.kind === "symbol")) d--;
    }
    delta.set(ln, d);
    depth = Math.max(0, depth + d);
  }
  const out: string[] = [];
  for (let ln = 1; ln <= lines.length; ln++) {
    const raw = lines[ln - 1]!;
    if (inside.has(ln)) {
      out.push(raw);
      continue;
    }
    const body = raw.trim();
    if (!body) {
      out.push("");
      continue;
    }
    let level = depthAtStart[ln]!;
    const first = firstOn.get(ln);
    // a line that starts with a closer (or else, elseif) sits one level out; count closers at the start of the line
    if (first && ["end", "until", "}", ")", "else", "elseif"].includes(first.text) && first.kind !== "string") {
      let closers = 0;
      for (const tk of byLine.get(ln) ?? []) {
        if (CLOSE.has(tk.text) && tk.kind !== "string") closers++;
        else if (tk.text === "else" || tk.text === "elseif") closers = Math.max(closers, 1);
        else break;
      }
      level = Math.max(0, level - Math.max(1, closers));
    }
    out.push(indent.repeat(level) + body.replace(/[ \t]+$/g, ""));
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  return `${out.join("\n")}\n`;
}

export interface Snippet {
  label: string;
  detail: string;
  /// The text to insert; `$0` marks where the cursor goes, `${1:name}` a placeholder.
  template: string;
}

export const SNIPPETS: Snippet[] = [
  { label: "fn", detail: "function", template: "function ${1:name}(${2})\n  $0\nend" },
  { label: "lfn", detail: "local function", template: "local function ${1:name}(${2})\n  $0\nend" },
  { label: "if", detail: "if … then", template: "if ${1:condition} then\n  $0\nend" },
  { label: "ife", detail: "if … else", template: "if ${1:condition} then\n  $0\nelse\n  \nend" },
  { label: "for", detail: "count from 1", template: "for ${1:i} = 1, ${2:10} do\n  $0\nend" },
  { label: "forp", detail: "walk a list", template: "for ${1:i}, ${2:item} in ipairs(${3:list}) do\n  $0\nend" },
  { label: "fork", detail: "walk a table", template: "for ${1:key}, ${2:value} in pairs(${3:table}) do\n  $0\nend" },
  { label: "while", detail: "while … do", template: "while ${1:condition} do\n  $0\nend" },
  { label: "repeat", detail: "repeat … until", template: "repeat\n  $0\nuntil ${1:condition}" },
  { label: "entity", detail: "an entity definition", template: "return nova.entity({\n  name = \"${1:Thing}\",\n  on_create = function(self)\n    $0\n  end,\n  on_update = function(self, dt)\n  end,\n})" },
];

/// Expands a snippet's template to plain text and the offset (from the start of the text) the cursor should land at.
export function expandSnippet(template: string): { text: string; cursor: number } {
  let cursor = -1;
  const text = template.replace(/\$\{\d+:([^}]*)\}|\$\{\d+\}|\$0/g, (m, name: string | undefined, offset: number) => {
    if (m === "$0") cursor = cursor < 0 ? offset : cursor;
    return m === "$0" ? "" : (name ?? "");
  });
  // (the offset above counts template characters; recompute against the expanded text)
  const index = template.indexOf("$0");
  if (index < 0) return { text, cursor: text.length };
  const before = template.slice(0, index).replace(/\$\{\d+:([^}]*)\}|\$\{\d+\}/g, (_m, name: string | undefined) => name ?? "");
  return { text, cursor: before.length };
}

/// The single name under (or just before) a position, and whether it is a field or method (written after a dot or a colon).
export function wordAt(text: string, pos: number): { word: string; from: number; to: number; member: boolean } | null {
  const isWord = (c: string | undefined) => !!c && /[A-Za-z0-9_]/.test(c);
  let from = Math.min(pos, text.length);
  let to = from;
  if (!isWord(text[from]) && isWord(text[from - 1])) (from--, to--);
  while (from > 0 && isWord(text[from - 1])) from--;
  while (to < text.length && isWord(text[to])) to++;
  if (from === to || /^[0-9]/.test(text.slice(from, to))) return null;
  const before = text[from - 1];
  return { word: text.slice(from, to), from, to, member: before === "." || before === ":" };
}
