// A reader for binary FBX files (version 7.x), enough to take a skinned, animated character out of one (see scripts/fbx2glb.mjs).
// FBX is a tree of nodes; each has a name, a list of typed properties and child nodes. Arrays may be zlib-compressed.
import zlib from "node:zlib";

export function parseFbx(buf) {
  const magic = "Kaydara FBX Binary  \0";
  if (buf.toString("latin1", 0, magic.length) !== magic) throw new Error("not a binary FBX file");
  const version = buf.readUInt32LE(23);
  const wide = version >= 7500; // from 7.5 on the offsets in a node record are 64 bits
  let pos = 27;
  const u32 = () => { const v = buf.readUInt32LE(pos); pos += 4; return v; };
  const u64 = () => { const v = Number(buf.readBigUInt64LE(pos)); pos += 8; return v; };
  const word = wide ? u64 : u32;
  function array(type) {
    const length = u32(), encoding = u32(), compressed = u32();
    let data = buf.subarray(pos, pos + compressed); pos += compressed;
    if (encoding === 1) data = zlib.inflateSync(data);
    const size = { f: 4, d: 8, l: 8, i: 4, b: 1 }[type];
    const out = new Array(length);
    for (let i = 0; i < length; i++) {
      out[i] = type === "f" ? data.readFloatLE(i * size) : type === "d" ? data.readDoubleLE(i * size)
        : type === "l" ? Number(data.readBigInt64LE(i * size)) : type === "i" ? data.readInt32LE(i * size) : data[i];
    }
    return out;
  }
  function property() {
    const t = String.fromCharCode(buf[pos++]);
    switch (t) {
      case "Y": { const v = buf.readInt16LE(pos); pos += 2; return v; }
      case "C": return buf[pos++] !== 0;
      case "I": { const v = buf.readInt32LE(pos); pos += 4; return v; }
      case "F": { const v = buf.readFloatLE(pos); pos += 4; return v; }
      case "D": { const v = buf.readDoubleLE(pos); pos += 8; return v; }
      case "L": { const v = Number(buf.readBigInt64LE(pos)); pos += 8; return v; }
      case "f": case "d": case "l": case "i": case "b": return array(t);
      case "S": { const n = u32(); const s = buf.toString("utf8", pos, pos + n); pos += n; return s; }
      case "R": { const n = u32(); const r = buf.subarray(pos, pos + n); pos += n; return r; }
      default: throw new Error(`unknown FBX property type ${t} at ${pos}`);
    }
  }
  function node() {
    const end = word(), count = word(); word(); const nameLength = buf[pos++];
    if (end === 0) return null;
    const name = buf.toString("latin1", pos, pos + nameLength); pos += nameLength;
    const props = [];
    for (let i = 0; i < count; i++) props.push(property());
    const children = [];
    while (pos < end) { const c = node(); if (c) children.push(c); }
    pos = end;
    return { name, props, children };
  }
  const roots = [];
  while (pos < buf.length - 32) { const n = node(); if (!n) break; roots.push(n); }
  return { version, roots };
}

export const child = (n, name) => n.children.find((c) => c.name === name);
export const childrenOf = (n, name) => n.children.filter((c) => c.name === name);
