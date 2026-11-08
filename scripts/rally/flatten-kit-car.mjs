// The Racing Kit's race cars keep their body and wheels under one node that sits 0.35 m to the side: scripts/kenney.mjs wants the parts
// as roots, centred, to find each wheel's side. This writes a copy of each car with the parts as roots (that node's height and length kept,
// its sideways offset dropped), into a folder that scripts/kenney.mjs can then read like a kit.
//   node scripts/rally/flatten-kit-car.mjs <the kit's "GLTF format" folder> <out folder> raceCarGreen raceCarRed ...
import fs from "node:fs";
import path from "node:path";

const [src, out, ...names] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
for (const name of names) {
  const b = fs.readFileSync(path.join(src, `${name}.glb`));
  const len = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + len).toString());
  const root = json.nodes[json.scenes[0].nodes[0]];
  const t = [0, root.translation?.[1] ?? 0, root.translation?.[2] ?? 0];
  for (const k of root.children) {
    const n = json.nodes[k];
    n.translation = (n.translation ?? [0, 0, 0]).map((v, i) => v + t[i]);
  }
  json.scenes[0].nodes = root.children;
  delete root.children;
  let text = Buffer.from(JSON.stringify(json));
  text = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
  const rest = b.subarray(20 + len);
  const head = Buffer.alloc(20);
  head.write("glTF", 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(20 + text.length + rest.length, 8); head.writeUInt32LE(text.length, 12); head.write("JSON", 16);
  fs.writeFileSync(path.join(out, `${name}.glb`), Buffer.concat([head, text, rest]));
}
