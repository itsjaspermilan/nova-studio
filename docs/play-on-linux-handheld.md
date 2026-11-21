# Play on a 64-bit ARM Linux handheld (Armada, Zaviya OS)

Status (2026-11-19): **builds and links; not run on any device yet.** Nothing here is device-validated.

Retroid Pocket 6 and similar handhelds that run Armada or Zaviya OS are ordinary aarch64 Linux with a GPU driver (Vulkan) and
a display server. Nova's desktop runtime already supports Linux (wgpu, winit with X11 and Wayland, cpal over ALSA, gilrs over
udev), so this target is the same `nova` program built for `aarch64-unknown-linux-gnu`, not a new port.

## Build (on the Mac)

```sh
scripts/build-linux-arm64.sh                              # build/linux-arm64/nova
scripts/build-linux-arm64.sh --project examples/pine-ridge-rally   # + build/linux-arm64/export/<id>/
scripts/build-linux-arm64.sh --release --project <folder>          # optimised (link-time) build: use it to measure
```

- Needs Zig 0.15 (asdf) as C compiler and linker, and the rustup target (`rust-toolchain.toml` lists it).
- Targets glibc 2.28 or newer. Needs on the handheld: `libasound.so.2`, `libudev.so.1`, a Vulkan driver (`libvulkan.so.1`).
  Zig links against tiny stand-ins for libasound and libudev (symbol lists in `scripts/linux-arm64/`), so no Linux sysroot is
  downloaded; the real libraries are used at run time. If a dependency update needs more functions the link names them: add them.
- The export folder holds the program, `game.npk`, `play.sh` (and the licences). `play.bat` is for Windows and can be ignored.
  (`nova export desktop <folder> --exe <program>` packs any prebuilt program.)

## Run on the handheld

Copy the folder over (scp, USB, SD card), then on the device:

```sh
chmod +x <id> play.sh     # only if the copy lost the permissions
./play.sh                 # F3 shows statistics, Esc quits
```

Keep the folder on a disk that allows running programs (some SD-card mounts are `noexec`: copy to internal storage then).

## Not known yet (check on the device, record the result here)

- Which of Wayland or X11 the OS uses, and that winit picks it up; whether a Vulkan device is found (try `vulkaninfo`).
- Gamepad: gilrs reads `/dev/input` through udev; the Retroid's built-in controls may appear as a differently mapped pad.
- Audio: PipeWire's ALSA plugin gave 5.5-second callbacks (sound seconds late and garbled). `main.rs` now sets `PIPEWIRE_ALSA={ alsa.period-bytes=2048 alsa.buffer-bytes=8192 node.latency=256/48000 }` (256-frame periods, 1024-frame buffer: about 20 ms) (1024 frames) unless it is set, and `audio.rs` prefers the "pipewire" ALSA device (`NOVA_AUDIO_DEVICE=<part of a name>` picks another; names are logged). Measured on 2026-11-19: about 47 callbacks a second, max 2 ms; **not listened to yet**. Save-data folder, thermals: unchecked.
- Launching from the OS's own front end: the Retroid runs Steam in game mode, so each game is a "non-Steam game" pointing at its `play.sh`. `scripts/steam-shortcut.mjs` writes a first list; `scripts/steam-shortcut-add.mjs` adds a game to an existing list, copying another entry's launch options (Pine Ridge's are `/usr/libexec/armada/armada-game-launch %command%`). The list is `~/.local/share/Steam/userdata/<id>/config/shortcuts.vdf`; keep a copy, and restart Steam to see the change. Neon Undertow was added this way on 2026-11-21; **not yet confirmed to appear or start**.

## Library artwork in Steam's game mode

Each game has its pictures in `<game>/steam/` (`cover.png` 600x900, `banner.png` 920x430, `hero.png` 3840x1240, `logo.png` 1280x720 with a
transparent background, `icon.png` 256x256), made by `scripts/steam-art.mjs` (`scripts/env.sh node scripts/steam-art.mjs examples/neon-undertow`; it plays the
game headless to capture key art, so it needs the release build of `nova`). The folder is in each game's `nova.json` `"ignore"` list, so it is neither loaded nor packed.

For a non-Steam game Steam reads artwork from `~/.local/share/Steam/userdata/<user id>/config/grid/`, named after the shortcut's app id (the unsigned
32-bit number in its `shortcuts.vdf` entry, which `scripts/steam-shortcut-add.mjs` computes from the quoted exe path plus the name):

| File in `grid/` | Made from |
| --- | --- |
| `<appid>p.png` | `cover.png` (the library grid) |
| `<appid>.png` | `banner.png` (recent games, the wide capsule) |
| `<appid>_hero.png` | `hero.png` (the background of the game's page) |
| `<appid>_logo.png` | `logo.png` (drawn over the hero) |

The icon is not in `grid/`: it is a path in the entry's `icon` field. `node scripts/steam-shortcut-add.mjs --print-appid "<name>" <exe>` prints the app id
(touches no file; give the exe exactly as it is in the list, without quotes), and
`node scripts/steam-shortcut-add.mjs --set-icon <in> <out> "<name>" <path to icon.png>` writes a copy of the list with that entry's icon set (same exact-roundtrip check as
the add mode). Keep a copy of the old list, copy the pictures in, and restart Steam. Not yet tried on the device.
