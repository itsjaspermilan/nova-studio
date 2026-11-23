// The detailed people: every headgear of both styles drawn in the detailed style (the rest: makers-people.test.ts; why apart:
// makers-kit.ts).
import { describe, it } from "vitest";
import { HATS } from "./character";
import { HD_HATS_MORE } from "./character-hd";
import { drawsEveryPart, makersFolder } from "./makers-kit";
import { unlessPassedBefore } from "../test-cache";

const m = makersFolder();

describe("the detailed people", () => {
  it("draws every headgear of both styles", (ctx) => {
    const passed = unlessPassedBefore(ctx);
    drawsEveryPart(m, [...HATS.map((x) => ({ hat: x })), ...HD_HATS_MORE.map((x) => ({ hat: x }))]);
    passed();
  }, 240_000);
});
