<script lang="ts">
  // The menu bar drawn by the studio, for Windows (which has no system menu bar for this window) and the browser preview. On a Mac the
  // system's own menu bar is used (lib/native-menu.ts). Built from the same command list: File Edit View Run Window Help.
  import { commands } from "../lib/commands";
  import { drawnMenus, mnemonicsFor } from "../lib/menus";
  import Icon from "./Icon.svelte";
  import { commandsRev } from "../lib/commands-rev.svelte";

  let open = $state<number | null>(null);
  let bar: HTMLElement | undefined = $state();
  const menus = $derived((void commandsRev.n, drawnMenus(commands)));

  /// Alt opens the menus from the keyboard (Windows habit): Alt then a letter opens that menu, the arrows move, Enter runs, Escape closes.
  let hot = $state(-1); // the highlighted item of the open menu
  let showLetters = $state(false);
  const letters = $derived(mnemonicsFor(menus.map((m) => m.title)));
  let altAlone = false;
  const openMenu = (i: number) => {
    open = i;
    hot = -1;
    showLetters = true;
  };
  const close = () => {
    open = null;
    hot = -1;
    showLetters = false;
  };
  const enabledItems = (menuIndex: number) => menus[menuIndex]!.items.map((it, j) => ({ it, j })).filter(({ it }) => !it.separator && it.enabled);
  const run = async (id: string) => {
    close();
    await commands.run(id);
  };
  // keep the focus in the editor the person was using: the menu buttons do not take it
  const keepFocus = (e: MouseEvent) => e.preventDefault();
  const onkey = (e: KeyboardEvent) => {
    if (e.key === "Alt") {
      altAlone = !e.repeat;
      return;
    }
    altAlone = false;
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.isTrusted) {
      // (with Alt held a Mac types symbols: the key's place on the keyboard tells which letter it is)
      const i = letters.indexOf(/^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : e.key.toLowerCase());
      if (i >= 0) {
        e.preventDefault();
        openMenu(i);
        return;
      }
    }
    if (open === null) return;
    const list = enabledItems(open);
    const at = list.findIndex(({ j }) => j === hot);
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      open = (open + 1) % menus.length;
      hot = -1;
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      open = (open - 1 + menus.length) % menus.length;
      hot = -1;
    } else if (e.key === "ArrowDown" && list.length) {
      e.preventDefault();
      hot = list[(at + 1) % list.length]!.j;
    } else if (e.key === "ArrowUp" && list.length) {
      e.preventDefault();
      hot = list[(at - 1 + list.length) % list.length]!.j;
    } else if (e.key === "Home" && list.length) {
      e.preventDefault();
      hot = list[0]!.j;
    } else if (e.key === "End" && list.length) {
      e.preventDefault();
      hot = list[list.length - 1]!.j;
    } else if (e.key === "Enter" && hot >= 0) {
      e.preventDefault();
      void run(menus[open]!.items[hot]!.id!);
    }
  };
  /// Alt on its own (pressed and let go with nothing between) opens the first menu, as in Windows programs.
  const onkeyup = (e: KeyboardEvent) => {
    if (e.key === "Alt" && altAlone && e.isTrusted) {
      e.preventDefault();
      if (open === null) openMenu(0);
      else close();
    }
    altAlone = false;
  };
  const outside = (e: MouseEvent) => {
    if (open !== null && bar && !bar.contains(e.target as Node)) close();
  };
</script>

<svelte:window onkeydown={onkey} onkeyup={onkeyup} onmousedown={outside} onblur={close} />

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
      >{#if showLetters && letters[i]}{@const at = menu.title.toLowerCase().indexOf(letters[i]!)}{menu.title.slice(0, at)}<u>{menu.title[at]}</u>{menu.title.slice(at + 1)}{:else}{menu.title}{/if}</button>
      {#if open === i}
        <ul class="drop" role="menu">
          {#each menu.items as item, j (j)}
            {#if item.separator}
              <li class="sep" role="separator"></li>
            {:else}
              <li role="none">
                <button role="menuitem" class:hot={j === hot} disabled={!item.enabled} onmousedown={keepFocus} onmouseenter={() => (hot = item.enabled ? j : -1)} onclick={() => run(item.id!)}>
                  <span class="ic"><Icon name={item.icon} size={14} /></span><span class="t">{item.title}</span><span class="keys">{item.shortcut}</span>
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
  .drop button { width: 100%; display: flex; align-items: center; gap: 8px; text-align: left; background: transparent; border: none; border-radius: 5px; padding: 5px 10px; color: var(--text); }
  .drop button.hot:not(:disabled), .drop button:hover:not(:disabled) { background: color-mix(in srgb, var(--accent) 22%, transparent); }
  .drop button:disabled { color: var(--dim); opacity: 0.55; }
  .ic { width: 16px; display: inline-grid; place-items: center; color: var(--dim); }
  .t { flex: 1; text-align: left; }
  .keys { color: var(--dim); font-size: 11px; font-variant-numeric: tabular-nums; }
  .sep { height: 1px; margin: 4px 6px; background: var(--line); }
</style>
