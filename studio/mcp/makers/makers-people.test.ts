// The detailed people: the runner and every enemy archetype, and every item of the detailed style (the outfits and the
// headgear: makers-people-outfits.test.ts, makers-people-hats.test.ts; why apart: makers-kit.ts).
import { describe, expect, it } from "vitest";
import { decodePng } from "../draw";
import { ITEMS } from "./character";
import { HD_ANIMS, HD_ARCHETYPES, HD_FRAME, HD_HITBOX, HD_ITEMS_MORE, HD_PIVOT } from "./character-hd";
import { CITY_DIRS, drawsEveryPart, frameOf, lightEdge, makersFolder } from "./makers-kit";
import { unlessPassedBefore } from "../test-cache";

const m = makersFolder();
const { text, use, bytes, sheet } = m;

describe("the detailed people", () => {
  it("makes the runner and every enemy archetype: every animation, the frame, the feet's box, closed outlines", (ctx) => {
    const passed = unlessPassedBefore(ctx);
    const counts = Object.fromEntries(HD_ANIMS.map(([n, c]) => [n, c]));
    expect(counts).toEqual({ idle: 4, walk: 6, attack: 4, hurt: 2, roll: 5, tell: 2, run: 8, dash_attack: 4 });
    for (const [name, recipe] of Object.entries(HD_ARCHETYPES)) {
      const said = text(use("character_make", { name, style: "detailed", ...recipe }));
      expect(said, name).toContain("hitbox = { -7, -8, 14, 8 }");
      const json = sheet(name);
      expect(json.frame_width, name).toBe(HD_FRAME);
      expect(json.frame_height, name).toBe(HD_FRAME);
      expect(json.hitbox, name).toEqual(HD_HITBOX);
      expect(json.pivot, name).toEqual(HD_PIVOT);
      expect(json.tags!.map((t) => t.name), name).toEqual(CITY_DIRS.flatMap((d) => HD_ANIMS.map(([a]) => `${a}_${d}`)));
      for (const t of json.tags!) expect(t.to - t.from + 1, `${name} ${t.name}`).toBe(counts[t.name.replace(/_(down|left|right|up)$/, "")]);
      expect(json.frames, name).toBe(4 * 35);
      if (recipe.hologram) continue; // light, not a body: no outline by design
      const png = decodePng(bytes(`sprites/${name}.png`));
      // the frames without light laid over the edge (an arc, a streak, the tell's flash): idle, walk, hurt
      for (const t of json.tags!.filter((x) => /^(idle|walk|hurt|run)_/.test(x.name))) for (let n = t.from; n <= t.to; n++) {
        expect(lightEdge(frameOf(png, json, n), HD_FRAME, HD_FRAME), `${name} frame ${n} (${t.name})`).toBeLessThan(0.06);
      }
      // the figure stands in its frame: something solid in the middle, nothing touching the frame's edge
      const idle = frameOf(png, json, 0);
      let edgeHit = 0;
      for (let k = 0; k < HD_FRAME; k++) for (const [x, y] of [[k, 0], [k, HD_FRAME - 1], [0, k], [HD_FRAME - 1, k]]) if (idle[(y! * HD_FRAME + x!) * 4 + 3]! > 0) edgeHit++;
      expect(edgeHit, `${name} touches its frame's edge`).toBe(0);
    }
    passed();
  }, 240_000);

  it("draws every item of both styles, and says what is wrong", (ctx) => {
    const passed = unlessPassedBefore(ctx);
    drawsEveryPart(m, [...ITEMS.map((i) => ({ item: i })), ...HD_ITEMS_MORE.map((i) => ({ item: i }))]);
    use("character_make", { name: "v", style: "detailed", hat: "visor", visor: "down", arms: 4, stance: "proud", pose: "wide", expression: "smile", skin: "chrome" });
    expect(() => use("character_make", { name: "x", style: "detailed", arms: 3 })).toThrow(/"arms" is 2, 4, 6/);
    expect(() => use("character_make", { name: "x", style: "detailed", stance: "slouch" })).toThrow(/"stance" is one of upright/);
    expect(() => use("character_make", { name: "x", style: "detailed", expression: "sad" })).toThrow(/"expression" is one of/);
    // the classic style keeps its own lists
    expect(() => use("character_make", { name: "x", outfit: "bellhop" })).toThrow(/"outfit" is one of/);
    passed();
  }, 240_000);
});
