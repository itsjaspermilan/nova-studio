<script lang="ts">
  import { tick } from "svelte";
  import { summary } from "../lib/diagnostics";
  import { studio } from "../lib/store.svelte";
  import { ago, toolWords } from "../lib/activity";
  import PerfStrip from "./PerfStrip.svelte";

  // "5 s ago" moves on by itself
  let now = $state(Date.now());
  $effect(() => {
    const id = setInterval(() => (now = Date.now()), 5000);
    return () => clearInterval(id);
  });
  const unseen = $derived(studio.activity.filter((a) => a.t > studio.activitySeen).length);

  let logBox: HTMLDivElement | undefined = $state();
  const label = (n: number | null) => (n ? `line ${n}` : "");

  $effect(() => {
    studio.log.length;
    if (studio.panel === "play") void tick().then(() => logBox?.scrollTo({ top: logBox.scrollHeight }));
  });
</script>

<section class="panel">
  <div class="tabs" role="tablist">
    <button role="tab" aria-selected={studio.panel === "problems"} class:on={studio.panel === "problems"} onclick={() => (studio.panel = "problems")}>
      Problems {#if studio.diagnostics.length}<span class="badge" class:err={studio.diagnostics.some((d) => d.severity === "error")}>{studio.diagnostics.length}</span>{/if}
    </button>
    <button role="tab" aria-selected={studio.panel === "play"} class:on={studio.panel === "play"} onclick={() => (studio.panel = "play")}>
      Play {#if studio.running}<span class="live">●</span>{/if}
    </button>
    <button role="tab" aria-selected={studio.panel === "activity"} class:on={studio.panel === "activity"} onclick={() => ((studio.panel = "activity"), studio.markActivitySeen())} title="What an assistant using the Nova MCP server has done to this project">
      Activity {#if unseen > 0 && studio.panel !== "activity"}<span class="badge new">{unseen}</span>{/if}
    </button>
    <span class="spacer"></span>
    {#if studio.panel === "activity"}
      <span class="dim">{studio.activity.length ? `${studio.activity.length} recent` : ""}</span>
    {:else if studio.panel === "problems"}
      <span class="dim">{studio.checking ? "Checking…" : summary(studio.diagnostics)}</span>
      <button class="ghost" onclick={() => studio.check()} disabled={studio.checking}>Check now</button>
    {:else}
      <button class="ghost" onclick={() => (studio.log = [])}>Clear</button>
    {/if}
    <button class="ghost" aria-label="Hide panel" onclick={() => (studio.panelOpen = false)}>▾</button>
  </div>

  {#if studio.panel === "problems"}
    <ul class="list">
      {#each studio.diagnostics as d, i (i)}
        <li>
          <button class="problem" onclick={() => studio.showProblem(d)} disabled={!d.file} title={d.detail}>
            <span class="sev" class:err={d.severity === "error"}>{d.severity === "error" ? "●" : "▲"}</span>
            <span class="msg">{d.message}</span>
            <span class="where dim mono">{d.file ?? "project"}{d.line ? ` · ${label(d.line)}` : ""}{d.place ? ` · ${d.place}` : ""}</span>
          </button>
          {#if d.stack?.some((f) => !f.internal)}
            <ol class="stack" aria-label="Call stack">
              {#each d.stack.filter((f) => !f.internal) as f, k (k)}
                <li><button class="ghost frame" onclick={() => studio.showProblem({ ...d, file: f.file, line: f.line })} title="Open {f.file}">{f.function || "code"} <span class="dim mono">{f.file}:{f.line}</span></button></li>
              {/each}
            </ol>
          {/if}
        </li>
      {:else}
        <li class="empty dim">{studio.checkedAt ? "The project runs for a few frames without problems." : "Checking the project…"}</li>
      {/each}
    </ul>
  {:else if studio.panel === "activity"}
    <ul class="list activity">
      {#each studio.activity as a (a.t + a.tool + a.note)}
        <li class="act" class:bad={a.error}>
          <span class="when dim">{ago(a.t, now)}</span>
          <span class="what">{toolWords(a.tool)}</span>{#if a.error}<span class="failed">failed</span>{/if}
          <span class="note dim">{a.note}</span>
          {#each a.files as f (f)}
            <button class="ghost file mono" onclick={() => studio.openFile(f)} title="Open {f}">{f}</button>
          {/each}
        </li>
      {:else}
        <li class="empty dim">Nothing yet. When an assistant uses the Nova MCP server on this project (see docs/mcp.md), what it does shows up here as it happens.</li>
      {/each}
    </ul>
  {:else}
    <PerfStrip />
    <div class="log mono" bind:this={logBox}>
      {#each studio.log as l, i (i)}
        <div class:err={l.stream === "stderr"}>{l.line}</div>
      {:else}
        <div class="dim">Press Play to run the game. Output appears here.</div>
      {/each}
    </div>
  {/if}
</section>

<style>
  .panel { background: var(--panel); border-top: 1px solid var(--line); display: flex; flex-direction: column; min-height: 0; height: 100%; }
  .tabs { display: flex; align-items: center; gap: 4px; padding: 4px 8px; border-bottom: 1px solid var(--line); }
  .tabs [role="tab"] { background: transparent; border-color: transparent; }
  .tabs [role="tab"].on { background: var(--panel-2); border-color: var(--line); }
  .spacer { flex: 1; }
  .badge { background: var(--warn); color: #111; border-radius: 8px; padding: 0 6px; font-size: 11px; margin-left: 4px; }
  .badge.err { background: var(--error); }
  .live { color: var(--ok); margin-left: 4px; }
  .badge.new { background: var(--accent); color: #fff; }
  .act { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; padding: 3px 8px; border-radius: 4px; }
  .act:hover { background: var(--panel-2); }
  .act .when { width: 70px; font-size: 11px; flex: none; }
  .act .what { font-weight: 600; }
  .act .note { font-size: 12px; min-width: 0; flex: 1 1 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .act.bad .what { color: var(--error); }
  .act .failed { color: var(--error); font-size: 11px; border: 1px solid var(--error); border-radius: 8px; padding: 0 6px; }
  .act .file { padding: 0 6px; font-size: 11px; border: 1px solid var(--line); }
  .list { list-style: none; margin: 0; padding: 4px; overflow: auto; flex: 1; }
  .problem { width: 100%; display: flex; align-items: baseline; gap: 8px; text-align: left; background: transparent; border-color: transparent; }
  .problem:hover:not(:disabled) { background: var(--panel-2); }
  .sev { color: var(--warn); font-size: 10px; }
  .sev.err { color: var(--error); }
  .msg { flex: 1; min-width: 0; }
  .where { font-size: 11px; white-space: nowrap; }
  .empty { padding: 12px; }
  .log { overflow: auto; flex: 1; min-height: 0; padding: 8px 12px; font-size: 12px; white-space: pre-wrap; }
  .log .err { color: var(--warn); }
  .stack { list-style: none; margin: 0 0 4px 26px; padding: 0; display: flex; flex-direction: column; font-size: 11px; }
  .frame { text-align: left; padding: 0 6px; border: none; }
</style>
