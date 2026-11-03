// The rally game's pixel sprites, drawn with text and written by the Nova MCP server's `sprite_write` tool.
import { withServer } from "./mcp.mjs";

// a chequered flag waving between two poses
const flagA = [
  "..k.............",
  "..kWWkkWWkkWWkk.",
  "..kWWkkWWkkWWkk.",
  "..kkkWWkkWWkkWW.",
  "..kkkWWkkWWkkWW.",
  "..kWWkkWWkkWWkk.",
  "..kWWkkWWkkWWkk.",
  "..kkkWWkkWWkkWW.",
  "..kkkWWkkWWkkWW.",
  "..k.............",
  "..k.............",
  "..k.............",
  "..k.............",
  "..k.............",
  "..k.............",
  "..k.............",
];
const flagB = [
  "..k.............",
  "..kWWkkWWkkWWk..",
  "..kWWkkWWkkWWkk.",
  "..kkkWWkkWWkkWW.",
  "..kkkWWkkWWkkWWk",
  "..kWWkkWWkkWWkkW",
  "..kWWkkWWkkWWkk.",
  "..kkkWWkkWWkkWW.",
  "..kkkWWkkWWkkW..",
  "..k.............",
  "..k.............",
  "..k.............",
  "..k.............",
  "..k.............",
  "..k.............",
  "..k.............",
];

const medal = (a, b, c) => [
  "....rr....rr....",
  "....rr....rr....",
  ".....rr..rr.....",
  ".....rr..rr.....",
  "......rrrr......",
  ".....oooooo.....",
  "....oaaaaaao....",
  "...oaabbbbaao...",
  "...oabbccbbao...",
  "...oabcccbbao...",
  "...oabbccbbao...",
  "...oaabbbbaao...",
  "....oaaaaaao....",
  ".....oooooo.....",
  "................",
  "................",
].map((row) => row);

const arrow = ["k.......", "kk......", "kWk.....", "kWWk....", "kWWWk...", "kWWWWk..", "kWWWk...", "kWWk....", "kWk.....", "kk......", "k......."];

const seconds = ["..............", "..kkkkkkkkkkk.", ".kWWWWWWWWWWWk", ".kWWkWWkWWkWWk", ".kWWWWWWWWWWWk", "..kkkkkkkkkkk."];

await withServer(async (nova) => {
  console.log(
    await nova.call("sprite_write", {
      name: "flag",
      palette: { k: "#1f2937", W: "#f8fafc" },
      frames: [flagA, flagB],
      animations: [{ name: "wave", from: 0, to: 1 }],
      frame_ms: 260,
    }),
  );
  console.log(
    await nova.call("sprite_write", {
      name: "medal",
      palette: { r: "#d62828", o: "#7c5a10", a: "#f5d142", b: "#e3b92b", c: "#fff2a8", p: "#4b5563", s: "#d1d5db", t: "#9ca3af", u: "#f9fafb", z: "#6b3a1a", m: "#d98a4b", n: "#b8692f", q: "#f0b987" },
      frames: [medal(), medal().map((r) => r.replace(/a/g, "s").replace(/b/g, "t").replace(/c/g, "u").replace(/o/g, "p")), medal().map((r) => r.replace(/a/g, "m").replace(/b/g, "n").replace(/c/g, "q").replace(/o/g, "z"))],
      animations: [{ name: "gold", from: 0, to: 0 }, { name: "silver", from: 1, to: 1 }, { name: "bronze", from: 2, to: 2 }],
    }),
  );
  console.log(await nova.call("sprite_write", { name: "cursor", palette: { k: "#0f172a", W: "#fcd34d" }, frames: [arrow] }));
});
