// A spectrum analyser: how much of each pitch range a sound holds. A fast Fourier transform of overlapping windows, averaged, folded into bands spaced evenly on a log
// scale (the way pitch is heard), in dB.

/// In-place radix-2 FFT of `re`/`im` (the length must be a power of two).
export function fft(re: Float64Array, im: Float64Array): void {
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
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
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

export interface Band {
  /// Centre of the band in Hz.
  hz: number;
  /// Level in dB below full scale (a full-scale sine reads about 0).
  db: number;
}

/// The average spectrum of `samples` (mono) as `bands` log-spaced bands from `lowHz` to `highHz`: windows of `size` samples (a power of two) with half overlap, Hann
/// weighted, power-averaged. Silence reads -120.
export function spectrum(samples: Float32Array, rate: number, bands = 48, lowHz = 30, highHz = 16000, size = 2048): Band[] {
  const top = Math.min(highHz, rate / 2);
  const power = new Float64Array(size / 2);
  let frames = 0;
  const hann = Float64Array.from({ length: size }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size));
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const hop = size / 2;
  for (let at = 0; at + size <= samples.length || (frames === 0 && at === 0); at += hop) {
    for (let i = 0; i < size; i++) {
      re[i] = (samples[at + i] ?? 0) * hann[i]!;
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k < size / 2; k++) power[k] = power[k]! + re[k]! * re[k]! + im[k]! * im[k]!;
    frames++;
    if (at + size > samples.length) break;
  }
  const out: Band[] = [];
  const binHz = rate / size;
  // a full-scale sine puts amplitude size/4 (Hann: half of size/2) in its bin, so power (size/4)^2
  const ref = (size / 4) ** 2;
  for (let b = 0; b < bands; b++) {
    const f0 = lowHz * (top / lowHz) ** (b / bands);
    const f1 = lowHz * (top / lowHz) ** ((b + 1) / bands);
    const k0 = Math.max(1, Math.floor(f0 / binHz));
    const k1 = Math.max(k0, Math.min(size / 2 - 1, Math.ceil(f1 / binHz) - 1));
    let peak = 0;
    for (let k = k0; k <= k1; k++) peak = Math.max(peak, power[k]! / Math.max(1, frames));
    out.push({ hz: Math.sqrt(f0 * f1), db: peak > 0 ? Math.max(-120, 10 * Math.log10(peak / ref)) : -120 });
  }
  return out;
}

/// Where the loudest band is.
export const loudestBand = (bands: Band[]): Band | null => bands.reduce<Band | null>((m, b) => (!m || b.db > m.db ? b : m), null);
