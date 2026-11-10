import { describe, expect, it } from "vitest";
import { encodeApng } from "./apng";
import { encodeGif } from "./gif";
import { docFromFrames, importAnimation } from "./sprite-import";
import { getPixel, newRaster, setPixel } from "./pixels";

const frame = (x: number) => {
  const r = newRaster(4, 3);
  setPixel(r, x, 1, [255, 0, 0, 255]);
  return r;
};

describe("opening other programs' files", () => {
  it("makes a sprite from the frames of a GIF, with their times", async () => {
    const i = await importAnimation(encodeGif([{ raster: frame(0), ms: 60 }, { raster: frame(2), ms: 140 }], true));
    expect(i.what).toContain("GIF of 2 frames");
    expect([i.doc.fw, i.doc.fh, i.doc.frames.length]).toEqual([4, 3, 2]);
    expect(i.doc.durations).toEqual([60, 140]);
    expect(getPixel(i.doc.frames[1]!, 2, 1)).toEqual([255, 0, 0, 255]);
    expect(i.doc.layers).toHaveLength(1);
    expect(i.doc.tags).toHaveLength(1);
  });
  it("opens an animated PNG the same way", async () => {
    const i = await importAnimation(encodeApng([{ picture: frame(1), ms: 90 }, { picture: frame(3), ms: 30 }], 0));
    expect(i.what).toContain("animated PNG");
    expect(i.doc.durations).toEqual([90, 30]);
    expect(getPixel(i.doc.layers[0]!.cels[0]!, 1, 1)).toEqual([255, 0, 0, 255]);
  });
  it("tells a Pixelorama project (a zip) what to do instead, and refuses anything else", async () => {
    await expect(importAnimation(Uint8Array.from([0x50, 0x4b, 3, 4, 0, 0, 0, 0, 0, 0]))).rejects.toThrow(/Pixelorama/);
    await expect(importAnimation(new Uint8Array(20))).rejects.toThrow(/not a GIF, PNG or Aseprite/);
    await expect(importAnimation(new Uint8Array(3))).rejects.toThrow(/too short/);
  });
  it("makes a document from frames, with a minimum time per frame", () => {
    const { doc } = docFromFrames([{ raster: frame(0), ms: 1 }]);
    expect(doc.durations).toEqual([10]);
  });
});
