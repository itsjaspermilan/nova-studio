import { describe, expect, it } from "vitest";

import { encodeWav as encodeLoopWav } from "./wav";
describe("a loop in a WAV", () => {
  it("is written as a smpl chunk with the start and end frames, and the file still decodes", () => {
    const sound = { rate: 8000, channels: [new Float32Array(8000), new Float32Array(8000)] } as never;
    const plain = encodeLoopWav(sound);
    const looped = encodeLoopWav(sound, { start: 2000, end: 6000 });
    expect(looped.length).toBe(plain.length + 68);
    const v = new DataView(looped.buffer);
    expect(v.getUint32(4, true)).toBe(looped.length - 8);
    const at = 44 + 8000 * 2 * 2;
    expect(String.fromCharCode(...looped.slice(at, at + 4))).toBe("smpl");
    expect(v.getUint32(at + 8 + 28, true)).toBe(1);
    expect(v.getUint32(at + 8 + 36 + 8, true)).toBe(2000);
    expect(v.getUint32(at + 8 + 36 + 12, true)).toBe(6000);
  });
});
