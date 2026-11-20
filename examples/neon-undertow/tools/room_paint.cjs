const rows = [];
const W = 30, H = 18;
for (let y = 0; y < H; y++) {
  let r = "";
  for (let x = 0; x < W; x++) {
    let c = ",";
    if (y === 0 || y === H - 1 || x === 0 || x === W - 1) c = "#";
    else if (y <= 2 || y >= 15) c = "=";
    r += c;
  }
  rows.push(r.split(""));
}
const put = (x, y, c) => (rows[y][x] = c);
// cover: crates and barrels
[[6, 6], [7, 6], [6, 7]].forEach(([x, y]) => put(x, y, "C"));
[[22, 5], [22, 6], [23, 5]].forEach(([x, y]) => put(x, y, "B"));
[[14, 11], [15, 11], [14, 12]].forEach(([x, y]) => put(x, y, "C"));
[[10, 13]].forEach(([x, y]) => put(x, y, "B"));
[[24, 12], [25, 12]].forEach(([x, y]) => put(x, y, "C"));
// a pillar of wall in the north, a lamp post gap
[[18, 3], [18, 4]].forEach(([x, y]) => put(x, y, "#"));
const T = 48;
const scene = {
  version: 1, width: W * T, height: H * T, background: [5, 6, 15],
  objects: [
    { kind: "runner", name: "runner", x: 4.5 * T, y: 9.5 * T },
    { kind: "dummy", name: "dummy", x: 9.5 * T, y: 9.5 * T },
    { kind: "scrapper", name: "scrapper", x: 24.5 * T, y: 9.5 * T },
    { kind: "puddle", x: 12 * T, y: 8 * T + 16 },
    { kind: "puddle", x: 19.5 * T, y: 13.5 * T },
  ],
  tilemaps: [{
    name: "ground", tileset: "tiles", scale: 3, seed: 4,
    paint: { "#": "brick_wall", ",": "path", "=": "stone_floor", C: "crate on path", B: "barrel on path" },
    tiles: rows.map((r) => r.join("")),
  }],
};
require("fs").writeFileSync("/private/tmp/claude-501/scene.json", JSON.stringify({ name: "test_room", scene, image_out: "build/room.png" }));
