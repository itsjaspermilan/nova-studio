<script lang="ts">
  // The command palette (Cmd/Ctrl-K): type to find any command by name, arrow keys and Enter to run it, Escape to close.
  import { tick } from "svelte";
  import { commands } from "../lib/commands";
  import Icon from "./Icon.svelte";

  let { open = $bindable(false) }: { open: boolean } = $props();
  let query = $state("");
  let index = $state(0);
  let input: HTMLInputElement | undefined = $state();

  const results = $derived(open ? commands.search(query).slice(0, 50) : []);
  $effect(() => {
    if (open) {
      query = "";
      index = 0;
      void tick().then(() => input?.focus());
    }
  });
  $effect(() => {
    // keep the highlight on a real row when the list shrinks
    if (index >= results.length) index = Math.max(0, results.length - 1);
  });

  const close = () => (open = false);
  const choose = async (i: number) => {
    const cmd = results[i];
    if (!cmd) return;
    close();
    await commands.run(cmd.id);
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
      void choose(index);
    }
  };
</script>

{#if open}
  <div class="backdrop" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) close(); }}>
    <div class="palette" role="dialog" aria-label="Command palette">
      <input
        bind:this={input}
        bind:value={query}
        onkeydown={onkey}
        placeholder="Search commands"
        aria-label="Search commands"
        role="combobox"
        aria-expanded="true"
        aria-controls="palette-list"
        aria-activedescendant={results[index] ? `cmd-${results[index]?.id}` : undefined}
        spellcheck="false"
        autocomplete="off"
      />
      <ul id="palette-list" role="listbox">
        {#each results as cmd, i (cmd.id)}
          <li id="cmd-{cmd.id}" role="option" aria-selected={i === index}>
            <button class:on={i === index} onmousemove={() => (index = i)} onclick={() => choose(i)} title={commands.tooltip(cmd)}>
              <span class="ic"><Icon name={cmd.icon} /></span><span class="name">{cmd.title}</span>
              {#if cmd.menu}<span class="menu">{cmd.menu}</span>{/if}
              <span class="keys">{commands.shortcut(cmd)}</span>
            </button>
          </li>
        {:else}
          <li class="none">No command matches “{query}”.</li>
        {/each}
      </ul>
    </div>
  </div>
{/if}

<style>
  .backdrop { position: fixed; inset: 0; background: #0006; display: flex; justify-content: center; align-items: flex-start; padding-top: 14vh; z-index: 70; }
  .palette { width: min(560px, calc(100% - 32px)); background: var(--panel); border: 1px solid var(--line); border-radius: 10px; box-shadow: 0 16px 48px #0008; overflow: hidden; }
  input { width: 100%; border: none; border-bottom: 1px solid var(--line); border-radius: 0; padding: 12px 14px; font-size: 14px; background: transparent; color: var(--text); outline: none; }
  ul { list-style: none; margin: 0; padding: 4px; max-height: 340px; overflow-y: auto; }
  li button { width: 100%; display: flex; align-items: center; gap: 10px; text-align: left; background: transparent; border: none; border-radius: 6px; padding: 6px 10px; color: var(--text); }
  li button.on { background: color-mix(in srgb, var(--accent) 22%, transparent); }
  .ic { width: 18px; display: inline-grid; place-items: center; color: var(--dim); }
  .name { flex: 1; }
  .menu { color: var(--dim); font-size: 11px; }
  .keys { color: var(--dim); font-size: 11px; min-width: 56px; text-align: right; font-variant-numeric: tabular-nums; }
  .none { padding: 12px; color: var(--dim); }
</style>
