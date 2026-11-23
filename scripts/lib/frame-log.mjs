// Summarises a NOVA_FRAME_LOG file (one line a frame: frame measured_ms given_ms update_ms lua_ms acquire_ms render_ms present_ms):
// how evenly the game was stepped, and where each frame's time went. The first 120 frames (loading) are left out.
//   node scripts/lib/frame-log.mjs frames.txt
import fs from "node:fs";
const rows = fs.readFileSync(process.argv[2], "utf8").trim().split("\n").slice(1).map((l) => l.split(" ").map(Number)).filter((r) => r[0] > 120);
const col = (i) => rows.map((r) => r[i]);
const hist = (xs, w) => { const h = {}; for (const x of xs) { const b = Math.round(x / w) * w; h[b] = (h[b] || 0) + 1; } return Object.entries(h).sort((a, b) => a[0] - b[0]).map(([k, v]) => `${(+k).toFixed(1)}:${v}`).join("  "); };
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor((s.length - 1) * p)].toFixed(2); };
console.log("frames", rows.length);
console.log("measured hist (2ms bins):", hist(col(1), 2));
console.log("given hist   (2ms bins):", hist(col(2), 2));
for (const [i, n] of [[3, "update"], [4, "lua"], [5, "acquire"], [6, "render"], [7, "present"]]) console.log(n.padEnd(8), "p50", q(col(i), 0.5), "p95", q(col(i), 0.95), "max", q(col(i), 1));
const g = col(2); let uneven = 0; for (let i = 1; i < g.length; i++) if (Math.abs(g[i] - g[i - 1]) > 2) uneven++;
console.log("frames whose given step differs from the previous by >2 ms:", uneven, `(${(100 * uneven / g.length).toFixed(1)}%)`);
console.log("first 40 measured:", col(1).slice(0, 40).map((x) => x.toFixed(1)).join(" "));
console.log("first 40 acquire :", col(5).slice(0, 40).map((x) => x.toFixed(1)).join(" "));
