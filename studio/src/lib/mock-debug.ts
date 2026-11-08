// A pretend game for the browser preview's debugger (mock.ts): it answers the same requests as the runtime
// (docs/debugger.md) from a small made-up scene, stops at breakpoints in the project's own Lua files and steps line by
// line through them. Nothing here runs Lua; the stack and values are invented from the file's text.

import type { DebugMessage, DebugRequest } from "./types";

interface Value {
  name: string;
  value: string;
  type: string;
  ref?: number;
}

interface Thing {
  id: number;
  name: string;
  kind: "scene" | "entity";
  tags: string[];
  fields: Record<string, number | string | boolean>;
}

const describe = (name: string, v: number | string | boolean): Value =>
  typeof v === "string" ? { name, value: JSON.stringify(v), type: "string" } : { name, value: String(typeof v === "number" ? +v.toFixed(4) : v), type: typeof v };

export interface MockDebugger {
  send(m: DebugRequest): void;
  start(): void;
  stop(): void;
  /// A Lua file was saved while the game runs: say what a reload did.
  saved(path: string): string;
}

export function createMockDebugger(files: Map<string, string>, emit: (m: DebugMessage) => void): MockDebugger {
  let breakpoints: Record<string, number[]> = {};
  let pauseOnErrors = true;
  let paused: { file: string; line: number; reason: string } | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  let highlight: number | null = null;
  let ticks = 0;
  let stepping = false;
  const things: Thing[] = [
    { id: 0, name: "play", kind: "scene", tags: [], fields: { score: 0, time: 0, paused: false } },
    { id: 1, name: "hero", kind: "entity", tags: ["player"], fields: { x: 120, y: 300, speed: 140, name: "Ada", visible: true, lives: 3 } },
    { id: 2, name: "coin", kind: "entity", tags: ["coin"], fields: { x: 300, y: 260, value: 10, visible: true } },
    { id: 3, name: "coin", kind: "entity", tags: ["coin"], fields: { x: 360, y: 260, value: 10, visible: true } },
    { id: 4, name: "slime", kind: "entity", tags: ["enemy"], fields: { x: 520, y: 300, speed: 40, hp: 2, angry: false } },
  ];
  const [scene_, hero_] = things as [Thing, Thing, ...Thing[]];
  const tables: Record<number, Value[]> = { 100: [describe("gold", 3), describe("keys", 1)] };

  const reply = (id: number, result: unknown) => emit({ reply: id, ok: true, result });
  const refuse = (id: number, error: string) => emit({ reply: id, ok: false, error });

  const codeLines = (file: string) =>
    (files.get(file) ?? "").split("\n").map((text, i) => ({ text: text.trim(), line: i + 1 })).filter((l) => l.text && !l.text.startsWith("--"));

  const funcAt = (file: string, line: number) => {
    const lines = (files.get(file) ?? "").split("\n").slice(0, line);
    for (let i = lines.length - 1; i >= 0; i--) {
      const m = lines[i]?.match(/function\s+([\w.:]+)\s*\(/);
      if (m) return m[1];
    }
    return "(top of the file)";
  };

  const stack = () =>
    paused
      ? [
          { file: paused.file, line: paused.line, func: funcAt(paused.file, paused.line), depth: 3, internal: false },
          { file: null, line: -1, func: "step", depth: 2, internal: true },
          { file: "main.lua", line: 1, func: "update", depth: 1, internal: false },
        ]
      : [];

  const stopAt = (file: string, line: number, reason: string, message: string | null = null) => {
    paused = { file, line, reason };
    emit({ event: "paused", reason, file, line, message, stack: stack() });
  };

  const tick = () => {
    if (paused) return;
    ticks++;
    const hero = hero_.fields;
    hero.x = ((hero.x as number) + (hero.speed as number) / 30) % 960;
    scene_.fields.time = +(ticks / 10).toFixed(1);
    // a breakpoint is "hit" a moment after the game runs past it
    const first = Object.entries(breakpoints).find(([, l]) => l.length);
    if (first && ticks % 15 === 0) stopAt(first[0], first[1][0] ?? 1, "breakpoint");
  };

  const locals = (): Value[] => {
    if (!paused) return [];
    const text = (files.get(paused.file) ?? "").split("\n").slice(0, paused.line).join("\n");
    const names = [...text.matchAll(/local\s+([A-Za-z_]\w*)\s*=/g)].map((m) => m[1]);
    const out: Value[] = [{ name: "self", value: "hero entity #1", type: "table", ref: 101 }, describe("dt", 0.016667)];
    for (const n of [...new Set(names)].slice(-6)) if (n) out.push(describe(n, n.length * 7));
    return out;
  };

  return {
    start() {
      ticks = 0;
      paused = null;
      timer = setInterval(tick, 100);
      setTimeout(() => emit({ event: "connected", port: 0 }), 10);
    },
    stop() {
      clearInterval(timer);
      paused = null;
      emit({ event: "disconnected" });
    },
    saved(path: string) {
      if (path === "main.lua" || !path.endsWith(".lua")) {
        emit({ event: "reloaded", kept: false, reason: `${path} changed, and it runs once when the game starts` });
        return `[mock INFO nova_runtime::content] reload: restarted the game (${path} changed, and it runs once when the game starts)`;
      }
      emit({ event: "reloaded", kept: true, files: [path] });
      return `[mock INFO nova_runtime::content] reload: kept the game running with the new code of ${path}`;
    },
    send(m: DebugRequest) {
      const id = m.id;
      // answers come a moment later, as they would over a socket
      setTimeout(() => {
        switch (m.cmd) {
          case "hello":
          case "ready":
            return reply(id, { protocol: 1, name: "Mock Project", paused: !!paused, pause_on_errors: pauseOnErrors });
          case "set_breakpoints": {
            const lines = [...new Set(((m.lines as number[]) ?? []).filter((l) => l > 0))].sort((a, b) => a - b);
            breakpoints = { ...breakpoints, [m.file as string]: lines };
            return reply(id, { file: m.file, lines });
          }
          case "pause_on_errors":
            pauseOnErrors = m.on !== false;
            return reply(id, { on: pauseOnErrors });
          case "pause": {
            reply(id, {});
            if (!paused) {
              const file = files.has("main.lua") ? "main.lua" : [...files.keys()].find((f) => f.endsWith(".lua")) ?? "main.lua";
              const first = codeLines(file)[0];
              stopAt(file, first?.line ?? 1, "step");
            }
            return;
          }
          case "continue":
          case "step_over":
          case "step_into":
          case "step_out": {
            if (!paused) return refuse(id, "the game is not paused");
            reply(id, {});
            const at = paused;
            paused = null;
            emit({ event: "resumed" });
            if (m.cmd === "continue") return;
            stepping = true;
            const next = codeLines(at.file).find((l) => l.line > at.line);
            setTimeout(() => {
              stepping = false;
              stopAt(at.file, next?.line ?? at.line, "step");
            }, 60);
            return;
          }
          case "stack":
            return paused ? reply(id, stack()) : refuse(id, "the game is not paused");
          case "scope": {
            if (!paused) return refuse(id, "the game is not paused");
            if (m.which === "upvalues") return reply(id, [{ name: "Hero", value: "hero (entity class)", type: "table", ref: 102 }, describe("SPEED", 140)]);
            if (m.which === "globals") return reply(id, [{ name: "update", value: "function (main.lua:3)", type: "function" }, { name: "draw", value: "function (main.lua:9)", type: "function" }]);
            return reply(id, locals());
          }
          case "children": {
            const r = m.ref as number;
            if (r === 101) return reply(id, Object.entries(hero_.fields).map(([k, v]) => describe(k, v)).concat([{ name: "bag", value: "{ 2 fields }", type: "table", ref: 100 }]));
            if (r === 102) return reply(id, [{ name: "update", value: "function (entities/hero.lua:4)", type: "function" }]);
            return tables[r] ? reply(id, tables[r]) : refuse(id, "that value is no longer open (the game moved on); look again");
          }
          case "entities":
            return reply(id, {
              scene: "play",
              count: things.length - 1,
              entities: things.map((t) => ({ id: t.id, name: t.name, label: t.id === 1 ? "hero" : null, kind: t.kind, x: t.fields.x ?? null, y: t.fields.y ?? null, tags: t.tags })),
            });
          case "entity": {
            const t = things.find((x) => x.id === m.target);
            if (!t) return refuse(id, `there is no entity #${String(m.target)} now`);
            const out = Object.entries(t.fields).map(([k, v]) => describe(k, v));
            if (t.id === 1) out.push({ name: "bag", value: "{ 2 fields }", type: "table", ref: 100 });
            return reply(id, out.sort((a, b) => a.name.localeCompare(b.name)));
          }
          case "set": {
            const key = String(m.key);
            const value = m.value as number | string | boolean;
            if (typeof m.ref === "number") {
              const list = tables[m.ref];
              const e = list?.find((x) => x.name === key);
              if (!e) return refuse(id, "that object is gone");
              Object.assign(e, describe(key, value));
              return reply(id, describe(key, value));
            }
            const t = things.find((x) => x.id === m.target);
            if (!t) return refuse(id, "that object is gone");
            const now = t.fields[key];
            if (now !== undefined && typeof now !== typeof value) return refuse(id, `'${key}' holds ${typeof now}, not ${typeof value}`);
            t.fields[key] = value;
            return reply(id, describe(key, value));
          }
          case "highlight":
            highlight = (m.target as number | null) ?? null;
            return reply(id, { target: highlight });
          default:
            return refuse(id, `unknown request '${m.cmd}'`);
        }
      }, stepping ? 0 : 5);
    },
  };
}
