// Play on device: the words the studio shows about Android devices (the backend is studio/src-tauri/src/device.rs).

import type { AndroidDevice } from "./types";

export const NO_DEVICE =
  "No device is connected. Plug the handheld in with a USB cable and turn on USB debugging (Settings › System › Developer options), then look again.";

/// Why a device cannot be played on yet, in plain words, or null when it is ready.
export function deviceHint(d: AndroidDevice): string | null {
  switch (d.state) {
    case "device":
      return null;
    case "unauthorized":
      return "Waiting for permission: on its screen, tick “Always allow” and accept “Allow USB debugging?”, then look again.";
    case "offline":
      return "Connected but not answering: unplug it and plug it back in.";
    case "authorizing":
    case "connecting":
      return "Still connecting: wait a moment, then look again.";
    default:
      return d.state.startsWith("no permissions") ? "This computer is not allowed to use it over USB." : `Not ready (${d.state}).`;
  }
}

/// The device to offer first: the one played on last if it is still there and ready, else the first ready handheld,
/// else the first ready emulator.
export function preferredDevice(devices: AndroidDevice[], last: string | null): AndroidDevice | null {
  const ready = devices.filter((d) => d.state === "device");
  return ready.find((d) => d.serial === last) ?? ready.find((d) => !d.emulator) ?? ready[0] ?? null;
}

/// Remembered between sessions: the serial of the device played on last.
const KEY = "nova.device";
export function lastDevice(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
export function rememberDevice(serial: string) {
  try {
    localStorage.setItem(KEY, serial);
  } catch {
    /* not remembered */
  }
}
