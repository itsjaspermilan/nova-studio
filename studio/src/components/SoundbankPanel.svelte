<script lang="ts">
  // The soundbank: all sounds and music, where each is used, what is unused or missing, what it costs in memory, and a button to make a random
  // group (footsteps that vary) from the sounds you tick. A group is a small file: sounds/<name>.group.json.
  import { onMount } from "svelte";
  import { MAX_VOICES, buildSoundbank, budgetWords, groupFileText, hintFor, parseGroup, type Soundbank } from "../lib/soundbank";
  import { studio } from "../lib/store.svelte";

  let bank = $state<Soundbank | null>(null);
  let ticked = $state<string[]>([]);
  let groupName = $state("");
  let vary = $state(true);
  let busy = $state(false);

  async function scan() {
    busy = true;
    const read = async (path: string) => {
      const tab = studio.tabs.find((t) => t.path === path);
      if (tab && !tab.binary) return tab.text;
      try {
        return (await studio.api!.readFile(path)).text ?? "";
      } catch {
        return "";
      }
    };
    const files = studio.files;
    const textFiles = files.filter((f) => !f.dir && (f.path.endsWith(".lua") || f.path.endsWith(".anim.json") || f.path.endsWith(".scene.json")));
    const sources = await Promise.all(textFiles.map(async (f) => ({ path: f.path, text: await read(f.path) })));
    const groupFiles = files.filter((f) => !f.dir && f.path.endsWith(".group.json") && f.path.startsWith("sounds/"));
    const groups = (await Promise.all(groupFiles.map(async (f) => ({ path: f.path, sounds: parseGroup(await read(f.path))?.sounds ?? [] })))).filter((g) => g.sounds.length);
    bank = buildSoundbank(files, sources, groups);
    busy = false;
  }
  onMount(() => void scan());
  $effect(() => {
    studio.files.length; // (rescan when files come or go)
    void scan();
  });

  const words = $derived(bank ? budgetWords(bank.totalMemory) : null);
  const kb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  const nameOk = $derived(/^[A-Za-z0-9_-]+$/.test(groupName) && !bank?.sounds.some((s) => s.name === groupName) && !bank?.groups.some((g) => g.name === groupName));

  async function makeGroup() {
    if (!nameOk || ticked.length < 2) return;
    const names = ticked.map((p) => p.slice(p.lastIndexOf("/") + 1).replace(/\.[^.]+$/, ""));
    const path = `sounds/${groupName}.group.json`;
    try {
      await studio.api!.writeFile(path, groupFileText(names, vary ? { volume: [0.85, 1], pitch: [0.94, 1.06], noRepeat: true } : { noRepeat: true }));
      await studio.refreshFiles();
      studio.say("info", `Made ${path}. In Lua: nova.sound.play("${groupName}") picks one each time.`);
      ticked = [];
      groupName = "";
    } catch (e) {
      studio.say("error", String(e));
    }
  }
</script>

<div class="bank">
  {#if !bank}
    <p class="dim">Looking through the project…</p>
  {:else}
    <div class="top">
      <span class:warn={words?.state !== "fine"}>{words?.text}</span>
      <span class="dim small">{MAX_VOICES} effects can play at once; past that the oldest gives way.</span>
      <button class="ghost" onclick={scan} disabled={busy}>Look again</button>
    </div>
    {#if bank.missing.length}
      <p class="warn small">Asked for but not in the project: {bank.missing.map((m) => `“${m.name}” in ${m.file}`).join("; ")}.</p>
    {/if}
    {#if bank.unused.length}
      <p class="dim small">Not used by any code: {bank.unused.map((s) => s.name).join(", ")}.</p>
    {/if}
    <table>
      <thead><tr><th></th><th>Sound</th><th>Size</th><th>In memory</th><th>Used by</th></tr></thead>
      <tbody>
        {#each bank.sounds as s (s.path)}
          <tr class:unused={!s.usedBy.length && !s.inGroups.length}>
            <td>{#if s.kind === "effect"}<input type="checkbox" aria-label="Pick {s.name} for a group" checked={ticked.includes(s.path)} onchange={(e) => (ticked = e.currentTarget.checked ? [...ticked, s.path] : ticked.filter((p) => p !== s.path))} />{/if}</td>
            <td><button class="ghost link" onclick={() => void studio.openFile(s.path)} title={s.path}>{s.name}</button>{#if s.streamed} <span class="dim small">streamed</span>{/if}{#each s.inGroups as g (g)} <span class="chip">{g}</span>{/each}
              {#if hintFor(s)}<div class="warn small">{hintFor(s)}</div>{/if}</td>
            <td>{kb(s.size)}</td>
            <td>{kb(s.memory)}</td>
            <td class="small">{s.usedBy.length ? s.usedBy.join(", ") : "—"}</td>
          </tr>
        {:else}
          <tr><td colspan="5" class="dim">No sounds in this project yet.</td></tr>
        {/each}
      </tbody>
    </table>
    {#if bank.groups.length}
      <p class="small"><strong>Groups:</strong> {#each bank.groups as g (g.path)}<button class="ghost link" onclick={() => void studio.openFile(g.path)}>{g.name}</button> ({g.sounds.join(", ")}) {/each}</p>
    {/if}
    <form class="new" onsubmit={(e) => { e.preventDefault(); void makeGroup(); }}>
      <span class="dim small">Tick two or more effects, name the group:</span>
      <input bind:value={groupName} placeholder="e.g. footsteps" aria-label="Group name" />
      <label class="check"><input type="checkbox" bind:checked={vary} /> vary volume and pitch a little</label>
      <button class="primary" disabled={!nameOk || ticked.length < 2}>Make a group</button>
    </form>
  {/if}
</div>

<style>
  .bank { padding: 8px 12px; overflow: auto; height: 100%; display: flex; flex-direction: column; gap: 6px; }
  .top { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 2px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { font-size: 11px; color: var(--dim); }
  tr.unused td:nth-child(2) { opacity: 0.7; }
  .link { padding: 0; border: none; text-decoration: underline; }
  .chip { font-size: 10px; background: var(--panel-2); border: 1px solid var(--line); border-radius: 8px; padding: 0 6px; }
  .small { font-size: 11px; }
  .new { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
</style>
