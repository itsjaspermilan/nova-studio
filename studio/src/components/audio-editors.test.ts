// @vitest-environment jsdom
// The sound and song editors open a valid file and show something to work with (a smoke test: they mount and do not throw).
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import SoundEditor from "./SoundEditor.svelte";
import SongEditor from "./SongEditor.svelte";
import { studio } from "../lib/store.svelte";
import { PRESETS, toJson } from "../lib/sfx";
import { newSong, serializeSong } from "../lib/song";

let host: HTMLElement;
let app: ReturnType<typeof mount> | undefined;

function open(Editor: typeof SoundEditor | typeof SongEditor, path: string, text: string) {
  studio.tabs = [{ path, text, saved: text, binary: false, size: text.length }];
  studio.active = path;
  app = mount(Editor as typeof SoundEditor, { target: host, props: { path, text, onjson: () => {} } as never });
  flushSync();
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(() => {
  if (app) unmount(app);
  app = undefined;
  host.remove();
});

describe("audio editors", () => {
  it("the sound editor shows the presets and the sound's controls", () => {
    open(SoundEditor, "sounds/coin.sfx.json", toJson(PRESETS.coin!));
    const text = host.textContent ?? "";
    expect(host.querySelectorAll("button").length).toBeGreaterThan(5);
    expect(text.toLowerCase()).toContain("coin");
  });

  it("the song editor opens a new song with its tracks and a way to play it", () => {
    open(SongEditor, "music/theme.song.json", serializeSong(newSong()));
    expect(host.querySelectorAll("button").length).toBeGreaterThan(3);
    expect(host.textContent).toMatch(/play|bpm|tempo/i);
  });
});
