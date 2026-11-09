// The menu bar's contents: which commands sit in which menu, in order. The drawn menu (Windows and the browser preview) and the
// native macOS menu are both built from this and from the command registry (lib/commands.ts), so a command is added in one place.

import type { CommandRegistry, Platform } from "./commands";
import { sendChord } from "./commands";

/// One line of a menu: a command (by id), a native-only item the system provides (macOS Window menu, text editing), or a separator.
export type MenuLine = { id: string; native?: string } | { native: string } | "-";

export const MENU_LAYOUT: { title: string; lines: MenuLine[] }[] = [
  { title: "File", lines: [{ id: "file.save" }, { id: "file.saveAll" }, "-", { id: "file.export" }, "-", { id: "file.close" }] },
  {
    title: "Edit",
    lines: [{ id: "edit.undo" }, { id: "edit.redo" }, "-", { id: "edit.cut", native: "cut" }, { id: "edit.copy", native: "copy" }, { id: "edit.paste", native: "paste" }, { id: "edit.selectAll", native: "selectAll" }],
  },
  { title: "View", lines: [{ id: "view.tree" }] },
  { title: "Run", lines: [{ id: "run.play" }, { id: "run.playDevice" }, "-", { id: "tool.simulate" }, { id: "tool.storeArt" }] },
  { title: "Window", lines: [{ id: "workspace.model" }, { id: "workspace.sprites" }, { id: "workspace.sound" }, { id: "workspace.engine" }, "-", { native: "minimize" }, { native: "maximize" }] },
  { title: "Help", lines: [{ id: "help.toggle" }, { id: "palette.open" }] },
];

export interface ResolvedItem {
  /// The command to run; absent for a separator or a native-only item.
  id?: string;
  title?: string;
  /// The shortcut in this platform's notation, for display.
  shortcut: string;
  /// The generic shortcut ("Mod+S"), which the native menu turns into its own accelerator.
  chord?: string;
  enabled: boolean;
  separator?: boolean;
  /// A system-provided item (macOS) such as "cut" or "minimize".
  native?: string;
}
export interface ResolvedMenu {
  title: string;
  items: ResolvedItem[];
}

/// The menus as they are right now: commands that are not registered are left out, a menu with nothing in it is left out, a separator
/// never starts, ends or doubles a menu. Reads each command's availability, so calling it inside a Svelte effect follows the state.
export function resolveMenus(registry: CommandRegistry, layout = MENU_LAYOUT): ResolvedMenu[] {
  const out: ResolvedMenu[] = [];
  for (const menu of layout) {
    const items: ResolvedItem[] = [];
    for (const line of menu.lines) {
      if (line === "-") {
        if (items.length && !items[items.length - 1]!.separator) items.push({ separator: true, shortcut: "", enabled: true });
        continue;
      }
      if ("id" in line) {
        const cmd = registry.get(line.id);
        if (!cmd) continue;
        items.push({ id: cmd.id, title: cmd.title, shortcut: registry.shortcut(cmd), chord: cmd.keys?.[0], enabled: registry.isEnabled(cmd), native: line.native });
      } else {
        items.push({ native: line.native, shortcut: "", enabled: true });
      }
    }
    while (items.length && items[items.length - 1]!.separator) items.pop();
    if (items.length) out.push({ title: menu.title, items });
  }
  return out;
}

/// The menus for the drawn menu bar: native-only items have nothing to run there and are dropped.
export function drawnMenus(registry: CommandRegistry): ResolvedMenu[] {
  return resolveMenus(registry)
    .map((m) => {
      const items = m.items.filter((i) => i.separator || i.id);
      while (items.length && items[items.length - 1]!.separator) items.pop();
      return { ...m, items };
    })
    .filter((m) => m.items.length);
}

/// A generic shortcut as the native menu writes it: "Mod+Shift+Enter" -> "CmdOrCtrl+Shift+Enter".
export function accelerator(chord: string): string {
  return chord
    .split("+")
    .map((p) => (p.toLowerCase() === "mod" ? "CmdOrCtrl" : p.toLowerCase() === "enter" ? "Enter" : p))
    .join("+");
}

export { sendChord };
export type { Platform };
