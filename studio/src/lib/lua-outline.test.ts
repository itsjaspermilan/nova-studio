import { describe, expect, it } from "vitest";
import { outlineOf } from "./lua-outline";

describe("the outline of a Lua file", () => {
  it("lists methods, field functions, local and plain functions with their lines and arguments", () => {
    const src = [
      "local Player = nova.entity {}",
      "",
      "function Player:update(dt)",
      "  self.x = 1",
      "end",
      "local function helper(a, b)",
      "end",
      "local draw = function(x) end",
      "Player.hit = function(self, n) end",
      "function nova_start() end",
    ].join("\n");
    const o = outlineOf(src);
    expect(o.map((i) => [i.name, i.line, i.kind, i.local])).toEqual([
      ["Player:update", 3, "method", false],
      ["helper", 6, "function", true],
      ["draw", 8, "function", true],
      ["Player.hit", 9, "field", false],
      ["nova_start", 10, "function", false],
    ]);
    expect(o[0]!.args).toBe("dt");
    expect(o[1]!.args).toBe("a, b");
  });
  it("skips comments, block comments and text after a comment mark", () => {
    const src = ["-- function fake() end", "--[[", "function hidden() end", "]]", "function real() end -- function trailing() end"].join("\n");
    expect(outlineOf(src).map((i) => i.name)).toEqual(["real"]);
  });
});
