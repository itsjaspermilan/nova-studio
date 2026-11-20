// Sound effects by purpose: sfx_write { "purpose": "step_grass" } gives an effect tuned for that job (short enough,
// bright enough for a handheld's small speaker, starting and ending in silence), so that it passes sound_report as it is.
// A purpose is only a set of the synth's ordinary settings: the .sfx.json it writes is edited like any other.

import { DEFAULTS, PRESETS, type SfxParams } from "../../src/lib/sfx";
import { rngOf } from "./paint";

const P = (p: Partial<SfxParams>): SfxParams => ({ ...DEFAULTS, attack: 0.004, ...p });

export const PURPOSES: Record<string, { what: string; params: SfxParams }> = {
  step_grass: { what: "a footstep on grass or earth: a soft brush", params: P({ wave: "noise", freq: 1700, sustain: 0.01, decay: 0.07, lowpass: 3200, highpass: 500, volume: 0.35 }) },
  step_stone: { what: "a footstep on stone or wood: a short tap", params: P({ wave: "noise", freq: 3000, slide: -1, sustain: 0.004, decay: 0.045, lowpass: 9000, highpass: 1100, volume: 0.35 }) },
  sword_swing: { what: "a blade through the air", params: P({ wave: "noise", freq: 2600, slide: -1.6, attack: 0.03, sustain: 0.03, decay: 0.11, lowpass: 6000, highpass: 900, volume: 0.4 }) },
  hit: { what: "a blow landing on an enemy", params: PRESETS.hit! },
  hurt: { what: "the player is hurt: a falling yelp", params: P({ wave: "square", freq: 520, slide: -2.4, sustain: 0.05, decay: 0.16, duty: 0.3, highpass: 150, volume: 0.36 }) },
  pickup: { what: "something small picked up: three quick rising notes", params: P({ wave: "square", freq: 660, arpTime: 0.055, arpNotes: [5, 12], sustain: 0.1, decay: 0.14, duty: 0.4, highpass: 150, volume: 0.42 }) },
  coin: { what: "a coin", params: PRESETS.coin! },
  door: { what: "a door: a low wooden thump", params: P({ wave: "triangle", freq: 210, slide: -1.3, attack: 0.006, sustain: 0.03, decay: 0.17, highpass: 90, lowpass: 2400, volume: 0.5 }) },
  chest_open: { what: "a chest opened: a rising fanfare of five notes", params: P({ wave: "square", freq: 392, arpTime: 0.085, arpNotes: [4, 7, 12, 16], sustain: 0.36, decay: 0.32, duty: 0.4, highpass: 150, volume: 0.4 }) },
  jump: { what: "a jump", params: PRESETS.jump! },
  land: { what: "landing after a jump: a dull pat", params: P({ wave: "noise", freq: 1300, slide: -1.5, sustain: 0.006, decay: 0.08, lowpass: 2600, highpass: 220, volume: 0.4 }) },
  ui_move: { what: "moving in a menu: a tick", params: P({ wave: "square", freq: 620, sustain: 0.012, decay: 0.04, duty: 0.5, highpass: 150, volume: 0.35 }) },
  ui_select: { what: "choosing in a menu: two quick notes up", params: P({ wave: "square", freq: 700, arpSemitones: 7, arpTime: 0.05, sustain: 0.06, decay: 0.1, duty: 0.4, highpass: 150, volume: 0.4 }) },
  enemy_die: { what: "an enemy beaten: a puff that falls away", params: P({ wave: "noise", freq: 2000, slide: -2.6, sustain: 0.07, decay: 0.3, lowpass: 5000, highpass: 160, volume: 0.45 }) },
  locked: { what: "a locked door, or \"you cannot\": two low buzzes", params: P({ wave: "square", freq: 196, arpTime: 0.1, arpNotes: [-3], sustain: 0.13, decay: 0.07, duty: 0.2, highpass: 120, lowpass: 5000, volume: 0.4 }) },
  powerup: { what: "a power-up: a rising warble", params: PRESETS.powerup! },
  explosion: { what: "an explosion", params: PRESETS.explosion! },
  laser: { what: "a shot", params: PRESETS.laser! },
};

export const PURPOSE_NAMES = Object.keys(PURPOSES);

/// The settings of a purpose; a seed other than 1 is a variant (a little higher or lower, shorter or longer, other noise).
export function purposeParams(purpose: unknown, seed: unknown): SfxParams {
  const hit = PURPOSES[String(purpose).trim().toLowerCase().replace(/[ -]/g, "_")];
  if (!hit) throw new Error(`unknown purpose '${purpose}'. Purposes: ${PURPOSE_NAMES.map((n) => `${n} (${PURPOSES[n]!.what})`).join("; ")}`);
  const p = { ...hit.params };
  const s = seed === undefined || seed === null ? 1 : Math.floor(Number(seed));
  if (!Number.isFinite(s)) throw new Error('"seed" is a whole number');
  if (s !== 1) {
    const rng = rngOf(s);
    p.freq = Math.round(p.freq * (1 + (rng() - 0.5) * 0.16));
    p.decay = Math.round(p.decay * (1 + (rng() - 0.5) * 0.24) * 1000) / 1000;
    p.seed = s;
  }
  return p;
}
