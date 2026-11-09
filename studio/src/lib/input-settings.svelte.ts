// The person's input choices: how they move around a 3D view (a mouse, a trackpad or a pen), and whether scroll gestures run the other way.
// Asked once on first launch (components/FirstLaunch.svelte), changeable in Edit > Input settings.

import { detectPlatform } from "./commands";
import type { NavScheme } from "./view-nav";

export interface WheelSample {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
}

/// Whether wheel events came from a trackpad: they slide sideways as well as up and down, or move in fractions of a pixel, which a mouse
/// wheel (notches of about 100, or lines) never does. Needs at least one telling sample; returns null when the samples say nothing.
export function looksLikeTrackpad(samples: WheelSample[]): boolean | null {
  let sawMouse = false;
  for (const s of samples) {
    if (s.deltaMode !== 0) {
      sawMouse = true;
      continue;
    }
    if (s.deltaX !== 0 || !Number.isInteger(s.deltaY)) return true;
    if (Math.abs(s.deltaY) >= 100 && s.deltaY % 4 === 0) sawMouse = true;
  }
  return sawMouse ? false : null;
}

const STORE = "nova.input.v1";

export interface InputState {
  navigation: NavScheme;
  invert: boolean;
  /// Whether the person has chosen (the first-launch screen shows until they have).
  configured: boolean;
}

/// A Mac is mostly a laptop with a trackpad; elsewhere a mouse is the better first guess.
export const defaultNavigation = (): NavScheme => (detectPlatform() === "mac" ? "trackpad" : "mouse");

export class InputSettings {
  navigation: NavScheme = $state(defaultNavigation());
  invert = $state(false);
  configured = $state(false);
  /// The settings dialog is open (from the menu); the first-launch screen opens by itself while `configured` is false.
  dialogOpen = $state(false);
  #storage: Pick<Storage, "getItem" | "setItem">;

  constructor(storage?: Pick<Storage, "getItem" | "setItem">) {
    this.#storage = storage ?? (typeof localStorage === "undefined" ? { getItem: () => null, setItem: () => {} } : localStorage);
    try {
      const raw = this.#storage.getItem(STORE);
      if (raw) {
        const s = JSON.parse(raw) as Partial<InputState>;
        if (s.navigation === "mouse" || s.navigation === "trackpad" || s.navigation === "pen") this.navigation = s.navigation;
        this.invert = !!s.invert;
        this.configured = !!s.configured;
      }
    } catch {
      // unreadable: ask again
    }
  }

  /// Keeps a choice (and marks the person as having chosen).
  set(patch: Partial<Pick<InputState, "navigation" | "invert">>): void {
    if (patch.navigation) this.navigation = patch.navigation;
    if (patch.invert !== undefined) this.invert = patch.invert;
    this.configured = true;
    try {
      this.#storage.setItem(STORE, JSON.stringify({ navigation: this.navigation, invert: this.invert, configured: true }));
    } catch {
      // not remembered
    }
  }
}

export const input = new InputSettings();
