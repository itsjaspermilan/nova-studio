import { describe, expect, it } from "vitest";
import { EMPTY_SAVE, MAX_BYTES, parseSave, rowsOf, withValue, withoutKey } from "./save-data";

const SAVE = JSON.stringify({ format: 1, data: { best: 120, name: "Ana", sound: true, items: ["a", "b"], settings: { volume: 0.5 } } });

describe("reading a save", () => {
  it("accepts what the runtime writes and says why it refuses the rest", () => {
    expect(parseSave(SAVE).ok).toBe(true);
    expect(parseSave(EMPTY_SAVE).ok).toBe(true);
    expect(parseSave("{ nope")).toMatchObject({ ok: false });
    expect(parseSave('{"data":{}}')).toEqual({ ok: false, error: '"format" must be 1 (it is missing).' });
    expect(parseSave('{"format":2,"data":{}}')).toMatchObject({ ok: false });
    expect(parseSave('{"format":1}')).toMatchObject({ ok: false });
    expect(parseSave("[]")).toMatchObject({ ok: false });
  });
  it("makes a row per key, sorted, with a short preview and editable JSON", () => {
    const p = parseSave(SAVE);
    if (!p.ok) throw new Error(p.error);
    const rows = rowsOf(p.data);
    expect(rows.map((r) => r.key)).toEqual(["best", "items", "name", "settings", "sound"]);
    expect(Object.fromEntries(rows.map((r) => [r.key, [r.kind, r.preview]]))).toEqual({
      best: ["number", "120"], items: ["list", "2 items"], name: ["string", '"Ana"'], settings: ["table", "1 key"], sound: ["boolean", "true"],
    });
    expect(JSON.parse(rows[3]!.json)).toEqual({ volume: 0.5 });
  });
});

describe("changing a save", () => {
  it("sets a value typed as JSON, or as plain text", () => {
    const set = (key: string, typed: string) => {
      const r = withValue(SAVE, key, typed);
      if (!r.ok) throw new Error(r.error);
      const p = parseSave(r.text);
      if (!p.ok) throw new Error(p.error);
      return p.data[key];
    };
    expect(set("best", "300")).toBe(300);
    expect(set("sound", "false")).toBe(false);
    expect(set("name", "Bo")).toBe("Bo");
    expect(set("name", '"Bo"')).toBe("Bo");
    expect(set("items", '["x"]')).toEqual(["x"]);
    expect(set("brand_new", "1.5")).toBe(1.5);
  });
  it("refuses null, a bad key and a save that would be too big", () => {
    expect(withValue(SAVE, "best", "null")).toMatchObject({ ok: false });
    expect(withValue(SAVE, "", "1")).toMatchObject({ ok: false });
    expect(withValue(SAVE, "k".repeat(129), "1")).toMatchObject({ ok: false });
    expect(withValue(SAVE, "big", "x".repeat(MAX_BYTES))).toMatchObject({ ok: false });
    expect(withValue("{ nope", "a", "1")).toMatchObject({ ok: false });
  });
  it("takes a key out and leaves the rest", () => {
    const p = parseSave(withoutKey(SAVE, "best"));
    if (!p.ok) throw new Error(p.error);
    expect(Object.keys(p.data)).toEqual(["name", "sound", "items", "settings"]);
    expect(withoutKey(SAVE, "nope")).toBe(SAVE);
  });
});
