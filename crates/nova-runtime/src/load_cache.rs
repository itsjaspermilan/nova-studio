//! Decoded project files shared by every load of the same files in one process: what `Game::load` decodes from a project
//! (its pictures, the sprite atlas packed from them, its glTF models, its sounds) and the built-in fonts. Off unless
//! [`share`] turns it on, which the test harness does (`nova_runtime::testing`): a test file loads the same game dozens of
//! times, often on several threads at once, and each load decoded every file again. A game run by `nova run`, the studio or
//! the device never turns it on, so it loads as before.
//!
//! What is shared is only ever read: each load gets its own copies (or `Arc`s of pictures nothing writes to), so two games
//! made from the cache cannot affect each other (`tests/load_cache.rs` checks it). A file is known by its full path on disk,
//! its length and its modification time ([`crate::vfs::Vfs::file_key`]), so a file changed on disk is decoded again; files
//! that are not on a disk (an archive, files in memory) are never shared. Two loads that want the same file at the same time
//! decode it once: the second waits for the first.

use std::collections::HashMap;
use std::hash::Hash;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::SystemTime;

use crate::assets::AtlasLayout;
use crate::mixer::Sample;
use crate::model::{Image, MeshData, ModelParts};
use crate::vfs::Vfs;

static ON: AtomicBool = AtomicBool::new(false);

/// Shares decoded files between the loads of this process from now on (true), or stops (false: what was kept is dropped).
pub fn share(on: bool) {
    ON.store(on, Ordering::Relaxed);
    if !on {
        let c = cache();
        c.images.clear();
        c.atlases.clear();
        c.models.clear();
        c.sounds.clear();
    }
}

/// Whether decoded files are shared.
pub fn is_on() -> bool {
    ON.load(Ordering::Relaxed)
}

static MADE: AtomicUsize = AtomicUsize::new(0);
static REUSED: AtomicUsize = AtomicUsize::new(0);

/// How many things (pictures, atlases, models, sounds) were decoded for sharing so far, and how many times one was reused.
pub fn counts() -> (usize, usize) {
    (MADE.load(Ordering::Relaxed), REUSED.load(Ordering::Relaxed))
}

/// A file on disk as it is now: its full path, length and modification time.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct FileKey {
    pub path: PathBuf,
    pub len: u64,
    pub modified: SystemTime,
}

/// The key of a project file when sharing is on and the file is on a disk.
pub(crate) fn key(vfs: &dyn Vfs, path: &str) -> Option<FileKey> {
    if !is_on() {
        return None;
    }
    vfs.file_key(path)
}

type Made<V> = Result<V, String>;

/// One kind of decoded thing, by key. Each entry is made once (an error too: the same file gives the same error); a load
/// that wants it while another makes it waits for that one.
struct Shelf<K, V> {
    map: Mutex<HashMap<K, Arc<OnceLock<Made<V>>>>>,
}

impl<K: Eq + Hash, V: Clone> Shelf<K, V> {
    fn new() -> Self {
        Shelf {
            map: Mutex::new(HashMap::new()),
        }
    }

    fn get_or_make(&self, key: K, make: impl FnOnce() -> Made<V>) -> Made<V> {
        let cell = {
            let mut map = self.map.lock().unwrap_or_else(|e| e.into_inner());
            map.entry(key).or_default().clone()
        };
        if let Some(v) = cell.get() {
            REUSED.fetch_add(1, Ordering::Relaxed);
            return v.clone();
        }
        // (the map's lock is not held while making: other files are made meanwhile)
        cell.get_or_init(|| {
            MADE.fetch_add(1, Ordering::Relaxed);
            make()
        })
        .clone()
    }

    fn clear(&self) {
        self.map.lock().unwrap_or_else(|e| e.into_inner()).clear();
    }
}

/// A model as `Game::load` reads it: the whole mesh, its parts (or why they could not be read), and the pictures it named by
/// `uri`, each with the file it was found in then (None: not found).
#[derive(Clone)]
pub(crate) struct Model {
    pub mesh: Arc<MeshData>,
    pub parts: Arc<Result<ModelParts, String>>,
    pub pictures: Vec<(String, Option<FileKey>)>,
}

/// The pictures an atlas is packed from, in order, its largest size and whether it is smooth.
type AtlasKey = (Vec<(String, FileKey)>, u32, bool);

struct Cache {
    images: Shelf<FileKey, Arc<Image>>,
    /// the atlas and where each picture is in it
    atlases: Shelf<AtlasKey, Arc<(Image, AtlasLayout)>>,
    models: Shelf<FileKey, Model>,
    sounds: Shelf<FileKey, Arc<Sample>>,
}

fn cache() -> &'static Cache {
    static CACHE: OnceLock<Cache> = OnceLock::new();
    CACHE.get_or_init(|| Cache {
        images: Shelf::new(),
        atlases: Shelf::new(),
        models: Shelf::new(),
        sounds: Shelf::new(),
    })
}

/// A picture of the project, decoded (once, when shared).
pub(crate) fn image(vfs: &dyn Vfs, path: &str) -> Made<Arc<Image>> {
    let decode = || -> Made<Arc<Image>> {
        let bytes = vfs.read(path)?;
        crate::assets::decode_png(&bytes)
            .map(Arc::new)
            .map_err(|e| format!("{path}: {e}"))
    };
    match key(vfs, path) {
        Some(k) => cache().images.get_or_make(k, decode),
        None => decode(),
    }
}

/// The sprite atlas packed from these pictures (`files` names their files when they are shared; None packs them anew).
pub(crate) fn atlas(
    files: Option<Vec<(String, FileKey)>>,
    max: u32,
    smooth: bool,
    pack: impl FnOnce() -> Made<(Image, AtlasLayout)>,
) -> Made<(Image, AtlasLayout)> {
    match files {
        Some(f) => cache()
            .atlases
            .get_or_make((f, max, smooth), || pack().map(Arc::new))
            .map(|a| (*a).clone()),
        None => pack(),
    }
}

/// A sound of the project, decoded (once, when shared).
pub(crate) fn sound(vfs: &dyn Vfs, path: &str) -> Made<Arc<Sample>> {
    let decode = || -> Made<Arc<Sample>> {
        let bytes = vfs.read(path)?;
        crate::assets::decode_sound(path, &bytes)
            .map(Arc::new)
            .map_err(|e| format!("{path}: {e}"))
    };
    match key(vfs, path) {
        Some(k) => cache().sounds.get_or_make(k, decode),
        None => decode(),
    }
}

/// A model of the project, read by `read` (once, when shared). `now` says which file a picture's path is now: a model read
/// before is read again (and not kept) when a picture it named has changed since.
pub(crate) fn model(
    vfs: &dyn Vfs,
    path: &str,
    now: &dyn Fn(&str) -> Option<FileKey>,
    read: &dyn Fn() -> Made<Model>,
) -> Made<Model> {
    let Some(k) = key(vfs, path) else {
        return read();
    };
    let kept = cache().models.get_or_make(k, read)?;
    if kept.pictures.iter().all(|(uri, file)| now(uri) == *file) {
        Ok(kept)
    } else {
        read()
    }
}

/// The built-in fonts: parsed by `parse`, once per process when shared.
pub(crate) fn builtin_fonts(
    parse: impl FnOnce() -> Made<Vec<fontdue::Font>>,
) -> Made<Vec<fontdue::Font>> {
    if !is_on() {
        return parse();
    }
    static FONTS: OnceLock<Made<Vec<fontdue::Font>>> = OnceLock::new();
    FONTS.get_or_init(parse).clone()
}
