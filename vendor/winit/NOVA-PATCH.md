# winit 0.30.13, with one change

This is the published `winit` 0.30.13 (Apache-2.0, see `LICENSE`) without its examples, tests and docs, plus one patch in
`src/platform_impl/android/mod.rs` marked `NOVA PATCH`.

**Why.** On Android, stock winit turns every motion event into a touch whose position is `AXIS_X`/`AXIS_Y`. A game controller's
motion events carry the left stick there, so moving the stick looks like a finger, and the right stick, the triggers and the d-pad
hat (other axes) are dropped.

**What changed.** A motion event from a joystick source (`SOURCE_JOYSTICK` = 0x01000010 set) is reported as one
`WindowEvent::AxisMotion` per axis (X, Y, Z, RX, RY, RZ, hat X and Y, left and right trigger, gas, brake) with the Android axis code
as the axis id, and is not turned into a touch. `crates/nova-runtime/src/input.rs` maps those codes to Nova's `axis:` and `pad:` sources.

Not verified on a device: the emulator cannot send controller motion events. Remove this folder and the `[patch.crates-io]`
entry in the root `Cargo.toml` to go back to stock winit (and lose analogue input on Android).
