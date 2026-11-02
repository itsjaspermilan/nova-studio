import { describe, expect, it } from "vitest";
import { parseBody, parseInline } from "./markup";
import { byGroup, searchApi } from "./help-search";
import { Progress } from "./progress";
import { lessons, parseSnippet, shortcuts, snippets } from "./tutorials";
import { apiEntries } from "./completions";

describe("lesson text markup", () => {
  it("makes paragraphs, lists, tips, code and bold", () => {
    expect(parseInline("Press **Play** then `nova.start`.")).toEqual([{ text: "Press " }, { text: "Play", bold: true }, { text: " then " }, { text: "nova.start", code: true }, { text: "." }]);
    const blocks = parseBody("One line\ncontinues here.\n\n- first\n- second `x`\n\n> a tip\n> over two lines");
    expect(blocks).toEqual([
      { kind: "p", spans: [{ text: "One line continues here." }] },
      { kind: "list", items: [[{ text: "first" }], [{ text: "second " }, { text: "x", code: true }]] },
      { kind: "tip", spans: [{ text: "a tip over two lines" }] },
    ]);
    expect(parseBody("   \n\n  ")).toEqual([]);
    expect(parseInline("<b>not html</b>")).toEqual([{ text: "<b>not html</b>" }]); // drawn as text, never as HTML
  });
});

describe("lesson code", () => {
  it("reads the target path from the first line", () => {
    expect(parseSnippet("a", "-- file: entities/x.lua\n\nreturn 1\n")).toEqual({ id: "a", path: "entities/x.lua", code: "return 1\n" });
    expect(() => parseSnippet("b", "return 1")).toThrow("-- file:");
  });

  it("is all there: every lesson step that names code points at a real file, and every file is used", () => {
    const used = new Set<string>();
    for (const lesson of lessons) for (const step of lesson.steps) if (step.snippet) {
      expect(snippets[step.snippet], `${lesson.id}: ${step.snippet}`).toBeDefined();
      used.add(step.snippet);
    }
    expect([...used].sort()).toEqual(Object.keys(snippets).sort());
  });

  it("every snippet targets a project path inside the project", () => {
    for (const s of Object.values(snippets)) {
      expect(s.path).toMatch(/^[\w-]+(\/[\w.-]+)*\.(lua|json)$/);
      expect(s.path.includes("..")).toBe(false);
      expect(s.code.trim().length).toBeGreaterThan(20);
    }
  });
});

describe("lessons are well formed", () => {
  it("have unique ids, real steps and plain text that parses", () => {
    expect(new Set(lessons.map((l) => l.id)).size).toBe(lessons.length);
    for (const l of lessons) {
      expect(l.title && l.summary && l.needs, l.id).toBeTruthy();
      expect(l.steps.length).toBeGreaterThanOrEqual(3);
      for (const s of l.steps) {
        expect(s.title.length, `${l.id}`).toBeGreaterThan(3);
        expect(parseBody(s.body).length, `${l.id}: ${s.title}`).toBeGreaterThan(0);
      }
    }
    expect(shortcuts.every((g) => g.tips.length > 0)).toBe(true);
  });

  it("talk about buttons and calls that exist", () => {
    // Names of Nova calls used in lesson text must be in the API reference the studio ships.
    const known = new Set(apiEntries.map((e) => e.name));
    const text = lessons.flatMap((l) => l.steps.map((s) => s.body)).join("\n");
    for (const m of text.matchAll(/`(nova\.[a-z_.]+)/g)) expect(known.has(m[1]!), m[1]).toBe(true);
  });
});

describe("searching the reference", () => {
  it("finds by name, then signature, then explanation, and needs every word", () => {
    const hits = searchApi("play", apiEntries).map((e) => e.name);
    expect(hits.slice(0, 3).every((n) => n.includes("play"))).toBe(true);
    expect(searchApi("model clip", apiEntries).map((e) => e.name)).toContain("nova.model");
    expect(searchApi("zzzzz", apiEntries)).toEqual([]);
    expect(searchApi("   ", apiEntries)).toEqual([]);
    expect(searchApi("light", apiEntries).map((e) => e.name)).toContain("nova.point_light");
    expect(searchApi("sprite", apiEntries, 3)).toHaveLength(3);
  });

  it("groups entries in order of first appearance", () => {
    const groups = byGroup(apiEntries);
    expect(groups.length).toBeGreaterThan(3);
    expect(groups.reduce((n, [, list]) => n + list.length, 0)).toBe(apiEntries.length);
  });
});

describe("progress", () => {
  const memory = () => {
    const data = new Map<string, string>();
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  };
  it("ticks steps on and off and remembers them", () => {
    const store = memory();
    const p = new Progress(store);
    expect(p.toggle("a", 1)).toBe(true);
    expect(p.has("a", 1)).toBe(true);
    expect(p.has("a", 0)).toBe(false);
    p.toggle("a", 0);
    expect(p.count("a", 3)).toBe(2);
    expect(new Progress(store).has("a", 1)).toBe(true); // a fresh start reads it back
    expect(p.toggle("a", 1)).toBe(false);
  });
  it("copes with damaged and unavailable storage", () => {
    const bad = { getItem: () => "{ nope", setItem: () => { throw new Error("full"); } };
    const p = new Progress(bad);
    expect(p.has("a", 0)).toBe(false);
    expect(p.toggle("a", 0)).toBe(true); // still ticked this session
    expect(new Progress(null).toggle("x", 1)).toBe(true);
  });
});
