import { describe, expect, it } from "vitest";
import { MAX_RECOVERY_CHARS, RecoveryStore } from "./recovery";

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
};

describe("recovery copies", () => {
  it("keep a document's unsaved text, replace it on the next copy, and drop it when saved", () => {
    const store = new RecoveryStore(memory(), "/p");
    store.save("a.lua", "one", 1);
    store.save("a.lua", "two", 2);
    store.save("b.lua", "x", 3);
    expect(store.list().map((r) => [r.path, r.text])).toEqual([["a.lua", "two"], ["b.lua", "x"]]);
    store.remove("a.lua");
    expect(store.list().map((r) => r.path)).toEqual(["b.lua"]);
  });

  it("are kept apart per project, and across a restart", () => {
    const mem = memory();
    new RecoveryStore(mem, "/one").save("a.lua", "kept", 1);
    expect(new RecoveryStore(mem, "/two").list()).toEqual([]);
    expect(new RecoveryStore(mem, "/one").list()[0]?.text).toBe("kept");
  });

  it("drop the oldest copies when there is no room, and never the one just made", () => {
    const store = new RecoveryStore(memory(), "/p");
    const big = "x".repeat(Math.floor(MAX_RECOVERY_CHARS * 0.6));
    store.save("old.json", big, 1);
    store.save("new.json", big, 2);
    expect(store.list().map((r) => r.path)).toEqual(["new.json"]);
  });

  it("skip a document too big to keep, and survive unreadable or full storage", () => {
    const mem = memory();
    const store = new RecoveryStore(mem, "/p");
    store.save("huge.json", "x".repeat(MAX_RECOVERY_CHARS + 1), 1);
    expect(store.list()).toEqual([]);
    mem.m.set("nova.recovery.v1:/p", "{broken");
    expect(store.list()).toEqual([]);
    const full = { getItem: () => null, setItem: () => { throw new Error("quota"); }, removeItem: () => {} };
    expect(() => new RecoveryStore(full, "/p").save("a.lua", "x")).not.toThrow();
  });
});
