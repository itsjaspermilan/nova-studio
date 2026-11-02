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
  createFile(path: string, contents?: string): Promise<void>;
  createDir(path: string): Promise<void>;
  renameFile(from: string, to: string): Promise<void>;
  deleteFile(path: string): Promise<string>;
  runProject(): Promise<void>;
  stopProject(): Promise<boolean>;
  isRunning(): Promise<boolean>;
  checkProject(): Promise<CheckReport>;
  onPlayLog(callback: (line: LogLine) => void): Promise<() => void>;
  onPlayExit(callback: (code: number | null) => void): Promise<() => void>;
}
