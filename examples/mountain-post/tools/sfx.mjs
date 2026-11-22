// Every effect, voice and bed of sound in Fernhollow, made in layers with sfx_write (a transient, a body, a tail; a room; width) and
// checked with sound_report until it gives no warning and no "thin" or "toy-like" advice. Groups (sounds/<name>.group.json) give the
// repeated ones a few takes. Run: scripts/env.sh node examples/mountain-post/tools/sfx.mjs [name ...]
import { put, tool } from "./lib.mjs";

const want = process.argv.slice(2);
const made = [];
// the moment of contact: 10 ms of bright noise in front of a sound (`hit: level` on an effect adds it)
const T = (v = 0.5, cut = 3800) => ({ wave: "noise", filter: "highpass", cutoff: cut, hold: 0, decay: 0.01, volume: v });
// a knock a small speaker plays: a triangle at 170 to 260 Hz falling from an octave and a half up, through a low-pass
const K = (f, v, decay = 0.12, start = 0) => ({ wave: "triangle", freq: f, pitch: 14, pitchTime: 0.02, start, hold: 0.004, decay, filter: "lowpass", cutoff: 1500, volume: v });
const sfx = (name, params, extra = {}) => {
  if (want.length && !want.some((w) => name.startsWith(w))) return;
  if (params.hit) { params = { ...params, layers: [T(params.hit), ...params.layers] }; delete params.hit; }
  const out = tool("sfx_write", { name, params, ...extra }, { quiet: true });
  const warn = out.split("\n").filter((l) => /WARNING|advice/i.test(l));
  console.log(`${name}: ${warn.length ? warn.join(" | ") : "clean"}`);
  made.push(name);
};
const group = (name, sounds, o = {}) => put(`sounds/${name}.group.json`, `${JSON.stringify({ sounds, volume: o.volume ?? [0.85, 1], pitch: o.pitch ?? [0.95, 1.05], no_repeat: true })}\n`);

// ---- footsteps: grass (soft), gravel (crunch), tarmac (a scuff), wood (the porch, the bridge, the office floor) ------------------------
for (let i = 1; i <= 3; i++) {
  // (each has a short crack in front, a body of filtered noise that comes up just after it, and a small knock of weight)
  sfx(`step_grass${i}`, { volume: 0.7, width: 0.3, reverb: 0.05, hit: 0.4, layers: [
    { wave: "pink", filter: "bandpass", cutoff: 1500 - i * 120, cutoffEnd: 600, q: 0.8, attack: 0.012, hold: 0.02, decay: 0.12, volume: 0.6 },
    { wave: "noise", filter: "bandpass", cutoff: 3000 + i * 300, q: 0.9, attack: 0.012, hold: 0.01, decay: 0.06, volume: 0.25 },
    K(150 + i * 10, 0.45, 0.09), { wave: "sine", freq: 85, hold: 0.004, decay: 0.08, volume: 0.25 },
  ] });
  sfx(`step_gravel${i}`, { volume: 0.75, width: 0.35, reverb: 0.05, hit: 0.45, layers: [
    { wave: "crackle", freq: 900 + i * 150, filter: "bandpass", cutoff: 3400, q: 0.8, attack: 0.012, hold: 0.03, decay: 0.12, volume: 0.55 },
    { wave: "noise", filter: "bandpass", cutoff: 2400 + i * 200, cutoffEnd: 1200, q: 1.1, attack: 0.012, hold: 0.02, decay: 0.13, volume: 0.4 },
    K(165 + i * 12, 0.45, 0.08), { wave: "sine", freq: 90, hold: 0.004, decay: 0.08, volume: 0.25 },
  ] });
  sfx(`step_road${i}`, { volume: 0.7, width: 0.25, reverb: 0.06, hit: 0.5, layers: [
    { wave: "noise", filter: "bandpass", cutoff: 1500 + i * 120, q: 1.4, attack: 0.01, hold: 0.008, decay: 0.07, volume: 0.45 },
    K(185 + i * 15, 0.5, 0.07), { wave: "sine", freq: 95, hold: 0.004, decay: 0.07, volume: 0.25 },
  ] });
  sfx(`step_wood${i}`, { volume: 0.75, width: 0.25, reverb: 0.12, room: 0.25, hit: 0.4, layers: [
    { wave: "noise", filter: "bandpass", cutoff: 2600, cutoffEnd: 700, q: 1.2, attack: 0.01, hold: 0.004, decay: 0.09, volume: 0.4 },
    K(225 + i * 18, 0.6, 0.12), { wave: "sine", freq: 470 + i * 30, hold: 0.002, decay: 0.06, volume: 0.2 },
  ] });
}
for (const s of ["grass", "gravel", "road", "wood"]) group(`step_${s}`, [1, 2, 3].map((i) => `step_${s}${i}`));

// ---- the babble voices: a syllable each, shaped differently (Hazel low, round and slow; Pip high, bright and quick) --------------------
// A voiced buzz through a vowel-like band, a breath of noise on its front, and a pitch that moves inside the syllable.
const vowels = [[700, 1150], [500, 1500], [400, 2000], [600, 900], [300, 2300]];
vowels.forEach(([f1, f2], i) => {
  // (a consonant first: a puff of breath noise, then the voiced vowel through two moving formants, with a breathy layer under it)
  sfx(`voice_hazel${i + 1}`, { volume: 1.2, width: 0.35, reverb: 0.06, layers: [
    { wave: "noise", filter: "bandpass", cutoff: 3200 + i * 300, q: 1.2, hold: 0, decay: 0.014, volume: 0.42 },
    { wave: "saw", freq: 118 + i * 9, pitch: i % 2 ? -3 : 3, pitchTime: 0.06, attack: 0.014, hold: 0.05, decay: 0.09, filter: "bandpass", cutoff: Math.max(f1, 520) * 0.9, cutoffEnd: Math.max(f1, 520) * 0.75, q: 2.2, volume: 0.7 },
    { wave: "saw", freq: 118 + i * 9, pitch: i % 2 ? -3 : 3, pitchTime: 0.06, attack: 0.014, hold: 0.05, decay: 0.09, filter: "bandpass", cutoff: f2 * 0.85, cutoffEnd: f2 * 0.7, q: 3, volume: 0.35 },
    { wave: "pink", filter: "bandpass", cutoff: Math.max(f1, 520) * 1.6, q: 1.2, attack: 0.014, hold: 0.04, decay: 0.08, volume: 0.32 },
  ] });
  sfx(`voice_pip${i + 1}`, { volume: 1.1, width: 0.35, reverb: 0.05, layers: [
    { wave: "noise", filter: "highpass", cutoff: 4200, hold: 0, decay: 0.01, volume: 0.4 },
    { wave: "triangle", freq: 330 + i * 22, pitch: i % 2 ? 4 : -3, pitchTime: 0.03, attack: 0.008, hold: 0.025, decay: 0.05, filter: "bandpass", cutoff: f1 * 1.5, cutoffEnd: f1 * 1.9, q: 2, volume: 0.55 },
    { wave: "saw", freq: 330 + i * 22, pitch: i % 2 ? 4 : -3, pitchTime: 0.03, attack: 0.008, hold: 0.025, decay: 0.05, filter: "bandpass", cutoff: f2 * 1.35, cutoffEnd: f2 * 1.1, q: 3, volume: 0.35 },
    { wave: "pink", filter: "bandpass", cutoff: f2, q: 1.2, attack: 0.008, hold: 0.02, decay: 0.05, volume: 0.32 },
  ] });
});
group("voice_hazel", [1, 2, 3, 4, 5].map((i) => `voice_hazel${i}`), { pitch: [0.94, 1.04] });
group("voice_pip", [1, 2, 3, 4, 5].map((i) => `voice_pip${i}`), { pitch: [0.96, 1.1] });

// ---- paper and the post office -------------------------------------------------------------------------------------------------------
sfx("paper", { volume: 0.9, width: 0.5, reverb: 0.08, hit: 0.35, layers: [
  { wave: "crackle", freq: 600, filter: "bandpass", cutoff: 4200, q: 0.8, attack: 0.02, hold: 0.12, decay: 0.32, volume: 0.45 }, K(210, 0.18, 0.08),
  { wave: "pink", filter: "bandpass", cutoff: 3000, cutoffEnd: 1800, q: 0.7, attack: 0.03, hold: 0.1, decay: 0.2, volume: 0.55 },
  { wave: "noise", filter: "highpass", cutoff: 5000, attack: 0.005, hold: 0.02, decay: 0.06, volume: 0.25 },
] });
sfx("page", { volume: 0.8, width: 0.4, hit: 0.35, layers: [
  { wave: "noise", filter: "bandpass", cutoff: 3800, cutoffEnd: 2200, q: 0.9, attack: 0.01, hold: 0.03, decay: 0.1, volume: 0.6 },
  { wave: "crackle", freq: 400, filter: "highpass", cutoff: 3000, hold: 0.04, decay: 0.08, volume: 0.3 },
] });
sfx("tick", { volume: 0.6, width: 0.2, hit: 0.45, layers: [ { wave: "noise", filter: "bandpass", cutoff: 2500, cutoffEnd: 900, q: 1.2, attack: 0.006, decay: 0.05, volume: 0.25 },
  { wave: "noise", filter: "bandpass", cutoff: 4000, q: 2, hold: 0.002, decay: 0.02, volume: 0.4 },
  { wave: "triangle", freq: 1250, hold: 0.004, decay: 0.05, volume: 0.45 },
] });
sfx("bell", { volume: 0.7, width: 0.4, reverb: 0.3, room: 0.4, layers: [ { wave: "noise", filter: "bandpass", cutoff: 7000, cutoffEnd: 1500, filterTime: 0.15, q: 2, hold: 0.002, decay: 0.2, volume: 0.2 }, { wave: "sine", freq: 1318, pitch: 12, pitchTime: 0.004, hold: 0, decay: 0.05, volume: 0.15 },
  { wave: "sine", freq: 1318, fm: 2.4, fmRatio: 2.76, fmDecay: 0.4, hold: 0.004, decay: 1.6, volume: 0.6 },
  { wave: "sine", freq: 2636, hold: 0.002, decay: 0.6, volume: 0.2 },
  { wave: "noise", filter: "highpass", cutoff: 6000, hold: 0.002, decay: 0.015, volume: 0.25 },
] });
sfx("door", { volume: 0.9, width: 0.3, reverb: 0.15, room: 0.3, hit: 0.4, layers: [ { wave: "noise", filter: "bandpass", cutoff: 2400, cutoffEnd: 600, q: 1.2, attack: 0.008, hold: 0.01, decay: 0.25, volume: 0.35 },
  { wave: "noise", filter: "bandpass", cutoff: 3000, q: 1.5, hold: 0.004, decay: 0.03, volume: 0.35 },
  K(185, 0.6, 0.3),
  { wave: "saw", freq: 420, start: 0.0, attack: 0.08, hold: 0.15, decay: 0.12, filter: "bandpass", cutoff: 1300, q: 5, vibrato: 0.6, vibratoSpeed: 9, volume: 0.12 },
  { wave: "pink", filter: "bandpass", cutoff: 900, q: 0.9, hold: 0.03, decay: 0.35, volume: 0.35 },
] });
sfx("parcel_up", { volume: 0.85, width: 0.35, reverb: 0.06, hit: 0.3, layers: [
  { wave: "pink", filter: "bandpass", cutoff: 1800, cutoffEnd: 2600, q: 0.8, attack: 0.02, hold: 0.06, decay: 0.12, volume: 0.6 },
  { wave: "crackle", freq: 300, filter: "highpass", cutoff: 2500, hold: 0.06, decay: 0.08, volume: 0.25 },
  K(205, 0.3, 0.1), { wave: "pink", filter: "bandpass", cutoff: 900, q: 0.8, attack: 0.02, hold: 0.04, decay: 0.3, volume: 0.25 },
] });
sfx("parcel_down", { volume: 0.9, width: 0.3, reverb: 0.06, drive: 0.15, hit: 0.35, layers: [
  { wave: "noise", filter: "bandpass", cutoff: 2400, q: 1, hold: 0.003, decay: 0.03, volume: 0.35 },
  K(195, 0.6, 0.14), { wave: "sine", freq: 95, hold: 0.01, decay: 0.12, volume: 0.2 },
  { wave: "pink", filter: "bandpass", cutoff: 1100, cutoffEnd: 600, q: 0.8, hold: 0.02, decay: 0.12, volume: 0.45 },
] });
sfx("knock", { volume: 0.95, width: 0.2, reverb: 0.15, room: 0.3, layers: [0, 0.19, 0.34].flatMap((t) => [
  { wave: "noise", filter: "bandpass", cutoff: 2400, q: 1.5, start: t, hold: 0.002, decay: 0.02, volume: 0.35 },
  { wave: "triangle", freq: 190, pitch: 7, pitchTime: 0.012, start: t, hold: 0.004, decay: 0.1, volume: 0.55 },
]).slice(0, 6) });

// ---- the van -------------------------------------------------------------------------------------------------------------------------
sfx("horn", { volume: 0.8, drive: 0.25, width: 0.3, reverb: 0.12, room: 0.4, hit: 0.2, layers: [ { wave: "noise", filter: "bandpass", cutoff: 1900, q: 1.4, attack: 0.012, hold: 0.32, decay: 0.08, volume: 0.07 },
  // a cheerful two-note horn: a small van's, a major third, bright and a little nasal
  { wave: "square", duty: 0.4, freq: 415, attack: 0.012, hold: 0.32, decay: 0.08, filter: "lowpass", cutoff: 2600, unison: 2, detune: 8, volume: 0.45 },
  { wave: "square", duty: 0.4, freq: 523, attack: 0.012, hold: 0.32, decay: 0.08, filter: "lowpass", cutoff: 2600, unison: 2, detune: 8, volume: 0.4 },
  { wave: "saw", freq: 830, attack: 0.012, hold: 0.32, decay: 0.08, filter: "bandpass", cutoff: 1900, q: 2, volume: 0.15 },
] });
sfx("van_door", { volume: 0.95, width: 0.3, reverb: 0.1, drive: 0.2, hit: 0.35, layers: [
  { wave: "noise", filter: "bandpass", cutoff: 3200, q: 1.6, hold: 0.003, decay: 0.03, volume: 0.45 },
  K(175, 0.65, 0.25), { wave: "sine", freq: 85, hold: 0.01, decay: 0.2, volume: 0.2 },
  { wave: "sine", freq: 880, fm: 1.5, fmRatio: 2.76, fmDecay: 0.1, start: 0.01, hold: 0.002, decay: 0.12, volume: 0.12 },
  { wave: "pink", filter: "bandpass", cutoff: 900, q: 0.9, hold: 0.02, decay: 0.2, volume: 0.4 },
] });
sfx("van_back", { volume: 0.9, width: 0.3, reverb: 0.1, layers: [
  { wave: "noise", filter: "bandpass", cutoff: 3500, q: 2, hold: 0.002, decay: 0.02, volume: 0.4 },
  { wave: "sine", freq: 1200, fm: 1.2, fmRatio: 3.1, hold: 0.002, decay: 0.07, volume: 0.15 },
  { wave: "saw", freq: 300, attack: 0.05, hold: 0.18, decay: 0.12, filter: "bandpass", cutoff: 1100, q: 6, vibrato: 0.8, vibratoSpeed: 11, pitch: 3, pitchTime: 0.2, volume: 0.12 },
  { wave: "pink", filter: "bandpass", cutoff: 1500, q: 0.8, attack: 0.03, hold: 0.1, decay: 0.15, volume: 0.25 },
] });
sfx("van_back_shut", { volume: 0.95, width: 0.3, reverb: 0.1, drive: 0.2, layers: [
  { wave: "noise", filter: "bandpass", cutoff: 3000, q: 1.4, hold: 0.003, decay: 0.03, volume: 0.45 },
  K(205, 0.65, 0.28), { wave: "sine", freq: 80, hold: 0.01, decay: 0.2, volume: 0.1 },
  { wave: "pink", filter: "bandpass", cutoff: 850, q: 0.9, hold: 0.02, decay: 0.22, volume: 0.4 },
] });
sfx("engine_start", { volume: 0.8, drive: 0.2, width: 0.2, layers: [
  // the starter's whirr, then the engine catching
  { wave: "saw", freq: 160, attack: 0.02, hold: 0.42, decay: 0.05, vibrato: 2, vibratoSpeed: 14, filter: "lowpass", cutoff: 1400, volume: 0.35 },
  { wave: "noise", filter: "bandpass", cutoff: 1600, q: 1, attack: 0.02, hold: 0.42, decay: 0.05, volume: 0.2 },
  { wave: "saw", freq: 140, start: 0.45, pitch: 12, pitchTime: 0.12, attack: 0.01, hold: 0.15, decay: 0.3, filter: "lowpass", cutoff: 700, volume: 0.45 },
  { wave: "noise", filter: "bandpass", cutoff: 900, q: 0.8, start: 0.45, hold: 0.1, decay: 0.3, volume: 0.35 },
] });
sfx("engine_off", { volume: 0.7, width: 0.2, hit: 0.2, layers: [ { wave: "noise", filter: "bandpass", cutoff: 1800, cutoffEnd: 500, q: 1, attack: 0.008, hold: 0.04, decay: 0.3, volume: 0.25 },
  { wave: "saw", freq: 185, pitch: 5, pitchTime: 0.1, hold: 0.05, decay: 0.35, volume: 0.4, filter: "lowpass", cutoff: 900 },
  { wave: "pink", filter: "bandpass", cutoff: 900, q: 0.8, hold: 0.05, decay: 0.3, volume: 0.35 },
  { wave: "noise", filter: "bandpass", cutoff: 2200, q: 2, start: 0.2, hold: 0.002, decay: 0.03, volume: 0.15 },
] });

// ---- at the houses: Hazel's saw, Pip's tinkering ---------------------------------------------------------------------------------------
for (let i = 1; i <= 2; i++) {
  sfx(`saw${i}`, { volume: 0.9, width: 0.3, reverb: 0.12, room: 0.5, hit: 0.25, layers: [ K(170, 0.25, 0.2, 0.02),
    // one stroke of a hand saw: a rasp of teeth (dense clicks through a band that rises with the push), the plank's woody ring under it
    { wave: "crackle", freq: i === 1 ? 260 : 220, filter: "bandpass", cutoff: i === 1 ? 2600 : 3000, cutoffEnd: i === 1 ? 3400 : 2400, q: 1.6, attack: 0.06, hold: 0.22, decay: 0.12, volume: 0.65 },
    { wave: "noise", filter: "bandpass", cutoff: i === 1 ? 2900 : 3300, q: 2.4, attack: 0.07, hold: 0.2, decay: 0.12, volume: 0.35 },
    { wave: "triangle", freq: i === 1 ? 210 : 190, attack: 0.05, hold: 0.2, decay: 0.15, vibrato: 0.3, vibratoSpeed: 30, volume: 0.15 },
  ] });
}
group("saw", ["saw1", "saw2"], { pitch: [0.97, 1.03] });
for (let i = 1; i <= 3; i++) {
  sfx(`tinker${i}`, { volume: 0.8, width: 0.4, reverb: 0.1, hit: 0.4, layers: [
    { wave: "sine", freq: 1400 + i * 260, fm: 2, fmRatio: 2.76, fmDecay: 0.05, hold: 0.002, decay: 0.12, volume: 0.35 },
    { wave: "noise", filter: "bandpass", cutoff: 4200, q: 2, hold: 0.002, decay: 0.02, volume: 0.3 },
    { wave: "triangle", freq: 420 + i * 40, start: 0.09, hold: 0.002, decay: 0.06, volume: 0.25 },
  ] });
}
group("tinker", ["tinker1", "tinker2", "tinker3"]);

// ---- birds: two calls, short and sweet --------------------------------------------------------------------------------------------------
sfx("bird_a", { volume: 0.6, width: 0.3, reverb: 0.25, room: 0.6, layers: [
  { wave: "sine", freq: 3200, pitch: -5, pitchTime: 0.05, attack: 0.005, hold: 0.04, decay: 0.05, vibrato: 1.5, vibratoSpeed: 28, volume: 0.6 },
  { wave: "sine", freq: 3600, start: 0.12, pitch: 4, pitchTime: 0.04, attack: 0.005, hold: 0.03, decay: 0.05, volume: 0.5 },
  { wave: "sine", freq: 3400, start: 0.22, pitch: -6, pitchTime: 0.08, attack: 0.005, hold: 0.06, decay: 0.08, vibrato: 1, vibratoSpeed: 24, volume: 0.55 },
  { wave: "noise", filter: "bandpass", cutoff: 5000, q: 3, hold: 0.003, decay: 0.02, volume: 0.08 },
] });
sfx("bird_b", { volume: 0.55, width: 0.3, reverb: 0.25, room: 0.6, layers: [
  { wave: "sine", freq: 2400, pitch: 9, pitchTime: 0.08, attack: 0.006, hold: 0.1, decay: 0.08, vibrato: 1.2, vibratoSpeed: 30, volume: 0.55 }, { wave: "noise", filter: "bandpass", cutoff: 6000, cutoffEnd: 3000, q: 2, hold: 0, decay: 0.012, volume: 0.25 },
  { wave: "sine", freq: 2900, start: 0.25, pitch: -9, pitchTime: 0.18, attack: 0.01, hold: 0.12, decay: 0.1, vibrato: 0.6, vibratoSpeed: 7, volume: 0.5 },
  { wave: "noise", filter: "bandpass", cutoff: 4500, q: 3, hold: 0.003, decay: 0.02, volume: 0.06 },
] });

// ---- the beds that loop: the forest's air, the creek, Pip's radio --------------------------------------------------------------------
sfx("forest_air", { volume: 0.9, width: 0.8, loop: 1, layers: [
  // a soft wide breath of air in the trees, slowly swelling (the filters move over the whole bed, so it is never a steady hiss)
  { wave: "pink", filter: "lowpass", cutoff: 900, cutoffEnd: 1500, attack: 1.2, hold: 2.6, decay: 0.2, volume: 0.6 },
  { wave: "noise", filter: "bandpass", cutoff: 2600, cutoffEnd: 1900, q: 0.6, attack: 1.6, hold: 2.2, decay: 0.2, volume: 0.18 },
  { wave: "pink", filter: "bandpass", cutoff: 420, q: 0.7, attack: 0.4, hold: 3.4, decay: 0.2, volume: 0.35 },
] });
sfx("creek_loop", { volume: 1.0, width: 0.7, reverb: 0.1, room: 0.4, loop: 1, layers: [
  // water over stones: a dense babble of small bright bubbles over a bed of moving noise
  { wave: "crackle", freq: 1400, filter: "bandpass", cutoff: 2100, cutoffEnd: 2900, q: 1.3, attack: 0.3, hold: 3.4, decay: 0.2, volume: 0.6 },
  { wave: "crackle", freq: 900, filter: "bandpass", cutoff: 1100, cutoffEnd: 800, q: 1.8, attack: 0.3, hold: 3.4, decay: 0.2, volume: 0.45 },
  { wave: "pink", filter: "bandpass", cutoff: 700, cutoffEnd: 1100, q: 0.8, attack: 0.5, hold: 3.2, decay: 0.2, volume: 0.45 },
  { wave: "noise", filter: "highpass", cutoff: 4000, attack: 0.5, hold: 3.2, decay: 0.2, volume: 0.1 },
] });
sfx("radio_loop", { volume: 0.9, width: 0.3, loop: 1, layers: [
  // a little radio playing faintly: a hum, a thin tune through a small speaker, and its crackle
  { wave: "crackle", freq: 90, filter: "highpass", cutoff: 2500, attack: 0.2, hold: 3.5, decay: 0.2, volume: 0.2 },
  { wave: "triangle", freq: 523, vibrato: 0.15, vibratoSpeed: 5, attack: 0.05, hold: 0.45, decay: 0.2, filter: "bandpass", cutoff: 1500, q: 1.2, volume: 0.25 },
  { wave: "triangle", freq: 659, start: 0.7, attack: 0.05, hold: 0.45, decay: 0.2, filter: "bandpass", cutoff: 1500, q: 1.2, volume: 0.25 },
  { wave: "triangle", freq: 784, start: 1.4, attack: 0.05, hold: 0.7, decay: 0.3, filter: "bandpass", cutoff: 1500, q: 1.2, volume: 0.22 },
  { wave: "triangle", freq: 587, start: 2.5, attack: 0.05, hold: 0.9, decay: 0.3, filter: "bandpass", cutoff: 1500, q: 1.2, volume: 0.24 },
  { wave: "pink", filter: "bandpass", cutoff: 1800, q: 1.5, attack: 0.2, hold: 3.5, decay: 0.2, volume: 0.12 },
] });
console.log(`made ${made.length} sounds`);
