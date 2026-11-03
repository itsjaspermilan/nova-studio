// Shapes shared between the studio's front end and its backend (see studio/src-tauri/src).

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
  /// Saves a PNG given as a data: URL.
  writeImage(path: string, dataUrl: string): Promise<void>;
  createFile(path: string, contents?: string): Promise<void>;
  createDir(path: string): Promise<void>;
  renameFile(from: string, to: string): Promise<void>;
  deleteFile(path: string): Promise<string>;
  runProject(): Promise<void>;
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
