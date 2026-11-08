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
  /// When the file was last written (milliseconds since 1970; 0 for a folder or when unknown).
  modified?: number;
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
  /// The Android devices adb can see: the handheld over USB, emulators.
  listDevices(): Promise<AndroidDevice[]>;
  /// Builds the game for Android, installs it on the device and starts it (the log arrives through `onPlayLog`, the
  /// end through `onPlayExit`, steps through `onDeviceStep`; `stopProject` stops it). Resolves with the game's package
  /// once it runs, or rejects with what went wrong in plain words.
  playOnDevice(serial: string): Promise<string>;
  onDeviceStep(callback: (step: string) => void): Promise<() => void>;
  onPlayLog(callback: (line: LogLine) => void): Promise<() => void>;
  onPlayExit(callback: (code: number | null) => void): Promise<() => void>;
  /// Sends one request to the running game's debugger (see docs/debugger.md); answers come through `onDebugMessage`.
  debugSend(message: DebugRequest): Promise<void>;
  /// What the game's debugger says (replies and events), and `connected` / `disconnected` from the studio itself.
  onDebugMessage(callback: (message: DebugMessage) => void): Promise<() => void>;
}

/// A request to the game's debugger: `{ id, cmd, ...arguments }` (docs/debugger.md lists them).
export interface DebugRequest {
  id: number;
  cmd: string;
  [argument: string]: unknown;
}

/// A message from the game's debugger: a reply (`reply` is the request's id) or an event (`event` names it).
export interface DebugMessage {
  reply?: number;
  ok?: boolean;
  result?: unknown;
  error?: string;
  event?: string;
  [field: string]: unknown;
}

/// A device adb can see (see studio/src-tauri/src/device.rs).
export interface AndroidDevice {
  serial: string;
  /// `device` when it is ready; otherwise adb's word: `unauthorized`, `offline`, `no permissions`, ...
  state: string;
  /// The model in words (`Retroid Pocket 6`), or the serial.
  name: string;
  emulator: boolean;
}

export interface ExportReport {
  ok: boolean;
  /// What the exporter printed: problems found, the files written or why it stopped.
  text: string;
  folder: string;
}
