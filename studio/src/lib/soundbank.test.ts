import { describe, expect, it } from "vitest";
import { MEMORY_BUDGET, budgetWords, buildSoundbank, estimateMemory, groupFileText, hintFor, jsonSoundNames, parseGroup, soundNamesIn } from "./soundbank";

const f = (path: string, size: number) => ({ path, dir: false, size });

describe("finding sound names in code", () => {
  it("reads play calls of both kinds and sound settings", () => {
    const lua = `nova.sound.play("jump")\nnova.sound.play('hit', { volume = 0.5 })\nnova.music.play("theme")\nlocal e = { sound = "boom" }\n-- nova.sound.play(name)`;
    expect(soundNamesIn(lua)).toEqual([
      { name: "jump", music: false }, { name: "hit", music: false }, { name: "theme", music: true }, { name: "boom", music: false },
    ]);
  });
  it("reads an animation's sound track from JSON", () => {
    expect(jsonSoundNames('{ "tracks": [{ "sound": "door" }, { "music": "tune" }] }').map((n) => n.name)).toEqual(["door", "tune"]);
  });
});

describe("the bank", () => {
  const files = [f("sounds/jump.wav", 1000), f("sounds/hit.wav", 5000), f("sounds/step1.wav", 800), f("sounds/step2.wav", 800), f("music/theme.ogg", 400000), f("sounds/orphan.wav", 70000), f("main.lua", 10)];
  const sources = [{ path: "main.lua", text: 'nova.sound.play("jump")\nnova.sound.play("steps")\nnova.music.play("theme")\nnova.sound.play("nope")' }];
  const groups = [{ path: "sounds/steps.group.json", sounds: ["step1", "step2"] }];
  const bank = buildSoundbank(files, sources, groups);
  it("lists where each sound is used, through groups too, and the unused ones", () => {
    const by = Object.fromEntries(bank.sounds.map((s) => [s.name, s]));
    expect(by.jump!.usedBy).toEqual(["main.lua"]);
    expect(by.step1!.inGroups).toEqual(["steps"]);
    expect(by.step1!.usedBy).toEqual(["main.lua"]);
    expect(by.theme!.streamed).toBe(true);
    expect(bank.unused.map((s) => s.name).sort()).toEqual(["hit", "orphan"]);
  });
  it("names the sounds the code asks for that do not exist, but not a group's name", () => {
    expect(bank.missing).toEqual([{ file: "main.lua", name: "nope" }]);
  });
  it("sorts by memory, biggest first, and adds it up", () => {
    expect(bank.sounds[0]!.name).toBe("theme");
    expect(bank.sounds[1]!.name).toBe("orphan");
    expect(bank.totalMemory).toBe(bank.sounds.reduce((n, s) => n + s.memory, 0));
  });
});

describe("what it costs", () => {
  it("counts a WAV as it is, a streamed Ogg as a small buffer and an Ogg effect as much bigger than the file", () => {
    expect(estimateMemory("sounds/a.wav", 1000, "effect")).toBe(1000);
    expect(estimateMemory("music/a.ogg", 5_000_000, "music")).toBe(256 * 1024);
    expect(estimateMemory("sounds/a.ogg", 1000, "effect")).toBe(11000);
  });
  it("says fine, heavy or over", () => {
    expect(budgetWords(1024 * 1024).state).toBe("fine");
    expect(budgetWords(MEMORY_BUDGET.comfortable + 1).state).toBe("heavy");
    expect(budgetWords(MEMORY_BUDGET.limit + 1).state).toBe("over");
  });
  it("hints at a long WAV and a very big effect", () => {
    const e = (path: string, size: number) => buildSoundbank([f(path, size)], [], []).sounds[0]!;
    expect(hintFor(e("sounds/long.wav", 3 * 1024 * 1024))).toContain("Ogg");
    expect(hintFor(e("sounds/ok.wav", 1000))).toBeNull();
  });
});

describe("group files", () => {
  it("writes the file the runtime reads and reads it back", () => {
    const text = groupFileText(["a", "b"], { volume: [0.8, 1], pitch: [0.95, 1.05], noRepeat: true });
    expect(JSON.parse(text)).toEqual({ sounds: ["a", "b"], volume: [0.8, 1], pitch: [0.95, 1.05], no_repeat: true });
    expect(parseGroup(text)).toEqual({ sounds: ["a", "b"] });
    expect(parseGroup("{ nope")).toBeNull();
    expect(parseGroup('{"sounds":[1]}')).toBeNull();
  });
});
