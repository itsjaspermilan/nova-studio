import { getApi } from "./api";
import { editorStates } from "./editor-state";
import { newRaster } from "./pixels";
import { rasterToDataUrl } from "./png";
import { exportGlb } from "./glb";
import { importWithColours } from "./model-load";
import { newModel, serializeModel } from "./model-doc";
import { PRESETS, render, toJson } from "./sfx";
import { parseObj } from "./obj";
import { fitForProject, freeName, kindFor, safeSoundName } from "./audio-import";
import { templateById } from "./song-templates";
import { renderSong, serializeSong } from "./song";
import { newTrack, serializeTrack, trackOf } from "./track-doc";
import { animOf, newAnim, serializeAnim } from "./anim-doc";
import { newDoc, toSheetJson } from "./sprite-doc";
import { encodeWav, fromBase64, toBase64, type Sound } from "./wav";
import { moved, planRename } from "./refs";
import { groupResources, renamePlan, resolveFrom, type Resource } from "./resources";
import { diffFiles, stampsOf, type FileDiff } from "./file-changes";
import { byFile } from "./diagnostics";
import { projectSymbols, type ProjectSymbols } from "./completions";
import { PerfTracker, type Hitch, type PerfSample } from "./perf";
import { ACTIVITY_FILE, parseActivity, type Activity } from "./activity";
import { debug } from "./debugger.svelte";
import { inWorkspace, workspaceOf, type WorkspaceId } from "./workspaces";
import { layout } from "./layout.svelte";
import { RecoveryStore, type Recovered } from "./recovery";
import { deviceHint, lastDevice, NO_DEVICE, preferredDevice, rememberDevice } from "./devices";
import type { AndroidDevice, Api, Diagnostic, ExampleInfo, ExportReport, FileEntry, LogLine, ProjectInfo, RecentProject, TemplateInfo } from "./types";

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

export type Panel = "problems" | "play" | "debug" | "objects" | "activity" | "assets" | "saves" | "soundbank";

const MAX_LOG = 2000;
/// A new resource's name: letters, numbers, - and _, with / between folders (`levels/castle-1` is `castle-1` in the group's `levels` folder).
const RESOURCE_NAME = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/;
/// The last part of such a name (what a scene's or entity's Lua variable and a sprite's picture are named after).
const leaf = (name: string) => name.slice(name.lastIndexOf("/") + 1);
/// Files an editor reads as pictures, sounds or models, not as text: a change is told by their size and time.
const ASSET_FILE = /\.(png|wav|ogg|glb|gltf|ttf|otf)$/i;

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
  /// The workspace on show (lib/workspaces.ts); a document's tab only shows in its own workspace.
  workspace: WorkspaceId = $state("engine");
  /// The document each workspace had on show when it was left.
  #lastActive: Partial<Record<WorkspaceId, string>> = {};
  diagnostics: Diagnostic[] = $state([]);
  checking = $state(false);
  checkedAt: number | null = $state(null);

  running = $state(false);
  /// Play on device: the devices found last time the menu was opened, why none can be used, and while the game is
  /// being built, installed and started, the step it is on.
  devices: AndroidDevice[] = $state([]);
  devicesProblem: string | null = $state(null);
  lookingForDevices = $state(false);
  /// The device the game runs (or is being put) on; null while it runs on this computer or not at all.
  playingOn: AndroidDevice | null = $state(null);
  deviceStep: string | null = $state(null);
  log: LogLine[] = $state([]);
  panel: Panel = $state("problems");
  /// The bottom panel (problems, play, debugger) of the workspace on show; each workspace remembers its own (lib/layout.svelte.ts).
  get panelOpen(): boolean {
    return layout.get(this.workspace).panelOpen;
  }
  set panelOpen(open: boolean) {
    layout.set(this.workspace, { panelOpen: open });
  }
  helpOpen = $state(false);
  /// A tool that takes over the window: store art or the simulation harness.
  tool: "art" | "sim" | null = $state(null);
  /// The numbers the running game reports about its speed (see perf.ts).
  perf: { latest: PerfSample | null; history: PerfSample[]; hitches: Hitch[]; worst: number } = $state({ latest: null, history: [], hitches: [], worst: 0 });
  #perf = new PerfTracker();
  exportOpen = $state(false);
  snapshotsOpen = $state(false);
  exporting = $state(false);
  exportReport: ExportReport | null = $state(null);
  /// Which part of the help window to show: "start", "lessons", "reference" or "keys"; lesson opens a lesson.
  helpTab: "start" | "lessons" | "reference" | "keys" = $state("start");
  helpLesson: string | null = $state(null);
  jump: { path: string; line: number; nonce: number } | null = $state(null);

  /// Editors with their own files to save (a sprite's PNG) register here; run before the text is written.
  saveHooks = new Map<string, () => Promise<void>>();
  /// Per-file editor sessions (a sprite's pixels and undo history) that outlive switching tabs.
  sessions = new Map<string, unknown>();
  #unlisten: (() => void)[] = [];
  /// The size and time of every file when the studio last looked, to tell what changed on disk since.
  #stamps = new Map<string, string>();
  /// Saves in flight: a look at the disk waits, so the studio's own writes are not taken for someone else's.
  #writing = 0;
  /// Files changed, added or removed on disk (outside the studio, or by its own saves), newest first: views that
  /// keep pictures, sounds or models (the scene canvas, the asset lists) watch `n` and reload what is in `paths`.
  fileChanges: { n: number; paths: string[] } = $state({ n: 0, paths: [] });
  #checkTimer: ReturnType<typeof setTimeout> | undefined;

  /// Unsaved text from a last session that ended without saving, offered back when the project opens.
  recoverable: Recovered[] = $state([]);
  #recovery: RecoveryStore | null = null;

  /// Keeps a recovery copy of every document with unsaved text (and forgets the copies of those that are saved). Called every half minute,
  /// and when the window is hidden or closing.
  snapshot() {
    const store = this.#recovery;
    if (!store) return;
    for (const tab of this.tabs) {
      if (tab.binary) continue;
      if (tab.text !== tab.saved) store.save(tab.path, tab.text);
      else store.remove(tab.path);
    }
  }

  /// Puts the recovered text back into tabs (as unsaved changes) and clears the offer.
  async restoreRecovered() {
    const items = this.recoverable;
    this.recoverable = [];
    for (const item of items) {
      await this.openFile(item.path);
      this.edit(item.path, item.text);
    }
    this.notice = { kind: "info", text: `Restored unsaved changes in ${items.length} file${items.length === 1 ? "" : "s"}. Save them when you are happy.` };
  }

  discardRecovered() {
    for (const item of this.recoverable) this.#recovery?.remove(item.path);
    this.recoverable = [];
  }

  /// Copies from the last session that still differ from the file on disk (the others are stale and are removed).
  async #findRecoverable() {
    const store = this.#recovery;
    if (!store || !this.api) return;
    const found: Recovered[] = [];
    for (const item of store.list()) {
      const onDisk = await this.api.readFile(item.path).then((c) => (c.binary ? null : (c.text ?? "")), () => null);
      if (onDisk === null || onDisk === item.text) store.remove(item.path);
      else found.push(item);
    }
    this.recoverable = found;
  }

  /// Set in a window made for one document (a tear-off): the path of that document. The main window leaves it null.
  docWindow: string | null = $state(null);

  /// Moves a document to a window of its own: saves it, gives up its tab here, and opens the new window with it.
  async tearOff(path = this.active) {
    if (!path || !this.api) return;
    const tab = this.tabs.find((t) => t.path === path);
    if (!tab) return;
    if (isDirty(tab) && !(await this.save(path))) return;
    this.closeTab(path);
    try {
      await this.api.tearOffDocument(path);
    } catch (e) {
      this.say("error", message(e));
      await this.openFile(path); // it stays here
    }
  }

  /// A window made for one document joins the project that is already open and shows just that document.
  async joinProject(path: string) {
    const api = this.api;
    if (!api) return;
    const info = await api.currentProject().catch(() => null);
    if (!info) {
      this.say("error", "The project is not open any more.");
      return;
    }
    this.docWindow = path;
    this.project = info;
    this.#recovery = new RecoveryStore(typeof localStorage === "undefined" ? { getItem: () => null, setItem: () => {}, removeItem: () => {} } : localStorage, info.root);
    debug.useProject(info.root);
    this.tabs = [];
    this.active = null;
    await this.refreshFiles();
    await this.openFile(path); // (the new window was given the document already, so this claim succeeds)
  }

  /// The tabs of the workspace on show.
  get workspaceTabs(): Tab[] {
    return inWorkspace(this.tabs, this.workspace);
  }

  /// Shows a workspace, with the document it had on show last (or its first open one, or none).
  setWorkspace(id: WorkspaceId) {
    if (id === this.workspace) return;
    if (this.active && workspaceOf(this.active) === this.workspace) this.#lastActive[this.workspace] = this.active;
    this.workspace = id;
    const remembered = this.#lastActive[id];
    const open = inWorkspace(this.tabs, id);
    this.active = (remembered && open.some((t) => t.path === remembered) ? remembered : open[0]?.path) ?? null;
  }

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
        // what a reload did (kept the game running, or started it again) is said in the studio, not only in the log
        const reload = debug.noteLog(line.line);
        if (reload) this.say(reload.failed ? "error" : "info", reload.text);
        if (this.#perf.feed(line.line)) {
          this.perf = { latest: this.#perf.latest, history: this.#perf.history, hitches: this.#perf.hitches, worst: this.#perf.worst };
          // the once-a-second speed line is shown in the speed strip, not in the log (a hitch line stays in both)
          if (!line.line.includes("hitch:")) return;
        }
        this.log.push(line);
        if (this.log.length > MAX_LOG) this.log.splice(0, this.log.length - MAX_LOG);
      }),
      await api.onDeviceStep((step) => {
        if (this.playingOn) this.deviceStep = step;
      }),
      await debug.attach(api, (file, line) => {
        void this.openFile(file, line);
        // a pause shows the debugger
        if (debug.paused && this.panel !== "debug") {
          this.panel = "debug";
          this.panelOpen = true;
        }
      }),
      await api.onPlayExit((code) => {
        this.running = false;
        this.playingOn = null;
        this.deviceStep = null;
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
    this.#recovery = new RecoveryStore(typeof localStorage === "undefined" ? { getItem: () => null, setItem: () => {}, removeItem: () => {} } : localStorage, info.root);
    this.recoverable = [];
    debug.useProject(info.root);
    this.tabs = [];
    this.active = null;
    this.diagnostics = [];
    this.checkedAt = null;
    this.log = [];
    this.panel = "problems";
    // what happened before the project was opened is history, not news
    this.activity = [];
    this.activitySeen = 0;
    void this.refreshActivity().then(() => this.markActivitySeen());
    this.#stamps = new Map();
    await this.refreshFiles();
    for (const first of ["main.lua", "nova.json"]) {
      if (this.files.some((f) => f.path === first)) {
        await this.openFile(first);
        break;
      }
    }
    await this.#findRecoverable();
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

  /// What the Nova MCP server has done to this project lately (newest first), read from `.nova/activity.jsonl`.
  activity: Activity[] = $state([]);
  /// The time of the newest call the person has looked at, so the tab can show that something new happened.
  activitySeen = $state(0);

  /// Reads the activity log again (cheap; the studio asks every few seconds while a project is open). With the panel showing,
  /// everything counts as seen.
  async refreshActivity() {
    if (!this.api || !this.project) return;
    let text: string | null = null;
    try {
      text = (await this.api.readFile(ACTIVITY_FILE)).text;
    } catch {
      // no log yet: nobody has used the server on this project
    }
    const next = parseActivity(text);
    if (next.length !== this.activity.length || next[0]?.t !== this.activity[0]?.t) this.activity = next;
    if (this.panel === "activity" && this.panelOpen) this.markActivitySeen();
  }

  markActivitySeen() {
    this.activitySeen = this.activity[0]?.t ?? this.activitySeen;
  }

  async refreshFiles(): Promise<FileDiff | null> {
    const files = await this.#guard(() => this.api!.listFiles());
    if (!files) return null;
    const first = this.#stamps.size === 0;
    const diff = diffFiles(this.#stamps, files);
    this.#stamps = stampsOf(files);
    // (the same listing again changes nothing, so the tree and everything built on the file list stay as they are)
    if (first || diff.all.length) {
      this.files = files;
      void this.#readSpriteImages();
    }
    this.#announce(diff.all);
    return diff;
  }

  #announce(paths: string[]) {
    if (paths.length) this.fileChanges = { n: this.fileChanges.n + 1, paths };
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
      // a document is open in one window at a time: if another window has it, that one comes to the front instead
      const other = await this.api!.claimDocument(path).catch(() => null);
      if (other) {
        await this.api!.focusDocument(path).catch(() => false);
        this.say("info", `${path} is open in another window. It has been brought to the front.`);
        return;
      }
      const content = await this.#guard(() => this.api!.readFile(path));
      if (!content) {
        void this.api!.releaseDocument(path);
        return;
      }
      const text = content.text ?? "";
      this.tabs.push({ path, text, saved: text, binary: content.binary, size: content.size });
    }
    this.active = path;
    this.workspace = workspaceOf(path);
    if (line) this.jump = { path, line, nonce: Date.now() };
  }

  closeTab(path: string) {
    const tab = this.tabs.find((t) => t.path === path);
    if (tab && isDirty(tab) && !confirm(`Close ${path} without saving?`)) return;
    editorStates.forget(path);
    this.#recovery?.remove(path);
    void this.api?.releaseDocument(path);
    this.saveHooks.delete(path);
    this.sessions.delete(path);
    // (the next tab to show is the neighbour in the same workspace)
    const siblings = inWorkspace(this.tabs, workspaceOf(path));
    const index = siblings.findIndex((t) => t.path === path);
    this.tabs = this.tabs.filter((t) => t.path !== path);
    if (this.active === path) {
      const same = siblings.filter((t) => t.path !== path);
      this.active = same[Math.min(index, same.length - 1)]?.path ?? null;
    }
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
    this.#writing++;
    const ok = await this.#guard(async () => {
      await this.saveHooks.get(tab.path)?.();
      if (!tab.binary) await this.api!.writeFile(tab.path, text);
      return true;
    });
    // what the save wrote (the text, a sprite's picture, a model's .glb) is the new baseline, and news for other views
    // (a scene showing the sprite); it is not a change to reload the saving editor for
    if (ok) {
      this.#recovery?.remove(tab.path);
      await this.refreshFiles();
    }
    this.#writing--;
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
    if (!RESOURCE_NAME.test(clean)) return this.say("error", "Scene names use letters, numbers, - and _ (and / to put it in a folder, as in levels/castle-1).");
    await this.#guard(async () => {
      const lua = `scenes/${clean}.lua`;
      const json = `scenes/${clean}.scene.json`;
      if (this.files.some((f) => f.path === lua || f.path === json)) throw `'${clean}' already exists in scenes/`;
      const id = leaf(clean).split(/[-_]+/).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("") || "Scene";
      await this.api!.createFile(lua, `-- A scene. Everything in ${clean}.scene.json is built before enter() runs.\nlocal ${/^[A-Za-z]/.test(id) ? id : `Scene${id}`} = nova.scene {}\n\nfunction ${/^[A-Za-z]/.test(id) ? id : `Scene${id}`}:enter()\nend\n\nreturn ${/^[A-Za-z]/.test(id) ? id : `Scene${id}`}\n`);
      await this.api!.createFile(json, '{\n  "version": 1,\n  "background": [40, 60, 90],\n  "objects": [],\n  "texts": []\n}\n');
      await this.refreshFiles();
      await this.openFile(json);
    });
  }

  /// A new entity: `entities/<name>.lua`.
  async createEntity(name: string) {
    const clean = name.trim().replace(/\.lua$/i, "");
    if (!RESOURCE_NAME.test(clean)) return this.say("error", "Entity names use letters, numbers, - and _ (and / to put it in a folder, as in levels/castle-1).");
    await this.#guard(async () => {
      const lua = `entities/${clean}.lua`;
      if (this.files.some((f) => f.path === lua)) throw `'${clean}' already exists in entities/`;
      const id = leaf(clean).split(/[-_]+/).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
      const ident = /^[A-Za-z]/.test(id) ? id : `Entity${id}`;
      await this.api!.createFile(lua, `-- An entity: something in a scene that updates and draws itself.\nlocal ${ident} = nova.entity {}\n\nfunction ${ident}:update(dt)\nend\n\nreturn ${ident}\n`);
      await this.refreshFiles();
      await this.openFile(lua);
    });
  }

  /// A new blank sprite: `sprites/<name>.png` and `sprites/<name>.sprite.json`, opened in the sprite studio.
  async createSprite(name: string, side: number) {
    const clean = name.trim().replace(/\.sprite\.json$|\.png$/i, "");
    if (!RESOURCE_NAME.test(clean)) return this.say("error", "Sprite names use letters, numbers, - and _ (and / to put it in a folder, as in levels/castle-1).");
    await this.#guard(async () => {
      const json = `sprites/${clean}.sprite.json`;
      const png = `sprites/${clean}.png`;
      if (this.files.some((f) => f.path === json || f.path === png)) throw `'${clean}' already exists in sprites/`;
      await this.api!.writeImage(png, rasterToDataUrl(newRaster(side, side)));
      await this.api!.createFile(json, toSheetJson(newDoc(side, side), `${leaf(clean)}.png`)); // (the picture beside it: a path from the sheet's folder)
      await this.refreshFiles();
      await this.openFile(json);
    });
  }

  /// A new sound effect: settings in `sounds/<name>.sfx.json` and the rendered `sounds/<name>.wav`.
  async createSound(name: string) {
    const clean = name.trim().replace(/\.sfx\.json$|\.wav$/i, "");
    if (!RESOURCE_NAME.test(clean)) return this.say("error", "Sound names use letters, numbers, - and _ (and / to put it in a folder, as in levels/castle-1).");
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
    if (!RESOURCE_NAME.test(clean)) return this.say("error", "Model names use letters, numbers, - and _ (and / to put it in a folder, as in levels/castle-1).");
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

  /// Opens a Blender file: Blender (if installed) turns it into a .glb in the project, which becomes an editable model.
  async importBlend() {
    const picked = await this.#guard(() => this.api!.pickFile("Open a Blender file", ["blend"]));
    if (!picked) return;
    this.say("info", "Asking Blender to open the file… this can take a little while.");
    await this.#guard(async () => {
      const glb = await this.api!.importBlend(picked);
      await this.refreshFiles();
      await this.makeModelEditable(glb);
    });
  }

  /// Opens an OBJ file as a new model (each object a mesh shape; 1 OBJ unit is 16 model units, so a metre is one world unit).
  async importObj(file: File) {
    await this.#guard(async () => {
      const base = file.name.replace(/\.obj$/i, "").replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "model";
      let name = base;
      let k = 2;
      while (this.files.some((f) => f.path === `models/${name}.model.json` || f.path === `models/${name}.glb`)) name = `${base}_${k++}`;
      const { doc, warnings } = parseObj(await file.text(), name);
      const glb = `models/${name}.glb`;
      const json = `models/${name}.model.json`;
      await this.api!.writeModel(glb, `data:model/gltf-binary;base64,${toBase64(exportGlb(doc))}`);
      await this.api!.createFile(json, serializeModel(doc));
      await this.refreshFiles();
      this.say(warnings.length ? "error" : "info", `Opened ${file.name} as ${json}.${warnings.length ? " " + warnings.join(" ") : ""}`);
      await this.openFile(json);
    });
  }

  /// Turns a `.glb` made elsewhere into a model the studio can edit: reads its parts and animations into `<name>.model.json`, keeps the
  /// original beside it as `<name>-original.glb`, and writes the editable model's own `.glb` in its place.
  async makeModelEditable(glb: string) {
    if (!/\.glb$/i.test(glb)) return;
    await this.#guard(async () => {
      const stem = glb.slice(0, -4);
      const json = `${stem}.model.json`;
      if (this.files.some((f) => f.path === json)) throw `'${json}' already exists`;
      const url = await this.api!.readModel(glb);
      // (with the colours of the model's own picture: a kit's palette-textured model would otherwise come out white)
      const result = await importWithColours(fromBase64(url.slice(url.indexOf(",") + 1)));
      if (!result.ok) throw `${glb}: ${result.error}`;
      let original = `${stem}-original.glb`;
      for (let n = 2; this.files.some((f) => f.path === original); n++) original = `${stem}-original${n}.glb`;
      await this.api!.renameFile(glb, original);
      await this.api!.writeModel(glb, `data:model/gltf-binary;base64,${toBase64(exportGlb(result.doc))}`);
      await this.api!.createFile(json, serializeModel(result.doc));
      await this.refreshFiles();
      await this.openFile(json);
      const kept = original.slice(original.lastIndexOf("/") + 1);
      this.say("info", `Made ${json.slice(json.lastIndexOf("/") + 1)} editable. The original is kept as ${kept}.${result.notes.length ? ` Not carried over: ${result.notes.slice(0, 3).join("; ")}${result.notes.length > 3 ? "…" : ""}` : ""}`);
    });
  }

  /// A new track: `tracks/<name>.track.json`, a starting oval you reshape in the track editor (Generate makes its scene and road).
  async createTrack(name: string) {
    const clean = name.trim().replace(/\.track\.json$/i, "");
    if (!/^[A-Za-z0-9_-]+$/.test(clean)) return this.say("error", "Track names use letters, numbers, - and _.");
    await this.#guard(async () => {
      const json = trackOf(clean);
      if (this.files.some((f) => f.path === json)) throw `'${clean}' already exists in tracks/`;
      await this.api!.createFile(json, serializeTrack(newTrack()));
      await this.refreshFiles();
      await this.openFile(json);
    });
  }

  /// A new keyframe animation: `animations/<name>.anim.json`, one track to start from, edited in the timeline editor.
  async createAnimation(name: string) {
    const clean = name.trim().replace(/\.anim\.json$/i, "");
    if (!RESOURCE_NAME.test(clean)) return this.say("error", "Animation names use letters, numbers, - and _ (and / to put it in a folder, as in doors/open).");
    await this.#guard(async () => {
      const json = animOf(clean);
      if (this.files.some((f) => f.path === json)) throw `'${clean}' already exists in animations/`;
      await this.api!.createFile(json, serializeAnim(newAnim()));
      await this.refreshFiles();
      await this.openFile(json);
    });
  }

  /// A new song: `music/<name>.song.json` (what the editor edits) and the rendered `music/<name>.ogg` (small, and streamed by the game).
  async createSong(name: string, template = "blank") {
    const clean = name.trim().replace(/\.song\.json$|\.wav$/i, "");
    if (!RESOURCE_NAME.test(clean)) return this.say("error", "Song names use letters, numbers, - and _ (and / to put it in a folder, as in levels/castle-1).");
    await this.#guard(async () => {
      const json = `music/${clean}.song.json`;
      const ogg = `music/${clean}.ogg`;
      const wav = `music/${clean}.wav`;
      if (this.files.some((f) => f.path === json || f.path === ogg || f.path === wav)) throw `'${clean}' already exists in music/`;
      const song = templateById(template).make();
      await this.api!.writeOgg(ogg, `data:audio/wav;base64,${toBase64(encodeWav(renderSong(song)))}`);
      await this.api!.createFile(json, serializeSong(song));
      await this.refreshFiles();
      await this.openFile(json);
    });
  }

  /// Brings in a sound file from outside (WAV, Ogg or MP3: whatever the system can decode): a short one becomes a WAV in sounds/, a long one an Ogg in music/.
  async importAudio(file: File) {
    await this.#guard(async () => {
      let decoded: AudioBuffer;
      try {
        const ctx = new AudioContext();
        decoded = await ctx.decodeAudioData(await file.arrayBuffer());
        void ctx.close();
      } catch {
        throw `${file.name} could not be read as sound (WAV, Ogg and MP3 usually can).`;
      }
      const raw: Sound = { rate: decoded.sampleRate, channels: Array.from({ length: decoded.numberOfChannels }, (_, i) => Float32Array.from(decoded.getChannelData(i))) };
      const { sound, cut, mixedDown } = fitForProject(raw);
      const kind = kindFor(sound);
      const base = safeSoundName(file.name);
      const taken = (n: string) => this.files.some((f) => new RegExp(`^(sounds|music)/${n}\\.(wav|ogg|sfx\\.json|song\\.json)$`).test(f.path));
      const name = freeName(base, taken);
      const dataUrl = `data:audio/wav;base64,${toBase64(encodeWav(sound))}`;
      const target = kind === "music" ? `music/${name}.ogg` : `sounds/${name}.wav`;
      if (kind === "music") await this.api!.writeOgg(target, dataUrl);
      else await this.api!.writeAudio(target, dataUrl);
      await this.refreshFiles();
      this.say("info", `Imported ${file.name} as ${target}${cut ? " (cut to the first 10 minutes)" : ""}${mixedDown ? " (only the first two channels kept)" : ""}.`);
      await this.openFile(target);
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
        void this.api?.releaseDocument(path);
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
  ///
  /// Pictures, sounds and models count too: an open sprite, sound, song or model whose files changed (its PNG, WAV, OGG, GLB)
  /// is reopened from disk when it has nothing unsaved, and flagged when it has. With `quick` (the studio asks every few
  /// seconds) only files whose size or time changed are read; on focus every open text file is compared.
  async checkExternal(quick = false) {
    if (!this.project || !this.api || this.#writing) return;
    const diff = await this.refreshFiles();
    if (!diff || (quick && !diff.all.length)) return;
    const changed = new Set(diff.changed);
    // the files of each open tab's resource (a sprite's JSON and PNG), so a picture changed outside reopens its sprite
    const related = new Map<string, string[]>();
    for (const group of groupResources(this.files, this.spriteImages)) for (const r of group.items) for (const f of r.files) related.set(f, r.files);
    let reloaded = false;
    for (const tab of [...this.tabs]) {
      const files = related.get(tab.path) ?? [tab.path];
      const touched = files.some((f) => changed.has(f));
      if (tab.binary || ASSET_FILE.test(tab.path)) {
        if (!touched) continue;
        if (isDirty(tab)) tab.conflict = true;
        else {
          const disk = await this.api.readFile(tab.path).catch(() => null);
          if (disk) tab.size = disk.size;
          this.#adoptDisk(tab, disk?.text ?? tab.text);
          reloaded = true;
        }
        continue;
      }
      if (quick && !touched) continue;
      const disk = await this.api.readFile(tab.path).catch(() => null);
      if (!disk || disk.text == null) continue;
      const textChanged = disk.text !== tab.saved;
      const assetChanged = files.some((f) => f !== tab.path && changed.has(f));
      if (!textChanged && !assetChanged) continue;
      if (isDirty(tab)) tab.conflict = true;
      else {
        this.#adoptDisk(tab, disk.text);
        reloaded = true;
      }
    }
    if (reloaded) this.#remount();
    // Re-check the project only when something actually changed under us.
    if (reloaded || diff.all.length) void this.check();
  }

  async useDiskVersion(path: string) {
    const tab = this.tabs.find((t) => t.path === path);
    if (tab?.binary) {
      this.#adoptDisk(tab, tab.text);
      this.#remount();
      return;
    }
    const disk = tab && (await this.#guard(() => this.api!.readFile(path)));
    if (!tab || !disk || disk.text == null) return;
    this.#adoptDisk(tab, disk.text);
    this.#remount();
  }

  /// Keeps the tab's text; the next save will replace what is on disk.
  async keepMine(path: string) {
    const tab = this.tabs.find((t) => t.path === path);
    if (tab?.binary) {
      tab.conflict = false;
      return;
    }
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

  /// Saves everything, then checks the game and writes it out for `desktop` or `android` (under the project's `exports` folder).
  async exportGame(target: "desktop" | "android") {
    if (this.exporting || !(await this.saveAll())) return;
    this.exporting = true;
    this.exportReport = null;
    try {
      this.exportReport = await this.api!.exportGame(target);
      if (this.exportReport.ok) void this.refreshFiles();
    } catch (e) {
      this.exportReport = { ok: false, text: String(e), folder: "" };
    } finally {
      this.exporting = false;
    }
  }

  /// Runs the game in its own window; with `record` (a project path) what is pressed is written there when the window is closed.
  async play(record?: string) {
    if (!(await this.saveAll())) return;
    this.log = [];
    this.#perf = new PerfTracker();
    this.perf = { latest: null, history: [], hitches: [], worst: 0 };
    this.panel = "play";
    this.panelOpen = true;
    await this.#guard(async () => {
      await this.api!.runProject(record);
      this.running = true;
    });
  }
  async stop() {
    await this.#guard(async () => {
      await this.api!.stopProject();
      this.running = false;
      this.playingOn = null;
      this.deviceStep = null;
    });
  }

  /// Looks for Android devices (the menu beside Play calls this each time it opens).
  async findDevices() {
    this.lookingForDevices = true;
    try {
      this.devices = await this.api!.listDevices();
      this.devicesProblem = this.devices.length ? null : NO_DEVICE;
    } catch (e) {
      this.devices = [];
      this.devicesProblem = message(e);
    } finally {
      this.lookingForDevices = false;
    }
  }

  /// The device Play on device goes to without asking: the last one used, if it is still there.
  get preferredDevice(): AndroidDevice | null {
    return preferredDevice(this.devices, lastDevice());
  }

  /// Play on the device used last (or the only one there): ⌘⇧↩.
  async playOnPreferredDevice() {
    if (this.running) return;
    await this.findDevices();
    const device = this.preferredDevice;
    if (device) return this.playOnDevice(device);
    const waiting = this.devices.find((d) => d.state !== "device");
    this.say("error", this.devicesProblem ?? (waiting ? `${waiting.name}: ${deviceHint(waiting)}` : NO_DEVICE));
  }

  /// Saves, builds the game for Android, installs it on `device` and starts it; its log comes into the Play panel.
  async playOnDevice(device: AndroidDevice) {
    if (this.running || !(await this.saveAll())) return;
    rememberDevice(device.serial);
    this.log = [];
    this.#perf = new PerfTracker();
    this.perf = { latest: null, history: [], hitches: [], worst: 0 };
    this.panel = "play";
    this.panelOpen = true;
    this.running = true;
    this.playingOn = device;
    this.deviceStep = "Getting ready";
    try {
      await this.api!.playOnDevice(device.serial);
      // (unless it already ended: then play-exit has said so)
      if (this.playingOn === device) {
        this.deviceStep = null;
        this.log.push({ stream: "stdout", line: `— running on ${device.name} —` });
      }
    } catch (e) {
      const why = message(e);
      this.running = false;
      this.playingOn = null;
      this.deviceStep = null;
      if (why === "Stopped.") return;
      this.log.push({ stream: "stderr", line: why });
      this.say("error", why);
      if (/errors, so it was not put/.test(why)) void this.check();
    }
  }
}

export const studio = new Studio();
