// Sunny Hop's pictures, rasterised from the vectors of Kenney's New Platformer Pack (CC0) at exactly twice the size they are shown in the game's
// units (the Retroid's screen has two pixels to each, and the project's world is drawn at 1080 lines), so nothing is ever scaled up:
//   KENNEY="/path/to/Kenney Game Assets All-in-1 3.8.0" scripts/env.sh node scripts/sunny/art.mjs
// Tiles are 48 units (96 pixels), characters 96 units (192 pixels), enemies and items 48 units, bosses 144 units. Parallax layers are 540 units
// square, made at 810 pixels (1.5 per unit: soft, distant shapes, and the atlas has room for four worlds of them). The interface pieces
// (panels, buttons, stars, the stopwatch, sparkles) are drawn here from rounded shapes in the pack's style.
import fs from "node:fs";
import { join } from "node:path";
import { readSvg, draw, image, blit, bounds, writePng, polygon, roundRect, readPng } from "./svg.mjs";
import { TILE_NAMES, COLUMNS, TILE_PX, TERRAINS } from "./tileset.mjs";

const K = process.env.KENNEY;
if (!K) throw new Error("set KENNEY to the folder of the Kenney Game Assets All-in-1 bundle");
const V = join(K, "2D assets/New Platformer Pack/Vector");
const ROOT = new URL("../..", import.meta.url).pathname;
const P = join(ROOT, "examples/sunny-hop/sprites");
const only = process.argv[2]; // a part's name to make just that one
for (const d of ["", "enemies", "boss", "items", "bg", "ui", "fx"]) fs.mkdirSync(join(P, d), { recursive: true });

const cache = {};
const svg = (folder, name) => (cache[folder + name] ??= readSvg(join(V, folder, name + ".svg")));
const tileSvg = (n) => svg("Tiles", n), enemySvg = (n) => svg("Enemies", n), charSvg = (n) => svg("Characters", n), bgSvg = (n) => svg("Backgrounds", n);
const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const recolorWith = (map) => {
  const m = Object.fromEntries(Object.entries(map).map(([a, b]) => [a.toUpperCase(), hex(b)]));
  return (c) => m["#" + c.map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase()] ?? c;
};
const save = (rel, img) => { writePng(join(P, rel), img); console.log("sprites/" + rel, img.w + "x" + img.h); };
const json = (rel, data) => fs.writeFileSync(join(P, rel), JSON.stringify(data, null, 2) + "\n");

// a sheet of equal frames in one row, and its .sprite.json
function sheet(rel, frames, size, tags, ms = 140) {
  const img = image(size * frames.length, size);
  frames.forEach((f, i) => blit(img, f, i * size, 0));
  save(rel + ".png", img);
  const base = rel.split("/").pop();
  json(rel + ".sprite.json", { version: 1, image: base + ".png", frame_width: size, frame_height: size, columns: frames.length, frames: frames.length, frame_duration_ms: ms, tags });
}

const parts = {
  tiles() {
    const rows = Math.ceil(TILE_NAMES.length / COLUMNS);
    const img = image(COLUMNS * TILE_PX, rows * TILE_PX);
    TILE_NAMES.forEach((n, i) => draw(tileSvg(n), { into: img, scale: TILE_PX / 64, at: [(i % COLUMNS) * TILE_PX, Math.floor(i / COLUMNS) * TILE_PX] }));
    save("tiles.png", img);
  },

  hero() {
    const frames = ["idle", "front", "walk_a", "walk_b", "jump", "duck", "hit", "climb_a", "climb_b"].map((f) => draw(charSvg("character_yellow_" + f), { size: [192, 192] }));
    sheet("hero", frames, 192, [
      { name: "idle", from: 0, to: 0 }, { name: "front", from: 1, to: 1 }, { name: "walk", from: 2, to: 3 }, { name: "jump", from: 4, to: 4 },
      { name: "duck", from: 5, to: 5 }, { name: "hit", from: 6, to: 6 }, { name: "climb", from: 7, to: 8 },
    ], 120);
    // the hero, big, for the app's icon
    save("ui/hero_icon.png", draw(charSvg("character_yellow_jump"), { size: [512, 512] }));
    // the hero's friends on the title screen (front and jump)
    const friends = ["green", "pink", "purple", "beige"].flatMap((c) => ["front", "jump"].map((f) => draw(charSvg(`character_${c}_${f}`), { size: [192, 192] })));
    sheet("friends", friends, 192, [{ name: "green", from: 0, to: 1 }, { name: "pink", from: 2, to: 3 }, { name: "purple", from: 4, to: 5 }, { name: "beige", from: 6, to: 7 }], 400);
  },

  enemies() {
    const E = {
      slime: ["slime_normal_rest", "slime_normal_walk_a", "slime_normal_walk_b", "slime_normal_flat"],
      spikeslime: ["slime_spike_rest", "slime_spike_walk_a", "slime_spike_walk_b", "slime_spike_flat"],
      fireslime: ["slime_fire_rest", "slime_fire_walk_a", "slime_fire_walk_b", "slime_fire_flat"],
      blockslime: ["slime_block_rest", "slime_block_walk_a", "slime_block_walk_b", "slime_block_jump"],
      snail: ["snail_rest", "snail_walk_a", "snail_walk_b", "snail_shell"],
      mouse: ["mouse_rest", "mouse_walk_a", "mouse_walk_b", "mouse_rest"],
      ladybug: ["ladybug_rest", "ladybug_walk_a", "ladybug_walk_b", "ladybug_fly"],
      worm: ["worm_normal_rest", "worm_normal_move_a", "worm_normal_move_b", "worm_normal_rest"],
      frog: ["frog_rest", "frog_idle", "frog_jump", "frog_rest"],
      bee: ["bee_rest", "bee_a", "bee_b", "bee_rest"],
      fly: ["fly_rest", "fly_a", "fly_b", "fly_rest"],
      fish: ["fish_blue_rest", "fish_blue_swim_a", "fish_blue_swim_b", "fish_purple_up"],
      saw: ["saw_rest", "saw_a", "saw_b", "saw_rest"],
      crusher: ["block_rest", "block_idle", "block_fall", "block_rest"],
    };
    const tags = [{ name: "rest", from: 0, to: 0 }, { name: "walk", from: 1, to: 2 }, { name: "squashed", from: 3, to: 3 }];
    // the crusher is the pack's grass block, cut from castle stone instead
    const stone = recolorWith({ "#20B860": "#6B5A8E", "#2ECC71": "#8A79AE", "#46E087": "#A493C6", "#C66A3E": "#7F8496", "#DE7E4F": "#99A0B2", "#EE9366": "#B3B9C9" });
    for (const [name, list] of Object.entries(E)) sheet("enemies/" + name, list.map((n) => draw(enemySvg(n), { size: [96, 96], recolor: name === "crusher" ? stone : undefined })), 96, tags, 160);
  },

  boss() {
    const B = {
      king_slime: ["slime_normal_rest", "slime_normal_walk_a", "slime_normal_walk_b", "slime_normal_flat"],
      sand_snail: ["snail_rest", "snail_walk_a", "snail_walk_b", "snail_shell"],
      frost_block: ["block_rest", "block_idle", "block_fall", "block_rest"],
      fire_king: ["slime_fire_rest", "slime_fire_walk_a", "slime_fire_walk_b", "slime_fire_flat"],
    };
    const tags = [{ name: "rest", from: 0, to: 0 }, { name: "walk", from: 1, to: 2 }, { name: "squashed", from: 3, to: 3 }];
    const cold = recolorWith({ "#7F8C8D": "#8FB8DE", "#95A5A6": "#B8D8F4", "#BDC3C7": "#DFF0FF", "#576D6E": "#5A7FA6" });
    for (const [name, list] of Object.entries(B)) {
      sheet("boss/" + name, list.map((n) => draw(enemySvg(n), { size: [288, 288], recolor: name === "frost_block" ? cold : undefined })), 288, tags, 180);
    }
    // a crown for the bosses (drawn over their heads)
    const crown = image(128, 96);
    polygon(crown, [[8, 88, 8, 30, 36, 56, 64, 14, 92, 56, 120, 30, 120, 88]], [53, 53, 65]);
    polygon(crown, [[18, 78, 18, 46, 38, 66, 64, 30, 90, 66, 110, 46, 110, 78]], [255, 200, 60]);
    polygon(crown, [[18, 78, 18, 70, 110, 70, 110, 78]], [230, 160, 40]);
    for (const [cx, cy, c] of [[38, 74, [230, 70, 90]], [64, 74, [80, 170, 255]], [90, 74, [230, 70, 90]]]) polygon(crown, [roundRect(cx - 7, cy - 7, 14, 14, 7, 6)], c);
    save("boss/crown.png", crown);
  },

  items() {
    const one = (name, file = name, size = 96) => save(`items/${file}.png`, draw(tileSvg(name), { size: [size, size] }));
    for (const n of ["coin_gold", "coin_gold_side", "heart", "fireball", "spring", "spring_out", "flag_off", "block_coin", "block_coin_active", "block_exclamation", "block_exclamation_active", "sign", "bomb", "star"]) one(n);
    for (const c of ["blue", "green", "red", "yellow"]) {
      one("gem_" + c); one("key_" + c); one("lock_" + c); one("switch_" + c); one("switch_" + c + "_pressed"); one("block_" + c);
      one(`flag_${c}_a`); one(`flag_${c}_b`);
    }
    // the goal: a big flag, two tiles tall (and the checkpoint's flags are the small ones)
    for (const f of ["a", "b"]) save(`items/goal_${f}.png`, draw(tileSvg(`flag_yellow_${f}`), { size: [192, 192] }));
    // doors: two tiles tall, from the top and bottom pieces
    for (const s of ["open", "closed"]) {
      const img = image(96, 192);
      draw(tileSvg(`door_${s}_top`), { into: img, scale: 1.5, at: [0, 0] });
      draw(tileSvg(`door_${s}`), { into: img, scale: 1.5, at: [0, 96] });
      save(`items/door_${s}.png`, img);
    }
    // moving platforms, in each ground style: left, middle and right pieces
    for (const t of TERRAINS) for (const [k, p] of [["l", "horizontal_left"], ["m", "horizontal_middle"], ["r", "horizontal_right"]]) one(`terrain_${t}_${p}`, `plat_${t}_${k}`);
    one("bridge_logs", "plat_logs_m"); one("block_plank", "plat_plank_m");
  },

  bg() {
    // the far and near layers of each world (the sky and the band behind them are left out: the game draws its own sky)
    const skip01 = (i) => i <= 1, skip0 = (i) => i === 0;
    const snow = recolorWith({ "#20B860": "#9DBFE3", "#46E087": "#FFFFFF", "#2ECC71": "#E3F0FF", "#2CC987": "#CFE3F7" });
    const snowFar = recolorWith({ "#C3E3FF": "#B9D3EF", "#DDEFFF": "#D7E7F8" });
    const night = recolorWith({ "#C66A3E": "#3B2A5E", "#EE9366": "#6E4E9B", "#DE7E4F": "#56407F", "#FAD7B7": "#A58BD0", "#DDEFFF": "#4C3D78" });
    const nightFar = recolorWith({ "#DDEFFF": "#3E3168", "#C3E3FF": "#33295A" });
    const nightClouds = recolorWith({ "#DDEFFF": "#3D3066", "#FFFFFF": "#56487F" });
    const L = {
      grass_far: ["background_fade_trees", skip0], grass_near: ["background_color_hills", skip01],
      sand_far: ["background_fade_desert", skip0], sand_near: ["background_color_desert", skip01],
      snow_far: ["background_fade_trees", skip0, snowFar], snow_near: ["background_color_hills", skip01, snow],
      castle_far: ["background_fade_mushrooms", skip0, nightFar], castle_near: ["background_color_mushrooms", skip01, night],
      clouds: ["background_clouds", skip0], castle_clouds: ["background_clouds", skip0, nightClouds],
      meadow_near: ["background_color_trees", skip01],
    };
    for (const [name, [file, skip, recolor]] of Object.entries(L)) {
      const full = draw(bgSvg(file), { size: [810, 810], skip, recolor });
      // keep only the rows below the first painted one (the layer's bottom stays the square's bottom)
      const b = bounds(full);
      const img = image(810, 810 - b.y);
      blit(img, full, 0, -b.y);
      save(`bg/${name}.png`, img);
    }
    // skies: a vertical gradient each, stretched over the screen
    const SKY = { grass: ["#6EC1FF", "#DDF0FF"], sand: ["#7CC8FF", "#FFE9CF"], snow: ["#9CC4EE", "#EEF6FF"], castle: ["#1E1736", "#5B3F80"], meadow: ["#78C6FF", "#E4F4FF"] };
    for (const [name, [top, bottom]] of Object.entries(SKY)) {
      const img = image(4, 256), a = hex(top), b = hex(bottom);
      for (let y = 0; y < 256; y++) for (let x = 0; x < 4; x++) { const t = y / 255; const o = (y * 4 + x) * 4; for (let k = 0; k < 3; k++) img.px[o + k] = (a[k] + (b[k] - a[k]) * t) / 255; img.px[o + 3] = 1; }
      save(`bg/sky_${name}.png`, img);
    }
  },

  ui() {
    const INK = [53, 53, 65];
    // a panel: white, a dark outline, round corners (nine-slice with 40-pixel borders, drawn at half size)
    const panel = (fill, outline = INK) => {
      const img = image(128, 128);
      polygon(img, [roundRect(2, 2, 124, 124, 34)], outline);
      polygon(img, [roundRect(9, 9, 110, 110, 27)], fill);
      return img;
    };
    const rev = (p) => { const o = []; for (let i = p.length - 2; i >= 0; i -= 2) o.push(p[i], p[i + 1]); return o; };
    save("ui/panel.png", panel([255, 255, 255]));
    // a button: a lighter top half and a darker lip at the bottom, white so that a tint colours it
    const button = image(128, 128);
    polygon(button, [roundRect(2, 2, 124, 124, 34)], INK);
    polygon(button, [roundRect(9, 9, 110, 110, 27)], [205, 205, 205]);
    polygon(button, [roundRect(9, 9, 110, 98, 27)], [255, 255, 255]);
    save("ui/button.png", button);
    // a soft shadow panel (a dark rounded rect with no outline) for text over the game
    const shade = image(128, 128);
    polygon(shade, [roundRect(0, 0, 128, 128, 40)], [255, 255, 255]);
    save("ui/shade.png", shade);
    // a disc, a ring
    const disc = image(128, 128); polygon(disc, [roundRect(0, 0, 128, 128, 64, 24)], [255, 255, 255]); save("ui/disc.png", disc);
    const ring = image(128, 128); polygon(ring, [roundRect(0, 0, 128, 128, 64, 24), rev(roundRect(14, 14, 100, 100, 50, 24))], [255, 255, 255]);
    save("ui/ring.png", ring);
    // stars: gold with an outline, and the empty slot
    const starPts = (cx, cy, r1, r2) => { const p = []; for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + (k * Math.PI) / 5, r = k % 2 ? r2 : r1; p.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r); } return p; };
    const star = image(128, 128);
    polygon(star, [starPts(64, 68, 62, 30)], INK);
    polygon(star, [starPts(64, 68, 50, 23)], [255, 196, 40]);
    polygon(star, [starPts(64, 62, 36, 15)], [255, 226, 110]);
    save("ui/star.png", star);
    const empty = image(128, 128);
    polygon(empty, [starPts(64, 68, 62, 30)], INK);
    polygon(empty, [starPts(64, 68, 50, 23)], [120, 120, 140]);
    save("ui/star_empty.png", empty);
    // the stopwatch
    const watch = image(128, 128);
    polygon(watch, [roundRect(50, 2, 28, 22, 6)], INK);
    polygon(watch, [roundRect(10, 16, 108, 108, 54, 24)], INK);
    polygon(watch, [roundRect(20, 26, 88, 88, 44, 24)], [255, 255, 255]);
    polygon(watch, [[60, 70, 60, 36, 68, 36, 68, 70]], [230, 70, 80]);
    polygon(watch, [[60, 66, 86, 66, 86, 74, 60, 74]], INK);
    save("ui/watch.png", watch);
    // a pointer (a rounded arrow head pointing right) and a lock
    const pointer = image(96, 96);
    polygon(pointer, [[8, 8, 90, 48, 8, 88, 26, 48]], INK);
    polygon(pointer, [[18, 22, 74, 48, 18, 74, 32, 48]], [255, 255, 255]);
    save("ui/pointer.png", pointer);
    for (const n of ["hud_coin", "hud_heart", "hud_heart_empty", "hud_heart_half", "hud_key_blue", "hud_key_green", "hud_key_red", "hud_key_yellow", "hud_player_yellow", "hud_player_helmet_yellow", "lock_yellow"]) {
      save(`ui/${n}.png`, draw(tileSvg(n), { size: [96, 96] }));
    }
    for (const c of ["blue", "green", "red", "yellow"]) save(`ui/gem_${c}.png`, draw(tileSvg("gem_" + c), { size: [96, 96] }));
    // the controller's buttons (Kenney Input Prompts, Nintendo Switch set), as Potion Panic has them
    const PROMPTS = join(K, "Icons/Input Prompts/Nintendo Switch/Default");
    const copy = (from, to) => { fs.copyFileSync(join(PROMPTS, from + ".png"), join(P, "ui", to + ".png")); console.log("sprites/ui/" + to + ".png"); };
    for (const n of ["a", "b", "x", "y", "l", "r", "plus", "minus"]) copy("switch_button_" + n, "pad_" + n);
    copy("switch_dpad", "pad_dpad"); copy("switch_stick_l", "pad_stick_l");
    for (const d of ["up", "down", "left", "right", "horizontal", "vertical"]) if (fs.existsSync(join(PROMPTS, `switch_dpad_${d}.png`))) copy("switch_dpad_" + d, "pad_dpad_" + d);
  },

  fx() {
    // soft white pictures for particles, tinted by the game
    const soft = (size, power) => {
      const img = image(size, size);
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const d = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / (size / 2);
        const a = Math.max(0, 1 - d) ** power;
        const o = (y * size + x) * 4;
        img.px[o] = img.px[o + 1] = img.px[o + 2] = a; img.px[o + 3] = a;
      }
      return img;
    };
    save("fx/puff.png", (() => { const img = image(64, 64); polygon(img, [roundRect(2, 2, 60, 60, 30, 16)], [255, 255, 255]); return img; })());
    save("fx/glow.png", soft(64, 1.6));
    const sparkle = image(64, 64);
    polygon(sparkle, [[32, 0, 39, 25, 64, 32, 39, 39, 32, 64, 25, 39, 0, 32, 25, 25]], [255, 255, 255]);
    save("fx/sparkle.png", sparkle);
    const bit = image(24, 16); polygon(bit, [roundRect(0, 0, 24, 16, 4)], [255, 255, 255]); save("fx/confetti.png", bit);
    // a dirt chunk and a snowflake-ish dot for landing dust in each world
    const dot = image(24, 24); polygon(dot, [roundRect(0, 0, 24, 24, 12, 8)], [255, 255, 255]); save("fx/dot.png", dot);
  },
};

for (const [name, make] of Object.entries(parts)) if (!only || only === name) make();
