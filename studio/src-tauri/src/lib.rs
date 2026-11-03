//! Nova Studio's backend: the commands the front end calls. Each one is a thin wrapper over a tested
//! module (`project_files`, `templates`, `recent`, `runner`); every file operation goes through the
//! project root held in the app state and is confined to it (`paths`).

pub mod audio_files;
mod paths;
mod project_files;
mod recent;
mod runner;
mod templates;

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

struct AppState {
    root: Mutex<Option<PathBuf>>,
    runner: runner::Runner,
    recent: recent::RecentStore,
}

#[derive(Serialize)]
struct ProjectInfo {
    root: String,
    name: String,
    version: Option<String>,
}

#[derive(Serialize)]
struct ExampleInfo {
    id: String,
    name: String,
    path: String,
}

fn root_of(state: &State<AppState>) -> Result<PathBuf, String> {
    state
        .root
        .lock()
        .expect("state lock")
        .clone()
        .ok_or_else(|| "no project is open".to_string())
}

/// Reads `nova.json` and returns the project's identity, or why this folder is not a Nova project.
fn read_info(root: &Path) -> Result<ProjectInfo, String> {
    let text = std::fs::read_to_string(root.join("nova.json")).map_err(|_| {
        format!(
            "'{}' has no nova.json, so it is not a Nova project",
            root.display()
        )
    })?;
    let value: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("nova.json is not valid JSON: {e}"))?;
    let name = value["name"]
        .as_str()
        .filter(|n| !n.trim().is_empty())
        .ok_or("nova.json has no \"name\"")?
        .to_string();
    Ok(ProjectInfo {
        root: root.to_string_lossy().into_owned(),
        name,
        version: value["version"].as_str().map(str::to_string),
    })
}

fn open(state: &State<AppState>, root: &Path) -> Result<ProjectInfo, String> {
    let root = root
        .canonicalize()
        .map_err(|e| format!("cannot open '{}': {e}", root.display()))?;
    let info = read_info(&root)?;
    *state.root.lock().expect("state lock") = Some(root.clone());
    // A failure to remember the project must not stop it opening.
    if let Err(e) = state.recent.add(&root, &info.name) {
        eprintln!("studio: {e}");
    }
    Ok(info)
}

#[tauri::command]
fn recent_projects(state: State<AppState>) -> Vec<recent::RecentProject> {
    state.recent.list()
}

#[tauri::command]
fn forget_project(state: State<AppState>, path: String) -> Result<(), String> {
    state.recent.remove(&path)
}

#[tauri::command]
fn templates() -> Vec<templates::TemplateInfo> {
    templates::template_infos()
}

/// The example projects shipped with Nova: inside the app bundle, or next to the repository in development.
fn examples_in(app: &AppHandle) -> Vec<ExampleInfo> {
    let bundled = app
        .path()
        .resource_dir()
        .ok()
        .map(|d| d.join("examples"))
        .filter(|d| d.is_dir());
    let dir =
        bundled.unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples"));
    let mut out: Vec<ExampleInfo> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.path().join("nova.json").is_file())
        .filter_map(|e| {
            let info = read_info(&e.path()).ok()?;
            Some(ExampleInfo {
                id: e.file_name().to_string_lossy().into_owned(),
                name: info.name,
                path: e.path().to_string_lossy().into_owned(),
            })
        })
        .collect();
    out.sort_by(|a, b| a.id.cmp(&b.id));
    out
}

#[tauri::command]
fn examples(app: AppHandle) -> Vec<ExampleInfo> {
    examples_in(&app)
}

#[tauri::command]
fn open_project(state: State<AppState>, path: String) -> Result<ProjectInfo, String> {
    open(&state, Path::new(&path))
}

#[tauri::command]
fn new_project(
    state: State<AppState>,
    parent: String,
    name: String,
    template: String,
) -> Result<ProjectInfo, String> {
    let dest = templates::create_from_template(Path::new(&parent), &name, &template)?;
    open(&state, &dest)
}

/// Copies an example into `parent` under a new name and opens the copy.
#[tauri::command]
fn copy_example(
    app: AppHandle,
    state: State<AppState>,
    example: String,
    parent: String,
    name: String,
) -> Result<ProjectInfo, String> {
    let source = examples_in(&app)
        .into_iter()
        .find(|e| e.id == example)
        .ok_or_else(|| format!("unknown example '{example}'"))?;
    let dest = templates::copy_project(Path::new(&source.path), Path::new(&parent), &name)?;
    open(&state, &dest)
}

#[tauri::command]
fn close_project(state: State<AppState>) {
    state.runner.stop();
    *state.root.lock().expect("state lock") = None;
}

#[tauri::command]
fn list_files(state: State<AppState>) -> Result<Vec<project_files::FileEntry>, String> {
    project_files::list_files(&root_of(&state)?)
}

#[tauri::command]
fn read_file(state: State<AppState>, path: String) -> Result<project_files::FileContent, String> {
    project_files::read_file(&root_of(&state)?, &path)
}

#[tauri::command]
fn read_image(state: State<AppState>, path: String) -> Result<String, String> {
    project_files::read_image(&root_of(&state)?, &path)
}

#[tauri::command]
fn write_image(state: State<AppState>, path: String, data_url: String) -> Result<(), String> {
    project_files::write_image(&root_of(&state)?, &path, &data_url)
}

#[tauri::command]
fn read_audio(state: State<AppState>, path: String) -> Result<String, String> {
    project_files::read_audio(&root_of(&state)?, &path)
}

#[tauri::command]
fn write_ogg(state: State<AppState>, path: String, data_url: String) -> Result<(), String> {
    project_files::write_ogg(&root_of(&state)?, &path, &data_url)
}

#[tauri::command]
fn convert_to_ogg(state: State<AppState>, path: String) -> Result<String, String> {
    project_files::convert_wav_to_ogg(&root_of(&state)?, &path)
}

#[tauri::command]
fn write_audio(state: State<AppState>, path: String, data_url: String) -> Result<(), String> {
    project_files::write_audio(&root_of(&state)?, &path, &data_url)
}

#[tauri::command]
fn write_model(state: State<AppState>, path: String, data_url: String) -> Result<(), String> {
    project_files::write_model(&root_of(&state)?, &path, &data_url)
}

#[tauri::command]
fn write_file(state: State<AppState>, path: String, text: String) -> Result<(), String> {
    project_files::write_file(&root_of(&state)?, &path, &text)
}

#[tauri::command]
fn create_file(
    state: State<AppState>,
    path: String,
    contents: Option<String>,
) -> Result<(), String> {
    project_files::create_file(&root_of(&state)?, &path, contents.as_deref().unwrap_or(""))
}

#[tauri::command]
fn create_dir(state: State<AppState>, path: String) -> Result<(), String> {
    project_files::create_dir(&root_of(&state)?, &path)
}

#[tauri::command]
fn rename_file(state: State<AppState>, from: String, to: String) -> Result<(), String> {
    project_files::rename(&root_of(&state)?, &from, &to)
}

#[tauri::command]
fn delete_file(state: State<AppState>, path: String) -> Result<String, String> {
    project_files::delete(&root_of(&state)?, &path)
}

#[tauri::command]
fn run_project(app: AppHandle, state: State<AppState>) -> Result<(), String> {
    let root = root_of(&state)?;
    let bin = runner::find_nova_binary()?;
    let mut command = std::process::Command::new(bin);
    command.arg("run").arg(&root);
    let (lines, exits) = (app.clone(), app.clone());
    state.runner.start(
        command,
        move |line| {
            let _ = lines.emit("play-log", line);
        },
        move |code| {
            let _ = exits.emit("play-exit", code);
        },
    )
}

#[tauri::command]
fn stop_project(state: State<AppState>) -> bool {
    state.runner.stop()
}

#[tauri::command]
fn is_running(state: State<AppState>) -> bool {
    state.runner.is_running()
}

/// Runs the project headless and returns the checker's report (see `nova check --json`).
#[tauri::command]
fn check_project(state: State<AppState>) -> Result<serde_json::Value, String> {
    runner::check(&root_of(&state)?)
}

/// Checks the game and exports it (`desktop` or `android`); the report says what happened and where the files are.
#[tauri::command]
async fn export_game(state: State<'_, AppState>, target: String) -> Result<serde_json::Value, String> {
    let root = root_of(&state)?;
    let done = tauri::async_runtime::spawn_blocking(move || runner::export(&root, &target))
        .await
        .map_err(|e| format!("the export stopped unexpectedly: {e}"))??;
    Ok(serde_json::json!({ "ok": done.ok, "text": done.text, "folder": done.folder.to_string_lossy() }))
}

/// Where new projects go by default: `Documents/Nova Projects`, created if it is missing.
#[tauri::command]
fn default_projects_dir(app: AppHandle) -> Result<String, String> {
    let documents = app
        .path()
        .document_dir()
        .map_err(|e| format!("no Documents folder: {e}"))?;
    let dir = documents.join("Nova Projects");
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create '{}': {e}", dir.display()))?;
    Ok(dir.to_string_lossy().into_owned())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let config = app.path().app_config_dir().map_err(|e| e.to_string())?;
            app.manage(AppState {
                root: Mutex::new(None),
                runner: runner::Runner::default(),
                recent: recent::RecentStore::new(&config),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            recent_projects,
            forget_project,
            templates,
            examples,
            default_projects_dir,
            open_project,
            new_project,
            copy_example,
            close_project,
            list_files,
            read_file,
            read_image,
            read_audio,
            write_audio,
            write_ogg,
            convert_to_ogg,
            write_model,
            write_file,
            write_image,
            create_file,
            create_dir,
            rename_file,
            delete_file,
            run_project,
            stop_project,
            is_running,
            check_project,
            export_game,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Nova Studio");
}
