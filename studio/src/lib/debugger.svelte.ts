// The studio's side of the debugger (docs/debugger.md): breakpoints, the paused game's stack and variables, the running
// scene's objects, and what a reload did. Talks to the game only through `Api.debugSend` / `Api.onDebugMessage`.

import type { Api, DebugMessage, DebugRequest } from "./types";

/// One value as the game describes it: `ref` opens a table.
export interface DebugValue {
  name: string;
  value: string;
  type: string;
  ref?: number;
}

export interface DebugFrame {
  file: string | null;
  line: number | null;
  func: string;
  /// Frames from the bottom of the stack: how the game names a frame.
  depth: number;
  /// Nova's framework or the engine, not the person's code.
  internal: boolean;
}

export interface Paused {
  reason: "breakpoint" | "step" | "error";
  file: string | null;
  line: number | null;
  message: string | null;
  stack: DebugFrame[];
}

export interface ObjectRow {
  id: number;
  name: string;
  kind: "scene" | "entity";
  /// The scene's field that holds it (`self.hero`), when there is one.
  label?: string | null;
  x?: number | null;
  y?: number | null;
  z?: number | null;
  tags: string[];
}

export type Scope = "locals" | "upvalues" | "globals";

/// What the last reload did, from the game's log line (works without the debugger too).
export interface ReloadNote {
  kept: boolean;
  failed: boolean;
  text: string;
  at: number;
}

/// Reads the runtime's reload line (`content.rs`), or null for other lines.
export function reloadNote(line: string, at = Date.now()): ReloadNote | null {
  let m = line.match(/reload: kept the game running with the new code of (.+)$/);
  if (m) return { kept: true, failed: false, text: `Kept the game running with the new code of ${(m[1] ?? "").trim()}`, at };
  m = line.match(/reload: restarted the game \((.+)\)\s*$/);
  if (m) return { kept: false, failed: false, text: `Restarted the game: ${m[1]}`, at };
  m = line.match(/reload: not applied, the old code keeps running: (.+)$/);
  if (m) return { kept: true, failed: true, text: `New code not loaded (the old code keeps running): ${(m[1] ?? "").trim()}`, at };
  return null;
}

/// The value typed into an object's field, as the kind the field holds. Null when it does not read as that kind.
export function parseField(type: string, text: string): number | string | boolean | null {
  if (type === "number") {
    const t = text.trim();
    if (t === "" || !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return null;
    return Number(t);
  }
  if (type === "boolean") return text === "true" ? true : text === "false" ? false : null;
  if (type === "string") return text;
  return null;
}

/// A string value as the game shows it ("\"Ada\"") back to its text (Ada).
export function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }
  return value;
}

const STORE = "nova.breakpoints:";

export class DebugSession {
  connected = $state(false);
  /// Breakpoint lines per project file (kept for the project in the browser's storage).
  breakpoints: Record<string, number[]> = $state({});
  paused: Paused | null = $state(null);
  /// The frame being looked at while paused.
  frame: number | null = $state(null);
  scope: Scope = $state("locals");
  values: DebugValue[] | null = $state(null);
  /// Opened tables, by ref.
  open: Record<number, DebugValue[]> = $state({});
  pauseOnErrors = $state(true);
  objects: { scene: string | null; list: ObjectRow[]; count: number } = $state({ scene: null, list: [], count: 0 });
  selected: number | null = $state(null);
  fields: DebugValue[] = $state([]);
  /// The last request the game refused, in its words.
  problem: string | null = $state(null);
  reload: ReloadNote | null = $state(null);

  #api: Api | null = null;
  #next = 1;
  #waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: string) => void }>();
  #project = "";
  /// Opens a file at a line (the store's jump), set by `attach`.
  #show: (file: string, line: number) => void = () => {};

  async attach(api: Api, show: (file: string, line: number) => void) {
    this.#api = api;
    this.#show = show;
    return api.onDebugMessage((m) => this.receive(m));
  }

  /// The project whose breakpoints to keep (its folder).
  useProject(root: string) {
    this.#project = root;
    try {
      const saved = globalThis.localStorage?.getItem(STORE + root);
      this.breakpoints = saved ? (JSON.parse(saved) as Record<string, number[]>) : {};
    } catch {
      this.breakpoints = {};
    }
  }

  #saveBreakpoints() {
    try {
      globalThis.localStorage?.setItem(STORE + this.#project, JSON.stringify(this.breakpoints));
    } catch {
      // (storage can be off; breakpoints then last until the studio closes)
    }
  }

  request(cmd: string, args: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.#api || !this.connected) return Promise.reject("the game is not running with the debugger");
    const id = this.#next++;
    const message: DebugRequest = { ...args, id, cmd };
    return new Promise((resolve, reject) => {
      this.#waiting.set(id, { resolve, reject });
      this.#api!.debugSend(message).catch((e) => {
        this.#waiting.delete(id);
        reject(String(e));
      });
    });
  }

  /// A request whose failure is shown in the panel instead of thrown.
  async #try<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T | undefined> {
    try {
      const r = (await this.request(cmd, args)) as T;
      this.problem = null;
      return r;
    } catch (e) {
      this.problem = String(e);
      return undefined;
    }
  }

  receive(m: DebugMessage) {
    if (typeof m.reply === "number") {
      const w = this.#waiting.get(m.reply);
      if (!w) return;
      this.#waiting.delete(m.reply);
      if (m.ok) w.resolve(m.result);
      else w.reject(m.error ?? "the game refused");
      return;
    }
    switch (m.event) {
      case "connected":
        this.connected = true;
        void this.#start();
        break;
      case "disconnected":
        this.#reset();
        break;
      case "paused":
        this.#paused(m as unknown as Paused);
        break;
      case "resumed":
        this.paused = null;
        this.frame = null;
        this.values = null;
        this.open = {};
        break;
      case "reloaded": {
        const failed = m.failed as { file: string; error: string } | undefined;
        const files = (m.files as string[] | undefined) ?? [];
        this.reload = failed
          ? { kept: true, failed: true, text: `New code not loaded (the old code keeps running): ${failed.file}: ${failed.error}`, at: Date.now() }
          : m.kept
            ? { kept: true, failed: false, text: `Kept the game running with the new code of ${files.join(", ")}`, at: Date.now() }
            : { kept: false, failed: false, text: `Restarted the game: ${String(m.reason ?? "")}`, at: Date.now() };
        if (!m.kept) void this.refreshObjects();
        break;
      }
    }
  }

  /// A log line from the game: the reload line says what a reload did even when no debugger is attached.
  noteLog(line: string) {
    const note = reloadNote(line);
    if (note) this.reload = note;
    return note;
  }

  async #start() {
    // breakpoints and the error setting go first; `ready` lets the game start its scripts
    await this.#try("pause_on_errors", { on: this.pauseOnErrors });
    for (const [file, lines] of Object.entries(this.breakpoints)) {
      if (lines.length) await this.#try("set_breakpoints", { file, lines });
    }
    await this.#try("ready");
  }

  #reset() {
    this.connected = false;
    this.paused = null;
    this.frame = null;
    this.values = null;
    this.open = {};
    this.objects = { scene: null, list: [], count: 0 };
    this.selected = null;
    this.fields = [];
    for (const w of this.#waiting.values()) w.reject("the game has gone");
    this.#waiting.clear();
  }

  #paused(p: Paused) {
    this.paused = { reason: p.reason, file: p.file ?? null, line: p.line ?? null, message: p.message ?? null, stack: p.stack ?? [] };
    this.open = {};
    const top = this.paused.stack.find((f) => !f.internal) ?? this.paused.stack[0];
    if (top) void this.selectFrame(top);
  }

  async selectFrame(f: DebugFrame) {
    this.frame = f.depth;
    if (f.file && f.line) this.#show(f.file, f.line);
    await this.loadScope(this.scope);
  }

  async loadScope(which: Scope) {
    this.scope = which;
    if (!this.paused || this.frame === null) return;
    const v = await this.#try<DebugValue[]>("scope", { depth: this.frame, which });
    this.values = v ?? [];
  }

  /// Opens or closes a table (in the variables or the object's fields).
  async toggle(ref: number) {
    if (this.open[ref]) {
      const { [ref]: _, ...rest } = this.open;
      this.open = rest;
      return;
    }
    const v = await this.#try<DebugValue[]>("children", { ref });
    if (v) this.open = { ...this.open, [ref]: v };
  }

  // ---------------------------------------------------------------- stepping
  resume = (how: "continue" | "step_over" | "step_into" | "step_out") => this.#try(how);
  pause = () => this.#try("pause");
  async setPauseOnErrors(on: boolean) {
    this.pauseOnErrors = on;
    if (this.connected) await this.#try("pause_on_errors", { on });
  }

  // ---------------------------------------------------------------- breakpoints
  linesOf(file: string): number[] {
    return this.breakpoints[file] ?? [];
  }

  toggleBreakpoint(file: string, line: number) {
    const now = this.linesOf(file);
    this.setBreakpoints(file, now.includes(line) ? now.filter((l) => l !== line) : [...now, line]);
  }

  /// Replaces a file's breakpoints (the editor calls this as lines move with typing).
  setBreakpoints(file: string, lines: number[]) {
    const clean = [...new Set(lines.filter((l) => Number.isInteger(l) && l > 0))].sort((a, b) => a - b);
    const before = this.linesOf(file);
    if (clean.length === before.length && clean.every((l, i) => l === before[i])) return;
    const next = { ...this.breakpoints };
    if (clean.length) next[file] = clean;
    else delete next[file];
    this.breakpoints = next;
    this.#saveBreakpoints();
    if (this.connected) void this.#try("set_breakpoints", { file, lines: clean });
  }

  clearBreakpoints() {
    for (const file of Object.keys(this.breakpoints)) this.setBreakpoints(file, []);
  }

  // ---------------------------------------------------------------- the running scene's objects
  /// With `fields` false the picked object's fields are left alone (someone is typing in one).
  async refreshObjects(fields = true) {
    const r = await this.#try<{ scene: string | null; entities: ObjectRow[]; count: number }>("entities");
    if (!r) return;
    this.objects = { scene: r.scene ?? null, list: r.entities ?? [], count: r.count ?? 0 };
    if (this.selected !== null) {
      if (this.objects.list.some((o) => o.id === this.selected)) {
        if (fields) await this.#loadFields();
      } else {
        this.selected = null;
        this.fields = [];
      }
    }
  }

  async select(id: number | null) {
    this.selected = id;
    this.open = {};
    await this.#try("highlight", { target: id });
    if (id === null) this.fields = [];
    else await this.#loadFields();
  }

  async #loadFields() {
    if (this.selected === null) return;
    const v = await this.#try<DebugValue[]>("entity", { target: this.selected });
    if (v) this.fields = v;
  }

  /// Sets a field of the selected object (or of an opened table, `ref`). Returns false when the text is not that kind.
  async setField(entry: DebugValue, text: string, ref?: number): Promise<boolean> {
    const value = parseField(entry.type, text);
    if (value === null) {
      this.problem = `'${text}' is not ${entry.type === "number" ? "a number" : "true or false"}`;
      return false;
    }
    const key = /^\d+$/.test(entry.name) ? Number(entry.name) : entry.name;
    const target = ref !== undefined ? { ref } : { target: this.selected };
    const r = await this.#try<DebugValue>("set", { ...target, key, value });
    if (!r) return false;
    if (ref !== undefined) {
      this.open = { ...this.open, [ref]: (this.open[ref] ?? []).map((e) => (e.name === entry.name ? { ...e, value: r.value } : e)) };
    } else {
      this.fields = this.fields.map((e) => (e.name === entry.name ? { ...e, value: r.value } : e));
    }
    return true;
  }
}

export const debug = new DebugSession();
