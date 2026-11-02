import type { Api, CheckReport, ExampleInfo, FileContent, FileEntry, LogLine, ProjectInfo, RecentProject, TemplateInfo } from "./types";

/// The desktop app: every call goes to the Rust backend (studio/src-tauri).
async function tauriApi(): Promise<Api> {
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  const { open } = await import("@tauri-apps/plugin-dialog");
  return {
    kind: "tauri",
    recentProjects: () => invoke<RecentProject[]>("recent_projects"),
    forgetProject: (path) => invoke("forget_project", { path }),
    templates: () => invoke<TemplateInfo[]>("templates"),
    examples: () => invoke<ExampleInfo[]>("examples"),
    defaultProjectsDir: () => invoke<string>("default_projects_dir"),
    pickFolder: async (title) => {
      const picked = await open({ directory: true, multiple: false, title });
      return typeof picked === "string" ? picked : null;
    },
    openProject: (path) => invoke<ProjectInfo>("open_project", { path }),
    newProject: (parent, name, template) => invoke<ProjectInfo>("new_project", { parent, name, template }),
    copyExample: (example, parent, name) => invoke<ProjectInfo>("copy_example", { example, parent, name }),
    closeProject: () => invoke("close_project"),
    listFiles: () => invoke<FileEntry[]>("list_files"),
    readFile: (path) => invoke<FileContent>("read_file", { path }),
    writeFile: (path, text) => invoke("write_file", { path, text }),
    createFile: (path, contents) => invoke("create_file", { path, contents: contents ?? null }),
    createDir: (path) => invoke("create_dir", { path }),
    renameFile: (from, to) => invoke("rename_file", { from, to }),
    deleteFile: (path) => invoke<string>("delete_file", { path }),
    runProject: () => invoke("run_project"),
    stopProject: () => invoke<boolean>("stop_project"),
    isRunning: () => invoke<boolean>("is_running"),
    checkProject: () => invoke<CheckReport>("check_project"),
    onPlayLog: (callback) => listen<LogLine>("play-log", (e) => callback(e.payload)),
    onPlayExit: (callback) => listen<number | null>("play-exit", (e) => callback(e.payload)),
  };
}

let cached: Promise<Api> | undefined;

/// The desktop backend inside Tauri, an in-memory project in a plain browser (for previews and tests).
export function getApi(): Promise<Api> {
  cached ??= "__TAURI_INTERNALS__" in window ? tauriApi() : import("./mock").then((m) => m.createMockApi());
  return cached;
}
