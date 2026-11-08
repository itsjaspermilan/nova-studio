import { describe, expect, it } from "vitest";
import { diffFiles, stampsOf } from "./file-changes";

describe("diffFiles", () => {
  const a = [{ path: "sprites", dir: true, size: 0 }, { path: "sprites/a.png", dir: false, size: 10, modified: 1 }, { path: "main.lua", dir: false, size: 5, modified: 1 }];
  it("finds files changed in size or time, added and removed", () => {
    const b = [{ path: "sprites", dir: true, size: 0 }, { path: "sprites/a.png", dir: false, size: 10, modified: 2 }, { path: "sprites/b.png", dir: false, size: 3, modified: 2 }];
    expect(diffFiles(stampsOf(a), b)).toEqual({ changed: ["sprites/a.png"], added: ["sprites/b.png"], removed: ["main.lua"], all: ["sprites/a.png", "sprites/b.png", "main.lua"] });
    expect(diffFiles(stampsOf(a), a).all).toEqual([]);
  });
  it("takes the first listing as no change", () => {
    expect(diffFiles(new Map(), a).all).toEqual([]);
  });
});
