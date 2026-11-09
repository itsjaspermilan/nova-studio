import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// WCAG 2 contrast: text needs 4.5 to 1 against its background (3 to 1 for large text and interface parts such as a focus ring).
const css = readFileSync(join(__dirname, "..", "app.css"), "utf8");
const block = (selector: string) => {
  const i = css.indexOf(selector + " {");
  return css.slice(i, css.indexOf("}", i));
};
const vars = (selector: string, base = ":root") => {
  const out: Record<string, string> = {};
  for (const src of [block(base), selector === base ? "" : block(selector)]) for (const m of src.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)) out[m[1]!] = m[2]!;
  return out;
};
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};

describe("theme contrast", () => {
  for (const selector of [":root", ':root[data-theme="light"]', ':root[data-theme="contrast"]']) {
    it(`${selector}: text, secondary text and the accent are readable on the panels`, () => {
      const v = vars(selector);
      for (const surface of ["bg", "panel", "panel-2"]) {
        expect(ratio(v.text!, v[surface]!), `text on ${surface}`).toBeGreaterThanOrEqual(4.5);
        expect(ratio(v.dim!, v[surface]!), `dim on ${surface}`).toBeGreaterThanOrEqual(4.5);
        expect(ratio(v.accent!, v[surface]!), `accent on ${surface}`).toBeGreaterThanOrEqual(3);
      }
    });
  }
});
