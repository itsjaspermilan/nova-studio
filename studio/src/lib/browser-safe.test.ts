// The studio's window is a web page: a file it loads that imports a Node module (node:fs, node:path...) leaves the whole window blank
// (2026-11-08: the track generator imported a script that read files). The tests run under Node, where those modules exist, so they
// would not notice; this follows every import the window's code makes, from main.ts, and fails if one reaches a Node module.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const IMPORT = /(?:import|export)\s[^;]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

function reach(entry: string): { files: string[]; bad: string[] } {
  const seen = new Set<string>();
  const bad: string[] = [];
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(IMPORT)) {
      const spec = m[1] ?? m[2]!;
      if (spec.startsWith("node:") || ["fs", "path", "child_process", "os", "zlib"].includes(spec)) bad.push(`${relative(join(__dirname, "../../.."), file)} imports ${spec}`);
      if (!spec.startsWith(".")) continue;
      const base = resolve(dirname(file), spec);
      const found = [base, `${base}.ts`, `${base}.js`, `${base}.mjs`, join(base, "index.ts")].find((p) => existsSync(p) && !p.endsWith("/"));
      if (found && /\.(ts|js|mjs|svelte)$/.test(found)) queue.push(found);
    }
  }
  return { files: [...seen], bad };
}

describe("the studio window's code", () => {
  it("never imports a Node module (it would leave the window blank)", () => {
    const { files, bad } = reach(join(__dirname, "../main.ts"));
    expect(files.length).toBeGreaterThan(20);
    expect(bad).toEqual([]);
  });
});
