import { describe, expect, it } from "vitest";
import { CommandRegistry, formatChord, matches, parseChord, score } from "./commands";

const press = (key: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) =>
  ({ key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, isTrusted: true, ...mods }) as KeyboardEvent;

describe("shortcut notation", () => {
  it("reads modifiers and a key, and rejects a chord with no key", () => {
    expect(parseChord("Mod+Shift+Enter")).toEqual({ mod: true, ctrl: false, alt: false, shift: true, key: "enter" });
    expect(parseChord("F1").key).toBe("f1");
    expect(() => parseChord("Mod+Shift")).toThrow();
  });

  it("matches Cmd on a Mac and Ctrl elsewhere, and not with extra modifiers", () => {
    expect(matches(press("s", { metaKey: true }), "Mod+S", "mac")).toBe(true);
    expect(matches(press("s", { ctrlKey: true }), "Mod+S", "mac")).toBe(false);
    expect(matches(press("s", { ctrlKey: true }), "Mod+S", "win")).toBe(true);
    expect(matches(press("S", { ctrlKey: true, shiftKey: true }), "Mod+S", "win")).toBe(false);
    expect(matches(press("S", { ctrlKey: true, shiftKey: true }), "Mod+Shift+S", "win")).toBe(true);
    expect(matches(press("Enter", { metaKey: true, shiftKey: true }), "Mod+Shift+Enter", "mac")).toBe(true);
    expect(matches(press("F1"), "F1", "win")).toBe(true);
  });

  it("shows shortcuts the way each system writes them", () => {
    expect(formatChord("Mod+Shift+Enter", "mac")).toBe("⇧⌘↩");
    expect(formatChord("Mod+Shift+Enter", "win")).toBe("Ctrl+Shift+Enter");
    expect(formatChord("Mod+K", "mac")).toBe("⌘K");
    expect(formatChord("F1", "win")).toBe("F1");
  });
});

describe("the registry", () => {
  const make = (platform: "mac" | "win" = "mac") => {
    const r = new CommandRegistry(platform);
    const ran: string[] = [];
    let open = false;
    r.register({ id: "file.save", title: "Save", menu: "File", keys: ["Mod+S"], run: () => void ran.push("save") });
    r.register({ id: "run.play", title: "Play the game", menu: "Run", keys: ["Mod+Enter"], enabled: () => open, run: () => void ran.push("play") });
    r.register({ id: "help.open", title: "Open help", menu: "Help", keys: ["F1"], help: "Lessons and the manual", run: () => void ran.push("help") });
    return { r, ran, setOpen: (v: boolean) => (open = v) };
  };

  it("runs a command by key, and a command that is not available does not take the key", () => {
    const { r, ran, setOpen } = make();
    expect(r.forEvent(press("s", { metaKey: true }))?.id).toBe("file.save");
    expect(r.forEvent(press("Enter", { metaKey: true }))).toBeUndefined();
    setOpen(true);
    expect(r.forEvent(press("Enter", { metaKey: true }))?.id).toBe("run.play");
    return r.run("run.play").then((ok) => {
      expect(ok).toBe(true);
      expect(ran).toEqual(["play"]);
    });
  });

  it("refuses to run an unavailable or unknown command", async () => {
    const { r, ran } = make();
    expect(await r.run("run.play")).toBe(false);
    expect(await r.run("nope")).toBe(false);
    expect(ran).toEqual([]);
  });

  it("finds commands for the palette, best match first, and only the available ones", () => {
    const { r, setOpen } = make();
    expect(r.search("").map((c) => c.id)).toEqual(["file.save", "help.open"]); // (play is not available yet)
    expect(r.search("sav").map((c) => c.id)).toEqual(["file.save"]);
    expect(r.search("play")).toEqual([]);
    setOpen(true);
    expect(r.search("play").map((c) => c.id)).toEqual(["run.play"]);
    expect(r.search("help")[0]?.id).toBe("help.open");
  });

  it("builds a tooltip with the shortcut and the help line", () => {
    const { r } = make();
    expect(r.tooltip(r.get("help.open")!)).toBe("Open help (F1). Lessons and the manual");
    expect(r.tooltip(r.get("file.save")!)).toBe("Save (⌘S)");
  });

  it("reports two commands on the same keys, and unregisters", () => {
    const { r } = make();
    const off = r.register({ id: "x.save2", title: "Save somewhere", keys: ["Mod+S"], run: () => {} });
    expect(r.conflicts()).toEqual([{ keys: "M-s", ids: ["file.save", "x.save2"] }]);
    off();
    expect(r.conflicts()).toEqual([]);
  });

  it("tells listeners when a command is added or removed", () => {
    const { r } = make();
    let n = 0;
    const stop = r.onChange(() => n++);
    const off = r.register({ id: "z", title: "Z", run: () => {} });
    off();
    stop();
    r.register({ id: "y", title: "Y", run: () => {} });
    expect(n).toBe(2);
  });

  it("lists a menu in registration order and rejects a bad shortcut", () => {
    const { r } = make();
    expect(r.menu("File").map((c) => c.id)).toEqual(["file.save"]);
    expect(() => r.register({ id: "bad", title: "Bad", keys: ["Mod+"], run: () => {} })).toThrow();
  });
});

describe("palette scoring", () => {
  it("needs every word, and prefers matches at the start of a word", () => {
    expect(score("play game", "Play the game")).toBeGreaterThanOrEqual(0);
    expect(score("xyz", "Play the game")).toBe(-1);
    expect(score("pl", "Play the game")).toBeLessThan(score("ame", "Play the game"));
  });
});
