// WAV files: decode PCM (8/16/24/32-bit) and float32, encode 16-bit PCM, and the simple edits the
// sound editor offers. Samples are floats in -1..1, one array per channel.

export interface Sound {
  rate: number;
  channels: Float32Array[];
}

export const frames = (s: Sound) => s.channels[0]?.length ?? 0;
export const duration = (s: Sound) => frames(s) / s.rate;

const text = (v: DataView, at: number, len: number) => String.fromCharCode(...Array.from({ length: len }, (_, i) => v.getUint8(at + i)));

export function decodeWav(bytes: Uint8Array): Sound {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 12 || text(v, 0, 4) !== "RIFF" || text(v, 8, 4) !== "WAVE") throw new Error("not a WAV file");
  let fmt: { tag: number; channels: number; rate: number; bits: number } | null = null;
  let data: { at: number; len: number } | null = null;
  for (let at = 12; at + 8 <= bytes.length; ) {
    const id = text(v, at, 4);
    const len = v.getUint32(at + 4, true);
    const body = at + 8;
    if (id === "fmt ") {
      let tag = v.getUint16(body, true);
      if (tag === 0xfffe && len >= 26) tag = v.getUint16(body + 24, true); // WAVE_FORMAT_EXTENSIBLE: the real tag is in the sub-format
      fmt = { tag, channels: v.getUint16(body + 2, true), rate: v.getUint32(body + 4, true), bits: v.getUint16(body + 14, true) };
    } else if (id === "data") data = { at: body, len: Math.min(len, bytes.length - body) };
    at = body + len + (len & 1);
  }
  if (!fmt || !data) throw new Error("the WAV file has no audio data");
  if (fmt.channels < 1 || fmt.channels > 2) throw new Error(`${fmt.channels} channels is not supported; use mono or stereo`);
  const float = fmt.tag === 3;
  if (!(fmt.tag === 1 || float) || !(float ? fmt.bits === 32 : [8, 16, 24, 32].includes(fmt.bits))) throw new Error(`${fmt.bits}-bit format ${fmt.tag} is not supported`);
  const width = fmt.bits / 8;
  const count = Math.floor(data.len / (width * fmt.channels));
  const channels = Array.from({ length: fmt.channels }, () => new Float32Array(count));
  for (let i = 0; i < count; i++) {
    for (let c = 0; c < fmt.channels; c++) {
      const p = data.at + (i * fmt.channels + c) * width;
      let x: number;
      if (float) x = v.getFloat32(p, true);
      else if (fmt.bits === 8) x = (v.getUint8(p) - 128) / 128;
      else if (fmt.bits === 16) x = v.getInt16(p, true) / 32768;
      else if (fmt.bits === 24) x = (((v.getUint8(p + 2) << 24) | (v.getUint8(p + 1) << 16) | (v.getUint8(p) << 8)) >> 8) / 8388608;
      else x = v.getInt32(p, true) / 2147483648;
      channels[c]![i] = x;
    }
  }
  return { rate: fmt.rate, channels };
}

/// 16-bit PCM, interleaved. Values outside -1..1 are clipped.
export function encodeWav(s: Sound): Uint8Array {
  const n = frames(s);
  const ch = s.channels.length;
  const out = new Uint8Array(44 + n * ch * 2);
  const v = new DataView(out.buffer);
  const put = (at: number, str: string) => [...str].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  put(0, "RIFF");
  v.setUint32(4, 36 + n * ch * 2, true);
  put(8, "WAVE");
  put(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, ch, true);
  v.setUint32(24, s.rate, true);
  v.setUint32(28, s.rate * ch * 2, true);
  v.setUint16(32, ch * 2, true);
  v.setUint16(34, 16, true);
  put(36, "data");
  v.setUint32(40, n * ch * 2, true);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const x = Math.max(-1, Math.min(1, s.channels[c]![i]!));
      v.setInt16(44 + (i * ch + c) * 2, Math.round(x < 0 ? x * 32768 : x * 32767), true);
    }
  }
  return out;
}

export function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
export const fromBase64 = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

const map = (s: Sound, f: (c: Float32Array) => Float32Array): Sound => ({ rate: s.rate, channels: s.channels.map(f) });

/// Keeps frames [from, to).
export function trim(s: Sound, from: number, to: number): Sound {
  const a = Math.max(0, Math.min(from, frames(s)));
  const b = Math.max(a, Math.min(to, frames(s)));
  return map(s, (c) => c.slice(a, b));
}

/// Linear fade over the first `inSec` and last `outSec` seconds.
export function fade(s: Sound, inSec: number, outSec: number): Sound {
  const n = frames(s);
  const fi = Math.round(inSec * s.rate);
  const fo = Math.round(outSec * s.rate);
  return map(s, (c) => {
    const o = new Float32Array(c);
    for (let i = 0; i < n; i++) {
      let g = 1;
      if (fi > 0 && i < fi) g = Math.min(g, i / fi);
      if (fo > 0 && i >= n - fo) g = Math.min(g, (n - 1 - i) / fo);
      o[i] = c[i]! * g;
    }
    return o;
  });
}

export const peak = (s: Sound) => s.channels.reduce((m, c) => c.reduce((mm, x) => Math.max(mm, Math.abs(x)), m), 0);

/// Scales so the loudest sample reaches `target` (silence stays silent).
export function normalize(s: Sound, target = 0.97): Sound {
  const p = peak(s);
  return p === 0 ? s : gain(s, target / p);
}

export function gain(s: Sound, g: number): Sound {
  return map(s, (c) => c.map((x) => x * g));
}

export function reverse(s: Sound): Sound {
  return map(s, (c) => new Float32Array(c).reverse());
}

/// Removes leading and trailing samples quieter than `threshold`.
export function trimSilence(s: Sound, threshold = 0.01): Sound {
  const n = frames(s);
  const loud = (i: number) => s.channels.some((c) => Math.abs(c[i]!) > threshold);
  let a = 0;
  while (a < n && !loud(a)) a++;
  let b = n;
  while (b > a && !loud(b - 1)) b--;
  return trim(s, a, b);
}

/// One min/max pair per pixel column, for drawing a waveform.
export function waveformPeaks(s: Sound, columns: number): { min: number; max: number }[] {
  const n = frames(s);
  return Array.from({ length: columns }, (_, x) => {
    const a = Math.floor((x * n) / columns);
    const b = Math.max(a + 1, Math.floor(((x + 1) * n) / columns));
    let min = 0;
    let max = 0;
    for (const c of s.channels) for (let i = a; i < b && i < n; i++) {
      min = Math.min(min, c[i]!);
      max = Math.max(max, c[i]!);
    }
    return { min, max };
  });
}
