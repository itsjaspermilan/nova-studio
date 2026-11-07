// Store art: the app icon and the box art, made from a picture of the running game.

export type ArtKind = "icon" | "boxart";

export interface ArtSpec {
  kind: ArtKind;
  /// The file written into the project.
  file: string;
  width: number;
  height: number;
  label: string;
}

/// `scripts/build-apk.sh` makes the Android launcher icon from `icon.png`; a launcher can show `boxart.png` as the game's cover.
export const ART: Record<ArtKind, ArtSpec> = {
  icon: { kind: "icon", file: "icon.png", width: 512, height: 512, label: "App icon" },
  boxart: { kind: "boxart", file: "boxart.png", width: 768, height: 1024, label: "Box art" },
};

/// The sizes an Android launcher shows an icon at (dp, and the pixels at the densities it ships: mdpi 48, hdpi 72, xhdpi 96, xxxhdpi 192).
export const LAUNCHER_SIZES = [192, 96, 72, 48] as const;

/// A step on the way to the screen: after `seconds` press `key` (a key name such as `Enter` or `ArrowRight`, or a controller button such as `pad:south`).
export interface KeyStep {
  key: string;
  seconds: number;
}

export const FRAMES_PER_SECOND = 60;

const BUTTON = /^(key|pad|mouse):/;

/// "Enter" becomes `key:Enter`; `pad:south` stays. Spaces are not allowed in the source, and the result never has a comma.
export function sourceOf(key: string): string | null {
  const k = key.trim();
  if (!k || /[,@\s]/.test(k)) return null;
  return BUTTON.test(k) ? k : `key:${k.length === 1 ? (/[a-z]/i.test(k) ? `Key${k.toUpperCase()}` : /\d/.test(k) ? `Digit${k}` : k) : k}`;
}

/// The runner's `press` list for some steps (a blank or unusable step is left out), and how many frames to run: a second after the last press
/// plus `settleSeconds` for the game to get there and draw.
export function planPicture(steps: KeyStep[], settleSeconds: number): { press: string[]; frames: number } {
  const press: string[] = [];
  let last = 0;
  for (const s of steps) {
    const source = sourceOf(s.key);
    if (!source || !(s.seconds >= 0) || !isFinite(s.seconds)) continue;
    const frame = Math.round(s.seconds * FRAMES_PER_SECOND);
    press.push(`${source}@${frame}`);
    last = Math.max(last, frame);
  }
  const settle = Math.round(Math.max(0, isFinite(settleSeconds) ? settleSeconds : 0) * FRAMES_PER_SECOND);
  return { press, frames: Math.max(1, Math.min(100000, last + settle || 90)) };
}
