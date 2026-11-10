// The outline of a Lua file: its functions and where they are, found by reading lines (not a parser: the common shapes `function a.b:c(...)`, `local function f(...)`,
// `local f = function(...)` and `a.b = function(...)`). Comments and strings that start a line with the same words are skipped when they are plainly comments.

export interface OutlineItem {
  /// As written: `Player:update`, `helper`, `M.draw`.
  name: string;
  line: number;
  /// A method (`a:b`), a field function (`a.b`) or a plain/local function.
  kind: "method" | "field" | "function";
  /// The argument list as written, without the brackets.
  args: string;
  local: boolean;
}

export function outlineOf(source: string): OutlineItem[] {
  const out: OutlineItem[] = [];
  let inBlock = false;
  source.split("\n").forEach((raw, i) => {
    let line = raw;
    if (inBlock) {
      if (line.includes("]]")) inBlock = false;
      return;
    }
    if (/^\s*--\[\[/.test(line) && !line.includes("]]")) {
      inBlock = true;
      return;
    }
    if (/^\s*--/.test(line)) return;
    line = line.replace(/--.*$/, "");
    let m = /^\s*(local\s+)?function\s+([A-Za-z_][\w.]*(?::[A-Za-z_]\w*)?)\s*\(([^)]*)\)/.exec(line);
    if (!m) m = /^\s*(local\s+)([A-Za-z_]\w*)\s*=\s*function\s*\(([^)]*)\)/.exec(line);
    if (!m) {
      const f = /^\s*([A-Za-z_][\w.]*)\s*=\s*function\s*\(([^)]*)\)/.exec(line);
      if (f) m = [f[0], "", f[1]!, f[2]!] as unknown as RegExpExecArray;
    }
    if (!m) return;
    const name = m[2]!;
    out.push({ name, line: i + 1, kind: name.includes(":") ? "method" : name.includes(".") ? "field" : "function", args: m[3]!.trim(), local: !!m[1] });
  });
  return out;
}
