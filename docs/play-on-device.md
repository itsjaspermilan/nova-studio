# Play on device

One button puts the game on the handheld: **▾ beside ▶ Play** lists the Android devices adb can see (the Retroid
Pocket 6 over USB shows as `Retroid Pocket 6`, serial `bc8565a3`; emulators too). Picking one saves everything, builds
the game as a debug-signed APK, installs it, starts it and shows its log in the Play panel. **■ Stop** ends it on the
device. ⌘⇧↩ plays on the device used last.

## What happens

1. **Build**: `nova export android <project> --out <studio cache>/device` (below). The game is checked first
   (`nova check`); a game with errors is not put on the device and the message points at Problems.
2. **Install**: `adb -s <serial> install -r <apk>`. Saved games survive (it is an update).
3. **Cover**: when the project has `boxart-wide.png` (else `boxart.png`) and the device has a `/sdcard/Lantern` folder,
   the picture is copied to `/sdcard/Lantern/art/androidgames/<package>.png`, where the Lantern launcher reads covers.
4. **Start**: `am force-stop`, then `am start -W -n <package>/android.app.NativeActivity`.
5. **Log**: `adb logcat -v tag --pid=<the game's pid>`. The game's own lines (tag `nova`: the runtime and `nova.log`)
   show without the tag; other libraries' lines only at warning and above. The speed line feeds the speed strip as on
   desktop. When the game ends by itself, the crash buffer since the start is searched for a report naming the game.

The top bar shows the step while it works ("Installing on Retroid Pocket 6…") and the device while it runs.

Problems are said in plain words (`studio/src-tauri/src/device.rs`, `studio/src/lib/devices.ts`):

| Situation | What the studio says |
|---|---|
| adb is not found (`ANDROID_HOME`, `ANDROID_SDK_ROOT`, `~/Library/Android/sdk`, PATH) | install the SDK Platform-Tools or set ANDROID_HOME |
| no device | plug it in and turn on USB debugging (where that setting is) |
| `unauthorized` | accept "Allow USB debugging?" on the device's screen |
| `offline` | unplug and plug back in |
| the build failed | "could not be built for Android:" and the build's last error; the full output is in the Play panel |
| the install was refused | why, in words: signed elsewhere (uninstall first; saves go with it), no space, newer copy, ... |
| the game closed at once | look at the device; the log may say why |

## `nova export android`

```sh
scripts/env.sh target/release/nova export android examples/crate-dash --out build/android   # check, then build
scripts/build-apk.sh --project examples/crate-dash      # the same without the check (thin wrapper, kept for scripts)
scripts/build-apk.sh                                     # the benchmark scene (nova export android --benchmark)
```

Flags: `--rebuild` (build everything again), `--debug-build` (unoptimised engine), `--fast` (engine built with the `fast` profile: no link-time
optimisation, incremental, so an engine edit rebuilds in seconds instead of a minute; a little slower at run time, so measure on the device without it),
`--no-check`, `--benchmark`.
Each step is printed as `[step] ...` (the studio shows these); the end is `apk: <path>` and
`package: <id>   label: <name>   version: <v>` (`scripts/device-smoke.sh` reads that line).

The work is in `crates/nova-runtime/src/android.rs`, the same steps the old script ran: `cargo ndk` for the engine
(`libnova_runtime.so`, arm64-v8a), `aapt2` for the manifest (from `crates/nova-runtime/android/`, filled from
`nova.json`) and resources, the engine stored uncompressed, `assets/THIRD-PARTY.txt`, the packed game as
`assets/project.npk`, then `zipalign -p 4` and `apksigner`. `icon.png` becomes the launcher icon at five sizes
(resized in Rust). The tools come from `ANDROID_HOME` (newest build-tools and platform) and `JAVA_HOME`.

**Repeat builds are quick.** The engine is rebuilt only when the runtime's source (`crates/nova-runtime/{src,lua}`,
`build.rs`, the `Cargo` files, `audio/`) is newer than the built library. Everything but the game is kept as a base
APK in `build/android/work/<id>/`, with a key made from what went into it (manifest, resources, icon, notices, the
library's size and time); while the key matches, only `assets/project.npk` is added to a copy and signed again.
Measured on this Mac: about 0.5 s for a change to a game's files, 25 s when the runtime changed, several minutes
the first time.

**Signing.** Debug-signed only, with `build/android/debug.keystore` (made by `keytool` the first time). A build in a
git worktree uses the key of the Nova checkout around it, so a game installed from either can be updated from the
other (a different key makes the install fail with "signed on another computer"). Release signing is the person's to
do. Projects skip their `exports/` folder when packed, so an exported APK never ends up inside the next one.

## Checked

- 2026-11-08, Retroid Pocket 6 (bc8565a3), from this Mac: the studio's code path (the ignored test
  `NOVA_DEVICE=bc8565a3 NOVA_DEVICE_GAME=examples/nebula-swap scripts/env.sh cargo test -p nova-studio --lib plays_on_a_real_device -- --ignored --nocapture`)
  built Nebula Swap (1.3 s, engine up to date), installed it, copied its cover to Lantern's folder, started it, received
  the game's log (`project.npk: 7107958 bytes`, `adapter: Adreno (TM) 740 (Vulkan)`), and Stop ended the process.
- The menu, steps and Stop in the browser preview with the mock backend; vitest `devices.test.ts`, `PlayButton.test.ts`.
- Not checked: the desktop app window itself driving a device (the same commands, through Tauri), an emulator as the
  target, a Windows or Linux computer, a device without Lantern.
