import { getApi } from "./api";
import { editorStates } from "./editor-state";
import { newRaster } from "./pixels";
import { rasterToDataUrl } from "./png";
import { exportGlb } from "./glb";
import { newModel, serializeModel } from "./model-doc";
import { PRESETS, render, toJson } from "./sfx";
import { newSong, renderSong, serializeSong } from "./song";
import { newDoc, toSheetJson } from "./sprite-doc";
import { encodeWav, toBase64 } from "./wav";
import { moved, planRename } from "./refs";
import { renamePlan, resolveFrom, type Resource } from "./resources";
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
  /// The file changed on disk (outside the studio) while this tab had unsaved changes.
  conflict?: boolean;
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
  helpOpen = $state(false);
  /// Which part of the help window to show: "start", "lessons", "reference" or "keys"; lesson opens a lesson.
  helpTab: "start" | "lessons" | "reference" | "keys" = $state("start");
  helpLesson: string | null = $state(null);
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
    if (files) {
      this.files = files;
      void this.#readSpriteImages();
    }
  }

  /// Which picture each sprite file cuts up (its "image" key), so the resource tree can show the pair as one sprite.
  spriteImages: Map<string, string> = $state(new Map());
  async #readSpriteImages() {
    const next = new Map<string, string>();
    for (const f of this.files.filter((e) => !e.dir && e.path.endsWith(".sprite.json")).slice(0, 400)) {
      try {
        const text = (await this.api!.readFile(f.path)).text;
        const image = text ? (JSON.parse(text) as { image?: unknown }).image : undefined;
        if (typeof image === "string" && image) next.set(f.path, resolveFrom(f.path, image));
      } catch {
        // an unreadable sprite file shows as itself
      }
    }
    const same = next.size === this.spriteImages.size && [...next].every(([k, v]) => this.spriteImages.get(k) === v);
    if (!same) this.spriteImages = next;
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
    if (tab.conflict && !confirm(`${tab.path} was changed outside the studio since you opened it. Save anyway and replace that version?`)) return false;
    const text = tab.text;
    const ok = await this.#guard(async () => {
      await this.saveHooks.get(tab.path)?.();
      if (!tab.binary) await this.api!.writeFile(tab.path, text);
      return true;
    });
    if (ok) {
      tab.saved = text;
      tab.pending = false;
      tab.conflict = false;
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
  /// A new scene: its Lua in `scenes/<name>.lua` and its layout in `scenes/<name>.scene.json` (opened in the scene editor).
  async createScene(name: string) {
    const clean = name.trim().replace(/\.scene\.json$|\.lua$/i, "");
    if (!/^[A-Za-z0-9_-]+$/.test(clean)) return this.say("error", "Scene names use letters, numbers, - and _.");
    await this.#guard(async () => {
      const lua = `scenes/${clean}.lua`;
      const json = `scenes/${clean}.scene.json`;
      if (this.files.some((f) => f.path === lua || f.path === json)) throw `'${clean}' already exists in scenes/`;
      const id = clean.split(/[-_]+/).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("") || "Scene";
      await this.api!.createFile(lua, `-- A scene. Everything in ${clean}.scene.json is built before enter() runs.\nlocal ${/^[A-Za-z]/.test(id) ? id : `Scene${id}`} = nova.scene {}\n\nfunction ${/^[A-Za-z]/.test(id) ? id : `Scene${id}`}:enter()\nend\n\nreturn ${/^[A-Za-z]/.test(id) ? id : `Scene${id}`}\n`);
      await this.api!.createFile(json, '{\n  "version": 1,\n  "background": [40, 60, 90],\n  "objects": [],\n  "texts": []\n}\n');
      await this.refreshFiles();
      await this.openFile(json);
    });
  }

  /// A new entity: `entities/<name>.lua`.
  async createEntity(name: string) {
    const clean = name.trim().replace(/\.lua$/i, "");
    if (!/^[A-Za-z0-9_-]+$/.test(clean)) return this.say("error", "Entity names use letters, numbers, - and _.");
    await this.#guard(async () => {
      const lua = `entities/${clean}.lua`;
      if (this.files.some((f) => f.path === lua)) throw `'${clean}' already exists in entities/`;
      const id = clean.split(/[-_]+/).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
      const ident = /^[A-Za-z]/.test(id) ? id : `Entity${id}`;
      await this.api!.createFile(lua, `-- An entity: something in a scene that updates and draws itself.\nlocal ${ident} = nova.entity {}\n\nfunction ${ident}:update(dt)\nend\n\nreturn ${ident}\n`);
      await this.refreshFiles();
      await this.openFile(lua);
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

  /// A new sound effect: settings in `sounds/<name>.sfx.json` and the rendered `sounds/<name>.wav`.
  async createSound(name: string) {
    const clean = name.trim().replace(/\.sfx\.json$|\.wav$/i, "");
    if (!/^[A-Za-z0-9_-]+$/.test(clean)) return this.say("error", "Sound names use letters, numbers, - and _.");
    await this.#guard(async () => {
      const json = `sounds/${clean}.sfx.json`;
      const wav = `sounds/${clean}.wav`;
      if (this.files.some((f) => f.path === json || f.path === wav)) throw `'${clean}' already exists in sounds/`;
      await this.api!.writeAudio(wav, `data:audio/wav;base64,${toBase64(encodeWav(render(PRESETS.coin!)))}`);
      await this.api!.createFile(json, toJson(PRESETS.coin!));
      await this.refreshFiles();
      await this.openFile(json);
    });
  }

  /// A new model: `models/<name>.model.json` (what the editor edits) and the exported `models/<name>.glb`.
  async createModel(name: string) {
    const clean = name.trim().replace(/\.model\.json$|\.glb$/i, "");
    if (!/^[A-Za-z0-9_-]+$/.test(clean)) return this.say("error", "Model names use letters, numbers, - and _.");
    await this.#guard(async () => {
      const json = `models/${clean}.model.json`;
      const glb = `models/${clean}.glb`;
      if (this.files.some((f) => f.path === json || f.path === glb)) throw `'${clean}' already exists in models/`;
      const doc = newModel();
      await this.api!.writeModel(glb, `data:model/gltf-binary;base64,${toBase64(exportGlb(doc))}`);
      await this.api!.createFile(json, serializeModel(doc));
      await this.refreshFiles();
      await this.openFile(json);
    });
  }

  /// A new song: `music/<name>.song.json` (what the editor edits) and the rendered `music/<name>.ogg` (small, and streamed by the game).
  async createSong(name: string) {
    const clean = name.trim().replace(/\.song\.json$|\.wav$/i, "");
    if (!/^[A-Za-z0-9_-]+$/.test(clean)) return this.say("error", "Song names use letters, numbers, - and _.");
    await this.#guard(async () => {
      const json = `music/${clean}.song.json`;
      const ogg = `music/${clean}.ogg`;
      const wav = `music/${clean}.wav`;
      if (this.files.some((f) => f.path === json || f.path === ogg || f.path === wav)) throw `'${clean}' already exists in music/`;
      const song = newSong();
      await this.api!.writeOgg(ogg, `data:audio/wav;base64,${toBase64(encodeWav(renderSong(song)))}`);
      await this.api!.createFile(json, serializeSong(song));
      await this.refreshFiles();
      await this.openFile(json);
    });
  }

  /// Saves a rendered song (as a WAV data URL) as `music/<name>.ogg`. An older `music/<name>.wav` of the same name would
  /// shadow it (the game looks for .wav first), so it goes to the project's trash.
  async writeMusicOgg(oggPath: string, wavDataUrl: string) {
    await this.api!.writeOgg(oggPath, wavDataUrl);
    const wav = oggPath.replace(/\.ogg$/, ".wav");
    if (this.files.some((f) => f.path === wav)) await this.api!.deleteFile(wav);
    await this.refreshFiles();
  }

  /// Converts a WAV in the project to Ogg Vorbis, much smaller and streamed by the game when it is music. Unsaved edits to
  /// the WAV are saved first; the WAV goes to the trash; the Ogg opens in its place.
  async convertToOgg(path: string) {
    const tab = this.tabs.find((t) => t.path === path);
    if (tab && isDirty(tab) && !(await this.save(path))) return;
    await this.#guard(async () => {
      const target = await this.api!.convertToOgg(path);
      if (tab) {
        editorStates.forget(path);
        this.saveHooks.delete(path);
        this.sessions.delete(path);
        this.tabs = this.tabs.filter((t) => t.path !== path);
        if (this.active === path) this.active = this.tabs.at(-1)?.path ?? null;
      }
      await this.refreshFiles();
      await this.openFile(target);
      this.say("info", `Converted to ${target}. The WAV is in the project's trash.`);
    });
  }

  async createDir(path: string) {
    await this.#guard(async () => {
      await this.api!.createDir(path);
      await this.refreshFiles();
    });
  }
  /// Text of the project's Lua and JSON files for reference updates; open tabs count with their unsaved text.
  async #projectTexts(): Promise<Map<string, string>> {
    const texts = new Map<string, string>();
    const paths = this.files.filter((f) => !f.dir && /\.(lua|json)$/i.test(f.path) && f.size <= 1 << 20).map((f) => f.path);
    await Promise.all(
      paths.map(async (path) => {
        const open = this.tabs.find((t) => t.path === path && !t.binary);
        if (open) return void texts.set(path, open.text);
        const content = await this.api!.readFile(path).catch(() => null);
        if (content?.text != null) texts.set(path, content.text);
      }),
    );
    return texts;
  }

  async rename(from: string, to: string, references = true) {
    await this.#guard(async () => {
      // Work out which scripts and data files mention the old name before anything moves.
      const edits = references ? planRename(from, to, await this.#projectTexts(), this.files.map((f) => f.path)) : [];
      let apply = edits.length > 0 && confirm(`Update ${edits.reduce((n, e) => n + e.count, 0)} reference(s) in ${edits.length} file(s) to the new name?\n\n${edits.map((e) => `• ${e.file} (${e.count})`).join("\n")}`);
      await this.api!.renameFile(from, to);
      // A sprite's layers file travels with it.
      if (from.endsWith(".sprite.json") && to.endsWith(".sprite.json")) {
        const [layersFrom, layersTo] = [from, to].map((p) => p.replace(/\.sprite\.json$/, ".layers.json")) as [string, string];
        if (this.files.some((f) => f.path === layersFrom)) await this.api!.renameFile(layersFrom, layersTo).catch(() => {});
      }
      if (apply) {
        const skipped: string[] = [];
        for (const edit of edits) {
          const target = moved(edit.file, from, to) ?? edit.file;
          const unsaved = this.tabs.find((t) => (t.path === edit.file || t.path === target) && isDirty(t));
          if (unsaved) {
            skipped.push(edit.file);
            continue;
          }
          await this.api!.writeFile(target, edit.text);
        }
        if (skipped.length) this.say("error", `Not updated (unsaved changes): ${skipped.join(", ")}`);
        else this.say("info", `Updated references in ${edits.length} file(s)`);
        apply = true;
      }
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
      if (apply) await this.#reloadTabs();
      this.#scheduleCheck();
    });
  }

  /// Re-reads open text tabs whose files were rewritten on disk by a reference update.
  async #reloadTabs() {
    for (const tab of this.tabs) {
      if (tab.binary || isDirty(tab)) continue;
      const content = await this.api!.readFile(tab.path).catch(() => null);
      if (content?.text != null && content.text !== tab.saved) {
        tab.text = tab.saved = content.text;
        editorStates.forget(tab.path);
      }
    }
    const current = this.active;
    this.active = null;
    this.active = current; // remount the visible editor with the new text
  }

  /// Takes the file's text from disk into the tab and forgets editor state built on the old text.
  #adoptDisk(tab: Tab, text: string) {
    tab.text = tab.saved = text;
    tab.conflict = false;
    tab.pending = false;
    editorStates.forget(tab.path);
    this.saveHooks.delete(tab.path);
    this.sessions.delete(tab.path);
  }

  #remount() {
    const current = this.active;
    this.active = null;
    this.active = current; // the visible editor is rebuilt from the tab's text
  }

  /// Looks for files changed outside the studio (another editor, git, a script): tabs with nothing unsaved
  /// are reloaded, tabs with unsaved work are flagged so nothing is overwritten by surprise.
  async checkExternal() {
    if (!this.project || !this.api) return;
    let reloaded = false;
    for (const tab of [...this.tabs]) {
      if (tab.binary) continue;
      const disk = await this.api.readFile(tab.path).catch(() => null);
      if (!disk || disk.text == null || disk.text === tab.saved) continue;
      if (isDirty(tab)) tab.conflict = true;
      else {
        this.#adoptDisk(tab, disk.text);
        reloaded = true;
      }
    }
    const before = this.files.length;
    await this.refreshFiles();
    if (reloaded) this.#remount();
    // Re-check the project only when something actually changed under us.
    if (reloaded || this.files.length !== before) void this.check();
  }

  async useDiskVersion(path: string) {
    const tab = this.tabs.find((t) => t.path === path);
    const disk = tab && (await this.#guard(() => this.api!.readFile(path)));
    if (!tab || !disk || disk.text == null) return;
    this.#adoptDisk(tab, disk.text);
    this.#remount();
  }

  /// Keeps the tab's text; the next save will replace what is on disk.
  async keepMine(path: string) {
    const tab = this.tabs.find((t) => t.path === path);
    const disk = tab && (await this.#guard(() => this.api!.readFile(path)));
    if (!tab || !disk || disk.text == null) return;
    tab.saved = disk.text; // the new baseline, so it is not flagged again
    tab.conflict = false;
  }

  /// Writes a lesson's code into the project (asking before it replaces a file) and opens it.
  async applySnippet(path: string, code: string) {
    if (!this.project) return this.say("error", "Open a project first, then add the code to it.");
    const exists = this.files.some((f) => f.path === path);
    if (exists && !confirm(`Replace ${path} with the lesson's version? Your version will be gone.`)) return;
    await this.#guard(async () => {
      if (exists) {
        await this.api!.writeFile(path, code);
        await this.checkExternal(); // clean tabs reload; a tab with unsaved changes is flagged instead of overwritten
      } else {
        await this.api!.createFile(path, code);
        await this.refreshFiles();
      }
      await this.openFile(path);
      this.say("info", `${exists ? "Replaced" : "Added"} ${path}`);
    });
  }

  openHelp(tab: "start" | "lessons" | "reference" | "keys" = "start", lesson: string | null = null) {
    this.helpTab = tab;
    this.helpLesson = lesson;
    this.helpOpen = true;
  }

  /// Renames a resource (a sprite, model, scene...) by renaming all of its files together; scripts that name it are updated once.
  async renameResource(resource: Resource, name: string) {
    const clean = name.trim();
    if (!clean || /[\\:*?"<>|]/.test(clean)) return this.say("error", "That name has characters a file cannot have.");
    // a sprite's layers file travels with its JSON on its own
    const plan = renamePlan(resource, clean).filter(([from]) => !(from.endsWith(".layers.json") && resource.path.endsWith(".sprite.json")));
    if (!plan.length) return;
    const clash = plan.find(([, to]) => this.files.some((f) => f.path === to));
    if (clash) return this.say("error", `'${clash[1]}' already exists.`);
    for (const [i, [from, to]] of plan.entries()) await this.rename(from, to, i === 0);
  }

  /// Moves every file of a resource to the project's trash.
  async removeResource(resource: Resource) {
    for (const path of resource.files) if (!(path.endsWith(".layers.json") && resource.path.endsWith(".sprite.json"))) await this.remove(path);
  }

  async remove(path: string) {
    await this.#guard(async () => {
      const where = await this.api!.deleteFile(path);
      const layersFile = path.endsWith(".sprite.json") ? path.replace(/\.sprite\.json$/, ".layers.json") : "";
      if (layersFile && this.files.some((f) => f.path === layersFile)) await this.api!.deleteFile(layersFile).catch(() => {});
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
