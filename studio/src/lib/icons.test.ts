import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hasIcon, ICONS } from "./icons";

const src = join(__dirname, "..");
const files = [join(src, "App.svelte"), ...readdirSync(join(src, "components")).filter((f) => f.endsWith(".svelte")).map((f) => join(src, "components", f))];

describe("the icon set", () => {
  it("has a drawing for every icon a command names", () => {
    const missing: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      for (const m of text.matchAll(/icon: "([A-Za-z]+)"/g)) if (!hasIcon(m[1]!)) missing.push(`${f.split("/").pop()}: ${m[1]}`);
      for (const m of text.matchAll(/glyph: "([A-Za-z]+)"/g)) if (!hasIcon(m[1]!)) missing.push(`${f.split("/").pop()}: ${m[1]}`);
    }
    expect(missing).toEqual([]);
  });

  it("is drawn on the 24 grid: every number in a path fits in it, and no path is empty", () => {
    for (const [name, d] of Object.entries(ICONS)) {
      expect(d.length, name).toBeGreaterThan(5);
      const nums = [...d.matchAll(/-?\d+(\.\d+)?/g)].map((m) => Math.abs(Number(m[0])));
      expect(Math.max(...nums), name).toBeLessThanOrEqual(24);
    }
  });
});
