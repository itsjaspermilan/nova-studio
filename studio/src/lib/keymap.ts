// The person's keymap choices, kept between runs: which preset (Blender's keys or Nova's own) and the shortcuts they changed. Applied to the
// command registry (lib/commands.ts) so the menus, the palette and the editors all see the same keys.

import type { CommandRegistry, Keymap } from "./commands";

const STORE = "nova.keymap.v1";

interface Saved {
  preset: Keymap;
  overrides: Record<string, string[]>;
}

type Store = Pick<Storage, "getItem" | "setItem">;

export class KeymapSettings {
  preset: Keymap = "blender";
  overrides: Record<string, string[]> = {};
  #storage: Store;
  #registry: CommandRegistry;

  constructor(registry: CommandRegistry, storage?: Store) {
    this.#registry = registry;
    this.#storage = storage ?? (typeof localStorage === "undefined" ? { getItem: () => null, setItem: () => {} } : localStorage);
    try {
      const raw = this.#storage.getItem(STORE);
      if (raw) {
        const s = JSON.parse(raw) as Partial<Saved>;
        if (s.preset === "blender" || s.preset === "nova") this.preset = s.preset;
        if (s.overrides && typeof s.overrides === "object") {
          for (const [id, chords] of Object.entries(s.overrides)) if (Array.isArray(chords) && chords.every((c) => typeof c === "string")) this.overrides[id] = chords;
        }
      }
    } catch {
      // unreadable: the defaults
    }
    this.#apply();
  }

  setPreset(preset: Keymap): void {
    this.preset = preset;
    this.#save();
  }

  /// Gives a command shortcuts of the person's choosing (an empty list means none).
  setKeys(id: string, chords: string[]): void {
    this.overrides = { ...this.overrides, [id]: chords };
    this.#save();
  }

  /// A command back to the preset's shortcuts.
  reset(id: string): void {
    const { [id]: _gone, ...rest } = this.overrides;
    this.overrides = rest;
    this.#save();
  }

  resetAll(): void {
    this.overrides = {};
    this.#save();
  }

  #apply() {
    try {
      this.#registry.configure(this.preset, this.overrides);
    } catch {
      // a saved shortcut that no longer parses: drop the changes rather than the keymap
      this.overrides = {};
      this.#registry.configure(this.preset, {});
    }
  }

  #save() {
    this.#apply();
    try {
      this.#storage.setItem(STORE, JSON.stringify({ preset: this.preset, overrides: this.overrides } satisfies Saved));
    } catch {
      // not remembered
    }
  }
}

/// A chord from a key press, in the generic notation ("Mod+Shift+G"): what the shortcut editor records. null for a lone modifier.
export function chordOf(e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">, platform: "mac" | "win"): string | null {
  if (["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock"].includes(e.key)) return null;
  const parts: string[] = [];
  // (Mod is Cmd on a Mac and Ctrl elsewhere; the other one of the two is written out)
  const mod = platform === "mac" ? e.metaKey : e.ctrlKey;
  const other = platform === "mac" ? e.ctrlKey : e.metaKey;
  if (mod) parts.push("Mod");
  if (other) parts.push(platform === "mac" ? "Ctrl" : "Meta");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  const key = e.key === " " ? "Space" : e.key === "+" ? "Plus" : e.key.length === 1 ? e.key.toUpperCase() : e.key;
  parts.push(key);
  return parts.join("+");
}
