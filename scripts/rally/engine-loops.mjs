// Pine Ridge Rally's engine: the six CC0 loops from OpenGameArt (domasx2, see licenses/opengameart-engine-loops.txt) are almost all
// sub-bass (97% of their energy is below 100 Hz, which a handheld's speaker cannot play: the engine could not be heard). This makes
// the versions the game plays: the rumble is driven through a soft clipper (which makes its harmonics, the part a small speaker
// reproduces), high-passed at 160 Hz and low-passed at 3 kHz, and a little of the original is kept. The filters run round the loop
// several times and the last turn is kept, so the loop still has no seam.
//
//   node scripts/rally/engine-loops.mjs <folder with loop_0.wav, loop_1_0.wav ... loop_5_0.wav> [project folder]
import fs from "node:fs";
import path from "node:path";

const [from, project = "examples/pine-ridge-rally"] = process.argv.slice(2);
if (!from) throw new Error("usage: node scripts/rally/engine-loops.mjs <folder of the downloaded loops> [project]");
const files = ["loop_0.wav", "loop_1_0.wav", "loop_2_0.wav", "loop_3_0.wav", "loop_4_0.wav", "loop_5_0.wav"];
const RATE = 44100;

function readWav(file) {
  const b = fs.readFileSync(file);
  let p = 12;
  while (p < b.length - 8) {
    const id = b.toString("ascii", p, p + 4), size = b.readUInt32LE(p + 4);
    if (id === "data") {
      const n = size / 2, x = new Float32Array(n);
      for (let i = 0; i < n; i++) x[i] = b.readInt16LE(p + 8 + i * 2) / 32768;
      return x;
    }
    p += 8 + size + (size & 1);
  }
  throw new Error(file + ": no data");
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

/** A second-order filter (RBJ): low-pass or high-pass at `fc` Hz. */
function biquad(kind, fc, q = 0.707) {
  const w = (2 * Math.PI * fc) / RATE, alpha = Math.sin(w) / (2 * q), c = Math.cos(w);
  const hp = kind === "high";
  const b0 = hp ? (1 + c) / 2 : (1 - c) / 2, b1 = hp ? -(1 + c) : 1 - c, b2 = b0;
  const a0 = 1 + alpha, a1 = -2 * c, a2 = 1 - alpha;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x) => {
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  };
}

files.forEach((name, i) => {
  const x = readWav(path.join(from, name));
  const hp = [biquad("high", 160), biquad("high", 160), biquad("high", 160)], lp = [biquad("low", 3000), biquad("low", 3000)];
  // the loop played four times through: the filters have settled by the last, which is the one kept
  const out = new Float32Array(x.length);
  for (let turn = 0; turn < 4; turn++) {
    for (let k = 0; k < x.length; k++) {
      let y = Math.tanh(14 * x[k]) * 0.95 + x[k] * 0.05;
      for (const f of hp) y = f(y);
      for (const f of lp) y = f(y);
      if (turn === 3) out[k] = y;
    }
  }
  // level: the same loudness for every loop
  let e = 0;
  for (const v of out) e += v * v;
  const gain = 0.3 / Math.sqrt(e / out.length);
  for (let k = 0; k < out.length; k++) out[k] *= gain;
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  if (peak > 0.95) for (let k = 0; k < out.length; k++) out[k] *= 0.95 / peak;
  writeWav(path.join(project, "sounds", `engine_${i + 1}.wav`), out);
  console.log(`engine_${i + 1}.wav  ${(out.length / RATE).toFixed(3)} s  peak ${peak.toFixed(2)} gain ${gain.toFixed(1)}`);
});
