// Prints the size (x, y, z) of each .glb given, from its meshes' position bounds (nodes' own transforms are applied for translation and scale only).
//   node scripts/glbsize.mjs file.glb [...]
import fs from "node:fs";
for (const f of process.argv.slice(2)) {
  const b = fs.readFileSync(f);
  const jl = b.readUInt32LE(12);
  const j = JSON.parse(b.subarray(20, 20 + jl).toString());
  let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  const visit = (ni, t, s) => {
    const n = j.nodes[ni];
    const nt = n.translation ?? [0, 0, 0], ns = n.scale ?? [1, 1, 1];
    const T = [t[0] + nt[0] * s[0], t[1] + nt[1] * s[1], t[2] + nt[2] * s[2]], S = [s[0] * ns[0], s[1] * ns[1], s[2] * ns[2]];
    if (n.mesh !== undefined) for (const p of j.meshes[n.mesh].primitives) {
      const a = j.accessors[p.attributes.POSITION];
      for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], T[i] + a.min[i] * S[i]); hi[i] = Math.max(hi[i], T[i] + a.max[i] * S[i]); }
    }
    for (const c of n.children ?? []) visit(c, T, S);
  };
  for (const r of j.scenes[j.scene ?? 0].nodes) visit(r, [0, 0, 0], [1, 1, 1]);
  console.log(f.split("/").pop().padEnd(28), hi.map((v, i) => (v - lo[i]).toFixed(2)).join(" x "), " y from", lo[1].toFixed(2));
}
