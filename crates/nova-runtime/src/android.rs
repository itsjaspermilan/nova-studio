//! `nova export android`: a debug-signed APK without Gradle.
//!
//! The steps are the ones `scripts/build-apk.sh` used to run (that script now calls this): the native library from
//! `cargo ndk`, the manifest and resources linked by `aapt2`, the library stored uncompressed, the packed game added
//! as `assets/project.npk`, then `zipalign` and `apksigner` with a debug key made on this computer.
//!
//! Repeat builds are quick: the native library is only rebuilt when the runtime's source is newer than it, and
//! everything but the game (manifest, resources, icon, library) is kept as a base APK that is reused while nothing in
//! it changed, so a change to the game's own files only repacks the game. Release signing stays the person's to do.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::SystemTime;

use crate::export::game_id;
use crate::pak;
use crate::project::Project;
use crate::vfs::DirVfs;

/// The one CPU the APK is built for (the Retroid Pocket 6 and current handhelds are 64-bit ARM).
pub const ABI: &str = "arm64-v8a";
const TRIPLE: &str = "aarch64-linux-android";
const MIN_SDK: &str = "26";
const TARGET_SDK: &str = "34";
/// The activity every Nova game starts in (no Java code: `android:hasCode="false"`).
pub const ACTIVITY: &str = "android.app.NativeActivity";

const MANIFEST: &str = include_str!("../android/AndroidManifest.xml");
const RESOURCES: [(&str, &str); 3] = [
    (
        "values/styles.xml",
        include_str!("../android/res/values/styles.xml"),
    ),
    (
        "values-v28/styles.xml",
        include_str!("../android/res/values-v28/styles.xml"),
    ),
    (
        "values-v30/styles.xml",
        include_str!("../android/res/values-v30/styles.xml"),
    ),
];
/// Launcher icon sizes: (density folder, pixels).
const ICON_SIZES: [(&str, u32); 5] = [
    ("mdpi", 48),
    ("hdpi", 72),
    ("xhdpi", 96),
    ("xxhdpi", 144),
    ("xxxhdpi", 192),
];

/// What to build.
pub struct AndroidBuild {
    /// The game's folder; `None` builds the built-in benchmark scene.
    pub project: Option<PathBuf>,
    /// Where the finished `<id>-debug.apk` goes.
    pub out: PathBuf,
    /// The Nova source tree: the native library is built there (`cargo ndk`) and its `build/android` holds the work
    /// files and the debug key. Without it a prebuilt library must be given in `library`.
    pub repo: Option<PathBuf>,
    /// A ready-made `libnova_runtime.so` to use instead of building one.
    pub library: Option<PathBuf>,
    /// An unoptimised native library (much slower game; quicker to build the first time).
    pub debug_build: bool,
    /// Rebuild the native library and the base APK even when nothing seems to have changed.
    pub rebuild: bool,
}

/// What a build made.
#[derive(Debug)]
pub struct Built {
    pub apk: PathBuf,
    pub package: String,
    pub label: String,
    pub version: String,
    /// Whether `cargo ndk` ran (false: the library was already up to date).
    pub library_rebuilt: bool,
    /// Whether the base APK was reused (only the game was repacked).
    pub base_reused: bool,
}

/// The game's Android names, from its `nova.json`.
#[derive(Debug, Clone, PartialEq)]
pub struct Identity {
    pub package: String,
    pub label: String,
    pub version: String,
    /// The APK's file name stem (`<id>-debug.apk`).
    pub id: String,
}

impl Identity {
    pub fn benchmark() -> Self {
        Self {
            package: "com.nova.spike".into(),
            label: "Nova Spike".into(),
            version: "0.1.0".into(),
            id: "nova-spike".into(),
        }
    }

    pub fn of(project: &Project) -> Self {
        let id = game_id(&project.manifest.name);
        Self {
            package: format!("com.nova.games.{id}"),
            label: project.manifest.name.clone(),
            version: project
                .manifest
                .version
                .clone()
                .unwrap_or_else(|| "0.0.0".into()),
            id,
        }
    }
}

/// The Android SDK programs the build runs.
#[derive(Debug, Clone)]
pub struct Tools {
    pub aapt2: PathBuf,
    pub zipalign: PathBuf,
    pub apksigner: PathBuf,
    pub android_jar: PathBuf,
    pub keytool: PathBuf,
    /// Put first on PATH for apksigner (a script that runs `java`).
    pub java_bin: Option<PathBuf>,
}

/// Where the Android SDK is: `ANDROID_HOME`, `ANDROID_SDK_ROOT`, or the place Android Studio puts it.
pub fn sdk_dir() -> Option<PathBuf> {
    for var in ["ANDROID_HOME", "ANDROID_SDK_ROOT"] {
        if let Some(dir) = std::env::var_os(var).map(PathBuf::from)
            && dir.is_dir()
        {
            return Some(dir);
        }
    }
    let home = PathBuf::from(std::env::var_os("HOME")?);
    [
        home.join("Library/Android/sdk"),
        home.join("Android/Sdk"),
        home.join("AppData/Local/Android/Sdk"),
    ]
    .into_iter()
    .find(|d| d.is_dir())
}

/// Sorts version-named folders (`34.0.0`, `36.1.0`, `android-36`) by their numbers and returns the newest.
fn newest(dir: &Path, prefix: &str) -> Option<PathBuf> {
    let mut found: Vec<(Vec<u32>, PathBuf)> = std::fs::read_dir(dir)
        .ok()?
        .filter_map(Result::ok)
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            let rest = name.strip_prefix(prefix)?;
            let numbers: Option<Vec<u32>> = rest.split('.').map(|p| p.parse().ok()).collect();
            Some((numbers?, e.path()))
        })
        .collect();
    found.sort();
    found.pop().map(|(_, p)| p)
}

fn on_path(name: &str) -> Option<PathBuf> {
    std::env::split_paths(&std::env::var_os("PATH")?)
        .map(|d| d.join(name))
        .find(|p| p.is_file())
}

impl Tools {
    pub fn find() -> Result<Self, String> {
        let sdk = sdk_dir().ok_or(
            "the Android SDK was not found: install it (Android Studio puts it in ~/Library/Android/sdk) \
             or set ANDROID_HOME to its folder",
        )?;
        let build_tools = newest(&sdk.join("build-tools"), "").ok_or_else(|| {
            format!(
                "the Android SDK at {} has no build-tools (install them with the SDK manager)",
                sdk.display()
            )
        })?;
        let platform = newest(&sdk.join("platforms"), "android-").ok_or_else(|| {
            format!(
                "the Android SDK at {} has no platform (install one, for example android-36)",
                sdk.display()
            )
        })?;
        let java_bin = std::env::var_os("JAVA_HOME")
            .map(|h| PathBuf::from(h).join("bin"))
            .filter(|b| b.join("keytool").is_file());
        let keytool = java_bin
            .as_ref()
            .map(|b| b.join("keytool"))
            .or_else(|| on_path("keytool"))
            .ok_or("Java's keytool was not found (set JAVA_HOME to a Java 17 or newer)")?;
        let tool = |name: &str| {
            let path = build_tools.join(name);
            if path.is_file() {
                Ok(path)
            } else {
                Err(format!("{name} is missing from {}", build_tools.display()))
            }
        };
        Ok(Self {
            aapt2: tool("aapt2")?,
            zipalign: tool("zipalign")?,
            apksigner: tool("apksigner")?,
            android_jar: platform.join("android.jar"),
            keytool,
            java_bin,
        })
    }
}

/// Runs a program to completion, its output going to ours; a failure names the step.
fn run(command: &mut Command, what: &str) -> Result<(), String> {
    let status = command
        .stdin(Stdio::null())
        .status()
        .map_err(|e| format!("{what}: cannot start {:?}: {e}", command.get_program()))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("{what} failed ({status})"))
    }
}

/// Replaces `&`, `<`, `>` and `"` for an XML attribute.
pub fn xml_escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// The manifest for a game: the template with its package, label and (when it has one) icon filled in.
pub fn manifest(identity: &Identity, icon: bool) -> String {
    MANIFEST
        .replace("@PACKAGE@", &identity.package)
        .replace("@LABEL@", &xml_escape(&identity.label))
        .replace(
            "@ICON@",
            if icon {
                "android:icon=\"@mipmap/ic_launcher\""
            } else {
                ""
            },
        )
}

/// Shrinks (or grows) a square RGBA picture to `size` by averaging the pixels each new pixel covers.
pub fn resize(image: &crate::model::Image, size: u32) -> Vec<u8> {
    let (w, h) = (image.width.max(1), image.height.max(1));
    let mut out = Vec::with_capacity((size * size * 4) as usize);
    for y in 0..size {
        let (y0, y1) = (y * h / size, ((y + 1) * h / size).max(y * h / size + 1));
        for x in 0..size {
            let (x0, x1) = (x * w / size, ((x + 1) * w / size).max(x * w / size + 1));
            let mut sum = [0u64; 4];
            for sy in y0..y1.min(h) {
                for sx in x0..x1.min(w) {
                    let i = ((sy * image.width + sx) * 4) as usize;
                    let a = image.rgba[i + 3] as u64;
                    // colour weighted by coverage, so transparent edges do not darken
                    for (total, &v) in sum.iter_mut().zip(&image.rgba[i..i + 3]) {
                        *total += v as u64 * a;
                    }
                    sum[3] += a;
                }
            }
            let n = ((x1.min(w) - x0) * (y1.min(h) - y0)).max(1) as u64;
            let a = sum[3];
            for &s in &sum[..3] {
                out.push(s.checked_div(a).unwrap_or(0) as u8);
            }
            out.push((a / n) as u8);
        }
    }
    out
}

fn encode_png(size: u32, rgba: &[u8]) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    let mut encoder = png::Encoder::new(&mut bytes, size, size);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    encoder
        .write_header()
        .and_then(|mut w| w.write_image_data(rgba))
        .map_err(|e| format!("cannot write the icon: {e}"))?;
    Ok(bytes)
}

/// The newest modification time of any file under `paths` (folders are walked).
pub fn newest_change(paths: &[PathBuf]) -> Option<SystemTime> {
    fn walk(path: &Path, best: &mut Option<SystemTime>) {
        let Ok(meta) = std::fs::metadata(path) else {
            return;
        };
        if meta.is_dir() {
            if let Ok(entries) = std::fs::read_dir(path) {
                for e in entries.flatten() {
                    walk(&e.path(), best);
                }
            }
        } else if let Ok(t) = meta.modified()
            && best.is_none_or(|b| t > b)
        {
            *best = Some(t);
        }
    }
    let mut best = None;
    for p in paths {
        walk(p, &mut best);
    }
    best
}

/// The runtime's sources: when any is newer than the built library, the library is rebuilt.
fn runtime_sources(repo: &Path) -> Vec<PathBuf> {
    let crate_dir = repo.join("crates/nova-runtime");
    vec![
        repo.join("Cargo.toml"),
        repo.join("Cargo.lock"),
        crate_dir.join("Cargo.toml"),
        crate_dir.join("build.rs"),
        crate_dir.join("src"),
        crate_dir.join("lua"),
        repo.join("audio/src"),
        repo.join("audio/include"),
    ]
}

/// Whether a library built at `built` is older than the newest source change.
pub fn library_is_stale(built: Option<SystemTime>, newest_source: Option<SystemTime>) -> bool {
    match (built, newest_source) {
        (None, _) => true,
        (Some(b), Some(s)) => s > b,
        (Some(_), None) => false,
    }
}

fn target_dir(repo: &Path) -> PathBuf {
    std::env::var_os("CARGO_TARGET_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| repo.join("target"))
}

/// Makes sure the native library exists and is up to date; returns its path and whether it was rebuilt.
fn native_library(
    build: &AndroidBuild,
    progress: &mut dyn FnMut(&str),
) -> Result<(PathBuf, bool), String> {
    if let Some(lib) = &build.library {
        return if lib.is_file() {
            Ok((lib.clone(), false))
        } else {
            Err(format!("the native library {} is missing", lib.display()))
        };
    }
    let repo = build.repo.as_ref().ok_or(
        "building for Android needs the Nova source tree (to build the engine) or a prebuilt library",
    )?;
    let profile = if build.debug_build {
        "debug"
    } else {
        "release"
    };
    let lib = target_dir(repo)
        .join(TRIPLE)
        .join(profile)
        .join("libnova_runtime.so");
    let built = std::fs::metadata(&lib).and_then(|m| m.modified()).ok();
    if !build.rebuild && !library_is_stale(built, newest_change(&runtime_sources(repo))) {
        progress("The engine for Android is up to date (only the game is repacked)");
        return Ok((lib, false));
    }
    progress(if built.is_none() {
        "Building the engine for Android (the first time takes several minutes)"
    } else {
        "Rebuilding the engine for Android (the runtime changed)"
    });
    let mut cargo = Command::new(std::env::var_os("CARGO").unwrap_or_else(|| "cargo".into()));
    cargo.current_dir(repo).args([
        "ndk",
        "-t",
        ABI,
        "--platform",
        MIN_SDK,
        "build",
        "-p",
        "nova-runtime",
        "--lib",
    ]);
    if !build.debug_build {
        cargo.arg("--release");
    }
    run(&mut cargo, "building the engine (cargo ndk)")?;
    if !lib.is_file() {
        return Err(format!("the engine build did not make {}", lib.display()));
    }
    Ok((lib, true))
}

fn hash_file(path: &Path, h: &mut DefaultHasher) {
    if let Ok(meta) = std::fs::metadata(path) {
        path.hash(h);
        meta.len().hash(h);
        meta.modified().ok().hash(h);
    }
}

fn write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    }
    std::fs::write(path, bytes).map_err(|e| format!("cannot write {}: {e}", path.display()))
}

fn fresh_dir(dir: &Path) -> Result<(), String> {
    let _ = std::fs::remove_dir_all(dir);
    std::fs::create_dir_all(dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))
}

/// Builds the APK. `progress` hears a plain sentence at the start of each step.
pub fn build_apk(build: &AndroidBuild, progress: &mut dyn FnMut(&str)) -> Result<Built, String> {
    // The game first: a project that does not open is not worth an engine build.
    let (identity, game, icon) = match &build.project {
        None => (Identity::benchmark(), None, None),
        Some(folder) => {
            progress("Packing the game");
            let vfs = DirVfs::new(folder)?;
            let project = Project::open(&vfs)?;
            let icon = std::fs::read(folder.join("icon.png")).ok();
            (Identity::of(&project), Some(pak::pack(&vfs)?), icon)
        }
    };
    let tools = Tools::find()?;
    if !tools.android_jar.is_file() {
        return Err(format!("{} is missing", tools.android_jar.display()));
    }
    let (lib, library_rebuilt) = native_library(build, progress)?;

    let root = match &build.repo {
        Some(repo) => repo.join("build/android"),
        None => build.out.join(".nova-android"),
    };
    let work = root.join("work").join(&identity.id);
    std::fs::create_dir_all(&work).map_err(|e| format!("cannot create {}: {e}", work.display()))?;

    // The base APK: everything but the game. Its key says what went into it.
    let manifest_text = manifest(&identity, icon.is_some());
    let notices = build
        .repo
        .as_ref()
        .and_then(|r| std::fs::read_to_string(r.join("licenses/rust-dependencies.txt")).ok())
        .unwrap_or_else(|| include_str!("../../../licenses/rust-dependencies.txt").to_string());
    let mut h = DefaultHasher::new();
    manifest_text.hash(&mut h);
    RESOURCES.hash(&mut h);
    icon.hash(&mut h);
    notices.hash(&mut h);
    identity.version.hash(&mut h);
    hash_file(&lib, &mut h);
    hash_file(&tools.aapt2, &mut h);
    hash_file(&tools.android_jar, &mut h);
    let key = format!("{:016x}", h.finish());
    let base = work.join("base.apk");
    let key_file = work.join("base.key");
    let base_reused = !build.rebuild
        && base.is_file()
        && std::fs::read_to_string(&key_file).is_ok_and(|k| k.trim() == key);
    if !base_reused {
        progress("Linking the Android parts (manifest, icon, engine)");
        let _ = std::fs::remove_file(&key_file);
        let res = work.join("res");
        fresh_dir(&res)?;
        for (path, text) in RESOURCES {
            write(&res.join(path), text.as_bytes())?;
        }
        if let Some(bytes) = &icon {
            let image = crate::assets::decode_png(bytes).map_err(|e| format!("icon.png: {e}"))?;
            for (density, size) in ICON_SIZES {
                let png = encode_png(size, &resize(&image, size))?;
                write(&res.join(format!("mipmap-{density}/ic_launcher.png")), &png)?;
            }
        }
        let assets = work.join("assets");
        fresh_dir(&assets)?;
        // The licences of the software the runtime is built from travel with every APK.
        write(&assets.join("THIRD-PARTY.txt"), notices.as_bytes())?;
        let manifest_path = work.join("AndroidManifest.xml");
        write(&manifest_path, manifest_text.as_bytes())?;
        let compiled = work.join("res.zip");
        run(
            Command::new(&tools.aapt2)
                .arg("compile")
                .arg("--dir")
                .arg(&res)
                .arg("-o")
                .arg(&compiled),
            "compiling the resources (aapt2)",
        )?;
        let _ = std::fs::remove_file(&base);
        run(
            Command::new(&tools.aapt2)
                .arg("link")
                .arg("-o")
                .arg(&base)
                .arg("--manifest")
                .arg(&manifest_path)
                .arg("-A")
                .arg(&assets)
                .arg(&compiled)
                .arg("-I")
                .arg(&tools.android_jar)
                .args(["--min-sdk-version", MIN_SDK])
                .args(["--target-sdk-version", TARGET_SDK])
                .args(["--version-code", "1"])
                .arg("--version-name")
                .arg(&identity.version),
            "linking the APK (aapt2)",
        )?;
        // Native libraries are stored uncompressed so zipalign -p can page-align them.
        let stage = work.join("lib-stage");
        fresh_dir(&stage)?;
        let staged = stage.join("lib").join(ABI).join("libnova_runtime.so");
        std::fs::create_dir_all(staged.parent().expect("has a parent"))
            .map_err(|e| e.to_string())?;
        std::fs::copy(&lib, &staged).map_err(|e| format!("cannot copy the engine: {e}"))?;
        run(
            Command::new("zip")
                .current_dir(&stage)
                .args(["-q", "-0", "-r"])
                .arg(&base)
                .arg("lib"),
            "adding the engine to the APK (zip)",
        )?;
        write(&key_file, key.as_bytes())?;
    }

    // The game itself: a copy of the base with the packed project added.
    let unsigned = work.join("game.apk");
    std::fs::copy(&base, &unsigned).map_err(|e| format!("cannot copy the base APK: {e}"))?;
    if let Some(bytes) = &game {
        let stage = work.join("game-stage");
        fresh_dir(&stage)?;
        write(&stage.join("assets/project.npk"), bytes)?;
        run(
            Command::new("zip")
                .current_dir(&stage)
                .args(["-q", "-r"])
                .arg(&unsigned)
                .arg("assets/project.npk"),
            "adding the game to the APK (zip)",
        )?;
    }
    progress("Signing the APK (debug key)");
    let aligned = work.join("aligned.apk");
    let _ = std::fs::remove_file(&aligned);
    run(
        Command::new(&tools.zipalign)
            .args(["-f", "-p", "4"])
            .arg(&unsigned)
            .arg(&aligned),
        "aligning the APK (zipalign)",
    )?;
    let keystore = root.join("debug.keystore");
    if !keystore.is_file() {
        run(
            Command::new(&tools.keytool)
                .args(["-genkeypair", "-keystore"])
                .arg(&keystore)
                .args(["-storepass", "android", "-keypass", "android"])
                .args(["-alias", "nova-debug", "-keyalg", "RSA", "-keysize", "2048"])
                .args([
                    "-validity",
                    "10000",
                    "-dname",
                    "CN=Nova Debug,O=Nova Studio,C=US",
                ])
                .stdout(Stdio::null()),
            "making the debug key (keytool)",
        )?;
    }
    std::fs::create_dir_all(&build.out)
        .map_err(|e| format!("cannot create {}: {e}", build.out.display()))?;
    let apk = build.out.join(format!("{}-debug.apk", identity.id));
    let mut sign = Command::new(&tools.apksigner);
    if let Some(bin) = &tools.java_bin {
        let mut path = vec![bin.clone()];
        path.extend(std::env::split_paths(
            &std::env::var_os("PATH").unwrap_or_default(),
        ));
        sign.env(
            "PATH",
            std::env::join_paths(path).map_err(|e| e.to_string())?,
        );
    }
    run(
        sign.arg("sign")
            .arg("--ks")
            .arg(&keystore)
            .args(["--ks-pass", "pass:android", "--key-pass", "pass:android"])
            .args(["--ks-key-alias", "nova-debug", "--out"])
            .arg(&apk)
            .arg(&aligned),
        "signing the APK (apksigner)",
    )?;
    let _ = std::fs::remove_file(apk.with_extension("apk.idsig"));
    Ok(Built {
        apk,
        package: identity.package,
        label: identity.label,
        version: identity.version,
        library_rebuilt,
        base_reused,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Image;

    #[test]
    fn the_manifest_names_the_game_and_escapes_its_label() {
        let id = Identity {
            package: "com.nova.games.tom_jerry".into(),
            label: "Tom & \"Jerry\" <3".into(),
            version: "1.0".into(),
            id: "tom_jerry".into(),
        };
        let text = manifest(&id, true);
        assert!(text.contains("package=\"com.nova.games.tom_jerry\""));
        assert!(text.contains("android:label=\"Tom &amp; &quot;Jerry&quot; &lt;3\""));
        assert!(text.contains("android:icon=\"@mipmap/ic_launcher\""));
        assert!(!manifest(&id, false).contains("android:icon"));
        assert!(
            !text.contains("@PACKAGE@") && !text.contains("@LABEL@") && !text.contains("@ICON@")
        );
    }

    #[test]
    fn a_library_is_rebuilt_only_when_the_source_is_newer() {
        let t = SystemTime::UNIX_EPOCH;
        let later = t + std::time::Duration::from_secs(10);
        assert!(library_is_stale(None, Some(t)), "never built");
        assert!(
            library_is_stale(Some(t), Some(later)),
            "source changed since"
        );
        assert!(!library_is_stale(Some(later), Some(t)), "up to date");
        assert!(
            !library_is_stale(Some(t), None),
            "no source tree to compare with"
        );
    }

    #[test]
    fn the_newest_version_folder_wins_by_number_not_by_letters() {
        let dir = std::env::temp_dir().join(format!("nova-android-newest-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        for name in ["9.0.0", "36.1.0", "34.0.0", "notes"] {
            std::fs::create_dir_all(dir.join(name)).unwrap();
        }
        assert_eq!(newest(&dir, "").unwrap(), dir.join("36.1.0"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_icon_is_averaged_down_and_keeps_its_transparency() {
        // 4x4: the left half opaque red, the right half clear.
        let mut rgba = Vec::new();
        for _ in 0..4 {
            for x in 0..4 {
                rgba.extend_from_slice(if x < 2 {
                    &[255, 0, 0, 255]
                } else {
                    &[0, 0, 0, 0]
                });
            }
        }
        let image = Image {
            width: 4,
            height: 4,
            rgba,
        };
        let small = resize(&image, 2);
        assert_eq!(&small[0..4], &[255, 0, 0, 255]);
        assert_eq!(&small[4..8], &[0, 0, 0, 0]);
        let one = resize(&image, 1);
        assert_eq!(
            one,
            [255, 0, 0, 127],
            "colour from the opaque half, half covered"
        );
        assert_eq!(resize(&image, 8).len(), 8 * 8 * 4);
    }

    #[test]
    fn a_game_is_named_after_its_manifest() {
        let dir = std::env::temp_dir().join(format!("nova-android-id-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("nova.json"),
            r#"{ "format": 1, "name": "Crate Dash!", "version": "1.2.0", "main": "main.lua" }"#,
        )
        .unwrap();
        std::fs::write(dir.join("main.lua"), "").unwrap();
        let vfs = DirVfs::new(&dir).unwrap();
        let id = Identity::of(&Project::open(&vfs).unwrap());
        assert_eq!(id.package, "com.nova.games.crate_dash");
        assert_eq!(id.id, "crate_dash");
        assert_eq!(id.version, "1.2.0");
        assert_eq!(id.label, "Crate Dash!");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
