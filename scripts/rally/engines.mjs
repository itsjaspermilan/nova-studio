// Pine Ridge Rally's engines: a different note for every car, made offline (no recording, nothing to license). Each engine is a train of
// combustion pulses (one per firing: `cylinders` / 2 a turn, so rpm / 60 * cylinders / 2 a second) fed through a few resonators (the
// exhaust and the intake ring at fixed frequencies whatever the revs), with a puff of noise at each firing and a little unevenness
// from one firing to the next (a three-cylinder is lumpy, a ten-cylinder smooth). Each car gets five loops at revs spaced evenly in
// ratio from idle to its limit; the game crossfades the two nearest and bends each by under a half either way (the method the
// racing games use: recorded or made loops at fixed revs, pitched and blended). Every loop holds a whole number of firings and
// is rendered round a circle, so it loops without a seam.
//
//   node scripts/rally/engines.mjs [project folder]
import fs from "node:fs";
import path from "node:path";

const project = process.argv[2] ?? "examples/pine-ridge-rally";
const RATE = 44100;
const LOOPS = 5;

// rpm, cylinders, the resonators { f: Hz, tau: seconds it rings, g: strength }, how uneven the firings are, how much noise, a firing pattern
const CARS = {
  car: { // Redline: an open-wheel V10: high, smooth and screaming
    idle: 3500, max: 12500, cylinders: 10, unevenness: 0.04, noise: 0.35, pattern: [1],
    resonators: [{ f: 180, tau: 0.03, g: 0.5 }, { f: 520, tau: 0.02, g: 1 }, { f: 1250, tau: 0.012, g: 0.9 }, { f: 2500, tau: 0.008, g: 0.8 }, { f: 4300, tau: 0.004, g: 0.6 }],
  },
  car_blue: { // Blue Streak: a four-cylinder sport sedan: a clean, even growl
    idle: 900, max: 7000, cylinders: 4, unevenness: 0.07, noise: 0.25, pattern: [1, 0.9, 0.95, 0.85],
    resonators: [{ f: 110, tau: 0.035, g: 1 }, { f: 260, tau: 0.02, g: 0.8 }, { f: 700, tau: 0.012, g: 0.75 }, { f: 1700, tau: 0.007, g: 0.5 }, { f: 3300, tau: 0.003, g: 0.3 }],
  },
  car_green: { // Green Machine: a three-cylinder hatchback: lumpy, buzzy, a little rough
    idle: 1000, max: 6800, cylinders: 3, unevenness: 0.22, noise: 0.3, pattern: [1, 0.7, 0.85],
    resonators: [{ f: 90, tau: 0.04, g: 1 }, { f: 210, tau: 0.025, g: 0.9 }, { f: 560, tau: 0.014, g: 0.8 }, { f: 1400, tau: 0.008, g: 0.55 }, { f: 2800, tau: 0.004, g: 0.35 }],
  },
  car_sedan: { // Commuter: an ordinary four-cylinder
    idle: 800, max: 6500, cylinders: 4, unevenness: 0.09, noise: 0.28, pattern: [1, 0.92, 0.96, 0.88],
    resonators: [{ f: 120, tau: 0.03, g: 1 }, { f: 300, tau: 0.018, g: 0.8 }, { f: 800, tau: 0.01, g: 0.7 }, { f: 1900, tau: 0.006, g: 0.45 }, { f: 3500, tau: 0.003, g: 0.25 }],
  },
  car_suv: { // Trailblazer: a smooth, deep six
    idle: 700, max: 5800, cylinders: 6, unevenness: 0.05, noise: 0.22, pattern: [1],
    resonators: [{ f: 85, tau: 0.04, g: 1 }, { f: 200, tau: 0.025, g: 0.9 }, { f: 520, tau: 0.014, g: 0.7 }, { f: 1300, tau: 0.008, g: 0.45 }, { f: 2600, tau: 0.004, g: 0.3 }],
  },
  car_suvl: { // Grand Tourer: a V8 burble
    idle: 600, max: 5500, cylinders: 8, unevenness: 0.1, noise: 0.3, pattern: [1, 0.8, 0.95, 0.75],
    resonators: [{ f: 75, tau: 0.045, g: 1 }, { f: 170, tau: 0.03, g: 0.95 }, { f: 430, tau: 0.016, g: 0.75 }, { f: 1100, tau: 0.009, g: 0.5 }, { f: 2300, tau: 0.004, g: 0.3 }],
  },
  car_taxi: { // Cab: a tired, rattly four
    idle: 850, max: 6000, cylinders: 4, unevenness: 0.16, noise: 0.4, pattern: [1, 0.8, 0.9, 0.7],
    resonators: [{ f: 130, tau: 0.028, g: 1 }, { f: 340, tau: 0.016, g: 0.85 }, { f: 900, tau: 0.01, g: 0.8 }, { f: 2100, tau: 0.007, g: 0.6 }, { f: 3800, tau: 0.004, g: 0.4 }],
  },
  car_police: { // Patrol: an aggressive V8
    idle: 700, max: 6800, cylinders: 8, unevenness: 0.07, noise: 0.35, pattern: [1, 0.85, 0.95, 0.8],
    resonators: [{ f: 95, tau: 0.04, g: 1 }, { f: 230, tau: 0.025, g: 0.9 }, { f: 620, tau: 0.014, g: 0.85 }, { f: 1500, tau: 0.009, g: 0.6 }, { f: 3000, tau: 0.004, g: 0.4 }],
  },
  car_van: { // Delivery Van: a diesel four, clattering
    idle: 800, max: 4800, cylinders: 4, unevenness: 0.18, noise: 0.5, pattern: [1, 0.85, 0.95, 0.8],
    resonators: [{ f: 140, tau: 0.025, g: 1 }, { f: 420, tau: 0.014, g: 0.9 }, { f: 1100, tau: 0.01, g: 0.85 }, { f: 2400, tau: 0.007, g: 0.6 }, { f: 4200, tau: 0.004, g: 0.4 }],
  },
  car_pickup: { // Hauler: a gruff V6
    idle: 700, max: 5500, cylinders: 6, unevenness: 0.12, noise: 0.32, pattern: [1, 0.9],
    resonators: [{ f: 90, tau: 0.04, g: 1 }, { f: 220, tau: 0.024, g: 0.9 }, { f: 580, tau: 0.013, g: 0.75 }, { f: 1400, tau: 0.008, g: 0.5 }, { f: 2700, tau: 0.004, g: 0.3 }],
  },
  car_yellow: { // Sunburst: a six-cylinder with a turbo whine: smooth, with a rising whistle
    idle: 2500, max: 9800, cylinders: 6, unevenness: 0.03, noise: 0.15, pattern: [1], whine: 14,
    resonators: [{ f: 300, tau: 0.02, g: 0.9 }, { f: 900, tau: 0.012, g: 0.8 }, { f: 2000, tau: 0.008, g: 0.7 }, { f: 3600, tau: 0.004, g: 0.5 }],
  },
};

function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

function loop(car, rpm, seed) {
  const f0 = (rpm / 60) * (car.cylinders / 2);
  const firings = Math.max(6, Math.round(0.7 * f0));
  const N = Math.round((firings * RATE) / f0);
  const out = new Float32Array(N);
  const rand = rng(seed);
  const ir = Math.floor(0.12 * RATE); // how long a firing rings (samples)
  // the noise puff of one firing: the same shape each time, filtered noise
  const puff = new Float32Array(Math.floor(0.02 * RATE));
  let lp = 0;
  for (let i = 0; i < puff.length; i++) { lp += 0.35 * ((rand() * 2 - 1) - lp); puff[i] = lp * Math.exp(-i / (0.004 * RATE)); }
  for (let k = 0; k < firings; k++) {
    const amp = car.pattern[k % car.pattern.length] * (1 + car.unevenness * (rand() * 2 - 1));
    const at = (k * N) / firings + car.unevenness * 0.15 * (rand() * 2 - 1) * (RATE / f0); // a little timing wander too
    const start = Math.floor(at), frac = at - start;
    for (let i = 0; i < ir; i++) {
      const t = (i - frac) / RATE;
      if (t < 0) continue;
      let y = 0;
      for (const r of car.resonators) y += r.g * Math.exp(-t / r.tau) * Math.sin(2 * Math.PI * r.f * t);
      if (i < puff.length) y += car.noise * puff[i] * 3;
      out[(start + i) % N] += y * amp;
    }
  }
  if (car.whine) { // a whistle at a multiple of the revs, a whole number of cycles in the loop
    const cycles = Math.round(((rpm / 60) * car.whine * N) / RATE);
    const level = 0.35 * Math.min(1, rpm / car.max);
    for (let i = 0; i < N; i++) out[i] += level * Math.sin((2 * Math.PI * cycles * i) / N) * (0.7 + 0.3 * Math.sin((2 * Math.PI * 2 * i) / N));
  }
  // high-pass at 120 Hz (a small speaker cannot play lower; round the circle so that there is no seam) and an even loudness
  const a = Math.exp((-2 * Math.PI * 120) / RATE);
  let x1 = 0, y1 = 0;
  for (let turn = 0; turn < 3; turn++) for (let i = 0; i < N; i++) { const y = a * (y1 + out[i] - x1); x1 = out[i]; y1 = y; if (turn === 2) out[i] = y; }
  let e = 0;
  for (const v of out) e += v * v;
  const gain = 0.22 / Math.sqrt(e / N);
  let peak = 0;
  for (let i = 0; i < N; i++) { out[i] *= gain; peak = Math.max(peak, Math.abs(out[i])); }
  if (peak > 0.95) for (let i = 0; i < N; i++) out[i] *= 0.95 / peak;
  return out;
}

function writeWav(file, x) {
  const data = Buffer.alloc(x.length * 2);
  for (let i = 0; i < x.length; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i])) * 32767), i * 2);
  const head = Buffer.alloc(44);
  head.write("RIFF", 0); head.writeUInt32LE(36 + data.length, 4); head.write("WAVEfmt ", 8);
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(RATE, 24); head.writeUInt32LE(RATE * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write("data", 36); head.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([head, data]));
}

let seed = 7;
for (const [id, car] of Object.entries(CARS)) {
  const rpms = [];
  for (let j = 0; j < LOOPS; j++) {
    const rpm = car.idle * (car.max / car.idle) ** (j / (LOOPS - 1)); // evenly spaced in ratio
    rpms.push(Math.round(rpm));
    const x = loop(car, rpm, seed++);
    writeWav(path.join(project, "sounds", `eng_${id}_${j + 1}.wav`), x);
  }
  console.log(id.padEnd(11), rpms.join(" "), "rpm");
}
