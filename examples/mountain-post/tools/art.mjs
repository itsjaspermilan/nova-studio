// The smooth 2D art (image_make): the words on the signposts, the mailboxes' numbers, BRIDGE OUT, the post office's sign, the van's
// lettering, smoke, the paper map of the valley, the minimap's disc and the "you" mark, the title. Run from the repository's root:
// scripts/env.sh node examples/mountain-post/tools/art.mjs
import { centreline } from "../../../scripts/lib/trackgen.mjs";
import { BOUNDS_EN, CREEK, GORGE, PLACES, ROADS } from "./layout.mjs";
import { tool } from "./lib.mjs";

const INK = "#3b2f25", PAPER = "#f2e6c9", BLUE = "#2f5fa6", RED = "#b9372b";
const img = (name, size, shapes, extra = {}) => tool("image_make", { name, size, shapes, ...extra }, { quiet: true }) && console.log(`made sprites/${name}.png`);

// ---- words in the world ------------------------------------------------------------------------------------------------------------------
for (const text of ["FERN LANE", "POST ROAD", "KETTLE CREEK RD"]) {
  const name = `fx/sign_${text.toLowerCase().replace(/[^a-z]+/g, "_")}`;
  img(name, [640, 110], [
    { rect: [6, 6, 628, 98], radius: 10, fill: null, stroke: { color: "#f4ede0cc", width: 4 } },
    { text, at: [320, 80], size: text.length > 12 ? 64 : 74, font: "rounded", align: "center", fill: "#f8f3e8", stroke: { color: "#f8f3e8", width: 3 } },
  ]);
}
for (const n of [3, 7]) img(`fx/num_${n}`, [128, 118], [{ rect: [4, 4, 120, 110], radius: 14, fill: "#f2ead8" }, { text: String(n), at: [64, 98], size: 104, font: "rounded", align: "center", fill: "#2c3a30" }]);
img("fx/bridge_out", [512, 186], [
  { text: "BRIDGE", at: [256, 84], size: 86, font: "comic", align: "center", fill: RED, opacity: 0.95 },
  { text: "OUT", at: [256, 172], size: 92, font: "comic", align: "center", fill: RED, opacity: 0.95 },
  { line: [[40, 104], [470, 98]], width: 5, fill: RED, opacity: 0.6, cap: "round" },
]);
img("fx/po_sign", [512, 104], [
  { text: "FERNHOLLOW", at: [256, 34], size: 28, font: "serif", align: "center", fill: "#e9dcbccc" },
  { text: "POST OFFICE", at: [256, 88], size: 52, font: "serif", align: "center", fill: "#efe2c2dd" },
]);
img("fx/van_side", [880, 200], [
  { text: "FERNHOLLOW", at: [440, 100], size: 124, font: "rounded", align: "center", fill: BLUE },
  { text: "· POST ·", at: [440, 186], size: 70, font: "rounded", align: "center", fill: RED },
]);
img("fx/puff", [64, 64], [{ circle: [32, 32, 22], fill: { radial: [32, 32, 30], stops: [[0, "#ffffffee"], [0.6, "#ffffff88"], [1, "#ffffff00"]] }, blur: 3 }]);
img("fx/mote", [16, 16], [{ circle: [8, 8, 5], fill: { radial: [8, 8, 7], stops: [[0, "#fff8e0ff"], [1, "#fff8e000"]] } }]);
img("fx/sunbeam", [64, 256], [{ rect: [0, 0, 64, 256], fill: { linear: [0, 0, 0, 256], stops: [[0, "#fff4d066"], [1, "#fff4d000"]] }, blur: 6 }]);

// ---- the paper map ------------------------------------------------------------------------------------------------------------------------
// North up, east to the right; the valley's roads in ink with their names along them, the creek, the gorge, a few hand-drawn trees, the
// post office marked. No house numbers, no mark for you, nothing that says where to go.
const MW = 1000, MH = 1100, pad = 60;
const B = BOUNDS_EN;
const sx = (e) => pad + ((e - B.e0) / (B.e1 - B.e0)) * (MW - 2 * pad);
const sy = (n) => pad + ((B.n1 - n) / (B.n1 - B.n0)) * (MH - 2 * pad);
const P = ([e, n]) => [Math.round(sx(e) * 10) / 10, Math.round(sy(n) * 10) / 10];
const lineOf = (pts, sp = 6) => centreline(pts.length < 4 ? [pts[0], ...pts, pts.at(-1)] : pts, sp, true).map((p) => P([p.x, p.z]));
const shapes = [];
shapes.push({ rect: [0, 0, MW, MH], fill: { linear: [0, 0, MW, MH], stops: [[0, "#f6ecd2"], [1, "#e9d9b4"]] } });
shapes.push({ rect: [18, 18, MW - 36, MH - 36], radius: 6, fill: null, stroke: { color: "#8a6e4a", width: 3 } });
// the gorge and the lake side beyond it
const gorge = lineOf(GORGE.points, 10);
shapes.push({ line: gorge, width: 26, fill: "#a9c6c8", cap: "round" });
shapes.push({ line: gorge, width: 3, fill: "#6a8e98", cap: "round" });
shapes.push({ text: "the lake side", at: [MW / 2 + 140, 72], size: 26, font: "serif", align: "center", fill: "#5f7f86" });
// the creek
const creek = lineOf(CREEK.points, 8);
shapes.push({ line: creek, width: 9, fill: "#a9c6c8", cap: "round" });
shapes.push({ line: creek, width: 2.5, fill: "#5f8a96", cap: "round" });
const cl = creek[Math.floor(creek.length * 0.3)];
shapes.push({ text: "Kettle Creek", at: [cl[0] + 26, cl[1]], size: 24, font: "serif", fill: "#4f7a86" });
// little trees, by a fixed scatter away from the roads
let s = 7;
const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
const roadPx = ROADS.map((r) => lineOf(r.control));
const nearRoad = (x, y) => roadPx.some((l) => l.some(([a, b]) => Math.hypot(a - x, b - y) < 46));
for (let i = 0; i < 260; i++) {
  const x = 50 + rnd() * (MW - 100), y = 110 + rnd() * (MH - 170);
  if (nearRoad(x, y) || creek.some(([a, b]) => Math.hypot(a - x, b - y) < 22)) continue;
  shapes.push({ polygon: [[x, y - 13], [x + 7, y + 4], [x - 7, y + 4]], fill: rnd() < 0.4 ? "#8fa86a" : "#6f8f5a", opacity: 0.8 });
}
// the roads: a double line of ink (a lane thinner than the main road), the bridge's short rails
ROADS.forEach((r, i) => {
  const l = roadPx[i], w = r.surface === "road_asphalt" ? 15 : 11;
  shapes.push({ line: l, width: w + 5, fill: INK, cap: "round" });
  shapes.push({ line: l, width: w, fill: r.surface === "road_asphalt" ? "#fbf4e2" : "#f1e4c4", cap: "round" });
});
// the barrier at Post Road's end, the bridge out
const end = P(ROADS[0].control.at(-1));
shapes.push({ line: [[end[0] - 16, end[1] + 2], [end[0] + 16, end[1] + 2]], width: 6, fill: RED, cap: "round" });
shapes.push({ text: "bridge out", at: [end[0] + 24, end[1] + 10], size: 22, font: "serif", fill: RED });
// the road names, beside each road
const label = (text, at, rot = 0, size = 30) => shapes.push({ text, at, size, font: "serif", fill: INK, align: "center", ...(rot ? {} : {}) });
label("Post Road", [P([-20, 60])[0] - 92, P([-20, 60])[1]]);
label("Fern Lane", [P([-80, -50])[0] - 10, P([-80, -50])[1] - 40]);
label("Kettle Creek Road", [P([110, 40])[0] + 30, P([110, 40])[1] + 48]);
// the post office: a little house and its name
const po = P(PLACES.post_office.building);
shapes.push({ rect: [po[0] - 18, po[1] - 10, 36, 24], fill: "#c9673f", stroke: { color: INK, width: 3 } });
shapes.push({ polygon: [[po[0] - 24, po[1] - 9], [po[0], po[1] - 28], [po[0] + 24, po[1] - 9]], fill: "#4f6458", stroke: { color: INK, width: 3 } });
shapes.push({ text: "Post Office", at: [po[0] - 34, po[1] + 8], size: 28, font: "serif", fill: INK, align: "right" });
// the compass and the title
shapes.push({ polygon: [[MW - 86, 150], [MW - 74, 112], [MW - 62, 150], [MW - 74, 142]], fill: INK });
shapes.push({ text: "N", at: [MW - 74, 100], size: 26, font: "serif", fill: INK, align: "center" });
shapes.push({ text: "Fernhollow", at: [96, 108], size: 64, font: "script", fill: "#5a3e2a" });
img("ui/map", [MW, MH], shapes);

// ---- the minimap's disc and the "you" mark, the button glyphs, the title ---------------------------------------------------------------
img("ui/minimap_disc", [200, 200], [
  { circle: [100, 100, 96], fill: "#2a3a30", opacity: 0.5 },
  { circle: [100, 100, 90], fill: { radial: [100, 100, 92], stops: [[0, "#cfe0b8ee"], [1, "#a9c49aee"]] } },
  { ring: [100, 100, 92, 6], fill: "#f2e6c9" },
]);
img("ui/you", [48, 48], [{ polygon: [[24, 4], [40, 42], [24, 33], [8, 42]], round: 2, fill: "#e8662e", stroke: { color: "#fffaf0", width: 4, align: "outside" } }]);
// the title's painted valley: a late-morning sky, three ranges of blue mountains, a dark wood of pines, the road winding in
{
  const W = 1920, H = 1080, sh = [];
  sh.push({ rect: [0, 0, W, H], fill: { linear: [0, 0, 0, H], stops: [[0, "#7fb2d8"], [0.55, "#cfe3ea"], [1, "#e9e1c8"]] } });
  sh.push({ circle: [1460, 250, 70], fill: "#fff6dc", glow: { blur: 60, color: "#fff2c8", spread: 20 } });
  const range = (base, amp, seed, col) => {
    const pts = [[0, H]];
    for (let x = 0; x <= W; x += 40) pts.push([x, base - amp * (0.5 + 0.5 * Math.sin(x * 0.004 * seed + seed) * Math.sin(x * 0.0017 + seed * 2)) - (x % 160 === 0 ? amp * 0.15 : 0)]);
    pts.push([W, H]);
    sh.push({ polygon: pts, fill: col });
  };
  range(620, 260, 1.3, "#9fb7cf"); range(700, 200, 2.1, "#7d9bb8"); range(790, 150, 3.3, "#5f7f88");
  // pines along the front
  for (let x = -20; x < W + 40; x += 34) {
    const hgt = 150 + ((x * 37) % 90), b = 1010 - ((x * 13) % 40);
    sh.push({ polygon: [[x, b - hgt], [x + 38, b], [x - 38, b]], fill: (x / 34) % 2 ? "#2f5a3e" : "#386a48" });
  }
  sh.push({ rect: [0, 0, W, H], fill: { linear: [0, 0, 0, H], stops: [[0, "#00000000"], [0.7, "#00000000"], [1, "#1a120c66"]] } });
  img("ui/title_bg", [W, H], sh);
}
img("ui/logo", [1100, 320], [
  { text: "Fernhollow Post", at: [550, 196], size: 116, font: "script", align: "center", fill: "#fbf3df", shadow: { offset: [0, 5], blur: 12, color: "#1e2a3acc" } },
  { text: "a mountain post office", at: [550, 270], size: 36, font: "serif", align: "center", fill: "#fbf3df", shadow: { offset: [0, 2], blur: 6, color: "#1e2a3acc" } },
]);
img("ui/parcel_icon", [96, 80], [
  { rect: [8, 14, 80, 58], radius: 6, fill: "#c99b67", stroke: { color: "#6b4a2c", width: 3 } },
  { rect: [43, 14, 10, 58], fill: "#efe4cc" }, { rect: [8, 38, 80, 10], fill: "#efe4cc" },
]);
img("ui/letter_icon", [96, 80], [
  { rect: [8, 14, 80, 54], radius: 4, fill: "#f2ead8", stroke: { color: "#8a6e4a", width: 3 } },
  { line: [[10, 18], [48, 46], [86, 18]], width: 3, fill: "#8a6e4a" }, { rect: [66, 22, 14, 16], fill: RED },
]);
