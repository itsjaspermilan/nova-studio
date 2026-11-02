//! Recently opened projects, kept in one small JSON file in the app's config folder.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

const MAX_RECENT: usize = 12;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct RecentProject {
    pub path: String,
    pub name: String,
    /// Seconds since the Unix epoch.
    pub opened: u64,
}

#[derive(Serialize, Deserialize, Default)]
struct File {
    projects: Vec<RecentProject>,
}

pub struct RecentStore {
    file: PathBuf,
}

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

impl RecentStore {
    pub fn new(config_dir: &Path) -> Self {
        Self { file: config_dir.join("recent-projects.json") }
    }

    fn load(&self) -> File {
        std::fs::read_to_string(&self.file)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default()
    }

    fn save(&self, data: &File) -> Result<(), String> {
        if let Some(parent) = self.file.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("cannot create the settings folder: {e}"))?;
        }
        let temp = self.file.with_extension("json.tmp");
        let text = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
        std::fs::write(&temp, text).map_err(|e| format!("cannot save recent projects: {e}"))?;
        std::fs::rename(&temp, &self.file).map_err(|e| format!("cannot save recent projects: {e}"))
    }

    /// Newest first, leaving out folders that no longer exist.
    pub fn list(&self) -> Vec<RecentProject> {
        let mut projects: Vec<RecentProject> = self.load().projects.into_iter().filter(|p| Path::new(&p.path).join("nova.json").is_file()).collect();
        projects.sort_by(|a, b| b.opened.cmp(&a.opened));
        projects
    }

    pub fn add(&self, path: &Path, name: &str) -> Result<(), String> {
        let path = path.to_string_lossy().into_owned();
        let mut data = self.load();
        data.projects.retain(|p| p.path != path);
        data.projects.push(RecentProject { path, name: name.to_string(), opened: now() });
        data.projects.sort_by(|a, b| b.opened.cmp(&a.opened));
        data.projects.truncate(MAX_RECENT);
        self.save(&data)
    }

    pub fn remove(&self, path: &str) -> Result<(), String> {
        let mut data = self.load();
        data.projects.retain(|p| p.path != path);
        self.save(&data)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("nova-recent-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn project(parent: &Path, name: &str) -> PathBuf {
        let dir = parent.join(name);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("nova.json"), "{}").unwrap();
        dir
    }

    #[test]
    fn adding_moves_a_project_to_the_front_without_duplicates() {
        let base = scratch("add");
        let store = RecentStore::new(&base.join("config"));
        let (a, b) = (project(&base, "a"), project(&base, "b"));
        store.add(&a, "A").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(1100));
        store.add(&b, "B").unwrap();
        assert_eq!(store.list().iter().map(|p| p.name.as_str()).collect::<Vec<_>>(), ["B", "A"]);
        std::thread::sleep(std::time::Duration::from_millis(1100));
        store.add(&a, "A again").unwrap();
        let names: Vec<_> = store.list().into_iter().map(|p| p.name).collect();
        assert_eq!(names, ["A again", "B"]);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn missing_folders_vanish_from_the_list_and_the_list_is_capped() {
        let base = scratch("cap");
        let store = RecentStore::new(&base.join("config"));
        for i in 0..15 {
            store.add(&project(&base, &format!("p{i}")), &format!("P{i}")).unwrap();
        }
        assert_eq!(store.list().len(), MAX_RECENT);
        std::fs::remove_dir_all(base.join("p14")).unwrap();
        assert!(store.list().iter().all(|p| p.name != "P14"));
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn a_missing_or_broken_file_means_an_empty_list_and_removal_works() {
        let base = scratch("broken");
        let store = RecentStore::new(&base.join("config"));
        assert!(store.list().is_empty());
        std::fs::create_dir_all(base.join("config")).unwrap();
        std::fs::write(base.join("config/recent-projects.json"), "{ nope").unwrap();
        assert!(store.list().is_empty());
        let a = project(&base, "a");
        store.add(&a, "A").unwrap();
        assert_eq!(store.list().len(), 1);
        store.remove(&a.to_string_lossy()).unwrap();
        assert!(store.list().is_empty());
        let _ = std::fs::remove_dir_all(&base);
    }
}
