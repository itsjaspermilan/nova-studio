import { describe, expect, it } from "vitest";
import { entityPath, parseEntitySource, resolveEntity } from "./entity-info";

describe("parseEntitySource", () => {
  it("reads the sprite, pivot and screen flag from the usual shapes", () => {
    expect(parseEntitySource(`local P = nova.entity { sprite = "player", tags = {"hero"} }\nreturn P`)?.look).toEqual({ sprite: "player" });
    expect(parseEntitySource(`return nova.entity({ sprite = 'crate', pivot = { 0.5, 1 }, screen = false })`)?.look).toEqual({ sprite: "crate", pivot: [0.5, 1], screen: false });
    expect(parseEntitySource(`local E = nova.entity {\n  hp = 3,\n  hitbox = { 0, 0, 8, 8 },\n  sprite = "slime",\n}`)?.look.sprite).toBe("slime");
  });

  it("ignores comments, nested tables and other mentions of 'sprite'", () => {
    expect(parseEntitySource(`-- sprite = "old"\nlocal E = nova.entity { tags = { sprite = "nope" }, hp = 1 }`)?.look).toEqual({});
    expect(parseEntitySource(`--[[ sprite = "x" ]]\nlocal E = nova.entity { sprite = "y" }`)?.look.sprite).toBe("y");
    expect(parseEntitySource(`local E = nova.entity { }\nfunction E:draw() nova.sprite("other", 1, 2) end`)?.look).toEqual({});
  });

  it("notes the parent class and says nothing when there is no entity", () => {
    expect(parseEntitySource(`return nova.entity(require("entities.enemy"), { hp = 500 })`)).toEqual({ look: {}, parent: "entities.enemy" });
    expect(parseEntitySource(`return {}`)).toBeNull();
    expect(parseEntitySource(`local x = nova.entity {`)).toBeNull();
    expect(parseEntitySource("")).toBeNull();
  });
});

describe("resolveEntity", () => {
  const files: Record<string, string> = {
    "entities/enemy.lua": `return nova.entity { sprite = "grub", pivot = { 0.5, 1 } }`,
    "entities/boss.lua": `return nova.entity(require("entities.enemy"), { hp = 500, sprite = "boss" })`,
    "entities/ghost.lua": `return nova.entity(require("entities.enemy"), { hp = 1 })`,
    "entities/foes/imp.lua": `return nova.entity { sprite = "imp" }`,
    "entities/loop.lua": `return nova.entity(require("entities.loop"), { })`,
  };
  const read = async (p: string) => files[p] ?? null;

  it("follows inheritance, with the child winning, and finds dotted kinds", async () => {
    expect(await resolveEntity("enemy", read)).toEqual({ sprite: "grub", pivot: [0.5, 1] });
    expect(await resolveEntity("boss", read)).toEqual({ sprite: "boss", pivot: [0.5, 1] });
    expect(await resolveEntity("ghost", read)).toEqual({ sprite: "grub", pivot: [0.5, 1] });
    expect(await resolveEntity("foes.imp", read)).toEqual({ sprite: "imp" });
    expect(entityPath("foes.imp")).toBe("entities/foes/imp.lua");
  });

  it("copes with missing files and inheritance loops", async () => {
    expect(await resolveEntity("nothing", read)).toEqual({});
    expect(await resolveEntity("loop", read)).toEqual({});
  });
});
