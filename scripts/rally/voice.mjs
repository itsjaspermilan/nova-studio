// The co-driver's voice for Pine Ridge Rally: one short clip for each word of a pace note (lib/codriver.lua plays them back to back from
// sounds/voice/), made on a Mac with its built-in `say` command and `afconvert`. Nothing is downloaded and no speech engine is added to Nova.
//
//   scripts/env.sh node scripts/rally/voice.mjs [--project examples/pine-ridge-rally] [--voice Daniel] [--rate 235]
//
// The clips are NOT in the repository (sounds/voice/ is in .gitignore): Apple's licence lets a person use the system voices for personal,
// non-commercial purposes, and a game's files are neither. Make them on the machine that builds the game (the Retroid's APK is built from
// the folder as it stands, so run this before scripts/build-apk.sh). Without them the game works the same and the co-driver stays silent.
// How the clips are made and what they are called: the game's README.md, "The co-driver's voice".
//
// Each clip: said alone by the voice, converted to a 44.1 kHz 16-bit mono WAV by afconvert, then (here, in Node) the silence trimmed from
// both ends (anything 36 dB under the clip's own peak, keeping 8 ms in front and a short fade behind), its loudness brought to one level
// (-19 dBFS RMS of what is said, peaks held under -1 dBFS by a soft clip) so that "one" is as loud as "tightens".
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const project = path.resolve(opt("project", path.join(here, "../../examples/pine-ridge-rally")));
// Daniel (British English) is a clear, even, brisk voice that every Mac has; the rate is in words a minute (the default is about 175)
const VOICE = opt("voice", "Daniel");
const RATE = Number(opt("rate", "235"));
const RATE_HZ = 44100;
const TARGET_RMS_DB = -19;

// name of the clip file -> what is said (a note's word, as lib/codriver.lua names it)
export const CLIPS = {
  left: "left", right: "right",
  one: "one", two: "two", three: "three", four: "four", five: "five", six: "six",
  hairpin: "hairpin", square: "square", flat: "flat", long: "long", short: "short", tightens: "tightens", opens: "opens",
  crest: "crest", jump: "jump", dip: "dip", caution: "caution", dont_cut: "don't cut",
  into: "into", and: "and",
  fifty: "fifty", one_hundred: "one hundred", one_fifty: "one fifty", two_hundred: "two hundred", three_hundred: "three hundred",
  finish: "finish", go: "go",
};

function wavSamples(file) {
  const b = fs.readFileSync(file);
  let o = 12, fmt = null, data = null;
  while (o + 8 <= b.length) {
    const id = b.toString("ascii", o, o + 4), size = b.readUInt32LE(o + 4);
    if (id === "fmt ") fmt = { channels: b.readUInt16LE(o + 10), rate: b.readUInt32LE(o + 12), bits: b.readUInt16LE(o + 22) };
    if (id === "data") data = b.subarray(o + 8, o + 8 + Math.min(size, b.length - o - 8));
    o += 8 + size + (size & 1);
  }
  if (!fmt || !data || fmt.bits !== 16 || fmt.channels !== 1) throw new Error(`${file}: not a 16-bit mono WAV (afconvert did something else)`);
  const x = new Float64Array(data.length / 2);
  for (let i = 0; i < x.length; i++) x[i] = data.readInt16LE(i * 2) / 32768;
  return { x, rate: fmt.rate };
}

function wavBytes(x, rate) {
  const data = Buffer.alloc(x.length * 2);
  for (let i = 0; i < x.length; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i])) * 32767), i * 2);
  const head = Buffer.alloc(44);
  head.write("RIFF", 0); head.writeUInt32LE(36 + data.length, 4); head.write("WAVEfmt ", 8);
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write("data", 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

/// The clip without the silence at its ends, at the target loudness.
function finish(x, rate) {
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  const floor = peak * Math.pow(10, -36 / 20);
  let a = 0, b = x.length - 1;
  while (a < b && Math.abs(x[a]) < floor) a++;
  while (b > a && Math.abs(x[b]) < floor) b--;
  a = Math.max(0, a - Math.round(0.008 * rate));
  b = Math.min(x.length - 1, b + Math.round(0.02 * rate));
  const y = Float64Array.from(x.subarray(a, b + 1));
  // a short fade in and out, so that a clip never starts or ends with a click
  const fadeIn = Math.round(0.004 * rate), fadeOut = Math.round(0.018 * rate);
  for (let i = 0; i < fadeIn && i < y.length; i++) y[i] *= i / fadeIn;
  for (let i = 0; i < fadeOut && i < y.length; i++) y[y.length - 1 - i] *= i / fadeOut;
  // loudness: the RMS of what is above the floor (the words, not the gaps), then a soft clip under -1 dBFS
  let e = 0, n = 0;
  for (const v of y) if (Math.abs(v) > floor * 4) { e += v * v; n++; }
  const rms = Math.sqrt(e / Math.max(1, n));
  const gain = Math.pow(10, TARGET_RMS_DB / 20) / Math.max(1e-6, rms);
  const limit = Math.pow(10, -1 / 20);
  for (let i = 0; i < y.length; i++) y[i] = limit * Math.tanh((y[i] * gain) / limit);
  return y;
}

function main() {
  if (process.platform !== "darwin") throw new Error("this script needs macOS's `say` and `afconvert`");
  const voices = execFileSync("say", ["-v", "?"], { encoding: "utf8" });
  if (!new RegExp(`^${VOICE}\\s`, "m").test(voices)) throw new Error(`no voice "${VOICE}" is installed; \`say -v '?'\` lists them (--voice NAME)`);
  const out = path.join(project, "sounds/voice");
  fs.mkdirSync(out, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nova-voice-"));
  const lengths = {};
  try {
    for (const [name, words] of Object.entries(CLIPS)) {
      const aiff = path.join(tmp, `${name}.aiff`), wav = path.join(tmp, `${name}.wav`);
      execFileSync("say", ["-v", VOICE, "-r", String(RATE), "-o", aiff, words]);
      execFileSync("afconvert", ["-f", "WAVE", "-d", `LEI16@${RATE_HZ}`, "-c", "1", aiff, wav]);
      const { x, rate } = wavSamples(wav);
      const y = finish(x, rate);
      fs.writeFileSync(path.join(out, `${name}.wav`), wavBytes(y, rate));
      lengths[name] = y.length / rate;
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`made ${Object.keys(CLIPS).length} clips with the voice ${VOICE} (${RATE} words a minute) in ${path.relative(process.cwd(), out) || out}`);
  console.log("lengths in seconds (the table lib/codriver.lua's DURATION holds, so that clips are played back to back):");
  console.log(Object.entries(lengths).map(([k, v]) => `${k === "and" ? '["and"]' : k} = ${v.toFixed(2)}`).join(", "));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
