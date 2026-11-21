// Neon Undertow's sound effects and music, made again with Nova's tools: every effect by `sfx_write` (a purpose, or layers), every
// song by `song_make` in the synthwave moods. Each effect keeps its name, its job and the level the game was balanced at (the
// `level` below is what the old effect measured: LUFS for one of 0.45 s or more, else dB RMS of its loud parts; `loudness`
// finds the volume for it). The files are the truth afterwards; this is how they were made.
//
//   scripts/env.sh node examples/neon-undertow/tools/sounds.mjs [name ...]          (no names: all of them)
//
// The tone (docs/games/neon-undertow.md): punchy, modern, pulpy cyberpunk: neon and wet concrete, not an 8-bit console. So every
// effect is layers (a transient, a body, a tail; FM for metal and bells, ring modulation and crackle for electricity), most get a
// little drive, and they sit in a short concrete room with some stereo width. Why, measured: docs/sound-for-agents.md.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { withServer } from "../../../scripts/rally/mcp.mjs";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ---- the parts (the same ideas as the purposes in studio/mcp/makers/sound.ts) ----
const L = (wave, o = {}) => ({ wave, ...o });
const up = (f, s) => Math.round(f * 2 ** (s / 12) * 100) / 100;
/// a few ms of bright noise: the crack the ear takes as the moment of impact
const crack = (v = 0.5, c = 3500, d = 0.025, start = 0) => L("noise", { filter: "bandpass", cutoff: c * 1.4, q: 0.7, start, hold: 0.004, decay: d, volume: Math.min(1, v * 1.8) });
/// a tone that drops in pitch: a thump (low) or a knock (higher)
const thump = (f, v, d, drop = 24, t = 0.025, start = 0) => L("sine", { freq: f, pitch: drop, pitchTime: t, start, hold: 0.01, decay: d, volume: v });
/// noise through a band-pass that falls: a crunch, a burst
const crunch = (from, to, v, d, q = 1.2, wave = "noise", start = 0) => L(wave, { filter: "bandpass", cutoff: from, cutoffEnd: to, q, start, hold: 0.01, decay: d, volume: v });
/// a bell or chime: a sine with a fading FM partial
const bell = (f, start, v, d, ratio = 3.5, fm = 2.2) => L("sine", { freq: f, start, fm, fmRatio: ratio, fmDecay: d * 0.3, hold: 0.005, decay: d, volume: v });
const tick = (v = 0.3, start = 0) => L("noise", { filter: "bandpass", cutoff: 7000, q: 0.7, start, hold: 0.002, decay: 0.012, volume: v });
/// a detuned saw stab whose filter closes: the synth chord hit of the 80s
const stab = (f, start, v, d, o = {}) => L("saw", { freq: f, start, unison: 3, detune: 14, hold: 0.02, decay: d, filter: "lowpass", cutoff: 5000, cutoffEnd: 700, volume: v, ...o });
/// a rising whoosh of noise
const rush = (from, to, v, attack, d, q = 2, wave = "pink", start = 0) => L(wave, { filter: "bandpass", cutoff: from, cutoffEnd: to, q, start, attack, hold: 0.01, decay: d, volume: v });
/// metal: inharmonic FM partials that ring
const metal = (f, v, d, start = 0, ratio = 1.41, fm = 6) => L("sine", { freq: f, start, fm, fmRatio: ratio, fmDecay: d * 0.35, hold: 0.004, decay: d, volume: v });
/// an electric buzz: a saw ring-modulated, through a filter
const buzz = (f, ring, v, hold, d, o = {}) => L("saw", { freq: f, ring, hold, decay: d, filter: "lowpass", cutoff: 4500, volume: v, ...o });
const sparks = (rate, v, d, start = 0, cutoff = 2500) => L("crackle", { freq: rate, filter: "highpass", cutoff, start, hold: 0.03, decay: d, volume: v });

/// wet concrete: a short room and some width, with a touch of drive (each sound may change them)
const street = (layers, o = {}) => ({ drive: 0.2, reverb: 0.15, room: 0.35, width: 0.4, ...o, layers });
const menu = (layers, o = {}) => ({ reverb: 0.12, room: 0.25, width: 0.3, ...o, layers });

// ---- the effects: name: [made by, the old level] ----
const P = (purpose, seed = 1, params) => ({ purpose, seed, ...(params ? { params } : {}) });
const sounds = {
  // the runner
  swing: [P("sword_swing", 2, { width: 0.5, reverb: 0.08, room: 0.25 }), -22.1],
  hit: [P("hit", 1, { reverb: 0.12, room: 0.3 }), -16.1],
  roll: [{ params: street([rush(500, 2200, 0.6, 0.04, 0.16), L("noise", { filter: "highpass", cutoff: 4000, attack: 0.03, decay: 0.07, volume: 0.15 }), thump(110, 0.25, 0.08, 7, 0.02, 0.18)], { drive: 0, width: 0.6 }) }, -19.9],
  shot: [P("shot", 1, { reverb: 0.15, room: 0.4 }), -15.3],
  empty: [{ params: street([crack(0.4, 4500, 0.012), metal(2300, 0.3, 0.05, 0.004, 2.76, 3), thump(320, 0.2, 0.03, 7, 0.01)], { reverb: 0.1, room: 0.2 }) }, -12],
  hurt: [P("hurt", 1), -13.8],
  scrap: [{ params: street([tick(0.35), metal(1900, 0.25, 0.12, 0, 2.76, 2.5), bell(1320, 0.04, 0.35, 0.2, 3.5, 1.5), bell(1976, 0.09, 0.3, 0.28, 3.5, 1.5)], { drive: 0.45, reverb: 0.15 }) }, -9.8],
  enemy_tell: [P("tell", 1), -16.4],
  enemy_die: [P("enemy_die", 1), -16.4],
  // doors and rooms
  door_shut: [P("door", 1, { reverb: 0.22, room: 0.45 }), -16],
  door_open: [{ params: street([rush(300, 2600, 0.5, 0.06, 0.22, 1.5, "noise"), L("saw", { freq: 110, pitch: -5, pitchTime: 0.15, attack: 0.03, hold: 0.12, decay: 0.12, filter: "lowpass", cutoff: 500, cutoffEnd: 1400, volume: 0.35 }), crack(0.3, 3000, 0.02, 0.24), thump(90, 0.4, 0.12, 12, 0.02, 0.24)]) }, -15.6],
  door_unlock: [{ params: street([crack(0.45, 4000, 0.015), metal(1400, 0.25, 0.1, 0, 2.76, 2), bell(784, 0.08, 0.35, 0.25), bell(1175, 0.16, 0.35, 0.35)], { drive: 0.3 }) }, -10.7],
  wave_warn: [{ params: street([L("square", { freq: 700, hold: 0.1, decay: 0.05, unison: 2, detune: 10, filter: "lowpass", cutoff: 3000, volume: 0.35 }), L("square", { freq: up(700, -5), start: 0.13, hold: 0.1, decay: 0.08, unison: 2, detune: 10, filter: "lowpass", cutoff: 2600, volume: 0.35 }), crack(0.2, 3000, 0.01)], { reverb: 0.2 }) }, -11.3],
  // the Gutter Market's enemies
  tell_thrower: [{ params: street([L("triangle", { freq: 520, pitch: -10, pitchTime: 0.12, vibrato: 0.4, vibratoSpeed: 16, attack: 0.02, hold: 0.2, decay: 0.12, unison: 2, detune: 10, volume: 0.4 }), rush(1200, 4000, 0.25, 0.12, 0.08, 3, "noise")], { drive: 0.1 }) }, -14.1],
  throw: [P("whoosh", 2, { width: 0.6 }), -20.6],
  bottle_smash: [P("glass", 1, { reverb: 0.18, room: 0.4, drive: 0.35 }), -20.2],
  fire_start: [{ params: street([rush(300, 2500, 0.6, 0.12, 0.35, 1.2), sparks(120, 0.35, 0.45, 0.05), thump(80, 0.3, 0.2, 12, 0.03)], { drive: 0.3 }) }, -17.2],
  rev_up: [{ params: street([L("saw", { freq: 70, slide: 2, attack: 0.02, hold: 0.3, decay: 0.1, unison: 3, detune: 20, filter: "lowpass", cutoff: 500, cutoffEnd: 3000, vibrato: 0.3, vibratoSpeed: 22, volume: 0.45 }), L("noise", { filter: "bandpass", cutoff: 400, cutoffEnd: 1800, q: 2, attack: 0.05, hold: 0.25, decay: 0.08, volume: 0.25 })], { drive: 0.5 }) }, -15.8],
  wall_thud: [P("heavy_hit", 2, { reverb: 0.2, room: 0.4 }), -16.7],
  tell_mimic: [{ params: street([sparks(220, 0.45, 0.15, 0, 3000), L("sine", { freq: 1300, pitch: -7, pitchTime: 0.08, vibrato: 0.8, vibratoSpeed: 24, attack: 0.02, hold: 0.25, decay: 0.12, fm: 2, fmRatio: 1.5, volume: 0.25 }), sparks(400, 0.3, 0.12, 0.2, 3500)], { drive: 0.15 }) }, -16.2],
  can_spit: [{ params: street([crack(0.3, 3000, 0.01), L("sine", { freq: 600, pitch: 12, pitchTime: 0.01, slide: -3, hold: 0.02, decay: 0.08, volume: 0.45 }), crunch(2600, 900, 0.35, 0.07)], { drive: 0.25 }) }, -16.3],
  tell_tout: [{ params: street([L("sine", { freq: 660, fm: 1.5, fmRatio: 2, attack: 0.01, hold: 0.09, decay: 0.06, volume: 0.4 }), L("sine", { freq: up(660, 9), start: 0.11, fm: 1.5, fmRatio: 2, attack: 0.01, hold: 0.12, decay: 0.15, volume: 0.4 })], { drive: 0.1, reverb: 0.2 }) }, -13.4],
  tout_off: [{ params: street([crack(0.3), L("sine", { freq: 880, slide: -2.2, fm: 3, fmRatio: 1.5, fmDecay: 0.1, hold: 0.05, decay: 0.3, volume: 0.45 }), crunch(1800, 400, 0.3, 0.2)]) }, -14.1],
  card_rise: [{ params: street([...[0, 4, 7, 12].map((s, i) => bell(up(392, s), i * 0.1, 0.3, 0.45, 3)), rush(2000, 6000, 0.12, 0.25, 0.2, 1.5, "noise")], { drive: 0, reverb: 0.25, room: 0.45, width: 0.6 }) }, -15.4],
  card_take: [P("pickup", 2, { drive: 0.3 }), -9.9],
  zap: [P("zap", 1), -19.3],
  ricochet: [{ params: street([crack(0.4, 4500, 0.012), L("sine", { freq: 2600, pitch: 5, pitchTime: 0.02, slide: -1.2, fm: 2, fmRatio: 2.76, fmDecay: 0.06, hold: 0.01, decay: 0.15, volume: 0.35 })], { drive: 0.1, width: 0.6 }) }, -19.7],
  stun: [{ params: street([buzz(180, 900, 0.45, 0.04, 0.15), sparks(500, 0.35, 0.18), L("triangle", { freq: 300, slide: -1.5, hold: 0.03, decay: 0.2, volume: 0.3 })]) }, -17.6],
  // slice 3a: the market's streets
  blast: [P("explosion", 1), -15.7],
  tram_bell: [{ params: street([tick(0.3), metal(1320, 0.45, 0.45, 0, 2.4, 2.5), metal(up(1320, -5), 0.45, 0.6, 0.16, 2.4, 2.5)], { drive: 0, reverb: 0.25, room: 0.5 }) }, -11.6],
  tram_pass: [{ params: street([L("pink", { filter: "bandpass", cutoff: 500, cutoffEnd: 1600, q: 0.8, filterTime: 0.8, attack: 0.6, hold: 0.2, decay: 0.8, volume: 0.6 }), L("saw", { freq: 110, pitch: 2, pitchTime: 0.7, slide: -0.3, attack: 0.5, hold: 0.25, decay: 0.7, unison: 2, detune: 12, filter: "lowpass", cutoff: 400, volume: 0.25 }), sparks(18, 0.25, 0.4, 0.55, 2000), L("noise", { filter: "bandpass", cutoff: 3500, q: 4, attack: 0.5, hold: 0.2, decay: 0.4, volume: 0.08 })], { drive: 0.15, width: 0.7 }) }, -14.9],
  sign_drop: [{ params: street([crack(0.5, 3000, 0.03), thump(70, 0.6, 0.2, 19, 0.03), L("noise", { filter: "highpass", cutoff: 3000, cutoffEnd: 6000, hold: 0.01, decay: 0.25, volume: 0.35 }), sparks(350, 0.3, 0.3, 0.01, 4000), buzz(120, 600, 0.2, 0.05, 0.2)], { drive: 0.3 }) }, -13.9],
  buy: [P("coin", 2), -10.2],
  // slice 3b: Mother Coil, the Den, the Workbench
  tell_lanes: [{ params: street([L("saw", { freq: 240, pitch: -12, pitchTime: 0.25, attack: 0.04, hold: 0.45, decay: 0.15, unison: 3, detune: 16, filter: "lowpass", cutoff: 600, cutoffEnd: 3500, filterTime: 0.5, vibrato: 0.2, vibratoSpeed: 12, volume: 0.4 }), rush(400, 3000, 0.25, 0.4, 0.15, 3, "noise")], { drive: 0.25 }) }, -12.8],
  junk_drag: [{ params: street([L("noise", { filter: "bandpass", cutoff: 1300, cutoffEnd: 900, q: 1.5, attack: 0.04, hold: 0.7, decay: 0.2, vibrato: 0, volume: 0.45 }), sparks(70, 0.35, 0.2, 0.02, 1800), metal(620, 0.12, 0.6, 0.05, 1.37, 3), thump(90, 0.3, 0.15, 7, 0.02)], { drive: 0.25 }) }, -21],
  tell_car: [{ params: street([L("saw", { freq: 311, attack: 0.02, hold: 0.55, decay: 0.2, unison: 2, detune: 12, filter: "lowpass", cutoff: 2400, volume: 0.32 }), L("saw", { freq: 392, attack: 0.02, hold: 0.55, decay: 0.2, unison: 2, detune: 12, filter: "lowpass", cutoff: 2400, volume: 0.32 }), L("sine", { freq: 1500, slide: -0.7, attack: 0.3, hold: 0.3, decay: 0.15, volume: 0.15 })], { drive: 0.35, reverb: 0.2, room: 0.5 }) }, -9.8],
  car_slam: [{ params: street([crack(0.6, 3000, 0.03), thump(55, 0.75, 0.4, 24, 0.035), metal(340, 0.35, 0.5, 0.005, 1.41, 7), crunch(1800, 300, 0.5, 0.3, 1.1), L("noise", { filter: "highpass", cutoff: 3500, start: 0.01, hold: 0.01, decay: 0.2, volume: 0.25 })], { drive: 0.45, reverb: 0.2, room: 0.45, width: 0.5 }) }, -16.5],
  tell_magnet: [{ params: street([buzz(105, 140, 0.5, 0.55, 0.25, { vibrato: 0.6, vibratoSpeed: 9, cutoff: 1800, unison: 2, detune: 8, attack: 0.05 }), L("sine", { freq: 420, slide: -0.4, vibrato: 0.6, vibratoSpeed: 9, attack: 0.05, hold: 0.5, decay: 0.25, volume: 0.3 })], { drive: 0.35 }) }, -7.7],
  magnet_slam: [{ params: street([crack(0.6, 3000, 0.03), thump(58, 0.75, 0.38, 24, 0.035), buzz(110, 70, 0.35, 0.05, 0.3, { cutoff: 2500 }), crunch(1600, 250, 0.45, 0.3, 1), metal(520, 0.2, 0.35, 0.005)], { drive: 0.45, reverb: 0.2, room: 0.45, width: 0.5 }) }, -16.3],
  drum_open: [{ params: street([crack(0.3, 3000, 0.02), metal(440, 0.25, 0.5, 0, 1.41, 4), ...[0, 7, 12].map((s, i) => bell(up(880, s), 0.06 + i * 0.12, 0.3, 0.6, 3)), L("saw", { freq: 220, unison: 3, detune: 16, attack: 0.15, hold: 0.3, decay: 0.45, filter: "lowpass", cutoff: 700, cutoffEnd: 3500, volume: 0.2 })], { drive: 0, reverb: 0.3, room: 0.55, width: 0.6 }) }, -8.5],
  drum_clang: [{ params: street([crack(0.35, 3000, 0.015), metal(900, 0.4, 0.17, 0, 1.41, 5), metal(1730, 0.2, 0.12, 0, 2.76, 3)], { drive: 0.15 }) }, -17.8],
  stripes_on: [P("laser", 2, { drive: 0.2 }), -15.2],
  boss_burst: [P("explosion", 3), -16.7],
  boss_die: [{ params: street([crack(0.6, 2500, 0.05), thump(48, 0.7, 1.2, 24, 0.08), L("pink", { filter: "lowpass", cutoff: 5000, cutoffEnd: 200, filterTime: 1, hold: 0.1, decay: 1.5, volume: 0.65 }), L("saw", { freq: 330, slide: -1.2, hold: 0.15, decay: 1.2, unison: 3, detune: 24, filter: "lowpass", cutoff: 3000, cutoffEnd: 200, volume: 0.25 }), sparks(40, 0.35, 1, 0.08, 2000), L("crackle", { freq: 20, filter: "bandpass", cutoff: 1500, start: 0.3, hold: 0.1, decay: 0.8, volume: 0.3 })], { drive: 0.5, reverb: 0.3, room: 0.7, width: 0.7 }) }, -16.9],
  boss_bark: [{ params: street([buzz(150, 75, 0.6, 0.05, 0.05, { cutoff: 2000, unison: 2, detune: 15 }), crunch(1200, 600, 0.3, 0.06, 2)], { drive: 0.5, reverb: 0.1 }) }, -10],
  // slice 4: sets, jinxes and the new cards
  set_done: [{ params: street([crack(0.3, 4000, 0.015), ...[0, 4, 7, 12, 16].map((s, i) => bell(up(523, s), i * 0.08, 0.3, 0.55, 3)), stab(262, 0.32, 0.3, 0.6, { cutoffEnd: 1500 }), stab(392, 0.32, 0.22, 0.6, { cutoffEnd: 1500 })], { drive: 0.1, reverb: 0.3, room: 0.5, width: 0.6 }) }, -6.9],
  jinx_take: [{ params: street([L("saw", { freq: 220, slide: -0.6, vibrato: 0.7, vibratoSpeed: 7, attack: 0.02, hold: 0.2, decay: 0.4, unison: 3, detune: 25, ring: 55, filter: "lowpass", cutoff: 1800, cutoffEnd: 400, volume: 0.45 }), L("pink", { filter: "bandpass", cutoff: 600, cutoffEnd: 200, q: 2, attack: 0.05, hold: 0.1, decay: 0.4, volume: 0.25 })], { drive: 0.3, reverb: 0.3, room: 0.6 }) }, -13.5],
  brownout: [{ params: street([L("saw", { freq: 900, slide: -1.6, hold: 0.25, decay: 0.45, unison: 3, detune: 18, filter: "lowpass", cutoff: 4000, cutoffEnd: 200, volume: 0.4 }), buzz(120, 60, 0.3, 0.2, 0.4, { slide: -1, cutoff: 1500 }), sparks(80, 0.3, 0.35, 0.05, 1500), thump(60, 0.4, 0.3, 12, 0.05)], { drive: 0.35, reverb: 0.2, room: 0.5 }) }, -14.4],
  phase_slow: [{ params: street([L("sine", { freq: 700, slide: -1.1, vibrato: 0.5, vibratoSpeed: 3, ring: 37, attack: 0.03, hold: 0.3, decay: 0.6, volume: 0.45 }), L("saw", { freq: 175, slide: -1.1, unison: 4, detune: 30, attack: 0.05, hold: 0.3, decay: 0.6, filter: "lowpass", cutoff: 1500, cutoffEnd: 300, volume: 0.25 })], { drive: 0, reverb: 0.4, room: 0.8, width: 0.7 }) }, -13.7],
  slug_ready: [{ params: street([crack(0.35, 4000, 0.01), metal(2000, 0.2, 0.05, 0, 2.76, 2), L("square", { freq: 1200, start: 0.04, hold: 0.02, decay: 0.06, unison: 2, detune: 8, filter: "lowpass", cutoff: 5000, volume: 0.25 }), L("square", { freq: up(1200, 7), start: 0.07, hold: 0.02, decay: 0.08, unison: 2, detune: 8, filter: "lowpass", cutoff: 5000, volume: 0.25 })], { drive: 0.1, reverb: 0.1 }) }, -11.8],
  ally_rise: [P("powerup", 2), -14.1],
  key_pay: [P("coin", 3), -11.4],
  bounty_pay: [{ params: street([tick(0.35), ...[0, 5, 9, 14].map((s, i) => bell(up(660, s), i * 0.06, 0.32, 0.35, 2, 1.5)), metal(2600, 0.1, 0.2, 0.02, 2.76, 2)], { drive: 0, reverb: 0.2 }) }, -9.5],
  printed: [{ params: street([sparks(300, 0.3, 0.2, 0, 3000), L("saw", { freq: 315, slide: 1.2, hold: 0.2, decay: 0.15, unison: 2, detune: 10, filter: "lowpass", cutoff: 900, cutoffEnd: 4000, volume: 0.25 }), bell(1568, 0.25, 0.35, 0.35, 3)], { drive: 0.1 }) }, -10.7],
  lullaby_blip: [{ params: menu([L("sine", { freq: 620, fm: 2, fmRatio: 2, fmDecay: 0.02, hold: 0.01, decay: 0.06, volume: 0.45 }), tick(0.2)]) }, -12.9],
  menu_move: [P("ui_move", 1, { drive: 0.5 }), -13.6],
  menu_select: [P("ui_select", 1), -12.2],
  move_in: [{ params: street([...[0, 4, 7, 12].map((s, i) => bell(up(523, s), i * 0.11, 0.3, 0.45, 2, 1.5)), L("saw", { freq: 262, unison: 3, detune: 14, attack: 0.1, hold: 0.25, decay: 0.3, filter: "lowpass", cutoff: 900, cutoffEnd: 2500, volume: 0.18 })], { drive: 0, reverb: 0.25, room: 0.45, width: 0.6 }) }, -10.7],
  revive: [{ params: street([thump(80, 0.3, 0.2, 12, 0.03), L("saw", { freq: 331, slide: 1.2, unison: 3, detune: 16, attack: 0.02, hold: 0.25, decay: 0.2, filter: "lowpass", cutoff: 700, cutoffEnd: 5000, volume: 0.35 }), bell(1325, 0.25, 0.3, 0.3, 3.5, 2)], { drive: 0.1, reverb: 0.25 }) }, -10.7],
  reroll: [{ params: street([rush(800, 3500, 0.4, 0.03, 0.06, 2, "noise"), rush(800, 3500, 0.4, 0.03, 0.06, 2, "noise", 0.1), tick(0.3, 0.2), bell(700, 0.2, 0.3, 0.15, 2, 1.5)], { drive: 0.5, width: 0.6 }) }, -10.3],
  wreck_break: [{ params: street([crack(0.6, 3000, 0.03), thump(75, 0.5, 0.25, 19, 0.03), metal(610, 0.3, 0.3, 0.005, 1.41, 7), crunch(2600, 500, 0.45, 0.25), sparks(150, 0.25, 0.2, 0.02, 3500)], { drive: 0.4 }) }, -17],
  // the banners (big words across the screen)
  banner_room: [{ params: menu([stab(660, 0, 0.35, 0.1, { cutoffEnd: 1500 }), stab(up(660, 7), 0.05, 0.35, 0.12, { cutoffEnd: 1500 }), tick(0.2)], { drive: 0.1 }) }, -13.9],
  banner_go: [{ params: street([crack(0.3, 4000, 0.015), ...[0, 4, 7, 12].map((s, i) => stab(up(392, s), i * 0.07, 0.3, 0.2, { cutoffEnd: 1500 })), stab(up(392, 16), 0.28, 0.35, 0.35)], { drive: 0.25, reverb: 0.25, room: 0.5, width: 0.6 }) }, -10.7],
  banner_clear: [{ params: street([...[0, 7, 12].map((s, i) => bell(up(523, s), i * 0.08, 0.35, 0.4, 3)), stab(262, 0.16, 0.25, 0.4)], { drive: 0, reverb: 0.25, room: 0.5, width: 0.6 }) }, -11],
  banner_win: [{ params: street([crack(0.3, 4000, 0.015), ...[0, 4, 7, 12, 16].map((s, i) => stab(up(330, s), i * 0.1, 0.28, 0.25, { cutoffEnd: 1500 })), stab(up(330, 19), 0.5, 0.35, 0.55), bell(up(1320, 7), 0.5, 0.2, 0.5)], { drive: 0.2, reverb: 0.3, room: 0.55, width: 0.6 }) }, -10.7],
  banner_elite: [{ params: street([crack(0.45, 3000, 0.02), thump(60, 0.5, 0.3, 19, 0.03), stab(210, 0, 0.45, 0.45, { slide: -0.8, unison: 3, detune: 22, cutoff: 3500, cutoffEnd: 300 }), buzz(105, 53, 0.2, 0.1, 0.3)], { drive: 0.4, reverb: 0.2, room: 0.5 }) }, -15.8],
  banner_boss: [{ params: street([crack(0.5, 2500, 0.04), thump(62, 0.5, 0.8, 24, 0.06), stab(110, 0.02, 0.4, 0.9, { unison: 4, detune: 25, cutoff: 2500, cutoffEnd: 150, slide: -0.3 }), L("pink", { filter: "lowpass", cutoff: 3000, cutoffEnd: 200, hold: 0.05, decay: 0.9, volume: 0.4 })], { drive: 0.45, reverb: 0.3, room: 0.7, width: 0.6 }) }, -17.6],
  banner_death: [P("death", 1), -17],
  wipe: [P("whoosh", 3, { width: 0.7 }), -19.6],
};

// ---- the music: the owner's choice, driving synthwave (fast bright arpeggios, big gated drums, detuned saw bass and lead that pump
// with the kick). Each keeps its old name and loudness (`lufs`, the master's loudness target).
const songs = {
  undertow: { mood: "synthwave", key: "A minor", tempo: 118, seed: 1, lufs: -16.3 },       // the Gutter Market's fights
  mother_coil: { mood: "synthwave", key: "A minor", tempo: 140, seed: 1, lufs: -15.2 },    // the boss: the fight's theme, faster and harder
  den: { mood: "synthwave night", key: "D minor", tempo: 92, seed: 1, lufs: -17.1 },       // the hub
};

const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));
await withServer(async (nova) => {
  for (const [name, [made, level]] of Object.entries(sounds)) {
    if (only.length && !only.includes(name)) continue;
    const said = await nova.call("sfx_write", { name, ...made, loudness: level });
    const flags = said.split("\n").filter((l) => /WARNING|NOTE|toy-like/.test(l));
    console.log(`${name}: ${said.split("\n")[0]}${flags.length ? `\n  ${flags.join("\n  ")}` : ""}`);
  }
  for (const [name, s] of Object.entries(songs)) {
    if (only.length && !only.includes(name)) continue;
    await nova.call("song_make", { name, mood: s.mood, key: s.key, tempo: s.tempo, seed: s.seed });
    const song = JSON.parse(readFileSync(join(project, "music", `${name}.song.json`), "utf8"));
    song.master = { ...song.master, lufs: s.lufs };
    console.log(`${name}: ${(await nova.call("song_write", { name, song })).split("\n")[0]}`);
  }
}, project);
