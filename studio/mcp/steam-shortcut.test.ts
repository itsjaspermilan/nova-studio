// scripts/steam-shortcut.mjs writes a Steam shortcuts.vdf that scripts/steam-shortcut-add.mjs reads back exactly (it refuses a
// file it cannot write back byte for byte), adds to and sets an icon in.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const scripts = resolve(dirname(fileURLToPath(import.meta.url)), "../../scripts");
const node = (...args: string[]) => execFileSync(process.execPath, args, { encoding: "utf8" });
let dir = "";
beforeEach(() => (dir = mkdtempSync(join(tmpdir(), "nova-steam-"))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("the Steam shortcut list", () => {
  it("is written as Steam writes it and read back, added to and changed by steam-shortcut-add", () => {
    const first = join(dir, "shortcuts.vdf");
    node(join(scripts, "steam-shortcut.mjs"), "Pine Ridge Rally", "/home/armada/nova/pine_ridge_rally/pine_ridge_rally", "/home/armada/nova/pine_ridge_rally", first);
    const bytes = readFileSync(first);
    // the root, the list and the entry, then the fields Steam writes, and the end: tags, entry, list, file each closed once
    expect(bytes.subarray(0, 12).toString("latin1")).toBe("\0shortcuts\0\0");
    expect(bytes.subarray(-10).toString("latin1")).toBe("\0tags\0\b\b\b\b");
    for (const k of ["appid", "AppName", "Exe", "StartDir", "icon", "LaunchOptions", "AllowOverlay", "DevkitOverrideAppID", "LastPlayTime", "FlatpakAppID"]) expect(bytes.includes(Buffer.from(`${k}\0`))).toBe(true);
    // the app id is the one --print-appid gives (the number in the grid artwork's names)
    const appid = node(join(scripts, "steam-shortcut-add.mjs"), "--print-appid", "Pine Ridge Rally", "/home/armada/nova/pine_ridge_rally/pine_ridge_rally").trim();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(String(view.getUint32(bytes.indexOf(Buffer.from("appid\0")) + 6, true))).toBe(appid);

    const second = join(dir, "two.vdf");
    expect(node(join(scripts, "steam-shortcut-add.mjs"), first, second, "Starter Racing", "/home/armada/nova/racing/racing", "/home/armada/nova/racing")).toMatch(/2 entries, added "Starter Racing" copying "Pine Ridge Rally"/);
    const third = join(dir, "three.vdf");
    expect(node(join(scripts, "steam-shortcut-add.mjs"), "--set-icon", second, third, "Pine Ridge Rally", "/home/armada/icon.png")).toMatch(/icon of "Pine Ridge Rally" is now/);
    // and the written files read back exactly too (the script refuses a file it cannot)
    expect(node(join(scripts, "steam-shortcut-add.mjs"), third, join(dir, "four.vdf"), "Pine Ridge Rally", "/x", "/y")).toMatch(/already in the list/);
    expect(readFileSync(third).includes(Buffer.from("/home/armada/icon.png\0"))).toBe(true);
  });
});
