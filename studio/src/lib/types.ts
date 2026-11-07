// Shapes shared between the studio's front end and its backend (see studio/src-tauri/src).

import type { TrackDoc } from "./track-doc";

export interface RecentProject {
  path: string;
  name: string;
  opened: number;
}

export interface TemplateInfo {
  id: string;
  name: string;
  description: string;
}

export interface ExampleInfo {
  id: string;
  name: string;
  path: string;
}

export interface ProjectInfo {
  root: string;
  name: string;
  version: string | null;
}

export interface FileEntry {
  path: string;
  dir: boolean;
  size: number;
}

export interface FileContent {
  text: string | null;
  binary: boolean;
  size: number;
}

export interface Diagnostic {
  severity: "error" | "warning";
  file: string | null;
  line: number | null;
  place: string | null;
  message: string;
  detail: string;
  /// The Lua call stack at an error, innermost first (empty or missing for problems that are not from running code).
  stack?: StackFrame[];
}

export interface StackFrame {
  file: string | null;
  line: number | null;
  function: string;
  /// Rust functions and Nova's own framework: not the person's code.
  internal: boolean;
}

export interface CheckReport {
  ok: boolean;
  name: string | null;
  frames_run: number;
  diagnostics: Diagnostic[];
}

export interface LogLine {
  stream: "stdout" | "stderr";
  line: string;
}

/// One headless run of the game (see `runHeadless`). Keys are `source@frame` taps like `key:Enter@30`; 60 frames are a second.
export interface HeadlessOptions {
  frames?: number;
  size?: [number, number];
  press?: string[];
  hold?: string[];
  /// A recorded input script in the project, for example `sims/play.json`.
  input?: string;
  /// Return a picture of the last frame.
  capture?: boolean;
  hud?: boolean;
}

export interface HeadlessReport {
  ok: boolean;
  exit: number | null;
  /// Everything the game and the runtime printed, a line each.
  log: string[];
  /// With `capture`: the last frame as a PNG data: URL.
  image: string | null;
  timed_out: boolean;
}

/// Everything the front end needs from the outside world. The desktop app implements it with the
/// Rust backend; a browser preview implements it with an in-memory project.
export interface Api {
  readonly kind: "tauri" | "mock";
  recentProjects(): Promise<RecentProject[]>;
  forgetProject(path: string): Promise<void>;
  templates(): Promise<TemplateInfo[]>;
  examples(): Promise<ExampleInfo[]>;
  defaultProjectsDir(): Promise<string>;
  pickFolder(title: string): Promise<string | null>;
  openProject(path: string): Promise<ProjectInfo>;
  newProject(parent: string, name: string, template: string): Promise<ProjectInfo>;
  copyExample(example: string, parent: string, name: string): Promise<ProjectInfo>;
  closeProject(): Promise<void>;
  listFiles(): Promise<FileEntry[]>;
  readFile(path: string): Promise<FileContent>;
  /// A project PNG as a data: URL.
  readImage(path: string): Promise<string>;
  writeFile(path: string, text: string): Promise<void>;
  /// Lays out a track's scene and road from its control points and settings and writes `tracks/<name>.track.json`, `scenes/<name>.scene.json` and `models/road_<name>.glb`. Returns a one-line report.
  generateTrack(name: string, track: TrackDoc): Promise<string>;
  /// A project WAV as a data: URL.
  readAudio(path: string): Promise<string>;
  /// Saves a sound as Ogg Vorbis at an `.ogg` path; the sound is given as a WAV data: URL and encoded by the backend.
  writeOgg(path: string, wavDataUrl: string): Promise<void>;
  /// Replaces a project WAV with an Ogg of the same name (the WAV goes to the trash). Returns the new path.
  convertToOgg(path: string): Promise<string>;
  /// Saves a WAV given as a data: URL.
  writeAudio(path: string, dataUrl: string): Promise<void>;
  /// Saves a binary glTF given as a data: URL.
  writeModel(path: string, dataUrl: string): Promise<void>;
  /// A project `.glb` as a `data:model/gltf-binary;base64,` URL.
  readModel(path: string): Promise<string>;
  /// Saves a PNG given as a data: URL.
  writeImage(path: string, dataUrl: string): Promise<void>;
  createFile(path: string, contents?: string): Promise<void>;
  createDir(path: string): Promise<void>;
  renameFile(from: string, to: string): Promise<void>;
  deleteFile(path: string): Promise<string>;
  /// Starts the game in its own window. With `record` (a project path such as `sims/play.json`) what is pressed is written there when the window is closed.
  runProject(record?: string): Promise<void>;
  /// Runs the game with no window for some frames, and returns what it printed (and a picture of the last frame if asked).
  runHeadless(options: HeadlessOptions): Promise<HeadlessReport>;
  stopProject(): Promise<boolean>;
  isRunning(): Promise<boolean>;
  checkProject(): Promise<CheckReport>;
  /// Checks the game and writes it out for a computer or for Android under `<project>/exports`.
  exportGame(target: "desktop" | "android"): Promise<ExportReport>;
  onPlayLog(callback: (line: LogLine) => void): Promise<() => void>;
  onPlayExit(callback: (code: number | null) => void): Promise<() => void>;
}

export interface ExportReport {
  ok: boolean;
  /// What the exporter printed: problems found, the files written or why it stopped.
  text: string;
  folder: string;
}
