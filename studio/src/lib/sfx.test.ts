import { describe, expect, it } from "vitest";
import { DEFAULTS, PRESETS, RANGES, fromJson, mulberry32, mutate, randomFrom, render, toJson, type SfxParams } from "./sfx";
import { decodeWav, duration, encodeWav, fade, frames, fromBase64, gain, normalize, peak, reverse, toBase64, trim, trimSilence, waveformPeaks, type Sound } from "./wav";

const steady = (over: Partial<SfxParams> = {}): SfxParams => ({ ...DEFAULTS, wave: "sine", attack: 0, sustain: 1, decay: 0, punch: 0, volume: 1, ...over });
const crossings = (c: Float32Array) => c.reduce((n, x, i) => (i > 0 && c[i - 1]! < 0 !== x < 0 ? n + 1 : n), 0);
const energy = (c: Float32Array) => c.reduce((s, x) => s + x * x, 0) / c.length;

describe("synthesis", () => {
  it("is deterministic and the seed changes noise only", () => {
    const a = render({ ...PRESETS.explosion!, seed: 7 }).channels[0]!;
    const b = render({ ...PRESETS.explosion!, seed: 7 }).channels[0]!;
    const c = render({ ...PRESETS.explosion!, seed: 8 }).channels[0]!;
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).not.toEqual(Array.from(c));
    expect(Array.from(render({ ...PRESETS.coin!, seed: 1 }).channels[0]!)).toEqual(Array.from(render({ ...PRESETS.coin!, seed: 99 }).channels[0]!));
  });

  it("lasts attack + sustain + decay and stays in range", () => {
    for (const [name, p] of Object.entries(PRESETS)) {
      const s = render(p);
      expect(duration(s), name).toBeCloseTo(p.attack + p.sustain + p.decay, 1);
      expect(peak(s), name).toBeLessThanOrEqual(1);
      expect(peak(s), name).toBeGreaterThan(0.05);
    }
  });

  it("plays the pitch it was asked for", () => {
    const s = render(steady({ freq: 440, sustain: 1 }));
    expect(crossings(s.channels[0]!)).toBeGreaterThan(870);
    expect(crossings(s.channels[0]!)).toBeLessThan(890); // 440 Hz for 1 s = 880 zero crossings
  });

  it("slides: a falling slide has fewer crossings in the second half", () => {
    const c = render(steady({ slide: -1 })).channels[0]!;
    const half = Math.floor(c.length / 2);
    expect(crossings(c.slice(half))).toBeLessThan(crossings(c.slice(0, half)));
  });

  it("stops early when the pitch drops below the limit", () => {
    const full = render(steady({ slide: -2 }));
    const limited = render(steady({ slide: -2, freqLimit: 220 }));
    expect(frames(limited)).toBeLessThan(frames(full));
    expect(frames(limited)).toBeGreaterThan(0);
  });

  it("shapes the volume: attack ramps in, decay fades to silence, volume scales", () => {
    const p = steady({ attack: 0.1, sustain: 0.2, decay: 0.2, wave: "square" });
    const c = render(p).channels[0]!;
    expect(Math.abs(c[0]!)).toBeLessThan(0.01);
    expect(peak({ rate: 44100, channels: [c.slice(Math.floor(c.length * 0.45), Math.floor(c.length * 0.55))] })).toBeGreaterThan(0.95);
    expect(Math.abs(c[c.length - 1]!)).toBeLessThan(0.01);
    expect(peak(render({ ...p, volume: 0.5 }))).toBeCloseTo(peak(render(p)) / 2, 1);
  });

  it("punch makes the start louder; filters remove what they should", () => {
    const flat = render(steady({ wave: "saw", sustain: 0.5 })).channels[0]!;
    const dull = render(steady({ wave: "saw", sustain: 0.5, lowpass: 400 })).channels[0]!;
    const thin = render(steady({ wave: "saw", sustain: 0.5, highpass: 3000, freq: 100 })).channels[0]!;
    expect(energy(dull)).toBeLessThan(energy(flat));
    expect(energy(thin)).toBeLessThan(energy(flat) * 0.2);
    const punchy = render(steady({ wave: "square", sustain: 0.4, punch: 0.5, volume: 0.4 })).channels[0]!;
    expect(peak({ rate: 44100, channels: [punchy] })).toBeGreaterThan(0.4); // above the plain 0.4
  });

  it("never renders longer than the cap", () => {
    expect(duration(render(steady({ sustain: 99, decay: 99 })))).toBeLessThanOrEqual(4);
  });
});

describe("randomising and saving settings", () => {
  it("mutations stay in range and keep the sound audible", () => {
    const rng = mulberry32(5);
    for (let i = 0; i < 50; i++) {
      const m = i % 2 ? randomFrom(rng) : mutate(PRESETS.laser!, rng, 1);
      for (const key of Object.keys(RANGES) as (keyof typeof RANGES)[]) {
        expect(m[key], key).toBeGreaterThanOrEqual(RANGES[key].min);
        expect(m[key], key).toBeLessThanOrEqual(RANGES[key].max);
      }
      expect(m.sustain + m.decay).toBeGreaterThanOrEqual(0.05);
    }
  });

  it("round-trips through JSON and survives garbage", () => {
    const p = { ...PRESETS.powerup!, seed: 42 };
    expect(fromJson(toJson(p))).toEqual(p);
    expect(fromJson("nope")).toBeNull();
    expect(fromJson('{"freq": 99999, "wave": "bogus", "volume": "x"}')).toMatchObject({ freq: RANGES.freq.max, wave: DEFAULTS.wave, volume: DEFAULTS.volume });
  });
});

describe("WAV files", () => {
  const tone: Sound = { rate: 8000, channels: [Float32Array.from([0, 0.5, -0.5, 1, -1, 0.25])] };

  it("round-trips 16-bit audio, mono and stereo", () => {
    const back = decodeWav(encodeWav(tone));
    expect(back.rate).toBe(8000);
    tone.channels[0]!.forEach((x, i) => expect(back.channels[0]![i]).toBeCloseTo(x, 3));
    const stereo: Sound = { rate: 44100, channels: [Float32Array.from([0.1, 0.2]), Float32Array.from([-0.1, -0.2])] };
    const s = decodeWav(encodeWav(stereo));
    expect(s.channels).toHaveLength(2);
    expect(s.channels[1]![1]).toBeCloseTo(-0.2, 3);
  });

  it("writes a standard header the Rust side can read", () => {
    const bytes = encodeWav(tone);
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("RIFF");
    expect(bytes.length).toBe(44 + 12);
    expect(new DataView(bytes.buffer).getUint32(24, true)).toBe(8000);
  });

  it("reads other PCM depths and float", () => {
    const build = (tag: number, bits: number, body: number[]) => {
      const bytes = new Uint8Array(44 + body.length);
      const v = new DataView(bytes.buffer);
      [..."RIFF"].forEach((c, i) => v.setUint8(i, c.charCodeAt(0)));
      v.setUint32(4, 36 + body.length, true);
      [..."WAVEfmt "].forEach((c, i) => v.setUint8(8 + i, c.charCodeAt(0)));
      v.setUint32(16, 16, true); v.setUint16(20, tag, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true);
      v.setUint32(28, 8000 * bits / 8, true); v.setUint16(32, bits / 8, true); v.setUint16(34, bits, true);
      [..."data"].forEach((c, i) => v.setUint8(36 + i, c.charCodeAt(0)));
      v.setUint32(40, body.length, true);
      bytes.set(body, 44);
      return bytes;
    };
    expect(decodeWav(build(1, 8, [128, 255, 0])).channels[0]![1]).toBeCloseTo(0.99, 1);
    expect(decodeWav(build(1, 24, [0, 0, 0x40, 0, 0, 0xc0])).channels[0]).toEqual(Float32Array.from([0.5, -0.5]));
    const f = new Uint8Array(new Float32Array([0.25, -1]).buffer);
    expect(decodeWav(build(3, 32, [...f])).channels[0]).toEqual(Float32Array.from([0.25, -1]));
  });

  it("rejects what it cannot read", () => {
    expect(() => decodeWav(new Uint8Array(4))).toThrow("not a WAV");
    const noData = encodeWav(tone).slice(0, 36);
    expect(() => decodeWav(noData)).toThrow("no audio data");
    const surround = encodeWav(tone);
    new DataView(surround.buffer).setUint16(22, 6, true);
    expect(() => decodeWav(surround)).toThrow("not supported");
  });

  it("base64 round-trips bytes", () => {
    const bytes = Uint8Array.from({ length: 70000 }, (_, i) => (i * 31) & 255);
    expect(Array.from(fromBase64(toBase64(bytes)))).toEqual(Array.from(bytes));
  });
});

describe("edits", () => {
  const s: Sound = { rate: 10, channels: [Float32Array.from([0, 0, 0.5, 1, -1, 0.5, 0, 0])] };

  it("trims, reverses, scales and normalises", () => {
    expect(Array.from(trim(s, 2, 4).channels[0]!)).toEqual([0.5, 1]);
    expect(frames(trim(s, 6, 99))).toBe(2);
    expect(frames(trim(s, 5, 2))).toBe(0);
    expect(Array.from(reverse(trim(s, 2, 4)).channels[0]!)).toEqual([1, 0.5]);
    expect(peak(gain(s, 0.5))).toBe(0.5);
    expect(peak(normalize({ rate: 10, channels: [Float32Array.from([0.1, -0.2])] }))).toBeCloseTo(0.97, 5);
    expect(normalize({ rate: 10, channels: [new Float32Array(3)] }).channels[0]).toEqual(new Float32Array(3));
  });

  it("fades in and out, and trims silence", () => {
    const ones: Sound = { rate: 10, channels: [new Float32Array(10).fill(1)] };
    const f = fade(ones, 0.4, 0.4).channels[0]!;
    expect(f[0]).toBe(0);
    expect(f[2]).toBeCloseTo(0.5);
    expect(f[5]).toBe(1);
    expect(f[9]).toBe(0);
    expect(Array.from(trimSilence(s).channels[0]!)).toEqual([0.5, 1, -1, 0.5]);
    expect(frames(trimSilence({ rate: 10, channels: [new Float32Array(5)] }))).toBe(0);
  });

  it("summarises a waveform per column", () => {
    const p = waveformPeaks(s, 4);
    expect(p).toHaveLength(4);
    expect(p[1]).toEqual({ min: 0, max: 1 });
    expect(p[2]).toEqual({ min: -1, max: 0.5 });
  });
});
