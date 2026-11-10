import { describe, expect, it } from "vitest";
import { MAX_IMPORT_SECONDS, fitForProject, freeName, kindFor, safeSoundName, seconds } from "./audio-import";

const sound = (secs: number, channels = 2, rate = 1000) => ({ rate, channels: Array.from({ length: channels }, () => new Float32Array(Math.round(secs * rate))) });

describe("names", () => {
  it("makes a safe name from a file name and never an empty one", () => {
    expect(safeSoundName("My Jump (final).MP3")).toBe("My_Jump_final");
    expect(safeSoundName("C:\\sounds\\boom.wav")).toBe("boom");
    expect(safeSoundName("/tmp/a.b.ogg")).toBe("a_b");
    expect(safeSoundName("???.wav")).toBe("sound");
    expect(safeSoundName("x".repeat(100) + ".wav").length).toBe(48);
  });
  it("finds a free name", () => {
    expect(freeName("a", () => false)).toBe("a");
    expect(freeName("a", (n) => n === "a" || n === "a_2")).toBe("a_3");
  });
});

describe("fitting a sound", () => {
  it("keeps two channels at most and cuts what is too long, and says so", () => {
    const r = fitForProject(sound(5, 6));
    expect(r.sound.channels).toHaveLength(2);
    expect(r.mixedDown).toBe(true);
    expect(r.cut).toBe(false);
    const long = fitForProject(sound(MAX_IMPORT_SECONDS + 10, 1), MAX_IMPORT_SECONDS);
    expect(long.cut).toBe(true);
    expect(seconds(long.sound)).toBe(MAX_IMPORT_SECONDS);
    expect(fitForProject(sound(3, 1)).sound.channels).toHaveLength(1);
  });
  it("calls a long sound music", () => {
    expect(kindFor(sound(2))).toBe("effect");
    expect(kindFor(sound(20))).toBe("music");
  });
});
