// Copies models from a Kenney kit (CC0, https://kenney.nl/assets) into a project's models/ folder, ready for the runtime:
// the kit's .glb files point at Textures/colormap.png, and the runtime reads a .glb on its own (see the TODO), so the texture is
// embedded; two extensions that only restate the defaults or that the runtime warns about are dropped.
//
//   node scripts/kenney.mjs <unzipped kit folder> <project folder> <model name>...
//   e.g. unzip examples/kenney_car-kit.zip -d /tmp/car-kit
//        node scripts/kenney.mjs /tmp/car-kit examples/stress sedan taxi suv
//
// A model name is the file's name without .glb; it is looked for anywhere under the kit (a "GLB format" or "GLTF format"
// folder first). Put the kit's License.txt in licenses/ yourself (see licenses/kenney-platformer-kit.txt).
import fs from "node:fs";
import path from "node:path";

const [kit, project, ...names] = process.argv.slice(2);
if (!kit || !project || names.length === 0) {
  throw new Error("usage: node scripts/kenney.mjs <unzipped kit folder> <project folder> <model name>...");
}
const out = path.join(project, "models");
const pad = (b, fill) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4, fill)]);

function find(name) {
  const hits = [];
  (function walk(d) {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (f === name + ".glb") hits.push(p);
    }
  })(kit);
  hits.sort((a, b) => Number(/GLB|GLTF/i.test(b)) - Number(/GLB|GLTF/i.test(a)));
  if (!hits.length) throw new Error(`no ${name}.glb under ${kit}`);
  return hits[0];
}

fs.mkdirSync(out, { recursive: true });
for (const name of names) {
  const file = find(name);
  const b = fs.readFileSync(file);
  const jsonLen = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + jsonLen).toString().trim());
  const binStart = 20 + jsonLen + 8;
  let bin = b.subarray(binStart, binStart + b.readUInt32LE(20 + jsonLen));
  for (const image of json.images || []) {
    if (!image.uri) continue;
    const candidates = [path.join(path.dirname(file), image.uri), path.join(kit, image.uri)];
    const found = candidates.find((c) => fs.existsSync(c));
    if (!found) throw new Error(`${name}: texture ${image.uri} not found`);
    const png = fs.readFileSync(found);
    const offset = pad(bin, 0).length;
    bin = Buffer.concat([pad(bin, 0), png]);
    json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: png.length });
    delete image.uri;
    image.bufferView = json.bufferViews.length - 1;
    image.mimeType = "image/png";
  }
  const DROP = ["KHR_texture_transform", "KHR_materials_unlit"];
  for (const m of json.materials || []) {
    for (const holder of [m, ...Object.values(m.pbrMetallicRoughness || {}), m.normalTexture, m.occlusionTexture, m.emissiveTexture]) {
      if (holder && typeof holder === "object" && holder.extensions) {
        for (const e of DROP) delete holder.extensions[e];
        if (!Object.keys(holder.extensions).length) delete holder.extensions;
      }
    }
  }
  for (const key of ["extensionsUsed", "extensionsRequired"]) {
    if (json[key]) json[key] = json[key].filter((e) => !DROP.includes(e));
    if (json[key] && !json[key].length) delete json[key];
  }
  json.buffers[0].byteLength = pad(bin, 0).length;
  const j = pad(Buffer.from(JSON.stringify(json)), 0x20);
  const bn = pad(bin, 0);
  const head = Buffer.alloc(12);
  head.write("glTF", 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + 8 + j.length + 8 + bn.length, 8);
  const c0 = Buffer.alloc(8);
  c0.writeUInt32LE(j.length, 0);
  c0.write("JSON", 4);
  const c1 = Buffer.alloc(8);
  c1.writeUInt32LE(bn.length, 0);
  c1.write("BIN\0", 4);
  fs.writeFileSync(path.join(out, name + ".glb"), Buffer.concat([head, c0, j, c1, bn]));
  console.log(name.padEnd(28), bn.length, "bytes of data");
}
