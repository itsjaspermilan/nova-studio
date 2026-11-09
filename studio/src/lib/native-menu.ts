// The macOS menu bar: the real system menu, built by the Tauri backend (src-tauri/src/menu.rs) from the same list the drawn menu uses
// (lib/menus.ts). The studio sends the resolved menus whenever they change (a command becoming available); a click comes back as a
// "menu-command" event carrying the command id. Only runs inside the macOS app.

import { commands } from "./commands";
import { accelerator, resolveMenus, type ResolvedMenu } from "./menus";

let last = "";

export async function syncNativeMenu(menus: ResolvedMenu[] = resolveMenus(commands)): Promise<void> {
  const spec = menus.map((m) => ({
    title: m.title,
    items: m.items.map((i) => ({
      id: i.id ?? null,
      title: i.title ?? null,
      accelerator: i.chord ? accelerator(i.chord) : null,
      enabled: i.enabled,
      native: i.native ?? null,
      separator: !!i.separator,
    })),
  }));
  const text = JSON.stringify(spec);
  if (text === last) return; // nothing changed since the last time
  last = text;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_menu", { menus: spec });
}

/// Runs the command a menu click names. Returns a function that stops listening.
export async function listenNativeMenu(): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  return listen<string>("menu-command", (e) => void commands.run(e.payload));
}
