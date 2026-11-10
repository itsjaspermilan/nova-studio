<script lang="ts">
  /// Starts a menu file (menus/menu.menu.json, or menu2…) with a small panel to build on, and opens it in the menu editor.
  async function newMenuFile() {
    let n = "menu";
    let i = 2;
    while (studio.files.some((f) => f.path === `menus/${n}.menu.json`)) n = `menu${i++}`;
    await studio.createFile(`menus/${n}.menu.json`, serializeMenu(newMenu()));
  }
  /// Opens the languages table, starting the project's first language file (English) when it has none.
  async function openLanguages() {
    const first = studio.files.find((f) => !f.dir && /^locales\/[^/]+\.json$/.test(f.path));
    if (first) return void studio.openFile(first.path);
    try {
      await studio.api!.writeFile("locales/en.json", "{}\n");
      await studio.refreshFiles();
      await studio.openFile("locales/en.json");
    } catch (e) {
      studio.say("error", String(e));
    }
  }
  import { onMount } from "svelte";
  import SnapshotsDialog from "./components/SnapshotsDialog.svelte";
  import { newMenu, serializeMenu } from "./lib/menu-doc";
  import Hub from "./components/Hub.svelte";
  import EditorHost from "./components/EditorHost.svelte";
  import FileTree from "./components/FileTree.svelte";
  import Help from "./components/Help.svelte";
  import BottomPanel from "./components/BottomPanel.svelte";
  import StoreArt from "./components/StoreArt.svelte";
  import Simulate from "./components/Simulate.svelte";
  import WindowButtons from "./components/WindowButtons.svelte";
  import PlayButton from "./components/PlayButton.svelte";
  import CommandPalette from "./components/CommandPalette.svelte";
  import MenuBar from "./components/MenuBar.svelte";
  import AppearanceDialog from "./components/AppearanceDialog.svelte";
  import { applyAppearance } from "./lib/appearance.svelte";
  import KeymapEditor from "./components/KeymapEditor.svelte";
  import FirstLaunch from "./components/FirstLaunch.svelte";
  import { input } from "./lib/input-settings.svelte";
  import WorkspaceTabs from "./components/WorkspaceTabs.svelte";
  import { WORKSPACES } from "./lib/workspaces";
  import { commands, sendChord } from "./lib/commands";
  import "./lib/keymap-instance";
  import { resolveMenus } from "./lib/menus";
  import { commandsRev } from "./lib/commands-rev.svelte";
  import { listenNativeMenu, syncNativeMenu } from "./lib/native-menu";
  import { markChrome } from "./lib/chrome";
  import { resizable } from "./lib/resize";
  import { layout, sizeKey } from "./lib/layout.svelte";
  import { droppedOutside } from "./lib/tab-drag";
  import { hintFor } from "./lib/hints";
  let hint = $state("");
  let lastLayout: string | null = null;
  let tabbar: HTMLDivElement | undefined = $state();
  import { isDirty, studio } from "./lib/store.svelte";

  // (the window's own buttons sit in the studio's top bar: see lib/chrome.ts)
  const chrome = markChrome();
  // the project tree can be folded away for more room (the button at the left of the top bar, or ⌘B); each workspace remembers its own
  const treeOpen = $derived(layout.get(studio.workspace).treeOpen);
  const toggleTree = () => {
    layout.set(studio.workspace, { treeOpen: !treeOpen });
    window.dispatchEvent(new Event("resize"));
  };

  // a window made for one document (a tear-off) is told which one before the page loads (src-tauri/src/windows.rs)
  const docPath = (window as unknown as { __NOVA_DOC__?: string }).__NOVA_DOC__ ?? null;
  let paletteOpen = $state(false);
  let keysOpen = $state(false);
  let appearanceOpen = $state(false);
  // the system menu bar follows the commands (a command becoming available greys or enables its item)
  $effect(() => {
    void commandsRev.n; // (commands are added after the first run)
    const menus = resolveMenus(commands);
    if (chrome === "mac") void syncNativeMenu(menus);
  });

  onMount(() => {
    const stopAppearance = applyAppearance();
    void studio.init().then(() => { if (docPath) return studio.joinProject(docPath); });
    // Every action is a command (lib/commands.ts); the keys, the palette and, later, the menus all read this list.
    const has = () => !!studio.project;
    const offs = [
      commands.register({ id: "help.toggle", title: "Show or hide help", menu: "Help", icon: "help", keys: ["F1"], help: "Lessons, the reference and the shortcuts", run: () => { if (studio.helpOpen) studio.helpOpen = false; else studio.openHelp(); } }),
      commands.register({ id: "palette.open", title: "Search commands", menu: "Help", icon: "search", keys: ["Mod+K"], help: "Find any command by name", run: () => { paletteOpen = true; } }),
      commands.register({ id: "view.tree", title: "Show or hide the project tree", menu: "View", icon: "tree", keys: ["Mod+B"], enabled: has, run: toggleTree }),
      commands.register({ id: "view.assets", title: "Show the assets", menu: "View", icon: "folder", keys: ["Mod+Shift+A"], help: "Every sprite, model, sound and scene as a card: search, open, drag into code", enabled: has, run: () => { studio.panel = "assets"; studio.panelOpen = true; window.dispatchEvent(new Event("resize")); } }),
      commands.register({ id: "view.panel", title: "Show or hide the bottom panel", menu: "View", icon: "panel", keys: ["Mod+J"], help: "Problems, play and the debugger", enabled: has, run: () => { studio.panelOpen = !studio.panelOpen; window.dispatchEvent(new Event("resize")); } }),
      commands.register({ id: "view.saveLayout", title: "Save this arrangement of panels", menu: "Window", help: "Keeps which panels are shown, and how big, in every workspace, under a name (Layout 1, Layout 2...); \"Next saved layout\" brings them back", run: () => { let n = layout.names.length + 1; while (layout.names.includes(`Layout ${n}`)) n++; if (layout.saveAs(`Layout ${n}`)) studio.say("info", `Saved as Layout ${n}.`); else studio.say("error", "There is no room for another saved layout: delete one first."); } }),
      commands.register({ id: "view.nextLayout", title: "Next saved layout", menu: "Window", help: "Arrange the panels as the next saved arrangement says", enabled: () => layout.names.length > 0, run: () => { const names = layout.names; const at = names.indexOf(lastLayout ?? ""); lastLayout = names[(at + 1) % names.length]!; layout.apply(lastLayout); window.dispatchEvent(new Event("resize")); studio.say("info", `Layout: ${lastLayout}`); } }),
      commands.register({ id: "view.deleteLayout", title: "Delete the saved layout last used", menu: "Window", help: "Forget the saved arrangement that \"Next saved layout\" last brought back", enabled: () => !!lastLayout && layout.names.includes(lastLayout), run: () => { if (lastLayout) { layout.removeNamed(lastLayout); studio.say("info", `Deleted ${lastLayout}.`); lastLayout = null; } } }),
      commands.register({ id: "view.resetLayout", title: "Reset this workspace's layout", menu: "Window", icon: "resetLayout", help: "Panels back to their usual places and sizes", enabled: has, run: () => { layout.reset(studio.workspace); window.dispatchEvent(new Event("resize")); } }),
      commands.register({ id: "window.tearOff", title: "Move this document to its own window", menu: "Window", icon: "tearOff", help: "A document is open in one window at a time", enabled: () => !!studio.tab && !studio.docWindow && studio.api?.kind === "tauri", run: () => studio.tearOff() }),
      commands.register({ id: "file.save", title: "Save", menu: "File", icon: "save", keys: ["Mod+S"], run: () => void studio.save() }),
      commands.register({ id: "project.settings", title: "Project settings", menu: "File", icon: "settings", help: "The game's name, picture size, graphics and controls", enabled: () => !!studio.project, run: () => void studio.openFile("nova.json") }),
      commands.register({ id: "project.languages", title: "Languages (translations)", menu: "File", icon: "file", help: "A table of the game's text in each language; nova.t(\"key\") in Lua reads it", enabled: () => !!studio.project, run: () => void openLanguages() }),
      commands.register({ id: "project.newMenu", title: "New menu or HUD…", menu: "File", icon: "file", help: "A menu or HUD file (menus/<name>.menu.json) to lay out in the menu editor", enabled: () => !!studio.project, run: () => void newMenuFile() }),
      commands.register({ id: "project.snapshots", title: "Snapshots…", menu: "File", icon: "save", help: "Named copies of the whole project: make one before a bold change, go back to one later", enabled: () => !!studio.project, run: () => { studio.snapshotsOpen = true; } }),
      commands.register({ id: "file.saveAll", title: "Save all", menu: "File", icon: "save", enabled: () => !!studio.project && studio.dirty, run: () => void studio.saveAll() }),
      commands.register({ id: "file.close", title: "Close the project", menu: "File", icon: "folder", enabled: has, run: () => void studio.closeProject() }),
      commands.register({ id: "file.export", title: "Export the game", menu: "File", icon: "export", help: "Check the game and write it out for a computer or for Android", enabled: has, run: () => { studio.exportReport = null; studio.exportOpen = true; } }),
      commands.register({ id: "run.play", title: "Play or stop the game", menu: "Run", icon: "play", keys: ["Mod+Enter"], enabled: has, run: () => void (studio.running ? studio.stop() : studio.play()) }),
      commands.register({ id: "run.playDevice", title: "Play on the device used last", menu: "Run", icon: "play", keys: ["Mod+Shift+Enter"], enabled: has, run: () => void (studio.running ? studio.stop() : studio.playOnPreferredDevice()) }),
      commands.register({ id: "settings.keys", title: "Keyboard shortcuts", menu: "Edit", icon: "keyboard", help: "Choose the keymap and change any shortcut", run: () => { keysOpen = true; } }),
      commands.register({ id: "settings.appearance", title: "Appearance", menu: "Edit", icon: "eye", help: "Theme, size of everything, reduced motion", run: () => { appearanceOpen = true; } }),
      commands.register({ id: "settings.input", title: "Input settings", menu: "Edit", icon: "settings", help: "Mouse, trackpad or pen for moving around 3D views", run: () => { input.dialogOpen = true; } }),
      commands.register({ id: "tool.simulate", title: "Simulate the game many times", menu: "Run", icon: "simulate", enabled: has, run: () => { studio.tool = "sim"; } }),
      ...WORKSPACES.map((w, i) => commands.register({ id: `workspace.${w.id}`, title: `Go to ${w.title}`, menu: "Window", icon: w.id === "model" ? "cube" : w.id === "sprites" ? "sprites" : w.id === "sound" ? "sound" : "engine", keys: [`Mod+${i + 1}`], help: w.blurb, enabled: has, run: () => studio.setWorkspace(w.id) })),
      // text editing is handled by the focused control itself; the menu only sends it the usual key press or edit command
      commands.register({ id: "edit.undo", title: "Undo", menu: "Edit", icon: "undo", keys: ["Mod+Z"], forward: true, run: () => { if (!sendChord("Mod+Z", commands.platform)) document.execCommand("undo"); } }),
      commands.register({ id: "edit.redo", title: "Redo", menu: "Edit", icon: "redo", keys: ["Mod+Shift+Z"], forward: true, run: () => { if (!sendChord("Mod+Shift+Z", commands.platform)) document.execCommand("redo"); } }),
      commands.register({ id: "edit.cut", title: "Cut", menu: "Edit", icon: "cut", keys: ["Mod+X"], forward: true, run: () => void document.execCommand("cut") }),
      commands.register({ id: "edit.copy", title: "Copy", menu: "Edit", icon: "copy", keys: ["Mod+C"], forward: true, run: () => void document.execCommand("copy") }),
      commands.register({ id: "edit.paste", title: "Paste", menu: "Edit", icon: "paste", keys: ["Mod+V"], forward: true, run: async () => { try { document.execCommand("insertText", false, await navigator.clipboard.readText()); } catch { /* the system paste item does this on a Mac */ } } }),
      commands.register({ id: "edit.selectAll", title: "Select all", menu: "Edit", icon: "selectAll", keys: ["Mod+A"], forward: true, run: () => void document.execCommand("selectAll") }),
      commands.register({ id: "tool.storeArt", title: "Make store art", menu: "Run", icon: "storeArt", help: "The app icon and the cover picture", enabled: has, run: () => { studio.tool = "art"; } }),
    ];
    let stopMenu = () => {};
    if (chrome === "mac") void listenNativeMenu().then((off) => (stopMenu = off));
    const keys = (e: KeyboardEvent) => {
      const cmd = commands.forEvent(e);
      if (!cmd) return;
      e.preventDefault();
      void commands.run(cmd.id);
    };
    const refocus = () => {
      void studio.checkExternal();
      void studio.refreshActivity();
    };
    // an assistant working through the MCP server writes files and a log, and another program may change a picture or a
    // sound while the studio is on screen: look every few seconds (only what changed size or time is read)
    const watch = setInterval(() => {
      void studio.refreshActivity();
      if (document.visibilityState === "visible") void studio.checkExternal(true);
    }, 3000);
    // a copy of every unsaved document every half minute, and when the window is hidden or closing (lib/recovery.ts)
    const snapshot = setInterval(() => studio.snapshot(), 30_000);
    const hidden = () => { if (document.visibilityState === "hidden") studio.snapshot(); };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("beforeunload", () => studio.snapshot());
    window.addEventListener("keydown", keys);
    window.addEventListener("focus", refocus);
    return () => {
      clearInterval(watch);
      clearInterval(snapshot);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("keydown", keys);
      for (const off of offs) off();
      stopMenu();
      stopAppearance();
      window.removeEventListener("focus", refocus);
    };
  });

  const base = (p: string) => p.slice(p.lastIndexOf("/") + 1);
  const errors = $derived(studio.diagnostics.filter((d) => d.severity === "error").length);
</script>

{#if !studio.ready || (docPath && !studio.project)}
  <div class="boot dim">Starting…</div>
{:else if !studio.project}
  <div class="hubwrap">
    {#if chrome !== "none"}<div class="hubbar winbar-pad" data-tauri-drag-region>{#if chrome !== "mac"}<MenuBar />{/if}<span class="spacer" data-tauri-drag-region></span><WindowButtons /></div>{:else}<div class="hubbar"><MenuBar /></div>{/if}
    <Hub />
  </div>
{:else if studio.docWindow}
  <div class="docwin">
    <header class="top winbar-pad" data-tauri-drag-region>
      <strong data-tauri-drag-region>{base(studio.docWindow)}</strong>
      <span class="dim small" data-tauri-drag-region>{studio.project.name}</span>
      <span class="spacer" data-tauri-drag-region></span>
      <button class="ghost" onclick={() => studio.saveAll()} disabled={!studio.dirty}>Save</button>
      <WindowButtons />
    </header>
    <main class="center"><div class="editor-host"><EditorHost /></div></main>
  </div>
{:else}
  <div class="shell" class:no-panel={!studio.panelOpen}>
    <header class="top winbar-pad" data-tauri-drag-region>
      {#if chrome !== "mac"}<MenuBar />{/if}
      <button class="ghost treebtn" class:on={treeOpen} onclick={toggleTree} title={treeOpen ? "Hide the project tree (⌘B)" : "Show the project tree (⌘B)"} aria-label={treeOpen ? "Hide the project tree" : "Show the project tree"} aria-pressed={treeOpen}>
        <svg viewBox="0 0 16 14" aria-hidden="true"><rect x="0.75" y="0.75" width="14.5" height="12.5" rx="2" /><path d="M5.5 1v12" />{#if treeOpen}<path class="fill" d="M1.5 1.5h3.2v11h-3.2z" />{/if}</svg>
      </button>
      <button class="ghost" onclick={() => studio.closeProject()} title="Back to projects">‹ Projects</button>
      <strong data-tauri-drag-region>{studio.project.name}</strong>
      <WorkspaceTabs />
      {#if studio.api?.kind === "mock"}<span class="pill">browser preview</span>{/if}
      <span class="spacer" data-tauri-drag-region></span>
      <button class="ghost" onclick={() => studio.openHelp()} title="Help and lessons (F1)">? Help</button>
      <button class="ghost" onclick={() => (studio.tool = "sim")} title="Play the game many times with no window and collect numbers into a table">Simulate</button>
      <button class="ghost" onclick={() => (studio.tool = "art")} title="Make the app icon and the cover picture from the game">Store art</button>
      <button onclick={() => { studio.exportReport = null; studio.exportOpen = true; }} title="Check the game and write it out for a computer or for Android">Export…</button>
      <button onclick={() => studio.saveAll()} disabled={!studio.dirty}>Save all</button>
      <PlayButton />
      <WindowButtons />
    </header>

    {#if treeOpen}<FileTree />{/if}

    <main class="center">
      <div class="tabbar" role="tablist" bind:this={tabbar}>
        {#each studio.workspaceTabs as tab (tab.path)}
          <div class="tab" class:on={studio.active === tab.path} role="presentation" draggable="true" title="Drag out of the tab strip to open it in its own window"
            ondragstart={(e) => { e.dataTransfer?.setData("text/plain", tab.path); }}
            ondragend={(e) => { if (tabbar && !studio.docWindow && droppedOutside(tabbar.getBoundingClientRect(), e.clientX, e.clientY)) { if (studio.api?.kind === "tauri") void studio.tearOff(tab.path); else studio.say("info", "Opening a document in its own window needs the desktop app."); } }}>
            <button role="tab" aria-selected={studio.active === tab.path} onclick={() => (studio.active = tab.path)} title={tab.path}>
              {base(tab.path)}{#if isDirty(tab)}<span class="dot" aria-label="unsaved">●</span>{/if}
            </button>
            <button class="ghost x" aria-label="Close {base(tab.path)}" onclick={() => studio.closeTab(tab.path)}>✕</button>
          </div>
        {/each}
      </div>
      {#if studio.recoverable.length}
        <div class="conflict" role="alert">
          <span>Unsaved changes from last time were kept for {studio.recoverable.map((r) => base(r.path)).join(", ")}.</span>
          <button onclick={() => studio.restoreRecovered()}>Restore</button>
          <button class="danger" onclick={() => studio.discardRecovered()}>Discard</button>
        </div>
      {/if}
      {#if studio.tab?.conflict}
        <div class="conflict" role="alert">
          <span><strong>{base(studio.tab.path)}</strong> was changed outside the studio, and you have unsaved changes here.</span>
          <button onclick={() => studio.keepMine(studio.tab!.path)}>Keep mine</button>
          <button class="danger" onclick={() => studio.useDiskVersion(studio.tab!.path)}>Load from disk</button>
        </div>
      {/if}
      <div class="editor-host"><EditorHost /></div>
    </main>

    {#if studio.panelOpen}
      <div class="bottom" use:resizable={{ key: sizeKey("bottom", studio.workspace), edge: "top", size: 220, min: 90, max: 640 }}><BottomPanel /></div>
    {:else}
      <footer class="status">
        <button class="ghost" onclick={() => (studio.panelOpen = true)}>▴ {errors ? `${errors} problem${errors === 1 ? "" : "s"}` : "Problems · Play"}</button>
      </footer>
    {/if}
  </div>
{/if}

<svelte:window onpointerover={(e) => { hint = hintFor(e.target as unknown as Parameters<typeof hintFor>[0]); }} onpointerleave={() => (hint = "")} />
{#if hint}<div class="hintbar" role="status" aria-live="off">{hint}</div>{/if}

<Help />
<CommandPalette bind:open={paletteOpen} />
{#if studio.snapshotsOpen && studio.project}<SnapshotsDialog onclose={() => (studio.snapshotsOpen = false)} />{/if}
{#if keysOpen}<KeymapEditor onclose={() => (keysOpen = false)} />{/if}
{#if appearanceOpen}<AppearanceDialog onclose={() => (appearanceOpen = false)} />{/if}
{#if studio.ready && (!input.configured || input.dialogOpen)}
  <FirstLaunch first={!input.configured} onclose={() => (input.dialogOpen = false)} />
{/if}

{#if studio.tool && studio.project}
  <div class="tool" role="dialog" aria-label={studio.tool === "art" ? "Store art" : "Simulate"}>
    {#if studio.tool === "art"}<StoreArt />{:else}<Simulate />{/if}
  </div>
{/if}

{#if studio.exportOpen && studio.project}
  <div class="backdrop" role="presentation" onclick={(e) => { if (e.target === e.currentTarget && !studio.exporting) studio.exportOpen = false; }}>
    <div class="dialog" role="dialog" aria-label="Export the game">
      <h2>Export {studio.project.name}</h2>
      <p class="dim">The game is checked first; if it has errors nothing is written. Files go into this project's <code>exports</code> folder.</p>
      <div class="choices">
        <button class="primary" disabled={studio.exporting} onclick={() => studio.exportGame("desktop")}>For a computer</button>
        <button disabled={studio.exporting} onclick={() => studio.exportGame("android")} title="Needs the Android tools, which only a development machine has">For Android (APK)</button>
      </div>
      {#if studio.exporting}<p class="dim">Working… an Android build takes a minute or two.</p>{/if}
      {#if studio.exportReport}
        <pre class:fail={!studio.exportReport.ok}>{studio.exportReport.text || (studio.exportReport.ok ? "Done." : "Nothing was written.")}</pre>
        {#if studio.exportReport.ok && studio.exportReport.folder}<p class="dim small">In <code>{studio.exportReport.folder}</code></p>{/if}
      {/if}
      <p class="dim small">The Android file is debug-signed (release signing is yours to do). To try it on the handheld, use the ▾ beside Play: Play on a device.</p>
      <div class="end"><button onclick={() => (studio.exportOpen = false)} disabled={studio.exporting}>Close</button></div>
    </div>
  </div>
{/if}

{#if studio.notice}
  <div class="toast" class:error={studio.notice.kind === "error"} role="status">
    <span>{studio.notice.text}</span>
    <button class="ghost" aria-label="Dismiss" onclick={() => (studio.notice = null)}>✕</button>
  </div>
{/if}

<style>
  .hintbar { position: fixed; left: 8px; bottom: 6px; max-width: min(70vw, 760px); z-index: 50; padding: 3px 10px; font-size: 12px; color: var(--text); background: color-mix(in srgb, var(--panel) 92%, transparent); border: 1px solid var(--line); border-radius: 6px; pointer-events: none; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3); }
  .tool { position: fixed; inset: 0; z-index: 40; background: var(--bg); }
  .boot { height: 100%; display: grid; place-items: center; }
  .shell { height: 100%; display: grid; grid-template-columns: auto minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr) auto; grid-template-areas: "top top" "tree center" "bottom bottom"; }
  .docwin { height: 100%; display: flex; flex-direction: column; }
  .docwin .center { flex: 1; }
  .small { font-size: 11px; }
  .hubwrap { height: 100%; display: flex; flex-direction: column; }
  .hubwrap > :global(.hub) { flex: 1; min-height: 0; }
  .hubbar { display: flex; align-items: center; min-height: 38px; padding: 6px 10px; flex: none; }
  .treebtn { padding: 3px 6px; display: grid; place-items: center; }
  .treebtn svg { width: 16px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.3; }
  .treebtn svg .fill { fill: currentColor; stroke: none; opacity: 0.55; }
  .top { grid-area: top; display: flex; align-items: center; gap: 10px; padding: 6px 10px; background: var(--panel); border-bottom: 1px solid var(--line); }
  .shell > :global(.tree) { grid-area: tree; }
  .center { grid-area: center; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .bottom { grid-area: bottom; min-height: 0; }
  .status { grid-area: bottom; background: var(--panel); border-top: 1px solid var(--line); padding: 2px 8px; }
  .spacer { flex: 1; }
  .top :global(button), .top strong { white-space: nowrap; }
  .top { overflow: hidden; }
  .pill { font-size: 11px; background: var(--panel-2); border: 1px solid var(--line); border-radius: 10px; padding: 1px 8px; color: var(--warn); }
  .tabbar { display: flex; overflow-x: auto; background: var(--panel); border-bottom: 1px solid var(--line); min-height: 33px; }
  .tab { display: flex; align-items: center; border-right: 1px solid var(--line); }
  .tab.on { background: var(--bg); box-shadow: inset 0 -2px var(--accent); }
  .tab > button:first-child { background: transparent; border: none; border-radius: 0; padding: 6px 4px 6px 12px; }
  .tab .x { padding: 0 6px; font-size: 10px; }
  .dot { color: var(--warn); margin-left: 6px; font-size: 9px; }
  .conflict { display: flex; gap: 8px; align-items: center; padding: 6px 12px; background: color-mix(in srgb, var(--warn) 18%, var(--panel)); border-bottom: 1px solid var(--warn); }
  .conflict span { flex: 1; }
  .editor-host { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .editor-host > :global(*) { flex: 1; min-height: 0; }
  .editor-host > :global(.viewbar) { flex: none; padding: 2px 8px; background: var(--panel); border-bottom: 1px solid var(--line); }
  .toast { position: fixed; bottom: 16px; right: 16px; max-width: 460px; display: flex; gap: 8px; align-items: flex-start; background: var(--panel-2); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; box-shadow: 0 8px 24px #0006; z-index: 50; }
  .toast.error { border-color: var(--error); }
  .backdrop { position: fixed; inset: 0; background: #0009; display: grid; place-items: center; z-index: 60; padding: 16px; }
  .dialog { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 16px; width: min(520px, 100%); max-height: 100%; overflow: auto; display: flex; flex-direction: column; gap: 10px; }
  .dialog h2 { margin: 0; font-size: 15px; }
  .choices { display: flex; gap: 8px; flex-wrap: wrap; }
  .dialog pre { margin: 0; padding: 8px; background: var(--bg); border: 1px solid var(--line); border-radius: 6px; white-space: pre-wrap; font-size: 11px; max-height: 220px; overflow: auto; }
  .dialog pre.fail { border-color: var(--error); }
  .dialog .end { display: flex; justify-content: flex-end; }
</style>
