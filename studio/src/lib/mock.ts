import type { Api, CheckReport, Diagnostic, FileContent, FileEntry, LogLine } from "./types";

const STARTER: Record<string, string> = {
  "nova.json": JSON.stringify({ format: 1, name: "Mock Project", entry: "main.lua", world_height: 540, version: "0.1.0", input: { jump: ["key:Space", "pad:south"] } }, null, 2) + "\n",
  "main.lua": `-- Entry point: start the first scene.\nnova.start("title")\n`,
  "scenes/title.lua": `local Title = nova.scene {}\n\nfunction Title:enter()\n  self.t = 0\n  self:spawn("player", { x = 480, y = 270 })\nend\n\nfunction Title:update(dt)\n  self.t = self.t + dt\nend\n\nfunction Title:draw_ui()\n  nova.ui.text(24, 24, "Hello, Nova!", { size = 48, font = "rounded" })\nend\n\nreturn Title\n`,
  "entities/player.lua": `local Player = nova.entity { sprite = "player", w = 32, h = 32 }\n\nfunction Player:update(dt)\n  self.x = self.x + nova.input.axis("move_x") * 160 * dt\n  if nova.input.pressed("jump") then\n    nova.sound.play("jump")\n  end\nend\n\nreturn Player\n`,
};

export function createMockApi(): Api {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  let root: string | null = null;
  let running = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const logSubs = new Set<(l: LogLine) => void>();
  const exitSubs = new Set<(c: number | null) => void>();
  const recent: { path: string; name: string; opened: number }[] = [];

  const seed = (name: string) => {
    files.clear();
    dirs.clear();
    for (const [path, text] of Object.entries(STARTER)) {
      files.set(path, path === "nova.json" ? text.replace("Mock Project", name) : text);
      const parts = path.split("/");
      for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
    }
  };
  const need = () => {
    if (!root) throw "no project is open";
  };
  const bad = (path: string) => {
    if (!path || path.startsWith("/") || path.split("/").some((p) => p === ".." || p === "")) throw `'${path}' is not a path inside the project`;
  };
  const info = (name: string) => {
    root = `/mock/${name}`;
    recent.unshift({ path: root, name, opened: Math.floor(Date.now() / 1000) });
    return { root, name, version: "0.1.0" };
  };
  const emit = (stream: LogLine["stream"], line: string) => logSubs.forEach((cb) => cb({ stream, line }));
  const stop = () => {
    clearInterval(timer);
    running = false;
  };

  return {
    kind: "mock",
    recentProjects: async () => recent.slice(),
    forgetProject: async (path) => void recent.splice(0, recent.length, ...recent.filter((r) => r.path !== path)),
    templates: async () => [
      { id: "starter", name: "Starter", description: "A title scene, a player and a sprite sheet" },
      { id: "blank", name: "Blank", description: "Just nova.json and main.lua" },
    ],
    examples: async () => [{ id: "crate-dash", name: "Crate Dash", path: "/examples/crate-dash" }],
    defaultProjectsDir: async () => "/mock",
    pickFolder: async () => "/mock",
    openProject: async (path) => {
      seed(path.split("/").pop() || "Project");
      return info(path.split("/").pop() || "Project");
    },
    newProject: async (_parent, name) => {
      if (!name.trim()) throw "the project needs a name";
      seed(name);
      return info(name);
    },
    copyExample: async (_example, _parent, name) => {
      seed(name);
      return info(name);
    },
    closeProject: async () => {
      stop();
      root = null;
    },
    listFiles: async () => {
      need();
      const out: FileEntry[] = [...dirs].map((path) => ({ path, dir: true, size: 0 }));
      for (const [path, text] of files) out.push({ path, dir: false, size: text.length });
      return out.sort((a, b) => a.path.localeCompare(b.path));
    },
    readFile: async (path): Promise<FileContent> => {
      need();
      bad(path);
      const text = files.get(path);
      if (text === undefined) throw `'${path}' does not exist`;
      return { text, binary: false, size: text.length };
    },
    writeFile: async (path, text) => {
      need();
      bad(path);
      files.set(path, text);
    },
    createFile: async (path, contents) => {
      need();
      bad(path);
      if (files.has(path) || dirs.has(path)) throw `'${path}' already exists`;
      files.set(path, contents ?? "");
      const parts = path.split("/");
      for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
    },
    createDir: async (path) => {
      need();
      bad(path);
      dirs.add(path);
    },
    renameFile: async (from, to) => {
      need();
      bad(from);
      bad(to);
      if (files.has(to) || dirs.has(to)) throw `'${to}' already exists`;
      for (const [p, t] of [...files]) {
        if (p === from || p.startsWith(`${from}/`)) {
          files.delete(p);
          files.set(to + p.slice(from.length), t);
        }
      }
      for (const d of [...dirs]) {
        if (d === from || d.startsWith(`${from}/`)) {
          dirs.delete(d);
          dirs.add(to + d.slice(from.length));
        }
      }
    },
    deleteFile: async (path) => {
      need();
      bad(path);
      for (const p of [...files.keys()]) if (p === path || p.startsWith(`${path}/`)) files.delete(p);
      for (const d of [...dirs]) if (d === path || d.startsWith(`${path}/`)) dirs.delete(d);
      return `.nova/trash/${path}`;
    },
    runProject: async () => {
      need();
      if (running) throw "the game is already running";
      running = true;
      let n = 0;
      emit("stderr", "[mock] there is no native runtime in a browser; this is a simulated run");
      timer = setInterval(() => emit("stdout", `tick ${++n}`), 1000);
    },
    stopProject: async () => {
      const was = running;
      stop();
      if (was) exitSubs.forEach((cb) => cb(null));
      return was;
    },
    isRunning: async () => running,
    checkProject: async (): Promise<CheckReport> => {
      need();
      const diagnostics: Diagnostic[] = [];
      for (const [path, text] of files) {
        if (!path.endsWith(".lua")) continue;
        text.split("\n").forEach((line, i) => {
          if (/\bTODO_BREAK\b/.test(line)) diagnostics.push({ severity: "error", file: path, line: i + 1, place: null, message: "mock problem (TODO_BREAK)", detail: line });
        });
      }
      return { ok: diagnostics.length === 0, name: "Mock", frames_run: 120, diagnostics };
    },
    onPlayLog: async (cb) => {
      logSubs.add(cb);
      return () => void logSubs.delete(cb);
    },
    onPlayExit: async (cb) => {
      exitSubs.add(cb);
      return () => void exitSubs.delete(cb);
    },
  };
}
