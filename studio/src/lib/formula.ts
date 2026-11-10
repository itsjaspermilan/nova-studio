// A tiny, safe formula language for the "formula" instrument: an expression such as `sin(2*pi*p) * (1 - p)` evaluated for every sample of a note. No loops, no variables
// of your own, no access to anything but the numbers listed below, so a formula cannot hang or do harm: it is a function of three numbers.
//
//   p  the phase of the note's cycle, 0 up to 1 and round again (this is what makes the pitch)
//   t  seconds since the note began
//   f  the note's pitch in Hz
//   pi, e  the usual constants
// Operators: + - * / % ^ (power), unary -, brackets; comparisons < > (give 1 or 0).
// Functions: sin cos tan abs sqrt floor frac sign min max pow clamp mix(a, b, k), saw(p) tri(p) sq(p) (the usual waves of a phase), noise(x) (a repeatable noise of a number).

export interface Env {
  p: number;
  t: number;
  f: number;
}
export type Formula = (env: Env) => number;
export type Compiled = { ok: true; run: Formula } | { ok: false; error: string };

type Node = (env: Env) => number;
const FUNCS: Record<string, { n: number; fn: (...a: number[]) => number }> = {
  sin: { n: 1, fn: Math.sin }, cos: { n: 1, fn: Math.cos }, tan: { n: 1, fn: Math.tan }, abs: { n: 1, fn: Math.abs }, sqrt: { n: 1, fn: (x) => Math.sqrt(Math.max(0, x)) },
  floor: { n: 1, fn: Math.floor }, frac: { n: 1, fn: (x) => x - Math.floor(x) }, sign: { n: 1, fn: Math.sign },
  min: { n: 2, fn: Math.min }, max: { n: 2, fn: Math.max }, pow: { n: 2, fn: (a, b) => Math.pow(a, b) },
  clamp: { n: 3, fn: (x, lo, hi) => Math.min(hi, Math.max(lo, x)) }, mix: { n: 3, fn: (a, b, k) => a + (b - a) * k },
  saw: { n: 1, fn: (p) => 2 * (p - Math.floor(p)) - 1 }, tri: { n: 1, fn: (p) => { const x = p - Math.floor(p); return x < 0.5 ? 4 * x - 1 : 3 - 4 * x; } },
  sq: { n: 1, fn: (p) => (p - Math.floor(p) < 0.5 ? 1 : -1) },
  noise: { n: 1, fn: (x) => { const s = Math.sin(x * 12.9898 + 78.233) * 43758.5453; return 2 * (s - Math.floor(s)) - 1; } },
};
export const FORMULA_MAX = 160;

interface Tok {
  kind: "num" | "id" | "op" | "end";
  text: string;
  at: number;
}

function lex(src: string): Tok[] | string {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) { i++; continue; }
    const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i));
    if (num) { out.push({ kind: "num", text: num[0], at: i }); i += num[0].length; continue; }
    const id = /^[a-z_][a-z0-9_]*/i.exec(src.slice(i));
    if (id) { out.push({ kind: "id", text: id[0].toLowerCase(), at: i }); i += id[0].length; continue; }
    if ("+-*/%^(),<>".includes(c)) { out.push({ kind: "op", text: c, at: i }); i++; continue; }
    return `unexpected "${c}" at position ${i + 1}`;
  }
  out.push({ kind: "end", text: "", at: src.length });
  return out;
}

/// Reads a formula. On a mistake returns a message in plain words saying where.
export function compileFormula(src: string): Compiled {
  if (!src.trim()) return { ok: false, error: "the formula is empty" };
  if (src.length > FORMULA_MAX) return { ok: false, error: `the formula is longer than ${FORMULA_MAX} characters` };
  const toks = lex(src);
  if (typeof toks === "string") return { ok: false, error: toks };
  let pos = 0;
  const peek = () => toks[pos]!;
  const fail = (m: string): never => { throw new Error(m); };
  const expect = (text: string) => { if (peek().text !== text) fail(`expected "${text}" at position ${peek().at + 1}`); pos++; };
  // precedence: comparison < add < mul < unary minus < power
  const comparison = (): Node => {
    let l = additive();
    while (peek().kind === "op" && (peek().text === "<" || peek().text === ">")) {
      const op = toks[pos++]!.text;
      const r = additive();
      const a = l;
      l = op === "<" ? (e) => (a(e) < r(e) ? 1 : 0) : (e) => (a(e) > r(e) ? 1 : 0);
    }
    return l;
  };
  const additive = (): Node => {
    let l = multiplicative();
    while (peek().kind === "op" && (peek().text === "+" || peek().text === "-")) {
      const op = toks[pos++]!.text;
      const r = multiplicative();
      const a = l;
      l = op === "+" ? (e) => a(e) + r(e) : (e) => a(e) - r(e);
    }
    return l;
  };
  const multiplicative = (): Node => {
    let l = unary();
    while (peek().kind === "op" && "*/%".includes(peek().text)) {
      const op = toks[pos++]!.text;
      const r = unary();
      const a = l;
      l = op === "*" ? (e) => a(e) * r(e) : op === "/" ? (e) => { const d = r(e); return d === 0 ? 0 : a(e) / d; } : (e) => { const d = r(e); return d === 0 ? 0 : a(e) % d; };
    }
    return l;
  };
  const unary = (): Node => {
    if (peek().text === "-" && peek().kind === "op") {
      pos++;
      const x = unary();
      return (e) => -x(e);
    }
    return power();
  };
  const power = (): Node => {
    const base = primary();
    if (peek().text === "^" && peek().kind === "op") {
      pos++;
      const exp = unary(); // right-associative, and -x allowed in the exponent
      return (e) => { const v = Math.pow(base(e), exp(e)); return Number.isFinite(v) ? v : 0; };
    }
    return base;
  };
  const primary = (): Node => {
    const t = toks[pos++]!;
    if (t.kind === "num") { const v = Number(t.text); return () => v; }
    if (t.kind === "op" && t.text === "(") {
      const inner = comparison();
      expect(")");
      return inner;
    }
    if (t.kind === "id") {
      if (peek().text === "(" && peek().kind === "op") {
        const spec = FUNCS[t.text];
        if (!spec) return fail(`there is no function "${t.text}" (position ${t.at + 1})`);
        pos++;
        const args: Node[] = [];
        if (peek().text !== ")") {
          args.push(comparison());
          while (peek().text === ",") { pos++; args.push(comparison()); }
        }
        expect(")");
        if (args.length !== spec.n) return fail(`${t.text} takes ${spec.n} number${spec.n === 1 ? "" : "s"}, not ${args.length} (position ${t.at + 1})`);
        const fn = spec.fn;
        return (e) => { const v = fn(...args.map((a) => a(e))); return Number.isFinite(v) ? v : 0; };
      }
      switch (t.text) {
        case "p": return (e) => e.p;
        case "t": return (e) => e.t;
        case "f": return (e) => e.f;
        case "pi": return () => Math.PI;
        case "e": return () => Math.E;
      }
      return fail(`"${t.text}" is not known: use p, t, f, pi or e (position ${t.at + 1})`);
    }
    return fail(t.kind === "end" ? "the formula ends too soon" : `unexpected "${t.text}" at position ${t.at + 1}`);
  };
  try {
    const root = comparison();
    if (peek().kind !== "end") fail(`unexpected "${peek().text}" at position ${peek().at + 1}`);
    return { ok: true, run: (env) => { const v = root(env); return Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0; } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
