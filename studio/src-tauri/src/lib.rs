//! Nova Studio's backend: the commands the front end calls. Each one is a thin wrapper over a tested
//! module (`project_files`, `templates`, `recent`, `runner`); every file operation goes through the
//! project root held in the app state and is confined to it (`paths`).

pub mod audio_files;
mod blend;
mod debug_link;
mod device;
mod headless;
mod menu;
mod paths;
mod project_files;
mod recent;
mod runner;
mod save_data;
mod snapshots;
mod templates;
mod windows;

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

struct AppState {
    root: Mutex<Option<PathBuf>>,
    runner: runner::Runner,
    device: device::DeviceRunner,
    recent: recent::RecentStore,
    debug: debug_link::DebugLink,
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

/// The project that is open (every window shares it), so a window opened later can join it.
#[tauri::command]
fn current_project(state: State<AppState>) -> Option<ProjectInfo> {
    let root = state.root.lock().expect("state lock").clone()?;
    read_info(&root).ok()
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
fn close_project(state: State<AppState>, owners: State<windows::DocOwners>) {
    owners.clear();
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
fn write_export(state: State<AppState>, path: String, data_url: String) -> Result<(), String> {
    project_files::write_export(&root_of(&state)?, &path, &data_url)
}

#[tauri::command]
fn read_save(state: State<AppState>) -> Result<save_data::SaveInfo, String> {
    save_data::read(&root_of(&state)?)
}

#[tauri::command]
fn write_save(state: State<AppState>, text: String) -> Result<(), String> {
    save_data::write(&root_of(&state)?, &text)
}

#[tauri::command]
fn reset_save(state: State<AppState>) -> Result<bool, String> {
    save_data::reset(&root_of(&state)?)
}

#[tauri::command]
fn snapshot_create(state: State<AppState>, name: String) -> Result<snapshots::Snapshot, String> {
    snapshots::create(&root_of(&state)?, &name)
}

#[tauri::command]
fn snapshot_list(state: State<AppState>) -> Result<Vec<snapshots::Snapshot>, String> {
    snapshots::list(&root_of(&state)?)
}

#[tauri::command]
fn snapshot_restore(state: State<AppState>, id: String) -> Result<snapshots::Snapshot, String> {
    snapshots::restore(&root_of(&state)?, &id)
}

#[tauri::command]
fn snapshot_delete(state: State<AppState>, id: String) -> Result<(), String> {
    snapshots::delete(&root_of(&state)?, &id)
}

/// Opens a Blender file: Blender (if installed) writes it as models/<name>-blend.glb in the project, whose path is returned.
#[tauri::command]
async fn import_blend(state: State<'_, AppState>, blend_path: String) -> Result<String, String> {
    let root = root_of(&state)?;
    let blend = PathBuf::from(&blend_path);
    let stem: String = blend
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "model".into())
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let rel = format!("models/{stem}-blend.glb");
    let out = paths::confine(&root, &rel)?;
    tauri::async_runtime::spawn_blocking(move || {
        blend::convert(&blend, &out, std::time::Duration::from_secs(180))
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(rel)
}

/// Whether a Blender is installed here, for the "Open a Blender file" button to say what it needs.
#[tauri::command]
fn blender_available() -> bool {
    blend::find_blender().is_some()
}

#[tauri::command]
fn write_audio(state: State<AppState>, path: String, data_url: String) -> Result<(), String> {
    project_files::write_audio(&root_of(&state)?, &path, &data_url)
}

#[tauri::command]
fn read_model(state: State<AppState>, path: String) -> Result<String, String> {
    project_files::read_model(&root_of(&state)?, &path)
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
fn run_project(
    app: AppHandle,
    state: State<AppState>,
    record: Option<String>,
) -> Result<(), String> {
    let root = root_of(&state)?;
    let bin = runner::find_nova_binary()?;
    let mut command = std::process::Command::new(bin);
    command.arg("run").arg(&root);
    // the debugger: the game listens on a free port, says which, and waits a moment for the studio before its scripts run
    command.arg("--debug").arg("0").arg("--debug-wait");
    // `--record` writes what was pressed when the game's window is closed, for the simulation screen to play back
    if let Some(rel) = record {
        let path = paths::confine(&root, &rel)?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("cannot make the folder: {e}"))?;
        }
        command.arg("--record").arg(path);
    }
    let (lines, exits) = (app.clone(), app.clone());
    let link = state.debug.clone();
    link.close();
    let closer = link.clone();
    state.runner.start(
        command,
        move |line| {
            if let Some(port) = debug_link::port_in(&line.line) {
                let to_front = lines.clone();
                if let Err(e) = link.connect(port, move |m| {
                    let _ = to_front.emit("debug-message", m);
                }) {
                    let _ = lines.emit(
                        "play-log",
                        runner::LogLine {
                            stream: "stderr",
                            line: e,
                        },
                    );
                }
                return; // (the line is for the studio, not the person)
            }
            let _ = lines.emit("play-log", line);
        },
        move |code| {
            closer.close();
            let _ = exits.emit("play-exit", code);
        },
    )
}

/// Sends one request to the running game's debugger (`docs/debugger.md`).
#[tauri::command]
fn debug_send(state: State<AppState>, message: serde_json::Value) -> Result<(), String> {
    state.debug.send(&message)
}

#[tauri::command]
fn stop_project(state: State<AppState>) -> bool {
    // (`|` so both are stopped)
    state.runner.stop() | state.device.stop()
}

#[tauri::command]
fn is_running(state: State<AppState>) -> bool {
    state.runner.is_running() || state.device.is_running()
}

/// The Android devices adb can see (the handheld over USB, emulators).
#[tauri::command]
async fn list_devices() -> Result<Vec<device::Device>, String> {
    tauri::async_runtime::spawn_blocking(device::list_devices)
        .await
        .map_err(|e| format!("could not look for devices: {e}"))?
}

/// Builds the game for Android, installs it on the device `serial` and starts it. Steps arrive as `device-step`
/// events, the build's and then the game's log as `play-log`, and the end as `play-exit`. Returns the package.
#[tauri::command]
async fn play_on_device(
    app: AppHandle,
    state: State<'_, AppState>,
    serial: String,
) -> Result<String, String> {
    let root = root_of(&state)?;
    if state.runner.is_running() {
        return Err("the game is already running on this computer; stop it first".into());
    }
    let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let repo = repo
        .join("crates/nova-runtime/Cargo.toml")
        .is_file()
        .then(|| repo.canonicalize().unwrap_or(repo));
    let out = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("no cache folder: {e}"))?
        .join("device");
    let with = device::BuildWith {
        nova: runner::find_nova_binary()?,
        repo,
        out,
    };
    let runner = state.device.clone();
    let emit: std::sync::Arc<dyn Fn(device::Event) + Send + Sync> =
        std::sync::Arc::new(move |event| {
            let _ = match event {
                device::Event::Log(line) => app.emit("play-log", line),
                device::Event::Step(step) => app.emit("device-step", step),
                device::Event::Exit(code) => app.emit("play-exit", code),
            };
        });
    tauri::async_runtime::spawn_blocking(move || runner.play(&root, &serial, &with, emit))
        .await
        .map_err(|e| format!("playing on the device stopped unexpectedly: {e}"))?
}

/// Runs the project headless and returns the checker's report (see `nova check --json`).
#[tauri::command]
fn check_project(state: State<AppState>) -> Result<serde_json::Value, String> {
    runner::check(&root_of(&state)?)
}

/// Runs the game headless once (a picture of a screen, or a scripted session) and returns what it printed.
#[tauri::command]
async fn run_headless(
    state: State<'_, AppState>,
    options: headless::HeadlessOptions,
) -> Result<headless::HeadlessReport, String> {
    let root = root_of(&state)?;
    tauri::async_runtime::spawn_blocking(move || headless::run(&root, &options))
        .await
        .map_err(|e| format!("the run stopped unexpectedly: {e}"))?
}

/// Checks the game and exports it (`desktop` or `android`); the report says what happened and where the files are.
#[tauri::command]
async fn export_game(
    state: State<'_, AppState>,
    target: String,
) -> Result<serde_json::Value, String> {
    let root = root_of(&state)?;
    let done = tauri::async_runtime::spawn_blocking(move || runner::export(&root, &target))
        .await
        .map_err(|e| format!("the export stopped unexpectedly: {e}"))??;
    Ok(
        serde_json::json!({ "ok": done.ok, "text": done.text, "folder": done.folder.to_string_lossy() }),
    )
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
        .on_window_event(|window, event| {
            // a window that closes gives up the documents it had
            if let tauri::WindowEvent::Destroyed = event {
                tauri::Manager::state::<windows::DocOwners>(window).release_window(window.label());
            }
        })
        .on_menu_event(|app, event| {
            // a click in the system menu bar: the page runs the command it names (src/lib/native-menu.ts)
            let _ = tauri::Emitter::emit(app, "menu-command", event.id().as_ref().to_string());
        })
        .setup(|app| {
            let config = app.path().app_config_dir().map_err(|e| e.to_string())?;
            app.manage(windows::DocOwners::default());
            app.manage(AppState {
                root: Mutex::new(None),
                runner: runner::Runner::default(),
                device: device::DeviceRunner::default(),
                debug: debug_link::DebugLink::default(),
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
            write_export,
            import_blend,
            blender_available,
            snapshot_create,
            snapshot_list,
            snapshot_restore,
            snapshot_delete,
            read_save,
            write_save,
            reset_save,
            write_ogg,
            convert_to_ogg,
            write_model,
            read_model,
            write_file,
            write_image,
            create_file,
            create_dir,
            rename_file,
            delete_file,
            run_project,
            stop_project,
            debug_send,
            is_running,
            list_devices,
            play_on_device,
            check_project,
            export_game,
            run_headless,
            menu::set_menu,
            current_project,
            windows::claim_document,
            windows::release_document,
            windows::focus_document,
            windows::tear_off_document,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Nova Studio");
}
