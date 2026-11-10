// Editing a recorded or imported sound beyond trimming and fading: change its speed with or without its pitch, shift its pitch keeping its length, make it
// loop without a click, cut it into pieces at its hits, and look at it as a spectrogram. Pure functions on `Sound` (lib/wav.ts); each returns a new sound.

import type { Sound } from "./wav";

const len = (s: Sound) => s.channels[0]?.length ?? 0;
const map = (s: Sound, f: (c: Float32Array) => Float32Array): Sound => ({ rate: s.rate, channels: s.channels.map(f) });

/// Plays the sound `factor` times as fast, by reading it faster: it gets shorter and higher (or longer and lower) together, like a tape. 0.25 to 4.
export function changeSpeed(s: Sound, factor: number): Sound {
  const f = Math.min(4, Math.max(0.25, factor));
  return map(s, (c) => {
    const n = Math.max(1, Math.floor(c.length / f));
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const pos = i * f;
      const i0 = Math.floor(pos);
      const t = pos - i0;
      out[i] = c[i0]! * (1 - t) + (c[Math.min(c.length - 1, i0 + 1)] ?? 0) * t;
    }
    return out;
  });
}

/// Makes the sound `factor` times as long without changing its pitch (waveform-similarity overlap-add): 0.5 to 2. Good for speech and tones; a drum hit's
/// attack can smear a little, which is the price.
export function stretchTime(s: Sound, factor: number): Sound {
  const f = Math.min(2, Math.max(0.5, factor));
  if (Math.abs(f - 1) < 1e-3 || len(s) < 64) return s;
  const win = Math.max(256, Math.round(s.rate * 0.04)); // 40 ms grains
  const hopOut = Math.floor(win / 2);
  const hopIn = hopOut / f;
  const seek = Math.floor(win / 4);
  const n = len(s);
  const outLen = Math.floor(n * f);
  const hann = Float32Array.from({ length: win }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (win - 1)));
  // the grain starts are found on the first channel (the sum of both would do too) and used for all
  const lead = s.channels[0]!;
  const starts: number[] = [];
  let prevStart = 0;
  starts.push(0);
  for (let k = 1; k * hopOut < outLen; k++) {
    const ideal = Math.round(k * hopIn);
    // the grain that follows the previous one most naturally: the one whose start matches what the previous grain's end would have continued with
    const target = prevStart + hopOut;
    let best = Math.min(n - win, Math.max(0, ideal));
    let bestScore = -Infinity;
    for (let d = -seek; d <= seek; d += 2) {
      const p = ideal + d;
      if (p < 0 || p + win > n || target + win > n) continue;
      let dot = 0;
      for (let i = 0; i < win; i += 4) dot += lead[p + i]! * lead[target + i]!;
      if (dot > bestScore) (bestScore = dot), (best = p);
    }
    starts.push(best);
    prevStart = best;
  }
  return map(s, (c) => {
    const out = new Float32Array(outLen + win);
    const norm = new Float32Array(outLen + win);
    starts.forEach((p, k) => {
      const o = k * hopOut;
      for (let i = 0; i < win && p + i < c.length; i++) {
        out[o + i] = out[o + i]! + c[p + i]! * hann[i]!;
        norm[o + i] = norm[o + i]! + hann[i]!;
      }
    });
    const res = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) res[i] = norm[i]! > 1e-4 ? out[i]! / norm[i]! : 0;
    return res;
  });
}

/// The same sound, as long as before, `semitones` higher (or lower): the speed is changed and the length put back with `stretchTime`. Within one octave either way.
export function shiftPitch(s: Sound, semitones: number): Sound {
  const st = Math.max(-12, Math.min(12, semitones));
  if (st === 0) return s;
  const ratio = 2 ** (st / 12);
  const faster = changeSpeed(s, ratio);
  const back = stretchTime(faster, len(s) / Math.max(1, len(faster)));
  // (stretchTime clamps to 0.5 to 2, which an octave reaches exactly)
  const n = len(s);
  return map(back, (c) => (c.length === n ? c : c.length > n ? c.slice(0, n) : Float32Array.from({ length: n }, (_, i) => c[i] ?? 0)));
}

/// Makes a sound loop without a click: the last `seconds` fade out while the first `seconds` fade in over them, and the sound is that much shorter. The end then
/// runs straight into the start. Needs a sound a few times longer than the fade.
export function makeLoopable(s: Sound, seconds = 0.05): Sound {
  const n = len(s);
  const x = Math.min(Math.floor(seconds * s.rate), Math.floor(n / 3));
  if (x < 8) return s;
  return map(s, (c) => {
    const out = new Float32Array(n - x);
    out.set(c.subarray(0, n - x));
    for (let i = 0; i < x; i++) {
      const t = (i + 0.5) / x;
      const a = Math.cos((t * Math.PI) / 2); // the tail fades out (equal power)
      const b = Math.sin((t * Math.PI) / 2); // the head fades in
      out[i] = c[i]! * b + c[n - x + i]! * a;
    }
    return out;
  });
}

/// Where the hits are (frame numbers of the starts of sounds that jump up out of quiet), found by watching the loudness in 10 ms steps. `sensitivity` 0 to 1:
/// higher finds more, softer hits. The sound's start counts as a hit.
export function findHits(s: Sound, sensitivity = 0.5): number[] {
  const step = Math.max(32, Math.round(s.rate * 0.01));
  const n = len(s);
  const env: number[] = [];
  for (let i = 0; i + step <= n; i += step) {
    let sum = 0;
    for (const c of s.channels) for (let k = i; k < i + step; k++) sum += c[k]! * c[k]!;
    env.push(Math.sqrt(sum / (step * s.channels.length)));
  }
  const top = Math.max(...env, 1e-9);
  const rise = 1.5 + (1 - Math.min(1, Math.max(0, sensitivity))) * 4; // how many times louder than the average of the last 80 ms
  const floor = top * (0.03 + 0.12 * (1 - Math.min(1, Math.max(0, sensitivity))));
  const hits = [0];
  let last = -1000;
  for (let i = 1; i < env.length; i++) {
    const before = env.slice(Math.max(0, i - 8), i).reduce((a, b) => a + b, 0) / Math.min(8, i);
    if (env[i]! > floor && env[i]! > before * rise && i - last > 10) {
      // step back to where it really began: the last quiet step
      let b = i;
      while (b > 0 && env[b - 1]! < env[b]! && env[b - 1]! > before) b--;
      if (b * step - (hits[hits.length - 1] ?? 0) > step * 5) hits.push(b * step);
      last = i;
    }
  }
  return hits;
}

/// The sound cut at the given frames into pieces (the first piece starts at the first cut, or at 0).
export function slicePieces(s: Sound, cuts: number[], minFrames = 64): Sound[] {
  const n = len(s);
  const points = [...new Set([0, ...cuts.map((c) => Math.max(0, Math.min(n, Math.round(c)))), n])].sort((a, b) => a - b);
  const out: Sound[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    if (points[i + 1]! - points[i]! >= minFrames) out.push(map(s, (c) => c.slice(points[i]!, points[i + 1]!)));
  }
  return out;
}

// ---- the spectrogram ---------------------------------------------------------------------------------

/// A radix-2 FFT in place on the real and imaginary parts (length a power of two).
function fft(re: Float32Array, im: Float32Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const ang = (-2 * Math.PI) / size;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += size) {
      let cr = 1, ci = 0;
      for (let k = 0; k < size / 2; k++) {
        const a = i + k, b = i + k + size / 2;
        const tr = re[b]! * cr - im[b]! * ci;
        const ti = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

export interface Spectrogram {
  /// columns[x][y]: level in dB (about -100 to 0), x across time, y up the frequency axis (0 is the lowest).
  columns: Float32Array[];
  /// The frequency of the top row in Hz.
  maxHz: number;
  seconds: number;
}

/// Short-time Fourier transform of the first channel (or the mix of both), `columns` wide, `size` bins tall (a power of two up to 2048, 256 by default).
export function spectrogram(s: Sound, columns = 400, size = 512): Spectrogram {
  const fftSize = Math.max(64, Math.min(2048, 2 ** Math.round(Math.log2(size))));
  const n = len(s);
  const mono = new Float32Array(n);
  for (const c of s.channels) for (let i = 0; i < n; i++) mono[i] = mono[i]! + c[i]! / s.channels.length;
  const out: Float32Array[] = [];
  const win = Float32Array.from({ length: fftSize }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (fftSize - 1)));
  const re = new Float32Array(fftSize);
  const im = new Float32Array(fftSize);
  const cols = Math.max(1, columns);
  for (let x = 0; x < cols; x++) {
    const start = Math.floor(((n - fftSize) * x) / Math.max(1, cols - 1));
    for (let i = 0; i < fftSize; i++) {
      re[i] = (mono[start + i] ?? 0) * win[i]!;
      im[i] = 0;
    }
    fft(re, im);
    const col = new Float32Array(fftSize / 2);
    for (let y = 0; y < col.length; y++) col[y] = Math.max(-100, 20 * Math.log10((Math.hypot(re[y]!, im[y]!) * 2) / fftSize + 1e-9));
    out.push(col);
  }
  return { columns: out, maxHz: s.rate / 2, seconds: n / s.rate };
}
