import { describe, expect, it } from "vitest";
import { hintFor, type HintNode } from "./hints";

const el = (attrs: Record<string, string>, parent: HintNode | null = null): HintNode => ({ getAttribute: (n) => attrs[n] ?? null, parentElement: parent });

describe("hints", () => {
  it("uses the title of the element, or the nearest one above it", () => {
    const button = el({ title: "Pencil (B)" });
    expect(hintFor(button)).toBe("Pencil (B)");
    const inner = el({}, el({}, button));
    expect(hintFor(inner)).toBe("Pencil (B)");
    expect(hintFor(el({}, el({}, el({}, el({}, el({}, button))))))).toBe(""); // too far above to be about this
  });
  it("falls back to the accessible name, and says nothing for a plain area", () => {
    expect(hintFor(el({ "aria-label": "Zoom" }))).toBe("Zoom");
    expect(hintFor(el({ title: "  ", "aria-label": "Zoom" }))).toBe("Zoom");
    expect(hintFor(el({}))).toBe("");
    expect(hintFor(null)).toBe("");
  });
  it("cuts a very long one", () => {
    const h = hintFor(el({ title: "x".repeat(500) }));
    expect(h.length).toBe(220);
    expect(h.endsWith("…")).toBe(true);
  });
});
