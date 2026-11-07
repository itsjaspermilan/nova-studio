import { describe, expect, it } from "vitest";
import { buildTable, compilePattern, expandRuns, fillScript, matchLines, placeholders, toCsv } from "./sim";

describe("simulation runs", () => {
  it("tries every combination of the options, each as many times as asked", () => {
    const runs = expandRuns([{ name: "car", values: ["Redline", "Cab"] }, { name: "level", values: ["easy", "hard"] }, { name: " ", values: ["x"] }, { name: "empty", values: [] }], 1);
    expect(runs.map((r) => r.values)).toEqual([
      { car: "Redline", level: "easy" },
      { car: "Redline", level: "hard" },
      { car: "Cab", level: "easy" },
      { car: "Cab", level: "hard" },
    ]);
    expect(expandRuns([], 1)).toHaveLength(1);
    const twice = expandRuns([{ name: "a", values: ["1", "2"] }], 2);
    expect(twice.map((r) => `${r.values.a}#${r.attempt}`)).toEqual(["1#1", "1#2", "2#1", "2#2"]);
    expect(expandRuns([], 0)).toHaveLength(1);
  });
  it("fills the placeholders of a script and refuses a misspelt one", () => {
    const text = '[{ "at": {{start}}, "for": 2, "hold": { "key:{{ menu }}": 1 } }]';
    expect(fillScript(text, { start: "30", menu: "Enter" })).toBe('[{ "at": 30, "for": 2, "hold": { "key:Enter": 1 } }]');
    expect(() => fillScript(text, { start: "30" })).toThrow('no option called "menu"');
    expect(placeholders(text)).toEqual(["start", "menu"]);
    expect(fillScript("[]", {})).toBe("[]");
  });
  it("checks the pattern and reads its groups from matching lines only", () => {
    expect(compilePattern("").ok).toBe(false);
    const bad = compilePattern("(");
    expect(!bad.ok && bad.error).toContain("not valid");
    const ok = compilePattern("lap (\\d+): ([0-9.]+)");
    if (!ok.ok) throw new Error("pattern");
    expect(matchLines(["boot", "lap 1: 71.20", "[x] lap 2: 70.5 s"], ok.re)).toEqual([["1", "71.20"], ["2", "70.5"]]);
    const plain = compilePattern("finished");
    if (!plain.ok) throw new Error("pattern");
    expect(matchLines(["race finished"], plain.re)).toEqual([["finished"]]);
    expect(matchLines(["x"], new RegExp("x(y)?"))).toEqual([[""]]);
  });
  it("builds a table: options, then the run number if repeated, then the columns", () => {
    const options = [{ name: "car", values: ["A", "B"] }];
    const results = [
      { run: { values: { car: "A" }, attempt: 1 }, rows: [["1", "71.2"], ["2", "70.9"]] },
      { run: { values: { car: "B" }, attempt: 1 }, rows: [["1", "75.0"]] },
    ];
    const t = buildTable({ options, columns: ["lap", "time"], repeat: 1 }, results);
    expect(t.head).toEqual(["car", "lap", "time"]);
    expect(t.rows).toEqual([["A", "1", "71.2"], ["A", "2", "70.9"], ["B", "1", "75.0"]]);
    const t2 = buildTable({ options, columns: ["lap"], repeat: 2 }, results);
    expect(t2.head).toEqual(["car", "run", "lap", "column 2"]);
    expect(t2.rows[2]).toEqual(["B", "1", "1", "75.0"]);
    expect(buildTable({ options: [], columns: [], repeat: 1 }, []).head).toEqual([]);
  });
  it("writes the table as CSV", () => {
    expect(toCsv({ head: ["a", "b"], rows: [["1", 'say "hi", ok']] })).toBe('a,b\n1,"say ""hi"", ok"\n');
  });
});
