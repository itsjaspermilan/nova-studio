// Sound effects by purpose: sfx_write { "purpose": "hit" } gives an effect tuned for that job, so that it passes sound_report as
// it is. Each purpose is built the way a produced game sound is (docs/sound-for-agents.md): layers, each one source with its
// own envelope, pitch drop and moving filter. Most are a transient (a few ms of bright noise or a click: the moment of impact),
// a body (a tone that drops in pitch, or noise through a sweeping filter) and a tail, often with a sub under an impact; FM for
// bells and metal, ring modulation and crackle for electricity; then a touch of drive, a short room and some stereo width.
// A purpose is only a set of the synth's ordinary settings: the .sfx.json it writes is edited like any other.

import { DEFAULTS, type SfxLayer, type SfxParams } from "../../src/lib/sfx";
import { cleanLayer } from "../../src/lib/sfx-layers";
import { rngOf } from "./paint";

type LayerSpec = Partial<SfxLayer> & { wave: SfxLayer["wave"] };
const L = (wave: SfxLayer["wave"], o: Partial<SfxLayer> = {}): LayerSpec => ({ wave, ...o });
/// An effect from layers and its finish.
const FX = (layers: LayerSpec[], finish: { volume?: number; drive?: number; reverb?: number; room?: number; width?: number } = {}): SfxParams => ({
  ...DEFAULTS, volume: finish.volume ?? 0.7, seed: 1, layers: layers.map((l, i) => cleanLayer(l, `layer ${i}`)),
  ...(finish.drive ? { drive: finish.drive } : {}), ...(finish.reverb ? { reverb: finish.reverb, room: finish.room ?? 0.3 } : {}), ...(finish.width ? { width: finish.width } : {}),
});

// the parts most effects share
/// A few ms of bright noise: the crack or click the ear takes as the moment of impact.
const crack = (volume = 0.5, cutoff = 3500, decay = 0.025): LayerSpec => L("noise", { filter: "bandpass", cutoff: cutoff * 1.4, q: 0.7, hold: 0.004, decay, volume: Math.min(1, volume * 1.8) });
/// A tone that drops in pitch: a thump (low) or a knock (higher).
const thump = (freq: number, volume: number, decay: number, drop = 24, time = 0.025): LayerSpec => L("sine", { freq, pitch: drop, pitchTime: time, hold: 0.01, decay, volume });
/// Noise through a band-pass that falls: the body of a hit, a crunch, a burst.
const crunch = (from: number, to: number, volume: number, decay: number, q = 1.2, wave: SfxLayer["wave"] = "noise"): LayerSpec => L(wave, { filter: "bandpass", cutoff: from, cutoffEnd: to, q, hold: 0.01, decay, volume });
/// A bell or chime note: a sine with a fading FM partial.
const bell = (freq: number, start: number, volume: number, decay: number, ratio = 3.5, fm = 2.2): LayerSpec => L("sine", { freq, start, fm, fmRatio: ratio, fmDecay: decay * 0.3, hold: 0.005, decay, volume });
/// The strike of a bell or a key: a few ms of very high noise.
const tick = (volume = 0.3, start = 0): LayerSpec => L("noise", { filter: "bandpass", cutoff: 7000, q: 0.7, start, hold: 0.002, decay: 0.012, volume });

export const PURPOSES: Record<string, { what: string; params: SfxParams }> = {
  // ---- moving about ----
  step_grass: { what: "a footstep on grass or earth: a soft brush with a little weight", params: FX([crunch(1600, 900, 0.5, 0.07, 0.8, "pink"), L("noise", { filter: "highpass", cutoff: 3500, hold: 0, decay: 0.025, volume: 0.15 }), thump(130, 0.18, 0.05, 12)], { volume: 0.6, width: 0.2 }) },
  step_stone: { what: "a footstep on stone, concrete or wood: a short tap with a knock", params: FX([crack(0.4, 4000, 0.012), thump(240, 0.4, 0.045, 12, 0.01), crunch(2600, 1400, 0.3, 0.045, 1)], { volume: 0.6, reverb: 0.08, room: 0.15, width: 0.2 }) },
  jump: { what: "a jump: a quick rising breath of air with a soft tone", params: FX([L("triangle", { freq: 300, pitch: -9, pitchTime: 0.05, hold: 0.04, decay: 0.16, filter: "lowpass", cutoff: 2500, volume: 0.45 }), L("noise", { filter: "bandpass", cutoff: 1500, cutoffEnd: 4000, q: 1.5, attack: 0.01, hold: 0.03, decay: 0.06, volume: 0.25 })], { volume: 0.6, width: 0.3 }) },
  land: { what: "landing after a jump: a dull pat with weight", params: FX([crack(0.45, 3000, 0.015), thump(95, 0.5, 0.1, 12, 0.02), crunch(1800, 500, 0.6, 0.09, 0.9, "pink")], { volume: 0.6, width: 0.4 }) },
  whoosh: { what: "something fast through the air: a rising-falling rush of noise", params: FX([L("pink", { filter: "bandpass", cutoff: 500, cutoffEnd: 2800, q: 2, attack: 0.07, hold: 0.02, decay: 0.12, volume: 0.6 }), L("noise", { filter: "highpass", cutoff: 4000, attack: 0.06, hold: 0, decay: 0.08, volume: 0.15 })], { volume: 0.75, width: 0.6, reverb: 0.08, room: 0.2 }) },
  sword_swing: { what: "a blade through the air: a thin, quick whoosh", params: FX([L("noise", { filter: "bandpass", cutoff: 1200, cutoffEnd: 4500, q: 3, attack: 0.035, hold: 0.01, decay: 0.09, volume: 0.6 }), L("sine", { freq: 2600, fm: 1.5, fmRatio: 1.41, attack: 0.03, hold: 0, decay: 0.07, volume: 0.06 })], { volume: 0.75, width: 0.5 }) },
  // ---- fighting ----
  hit: { what: "a blow landing on an enemy: a crack, a punchy thump and a crunch", params: FX([crack(0.55, 4000, 0.025), thump(110, 0.65, 0.13, 19, 0.02), crunch(2200, 700, 0.45, 0.13, 1.3)], { volume: 0.7, drive: 0.25, reverb: 0.1, room: 0.25, width: 0.35 }) },
  heavy_hit: { what: "a heavy blow, a slam, a big impact: a crack, a body, a sub under it and a short room", params: FX([crack(0.6, 3000, 0.03), thump(58, 0.8, 0.34, 24, 0.035), L("triangle", { freq: 120, pitch: 12, pitchTime: 0.02, hold: 0.01, decay: 0.2, filter: "lowpass", cutoff: 1500, volume: 0.45 }), crunch(1800, 300, 0.5, 0.3, 1.1)], { volume: 0.7, drive: 0.45, reverb: 0.15, room: 0.35, width: 0.45 }) },
  hurt: { what: "the player is hurt: a hit with a falling, buzzing cry", params: FX([crack(0.65, 3500, 0.02), thump(150, 0.55, 0.14, 12, 0.02), L("square", { freq: 520, slide: -2.4, hold: 0.04, decay: 0.16, duty: 0.5, filter: "lowpass", cutoff: 3200, cutoffEnd: 900, volume: 0.3 }), crunch(1500, 400, 0.3, 0.12)], { volume: 0.7, drive: 0.3, reverb: 0.08, room: 0.2, width: 0.3 }) },
  shot: { what: "a gun or blaster shot: a crack, a thump and a zap that falls, in a short room", params: FX([crack(0.6, 3000, 0.03), thump(120, 0.6, 0.1, 24, 0.015), L("saw", { freq: 900, pitch: 12, pitchTime: 0.01, slide: -4, hold: 0.01, decay: 0.12, unison: 2, detune: 15, filter: "lowpass", cutoff: 4500, cutoffEnd: 700, volume: 0.3 }), crunch(1800, 600, 0.4, 0.15)], { volume: 0.65, drive: 0.4, reverb: 0.15, room: 0.4, width: 0.4 }) },
  laser: { what: "an energy shot: a bright detuned zap that falls, with a ring", params: FX([crack(0.3, 5000, 0.015), L("saw", { freq: 1500, pitch: 7, pitchTime: 0.01, slide: -3.5, hold: 0.03, decay: 0.18, unison: 3, detune: 18, filter: "lowpass", cutoff: 6000, cutoffEnd: 1200, volume: 0.35 }), L("sine", { freq: 1200, slide: -3, fm: 3, fmRatio: 2.01, fmDecay: 0.05, hold: 0.02, decay: 0.15, volume: 0.25 })], { volume: 0.65, reverb: 0.15, room: 0.3, width: 0.5 }) },
  zap: { what: "electricity: a ring-modulated buzz with crackle", params: FX([crack(0.35, 6000, 0.02), L("saw", { freq: 220, ring: 1700, hold: 0.04, decay: 0.18, filter: "lowpass", cutoff: 5000, volume: 0.5 }), L("crackle", { freq: 900, filter: "highpass", cutoff: 2000, hold: 0.05, decay: 0.2, volume: 0.45 }), L("sine", { freq: 2400, fm: 6, fmRatio: 1.37, hold: 0.02, decay: 0.12, volume: 0.2 })], { volume: 0.7, drive: 0.3, reverb: 0.1, room: 0.25, width: 0.5 }) },
  metal_hit: { what: "metal struck: a clang of inharmonic partials that rings", params: FX([crack(0.4, 3000, 0.02), L("sine", { freq: 520, fm: 6, fmRatio: 1.41, fmDecay: 0.2, hold: 0.005, decay: 0.6, volume: 0.4 }), L("sine", { freq: 1170, fm: 3, fmRatio: 2.76, fmDecay: 0.15, hold: 0.005, decay: 0.4, volume: 0.25 }), thump(160, 0.35, 0.12, 12)], { volume: 0.65, drive: 0.2, reverb: 0.2, room: 0.4, width: 0.4 }) },
  glass: { what: "glass breaking: a crack, bright crackle and a ringing shimmer", params: FX([crack(0.55, 3000, 0.03), L("noise", { filter: "highpass", cutoff: 3000, cutoffEnd: 6000, hold: 0.01, decay: 0.25, volume: 0.35 }), L("crackle", { freq: 400, filter: "highpass", cutoff: 4000, start: 0.01, hold: 0.04, decay: 0.3, volume: 0.4 }), L("sine", { freq: 3200, fm: 4, fmRatio: 2.3, fmDecay: 0.08, hold: 0, decay: 0.2, volume: 0.12 })], { volume: 0.65, reverb: 0.15, room: 0.3, width: 0.6 }) },
  explosion: { what: "an explosion: a crack, a deep falling boom, a rush of noise and crackling debris", params: FX([crack(0.5, 2500, 0.04), thump(62, 0.5, 0.7, 24, 0.06), L("pink", { filter: "lowpass", cutoff: 5000, cutoffEnd: 250, filterTime: 0.6, hold: 0.04, decay: 1, volume: 0.7 }), L("crackle", { freq: 30, filter: "bandpass", cutoff: 2500, q: 0.8, start: 0.05, hold: 0.1, decay: 0.7, volume: 0.35 })], { volume: 0.7, drive: 0.5, reverb: 0.25, room: 0.6, width: 0.6 }) },
  enemy_die: { what: "an enemy beaten: a crunchy burst, a falling tone and crackle", params: FX([crack(0.45, 3000, 0.03), crunch(3000, 300, 0.5, 0.35), L("saw", { freq: 400, slide: -3, hold: 0.02, decay: 0.3, filter: "lowpass", cutoff: 2200, cutoffEnd: 300, volume: 0.25 }), thump(85, 0.5, 0.28, 19, 0.03), L("crackle", { freq: 60, filter: "highpass", cutoff: 1500, start: 0.03, hold: 0.05, decay: 0.3, volume: 0.25 })], { volume: 0.65, drive: 0.3, reverb: 0.2, room: 0.4, width: 0.5 }) },
  death: { what: "the player dies: a hit, a long falling detuned tone, a boom and a big room", params: FX([crack(0.4, 3000, 0.03), L("saw", { freq: 440, slide: -1.5, hold: 0.1, decay: 1, unison: 3, detune: 20, filter: "lowpass", cutoff: 3000, cutoffEnd: 200, volume: 0.35 }), thump(52, 0.6, 0.6, 24, 0.05), L("pink", { filter: "lowpass", cutoff: 3000, cutoffEnd: 200, hold: 0.02, decay: 0.8, volume: 0.4 })], { volume: 0.65, drive: 0.25, reverb: 0.35, room: 0.7, width: 0.6 }) },
  // ---- warnings ----
  tell: { what: "an enemy about to attack (a tell): a rising charge that a player learns to fear", params: FX([L("square", { freq: 330, pitch: -12, pitchTime: 0.12, vibrato: 0.3, vibratoSpeed: 14, attack: 0.03, hold: 0.18, decay: 0.12, unison: 2, detune: 12, filter: "lowpass", cutoff: 1200, cutoffEnd: 4000, filterTime: 0.2, volume: 0.35 }), L("noise", { filter: "bandpass", cutoff: 800, cutoffEnd: 3000, q: 3, attack: 0.1, hold: 0.1, decay: 0.08, volume: 0.25 })], { volume: 0.65, reverb: 0.15, room: 0.3, width: 0.4 }) },
  alarm: { what: "an alarm: a two-tone siren with an edge", params: FX([L("square", { freq: 740, vibrato: 2.5, vibratoSpeed: 5, attack: 0.02, hold: 0.45, decay: 0.12, unison: 2, detune: 10, filter: "lowpass", cutoff: 2800, volume: 0.3 }), L("sine", { freq: 1480, vibrato: 2.5, vibratoSpeed: 5, attack: 0.02, hold: 0.45, decay: 0.12, volume: 0.15 })], { volume: 0.6, drive: 0.25, reverb: 0.2, room: 0.4, width: 0.3 }) },
  locked: { what: "a locked door, or \"you cannot\": two low buzzes", params: FX([crack(0.2, 3000, 0.01), L("saw", { freq: 196, hold: 0.08, decay: 0.06, unison: 2, detune: 10, filter: "lowpass", cutoff: 900, volume: 0.5 }), L("saw", { freq: 165, start: 0.13, hold: 0.08, decay: 0.08, unison: 2, detune: 10, filter: "lowpass", cutoff: 800, volume: 0.5 })], { volume: 0.65, drive: 0.2, reverb: 0.1, room: 0.2, width: 0.3 }) },
  // ---- rewards and doors ----
  pickup: { what: "something small picked up: two bright bell notes with a shimmer", params: FX([tick(0.35), bell(1320, 0, 0.4, 0.3), bell(1760, 0.06, 0.35, 0.45), L("noise", { filter: "highpass", cutoff: 7000, hold: 0, decay: 0.1, volume: 0.08 })], { volume: 0.6, reverb: 0.25, room: 0.4, width: 0.5 }) },
  coin: { what: "a coin: a short chime and a higher ring", params: FX([tick(0.35), bell(988, 0, 0.4, 0.15, 2, 1.5), bell(1319, 0.07, 0.4, 0.45, 2, 1.5)], { volume: 0.6, reverb: 0.2, room: 0.35, width: 0.4 }) },
  chest_open: { what: "a chest opened: a rising arpeggio of bells over a swelling pad", params: FX([...[0, 4, 7, 12, 16].map((s, i) => bell(392 * 2 ** (s / 12), i * 0.085, 0.3, 0.5, 3)), L("saw", { freq: 196, unison: 3, detune: 14, attack: 0.1, hold: 0.3, decay: 0.4, filter: "lowpass", cutoff: 800, cutoffEnd: 3000, volume: 0.18 })], { volume: 0.6, reverb: 0.3, room: 0.5, width: 0.6 }) },
  powerup: { what: "a power-up: a rising detuned swell that opens up, with a sparkle", params: FX([L("saw", { freq: 330, slide: 1.2, unison: 3, detune: 15, attack: 0.02, hold: 0.3, decay: 0.25, filter: "lowpass", cutoff: 800, cutoffEnd: 6000, volume: 0.35 }), bell(1320, 0.25, 0.25, 0.35, 3.5, 2)], { volume: 0.6, reverb: 0.25, room: 0.4, width: 0.6 }) },
  door: { what: "a door: a heavy thump of wood or metal in a concrete room", params: FX([crack(0.35, 3000, 0.02), L("triangle", { freq: 160, pitch: 7, pitchTime: 0.02, hold: 0.01, decay: 0.15, filter: "lowpass", cutoff: 1500, volume: 0.45 }), crunch(900, 300, 0.45, 0.2, 1), thump(70, 0.5, 0.2, 12)], { volume: 0.7, drive: 0.2, reverb: 0.2, room: 0.4, width: 0.35 }) },
  // ---- menus ----
  ui_move: { what: "moving in a menu: a soft tick", params: FX([L("sine", { freq: 1800, fm: 1.5, fmRatio: 3, hold: 0, decay: 0.035, volume: 0.45 }), tick(0.4)], { volume: 0.55, width: 0.4 }) },
  ui_select: { what: "choosing in a menu: two quick plucked notes up", params: FX([L("sine", { freq: 880, fm: 2, fmRatio: 2, fmDecay: 0.03, hold: 0, decay: 0.12, volume: 0.45 }), L("sine", { freq: 1319, start: 0.05, fm: 2, fmRatio: 2, fmDecay: 0.04, hold: 0, decay: 0.2, volume: 0.45 })], { volume: 0.6, reverb: 0.12, room: 0.25, width: 0.3 }) },
};

export const PURPOSE_NAMES = Object.keys(PURPOSES);

/// The settings of a purpose; a seed other than 1 is a variant (a little higher or lower, shorter or longer, other noise).
export function purposeParams(purpose: unknown, seed: unknown): SfxParams {
  const hit = PURPOSES[String(purpose).trim().toLowerCase().replace(/[ -]/g, "_")];
  if (!hit) throw new Error(`unknown purpose '${purpose}'. Purposes: ${PURPOSE_NAMES.map((n) => `${n} (${PURPOSES[n]!.what})`).join("; ")}`);
  const p: SfxParams = { ...hit.params, layers: hit.params.layers?.map((l) => ({ ...l })) };
  const s = seed === undefined || seed === null ? 1 : Math.floor(Number(seed));
  if (!Number.isFinite(s)) throw new Error('"seed" is a whole number');
  if (s !== 1) {
    const rng = rngOf(s);
    // the whole effect a little higher or lower (every layer together, so it stays in tune with itself), a little shorter or longer
    const pitch = 1 + (rng() - 0.5) * 0.14, length = 1 + (rng() - 0.5) * 0.24, bright = 1 + (rng() - 0.5) * 0.2;
    for (const l of p.layers ?? []) {
      l.freq = Math.round(l.freq * pitch * 100) / 100;
      l.decay = Math.round(l.decay * length * 1000) / 1000;
      if (l.filter !== "none") {
        l.cutoff = Math.round(l.cutoff * bright);
        if (l.cutoffEnd > 0) l.cutoffEnd = Math.round(l.cutoffEnd * bright);
      }
    }
    p.seed = s;
  }
  return p;
}
