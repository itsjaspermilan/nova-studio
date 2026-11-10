import { describe, expect, it } from "vitest";
import { definitionsIn, expandSnippet, findDefinitions, findReferences, foldRanges, formatLua, isIdentifier, referencesIn, renameSymbol, SNIPPETS, tokenize } from "./lua-tools";

describe("the tokenizer", () => {
  it("knows strings, comments and long brackets, and gives lines and columns", () => {
    const t = tokenize('local a = "x -- not a comment" -- real\n--[[ block\nlocal b ]] local c = [==[ long ]] still ]==]');
    expect(t.map((k) => k.kind)).toEqual(["keyword", "name", "symbol", "string", "comment", "comment", "keyword", "name", "symbol", "string"]);
    expect(t[1]).toMatchObject({ text: "a", line: 1, col: 7 });
    expect(t[6]).toMatchObject({ text: "local", line: 3 });
  });
  it("never throws on unfinished input", () => {
    expect(() => tokenize('x = "abc')).not.toThrow();
    expect(() => tokenize("--[[ never closed")).not.toThrow();
    expect(() => tokenize("[[ never closed")).not.toThrow();
  });
});

const SRC = `local speed = 3
Score = 0
function start(a, b)
  local inner = 1
  for i = 1, 3 do print(i) end
end
local function helper(x) return x end
function Car:drive(dt) end
M.update = function(self, dt) end
`;

describe("definitions", () => {
  const defs = definitionsIn("main.lua", SRC);
  const find = (n: string) => defs.filter((d) => d.name === n);
  it("finds functions, methods, locals, globals and fields", () => {
    expect(find("start")[0]).toMatchObject({ kind: "function", line: 3, signature: "(a, b)" });
    expect(find("helper")[0]).toMatchObject({ kind: "local", signature: "(x)" });
    expect(find("drive")[0]).toMatchObject({ kind: "method", fullName: "Car:drive" });
    expect(find("speed")[0]!.kind).toBe("local");
    expect(find("Score")[0]!.kind).toBe("global");
    expect(find("update")[0]).toMatchObject({ kind: "function", fullName: "M.update" });
    expect(find("i")[0]!.kind).toBe("local");
  });
  it("lists parameters, and does not treat a call or a comparison as a definition", () => {
    expect(find("a")[0]!.kind).toBe("parameter");
    expect(definitionsIn("x.lua", "print(x)\nif x == 1 then end").length).toBe(0);
  });
  it("does not take assignments inside functions for globals", () => {
    expect(definitionsIn("x.lua", "function f()\n  y = 1\nend").map((d) => d.name)).toEqual(["f"]);
  });
  it("ranks the file you are in first", () => {
    const files = [{ path: "a.lua", text: "function go() end" }, { path: "b.lua", text: "function go() end" }];
    expect(findDefinitions(files, "go", "b.lua").map((d) => d.path)).toEqual(["b.lua", "a.lua"]);
  });
});

describe("references and rename", () => {
  const files = [
    { path: "a.lua", text: 'local speed = 1\nprint(speed, "speed", car.speed)\n-- speed in a comment\n' },
    { path: "b.lua", text: "speed = speed + 1" },
  ];
  it("counts only real uses, and tells plain names from fields", () => {
    expect(referencesIn("a.lua", files[0]!.text, "speed", false).map((r) => r.line)).toEqual([1, 2]);
    expect(referencesIn("a.lua", files[0]!.text, "speed", true).map((r) => r.col)).toEqual([27]);
    expect(findReferences(files, "speed", false)).toHaveLength(4);
  });
  it("renames plain uses everywhere and leaves strings, comments and fields alone", () => {
    const r = renameSymbol(files, "speed", "pace", false);
    if ("error" in r) throw new Error(r.error);
    expect(r.total).toBe(4);
    expect(r.changes[0]!.text).toBe('local pace = 1\nprint(pace, "speed", car.speed)\n-- speed in a comment\n');
    expect(r.changes[1]!.text).toBe("pace = pace + 1");
  });
  it("refuses a bad name, the same name and a clash", () => {
    expect("error" in renameSymbol(files, "speed", "end", false)).toBe(true);
    expect("error" in renameSymbol(files, "speed", "1x", false)).toBe(true);
    expect("error" in renameSymbol(files, "speed", "speed", false)).toBe(true);
    expect("error" in renameSymbol([{ path: "c.lua", text: "a = 1\nb = 2" }], "a", "b", false)).toBe(true);
    expect(isIdentifier("ok_1")).toBe(true);
  });
});

describe("folding and formatting", () => {
  it("lists the blocks that span lines", () => {
    expect(foldRanges("function f()\n  if x then\n    y()\n  end\nend\nlocal t = {\n  1,\n}\n")).toEqual([{ from: 1, to: 5 }, { from: 2, to: 4 }, { from: 6, to: 8 }]);
  });
  it("re-indents by depth, trims, and ends with one newline", () => {
    const messy = "function f(a)\nif a then   \nprint(1)\nelse\nprint(2)\nend\nend\nlocal t = {\n1,\n2,\n}\n\n\n";
    expect(formatLua(messy)).toBe("function f(a)\n  if a then\n    print(1)\n  else\n    print(2)\n  end\nend\nlocal t = {\n  1,\n  2,\n}\n");
  });
  it("leaves the inside of a long string alone", () => {
    const src = "local s = [[\n   keep   me\n]]\nif x then\ny()\nend\n";
    expect(formatLua(src)).toBe("local s = [[\n   keep   me\n]]\nif x then\n  y()\nend\n");
  });
  it("is the same when run twice", () => {
    const once = formatLua("function f()\nreturn {a=1,\nb=2}\nend");
    expect(formatLua(once)).toBe(once);
  });
});

describe("snippets", () => {
  it("expands a template to text and a cursor place", () => {
    const e = expandSnippet(SNIPPETS.find((s) => s.label === "if")!.template);
    expect(e.text).toBe("if condition then\n  \nend");
    expect(e.cursor).toBe("if condition then\n  ".length);
  });
});

describe("the word under the cursor", () => {
  it("finds a name, with or without the cursor at its end, and knows a field", async () => {
    const { wordAt } = await import("./lua-tools");
    expect(wordAt("car.speed = 1", 5)).toEqual({ word: "speed", from: 4, to: 9, member: true });
    expect(wordAt("car.speed = 1", 9)?.word).toBe("speed");
    expect(wordAt("x = 12", 5)).toBeNull();
    expect(wordAt("  = ", 2)).toBeNull();
  });
});
