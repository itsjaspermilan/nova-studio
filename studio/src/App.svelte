<script lang="ts">
  import { onMount } from "svelte";
  import Hub from "./components/Hub.svelte";
  import FileTree from "./components/FileTree.svelte";
  import Editor from "./components/Editor.svelte";
  import SceneEditor from "./components/SceneEditor.svelte";
  import SpriteEditor from "./components/SpriteEditor.svelte";
  import SoundEditor from "./components/SoundEditor.svelte";
  import ModelEditor from "./components/ModelEditor.svelte";
  import SongEditor from "./components/SongEditor.svelte";
  import TrackEditor from "./components/TrackEditor.svelte";
  import TimelineEditor from "./components/TimelineEditor.svelte";
  import Help from "./components/Help.svelte";
  import BottomPanel from "./components/BottomPanel.svelte";
  import StoreArt from "./components/StoreArt.svelte";
  import Simulate from "./components/Simulate.svelte";
  import WindowButtons from "./components/WindowButtons.svelte";
  import PlayButton from "./components/PlayButton.svelte";
  import CommandPalette from "./components/CommandPalette.svelte";
  import MenuBar from "./components/MenuBar.svelte";
  import WorkspaceTabs from "./components/WorkspaceTabs.svelte";
  import WorkspaceHome from "./components/WorkspaceHome.svelte";
  import { WORKSPACES } from "./lib/workspaces";
  import { commands, sendChord } from "./lib/commands";
  import { resolveMenus } from "./lib/menus";
  import { commandsRev } from "./lib/commands-rev.svelte";
  import { listenNativeMenu, syncNativeMenu } from "./lib/native-menu";
  import { fileKind } from "./lib/tree";
  import { markChrome } from "./lib/chrome";
  import { resizable } from "./lib/resize";
  import { layout, sizeKey } from "./lib/layout.svelte";
  import { isDirty, studio } from "./lib/store.svelte";

  // (the window's own buttons sit in the studio's top bar: see lib/chrome.ts)
  const chrome = markChrome();
  // the project tree can be folded away for more room (the button at the left of the top bar, or ⌘B); each workspace remembers its own
  const treeOpen = $derived(layout.get(studio.workspace).treeOpen);
  const toggleTree = () => {
    layout.set(studio.workspace, { treeOpen: !treeOpen });
    window.dispatchEvent(new Event("resize"));
  };

  let paletteOpen = $state(false);
  // the system menu bar follows the commands (a command becoming available greys or enables its item)
  $effect(() => {
    void commandsRev.n; // (commands are added after the first run)
    const menus = resolveMenus(commands);
    if (chrome === "mac") void syncNativeMenu(menus);
  });

  onMount(() => {
    void studio.init();
    // Every action is a command (lib/commands.ts); the keys, the palette and, later, the menus all read this list.
    const has = () => !!studio.project;
    const offs = [
      commands.register({ id: "help.toggle", title: "Show or hide help", menu: "Help", icon: "help", keys: ["F1"], help: "Lessons, the reference and the shortcuts", run: () => { if (studio.helpOpen) studio.helpOpen = false; else studio.openHelp(); } }),
      commands.register({ id: "palette.open", title: "Search commands", menu: "Help", icon: "search", keys: ["Mod+K"], help: "Find any command by name", run: () => { paletteOpen = true; } }),
      commands.register({ id: "view.tree", title: "Show or hide the project tree", menu: "View", keys: ["Mod+B"], enabled: has, run: toggleTree }),
      commands.register({ id: "view.panel", title: "Show or hide the bottom panel", menu: "View", keys: ["Mod+J"], help: "Problems, play and the debugger", enabled: has, run: () => { studio.panelOpen = !studio.panelOpen; window.dispatchEvent(new Event("resize")); } }),
      commands.register({ id: "view.resetLayout", title: "Reset this workspace's layout", menu: "Window", help: "Panels back to their usual places and sizes", enabled: has, run: () => { layout.reset(studio.workspace); window.dispatchEvent(new Event("resize")); } }),
      commands.register({ id: "file.save", title: "Save", menu: "File", icon: "device-floppy", keys: ["Mod+S"], run: () => void studio.save() }),
      commands.register({ id: "file.saveAll", title: "Save all", menu: "File", enabled: () => !!studio.project && studio.dirty, run: () => void studio.saveAll() }),
      commands.register({ id: "file.close", title: "Close the project", menu: "File", enabled: has, run: () => void studio.closeProject() }),
      commands.register({ id: "file.export", title: "Export the game", menu: "File", help: "Check the game and write it out for a computer or for Android", enabled: has, run: () => { studio.exportReport = null; studio.exportOpen = true; } }),
      commands.register({ id: "run.play", title: "Play or stop the game", menu: "Run", icon: "player-play", keys: ["Mod+Enter"], enabled: has, run: () => void (studio.running ? studio.stop() : studio.play()) }),
      commands.register({ id: "run.playDevice", title: "Play on the device used last", menu: "Run", keys: ["Mod+Shift+Enter"], enabled: has, run: () => void (studio.running ? studio.stop() : studio.playOnPreferredDevice()) }),
      commands.register({ id: "tool.simulate", title: "Simulate the game many times", menu: "Run", enabled: has, run: () => { studio.tool = "sim"; } }),
      ...WORKSPACES.map((w, i) => commands.register({ id: `workspace.${w.id}`, title: `Go to ${w.title}`, menu: "Window", keys: [`Mod+${i + 1}`], help: w.blurb, enabled: has, run: () => studio.setWorkspace(w.id) })),
      // text editing is handled by the focused control itself; the menu only sends it the usual key press or edit command
      commands.register({ id: "edit.undo", title: "Undo", menu: "Edit", icon: "arrow-back-up", keys: ["Mod+Z"], forward: true, run: () => { if (!sendChord("Mod+Z", commands.platform)) document.execCommand("undo"); } }),
      commands.register({ id: "edit.redo", title: "Redo", menu: "Edit", icon: "arrow-forward-up", keys: ["Mod+Shift+Z"], forward: true, run: () => { if (!sendChord("Mod+Shift+Z", commands.platform)) document.execCommand("redo"); } }),
      commands.register({ id: "edit.cut", title: "Cut", menu: "Edit", keys: ["Mod+X"], forward: true, run: () => void document.execCommand("cut") }),
      commands.register({ id: "edit.copy", title: "Copy", menu: "Edit", keys: ["Mod+C"], forward: true, run: () => void document.execCommand("copy") }),
      commands.register({ id: "edit.paste", title: "Paste", menu: "Edit", keys: ["Mod+V"], forward: true, run: async () => { try { document.execCommand("insertText", false, await navigator.clipboard.readText()); } catch { /* the system paste item does this on a Mac */ } } }),
      commands.register({ id: "edit.selectAll", title: "Select all", menu: "Edit", keys: ["Mod+A"], forward: true, run: () => void document.execCommand("selectAll") }),
      commands.register({ id: "tool.storeArt", title: "Make store art", menu: "Run", help: "The app icon and the cover picture", enabled: has, run: () => { studio.tool = "art"; } }),
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
      window.removeEventListener("focus", refocus);
    };
  });

  // Scene files open visually unless the person asked for the JSON; remembered per file.
  let jsonView = $state(new Set<string>());
  const isScene = (p: string) => p.endsWith(".scene.json");
  const toggleJson = (p: string, on: boolean) => {
    const next = new Set(jsonView);
    if (on) next.add(p);
    else next.delete(p);
    jsonView = next;
  };
  const base = (p: string) => p.slice(p.lastIndexOf("/") + 1);
  const errors = $derived(studio.diagnostics.filter((d) => d.severity === "error").length);
</script>

{#if !studio.ready}
  <div class="boot dim">Starting…</div>
{:else if !studio.project}
  <div class="hubwrap">
    {#if chrome !== "none"}<div class="hubbar winbar-pad" data-tauri-drag-region>{#if chrome !== "mac"}<MenuBar />{/if}<span class="spacer" data-tauri-drag-region></span><WindowButtons /></div>{:else}<div class="hubbar"><MenuBar /></div>{/if}
    <Hub />
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
      <div class="tabbar" role="tablist">
        {#each studio.workspaceTabs as tab (tab.path)}
          <div class="tab" class:on={studio.active === tab.path} role="presentation">
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
      <div class="editor-host">
        {#key studio.active}
          {#if studio.tab}
            {#if studio.tab.path.toLowerCase().endsWith(".png") || (studio.tab.path.endsWith(".sprite.json") && !jsonView.has(studio.tab.path))}
              <SpriteEditor path={studio.tab.path} text={studio.tab.text} />
            {:else if /\.(wav|ogg)$/i.test(studio.tab.path) || (studio.tab.path.endsWith(".sfx.json") && !jsonView.has(studio.tab.path))}
              <SoundEditor path={studio.tab.path} text={studio.tab.text} />
            {:else if studio.tab.path.endsWith(".model.json") && !jsonView.has(studio.tab.path)}
              <ModelEditor path={studio.tab.path} text={studio.tab.text} onjson={() => toggleJson(studio.tab!.path, true)} />
            {:else if studio.tab.path.endsWith(".song.json") && !jsonView.has(studio.tab.path)}
              <SongEditor path={studio.tab.path} text={studio.tab.text} onjson={() => toggleJson(studio.tab!.path, true)} />
            {:else if studio.tab.path.endsWith(".track.json") && !jsonView.has(studio.tab.path)}
              <TrackEditor path={studio.tab.path} text={studio.tab.text} onjson={() => toggleJson(studio.tab!.path, true)} />
            {:else if studio.tab.path.endsWith(".anim.json") && !jsonView.has(studio.tab.path)}
              <TimelineEditor path={studio.tab.path} text={studio.tab.text} onjson={() => toggleJson(studio.tab!.path, true)} />
            {:else if studio.tab.binary}
              <div class="placeholder dim">{base(studio.tab.path)} · {fileKind(studio.tab.path)} · {studio.tab.size.toLocaleString()} bytes<br />Binary files open in their own editors (coming later).</div>
            {:else if isScene(studio.tab.path) && !jsonView.has(studio.tab.path)}
              <SceneEditor path={studio.tab.path} text={studio.tab.text} onjson={() => toggleJson(studio.tab!.path, true)} />
            {:else}
              {#if isScene(studio.tab.path) || studio.tab.path.endsWith(".sprite.json") || studio.tab.path.endsWith(".sfx.json") || studio.tab.path.endsWith(".model.json") || studio.tab.path.endsWith(".song.json")}
                <div class="viewbar"><button class="ghost" onclick={() => toggleJson(studio.tab!.path, false)}>◧ Visual editor</button></div>
              {/if}
              <Editor path={studio.tab.path} text={studio.tab.text} />
            {/if}
          {:else}
            <WorkspaceHome />
          {/if}
        {/key}
      </div>
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

<Help />
<CommandPalette bind:open={paletteOpen} />

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
  .tool { position: fixed; inset: 0; z-index: 40; background: var(--bg); }
  .boot { height: 100%; display: grid; place-items: center; }
  .shell { height: 100%; display: grid; grid-template-columns: auto minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr) auto; grid-template-areas: "top top" "tree center" "bottom bottom"; }
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
  .placeholder { height: 100%; display: grid; place-items: center; text-align: center; padding: 24px; }
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
