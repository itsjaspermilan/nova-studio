<script lang="ts">
  // The Debugger tab: go on or step while the game is paused, its call stack and the paused frame's variables.
  import ValueRows from "./ValueRows.svelte";
  import { debug, type Scope } from "../lib/debugger.svelte";
  import { studio } from "../lib/store.svelte";

  const p = $derived(debug.paused);
  const atError = $derived(p?.reason === "error");
  const breakCount = $derived(Object.values(debug.breakpoints).reduce((n, l) => n + l.length, 0));
  const reasonText = (r: string) => (r === "breakpoint" ? "at a breakpoint" : r === "error" ? "at an error" : "after a step");
  const scopes: [Scope, string][] = [
    ["locals", "Locals"],
    ["upvalues", "Upvalues"],
    ["globals", "Globals"],
  ];

  // F8 carries on, F10 steps over, F11 into, Shift+F11 out (while paused)
  $effect(() => {
    const keys = (e: KeyboardEvent) => {
      if (!debug.paused) return;
      const how = e.key === "F8" ? "continue" : e.key === "F10" ? "step_over" : e.key === "F11" ? (e.shiftKey ? "step_out" : "step_into") : null;
      if (!how || (atError && how !== "continue")) return;
      e.preventDefault();
      void debug.resume(how);
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  });
</script>

<div class="debug">
  <div class="bar">
    {#if p}
      <button onclick={() => debug.resume("continue")} title="Carry on (F8)">{atError ? "Carry on (the game stops)" : "Continue"}</button>
      {#if !atError}
        <button onclick={() => debug.resume("step_over")} title="Run this line and stop at the next one (F10)">Step over</button>
        <button onclick={() => debug.resume("step_into")} title="Go into the function this line calls (F11)">Step into</button>
        <button onclick={() => debug.resume("step_out")} title="Run to the end of this function and stop in the one that called it (Shift+F11)">Step out</button>
      {/if}
    {:else}
      <button onclick={() => debug.pause()} disabled={!debug.connected} title="Stop at the next line of your code">Pause</button>
    {/if}
    <label class="check" title="When the game hits an error, stop at the line where it happened">
      <input type="checkbox" checked={debug.pauseOnErrors} onchange={(e) => debug.setPauseOnErrors((e.currentTarget as HTMLInputElement).checked)} />
      Stop at errors
    </label>
    <span class="spacer"></span>
    {#if breakCount}
      <span class="dim">{breakCount} breakpoint{breakCount === 1 ? "" : "s"}</span>
      <button class="ghost" onclick={() => debug.clearBreakpoints()}>Remove all</button>
    {/if}
  </div>

  <p class="status" class:err={atError} role="status">
    {#if p}
      Paused {reasonText(p.reason)}{p.file ? ` in ${p.file}` : ""}{p.line ? ` line ${p.line}` : ""}.
      {#if p.message}<span class="msg mono">{p.message}</span>{/if}
    {:else if debug.connected}
      Running. Click left of a line number in the code to stop there.
    {:else if studio.running}
      This run has no debugger connection.
    {:else}
      Press Play to run the game with the debugger. Click left of a line number in the code to set a breakpoint.
    {/if}
    {#if debug.problem}<span class="problem">{debug.problem}</span>{/if}
  </p>

  {#if p}
    <div class="split">
      <section class="stack" aria-label="Call stack">
        <h3>Call stack</h3>
        <ol>
          {#each p.stack as f (f.depth)}
            <li>
              <button class="ghost frame" class:on={debug.frame === f.depth} class:internal={f.internal} onclick={() => debug.selectFrame(f)} disabled={f.internal && !f.file}>
                <span class="fn">{f.func}</span>
                <span class="dim mono">{f.file ? `${f.file}:${f.line}` : "Nova"}</span>
              </button>
            </li>
          {/each}
        </ol>
      </section>
      <section class="vars" aria-label="Variables">
        <div class="scopes" role="tablist">
          {#each scopes as [s, label] (s)}
            <button role="tab" aria-selected={debug.scope === s} class:on={debug.scope === s} onclick={() => debug.loadScope(s)}>{label}</button>
          {/each}
        </div>
        <div class="values">
          {#if debug.values}
            <ValueRows entries={debug.values} />
          {:else}
            <p class="dim">…</p>
          {/if}
        </div>
      </section>
    </div>
  {/if}
</div>

<style>
  .debug { display: flex; flex-direction: column; min-height: 0; flex: 1; overflow: hidden; }
  .bar { display: flex; align-items: center; gap: 6px; padding: 6px 8px; flex-wrap: wrap; }
  .check { display: flex; align-items: center; gap: 4px; font-size: 12px; margin-left: 8px; }
  .spacer { flex: 1; }
  .status { margin: 0; padding: 0 10px 6px; font-size: 12px; display: flex; flex-wrap: wrap; gap: 6px; align-items: baseline; }
  .status.err { color: var(--error); }
  .msg { color: var(--text); background: var(--panel-2); padding: 1px 6px; border-radius: 4px; }
  .problem { color: var(--warn); }
  .split { display: flex; min-height: 0; flex: 1; border-top: 1px solid var(--line); }
  .stack { width: 38%; min-width: 180px; border-right: 1px solid var(--line); overflow: auto; }
  .vars { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  h3 { margin: 6px 8px 2px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--dim); }
  ol { list-style: none; margin: 0; padding: 2px 4px; }
  .frame { width: 100%; text-align: left; display: flex; gap: 8px; justify-content: space-between; border: none; padding: 2px 6px; font-size: 12px; }
  .frame.on { background: color-mix(in srgb, var(--accent) 18%, transparent); }
  .frame.internal .fn { color: var(--dim); }
  .scopes { display: flex; gap: 4px; padding: 4px 6px; }
  .scopes button { background: transparent; border-color: transparent; font-size: 12px; }
  .scopes button.on { background: var(--panel-2); border-color: var(--line); }
  .values { overflow: auto; flex: 1; padding: 0 4px 6px; }
</style>
