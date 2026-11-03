// A small PNG writer that needs no browser: 8-bit RGBA, no filtering, and "stored" (uncompressed) deflate blocks.
// The files are bigger than a compressing encoder's, which suits a model texture embedded in a .glb (a 256x256
// picture is 256 KB), and the exporter can run anywhere, including the tests.

import type { Raster } from "./pixels";

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1, b = 0;
  for (const x of bytes) {
    a = (a + x) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

export function encodePng(r: Raster): Uint8Array {
  // one filter byte (0 = none) in front of each row
  const raw = new Uint8Array(r.h * (r.w * 4 + 1));
  for (let y = 0; y < r.h; y++) raw.set(r.data.subarray(y * r.w * 4, (y + 1) * r.w * 4), y * (r.w * 4 + 1) + 1);
  const blocks = Math.max(1, Math.ceil(raw.length / 65535));
  const z = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  z[0] = 0x78;
  z[1] = 0x01;
  let at = 2;
  for (let i = 0; i < blocks; i++) {
    const chunk = raw.subarray(i * 65535, Math.min(raw.length, (i + 1) * 65535));
    z[at++] = i === blocks - 1 ? 1 : 0;
    z[at++] = chunk.length & 255;
    z[at++] = chunk.length >> 8;
    z[at++] = ~chunk.length & 255;
    z[at++] = (~chunk.length >> 8) & 255;
    z.set(chunk, at);
    at += chunk.length;
  }
  new DataView(z.buffer).setUint32(at, adler32(raw));

  const chunk = (type: string, body: Uint8Array) => {
    const out = new Uint8Array(12 + body.length);
    const v = new DataView(out.buffer);
    v.setUint32(0, body.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(body, 8);
    v.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, r.w);
  v.setUint32(4, r.h);
  ihdr[8] = 8; // bits per channel
  ihdr[9] = 6; // RGBA
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", z), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
