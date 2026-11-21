// Measures Pine Ridge Rally's made sounds (nobody can listen from a script, so this is what can be said for certain) and writes
// build/sounds-report.md. For every WAV in sounds/: peak and RMS level, DC offset, samples at full scale (clipping), the spectral
// centroid, how much of the energy is above 16 kHz (where aliasing would show), and
//   a loop:    the step across the seam (last sample to first) against the steps inside it, in value and in slope
//   a one-shot: how far from silence it starts and ends
//   an engine: its firing frequency measured from the sound itself (the spacing of its strongest spectral lines) against
//              what its layout fires at the band's revs (rpm x cylinders / 120 for an even engine), how much of its energy sits on
//              the firing harmonics and on the half-orders between, how much is above 2 kHz (little: the note and its first
//              harmonics are to carry the sound), and that the bands of an engine get brighter as the revs rise
// It also checks that lib/audio.lua and lib/state.lua hold the same bands and revs as the engine model (studio/mcp/makers/engine.mjs, made by engine_make), that every car
// has an engine, and that all the engine loops together stay under 16 MB. Exits 1 when anything fails.
//
//   node scripts/rally/sound-check.mjs [project folder]
import fs from "node:fs";
import path from "node:path";
import { ENGINES, LOOP, RATE, bandRpm, fft, firingHz, loopLength, patternOrder } from "../../studio/mcp/makers/engine.mjs";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");

const project = path.resolve(process.argv[2] ?? path.join(ROOT, "examples/pine-ridge-rally"));
const dir = path.join(project, "sounds");
const db = (v) => (v > 0 ? 20 * Math.log10(v) : -Infinity);
const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "-inf");

function readWav(file) {
  const b = fs.readFileSync(file);
  let at = 12, format = null, data = null;
  while (at + 8 <= b.length) {
    const id = b.toString("ascii", at, at + 4), size = b.readUInt32LE(at + 4);
    if (id === "fmt ") format = { tag: b.readUInt16LE(at + 8), channels: b.readUInt16LE(at + 10), rate: b.readUInt32LE(at + 12), bits: b.readUInt16LE(at + 22) };
    if (id === "data") data = b.subarray(at + 8, at + 8 + size);
    at += 8 + size + (size & 1);
  }
  if (!format || !data || format.tag !== 1 || format.bits !== 16) throw new Error(`${file}: not 16-bit PCM`);
  const frames = data.length / 2 / format.channels;
  const x = new Float64Array(frames);
  let clipped = 0;
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let c = 0; c < format.channels; c++) { const v = data.readInt16LE((i * format.channels + c) * 2); if (v >= 32767 || v <= -32768) clipped++; s += v; }
    x[i] = s / format.channels / 32768;
  }
  return { x, rate: format.rate, channels: format.channels, clipped };
}

/// The power spectrum (of the whole sound: exact for a power-of-two loop, zero-padded for anything else) and its bin width.
function powerSpectrum(x, rate) {
  let n = 1;
  while (n < x.length) n <<= 1;
  const re = new Float64Array(n), im = new Float64Array(n);
  re.set(x);
  fft(re, im);
  const p = new Float64Array(n / 2 + 1);
  for (let k = 0; k <= n / 2; k++) p[k] = re[k] * re[k] + im[k] * im[k];
  return { p, hz: rate / n, n };
}

function measure(name, kind) {
  const { x, rate, channels, clipped } = readWav(path.join(dir, name));
  const n = x.length;
  let sum = 0, sq = 0, pk = 0;
  for (const v of x) { sum += v; sq += v * v; pk = Math.max(pk, Math.abs(v)); }
  const m = { name, kind, rate, channels, seconds: n / rate, peak: db(pk), rms: db(Math.sqrt(sq / n)), dc: sum / n, clipped };
  const { p, hz, n: size } = powerSpectrum(x, rate);
  let e = 0, ef = 0, high = 0, bright = 0;
  for (let k = 1; k < p.length; k++) { e += p[k]; ef += p[k] * k * hz; if (k * hz > 16000) high += p[k]; if (k * hz > 2000) bright += p[k]; }
  m.centroid = ef / e;
  m.bright = bright / e;
  // how much of the sound is one note: the energy within 3% of its strongest line
  let top = 1;
  for (let k = 2; k < p.length; k++) if (p[k] > p[top]) top = k;
  let line = 0;
  for (let k = Math.floor(top * 0.97); k <= Math.ceil(top * 1.03) && k < p.length; k++) line += p[k];
  m.note = line / e; m.noteHz = top * hz;
  m.high = 10 * Math.log10(high / e + 1e-30);
  if (kind === "loop" || kind === "engine") {
    // the seam against the inside: the largest step between neighbours, and the largest change of step (a kink), anywhere else
    let step = 0, kink = 0;
    for (let i = 1; i < n; i++) step = Math.max(step, Math.abs(x[i] - x[i - 1]));
    for (let i = 2; i < n; i++) kink = Math.max(kink, Math.abs(x[i] - 2 * x[i - 1] + x[i - 2]));
    m.seamStep = Math.abs(x[0] - x[n - 1]) / step;
    m.seamKink = Math.max(Math.abs(x[1] - 2 * x[0] + x[n - 1]), Math.abs(x[0] - 2 * x[n - 1] + x[n - 2])) / kink;
  } else {
    m.start = db(Math.abs(x[0])); m.end = db(Math.abs(x[n - 1]));
  }
  if (kind === "engine") {
    // The firing frequency, from the sound alone: a periodic sound's energy sits on lines a fixed distance apart, and that distance
    // is its fundamental. So: the 24 strongest lines of the spectrum under 6 kHz, and the widest spacing (up to 900 Hz) whose multiples
    // hold at least 75% of their energy. (Not simply the strongest line: a pipe's resonance can make the second harmonic the loudest.
    // Not 100%: there is always a little between the lines of the pattern.)
    const lines = [];
    for (let k = 2; k < p.length && k * hz < 6000; k++) lines.push(k);
    lines.sort((i, j) => p[j] - p[i]);
    lines.length = Math.min(lines.length, 24);
    let among = 0;
    for (const k of lines) among += p[k];
    let spacing = 0;
    for (let b = Math.floor(900 / hz); b >= 2 && !spacing; b--) {
      let on = 0;
      for (const k of lines) if (k % b === 0) on += p[k];
      if (on >= 0.75 * among) spacing = b;
    }
    m.fired = spacing ? spacing * hz : NaN;
    const [, id, off, band] = name.match(/^eng_(.+?)_(off_)?(\d+)\.wav$/);
    const spec = ENGINES[id];
    m.engine = id; m.band = Number(band); m.layer = off ? "off" : "on";
    const cycles = spec?.cycles[m.band - 1];
    m.rpm = cycles ? bandRpm(cycles) : NaN;
    m.expected = spec ? firingHz(spec, m.rpm) : NaN;
    m.bytes = fs.statSync(path.join(dir, name)).size;
    // the energy on the firing harmonics (for an even engine of n cylinders, every nth harmonic of the engine cycle), on the other
    // half-orders, and between the lines; and the note itself with its next two harmonics
    let firing = 0, half = 0, note = 0;
    if (cycles && n === loopLength(cycles)) {
      const inFile = (cycles * n) / LOOP, order = patternOrder(spec.layout);
      m.order = order;
      for (let h = 1; h * inFile < p.length; h++) { if (h % order === 0) { firing += p[h * inFile]; if (h <= 3 * order) note += p[h * inFile]; } else half += p[h * inFile]; }
    } else if (cycles) m.wrongLength = n;
    m.firingShare = firing / e; m.halfShare = half / e; m.noteShare = note / e;
  }
  return m;
}

const kindOf = (f) => (/^eng_/.test(f) ? "engine" : /(_loop|^tyre_)/.test(f) ? "loop" : "shot");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".wav")).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
const all = files.map((f) => measure(f, kindOf(f)));
const problems = [], notes = [];
// what scripts/rally/engines.mjs and audio.mjs synthesise is held to every check; the sound editor's effects (beep, go, checkpoint,
// finish) are only reported
const MINE = /^(eng_|tyre_|wind_loop|turbo_loop|whine_loop|scrape_loop|thump|impact|pop|shift_|bov_|whoosh)/;
// the engines that are meant to be uneven (a cross-plane V8: the burr may be as strong as the note, and must be there), and how much of a loop may be above 2 kHz
const ROUGH = new Set(["car_muscle"]), BRIGHT = 0.03;
let current = null;
const fail = (what) => (current && !MINE.test(current.name) ? notes : problems).push(what);

for (const m of all) {
  current = m;
  if (m.clipped) fail(`${m.name}: ${m.clipped} samples at full scale`);
  if (Math.abs(m.dc) > 0.002) fail(`${m.name}: DC offset ${m.dc.toFixed(4)}`);
  if (m.peak > -0.4) fail(`${m.name}: peak ${fmt(m.peak)} dBFS`);
  if (m.kind !== "shot" && (m.seamStep > 1 || m.seamKink > 1)) fail(`${m.name}: the seam is rougher than the inside (step ${m.seamStep.toFixed(2)}, kink ${m.seamKink.toFixed(2)})`);
  if (m.kind === "shot" && /^(thump|impact|pop|shift_|bov_|whoosh)/.test(m.name) && (m.start > -50 || m.end > -50)) fail(`${m.name}: starts at ${fmt(m.start)} dB, ends at ${fmt(m.end)} dB`);
  if (m.kind !== "shot" && m.high > -40) fail(`${m.name}: ${fmt(m.high)} dB of its energy is above 16 kHz`);
  // the turbo is to be breath, not a whistle: mostly air, its note low
  if (m.name === "turbo_loop.wav" && (m.note > 0.15 || m.noteHz > 2000 || m.centroid > 1800)) fail(`${m.name}: ${fmt(m.note * 100, 0)}% of it is one note at ${Math.round(m.noteHz)} Hz, centroid ${Math.round(m.centroid)} Hz: a whistle`);
  if (m.kind === "engine") {
    if (!Number.isFinite(m.expected)) fail(`${m.name}: no such engine band in scripts/rally/engines.mjs`);
    else {
      // The spacing of the lines is the firing frequency, or (cylinders or banks that are not alike: a twin-scroll six's two
      // groups, a five's unequal pipes, a cross-plane V8's two banks) a whole share of it that is a multiple of the engine cycle:
      // the burr then counts as part of the pattern. Never anything else. Except in the engines meant to be rough, the firing
      // harmonics must still hold most of the energy with the throttle down.
      const share = m.expected / m.fired, whole = Math.round(share);
      m.spacing = whole;
      if (!(Math.abs(share / whole - 1) < 0.01) || m.order % whole !== 0) fail(`${m.name}: its lines are ${fmt(m.fired, 2)} Hz apart; it fires at ${fmt(m.expected, 2)} Hz at ${Math.round(m.rpm)} rpm`);
      if (m.wrongLength) fail(`${m.name}: ${m.wrongLength} samples, ${loopLength(spec.cycles[m.band - 1])} expected`);
      if (m.layer === "on" && m.firingShare < 0.5 && !ROUGH.has(m.engine)) fail(`${m.name}: only ${fmt(m.firingShare * 100, 0)}% of its energy is on the firing harmonics`);
      if (ROUGH.has(m.engine) && m.layer === "on" && m.halfShare < 0.1) fail(`${m.name}: only ${fmt(m.halfShare * 100, 0)}% of its energy is on the half-orders: no burble`);
      if (m.bright > BRIGHT) fail(`${m.name}: ${fmt(m.bright * 100, 1)}% of its energy is above 2 kHz`);
      if (m.centroid > (m.layer === "on" ? 800 : 1000)) fail(`${m.name}: its spectral centroid is ${Math.round(m.centroid)} Hz`);
    }
    if (Math.abs(m.rms - -14) > 0.3) fail(`${m.name}: RMS ${fmt(m.rms)} dBFS (engine loops are matched at -14.0)`);
  }
}
current = null;
// each engine's bands: brighter with the revs, and present in both layers
for (const [id, spec] of Object.entries(ENGINES)) {
  for (const layer of ["on", "off"]) {
    const bands = all.filter((m) => m.engine === id && m.layer === layer).sort((a, b) => a.band - b.band);
    if (bands.length !== spec.cycles.length) fail(`${id} ${layer}: ${bands.length} loops, ${spec.cycles.length} bands`);
    for (let i = 1; i < bands.length; i++) if (bands[i].centroid <= bands[i - 1].centroid) fail(`${id} ${layer}: band ${i + 1} is not brighter than band ${i} (${Math.round(bands[i].centroid)} Hz after ${Math.round(bands[i - 1].centroid)} Hz)`);
  }
}
for (const m of all) if (m.kind === "engine" && !ENGINES[m.engine]) fail(`${m.name}: an engine that is not in the game`);
// lib/audio.lua plays each loop at (engine rpm / loop rpm): its bands must be these; every car of lib/state.lua must have a
// profile there, with the revs state.lua gives the car, and the loops it names must be made
const lua = fs.readFileSync(path.join(project, "lib/audio.lua"), "utf8");
const stateLua = fs.readFileSync(path.join(project, "lib/state.lua"), "utf8");
const cars = [...stateLua.matchAll(/\{ id = "(car_\w+)", name = "([^"]+)"[\s\S]*?idle_rpm = (\d+), max_rpm = (\d+)/g)].map((c) => ({ id: c[1], name: c[2], idle: Number(c[3]), max: Number(c[4]) }));
if (!cars.length) fail("lib/state.lua: no cars found");
for (const car of cars) {
  const found = lua.match(new RegExp(`\\n\\s*${car.id}\\s*=\\s*{\\s*(?:sound\\s*=\\s*"(\\w+)",\\s*)?idle\\s*=\\s*(\\d+),\\s*max\\s*=\\s*(\\d+),\\s*cycles\\s*=\\s*{([^}]*)}`));
  if (!found) { fail(`lib/audio.lua: no engine profile for ${car.id}`); continue; }
  car.sound = found[1] ?? car.id;
  const spec = ENGINES[car.sound];
  if (!spec) { fail(`lib/audio.lua: ${car.id} plays ${car.sound}, which engines.mjs does not make`); continue; }
  const got = found[4].split(",").map((v) => Number(v.trim())).filter((v) => v > 0);
  if (got.join() !== spec.cycles.join()) fail(`lib/audio.lua: ${car.id}'s cycles are {${got.join(", ")}}; engines.mjs makes {${spec.cycles.join(", ")}} for ${car.sound}`);
  if (Number(found[2]) !== car.idle || Number(found[3]) !== car.max) fail(`lib/audio.lua: ${car.id} is ${found[2]} to ${found[3]} rpm; lib/state.lua says ${car.idle} to ${car.max}`);
  if (car.sound === car.id && (spec.idle !== car.idle || spec.max !== car.max)) fail(`engines.mjs: ${car.id} is ${spec.idle} to ${spec.max} rpm; lib/state.lua says ${car.idle} to ${car.max}`);
  if (bandRpm(spec.cycles[0]) > car.idle * 1.2 || bandRpm(spec.cycles.at(-1)) < car.max / 1.2) fail(`${car.id}: ${car.sound}'s bands do not reach its revs (${car.idle} to ${car.max})`);
}
for (const id of Object.keys(ENGINES)) if (!cars.some((c) => c.sound === id)) fail(`engines.mjs: no car plays ${id}`);
if (!/65536/.test(lua) || LOOP !== 65536) fail("lib/audio.lua and engines.mjs disagree about the length of an engine loop");
const engineBytes = all.reduce((sum, m) => sum + (m.bytes ?? 0), 0);
if (engineBytes > 16e6) fail(`the engine loops are ${(engineBytes / 1e6).toFixed(2)} MB together (16 MB at most)`);

// ---- the report ----------------------------------------------------------------------------------------------------------------
const out = [];
out.push("# Pine Ridge Rally: the made sounds, measured", "");
out.push(`Written by \`scripts/rally/sound-check.mjs\` on ${new Date().toISOString().slice(0, 10)}. **Nothing here was listened to**: these are measurements of the files, not a judgement of how they sound.`, "");
out.push(problems.length ? `**${problems.length} check(s) failed:**\n\n${problems.map((p) => `- ${p}`).join("\n")}` : "**All checks pass**: no clipping, no DC offset, every loop's seam is no rougher than its inside, every engine loop fires at its layout's frequency within 1%, less than 3% of any engine loop's energy is above 2 kHz, every engine's bands get brighter as the revs rise, engine loops are level-matched, every car has an engine, and lib/audio.lua and lib/state.lua hold the same bands and revs as engines.mjs.", "");
if (notes.length) out.push("Not made by these scripts (the sound editor's effects), reported only:", "", ...notes.map((p) => `- ${p}`), "");
out.push("## The cars' engines", "", `All the engine loops together: ${all.filter((m) => m.kind === "engine").length} files, ${(engineBytes / 1e6).toFixed(2)} MB. The centroid and the share above 2 kHz are of the throttle-down loops, lowest band to highest.`, "");
out.push("| car | engine loops | fires | at idle | at the limit | bands | bytes | centroid Hz | above 2 kHz |", "|---|---|---|---:|---:|---:|---:|---|---|");
for (const car of cars) {
  const spec = ENGINES[car.sound];
  if (!spec) continue;
  const loops = all.filter((m) => m.engine === car.sound), on = loops.filter((m) => m.layer === "on").sort((x, y) => x.band - y.band);
  const order = patternOrder(spec.layout);
  out.push(`| ${car.name} (${car.id}) | ${car.sound}${car.sound === car.id ? "" : " (shared)"} | rpm x ${order} / 120 | ${fmt(firingHz(spec, car.idle), 1)} Hz at ${car.idle} | ${fmt(firingHz(spec, car.max), 1)} Hz at ${car.max} | ${spec.cycles.length} x 2 | ${car.sound === car.id ? loops.reduce((sum, m) => sum + m.bytes, 0) : 0} | ${on.map((m) => Math.round(m.centroid)).join(" ")} | ${on.map((m) => fmt(m.bright * 100, 1) + "%").join(" ")} |`);
}
out.push("", "## Engine loops", "", "`fires` is measured from the sound (the spacing of its strongest spectral lines); `expected` is what the layout fires at these revs (rpm x cylinders / 120). `1/n`: the lines are that share of the firing frequency apart (the burr is then strong enough to count as part of the pattern: the V8 above all). `firing` is the share of the energy on the firing harmonics, `note` the share on the firing frequency and its next two harmonics alone, `half` the share on the half-orders between (uneven cylinders and banks: the burr), the rest is noise (knock, hiss, valves). The seam columns compare the join with the roughest place inside the loop (under 1 is smoother than the inside).", "");
out.push("| loop | rpm | expected Hz | fires Hz | 1/n | RMS dBFS | peak dBFS | centroid Hz | >2 kHz | firing | note | half | >16 kHz dB | DC | seam step | seam kink | clipped |", "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
for (const m of all.filter((m) => m.kind === "engine")) {
  out.push(`| ${m.name.replace(".wav", "")} | ${Math.round(m.rpm)} | ${fmt(m.expected, 2)} | ${fmt(m.fired, 2)} | ${m.spacing ?? "?"} | ${fmt(m.rms)} | ${fmt(m.peak)} | ${Math.round(m.centroid)} | ${fmt(m.bright * 100, 1)}% | ${fmt(m.firingShare * 100, 0)}% | ${fmt(m.noteShare * 100, 0)}% | ${fmt(m.halfShare * 100, 0)}% | ${fmt(m.high, 0)} | ${m.dc.toFixed(5)} | ${m.seamStep.toFixed(3)} | ${m.seamKink.toFixed(3)} | ${m.clipped} |`);
}
out.push("", "## Other loops (tyres, wind, turbo, gear whine, scrape)", "", "`one note` is the share of the loop's energy within 3% of its strongest line, and where that line is (the turbo is to be mostly air: under 15%).", "", "| loop | seconds | RMS dBFS | peak dBFS | centroid Hz | one note | >16 kHz dB | DC | seam step | seam kink | clipped |", "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
for (const m of all.filter((m) => m.kind === "loop")) out.push(`| ${m.name.replace(".wav", "")} | ${m.seconds.toFixed(2)} | ${fmt(m.rms)} | ${fmt(m.peak)} | ${Math.round(m.centroid)} | ${fmt(m.note * 100, 0)}% at ${Math.round(m.noteHz)} Hz | ${fmt(m.high, 0)} | ${m.dc.toFixed(5)} | ${m.seamStep.toFixed(3)} | ${m.seamKink.toFixed(3)} | ${m.clipped} |`);
out.push("", "## One-shots", "", "| sound | seconds | RMS dBFS | peak dBFS | centroid Hz | starts dB | ends dB | DC | clipped |", "|---|---:|---:|---:|---:|---:|---:|---:|---:|");
for (const m of all.filter((m) => m.kind === "shot")) out.push(`| ${m.name.replace(".wav", "")} | ${m.seconds.toFixed(2)} | ${fmt(m.rms)} | ${fmt(m.peak)} | ${Math.round(m.centroid)} | ${fmt(m.start, 0)} | ${fmt(m.end, 0)} | ${m.dc.toFixed(5)} | ${m.clipped} |`);
out.push("");
fs.mkdirSync(path.join(ROOT, "build"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "build/sounds-report.md"), out.join("\n"));
console.log(out.join("\n"));
if (problems.length) process.exit(1);
