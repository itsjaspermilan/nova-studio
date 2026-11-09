//! Several windows, one open copy of each document. A document (a sprite, a model, a song, a Lua file) is open in one window at a time:
//! opening it again from another window focuses the one that has it. A document can be moved to a window of its own ("tear-off").
//! This keeps the registry (which window has which document) and makes the windows; the front end of each window asks before it opens a document.

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// Which window has each document open (project-relative path -> window label).
#[derive(Default)]
pub struct DocOwners(Mutex<HashMap<String, String>>);

impl DocOwners {
    /// Takes a document for a window. Returns the label of another window that already has it (and then changes nothing).
    pub fn claim(&self, path: &str, label: &str) -> Option<String> {
        let mut m = self.0.lock().expect("owners lock");
        match m.get(path) {
            Some(owner) if owner != label => Some(owner.clone()),
            _ => {
                m.insert(path.to_string(), label.to_string());
                None
            }
        }
    }

    /// Gives a document up (only if this window is the one that has it).
    pub fn release(&self, path: &str, label: &str) {
        let mut m = self.0.lock().expect("owners lock");
        if m.get(path).map(String::as_str) == Some(label) {
            m.remove(path);
        }
    }

    /// A window closed: everything it had is free.
    pub fn release_window(&self, label: &str) {
        self.0.lock().expect("owners lock").retain(|_, owner| owner != label);
    }

    pub fn owner(&self, path: &str) -> Option<String> {
        self.0.lock().expect("owners lock").get(path).cloned()
    }

    /// Everything is free (the project was closed).
    pub fn clear(&self) {
        self.0.lock().expect("owners lock").clear();
    }
}

/// The label of another window that has the document, or `None` when it is free (and now this window's).
#[tauri::command]
pub fn claim_document(window: WebviewWindow, owners: State<DocOwners>, path: String) -> Option<String> {
    owners.claim(&path, window.label())
}

#[tauri::command]
pub fn release_document(window: WebviewWindow, owners: State<DocOwners>, path: String) {
    owners.release(&path, window.label());
}

/// Brings the window that has a document to the front. Returns whether there was one.
#[tauri::command]
pub fn focus_document(app: AppHandle, owners: State<DocOwners>, path: String) -> bool {
    let Some(label) = owners.owner(&path) else { return false };
    let Some(win) = app.get_webview_window(&label) else { return false };
    let _ = win.unminimize();
    win.set_focus().is_ok()
}

static NEXT: AtomicUsize = AtomicUsize::new(1);

/// Moves a document to a new window of its own: this window gives it up, the new one starts with it open.
#[tauri::command]
pub fn tear_off_document(app: AppHandle, window: WebviewWindow, owners: State<DocOwners>, path: String) -> Result<(), String> {
    let label = format!("doc-{}", NEXT.fetch_add(1, Ordering::SeqCst));
    owners.release(&path, window.label());
    owners.claim(&path, &label);
    // (the page of the new window reads which document it is for from this variable)
    let script = format!("window.__NOVA_DOC__ = {};", serde_json::to_string(&path).map_err(|e| e.to_string())?);
    let title = path.rsplit('/').next().unwrap_or(&path).to_string();
    #[allow(unused_mut)]
    let mut builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
        .title(title)
        .inner_size(1100.0, 760.0)
        .min_inner_size(640.0, 420.0)
        .initialization_script(&script);
    // the same window chrome as the main window (the studio draws its own buttons on Windows; the Mac's lie over the top bar)
    #[cfg(target_os = "macos")]
    {
        builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
            .traffic_light_position(tauri::LogicalPosition::new(14.0, 22.0));
    }
    #[cfg(target_os = "windows")]
    {
        builder = builder.decorations(false);
    }
    if let Err(e) = builder.build() {
        owners.release(&path, &label);
        owners.claim(&path, window.label());
        return Err(format!("cannot open a window: {e}"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_document_has_one_window_at_a_time() {
        let o = DocOwners::default();
        assert_eq!(o.claim("a.lua", "main"), None);
        assert_eq!(o.claim("a.lua", "main"), None, "claiming again from the same window is fine");
        assert_eq!(o.claim("a.lua", "doc-1"), Some("main".to_string()));
        assert_eq!(o.owner("a.lua").as_deref(), Some("main"));
    }

    #[test]
    fn only_the_owner_can_release_and_a_closed_window_frees_everything() {
        let o = DocOwners::default();
        o.claim("a.lua", "main");
        o.claim("b.lua", "doc-1");
        o.release("a.lua", "doc-1");
        assert_eq!(o.owner("a.lua").as_deref(), Some("main"));
        o.release("a.lua", "main");
        assert_eq!(o.owner("a.lua"), None);
        o.release_window("doc-1");
        assert_eq!(o.owner("b.lua"), None);
    }

    #[test]
    fn closing_the_project_frees_all() {
        let o = DocOwners::default();
        o.claim("a.lua", "main");
        o.clear();
        assert_eq!(o.claim("a.lua", "doc-2"), None);
    }
}
