<script lang="ts">
  // Quick Open (Cmd/Ctrl-P): type a few letters of a file's name or folders to find any file of the project, arrow keys and Enter to open it, Escape to close.
  import { tick } from "svelte";
  import { fuzzyFind } from "../lib/fuzzy";
  import { studio } from "../lib/store.svelte";

  let { open = $bindable(false) }: { open: boolean } = $props();
  let query = $state("");
  let index = $state(0);
  let input: HTMLInputElement | undefined = $state();

  const paths = $derived(open ? studio.files.filter((f) => !f.dir).map((f) => f.path) : []);
  const results = $derived(open ? fuzzyFind(paths, query, 50) : []);
  $effect(() => {
    if (open) {
      query = "";
      index = 0;
      void tick().then(() => input?.focus());
    }
  });
  $effect(() => {
    if (index >= results.length) index = Math.max(0, results.length - 1);
  });

  const close = () => (open = false);
  const choose = (i: number) => {
    const hit = results[i];
    if (!hit) return;
    close();
    void studio.openFile(hit.path);
  };
  const onkey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      index = results.length ? (index + 1) % results.length : 0;
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      index = results.length ? (index - 1 + results.length) % results.length : 0;
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(index);
    }
  };
  /// The path as pieces, the matched letters marked.
  const pieces = (path: string, at: number[]) => {
    const set = new Set(at);
    const out: { t: string; m: boolean }[] = [];
    for (let i = 0; i < path.length; i++) {
      const m = set.has(i);
      if (out.length && out[out.length - 1]!.m === m) out[out.length - 1]!.t += path[i];
      else out.push({ t: path[i]!, m });
    }
    return out;
  };
  const split = (path: string) => {
    const k = path.lastIndexOf("/");
    return { dir: k < 0 ? "" : path.slice(0, k + 1), name: k < 0 ? path : path.slice(k + 1) };
  };
</script>

{#if open}
  <div class="backdrop" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) close(); }}>
    <div class="palette" role="dialog" aria-label="Open a file">
      <input
        bind:this={input}
        bind:value={query}
        onkeydown={onkey}
        placeholder="Open a file by name"
        aria-label="Open a file by name"
        role="combobox"
        aria-expanded="true"
        aria-controls="quick-list"
        spellcheck="false"
        autocomplete="off"
      />
      <ul id="quick-list" role="listbox">
        {#each results as hit, i (hit.path)}
          {@const s = split(hit.path)}
          <li role="option" aria-selected={i === index}>
            <button class:on={i === index} onmousemove={() => (index = i)} onclick={() => choose(i)} title={hit.path}>
              <span class="name">{#each pieces(s.name, hit.at.filter((x) => x >= s.dir.length).map((x) => x - s.dir.length)) as p, k (k)}{#if p.m}<b>{p.t}</b>{:else}{p.t}{/if}{/each}</span>
              <span class="dir">{s.dir}</span>
            </button>
          </li>
        {:else}
          <li class="none">{studio.project ? `No file matches “${query}”.` : "Open a project first."}</li>
        {/each}
      </ul>
    </div>
  </div>
{/if}

<style>
  .backdrop { position: fixed; inset: 0; background: #0006; display: flex; justify-content: center; align-items: flex-start; padding-top: 14vh; z-index: 70; }
  .palette { width: min(600px, calc(100% - 32px)); background: var(--panel); border: 1px solid var(--line); border-radius: 10px; box-shadow: 0 16px 48px #0008; overflow: hidden; }
  input { width: 100%; border: none; border-bottom: 1px solid var(--line); border-radius: 0; padding: 12px 14px; font-size: 14px; background: transparent; color: var(--text); outline: none; }
  ul { list-style: none; margin: 0; padding: 4px; max-height: 360px; overflow-y: auto; }
  li button { width: 100%; display: flex; align-items: baseline; gap: 10px; text-align: left; background: transparent; border: none; border-radius: 6px; padding: 6px 10px; color: var(--text); }
  li button.on { background: color-mix(in srgb, var(--accent) 22%, transparent); }
  .name b { color: var(--accent); font-weight: 700; }
  .dir { color: var(--dim); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .none { padding: 12px; color: var(--dim); }
</style>
