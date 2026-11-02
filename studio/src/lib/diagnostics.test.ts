import { describe, expect, it } from "vitest";
import { byFile, markersFor, summary } from "./diagnostics";
import type { Diagnostic } from "./types";

const d = (over: Partial<Diagnostic>): Diagnostic => ({ severity: "error", file: "a.lua", line: 1, place: null, message: "bad", detail: "bad", ...over });

describe("diagnostics", () => {
  it("groups by file with file-less problems under the empty key", () => {
    const map = byFile([d({}), d({ file: "b.lua" }), d({ file: null }), d({ line: 4 })]);
    expect([...map.keys()]).toEqual(["a.lua", "b.lua", ""]);
    expect(map.get("a.lua")).toHaveLength(2);
  });

  it("underlines the trimmed line and clamps out-of-range lines", () => {
    const text = "local a = 1\n    oops here\nlast";
    const [one, two, far, none] = markersFor(text, [d({ line: 1 }), d({ line: 2 }), d({ line: 99 }), d({ line: null, place: "x[0]" })]);
    expect(text.slice(one!.from, one!.to)).toBe("local a = 1");
    expect(text.slice(two!.from, two!.to)).toBe("oops here");
    expect(text.slice(far!.from, far!.to)).toBe("last");
    expect(none!.from).toBe(0);
    expect(none!.message).toBe("x[0]: bad");
  });

  it("handles empty text and blank lines", () => {
    expect(markersFor("", [d({ line: 3 })])).toEqual([{ from: 0, to: 0, severity: "error", message: "bad" }]);
    expect(markersFor("a\n\nb", [d({ line: 2 })])[0]).toMatchObject({ from: 2, to: 2 });
  });

  it("summarises counts", () => {
    expect(summary([])).toBe("No problems");
    expect(summary([d({}), d({ severity: "warning" }), d({})])).toBe("2 errors, 1 warning");
  });
});
