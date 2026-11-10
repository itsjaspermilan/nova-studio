import { describe, expect, it } from "vitest";
import { CommandRegistry } from "./commands";
import { accelerator, drawnMenus, resolveMenus, type MenuLine } from "./menus";

const make = () => {
  const r = new CommandRegistry("mac");
  let open = false;
  r.register({ id: "a", title: "Alpha", keys: ["Mod+A"], run: () => {} });
  r.register({ id: "b", title: "Beta", enabled: () => open, run: () => {} });
  r.register({ id: "u", title: "Undo", keys: ["Mod+Z"], forward: true, run: () => {} });
  return { r, setOpen: (v: boolean) => (open = v) };
};
const layout = (lines: MenuLine[], title = "File") => [{ title, lines }];

describe("resolving the menus", () => {
  it("lists the registered commands with their shortcuts and availability, and leaves out the unknown ones", () => {
    const { r } = make();
    const menus = resolveMenus(r, layout([{ id: "a" }, { id: "missing" }, { id: "b" }]));
    expect(menus).toHaveLength(1);
    expect(menus[0]!.items.map((i) => [i.id, i.shortcut, i.enabled])).toEqual([["a", "⌘A", true], ["b", "", false]]);
  });

  it("follows a command becoming available", () => {
    const { r, setOpen } = make();
    expect(resolveMenus(r, layout([{ id: "b" }]))[0]!.items[0]!.enabled).toBe(false);
    setOpen(true);
    expect(resolveMenus(r, layout([{ id: "b" }]))[0]!.items[0]!.enabled).toBe(true);
  });

  it("never starts, ends or doubles a menu with a separator, and drops an empty menu", () => {
    const { r } = make();
    const m = resolveMenus(r, layout(["-", { id: "a" }, "-", "-", { id: "b" }, "-"]));
    expect(m[0]!.items.map((i) => (i.separator ? "-" : i.id))).toEqual(["a", "-", "b"]);
    expect(resolveMenus(r, layout([{ id: "nothing" }]))).toEqual([]);
  });

  it("keeps native-only items for the native menu and drops them from the drawn one", () => {
    const { r } = make();
    const lines: MenuLine[] = [{ id: "a" }, "-", { native: "minimize" }];
    expect(resolveMenus(r, layout(lines))[0]!.items.map((i) => i.native)).toEqual([undefined, undefined, "minimize"]);
    expect(drawnMenus(r).every((m) => m.items.every((i) => i.separator || i.id))).toBe(true);
  });

  it("writes accelerators the way the native menu reads them", () => {
    expect(accelerator("Mod+Shift+Enter")).toBe("CmdOrCtrl+Shift+Enter");
    expect(accelerator("F1")).toBe("F1");
  });
});

describe("commands the page handles itself", () => {
  it("leave the key press alone, and ignore key presses that came from a script", () => {
    const { r } = make();
    const real = { key: "z", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, isTrusted: true } as KeyboardEvent;
    expect(r.forEvent(real)).toBeUndefined();
    const a = { ...real, key: "a" } as KeyboardEvent;
    expect(r.forEvent(a)?.id).toBe("a");
    expect(r.forEvent({ ...a, isTrusted: false } as KeyboardEvent)).toBeUndefined();
  });
});

describe("Alt letters for the drawn menus", () => {
  it("takes the first free letter of each title", async () => {
    const { mnemonicsFor } = await import("./menus");
    expect(mnemonicsFor(["File", "Edit", "Code", "View", "Model", "Sprite", "Sound", "Run", "Window", "Help"])).toEqual(["f", "e", "c", "v", "m", "s", "o", "r", "w", "h"]);
    expect(mnemonicsFor(["Aa", "Aa"])).toEqual(["a", ""]);
    expect(mnemonicsFor([])).toEqual([]);
  });
});

describe("menus of a workspace", () => {
  it("shows the menus that belong to the workspace you are in, and the ones for every workspace", () => {
    const { r } = make();
    const spec = [{ title: "File", lines: [{ id: "a" } as MenuLine] }, { title: "Mesh", for: ["model"], lines: [{ id: "b" } as MenuLine] }, { title: "Sprite", for: ["sprites"], lines: [{ id: "a" } as MenuLine] }];
    expect(resolveMenus(r, spec, "model").map((m) => m.title)).toEqual(["File", "Mesh"]);
    expect(resolveMenus(r, spec, "sprites").map((m) => m.title)).toEqual(["File", "Sprite"]);
    expect(resolveMenus(r, spec).map((m) => m.title)).toEqual(["File", "Mesh", "Sprite"]);
  });
});

import { MENU_LAYOUT } from "./menus";
describe("the menu layout follows the wireframes", () => {
  const ofWorkspace = (w: string) => MENU_LAYOUT.filter((m) => !m.for || m.for.includes(w));
  it("each workspace has the menus the wireframe names, once each", () => {
    expect(ofWorkspace("sprites").map((m) => m.title)).toEqual(expect.arrayContaining(["File", "Edit", "Image", "Layer", "Frame", "Select", "Window", "Help"]));
    expect(ofWorkspace("sound").map((m) => m.title)).toEqual(expect.arrayContaining(["File", "Edit", "Track", "Clip", "Mixer", "Window", "Help"]));
    expect(ofWorkspace("engine").map((m) => m.title)).toEqual(expect.arrayContaining(["File", "Edit", "View", "Project", "Run", "Device", "Window", "Help"]));
    expect(ofWorkspace("model").map((m) => m.title)).toEqual(expect.arrayContaining(["File", "Edit", "Add", "Object", "Select", "Mesh", "Window", "Help"]));
    for (const w of ["model", "sprites", "sound", "engine"]) {
      const titles = ofWorkspace(w).map((m) => m.title);
      expect(new Set(titles).size, w).toBe(titles.length);
    }
  });
  it("no command is in two menus of one workspace", () => {
    for (const w of ["model", "sprites", "sound", "engine"]) {
      const ids = ofWorkspace(w).flatMap((m) => m.lines.flatMap((l) => (typeof l === "object" && "id" in l ? [l.id] : [])));
      expect(ids.filter((id, i) => ids.indexOf(id) !== i), w).toEqual([]);
    }
  });
});
