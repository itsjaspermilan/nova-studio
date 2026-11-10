//! Opening a Blender `.blend` file: Blender, if it is installed, is run in the background to write the file out as a `.glb` (with modifiers applied), and the
//! studio then opens that like any other `.glb`. Nothing is installed or downloaded; the studio only looks for a Blender that is already there.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// Where a Blender might be: the `NOVA_BLENDER` variable, the usual install places on macOS, Windows and Linux, then the PATH.
pub fn find_blender() -> Option<PathBuf> {
    if let Some(p) = std::env::var_os("NOVA_BLENDER").map(PathBuf::from)
        && p.exists()
    {
        return Some(p);
    }
    let mut candidates: Vec<PathBuf> = vec![
        "/Applications/Blender.app/Contents/MacOS/Blender".into(),
        "/opt/homebrew/bin/blender".into(),
        "/usr/local/bin/blender".into(),
        "/usr/bin/blender".into(),
        "/snap/bin/blender".into(),
    ];
    if let Ok(entries) = std::fs::read_dir("C:\\Program Files\\Blender Foundation") {
        let mut found: Vec<PathBuf> = entries
            .filter_map(|e| e.ok())
            .map(|e| e.path().join("blender.exe"))
            .collect();
        found.sort();
        found.reverse(); // the newest version first
        candidates.extend(found);
    }
    if let Some(p) = candidates.into_iter().find(|p| p.exists()) {
        return Some(p);
    }
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .flat_map(|d| [d.join("blender"), d.join("blender.exe")])
        .find(|p| p.is_file())
}

/// The Python that Blender runs: open nothing else, write the whole scene as a binary glTF with modifiers applied.
fn script(out: &Path) -> String {
    let out = out
        .to_string_lossy()
        .replace('\\', "/")
        .replace('\'', "\\'");
    format!(
        "import bpy\nbpy.ops.export_scene.gltf(filepath='{out}', export_format='GLB', export_apply=True)\n"
    )
}

/// Converts `blend` into the binary glTF `out`. Gives up after `limit`. Returns what went wrong in plain words.
pub fn convert(blend: &Path, out: &Path, limit: Duration) -> Result<(), String> {
    if !blend.is_file()
        || blend
            .extension()
            .is_none_or(|e| !e.eq_ignore_ascii_case("blend"))
    {
        return Err(format!("{} is not a .blend file.", blend.display()));
    }
    let blender = find_blender().ok_or("Blender was not found. Install Blender (it is free, blender.org), or set NOVA_BLENDER to its program, then try again.")?;
    if let Some(parent) = out.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let _ = std::fs::remove_file(out);
    let mut child = Command::new(&blender)
        .arg("--background")
        .arg("--factory-startup") // no add-ons or settings of the person's own: the same result everywhere
        .arg(blend)
        .arg("--python-expr")
        .arg(script(out))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Blender could not be started ({}): {e}", blender.display()))?;
    let started = Instant::now();
    loop {
        match child.try_wait().map_err(|e| e.to_string())? {
            Some(status) => {
                let mut text = String::new();
                if let Some(mut o) = child.stdout.take() {
                    let _ = std::io::Read::read_to_string(&mut o, &mut text);
                }
                if let Some(mut e) = child.stderr.take() {
                    let _ = std::io::Read::read_to_string(&mut e, &mut text);
                }
                if status.success() && out.is_file() {
                    return Ok(());
                }
                let tail: Vec<&str> = text
                    .lines()
                    .rev()
                    .filter(|l| !l.trim().is_empty())
                    .take(4)
                    .collect();
                return Err(format!(
                    "Blender could not write a glTF from that file ({}). {}",
                    status,
                    tail.into_iter().rev().collect::<Vec<_>>().join(" | ")
                ));
            }
            None if started.elapsed() > limit => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!(
                    "Blender took more than {} seconds and was stopped.",
                    limit.as_secs()
                ));
            }
            None => std::thread::sleep(Duration::from_millis(100)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_python_names_the_output_with_forward_slashes_and_quotes_safely() {
        let s = script(Path::new("C:\\a b\\it's.glb"));
        assert!(s.contains("filepath='C:/a b/it\\'s.glb'"), "{s}");
        assert!(s.contains("export_apply=True"));
    }

    #[test]
    fn only_blend_files_that_exist_are_accepted() {
        let tmp = std::env::temp_dir();
        assert!(
            convert(
                &tmp.join("nope.blend"),
                &tmp.join("x.glb"),
                Duration::from_secs(1)
            )
            .is_err()
        );
        let txt = tmp.join(format!("nova-blend-{}.txt", std::process::id()));
        std::fs::write(&txt, "x").unwrap();
        let e = convert(&txt, &tmp.join("x.glb"), Duration::from_secs(1)).unwrap_err();
        assert!(e.contains("not a .blend"), "{e}");
    }

    /// Needs a Blender on this machine, so it is run by hand: `cargo test -p nova-studio -- --ignored blend`.
    #[test]
    #[ignore]
    fn a_real_blender_turns_a_blend_into_a_glb() {
        let blender = find_blender().expect("this test needs Blender");
        let dir = std::env::temp_dir().join(format!("nova-blend-real-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let blend = dir.join("cube.blend");
        let make = format!(
            "import bpy\nbpy.ops.wm.read_factory_settings(use_empty=True)\nbpy.ops.mesh.primitive_cube_add(size=2)\nbpy.ops.wm.save_as_mainfile(filepath='{}')\n",
            blend.to_string_lossy().replace('\\', "/")
        );
        let status = Command::new(&blender)
            .args(["--background", "--factory-startup", "--python-expr", &make])
            .status()
            .unwrap();
        assert!(status.success() && blend.is_file());
        let out = dir.join("out/cube.glb");
        convert(&blend, &out, Duration::from_secs(120)).unwrap();
        let bytes = std::fs::read(&out).unwrap();
        assert_eq!(&bytes[..4], b"glTF");
    }
}
