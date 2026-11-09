<script lang="ts">
  // The menu bar drawn by the studio, for Windows (which has no system menu bar for this window) and the browser preview. On a Mac the
  // system's own menu bar is used (lib/native-menu.ts). Built from the same command list: File Edit View Run Window Help.
  import { commands } from "../lib/commands";
  import { drawnMenus } from "../lib/menus";
  import { commandsRev } from "../lib/commands-rev.svelte";

  let open = $state<number | null>(null);
  let bar: HTMLElement | undefined = $state();
  const menus = $derived((void commandsRev.n, drawnMenus(commands)));

  const close = () => (open = null);
  const run = async (id: string) => {
    close();
    await commands.run(id);
  };
  // keep the focus in the editor the person was using: the menu buttons do not take it
  const keepFocus = (e: MouseEvent) => e.preventDefault();
  const onkey = (e: KeyboardEvent) => {
    if (open === null) return;
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      open = (open + 1) % menus.length;
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      open = (open - 1 + menus.length) % menus.length;
    }
  };
  const outside = (e: MouseEvent) => {
    if (open !== null && bar && !bar.contains(e.target as Node)) close();
  };
</script>

<svelte:window onkeydown={onkey} onmousedown={outside} onblur={close} />

<nav class="menubar" aria-label="Menu" bind:this={bar}>
  {#each menus as menu, i (menu.title)}
    <div class="menu">
      <button
        class="ghost title"
        class:on={open === i}
        aria-haspopup="menu"
        aria-expanded={open === i}
        onmousedown={keepFocus}
        onclick={() => (open = open === i ? null : i)}
        onmouseenter={() => { if (open !== null) open = i; }}
      >{menu.title}</button>
      {#if open === i}
        <ul class="drop" role="menu">
          {#each menu.items as item, j (j)}
            {#if item.separator}
              <li class="sep" role="separator"></li>
            {:else}
              <li role="none">
                <button role="menuitem" disabled={!item.enabled} onmousedown={keepFocus} onclick={() => run(item.id!)}>
                  <span>{item.title}</span><span class="keys">{item.shortcut}</span>
                </button>
              </li>
            {/if}
          {/each}
        </ul>
      {/if}
    </div>
  {/each}
</nav>

<style>
  .menubar { display: flex; align-items: center; gap: 0; }
  .menu { position: relative; }
  .title { padding: 3px 9px; border-radius: 5px; }
  .title.on { background: var(--panel-2); }
  .drop { position: absolute; top: 100%; left: 0; z-index: 80; min-width: 230px; margin: 2px 0 0; padding: 4px; list-style: none; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; box-shadow: 0 10px 30px #0007; }
  .drop button { width: 100%; display: flex; justify-content: space-between; gap: 24px; text-align: left; background: transparent; border: none; border-radius: 5px; padding: 5px 10px; color: var(--text); }
  .drop button:hover:not(:disabled) { background: color-mix(in srgb, var(--accent) 22%, transparent); }
  .drop button:disabled { color: var(--dim); opacity: 0.55; }
  .keys { color: var(--dim); font-size: 11px; font-variant-numeric: tabular-nums; }
  .sep { height: 1px; margin: 4px 6px; background: var(--line); }
</style>
