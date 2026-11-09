// The command registry: every action the studio can do is a command with an id, a plain name, an optional icon, shortcuts and a rule for
// when it is available. Menus, toolbars, the command palette (Cmd/Ctrl-K), tooltips and the shortcut editor all read this one list
// (docs/studio-ux.md, section 1), so a feature is added once. Shortcuts are written "Mod+S": Mod is Cmd on a Mac and Ctrl elsewhere.

export type Platform = "mac" | "win";

export interface Command {
  id: string;
  /// Plain words, sentence case, verb first: "Save all", "Play the game".
  title: string;
  /// The menu it lives in ("File", "Edit", "View", "Run", "Help"...); every command is in a menu or the palette, never icon-only.
  menu?: string;
  icon?: string;
  /// Shortcuts in the generic notation ("Mod+Shift+Enter", "F1"); the first is the one shown.
  keys?: string[];
  /// One line for the tooltip and the help search.
  help?: string;
  enabled?: () => boolean;
  run: () => void | Promise<void>;
}

export function detectPlatform(): Platform {
  return typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent) ? "mac" : "win";
}

interface Chord {
  mod: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  key: string; // lower case, or a named key such as "enter", "f1"
}

/// "Mod+Shift+Enter" -> its parts. Names are case-insensitive; a lone "+" key is written "Plus".
export function parseChord(text: string): Chord {
  const parts = text.split("+").map((p) => p.trim());
  const chord: Chord = { mod: false, ctrl: false, alt: false, shift: false, key: "" };
  for (const part of parts) {
    const p = part.toLowerCase();
    if (p === "mod") chord.mod = true;
    else if (p === "ctrl" || p === "control") chord.ctrl = true;
    else if (p === "alt" || p === "option") chord.alt = true;
    else if (p === "shift") chord.shift = true;
    else chord.key = p === "plus" ? "+" : p === "esc" ? "escape" : p;
  }
  if (!chord.key) throw new Error(`"${text}" names no key`);
  return chord;
}

const KEY_EVENT_NAMES: Record<string, string> = { " ": "space" };

/// Whether a keyboard event is this chord on the given platform. Extra modifiers must not be held (Mod+S is not Mod+Shift+S).
export function matches(e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">, text: string, platform: Platform): boolean {
  const c = parseChord(text);
  const wantMeta = c.mod && platform === "mac";
  const wantCtrl = c.ctrl || (c.mod && platform !== "mac");
  const key = (KEY_EVENT_NAMES[e.key] ?? e.key).toLowerCase();
  // (Shift changes a letter's case; compare lower case, and the shift flag separately)
  return key === c.key && e.metaKey === wantMeta && e.ctrlKey === wantCtrl && e.altKey === c.alt && e.shiftKey === c.shift;
}

const MAC_KEY_NAMES: Record<string, string> = { enter: "↩", escape: "⎋", backspace: "⌫", delete: "⌦", tab: "⇥", space: "Space", arrowup: "↑", arrowdown: "↓", arrowleft: "←", arrowright: "→" };
const WIN_KEY_NAMES: Record<string, string> = { enter: "Enter", escape: "Esc", backspace: "Backspace", delete: "Del", tab: "Tab", space: "Space", arrowup: "Up", arrowdown: "Down", arrowleft: "Left", arrowright: "Right" };

/// How to show a shortcut: "⌘⇧↩" on a Mac, "Ctrl+Shift+Enter" elsewhere.
export function formatChord(text: string, platform: Platform): string {
  const c = parseChord(text);
  const named = (platform === "mac" ? MAC_KEY_NAMES : WIN_KEY_NAMES)[c.key];
  const key = named ?? (c.key.length === 1 ? c.key.toUpperCase() : c.key.toUpperCase());
  if (platform === "mac") return `${c.ctrl ? "⌃" : ""}${c.alt ? "⌥" : ""}${c.shift ? "⇧" : ""}${c.mod ? "⌘" : ""}${key}`;
  return [c.mod || c.ctrl ? "Ctrl" : "", c.alt ? "Alt" : "", c.shift ? "Shift" : "", key].filter(Boolean).join("+");
}

/// A normal form of a chord for finding two commands that use the same keys.
function canonical(text: string, platform: Platform): string {
  const c = parseChord(text);
  const meta = c.mod && platform === "mac";
  const ctrl = c.ctrl || (c.mod && platform !== "mac");
  return `${meta ? "M" : ""}${ctrl ? "C" : ""}${c.alt ? "A" : ""}${c.shift ? "S" : ""}-${c.key}`;
}

/// How well a query matches a title: lower is better, -1 for no match. Every query word must appear; earlier and word-start hits win.
export function score(query: string, title: string): number {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  const t = title.toLowerCase();
  let total = 0;
  for (const w of words) {
    const at = t.indexOf(w);
    if (at < 0) return -1;
    total += at + (at === 0 || t[at - 1] === " " ? 0 : 5);
  }
  return total;
}

export class CommandRegistry {
  private list = new Map<string, Command>();
  constructor(public platform: Platform = detectPlatform()) {}

  /// Adds a command (replacing one with the same id) and returns a function that removes it.
  register(cmd: Command): () => void {
    for (const k of cmd.keys ?? []) parseChord(k); // fail early on a bad shortcut
    this.list.set(cmd.id, cmd);
    return () => {
      if (this.list.get(cmd.id) === cmd) this.list.delete(cmd.id);
    };
  }

  all(): Command[] {
    return [...this.list.values()];
  }

  get(id: string): Command | undefined {
    return this.list.get(id);
  }

  isEnabled(cmd: Command): boolean {
    return cmd.enabled ? cmd.enabled() : true;
  }

  /// Runs a command by id if it exists and is available. Returns whether it ran.
  async run(id: string): Promise<boolean> {
    const cmd = this.list.get(id);
    if (!cmd || !this.isEnabled(cmd)) return false;
    await cmd.run();
    return true;
  }

  /// The command a key press is for (an unavailable command does not take the key).
  forEvent(e: KeyboardEvent): Command | undefined {
    for (const cmd of this.list.values()) {
      if (!this.isEnabled(cmd)) continue;
      if (cmd.keys?.some((k) => matches(e, k, this.platform))) return cmd;
    }
    return undefined;
  }

  /// The shortcut to show next to a command, in this platform's notation ("" if it has none).
  shortcut(cmd: Command): string {
    return cmd.keys?.[0] ? formatChord(cmd.keys[0], this.platform) : "";
  }

  /// Tooltip text: the title, the shortcut and the help line.
  tooltip(cmd: Command): string {
    const sc = this.shortcut(cmd);
    return [sc ? `${cmd.title} (${sc})` : cmd.title, cmd.help].filter(Boolean).join(". ");
  }

  /// The palette's results: available commands matching the query, best first (all of them, by menu then title, for an empty query).
  search(query: string): Command[] {
    const scored: { cmd: Command; s: number }[] = [];
    for (const cmd of this.list.values()) {
      if (!this.isEnabled(cmd)) continue;
      const s = score(query, `${cmd.title} ${cmd.menu ?? ""}`);
      if (s >= 0) scored.push({ cmd, s });
    }
    scored.sort((a, b) => a.s - b.s || (a.cmd.menu ?? "").localeCompare(b.cmd.menu ?? "") || a.cmd.title.localeCompare(b.cmd.title));
    return scored.map((x) => x.cmd);
  }

  /// Shortcuts claimed by more than one command, for the shortcut editor and a test that keeps the defaults clean.
  conflicts(): { keys: string; ids: string[] }[] {
    const byKeys = new Map<string, string[]>();
    for (const cmd of this.list.values()) {
      for (const k of cmd.keys ?? []) {
        const c = canonical(k, this.platform);
        byKeys.set(c, [...(byKeys.get(c) ?? []), cmd.id]);
      }
    }
    return [...byKeys.entries()].filter(([, ids]) => ids.length > 1).map(([keys, ids]) => ({ keys, ids }));
  }

  /// The commands of one menu, in the order they were registered (what a menu bar shows).
  menu(name: string): Command[] {
    return this.all().filter((c) => c.menu === name);
  }
}

export const commands = new CommandRegistry();
