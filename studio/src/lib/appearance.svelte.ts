// How the studio looks: the theme (follow the system, dark, light, or high contrast), the size of everything (75 to 200 percent) and whether
// things animate. Remembered between runs and applied to the page as attributes the stylesheet (app.css) reads.

export type ThemePref = "system" | "dark" | "light" | "contrast";
export type Theme = "dark" | "light" | "contrast";

export const MIN_SCALE = 75;
export const MAX_SCALE = 200;

/// The theme to show for a preference, given whether the system is in dark mode.
export function resolveTheme(pref: ThemePref, systemDark: boolean): Theme {
  return pref === "system" ? (systemDark ? "dark" : "light") : pref;
}

/// A size in percent kept to the range the studio is laid out for, in steps of 5.
export function clampScale(percent: number): number {
  if (!Number.isFinite(percent)) return 100;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(percent / 5) * 5));
}

const STORE = "nova.appearance.v1";

export class Appearance {
  theme: ThemePref = $state("system");
  scale = $state(100);
  /// Fewer animations and no smooth scrolling (also on when the system asks for reduced motion).
  reducedMotion = $state(false);
  #storage: Pick<Storage, "getItem" | "setItem">;

  constructor(storage?: Pick<Storage, "getItem" | "setItem">) {
    this.#storage = storage ?? (typeof localStorage === "undefined" ? { getItem: () => null, setItem: () => {} } : localStorage);
    try {
      const raw = this.#storage.getItem(STORE);
      if (raw) {
        const s = JSON.parse(raw) as { theme?: string; scale?: number; reducedMotion?: boolean };
        if (s.theme === "system" || s.theme === "dark" || s.theme === "light" || s.theme === "contrast") this.theme = s.theme;
        if (typeof s.scale === "number") this.scale = clampScale(s.scale);
        this.reducedMotion = !!s.reducedMotion;
      }
    } catch {
      // unreadable: the defaults
    }
  }

  set(patch: Partial<{ theme: ThemePref; scale: number; reducedMotion: boolean }>): void {
    if (patch.theme) this.theme = patch.theme;
    if (patch.scale !== undefined) this.scale = clampScale(patch.scale);
    if (patch.reducedMotion !== undefined) this.reducedMotion = patch.reducedMotion;
    try {
      this.#storage.setItem(STORE, JSON.stringify({ theme: this.theme, scale: this.scale, reducedMotion: this.reducedMotion }));
    } catch {
      // not remembered
    }
  }
}

export const appearance = new Appearance();

/// Puts the appearance on the page, and keeps it there as the system's light and dark mode and the settings change. Returns a function that stops.
export function applyAppearance(root: HTMLElement = document.documentElement): () => void {
  const media = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
  const motion = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  const paint = () => {
    root.dataset.theme = resolveTheme(appearance.theme, media?.matches ?? true);
    root.dataset.motion = appearance.reducedMotion || motion?.matches ? "reduced" : "full";
    // (CSS zoom scales everything, text included; 100 is no zoom)
    root.style.setProperty("zoom", appearance.scale === 100 ? "" : String(appearance.scale / 100));
  };
  const stopEffect = $effect.root(() => {
    $effect(() => {
      void appearance.theme;
      void appearance.scale;
      void appearance.reducedMotion;
      paint();
    });
  });
  media?.addEventListener("change", paint);
  motion?.addEventListener("change", paint);
  return () => {
    stopEffect();
    media?.removeEventListener("change", paint);
    motion?.removeEventListener("change", paint);
  };
}
