// Copies the Kenney Platformer Kit models (CC0) that Sky Garden uses into the project, with each model's texture embedded:
// the kit's .glb files point at Textures/colormap.png, and the runtime reads a .glb on its own (see the TODO).
//   node scripts/sky/kenney.mjs <folder the kit was unzipped to>
import fs from "node:fs";
import path from "node:path";

const kit = process.argv[2];
if (!kit) throw new Error("usage: node scripts/sky/kenney.mjs <unzipped kit folder>");
const from = path.join(kit, "Models/GLB format");
const to = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../examples/sky-garden/models");
const NAMES = ["block-grass-large", "block-grass-large-slope", "block-grass-large-slope-narrow", "block-grass-narrow", "block-grass-low-long", "character-oobi", "character-oodi", "jewel", "flag", "block-moving", "platform", "sign", "tree", "rocks", "flowers", "crate"];
const pad = (b, fill) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4, fill)]);

fs.mkdirSync(to, { recursive: true });
for (const name of NAMES) {
  const b = fs.readFileSync(path.join(from, name + ".glb"));
  const jsonLen = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + jsonLen).toString().trim());
  const binStart = 20 + jsonLen + 8;
  const bin = b.subarray(binStart, binStart + b.readUInt32LE(20 + jsonLen));
  let newBin = bin;
  for (const image of json.images || []) {
    if (!image.uri) continue;
    const png = fs.readFileSync(path.join(from, image.uri));
    const offset = pad(newBin, 0).length;
    newBin = Buffer.concat([pad(newBin, 0), png]);
    json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: png.length });
    delete image.uri;
    image.bufferView = json.bufferViews.length - 1;
    image.mimeType = "image/png";
  }
  // KHR_texture_transform here only restates texCoord 0 (a no-op) and the runtime warns about it: drop it
  for (const m of json.materials || []) for (const t of Object.values(m.pbrMetallicRoughness || {})) if (t && t.extensions) { delete t.extensions.KHR_texture_transform; if (!Object.keys(t.extensions).length) delete t.extensions; }
  json.extensionsUsed = (json.extensionsUsed || []).filter((e) => e !== "KHR_texture_transform");
  if (!json.extensionsUsed.length) delete json.extensionsUsed;
  json.buffers[0].byteLength = pad(newBin, 0).length;
  const j = pad(Buffer.from(JSON.stringify(json)), 0x20);
  const bn = pad(newBin, 0);
  const head = Buffer.alloc(12);
  head.write("glTF", 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + j.length + 8 + bn.length, 8);
  const c0 = Buffer.alloc(8); c0.writeUInt32LE(j.length, 0); c0.write("JSON", 4);
  const c1 = Buffer.alloc(8); c1.writeUInt32LE(bn.length, 0); c1.write("BIN\0", 4);
  fs.writeFileSync(path.join(to, name + ".glb"), Buffer.concat([head, c0, j, c1, bn]));
  console.log(name, bn.length);
}
