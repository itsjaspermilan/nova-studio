// The detailed people: every outfit of both styles drawn in the detailed style (the rest: makers-people.test.ts; why apart:
// makers-kit.ts).
import { describe, it } from "vitest";
import { OUTFITS } from "./character";
import { HD_OUTFITS_MORE } from "./character-hd";
import { drawsEveryPart, makersFolder } from "./makers-kit";
import { unlessPassedBefore } from "../test-cache";

const m = makersFolder();

describe("the detailed people", () => {
  it("draws every outfit of both styles", (ctx) => {
    const passed = unlessPassedBefore(ctx);
    drawsEveryPart(m, [...OUTFITS.map((x) => ({ outfit: x })), ...HD_OUTFITS_MORE.map((x) => ({ outfit: x }))]);
    passed();
  }, 240_000);
});
