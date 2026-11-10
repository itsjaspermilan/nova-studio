// Loudness in LUFS (ITU-R BS.1770: K-weighting, 400 ms blocks overlapping by 75 percent, and the two gates) and a peak limiter. Pure functions on
// channels of samples; the song renderer uses them for a loudness target and a ceiling, and the mixer shows the number.

interface Biquad {
  b: [number, number, number];
  a: [number, number];
}

/// The two K-weighting filters for a sample rate: a high shelf (+4 dB above about 1.7 kHz) then a high-pass near 38 Hz (formulas as in BS.1770,
/// generalised to any rate).
function kWeighting(rate: number): Biquad[] {
  const shelf = (() => {
    const f0 = 1681.974450955533;
    const g = 3.999843853973347;
    const q = 0.7071752369554196;
    const k = Math.tan((Math.PI * f0) / rate);
    const vh = 10 ** (g / 20);
    const vb = vh ** 0.4996667741545416;
    const a0 = 1 + k / q + k * k;
    return { b: [(vh + (vb * k) / q + k * k) / a0, (2 * (k * k - vh)) / a0, (vh - (vb * k) / q + k * k) / a0], a: [(2 * (k * k - 1)) / a0, (1 - k / q + k * k) / a0] } as Biquad;
  })();
  const high = (() => {
    const f0 = 38.13547087602444;
    const q = 0.5003270373238773;
    const k = Math.tan((Math.PI * f0) / rate);
    const a0 = 1 + k / q + k * k;
    return { b: [1, -2, 1], a: [(2 * (k * k - 1)) / a0, (1 - k / q + k * k) / a0] } as Biquad;
  })();
  return [shelf, high];
}

function filter(x: Float32Array, f: Biquad): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = f.b[0] * x[i]! + f.b[1] * x1 + f.b[2] * x2 - f.a[0] * y1 - f.a[1] * y2;
    y[i] = v;
    x2 = x1; x1 = x[i]!; y2 = y1; y1 = v;
  }
  return y;
}

/// Integrated loudness in LUFS of one or two channels (-Infinity for silence or less than one 400 ms block).
export function integratedLufs(channels: Float32Array[], rate: number): number {
  const weighted = channels.map((c) => kWeighting(rate).reduce((s, f) => filter(s, f), c));
  const block = Math.round(0.4 * rate);
  const hop = Math.round(0.1 * rate);
  const length = weighted[0]?.length ?? 0;
  if (length < block) return -Infinity;
  // mean square of each block, summed over the channels (each weighted 1)
  const energies: number[] = [];
  for (let start = 0; start + block <= length; start += hop) {
    let z = 0;
    for (const ch of weighted) {
      let sum = 0;
      for (let i = start; i < start + block; i++) sum += ch[i]! * ch[i]!;
      z += sum / block;
    }
    energies.push(z);
  }
  const lufs = (z: number) => -0.691 + 10 * Math.log10(z);
  const absolute = energies.filter((z) => z > 0 && lufs(z) > -70);
  if (!absolute.length) return -Infinity;
  const relative = lufs(absolute.reduce((a, b) => a + b, 0) / absolute.length) - 10;
  const kept = absolute.filter((z) => lufs(z) > relative);
  if (!kept.length) return -Infinity;
  return lufs(kept.reduce((a, b) => a + b, 0) / kept.length);
}

/// The loudest sample in dBFS (-Infinity for silence).
export function peakDb(channels: Float32Array[]): number {
  let p = 0;
  for (const c of channels) for (let i = 0; i < c.length; i++) p = Math.max(p, Math.abs(c[i]!));
  return p > 0 ? 20 * Math.log10(p) : -Infinity;
}

/// Brings the peaks under `ceiling` (linear, 0 to 1) in place with a smooth gain reduction: it looks about 3 ms ahead, so no peak gets through, and
/// lets go over about 80 ms. A signal already under the ceiling is not touched. Works on the channels together (one gain for both).
export function limitPeaks(channels: Float32Array[], ceiling: number, rate: number): void {
  const n = channels[0]?.length ?? 0;
  if (!n) return;
  const look = Math.max(1, Math.round(0.003 * rate));
  // the gain each sample needs
  const need = new Float32Array(n).fill(1);
  let any = false;
  for (let i = 0; i < n; i++) {
    let p = 0;
    for (const c of channels) p = Math.max(p, Math.abs(c[i]!));
    if (p > ceiling) {
      need[i] = ceiling / p;
      any = true;
    }
  }
  if (!any) return;
  // the lowest needed gain in the next `look` samples (so the reduction is in place before the peak arrives)…
  const ahead = new Float32Array(n);
  const deque: number[] = [];
  for (let i = n - 1; i >= 0; i--) {
    while (deque.length && need[deque[deque.length - 1]!]! >= need[i]!) deque.pop();
    deque.push(i);
    while (deque[0]! > i + look) deque.shift();
    ahead[i] = need[deque[0]!]!;
  }
  // …then a smooth path to it: the gain drops over the lookahead, and recovers slowly
  const release = Math.exp(-1 / (0.08 * rate));
  const gain = new Float32Array(n);
  let g = 1;
  for (let i = 0; i < n; i++) {
    const target = ahead[i]!;
    g = target < g ? g + (target - g) / look : target + (g - target) * release;
    gain[i] = g;
  }
  // a final pass so the smoothing never lets a sample over the ceiling
  for (const c of channels) {
    for (let i = 0; i < n; i++) {
      let v = c[i]! * Math.min(gain[i]!, ahead[i]!);
      if (v > ceiling) v = ceiling;
      else if (v < -ceiling) v = -ceiling;
      c[i] = v;
    }
  }
}

/// The gain in dB that brings a signal to a target loudness (0 for silence).
export function gainToLufs(channels: Float32Array[], rate: number, target: number): number {
  const now = integratedLufs(channels, rate);
  return Number.isFinite(now) ? target - now : 0;
}
