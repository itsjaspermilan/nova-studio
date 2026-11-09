<script lang="ts">
  // The shortcut editor (Edit > Keyboard shortcuts): a keymap preset (Blender's keys or Nova's own) and a list of every command with its
  // shortcut. Click "Change", press the keys you want; Backspace takes the shortcut away. A shortcut another command has is named first.
  import { commands, formatChord, type Command, type Keymap } from "../lib/commands";
  import { commandsRev } from "../lib/commands-rev.svelte";
  import { chordOf } from "../lib/keymap";
  import { keymap } from "../lib/keymap-instance";

  let { onclose }: { onclose: () => void } = $props();
  let filter = $state("");
  let preset: Keymap = $state(keymap.preset);
  let recording: string | null = $state(null);
  let conflict: { id: string; chord: string; others: Command[] } | null = $state(null);

  const rows = $derived.by(() => {
    void commandsRev.n; // (follows changes to the keys)
    const q = filter.trim().toLowerCase();
    return commands
      .all()
      .filter((c) => c.menu || commands.keysOf(c).length)
      .filter((c) => !q || `${c.title} ${c.menu ?? ""}`.toLowerCase().includes(q))
      .sort((a, b) => (a.menu ?? "~").localeCompare(b.menu ?? "~") || a.title.localeCompare(b.title));
  });
  const shown = (c: Command) => {
    void commandsRev.n;
    const k = commands.keysOf(c);
    return k.length ? k.map((x) => formatChord(x, commands.platform)).join("  ·  ") : "none";
  };

  const choosePreset = (p: Keymap) => {
    preset = p;
    keymap.setPreset(p);
  };

  const onkey = (e: KeyboardEvent) => {
    if (!recording) {
      if (e.key === "Escape") onclose();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      recording = null;
      conflict = null;
      return;
    }
    if ((e.key === "Backspace" || e.key === "Delete") && !e.metaKey && !e.ctrlKey) {
      keymap.setKeys(recording, []);
      recording = null;
      return;
    }
    const chord = chordOf(e, commands.platform);
    if (!chord) return; // (a modifier on its own: wait for the key)
    const others = commands.takenBy(chord, recording);
    if (others.length) {
      conflict = { id: recording, chord, others };
      return;
    }
    keymap.setKeys(recording, [chord]);
    recording = null;
  };
  const replace = () => {
    if (!conflict) return;
    // (the other commands lose this shortcut, so one key does one thing)
    for (const o of conflict.others) keymap.setKeys(o.id, commands.keysOf(o).filter((k) => !sameKey(k, conflict!.chord)));
    keymap.setKeys(conflict.id, [conflict.chord]);
    conflict = null;
    recording = null;
  };
  const sameKey = (a: string, b: string) => formatChord(a, commands.platform) === formatChord(b, commands.platform);
</script>

<svelte:window onkeydowncapture={onkey} />

<div class="backdrop" role="presentation" onclick={(e) => { if (e.target === e.currentTarget && !recording) onclose(); }}>
  <div class="dialog" role="dialog" aria-label="Keyboard shortcuts" aria-modal="true">
    <h2>Keyboard shortcuts</h2>
    <div class="top">
      <label>Keymap
        <select value={preset} onchange={(e) => choosePreset(e.currentTarget.value as Keymap)}>
          <option value="blender">Blender (G, R, S, Tab, X…)</option>
          <option value="nova">Nova (W, E, R, P…)</option>
        </select>
      </label>
      <input bind:value={filter} placeholder="Find a command" aria-label="Find a command" />
      <button onclick={() => keymap.resetAll()} title="Every shortcut back to the keymap's own">Reset all</button>
    </div>
    <ul>
      {#each rows as c (c.id)}
        <li class:rec={recording === c.id}>
          <span class="name">{c.title}<small>{c.menu ?? ""}</small></span>
          <span class="keys" class:custom={commands.isCustom(c.id)}>{recording === c.id ? "Press the keys…" : shown(c)}</span>
          <button class="ghost" onclick={() => { recording = c.id; conflict = null; }}>Change</button>
          <button class="ghost" onclick={() => keymap.reset(c.id)} disabled={!commands.isCustom(c.id)}>Reset</button>
        </li>
      {/each}
    </ul>
    {#if conflict}
      <div class="warn" role="alert">
        <span>{formatChord(conflict.chord, commands.platform)} is already used by {conflict.others.map((o) => o.title).join(", ")}.</span>
        <button onclick={replace}>Use it here instead</button>
        <button class="ghost" onclick={() => { conflict = null; recording = null; }}>Cancel</button>
      </div>
    {/if}
    <div class="end"><button class="primary" onclick={onclose}>Done</button></div>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: #000a; display: grid; place-items: center; z-index: 90; padding: 16px; }
  .dialog { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 18px; width: min(680px, 100%); max-height: 100%; display: flex; flex-direction: column; gap: 10px; }
  h2 { margin: 0; font-size: 17px; }
  .top { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .top input { flex: 1; min-width: 140px; }
  ul { list-style: none; margin: 0; padding: 0; overflow-y: auto; border: 1px solid var(--line); border-radius: 8px; min-height: 120px; }
  li { display: flex; align-items: center; gap: 8px; padding: 4px 10px; border-bottom: 1px solid var(--line); }
  li:last-child { border-bottom: none; }
  li.rec { background: color-mix(in srgb, var(--accent) 16%, transparent); }
  .name { flex: 1; display: flex; flex-direction: column; }
  small { color: var(--dim); font-size: 11px; }
  .keys { min-width: 150px; text-align: right; font-variant-numeric: tabular-nums; }
  .keys.custom { color: var(--accent); }
  .warn { display: flex; gap: 8px; align-items: center; padding: 8px 10px; background: color-mix(in srgb, var(--warn) 18%, var(--panel)); border: 1px solid var(--warn); border-radius: 8px; }
  .warn span { flex: 1; }
  .end { display: flex; justify-content: flex-end; }
</style>
