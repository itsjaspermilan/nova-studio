<script lang="ts">
  // What a workspace shows when none of its documents is open: the project's files of its kind to open, and a way to make a new one.
  import { studio } from "../lib/store.svelte";
  import { WORKSPACES, inWorkspace } from "../lib/workspaces";
  import { newTileset, serializeTileset, tilesetPathFor } from "../lib/tileset";
  import { SONG_TEMPLATES } from "../lib/song-templates";
  let songTemplate = $state("blank");
  let audioFile: HTMLInputElement | undefined = $state();

  const w = $derived(WORKSPACES.find((x) => x.id === studio.workspace)!);
  const own = $derived(inWorkspace(studio.files.filter((f) => !f.dir), studio.workspace).filter((f) => !f.path.endsWith("nova.json")));
  let name = $state("");
  // a tileset is a picture of tiles with a description beside it (lib/tileset.ts)
  const pictures = $derived(studio.files.filter((f) => !f.dir && f.path.toLowerCase().endsWith(".png")).map((f) => f.path));
  let tilePicture = $state("");
  let tileSide = $state(16);
  const makeTileset = async () => {
    const image = tilePicture || pictures[0];
    if (!image) return;
    const path = tilesetPathFor(image);
    if (studio.files.some((f) => f.path === path)) await studio.openFile(path);
    else await studio.createFile(path, serializeTileset(newTileset(Math.max(1, tileSide), Math.max(1, tileSide))));
  };
  const base = (p: string) => p.slice(p.lastIndexOf("/") + 1);
  const make = async (kind: "model" | "sprite" | "sfx" | "song") => {
    const n = name.trim();
    if (!n) return;
    if (kind === "model") await studio.createModel(n);
    else if (kind === "sprite") await studio.createSprite(n, 32);
    else if (kind === "sfx") await studio.createSound(n);
    else await studio.createSong(n, songTemplate);
    name = "";
  };
</script>

<div class="home">
  <h2>{w.title}</h2>
  <p class="dim">{w.blurb}</p>
  {#if studio.workspace !== "engine"}
    <form onsubmit={(e) => { e.preventDefault(); }}>
      <input bind:value={name} placeholder="Name of a new {studio.workspace === 'sound' ? 'sound or song' : studio.workspace === 'model' ? 'model' : 'sprite'}" aria-label="Name" />
      {#if studio.workspace === "model"}<button type="submit" onclick={() => make("model")} disabled={!name.trim()}>New model</button>{/if}
      {#if studio.workspace === "sprites"}<button type="submit" onclick={() => make("sprite")} disabled={!name.trim()}>New sprite</button>{/if}
      {#if studio.workspace === "sound"}
        <button type="submit" onclick={() => make("sfx")} disabled={!name.trim()}>New sound effect</button>
        <button type="button" onclick={() => make("song")} disabled={!name.trim()}>New song</button>
        <select bind:value={songTemplate} aria-label="Start the song from" title={SONG_TEMPLATES.find((t) => t.id === songTemplate)?.blurb}>{#each SONG_TEMPLATES as t (t.id)}<option value={t.id}>{t.name}</option>{/each}</select>
        <button type="button" onclick={() => audioFile?.click()} title="Bring in a WAV, Ogg or MP3 file: a short one becomes a sound effect, a long one music">Import a sound file…</button>
        <input bind:this={audioFile} type="file" accept=".wav,.ogg,.mp3,audio/*" hidden onchange={(e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ""; if (f) void studio.importAudio(f); }} />
      {/if}
    </form>
  {/if}
  {#if studio.workspace === "sprites" && pictures.length}
    <h3>Tileset</h3>
    <form class="tilesetform" onsubmit={(e) => { e.preventDefault(); void makeTileset(); }}>
      <select bind:value={tilePicture} aria-label="Picture of tiles">{#each pictures as p (p)}<option value={p}>{p}</option>{/each}</select>
      <label>Tile size <input type="number" min="1" max="1024" bind:value={tileSide} class="narrow" /></label>
      <button type="submit" title="Describe a picture of tiles: which are solid, and terrains that paint with auto-tiling. Used by the scene editor's tile maps.">Open or make its tileset</button>
    </form>
  {/if}
  {#if own.length}
    <h3>In this project</h3>
    <ul>
      {#each own as f (f.path)}
        <li><button class="ghost" onclick={() => studio.openFile(f.path)} title={f.path}>{base(f.path)}</button> <span class="dim path">{f.path}</span></li>
      {/each}
    </ul>
  {:else if studio.workspace !== "engine"}
    <p class="dim">Nothing here yet.</p>
  {:else}
    <p class="dim">Open a file from the tree.</p>
  {/if}
</div>

<style>
  .home { height: 100%; overflow: auto; padding: 28px 32px; max-width: 760px; }
  h2 { margin: 0 0 2px; font-size: 18px; }
  h3 { font-size: 13px; margin: 22px 0 6px; color: var(--dim); }
  form { display: flex; gap: 8px; margin-top: 14px; flex-wrap: wrap; }
  form input { min-width: 220px; }
  ul { list-style: none; margin: 0; padding: 0; }
  li { display: flex; gap: 10px; align-items: baseline; padding: 1px 0; }
  .path { font-size: 11px; }
  .tilesetform { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .tilesetform label { display: flex; align-items: center; gap: 4px; }
  .narrow { width: 64px; }
</style>
