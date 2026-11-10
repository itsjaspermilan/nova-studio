import { describe, expect, it } from "vitest";
import { addKey, addLanguage, buildTable, deleteKey, fromCsv, keysUsed, missing, parseLocale, placeholderProblems, placeholders, removeLanguage, renameKey, serialize, setText, toCsv } from "./locales";

const EN = JSON.stringify({ "menu.start": "Start", coins: "{count} coins", hello: "Hello, {name}!" });
const FR = JSON.stringify({ "menu.start": "Jouer", hello: "Bonjour, {nom} !", extra: "Plus" });
const make = () => buildTable([{ code: "en", text: EN }, { code: "fr", text: FR }]).table;

describe("reading language files", () => {
  it("accepts an object of text and says why it refuses anything else", () => {
    expect(parseLocale("").ok).toBe(true);
    expect(parseLocale('{"a":3}')).toEqual({ ok: false, error: '"a" must be text.' });
    expect(parseLocale("[1]").ok).toBe(false);
    expect(parseLocale("{ nope").ok).toBe(false);
  });
  it("builds one table, rows in the order they first appear, and reports a broken file", () => {
    const { table, errors } = buildTable([{ code: "en", text: EN }, { code: "fr", text: FR }, { code: "de", text: "{ nope" }]);
    expect(table.languages).toEqual(["en", "fr"]);
    expect(table.keys).toEqual(["menu.start", "coins", "hello", "extra"]);
    expect(errors.map((e) => e.code)).toEqual(["de"]);
  });
});

describe("editing", () => {
  it("sets, clears, adds, renames and deletes without touching the original", () => {
    const t = make();
    const a = setText(t, "fr", "coins", "{count} pièces");
    expect(t.text.fr!.coins).toBeUndefined();
    expect(a.text.fr!.coins).toBe("{count} pièces");
    expect(setText(a, "fr", "coins", "").text.fr!.coins).toBeUndefined();
    expect(setText(t, "xx", "coins", "a")).toBe(t);
    const b = renameKey(a, "coins", "wallet");
    expect(b.keys).toContain("wallet");
    expect(b.text.en!.wallet).toBe("{count} coins");
    expect(b.text.en!.coins).toBeUndefined();
    expect(renameKey(a, "coins", "hello")).toBe(a);
    expect(renameKey(a, "coins", "bad key")).toBe(a);
    expect(deleteKey(b, "wallet").keys).not.toContain("wallet");
    expect(addKey(t, "new.key").keys.at(-1)).toBe("new.key");
    expect(addKey(t, "hello")).toBe(t);
    expect(addKey(t, "has space")).toBe(t);
  });
  it("adds and removes a language", () => {
    const t = addLanguage(make(), "de");
    expect(t.languages).toEqual(["en", "fr", "de"]);
    expect(addLanguage(t, "de")).toBe(t);
    expect(addLanguage(t, "not a code")).toBe(t);
    expect(removeLanguage(t, "de").languages).toEqual(["en", "fr"]);
  });
  it("writes each language in row order and leaves empty texts out", () => {
    const t = setText(make(), "fr", "hello", "");
    expect(JSON.parse(serialize(t, "fr"))).toEqual({ "menu.start": "Jouer", extra: "Plus" });
    expect(Object.keys(JSON.parse(serialize(make(), "en")))).toEqual(["menu.start", "coins", "hello"]);
  });
});

describe("checking", () => {
  it("lists the cells with no text", () => {
    expect(missing(make()).map((m) => `${m.lang}:${m.key}`)).toEqual(["en:extra", "fr:coins"]);
  });
  it("finds {names} and the ones a translator changed", () => {
    expect(placeholders("{a} and {b}, {a}")).toEqual(["a", "b"]);
    expect(placeholderProblems(make())).toEqual([{ lang: "fr", key: "hello", message: "uses {nom} but en uses {name}" }]);
  });
  it("finds the keys code asks for", () => {
    expect(keysUsed(['nova.t("menu.start")\nlocal x = nova.t( \'coins\', {count=1})', 'print(nova.t("a.b"))'])).toEqual(["a.b", "coins", "menu.start"]);
  });
});

describe("a spreadsheet", () => {
  it("writes CSV and reads it back, with commas, quotes and new lines in the text", () => {
    let t = make();
    t = setText(t, "en", "hello", 'Say "hi", friend\nnow');
    const csv = toCsv(t);
    expect(csv.split("\n")[0]).toBe("key,en,fr");
    const back = fromCsv(buildTable([{ code: "en", text: "{}" }, { code: "fr", text: "{}" }]).table, csv)!;
    expect(back.text.en!.hello).toBe('Say "hi", friend\nnow');
    expect(back.text.fr!["menu.start"]).toBe("Jouer");
    expect(back.keys).toEqual(t.keys);
  });
  it("adds a language the sheet has and the table did not, and refuses something that is not a sheet of this shape", () => {
    const t = fromCsv(make(), "key,en,de\nmenu.start,Start,Los\n")!;
    expect(t.languages).toEqual(["en", "fr", "de"]);
    expect(t.text.de!["menu.start"]).toBe("Los");
    expect(fromCsv(make(), "name,en\nx,y\n")).toBeNull();
    expect(fromCsv(make(), "")).toBeNull();
  });
});
