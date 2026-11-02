import { getApi } from "./api";
import { editorStates } from "./editor-state";
import { newRaster } from "./pixels";
import { rasterToDataUrl } from "./png";
import { newDoc, toSheetJson } from "./sprite-doc";
import { byFile } from "./diagnostics";
import { projectSymbols, type ProjectSymbols } from "./completions";
import type { Api, Diagnostic, ExampleInfo, FileEntry, LogLine, ProjectInfo, RecentProject, TemplateInfo } from "./types";

export interface Tab {
  path: string;
  text: string;
  saved: string;
  binary: boolean;
  size: number;
  /// Changes that live outside `text` (a sprite's pixels) and still need saving.
  pending?: boolean;
}

export const isDirty = (t: Tab) => t.text !== t.saved || !!t.pending;

export type Panel = "problems" | "play";

const MAX_LOG = 2000;

function message(e: unknown): string {
  return typeof e === "string" ? e : e instanceof Error ? e.message : JSON.stringify(e);
}

class Studio {
  api: Api | null = $state(null);
  ready = $state(false);
  busy = $state(false);
  notice: { kind: "error" | "info"; text: string } | null = $state(null);

  recents: RecentProject[] = $state([]);
  templates: TemplateInfo[] = $state([]);
  examples: ExampleInfo[] = $state([]);
  projectsDir = $state("");

  project: ProjectInfo | null = $state(null);
  files: FileEntry[] = $state([]);
  tabs: Tab[] = $state([]);
  active: string | null = $state(null);
  diagnostics: Diagnostic[] = $state([]);
  checking = $state(false);
  checkedAt: number | null = $state(null);

  running = $state(false);
  log: LogLine[] = $state([]);
  panel: Panel = $state("problems");
  panelOpen = $state(true);
  jump: { path: string; line: number; nonce: number } | null = $state(null);

  /// Editors with their own files to save (a sprite's PNG) register here; run before the text is written.
  saveHooks = new Map<string, () => Promise<void>>();
  /// Per-file editor sessions (a sprite's pixels and undo history) that outlive switching tabs.
  sessions = new Map<string, unknown>();
  #unlisten: (() => void)[] = [];
  #checkTimer: ReturnType<typeof setTimeout> | undefined;

  get tab(): Tab | undefined {
    return this.tabs.find((t) => t.path === this.active);
  }
  get dirty(): boolean {
    return this.tabs.some(isDirty);
  }
  get symbols(): ProjectSymbols {
    const manifest = this.tabs.find((t) => t.path === "nova.json")?.text;
    return projectSymbols(
      this.files.filter((f) => !f.dir).map((f) => f.path),
      manifest,
    );
  }
  problemsByFile(): Map<string, Diagnostic[]> {
    return byFile(this.diagnostics);
  }

  say(kind: "error" | "info", text: string) {
    this.notice = { kind, text };
    if (kind === "info") {
      const shown = this.notice;
      setTimeout(() => {
        if (this.notice === shown) this.notice = null;
      }, 3500);
    }
  }

  async #guard<T>(work: () => Promise<T>): Promise<T | undefined> {
    try {
      return await work();
    } catch (e) {
      this.say("error", message(e));
      return undefined;
    }
  }

  async init() {
    this.api = await getApi();
    const api = this.api;
    this.#unlisten.push(
      await api.onPlayLog((line) => {
        this.log.push(line);
        if (this.log.length > MAX_LOG) this.log.splice(0, this.log.length - MAX_LOG);
      }),
      await api.onPlayExit((code) => {
        this.running = false;
        this.log.push({ stream: "stderr", line: code === null || code === 0 ? "— game closed —" : `— game exited with code ${code} —` });
      }),
    );
    await this.#guard(async () => {
      [this.recents, this.templates, this.examples, this.projectsDir] = await Promise.all([api.recentProjects(), api.templates(), api.examples(), api.defaultProjectsDir()]);
    });
    this.running = await api.isRunning().catch(() => false);
    this.ready = true;
  }

  async #enter(info: ProjectInfo) {
    this.project = info;
    this.tabs = [];
    this.active = null;
    this.diagnostics = [];
    this.checkedAt = null;
    this.log = [];
    this.panel = "problems";
    await this.refreshFiles();
    for (const first of ["main.lua", "nova.json"]) {
      if (this.files.some((f) => f.path === first)) {
        await this.openFile(first);
        break;
      }
    }
    void this.check();
  }

  async #open(work: () => Promise<ProjectInfo>) {
    this.busy = true;
    const info = await this.#guard(work);
    this.busy = false;
    if (info) await this.#enter(info);
  }

  openProject(path: string) {
    return this.#open(() => this.api!.openProject(path));
  }
  newProject(parent: string, name: string, template: string) {
    return this.#open(() => this.api!.newProject(parent, name, template));
  }
  copyExample(example: string, parent: string, name: string) {
    return this.#open(() => this.api!.copyExample(example, parent, name));
  }
  async forget(path: string) {
    await this.#guard(async () => {
      await this.api!.forgetProject(path);
      this.recents = await this.api!.recentProjects();
    });
  }
  async pickAndOpen() {
    const folder = await this.#guard(() => this.api!.pickFolder("Open a Nova project folder"));
    if (folder) await this.openProject(folder);
  }
  async pickFolder(title: string) {
    return (await this.#guard(() => this.api!.pickFolder(title))) ?? null;
  }

  async closeProject() {
    if (this.dirty && !confirm("Close the project? Unsaved changes will be lost.")) return;
    await this.#guard(async () => {
      await this.api!.closeProject();
      this.project = null;
      this.files = [];
      this.tabs = [];
      this.active = null;
      this.running = false;
      this.recents = await this.api!.recentProjects();
    });
  }

  async refreshFiles() {
    const files = await this.#guard(() => this.api!.listFiles());
    if (files) this.files = files;
  }

  async openFile(path: string, line?: number) {
    if (!this.tabs.some((t) => t.path === path)) {
      const content = await this.#guard(() => this.api!.readFile(path));
      if (!content) return;
      const text = content.text ?? "";
      this.tabs.push({ path, text, saved: text, binary: content.binary, size: content.size });
    }
    this.active = path;
    if (line) this.jump = { path, line, nonce: Date.now() };
  }

  closeTab(path: string) {
    const tab = this.tabs.find((t) => t.path === path);
    if (tab && isDirty(tab) && !confirm(`Close ${path} without saving?`)) return;
    editorStates.forget(path);
    this.saveHooks.delete(path);
    this.sessions.delete(path);
    const index = this.tabs.findIndex((t) => t.path === path);
    this.tabs = this.tabs.filter((t) => t.path !== path);
    if (this.active === path) this.active = this.tabs[Math.min(index, this.tabs.length - 1)]?.path ?? null;
  }

  /// An editor changed something that is not in the tab's text (pixels): mark the tab unsaved.
  markPending(path: string) {
    const tab = this.tabs.find((t) => t.path === path);
    if (tab) tab.pending = true;
  }

  edit(path: string, text: string) {
    const tab = this.tabs.find((t) => t.path === path);
    if (tab) tab.text = text;
  }

  async save(path = this.active) {
    const tab = this.tabs.find((t) => t.path === path);
    if (!tab || !isDirty(tab) || (tab.binary && !this.saveHooks.has(tab.path))) return true;
    const text = tab.text;
    const ok = await this.#guard(async () => {
      await this.saveHooks.get(tab.path)?.();
      if (!tab.binary) await this.api!.writeFile(tab.path, text);
      return true;
    });
    if (ok) {
      tab.saved = text;
      tab.pending = false;
      this.#scheduleCheck();
    }
    return !!ok;
  }

  async saveAll() {
    for (const tab of this.tabs) if (!(await this.save(tab.path))) return false;
    return true;
  }

  #scheduleCheck() {
    clearTimeout(this.#checkTimer);
    this.#checkTimer = setTimeout(() => void this.check(), 400);
  }

  async check() {
    if (!this.project) return;
    this.checking = true;
    const report = await this.#guard(() => this.api!.checkProject());
    this.checking = false;
    if (report) {
      this.diagnostics = report.diagnostics;
      this.checkedAt = Date.now();
    }
  }

  /// Opens the file and line a problem points at.
  showProblem(d: Diagnostic) {
    if (d.file) void this.openFile(d.file, d.line ?? 1);
  }

  async createFile(path: string, contents?: string) {
    await this.#guard(async () => {
      await this.api!.createFile(path, contents);
      await this.refreshFiles();
      await this.openFile(path);
    });
  }
  /// A new blank sprite: `sprites/<name>.png` and `sprites/<name>.sprite.json`, opened in the sprite studio.
  async createSprite(name: string, side: number) {
    const clean = name.trim().replace(/\.sprite\.json$|\.png$/i, "");
    if (!/^[A-Za-z0-9_-]+$/.test(clean)) return this.say("error", "Sprite names use letters, numbers, - and _.");
    await this.#guard(async () => {
      const json = `sprites/${clean}.sprite.json`;
      const png = `sprites/${clean}.png`;
      if (this.files.some((f) => f.path === json || f.path === png)) throw `'${clean}' already exists in sprites/`;
      await this.api!.writeImage(png, rasterToDataUrl(newRaster(side, side)));
      await this.api!.createFile(json, toSheetJson(newDoc(side, side), `${clean}.png`));
      await this.refreshFiles();
      await this.openFile(json);
    });
  }

  async createDir(path: string) {
    await this.#guard(async () => {
      await this.api!.createDir(path);
      await this.refreshFiles();
    });
  }
  async rename(from: string, to: string) {
    await this.#guard(async () => {
      await this.api!.renameFile(from, to);
      for (const tab of this.tabs) {
        if (tab.path === from || tab.path.startsWith(`${from}/`)) {
          const moved = to + tab.path.slice(from.length);
          editorStates.forget(tab.path);
          this.saveHooks.delete(tab.path);
          this.sessions.delete(tab.path);
          if (this.active === tab.path) this.active = moved;
          tab.path = moved;
        }
      }
      await this.refreshFiles();
      this.#scheduleCheck();
    });
  }
  async remove(path: string) {
    await this.#guard(async () => {
      const where = await this.api!.deleteFile(path);
      for (const tab of this.tabs.filter((t) => t.path === path || t.path.startsWith(`${path}/`))) {
        tab.text = tab.saved;
        tab.pending = false;
        this.closeTab(tab.path);
      }
      await this.refreshFiles();
      this.say("info", `Moved to ${where}`);
      this.#scheduleCheck();
    });
  }

  async play() {
    if (!(await this.saveAll())) return;
    this.log = [];
    this.panel = "play";
    this.panelOpen = true;
    await this.#guard(async () => {
      await this.api!.runProject();
      this.running = true;
    });
  }
  async stop() {
    await this.#guard(async () => {
      await this.api!.stopProject();
      this.running = false;
    });
  }
}

export const studio = new Studio();
