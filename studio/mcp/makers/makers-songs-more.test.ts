// The second half of the song moods (the first: makers-songs.test.ts; why they are apart: makers-kit.ts).
import { describe, it } from "vitest";
import { checkMood, makersFolder } from "./makers-kit";
import { programs } from "../server";
import { unlessPassedBefore } from "../test-cache";
import { MOOD_NAMES } from "./song";

const m = makersFolder();

describe("sounds and songs by what they are for", () => {
  it("makes a looping song for every mood (the second half) that passes sound_report and stays an ordinary song", (ctx) => {
    const passed = unlessPassedBefore(ctx, programs.nova, programs.ogg);
    for (const mood of MOOD_NAMES.slice(Math.ceil(MOOD_NAMES.length / 2))) checkMood(m, mood);
    passed();
  }, 120_000); // (each mood rendered, a minute of music each, and reported: half a minute alone, more when the suite runs at once)
});
