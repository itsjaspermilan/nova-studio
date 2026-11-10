import { describe, expect, it } from "vitest";
import { encodeApng } from "./apng";
import { crc32 } from "./png-encode";
import { newRaster, setPixel } from "./pixels";

function chunks(png: Uint8Array) {
  const v = new DataView(png.buffer, png.byteOffset);
  const out: { type: string; body: Uint8Array }[] = [];
  let at = 8;
  while (at < png.length) {
    const len = v.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    expect(v.getUint32(at + 8 + len), `${type} crc`).toBe(crc32(png.subarray(at + 4, at + 8 + len)));
    out.push({ type, body: png.subarray(at + 8, at + 8 + len) });
    at += 12 + len;
  }
  return out;
}

describe("animated PNG", () => {
  const frame = (x: number) => {
    const r = newRaster(4, 3);
    setPixel(r, x, 0, [255, 0, 0, 255]);
    return r;
  };

  it("writes the animation header, a frame control per frame, the first frame as the image and the rest as frame data", () => {
    const png = encodeApng([{ picture: frame(0), ms: 100 }, { picture: frame(1), ms: 250 }, { picture: frame(2), ms: 40 }], 3);
    const cs = chunks(png);
    expect(cs.map((c) => c.type)).toEqual(["IHDR", "acTL", "fcTL", "IDAT", "fcTL", "fdAT", "fcTL", "fdAT", "IEND"]);
    const actl = new DataView(cs[1]!.body.buffer, cs[1]!.body.byteOffset);
    expect([actl.getUint32(0), actl.getUint32(4)]).toEqual([3, 3]);
    const fctls = cs.filter((c) => c.type === "fcTL").map((c) => new DataView(c.body.buffer, c.body.byteOffset));
    expect(fctls.map((v) => v.getUint16(20))).toEqual([100, 250, 40]);
    expect(fctls.every((v) => v.getUint16(22) === 1000)).toBe(true);
    // sequence numbers run 0,1,2,3,4 across fcTL and fdAT in file order
    const seqs = cs.filter((c) => c.type === "fcTL" || c.type === "fdAT").map((c) => new DataView(c.body.buffer, c.body.byteOffset).getUint32(0));
    expect(seqs).toEqual([0, 1, 2, 3, 4]);
  });

  it("refuses no frames and frames of different sizes", () => {
    expect(() => encodeApng([])).toThrow();
    expect(() => encodeApng([{ picture: newRaster(2, 2), ms: 10 }, { picture: newRaster(3, 2), ms: 10 }])).toThrow();
  });
});
